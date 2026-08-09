-- ═══════════════════════════════════════════════════════════════════════════
-- Sincronização das regras de validade pós-abertura (etiquetas)
--
-- POR QUE: hoje "Regras" (Validades e Estoque → aba Regras) só grava no
-- localStorage do device onde a pessoa está. Se a nutricionista ajustar de
-- casa, o tablet que imprime a etiqueta na produção NUNCA vê a mudança — cada
-- um vive isolado no próprio aparelho. Esta tabela deixa a nuvem ser a fonte
-- de verdade: qualquer device sincroniza no boot e pega a versão mais nova,
-- de quem quer que tenha ajustado por último.
--
-- É 1 linha por loja (config, não histórico) — diferente das outras 9
-- tabelas do sistema, que são log de eventos.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run (sem
-- selecionar nenhum trecho — rodar só parte já causou problema antes hoje).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.validity_rules (
  tenant_id  text primary key,
  rules      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.validity_rules enable row level security;

-- Mesmo caminho de 4 vias já em produção nas outras 9 tabelas: a própria
-- loja (app_metadata.tenant_id), o healthcheck do boot, membro vinculado
-- (is_member) ou o admin da plataforma (is_admin_plataforma).
drop policy if exists tenant_isolation on public.validity_rules;
create policy tenant_isolation on public.validity_rules for all
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
 where schemaname = 'public' and tablename = 'validity_rules';
-- esperado: 1 linha, tem_admin = ok
