-- ═══════════════════════════════════════════════════════════════════════════
-- Sincronização do módulo de MANUTENÇÃO — o último local-only
--
-- POR QUE: era o item que sobrava do mapa da auditoria RDC
-- (docs/AUDITORIA_RDC_2026.md §2 e §3.15). Ativos, execuções e ordens de
-- serviço viviam só no localStorage do aparelho — limpar ou trocar o device
-- apagava o histórico de manutenção sem deixar rastro. A RDC 216 §4.1 manda
-- "manter registros" de manutenção de equipamentos, e a tela de Prontidão
-- (check D3) acusava isso desde a Fatia 1.
--
-- Com este SQL, a Prontidão passa a responder D3 = "em ordem" pra manutenção.
--
-- `data jsonb` guarda o objeto inteiro (padrão special_controls/pops): o shape
-- desses registros muda com o produto — planos de manutenção, por exemplo, são
-- um array dentro do ativo — e coluna por campo viraria migração a cada ajuste.
-- As colunas soltas são só o que indexa e filtra.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run (uma vez,
-- sem selecionar trecho). Idempotente.
--
-- ⚠️ O RLS é ligado DUAS vezes de propósito: junto de cada `create table`, e de
-- novo no bloco do fim. Motivo (17/08): o analisador do SQL Editor não lê dentro
-- de `do $$ ... execute format(...)`, então avisava "cria tabelas sem RLS" mesmo
-- com o bloco ligando. Pior que o aviso era a janela real: se o bloco falhasse
-- no meio (ele depende de is_member/is_admin_plataforma existirem), as tabelas
-- ficariam criadas e SEM proteção. Ligar na criação fecha isso — tabela sem
-- policy nega tudo, que é o modo de falhar certo.
-- ⚠️ RODAR ANTES do deploy da versão que sincroniza — sem as tabelas os pushes
-- tomam 404 e ficam presos na fila offline.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ativos de manutenção (o equipamento em si + seus planos preventivos)
create table if not exists public.equip_assets (
  id          uuid primary key,
  tenant_id   text not null,
  name        text not null,
  location    text,
  status      text,                      -- 'Operacional' | 'Em manutenção' | ...
  data        jsonb not null,            -- inclui maintenancePlans[]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_equip_assets_tenant on public.equip_assets(tenant_id);
alter table public.equip_assets enable row level security;   -- ligado JÁ na criação (ver nota no topo)

-- 2. Execuções de manutenção (o que foi feito, quando e por quem)
--    `executed_at` é DATE: a UI grava só o dia (não a hora).
create table if not exists public.maint_logs (
  id            uuid primary key,
  tenant_id     text not null,
  equipment_id  text,
  plan_id       text,
  type          text,                    -- 'preventiva' | 'corretiva' | ...
  title         text,
  executed_by   text,
  executed_at   date,
  data          jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_maint_logs_tenant on public.maint_logs(tenant_id);
create index if not exists idx_maint_logs_equip  on public.maint_logs(tenant_id, equipment_id);
alter table public.maint_logs enable row level security;   -- ligado JÁ na criação (ver nota no topo)

-- 3. Ordens de serviço
create table if not exists public.work_orders (
  id            uuid primary key,
  tenant_id     text not null,
  equipment_id  text,
  status        text,                    -- 'aberta' | 'concluida' | ...
  title         text,
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_work_orders_tenant on public.work_orders(tenant_id);
alter table public.work_orders enable row level security;   -- ligado JÁ na criação (ver nota no topo)

-- 4. As policies — os mesmos 4 caminhos de docs/rls-policies.sql (a fonte de
--    verdade), onde estas três tabelas já entraram na lista.
--    O RLS já foi ligado na criação (acima). A janela entre ligar e ter policy
--    é intencionalmente segura: RLS sem policy NEGA tudo, então o pior caso é
--    o app tomar erro de permissão — visível — em vez de dado exposto.

do $$
declare
  t text;
  regra text := '(tenant_id = (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')'
             || ' or tenant_id = ''__healthcheck__'''
             || ' or public.is_member(tenant_id)'
             || ' or public.is_admin_plataforma())';
begin
  foreach t in array array['equip_assets', 'maint_logs', 'work_orders'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all using %s with check %s',
      t, regra, regra);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 5. Conferência: 3 linhas, todas com os_4_caminhos = 'ok'.
select tablename,
       case when qual like '%is_member%' and qual like '%is_admin_plataforma%'
            then 'ok' else 'FALTA ALGO' end as os_4_caminhos
  from pg_policies
 where schemaname = 'public'
   and tablename in ('equip_assets', 'maint_logs', 'work_orders')
 order by tablename;
