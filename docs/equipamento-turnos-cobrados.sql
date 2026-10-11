-- ═══════════════════════════════════════════════════════════════════════════
-- Equipamento cobrado só em alguns turnos (v1.9.276, 10/10/2026)
--
-- POR QUE: até aqui o equipamento era cobrado em todo turno ou, marcado como
-- "Só liga quando está em uso", em nenhum. A Bancada F.2 da CASA DOCE liga de
-- manhã e desliga à tarde (relato da RT, 06/10): nenhuma das duas opções
-- serve. Esta coluna guarda em quais turnos ele é cobrado.
--
-- O QUE FAZ: acrescenta UMA coluna, `turnos_cobrados`, na tabela de
-- equipamentos. Vazia (null) = cobrado em todos os turnos, que é como todo
-- equipamento já cadastrado continua. Não mexe em nenhuma regra de acesso
-- (RLS), não apaga nada, não altera nenhum equipamento.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente: pode rodar de novo sem efeito.
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 0: confirme que você está no projeto do NutriOPS.
-- Na barra de endereço do Supabase deve aparecer owuycuyfdngyjsumwgmy.
-- Se der erro dizendo que a tabela não existe, PARE: é o projeto errado.
select current_database() as banco,
       (select count(*) from public.equipment_catalog) as equipamentos_cadastrados;

alter table public.equipment_catalog
  add column if not exists turnos_cobrados jsonb;

comment on column public.equipment_catalog.turnos_cobrados is
  'Ids dos turnos em que o equipamento é cobrado (ex.: ["manha"]). null = todos os turnos. Turno que não existe mais é ignorado; sem nenhum válido, volta a cobrar em todos.';

-- CONFERÊNCIA: deve aparecer uma linha "turnos_cobrados | jsonb".
select column_name, data_type as tipo
  from information_schema.columns
 where table_schema = 'public' and table_name = 'equipment_catalog' and column_name = 'turnos_cobrados';
