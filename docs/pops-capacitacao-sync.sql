-- ═══════════════════════════════════════════════════════════════════════════
-- Fatia 3 da Prontidão — evidência que sobrevive a wipe
-- POPs · Sessões de capacitação · Config de capacitação · Validações da RT
--
-- POR QUE: a auditoria RDC de 15/08 (docs/AUDITORIA_RDC_2026.md §2) mostrou
-- que o que a RT constrói uma vez e reaproveita — POPs, comprovantes de
-- capacitação, assinaturas de período — vivia SÓ no localStorage do aparelho
-- dela. Limpar o navegador apagava certificados de treinamento da rede
-- inteira sem deixar rastro. É exatamente a evidência que a RDC 216 manda
-- "comprovar mediante documentação". Mesma classe de bug que motivou a
-- Central de NC (corrective-actions-sync.sql).
--
-- `data jsonb` guarda o objeto inteiro (padrão special_controls): o shape
-- desses registros muda com o produto, e o jsonb evita migração de coluna a
-- cada campo novo. As colunas extraídas são só o que indexa/filtra.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run (sem
-- selecionar nenhum trecho). Rodar ANTES do deploy da versão que sincroniza
-- (v1.9.132) — sem as tabelas, os pushes tomam 404 e caem na fila offline
-- até este script existir.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. POPs (Procedimentos Operacionais Padrão)
create table if not exists public.pops (
  id          uuid primary key,
  tenant_id   text not null,
  title       text not null,
  category    text,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_pops_tenant on public.pops(tenant_id);

-- 2. Sessões de capacitação (tema, participantes confirmados, assinatura RT)
create table if not exists public.training_sessions (
  id            uuid primary key,
  tenant_id     text not null,
  status        text,                    -- 'open' | 'closed'
  session_date  date,
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_training_tenant on public.training_sessions(tenant_id);

-- 3. Config de capacitação — 1 linha por tenant (validade em meses + CRN).
--    Sem ela, um device novo volta pro default de 12 meses e o status
--    em-dia/vencido de TODA a equipe muda silenciosamente.
create table if not exists public.training_config (
  tenant_id       text primary key,
  validity_months integer not null default 12,
  crn_number      text default '',
  updated_at      timestamptz not null default now()
);

-- 4. Validações de período da RT (assinatura "revisei os registros do período")
--    Antes: chave local única no device, nem separada por tenant, cap 50.
create table if not exists public.rt_validations (
  id            uuid primary key,
  tenant_id     text not null,
  by_name       text not null,
  role          text,
  period_filter text,                    -- '1' | '7' | '30' | '90' | '0'
  record_count  integer not null default 0,
  note          text default '',
  created_at    timestamptz not null default now()
);
create index if not exists idx_rtval_tenant on public.rt_validations(tenant_id);

-- 5. RLS — mesmo caminho de 4 vias já em produção nas outras tabelas
--    (loja pelo app_metadata.tenant_id · healthcheck · membro por e-mail ·
--    admin da plataforma). NUNCA user_metadata: é editável pelo próprio
--    usuário via updateUser, seria forjável.
--    ⚠️ ORDEM: policy ANTES do enable — RLS sem policy é deny-all.

drop policy if exists tenant_isolation on public.pops;
create policy tenant_isolation on public.pops for all
  using (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or tenant_id = '__healthcheck__'
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
  )
  with check (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or tenant_id = '__healthcheck__'
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
  );

drop policy if exists tenant_isolation on public.training_sessions;
create policy tenant_isolation on public.training_sessions for all
  using (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or tenant_id = '__healthcheck__'
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
  )
  with check (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or tenant_id = '__healthcheck__'
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
  );

drop policy if exists tenant_isolation on public.training_config;
create policy tenant_isolation on public.training_config for all
  using (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or tenant_id = '__healthcheck__'
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
  )
  with check (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or tenant_id = '__healthcheck__'
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
  );

drop policy if exists tenant_isolation on public.rt_validations;
create policy tenant_isolation on public.rt_validations for all
  using (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or tenant_id = '__healthcheck__'
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
  )
  with check (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or tenant_id = '__healthcheck__'
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
  );

alter table public.pops              enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_config   enable row level security;
alter table public.rt_validations    enable row level security;

-- 6. Conferência: 4 linhas, todas com tem_admin = ok.
select tablename,
       case when qual like '%is_admin_plataforma%' then 'ok' else 'FALTANDO' end as tem_admin
  from pg_policies
 where schemaname = 'public'
   and tablename in ('pops', 'training_sessions', 'training_config', 'rt_validations')
 order by tablename;
