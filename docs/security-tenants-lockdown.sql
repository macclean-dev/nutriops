-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · Fix crítico Advisor: `tenants` publicamente acessível + colunas
-- sensíveis expostas (access_token, setup_pin_hash) pela anon key.
--
-- Estratégia: o acesso anon à `tenants` passa a ser SÓ por funções RPC
-- `security definer` (que rodam como owner e devolvem apenas o necessário,
-- NUNCA o access_token). Depois liga-se RLS deny-all na tabela → a anon key
-- não consegue mais `select *` e enumerar todos os tokens/hashes.
--
-- IDEMPOTENTE: pode rodar de novo à vontade (drop if exists + create).
--
-- ORDEM DE EXECUÇÃO (importante — sem janela de quebra):
--   1) Rode a PARTE 1 agora (cria as RPCs; não tranca nada; app segue igual).
--   2) Deixe o deploy do app (v1.9.31, que usa as RPCs) entrar e teste
--      onboarding/setup/admin (o app tem fallback, então mesmo antes disso não
--      quebra).
--   3) Só então rode a PARTE 2 (liga RLS deny-all + revoga grants). A partir daí
--      a anon key não acessa mais a tabela direto — só via RPC.
--   Rollback da Parte 2: `alter table public.tenants disable row level security;`
--   e `grant all on public.tenants to anon, authenticated;`
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — Funções RPC (rode AGORA; seguro, não tranca nada)
-- ─────────────────────────────────────────────────────────────────────────────

