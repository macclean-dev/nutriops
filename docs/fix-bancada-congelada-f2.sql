-- ═══════════════════════════════════════════════════════════════════════════
-- CORREÇÃO: "Bancada congelada — F.2" com leituras gravadas POSITIVAS
--
-- O QUE ACONTECEU: as leituras desse equipamento eram todas negativas, mas o
-- teclado do tablet não tinha tecla de menos na época (bug corrigido no app na
-- v1.9.126, com botão ± e o guard "Faltou o sinal de menos?"). O histórico
-- ficou com os valores invertidos.
--
-- POR QUE NÃO É SÓ UM UPDATE: é evidência sanitária (RDC 216). Sobrescrever
-- leitura em silêncio destrói a trilha de auditoria que o produto existe pra
-- garantir. A correção usa as colunas de trilha que a tabela já tem
-- (`original_value`, `correction_reason`, `corrected_by`, `corrected_at`) — as
-- MESMAS que a tela de Auditoria exibe com o valor original riscado.
--
-- ⚠️ DIFERENÇA EM RELAÇÃO AO docs/fix-temperatura-sinal-invertido.sql:
-- aquele é conservador de propósito — só inverte quando o valor NEGADO cai na
-- faixa. Com a faixa da F.2 (-18/-12, tolerância de 3° ⇒ -21 a -9), uma leitura
-- gravada como "5" viraria -5, que continua FORA — então o script genérico a
-- deixa de lado, corretamente, porque não sabe se é erro de sinal ou desvio
-- real. Este script é focado nesse equipamento e conta com uma informação que
-- só o dono tem: "todos os números registrados eram negativos".
--
-- Por isso o PASSO 1 lista TUDO antes, e a decisão de rodar o PASSO 2 é sua.
--
-- ⚠️ RODE UM PASSO DE CADA VEZ, conferindo o resultado. Não selecione trecho
--    antes de clicar Run (com seleção, o editor executa só o selecionado).
-- ═══════════════════════════════════════════════════════════════════════════


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
 where equipment_input ilike '%bancada congelada%f.2%'
 order by created_at desc;

-- LEIA a coluna `avaliacao` antes de seguir:
--  · "já negativo" — essas ficam como estão, o passo 2 não as toca.
--  · "inverter faz sentido" — caso claro de sinal trocado.
--  · "inverter NÃO recoloca na faixa" — ex.: 5 viraria -5, ainda fora de
--    -18/-12. Pode ser leitura real de bancada esquentando OU digitação de
--    outro tipo. O passo 2 inverte essas TAMBÉM, porque você disse que todas
--    eram negativas — mas confira uma a uma antes, com a nutricionista.
--
-- Se aparecer equipamento que NÃO é a F.2 (o filtro é por nome), PARE e me avise.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 2 — A CORREÇÃO. Só rode depois de conferir o passo 1.            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

update public.temperature_records
   set value             = -value,
       -- coalesce: se a leitura já tinha sido corrigida antes, preserva o
       -- PRIMEIRO valor original em vez de sobrescrever com o intermediário.
       original_value    = coalesce(original_value, value),
       correction_reason = 'Correção de sinal: leituras da Bancada congelada F.2 gravadas positivas porque o teclado do tablet não tinha tecla de menos na época (corrigido no app na v1.9.126). Confirmado pelo responsável que todas as leituras do equipamento eram negativas.',
       corrected_by      = 'Correção de sinal — suporte NutriOPS',
       corrected_at      = now()
 where equipment_input ilike '%bancada congelada%f.2%'
   and value > 0;                      -- as já negativas não são tocadas

-- O Supabase informa quantas linhas mudaram. Compare com a contagem de linhas
-- "valor_hoje > 0" que você viu no passo 1 — tem que bater exatamente.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 3 — CONFERÊNCIA.                                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 3a) Não pode sobrar nenhuma positiva nesse equipamento.
select count(*) as ainda_positivas
  from public.temperature_records
 where equipment_input ilike '%bancada congelada%f.2%'
   and value > 0;
-- esperado: 0

-- 3b) A trilha de auditoria ficou registrada?
select created_at::date as dia,
       original_value   as era,
       value            as virou,
       min_value, max_value,
       corrected_by, corrected_at::date as corrigido_em
  from public.temperature_records
 where equipment_input ilike '%bancada congelada%f.2%'
   and corrected_by = 'Correção de sinal — suporte NutriOPS'
 order by created_at desc;
-- Cada linha deve mostrar `era` positivo e `virou` negativo, dentro (ou perto)
-- da faixa. É isso que a tela de Auditoria vai exibir com o valor riscado.

-- Os aparelhos pegam a correção sozinhos no próximo carregamento: o merge do
-- app (mergeByKey, repository.js) desempata pela data e o registro da nuvem
-- vence o cache local — não precisa limpar nada no tablet.
