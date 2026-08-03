-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_staff — lista de NOMES da equipe de cada loja (Fase 4, passo 3).
--
-- POR QUE: no modelo novo (operador por registro), quem trabalha na loja é só
-- um nome numa lista — sem credencial. Mas a lista vivia só no localStorage do
-- aparelho: o gerente cadastrava no celular dele e o tablet do balcão nunca
-- via. Sem esta tabela, nenhuma loja consegue migrar pro modelo novo.
--
-- ⚠️ Isto é IDENTIFICAÇÃO, não autenticação. Nunca gravar PIN/senha aqui.
--    Quem tem login de verdade vive em auth.users + tenant_members.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.tenant_staff (
  tenant_id text not null,
  name text not null,
  role text,
  location text,
  status text default 'Ativo',
  updated_at timestamptz default now(),
  primary key (tenant_id, name)
);
create index if not exists idx_staff_tenant on public.tenant_staff(tenant_id);

-- Isolamento por loja — MESMOS 3 caminhos das outras 8 tabelas:
--   device-token legado (app_metadata.tenant_id) · __healthcheck__ · is_member
-- O `is_member` é o que importa aqui: a conta da LOJA e a do gerente entram
-- por tenant_members, não por device-token.
-- Ordem importa: policy ANTES do enable (enable sem policy = deny-all).
drop policy if exists tenant_isolation on public.tenant_staff;
create policy tenant_isolation on public.tenant_staff for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id))
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id));

alter table public.tenant_staff enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — deve devolver 1,1,1 (tabela existe, RLS ligado, policy criada)
-- ═══════════════════════════════════════════════════════════════════════════
-- select
--   (select count(*) from pg_tables  where schemaname='public' and tablename='tenant_staff')           as tabela,
--   (select count(*) from pg_tables  where schemaname='public' and tablename='tenant_staff' and rowsecurity) as rls_ligado,
--   (select count(*) from pg_policies where schemaname='public' and tablename='tenant_staff')          as policies;

-- ═══════════════════════════════════════════════════════════════════════════
-- ISOLAMENTO — com a anon key (do bundle público) isto tem que voltar VAZIO.
-- Se voltar linha, a policy não pegou.
-- ═══════════════════════════════════════════════════════════════════════════
-- curl "$SB_URL/rest/v1/tenant_staff?select=tenant_id,name" -H "apikey: $ANON"
