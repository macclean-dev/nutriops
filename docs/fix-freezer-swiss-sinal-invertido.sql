-- ═══════════════════════════════════════════════════════════════════════════
-- CORREÇÃO: Freezer (Swiss) com leituras gravadas POSITIVAS
--
-- O QUE ACONTECEU: mesmo caso já visto na Bancada congelada F.2
-- (docs/fix-bancada-congelada-f2.sql) — o teclado do tablet não tinha tecla de
-- menos na época (bug corrigido no app na v1.9.126, com botão ± e o guard
-- "Faltou o sinal de menos?"). O dono confirmou (20/08): o Freezer nunca
-- esteve no positivo — foi limitação do teclado, não desvio real.
--
-- POR QUE NÃO É SÓ UM UPDATE: é evidência sanitária (RDC 216). A correção usa
-- as colunas de trilha que a tabela já tem (`original_value`,
-- `correction_reason`, `corrected_by`, `corrected_at`) — as MESMAS que a tela
-- de Auditoria exibe com o valor original riscado. Nenhuma leitura é apagada.
--
-- ⚠️ RODE UM PASSO DE CADA VEZ, conferindo o resultado. Não selecione trecho
--    antes de clicar Run (com seleção, o editor executa só o selecionado).
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 0 — corrige a faixa cadastrada do equipamento (catálogo, não a  ║
-- ║ leitura). Hoje está 12/null — sobra da migração dos grupos.           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

update public.equipment_catalog
   set min_temp = -21,
       max_temp = -18,
       updated_at = now()
 where tenant_id = 'swiss' and label = 'Freezer';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 1 — DIAGNÓSTICO. Só lê. Mostra cada leitura e o que aconteceria. ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

select tenant_id,
       equipment_input,
       created_at::date        as dia,
       value                   as valor_hoje,
       -value                  as viraria,
       min_value, max_value,
       user_name,
       case
         when value <= 0 then 'já negativo — NÃO tocar'
         when corrected_at is not null then 'já foi corrigido antes'
         when (-value) between min_value - 3 and max_value + 3
           then 'inverter faz sentido (negado cai na faixa)'
         else 'inverter NÃO recoloca na faixa — decisão sua'
       end as avaliacao
  from public.temperature_records
 where tenant_id = 'swiss'
   and (equipment_input ilike '%freezer%' or equipment_input ilike '%congela%'
        or equipment_key ilike '%freezer%' or equipment_key ilike '%congela%')
 order by created_at desc;

-- LEIA a coluna `avaliacao` antes de seguir:
--  · "já negativo" — essas ficam como estão, o passo 2 não as toca.
--  · "inverter faz sentido" — caso claro de sinal trocado.
--  · "inverter NÃO recoloca na faixa" — o passo 2 inverte essas TAMBÉM, porque
--    você confirmou que o Freezer nunca esteve no positivo — mas dá uma
--    olhada antes de seguir, pra garantir que não tem equipamento errado
--    misturado no filtro (ele pega qualquer coisa com "freezer"/"congela").
--
-- Se aparecer equipamento que NÃO é o Freezer da Swiss, PARE e me avise.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 2 — A CORREÇÃO. Só rode depois de conferir o passo 1.            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

update public.temperature_records
   set value             = -value,
       original_value    = coalesce(original_value, value),
       correction_reason = 'Correção de sinal: leituras do Freezer (Swiss) gravadas positivas porque o teclado do tablet não tinha tecla de menos na época (corrigido no app na v1.9.126). Confirmado pelo responsável que o equipamento nunca esteve no positivo.',
       corrected_by      = 'Correção de sinal — suporte NutriOPS',
       corrected_at      = now()
 where tenant_id = 'swiss'
   and (equipment_input ilike '%freezer%' or equipment_input ilike '%congela%'
        or equipment_key ilike '%freezer%' or equipment_key ilike '%congela%')
   and value > 0;                      -- as já negativas não são tocadas

-- O Supabase informa quantas linhas mudaram. Compare com a contagem de linhas
-- "valor_hoje > 0" que você viu no passo 1 — tem que bater exatamente.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 3 — CONFERÊNCIA.                                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 3a) Não pode sobrar nenhuma positiva.
select count(*) as ainda_positivas
  from public.temperature_records
 where tenant_id = 'swiss'
   and (equipment_input ilike '%freezer%' or equipment_input ilike '%congela%'
        or equipment_key ilike '%freezer%' or equipment_key ilike '%congela%')
   and value > 0;
-- esperado: 0

-- 3b) A trilha de auditoria ficou registrada?
select created_at::date as dia,
       original_value   as era,
       value            as virou,
       min_value, max_value,
       corrected_by, corrected_at::date as corrigido_em
  from public.temperature_records
 where tenant_id = 'swiss'
   and corrected_by = 'Correção de sinal — suporte NutriOPS'
   and (equipment_input ilike '%freezer%' or equipment_input ilike '%congela%'
        or equipment_key ilike '%freezer%' or equipment_key ilike '%congela%')
 order by created_at desc;
-- Cada linha deve mostrar `era` positivo e `virou` negativo, dentro (ou perto)
-- da faixa -21/-18. É isso que a tela de Auditoria vai exibir com o valor
-- original riscado.

-- Os aparelhos pegam a correção sozinhos no próximo carregamento: o merge do
-- app (mergeByKey, repository.js) desempata pela data e o registro da nuvem
-- vence o cache local — não precisa limpar nada no tablet.
