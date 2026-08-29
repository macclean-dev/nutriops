-- ═══════════════════════════════════════════════════════════════════════════
-- "Só opera aqui" — separar o controle de ASO quando a operação tem 2 CNPJs
--
-- POR QUE: a CASA DOCE opera com dois CNPJs no mesmo endereço (CASA DOCE e
-- Fabrizzio Matriz). Os equipamentos estão TODOS cadastrados na CASA DOCE,
-- mas 15 pessoas que aferem temperatura lá são contratadas pela Fabrizzio.
--
-- Sem esta coluna, a RT ficava entre dois erros:
--   · não cadastrar essas pessoas na CASA DOCE → elas não achavam o próprio
--     nome na hora de aferir, e o registro saía com nome digitado à mão;
--   · cadastrar → todas apareciam no controle de ASO da CASA DOCE, misturando
--     o exame de saúde das duas empresas. Ela chegou a fazer isso num sábado
--     e teve que desfazer.
--
-- O ASO segue o VÍNCULO EMPREGATÍCIO (PCMSO/NR-7), não o endereço onde a
-- pessoa opera. Já a capacitação segue o estabelecimento (RDC 216 §4.6) — por
-- isso esta marca afeta SÓ o ASO, e quem está marcado continua sendo cobrado
-- de treinamento normalmente.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente: pode rodar de novo sem efeito.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tenant_staff
  add column if not exists aso_externo boolean not null default false;

-- `default false` + `not null` de propósito: toda linha que já existe vira
-- "controlo o ASO aqui", que é o comportamento de sempre. A marca é opt-in,
-- pessoa a pessoa, feita na tela — ninguém sai do controle de saúde por
-- omissão nem por migração.

comment on column public.tenant_staff.aso_externo is
  'true = pessoa opera nesta loja mas o ASO dela é controlado por outra empresa do grupo (outro CNPJ). Fica fora de teamAsoSummary desta loja; continua no seletor de operador e na capacitação.';


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rode depois e confira que voltou 1 linha com aso_externo
-- ═══════════════════════════════════════════════════════════════════════════
-- select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'tenant_staff'
--    and column_name = 'aso_externo';

-- Quem está marcado, por empresa (deve vir vazio logo após a migração):
-- select coalesce(t.name, s.tenant_id) as empresa, s.name, s.aso_externo
--   from public.tenant_staff s
--   left join public.tenants t on t.id = s.tenant_id
--  where s.aso_externo
--  order by 1, 2;
