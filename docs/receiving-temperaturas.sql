-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · Temperatura por tipo de produto no Recebimento (v1.9.269, 06/10)
--
-- POR QUE: pedido da RT da CASA DOCE (06/10). Na matriz, o recebimento passa a
-- registrar várias temperaturas, cada uma com o tipo de produto (congelado,
-- pescado resfriado, carne resfriada, demais refrigerados) e a avaliação
-- contra a faixa de referência. RDC 216 4.7.3: "a temperatura das matérias-
-- primas e ingredientes que necessitem de condições especiais de conservação
-- deve ser verificada nas etapas de recepção".
--
-- O QUE FAZ: acrescenta UMA coluna jsonb (`temperaturas`) em receiving_records.
-- Aditivo: nenhuma coluna sai, nenhum registro muda, e as regras de acesso
-- (RLS) da tabela continuam as mesmas. O app só manda essa coluna quando o
-- registro tem temperatura por tipo, então as outras lojas nem a usam.
--
-- Idempotente: rodar duas vezes dá o mesmo resultado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PASSO 0 · Confirmar o projeto ───────────────────────────────────────────
-- Tem que devolver 1 linha com o total de recebimentos. Se der erro
-- ("relation does not exist"), PARE: você está no projeto errado.
select current_database(), (select count(*) from public.receiving_records) as recebimentos;

-- ── PASSO 1 · A coluna nova ─────────────────────────────────────────────────
alter table public.receiving_records add column if not exists temperaturas jsonb;

-- ── PASSO 2 · Conferência ───────────────────────────────────────────────────
-- Tem que devolver tipo = jsonb. Se vier vazio, o PASSO 1 não rodou (o editor
-- às vezes roda só o trecho selecionado): rode o arquivo inteiro de novo.
select column_name, data_type as tipo
from information_schema.columns
where table_schema = 'public' and table_name = 'receiving_records' and column_name = 'temperaturas';
