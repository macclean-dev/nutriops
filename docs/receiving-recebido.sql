-- ═══════════════════════════════════════════════════════════════════════════
-- Coluna "recebido" em receiving_records - carimbo de quando a entrega
-- chegou e quem recebeu
--
-- POR QUE: resposta da nutricionista (22/09) sobre o Recebimento
-- simplificado: "na data de validade pode adicionar data e horário de
-- recebimento? Da mesma forma dos outros onde clicamos em 'Feito agora' já
-- aparece a data do dia e a aba pra colocar o nome do responsável."
--
-- É o mesmo carimbo de 1 toque que as planilhas de higienização já usam
-- (date_sig/quickSign): "✓ Feito agora" grava a data de hoje + quem está
-- preenchendo, sem digitar nada; "Outra pessoa / outro dia" abre pra
-- preenchimento retroativo. jsonb porque o valor já nasce um objeto pequeno
-- ({date, sig}) - igual "checks", que já era jsonb nesta mesma tabela.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente: pode rodar de novo sem efeito.
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ ANTES DE QUALQUER COISA: confirme que você está no projeto do NutriOPS.
-- Se der erro dizendo que a tabela não existe, PARE - é o projeto errado.
select current_database() as banco,
       (select count(*) from public.receiving_records) as recebimentos_ja_registrados;


alter table public.receiving_records
  add column if not exists recebido jsonb;

comment on column public.receiving_records.recebido is
  'Carimbo de 1 toque de quando a entrega chegou e quem recebeu: { date: "YYYY-MM-DD", sig: "Nome" }. Campo novo desde 22/09, opcional - registro anterior não tem valor aqui.';


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA - rode depois; tem que voltar 1 linha
-- ═══════════════════════════════════════════════════════════════════════════
-- select a.attname as coluna, format_type(a.atttypid, a.atttypmod) as tipo
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
--  where n.nspname = 'public' and c.relname = 'receiving_records'
--    and a.attname = 'recebido';
