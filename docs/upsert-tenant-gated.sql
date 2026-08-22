-- ═══════════════════════════════════════════════════════════════════════════
-- upsert_tenant COM PORTÃO — fonte de verdade runnable
--
-- ⭐ ESTE é o arquivo pra rodar. `docs/security-tenants-lockdown.sql` NÃO cria
-- mais esta função (ver o ⛔ lá no bloco dela).
--
-- POR QUE EXISTE (21/08): o portão de admin foi aplicado À MÃO em produção em
-- 23/07 (ver docs/HISTORICO.md, "upsert_tenant fechada"), mas a versão gated
-- nunca virou arquivo. A única definição versionada era a do lockdown — SEM
-- portão, com o gate só em comentário, seguida de
-- `grant execute ... to anon, authenticated`. E o cabeçalho daquele arquivo
-- dizia "IDEMPOTENTE: pode rodar de novo à vontade".
--
-- Ou seja: seguir a instrução do próprio repositório REABRIA em silêncio a
-- brecha de escrita não-autenticada. `drop` + `create` sem portão + `grant`
-- pra anon = qualquer um com a chave pública do bundle volta a poder criar e
-- SOBRESCREVER empresa, girando `access_token` e `setup_pin_hash` de qualquer
-- loja. Takeover, não bloqueio.
--
-- É a mesma classe do incidente de 16/08 (arquivo re-runnable com drop+create
-- que vence em silêncio, ver CLAUDE.md), com impacto pior. Achado numa revisão
-- adversarial de 21/08 — não houve exploração, a produção está com o portão de
-- 23/07 intacto. O que se corrige aqui é a ARMADILHA versionada.
--
-- SEMPRE `app_metadata`, NUNCA `user_metadata`: user_metadata é editável pelo
-- próprio usuário via `updateUser`, logo forjável — bastaria o devtools pra
-- virar admin.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente de verdade: o portão está DENTRO da função e o revoke vem depois.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.upsert_tenant(
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
  -- ── O PORTÃO ────────────────────────────────────────────────────────────
  -- Só o admin da PLATAFORMA. A função é SECURITY DEFINER, então ignora o RLS
  -- — sem isto, quem alcança a função alcança QUALQUER empresa.
  --
  -- Pré-requisito no cliente: `pushTenant` (src/tenant-sync.js) assina com o
  -- JWT do admin desde a v1.9.47. Antes disso o upsert saía como `role=anon`
  -- mesmo com admin logado, e este portão barraria o cadastro legítimo.
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Só o administrador da plataforma pode criar ou editar empresa.'
      using errcode = '42501';
  end if;

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
    -- coalesce: `null` no hash significa "não mexer" (edição comum). Sem isto,
    -- editar o plano de um cliente revogaria em silêncio o setup PIN que ele
    -- acabou de receber.
    setup_pin_hash    = coalesce(excluded.setup_pin_hash, t.setup_pin_hash),
    admin_email       = excluded.admin_email,
    admin_name        = excluded.admin_name,
    trial_ends_at     = excluded.trial_ends_at,
    updated_at        = now();
end;
$$;

-- ⚠️ O revoke precisa rodar DEPOIS e ISOLADO: o Supabase re-concede execute na
-- transação do `create or replace` (registrado em docs/HISTORICO.md). Se um dia
-- reaparecer `anon=X` na proacl, o portão de dentro da função continua barrando
-- — é por isso que ele existe além do revoke.
revoke execute on function public.upsert_tenant(text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, timestamptz) from anon, public;
grant  execute on function public.upsert_tenant(text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, timestamptz) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════════

select p.proname as funcao,
       p.prosecdef as security_definer,
       has_function_privilege('anon',          p.oid, 'execute') as anon_pode,
       has_function_privilege('authenticated', p.oid, 'execute') as logado_pode,
       p.prosrc like '%app_metadata%' as tem_portao
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'upsert_tenant';
-- Esperado: security_definer=true, anon_pode=false, logado_pode=true,
-- tem_portao=true. Se `anon_pode` vier true, rode o revoke acima ISOLADO.


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTE DE ACEITAÇÃO — empresa DESCARTÁVEL, criada e limpa pela função.
-- Devolve TABELA (o editor do Supabase só mostra o último comando).
-- Não aponta pra cliente real.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.__teste_upsert_gate()
returns table (passo text, resultado text)
language plpgsql security definer set search_path = '' as $$
declare v_id text := '__teste_upsert__';
begin
  delete from public.tenants where id = v_id;

  -- CHECK 1: SEM ser admin da plataforma → tem que barrar
  perform set_config('request.jwt.claims', json_build_object()::text, true);
  begin
    perform public.upsert_tenant(v_id, '__tok_upsert_teste__', 'TESTE upsert', 'padaria',
      'trial', null, null, null, null, null, null, null, null, null);
    passo := 'CHECK 1 — sem ser admin da plataforma';
    resultado := 'X FALHOU: criou empresa sem portao!';
  exception when others then
    passo := 'CHECK 1 — sem ser admin da plataforma';
    resultado := case when sqlstate = '42501' then 'OK barrou'
                      else 'X barrou pelo motivo errado (' || sqlstate || '): ' || sqlerrm end;
  end;
  return next;

  -- CHECK 2: nada foi criado pelo caminho barrado
  passo := 'CHECK 2 — nenhuma empresa fantasma';
  resultado := case when exists (select 1 from public.tenants where id = v_id)
                    then 'X criou empresa mesmo barrando' else 'OK nada criado' end;
  return next;

  -- CHECK 3: COMO admin da plataforma → tem que funcionar
  perform set_config('request.jwt.claims',
    json_build_object('app_metadata', json_build_object('role','admin'))::text, true);
  begin
    perform public.upsert_tenant(v_id, '__tok_upsert_teste__', 'TESTE upsert', 'padaria',
      'trial', null, null, null, null, null, null, null, null, null);
    passo := 'CHECK 3 — como admin da plataforma';
    resultado := case when exists (select 1 from public.tenants where id = v_id)
                      then 'OK criou' else 'X nao criou' end;
  exception when others then
    passo := 'CHECK 3 — como admin da plataforma';
    resultado := 'X FALHOU: ' || sqlerrm;
  end;
  return next;

  -- CHECK 4: hash null NÃO apaga o setup PIN existente
  update public.tenants set setup_pin_hash = 'hash-original' where id = v_id;
  perform public.upsert_tenant(v_id, '__tok_upsert_teste__', 'TESTE upsert', 'padaria',
    'loja', null, null, null, null, null, null, null, null, null);
  passo := 'CHECK 4 — editar sem hash preserva o setup PIN';
  resultado := case when (select setup_pin_hash from public.tenants where id = v_id) = 'hash-original'
                    then 'OK preservou' else 'X apagou o PIN do cliente' end;
  return next;

  delete from public.tenants where id = v_id;
  passo := 'CHECK 5 — limpeza';
  resultado := case when exists (select 1 from public.tenants where id = v_id)
                    then 'X sobrou' else 'OK nada sobrou' end;
  return next;
end;
$$;

select * from public.__teste_upsert_gate();

drop function if exists public.__teste_upsert_gate();

-- ESPERADO: 5 linhas, todas começando com "OK".
