-- ═══════════════════════════════════════════════════════════════════════════
-- Etiquetas de abertura (substituto do Suflex) — v1.9.99
--
-- O QUE FAZ: adiciona 3 colunas na tabela `products` pra registrar a ABERTURA
-- de um produto (ex.: saco de açúcar aberto): quando abriu, até quando vale
-- depois de aberto, e quem abriu. O app calcula a validade pós-abertura pela
-- regra da categoria e grava o resultado aqui — assim qualquer device da loja
-- vê a mesma validade.
--
-- SEGURO: só ADICIONA colunas (nada é alterado nem apagado). Rodar ANTES do
-- próximo deploy — sem as colunas, o push de produtos passa a falhar (fica na
-- fila offline até o SQL rodar, nada se perde, mas não sobe).
--
-- COMO RODAR: Supabase → SQL Editor → colar TUDO → Run (sem selecionar trecho).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products add column if not exists opened_at    timestamptz;
alter table public.products add column if not exists opened_until timestamptz;
alter table public.products add column if not exists opened_by    text;

-- Conferência: as 3 colunas devem aparecer.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'products'
   and column_name in ('opened_at', 'opened_until', 'opened_by')
 order by column_name;
-- esperado: 3 linhas (opened_at, opened_by, opened_until)
