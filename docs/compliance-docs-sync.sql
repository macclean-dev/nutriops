-- ═══════════════════════════════════════════════════════════════════════════
-- Fatia 2b da Prontidão — os descobertos que faltavam
-- Perfil do estabelecimento na nuvem · ASO · Manual de Boas Práticas
--
-- POR QUE: a auditoria RDC (docs/AUDITORIA_RDC_2026.md) listou 5 DESCOBERTOS —
-- exigências sem NENHUMA captura no app. A Fatia 2a fechou o reservatório
-- (§3.7). Esta fecha os outros dois de alto risco:
--   · Controle de saúde dos manipuladores / ASO (§3.4) — item de autuação
--     clássico: o fiscal pede exame válido POR COLABORADOR.
--   · Manual de Boas Práticas (§3.18) — o app nem sabia se ele existe.
-- E leva junto o perfil do estabelecimento (§3.21), que era local-only: sem
-- ele na nuvem, a validade do alvará nasceria evaporando com o aparelho.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run (sem
-- selecionar nenhum trecho). Rodar ANTES do deploy da v1.9.135 — sem as
-- tabelas os pushes tomam 404 e ficam presos na fila offline.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Perfil do estabelecimento — 1 linha por tenant (config, não histórico).
--    Mesmo padrão de training_config/validity_rules: `updated_at` decide quem
--    vence quando dois aparelhos editam.
--    `data jsonb` guarda o objeto inteiro: este perfil ganhou campo novo três
--    vezes só nesta semana (alvará, validade, prazo de dedetização), e coluna
--    por campo viraria migração a cada ajuste.
create table if not exists public.company_profile (
  tenant_id  text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. Documentos de conformidade — ASO por colaborador, Manual de BP, e o que
--    vier depois (laudo de potabilidade, certificado do curso do responsável).
--    `doc_type` discrimina; `subject` é o colaborador no caso do ASO (null nos
--    documentos da loja inteira); `valid_until` é o que a Prontidão lê pra
--    dizer vencido/vencendo.
create table if not exists public.compliance_docs (
  id          uuid primary key,
  tenant_id   text not null,
  doc_type    text not null,            -- 'aso' | 'manual_bp'
  subject     text,                     -- nome do colaborador (ASO); null nos demais
  issued_at   date,
  valid_until date,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_compliance_tenant on public.compliance_docs(tenant_id);
create index if not exists idx_compliance_type   on public.compliance_docs(tenant_id, doc_type);

-- 3. RLS — mesmo caminho de 4 vias já em produção nas outras tabelas
--    (loja pelo app_metadata.tenant_id · healthcheck · membro por e-mail ·
--    admin da plataforma). NUNCA user_metadata: é editável pelo próprio
--    usuário via updateUser, seria forjável.
--    ⚠️ ORDEM: policy ANTES do enable — RLS sem policy é deny-all.

drop policy if exists tenant_isolation on public.company_profile;
create policy tenant_isolation on public.company_profile for all
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

drop policy if exists tenant_isolation on public.compliance_docs;
create policy tenant_isolation on public.compliance_docs for all
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

alter table public.company_profile enable row level security;
alter table public.compliance_docs enable row level security;

-- 4. Conferência: 2 linhas, ambas com tem_admin = ok.
select tablename,
       case when qual like '%is_admin_plataforma%' then 'ok' else 'FALTANDO' end as tem_admin
  from pg_policies
 where schemaname = 'public'
   and tablename in ('company_profile', 'compliance_docs')
 order by tablename;
