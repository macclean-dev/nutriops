-- ═══════════════════════════════════════════════════════════════════════════
-- Sincronização das ações corretivas + higienização das mãos na nuvem
--
-- POR QUE: até 09/08 as ações corretivas (correção de desvio de temperatura)
-- e os registros de higienização das mãos viviam SÓ no localStorage do
-- device — limpar o navegador apagava a evidência de correção, exigência da
-- própria RDC 216. Este SQL cria a tabela nova; higienização das mãos
-- reaproveita `special_controls` (já existe, só faltava o código chamar).
--
-- Também generaliza o que a ação corretiva referencia: antes só temperatura
-- (`record_id`/`equipment`), agora `source`/`source_id` cobrem as 4 origens
-- da Central de Não-Conformidades (temperatura, recebimento rejeitado,
-- controle reprovado, NC de planilha).
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run (sem
-- selecionar nenhum trecho).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.corrective_actions (
  id             uuid primary key,
  tenant_id      text not null,
  source         text not null,          -- 'temperature' | 'receiving' | 'control' | 'form'
  source_id      text,                   -- id do registro original na origem
  source_label   text,                   -- ex.: "Freezer", "Recebimento — Fornecedor X"
  source_detail  text,                   -- ex.: "38°C · faixa -18 a 0°C"
  description    text not null,
  responsible    text,
  deadline       date,
  status         text not null default 'aberta',   -- aberta | em_andamento | resolvida
  resolution     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz
);

create index if not exists idx_corrective_actions_tenant on public.corrective_actions(tenant_id);

alter table public.corrective_actions enable row level security;

-- Mesmo caminho de 4 vias já em produção nas outras tabelas.
drop policy if exists tenant_isolation on public.corrective_actions;
create policy tenant_isolation on public.corrective_actions for all
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

-- Conferência: a tabela e a policy devem existir.
select tablename,
       case when qual like '%is_admin_plataforma%' then 'ok' else 'FALTANDO' end as tem_admin
  from pg_policies
 where schemaname = 'public' and tablename = 'corrective_actions';
-- esperado: 1 linha, tem_admin = ok

-- Higienização das mãos: NENHUMA mudança de schema — special_controls já é
-- genérica por control_type. Só confirma que a tabela e a policy existem
-- (devem, desde a Fase 3 do RLS em 19/07).
select tablename,
       case when qual like '%is_admin_plataforma%' then 'ok' else 'FALTANDO — rode rls-admin-plataforma.sql' end as tem_admin
  from pg_policies
 where schemaname = 'public' and tablename = 'special_controls';