-- get_tenant_by_token: resolve o `?token=`. Devolve o tenant do token informado,
-- SEM o access_token (o cliente já o tem na URL — não há motivo pra ecoar o
-- segredo). Como exige conhecer o token, elimina a enumeração (`select *`).
drop function if exists public.get_tenant_by_token(text);
create function public.get_tenant_by_token(p_token text)
returns table (
  id text, name text, segment text, plan text,
  brand_color text, brand_soft text,
  equipment_catalog jsonb, modules jsonb, stores jsonb,
  setup_pin_hash text, setup_pin_used_at timestamptz,
  setup_pin_attempts integer, setup_pin_locked_until timestamptz,
  admin_email text, admin_name text, trial_ends_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select id, name, segment, plan, brand_color, brand_soft,
         equipment_catalog, modules, stores,
         setup_pin_hash, setup_pin_used_at, setup_pin_attempts, setup_pin_locked_until,
         admin_email, admin_name, trial_ends_at, created_at, updated_at
  from public.tenants
  where access_token = p_token
  limit 1;
$$;

-- mark_setup_consumed: marca o setup PIN como usado (idempotente).
drop function if exists public.mark_setup_consumed(text);
create function public.mark_setup_consumed(p_tenant_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tenants
     set setup_pin_used_at = now(),
         setup_pin_attempts = 0,
         setup_pin_locked_until = null,
         updated_at = now()
   where id = p_tenant_id;
$$;

-- bump_setup_attempts: incrementa tentativas erradas e aplica lock temporário.
-- Devolve o novo estado {attempts, locked_until}.
drop function if exists public.bump_setup_attempts(text, integer, integer);
create function public.bump_setup_attempts(
  p_tenant_id text, p_max integer default 3, p_lock_minutes integer default 15
)
returns table (attempts integer, locked_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev integer;
  v_curlock timestamptz;
  v_next integer;
  v_lock timestamptz;
begin
  select coalesce(setup_pin_attempts, 0), setup_pin_locked_until
    into v_prev, v_curlock
    from public.tenants
   where id = p_tenant_id;
  if not found then
    return; -- 0 linhas → o cliente trata como 'not-found'
  end if;

  v_next := v_prev + 1;
  if v_next >= p_max then
    v_lock := now() + make_interval(mins => p_lock_minutes);
  else
    v_lock := v_curlock;
  end if;

  update public.tenants
     set setup_pin_attempts = v_next,
         setup_pin_locked_until = v_lock,
         updated_at = now()
   where id = p_tenant_id;

  attempts := v_next;
  locked_until := v_lock;
  return next;
end;
$$;

-- upsert_tenant: espelha o pushTenant do /admin (criar/editar cliente, mudar
-- plano). Não sobrescreve o setup_pin_hash quando vem null (edições).
-- ⚠️ APARA DE SEGURANÇA ABERTA: é chamável pela anon, e como é SECURITY DEFINER
-- ignora o RLS — qualquer um com a chave pública do bundle pode criar/sobrescrever
-- empresa, inclusive girar access_token e setup_pin_hash. Fechar com o gate:
--   if coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') <> 'admin' then
--     raise exception 'not authorized' using errcode = '42501';
--   end if;
-- e depois `revoke execute ... from anon, public`.
-- Use SEMPRE app_metadata, NUNCA user_metadata: user_metadata é editável pelo
-- próprio usuário via updateUser, logo forjável (bastaria o devtools pra virar
-- admin). Pré-requisito: o pushTenant precisa mandar o JWT do admin — feito em
-- src/tenant-sync.js (v1.9.47).
drop function if exists public.upsert_tenant(text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, timestamptz);
create function public.upsert_tenant(
  p_id text, p_access_token text, p_name text, p_segment text, p_plan text,
  p_brand_color text, p_brand_soft text,
  p_equipment_catalog jsonb, p_modules jsonb, p_stores jsonb,
  p_setup_pin_hash text, p_admin_email text, p_admin_name text, p_trial_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenants as t (
    id, access_token, name, segment, plan, brand_color, brand_soft,
    equipment_catalog, modules, stores, setup_pin_hash,
    admin_email, admin_name, trial_ends_at, updated_at
  ) values (
    p_id, p_access_token, p_name, p_segment, p_plan, p_brand_color, p_brand_soft,
    coalesce(p_equipment_catalog, '[]'::jsonb),
    coalesce(p_modules, '[]'::jsonb),
    coalesce(p_stores, '[]'::jsonb),
    p_setup_pin_hash, p_admin_email, p_admin_name, p_trial_ends_at, now()
  )
  on conflict (id) do update set
    access_token      = excluded.access_token,
    name              = excluded.name,
    segment           = excluded.segment,
    plan              = excluded.plan,
    brand_color       = excluded.brand_color,
    brand_soft        = excluded.brand_soft,
    equipment_catalog = excluded.equipment_catalog,
    modules           = excluded.modules,
    stores            = excluded.stores,
    setup_pin_hash    = coalesce(excluded.setup_pin_hash, t.setup_pin_hash),
    admin_email       = excluded.admin_email,
    admin_name        = excluded.admin_name,
    trial_ends_at     = excluded.trial_ends_at,
    updated_at        = now();
end;
$$;

-- A anon (e usuários logados) só podem EXECUTAR as RPCs — nunca tocar a tabela.
grant execute on function public.get_tenant_by_token(text)                       to anon, authenticated;
grant execute on function public.mark_setup_consumed(text)                       to anon, authenticated;
grant execute on function public.bump_setup_attempts(text, integer, integer)     to anon, authenticated;
grant execute on function public.upsert_tenant(text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, timestamptz) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — Trancar a tabela (rode DEPOIS do deploy v1.9.31 + teste do app)
-- ─────────────────────────────────────────────────────────────────────────────
-- Liga RLS SEM policy = deny-all pra anon/authenticated (as RPCs security definer
-- seguem funcionando, pois rodam como owner). E revoga os grants de tabela pra
-- fechar o alerta de colunas sensíveis. Fecha os DOIS alertas na `tenants`.

alter table public.tenants enable row level security;
revoke all on public.tenants from anon, authenticated;

-- Conferência (deve devolver 0 linhas / erro de permissão ao rodar como anon):
--   select * from public.tenants;                 -- via anon → nada/negado
--   select public.get_tenant_by_token('<token>'); -- via anon → 1 linha (sem access_token)
