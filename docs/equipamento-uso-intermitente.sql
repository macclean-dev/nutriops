-- ═══════════════════════════════════════════════════════════════════════════
-- "Só liga quando está em uso" — parar de cobrar leitura de equipamento
-- intermitente
--
-- POR QUE: o ultracongelador U.3 da gelateria (CASA DOCE) não fica ligado o
-- tempo todo — só quando há produção. Como o app cobrava leitura dele em todo
-- turno, a equipe passou a registrar 0 °C com o aparelho DESLIGADO. Num
-- ultracongelador (faixa -40/-30) isso vira desvio gravíssimo falso no
-- histórico, e o histórico é a evidência que o fiscal folheia.
--
-- A nutricionista escreveu, em 05/09: "provavelmente terei que excluí-lo do
-- cadastro, pois sempre que não for preenchido ficará pendente". Apagar seria
-- pior: tiraria da evidência um equipamento que existe e é usado.
--
-- Com esta coluna o equipamento deixa de ser COBRADO (alerta de turno e
-- "Equipamentos fora da rotina") e continua em tudo o mais: no cadastro, nos
-- relatórios, e aceitando leitura normalmente quando estiver ligado. Nenhuma
-- leitura falsa é criada — o app não inventa número nenhum.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente: pode rodar de novo sem efeito.
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ ANTES DE QUALQUER COISA: confirme que você está no projeto do NutriOPS.
-- Se der erro dizendo que a tabela não existe, PARE — é o projeto errado.
select current_database() as banco,
       (select count(*) from public.equipment_catalog) as equipamentos_cadastrados;


alter table public.equipment_catalog
  add column if not exists uso_intermitente boolean not null default false;

-- `default false` + `not null` de propósito: todo equipamento que já existe
-- continua sendo cobrado, que é o comportamento de sempre. A marca é opt-in,
-- equipamento a equipamento, feita na tela — nada sai da cobrança por omissão
-- nem por migração.

comment on column public.equipment_catalog.uso_intermitente is
  'true = equipamento que só liga quando está em uso (ex.: ultracongelador de produção). Não é cobrado por alerta de turno nem aparece em "Equipamentos fora da rotina"; segue no cadastro, nos relatórios e aceitando leitura quando ligado.';


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rode depois; tem que voltar 1 linha
-- ═══════════════════════════════════════════════════════════════════════════
-- select a.attname as coluna, format_type(a.atttypid, a.atttypmod) as tipo,
--        a.attnotnull as obrigatorio
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
--  where n.nspname = 'public' and c.relname = 'equipment_catalog'
--    and a.attname = 'uso_intermitente';

-- Quem está marcado (deve vir vazio logo após a migração):
-- select coalesce(t.name, e.tenant_id) as empresa, e.label, e.location
--   from public.equipment_catalog e
--   left join public.tenants t on t.id = e.tenant_id
--  where e.uso_intermitente
--  order by 1, 2;
