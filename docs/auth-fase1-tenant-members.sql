-- ⛔ NÃO RODE ESTE ARQUIVO — SUPERSEDIDO EM 16/08/2026
--
-- As policies aqui têm a regra ANTIGA (3 caminhos: sem is_admin_plataforma).
-- Rodar este arquivo REBAIXA o banco e tranca as lojas que entram por vínculo
-- (tenant_members). Foi exatamente o que aconteceu com a CASA DOCE: 108
-- registros intactos no banco, tela mostrando zero, console alagado de
-- 401/42501, horas pra diagnosticar porque o erro parecia "chave inválida".
--
-- ⭐ FONTE DE VERDADE: docs/rls-policies.sql
--
-- Mantido só como registro histórico da migração.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · FASE 1 — Vínculo pessoa ↔ empresa (`tenant_members`)
--
-- POR QUE: `app_metadata.tenant_id` é ESCALAR — cabe uma empresa só. A Ana
-- Paula é RT das 3 unidades e a Fran cobre 2. Não cabem. E app_metadata só o
-- `service_role` escreve, coisa que uma SPA estática não pode fazer.
--
-- 100% ADITIVO: as policies passam a aceitar TRÊS caminhos —
--   1. device-token    (legado, continua igual)
--   2. __healthcheck__ (testWrite do boot)
--   3. membership      (NOVO — pessoa autenticada com vínculo)
-- Como ainda não há vínculo nenhum cadastrado, rodar isto NÃO muda o
-- comportamento do app. É fundação.
--
-- Escrito sem laço DO de propósito: explícito > esperto. Idempotente.
-- Rode TUDO de uma vez. Depois rode a VERIFICAÇÃO no fim.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── PARTE A — Tabela de vínculos ─────────────────────────────────────────────

create table if not exists public.tenant_members (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant_id  text not null,
  role       text not null default 'Colaborador',
  created_at timestamptz default now(),
  primary key (user_id, tenant_id)
);

create index if not exists idx_tenant_members_user on public.tenant_members(user_id);

alter table public.tenant_members enable row level security;

-- A pessoa lê só os PRÓPRIOS vínculos. Escrita não tem policy: ninguém se
-- auto-vincula a uma empresa (entra por SQL/RPC administrativo).
drop policy if exists self_read on public.tenant_members;
create policy self_read on public.tenant_members for select
  using (user_id = auth.uid());


-- ── PARTE B — Helper ─────────────────────────────────────────────────────────
-- `security definer` de propósito: é usado DENTRO de outra policy e sem isso o
-- Postgres recursa no RLS da própria tenant_members. Lê só a linha de quem
-- chamou (auth.uid()), então não vaza nada.

create or replace function public.is_member(p_tenant_id text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
     where m.user_id = auth.uid() and m.tenant_id = p_tenant_id
  )
$$;

revoke execute on function public.is_member(text) from anon, public;
grant  execute on function public.is_member(text) to authenticated;


-- ── PARTE C — As 8 policies, uma a uma ───────────────────────────────────────

drop policy if exists tenant_isolation on public.temperature_records;
create policy tenant_isolation on public.temperature_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));

drop policy if exists tenant_isolation on public.form_records;
create policy tenant_isolation on public.form_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));

drop policy if exists tenant_isolation on public.form_templates;
create policy tenant_isolation on public.form_templates for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));

drop policy if exists tenant_isolation on public.equipment_catalog;
create policy tenant_isolation on public.equipment_catalog for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));

drop policy if exists tenant_isolation on public.receiving_records;
create policy tenant_isolation on public.receiving_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));

drop policy if exists tenant_isolation on public.products;
create policy tenant_isolation on public.products for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));

drop policy if exists tenant_isolation on public.stock_logs;
create policy tenant_isolation on public.stock_logs for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));

drop policy if exists tenant_isolation on public.special_controls;
create policy tenant_isolation on public.special_controls for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));


-- ── PARTE D — "Quais empresas eu atendo?" (alimenta o seletor do app) ────────
-- Resolve a Ana Paula (3) e a Fran (2). Nunca devolve access_token nem hash.

create or replace function public.my_tenants()
returns table (tenant_id text, name text, segment text, role text)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id, t.name, t.segment, m.role
    from public.tenant_members m
    left join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
   order by t.name nulls last
$$;

revoke execute on function public.my_tenants() from anon, public;
grant  execute on function public.my_tenants() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO — rode DEPOIS. Esperado: 1, 1, 8
-- (checa a DEFINIÇÃO das policies, não o nome — o nome é igual ao das antigas)
-- ═══════════════════════════════════════════════════════════════════════════
-- select
--   (select count(*) from pg_tables
--      where schemaname='public' and tablename='tenant_members')   as tabela_existe,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname='is_member')         as funcao_existe,
--   (select count(*) from pg_policies
--      where schemaname='public' and policyname='tenant_isolation'
--        and qual like '%is_member%')                              as policies_novas;

-- ⚠️ Se `anon=X` aparecer em is_member/my_tenants depois, rode o revoke ISOLADO
--    — o Supabase reconcede execute dentro da transação do create or replace.


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — volta as policies ao estado de 19/07 (sem is_member)
-- ═══════════════════════════════════════════════════════════════════════════
-- drop policy if exists tenant_isolation on public.temperature_records;
-- create policy tenant_isolation on public.temperature_records for all
--   using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
--   with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');
--   ... (repetir pras outras 7)
-- drop function if exists public.my_tenants();
-- drop function if exists public.is_member(text);
-- drop table if exists public.tenant_members;
