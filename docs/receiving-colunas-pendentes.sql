-- ═══════════════════════════════════════════════════════════════════════════
-- Recebimento sem nenhum registro na nuvem: diagnóstico + correção (11/10/2026)
--
-- POR QUE: a consulta de uso de 11/10 mostrou recebimento_30d = 0 em TODAS as
-- lojas, inclusive na CASA DOCE matriz, que registra recebimento (a RT
-- relatou em 09/10 que ele "só consta no computador que está fazendo o
-- registro"). O app manda quatro colunas que nasceram depois da tabela:
--   · conservacao (docs/receiving-conservacao.sql)
--   · hora        (docs/receiving-hora.sql, 21/09)
--   · recebido    (docs/receiving-recebido.sql, 21/09)
--   · temperaturas (docs/receiving-temperaturas.sql, rodado em 06/10)
-- Se uma delas não existe no banco, TODO recebimento é recusado pela nuvem e
-- fica preso na fila do aparelho que registrou. É exatamente o sintoma.
--
-- O QUE FAZ:
--   1. Anota quais dessas colunas existem AGORA (antes de mexer).
--   2. Cria as que faltarem. `add column if not exists`: a que já existe não
--      é tocada. Não apaga nada, não altera nenhum registro, não mexe em
--      regra de acesso (RLS).
--   3. Mostra, coluna a coluna, se ela já existia ou foi criada agora, e
--      quantos recebimentos a nuvem tem.
-- Depois disso, os recebimentos presos nos aparelhos sobem sozinhos em até
-- 2 minutos (com o app aberto e com internet).
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente: pode rodar de novo sem efeito.
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 0: confirme que você está no projeto do NutriOPS.
-- Na barra de endereço do Supabase deve aparecer owuycuyfdngyjsumwgmy.
-- Se der erro dizendo que a tabela não existe, PARE: é o projeto errado.
select current_database() as banco,
       (select count(*) from public.receiving_records) as recebimentos_na_nuvem;

-- PASSO 1: o retrato de antes.
create temp table colunas_antes as
  select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'receiving_records'
     and column_name in ('conservacao', 'hora', 'recebido', 'temperaturas');

-- PASSO 2: cria só o que falta.
alter table public.receiving_records add column if not exists conservacao text;
alter table public.receiving_records add column if not exists hora text;
alter table public.receiving_records add column if not exists recebido jsonb;
alter table public.receiving_records add column if not exists temperaturas jsonb;

-- PASSO 3: o resultado. Copie e me mande esta tabela.
select c.coluna,
       case when a.column_name is not null then 'já existia' else 'CRIADA AGORA' end as situacao,
       (select count(*) from public.receiving_records) as recebimentos_na_nuvem,
       (select max(created_at)::date from public.receiving_records) as ultimo_recebimento_na_nuvem
  from (values ('conservacao'), ('hora'), ('recebido'), ('temperaturas')) as c(coluna)
  left join colunas_antes a on a.column_name = c.coluna
 order by c.coluna;
