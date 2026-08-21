-- ═══════════════════════════════════════════════════════════════════════════
-- Vincular uma conta JÁ EXISTENTE a outra empresa (multi-unidade)
--
-- POR QUE: o convite (Edge Function invite-collaborator) só CRIA conta nova.
-- Com e-mail já cadastrado ele recusa com "Já existe uma conta com esse
-- e-mail. Peça a um administrador para vinculá-la a esta empresa" — e não
-- existia jeito de fazer isso pela interface: só INSERT manual em
-- tenant_members pelo admin da plataforma.
--
-- Isso trava o caso multi-unidade (CASA DOCE abrindo lojas novas, 21/08): a
-- dona e a nutricionista já têm conta, e cada unidade nova é um tenant novo.
-- Sem esta RPC, cada abertura de loja dependia do Mac rodar SQL.
--
-- POR QUE RPC E NÃO EDGE FUNCTION: vincular não cria conta nem mexe em senha,
-- então não precisa da service_role. Só precisa ler auth.users (achar o id
-- pelo e-mail) e inserir em tenant_members — os dois cabem num `security
-- definer`, igual ao list_tenant_members que já está em produção. Menos
-- código, sem redeploy de função.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run (sem
-- selecionar nenhum trecho). É idempotente — pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.link_existing_member(
  p_tenant_id text,
  p_email     text,
  p_role      text default 'Colaborador'
)
returns table (user_id uuid, email text, name text, role text, ja_existia boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_user      auth.users%rowtype;
  v_is_admin  boolean;
  v_my_role   text;
  v_existente text;
begin
  -- ── 1) Quem está chamando? ────────────────────────────────────────────────
  v_is_admin := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';

  select m.role into v_my_role
    from public.tenant_members m
   where m.user_id = auth.uid() and m.tenant_id = p_tenant_id;

  -- Mesma régua do convite (invite-collaborator): dono da loja, RT da loja, ou
  -- admin da plataforma. Vincular dá a MESMA porta que convidar — acesso aos
  -- dados desta empresa — então o poder é o mesmo.
  if not (v_is_admin or v_my_role in ('tenant_admin', 'Nutricionista RT')) then
    raise exception 'Você não administra esta empresa.' using errcode = '42501';
  end if;

  -- ── 2) Papel pedido é válido? ─────────────────────────────────────────────
  if p_role not in ('Colaborador', 'Supervisor', 'Nutricionista RT', 'tenant_admin') then
    raise exception 'Papel inválido: %', p_role using errcode = '22023';
  end if;

  -- RT administra a própria equipe, mas não cria outro dono da loja — espelha
  -- a checagem que a Edge Function já faz no convite.
  if p_role = 'tenant_admin' and not (v_is_admin or v_my_role = 'tenant_admin') then
    raise exception 'Só o administrador da loja pode atribuir este papel.' using errcode = '42501';
  end if;

  -- ── 3) A conta existe? ────────────────────────────────────────────────────
  select * into v_user
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1;

  if v_user.id is null then
    raise exception 'Não existe conta com o e-mail %. Use "Convidar colaborador" para criar uma.', p_email
      using errcode = 'P0002';
  end if;

  -- ── 4) Duas contas que NÃO podem ser vinculadas ───────────────────────────

  -- (a) Admin da PLATAFORMA. isGlobalAdmin (src/permissions.js) exige
  --     memberTenants VAZIO — vincular o admin a uma loja o rebaixaria pra
  --     admin de loja e ele perderia a área Super Admin, sem nenhum aviso.
  --     Footgun silencioso: bloqueia na origem.
  if coalesce(v_user.raw_app_meta_data ->> 'role', '') = 'admin' then
    raise exception 'Essa é a conta de administrador da plataforma — vinculá-la a uma empresa faria ela perder o acesso global.'
      using errcode = '42501';
  end if;

  -- (b) Conta de LOJA (login compartilhado do aparelho do balcão). Vincular o
  --     tablet da loja A à loja B deixaria ele gravar evidência sanitária na
  --     empresa errada. Cada aparelho tem a conta da própria unidade.
  if coalesce(v_user.raw_user_meta_data ->> 'isStoreAccount', 'false') = 'true' then
    raise exception 'Essa é uma conta de loja (login do aparelho) — ela pertence a uma unidade só. Crie uma conta de loja própria para esta empresa.'
      using errcode = '42501';
  end if;

  -- ── 5) Vincula (ou atualiza o papel, se já estava vinculado) ──────────────
  select m.role into v_existente
    from public.tenant_members m
   where m.user_id = v_user.id and m.tenant_id = p_tenant_id;

  insert into public.tenant_members (user_id, tenant_id, role)
  values (v_user.id, p_tenant_id, p_role)
  on conflict (user_id, tenant_id) do update set role = excluded.role;

  return query
    select v_user.id,
           v_user.email::text,
           coalesce(v_user.raw_user_meta_data ->> 'name', v_user.email)::text,
           p_role,
           (v_existente is not null);
end;
$$;

revoke execute on function public.link_existing_member(text, text, text) from anon, public;
grant  execute on function public.link_existing_member(text, text, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — a função existe e está fechada pro anônimo?
-- ═══════════════════════════════════════════════════════════════════════════

select p.proname                                   as funcao,
       p.prosecdef                                 as security_definer,
       has_function_privilege('anon',          p.oid, 'execute') as anon_pode,
       has_function_privilege('authenticated', p.oid, 'execute') as logado_pode
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'link_existing_member';
-- Esperado: security_definer = true, anon_pode = false, logado_pode = true.


-- ═══════════════════════════════════════════════════════════════════════════
-- USO (opcional) — vincular a dona da CASA DOCE a uma unidade nova.
-- Descomente, troque o id da empresa e o e-mail, e rode como admin.
-- ═══════════════════════════════════════════════════════════════════════════

-- select * from public.link_existing_member('ID-DA-UNIDADE-NOVA', 'casadocest@gmail.com', 'tenant_admin');

-- Conferir quem ficou vinculado:
-- select u.email, m.role, m.created_at
--   from public.tenant_members m join auth.users u on u.id = m.user_id
--  where m.tenant_id = 'ID-DA-UNIDADE-NOVA' order by m.created_at;
