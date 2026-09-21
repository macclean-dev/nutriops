-- ═══════════════════════════════════════════════════════════════════════════
-- Coluna "hora" em receiving_records — planilha de Recebimento simplificada
--
-- POR QUE: a nutricionista da CASA DOCE pediu (21/09) uma planilha de
-- recebimento mais simples e prática — só Data de validade, Hora, Produto,
-- Temperatura, 3 verificações C/NC (embalagem, rotulagem, aparência) e o
-- resultado (Aceito/Rejeitado/Aceito parcial). Fornecedor, NF, Quantidade e
-- Forma de conservação saíram do formulário; a mudança é global (vale pras
-- mesmas lojas que já usam esta tela: Swiss, Bäckerei, DBK e a família CASA
-- DOCE), não é personalização por loja.
--
-- Fornecedor/NF/Quantidade/Conservação continuam existindo no banco — não
-- apaga coluna nem registro antigo, só o formulário deixou de pedir esses
-- campos daqui pra frente. "Hora" é o único campo de verdade NOVO: a data
-- de validade e o produto já existiam.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente: pode rodar de novo sem efeito.
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ ANTES DE QUALQUER COISA: confirme que você está no projeto do NutriOPS.
-- Se der erro dizendo que a tabela não existe, PARE — é o projeto errado.
select current_database() as banco,
       (select count(*) from public.receiving_records) as recebimentos_ja_registrados;


alter table public.receiving_records
  add column if not exists hora text;

comment on column public.receiving_records.hora is
  'Horário da chegada da mercadoria, anotado por quem registrou (não é o horário em que preencheu a tela — pode ser diferente se o registro foi feito com atraso). Campo novo desde 21/09; registro anterior não tem valor aqui.';


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rode depois; tem que voltar 1 linha
-- ═══════════════════════════════════════════════════════════════════════════
-- select a.attname as coluna, format_type(a.atttypid, a.atttypmod) as tipo
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
--  where n.nspname = 'public' and c.relname = 'receiving_records'
--    and a.attname = 'hora';
