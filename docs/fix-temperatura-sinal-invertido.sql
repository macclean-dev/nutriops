-- ═══════════════════════════════════════════════════════════════════════════
-- CORREÇÃO: temperaturas de congelados gravadas POSITIVAS (sinal invertido)
--
-- O QUE ACONTECEU (14/08): a nutricionista da CASA DOCE registrava -18°C num
-- freezer e o sistema gravava +18°C. Causa: os campos de temperatura usavam
-- `inputMode="decimal"`, que NÃO oferece tecla de menos no teclado de
-- celular/tablet (confirmado em foto: teclado Android só com 0-9, ponto e
-- "Próximo"). Era fisicamente impossível digitar o negativo. O único guard
-- era um window.confirm genérico, dispensado no reflexo.
-- Corrigido no app na v1.9.126 (botão ± + bloqueio "Faltou o sinal de menos?").
--
-- POR QUE NÃO É SÓ UM UPDATE: este é um sistema de evidência sanitária
-- (RDC 216). Sobrescrever leitura em silêncio destrói exatamente a trilha de
-- auditoria que o produto existe pra garantir. Por isso a correção usa as
-- colunas de trilha que a tabela já tem (`original_value`, `correction_reason`,
-- `corrected_by`, `corrected_at`) — as MESMAS que a tela de Auditoria já exibe
-- com o valor original riscado. A fiscalização vê o que foi corrigido e por quê.
--
-- SEGURANÇA DO CRITÉRIO: só inverte quando inverter FAZ SENTIDO.
--   · o equipamento não aceita positivo (max_value < 0);
--   · o valor como está hoje está fora de faixa;
--   · o mesmo valor NEGADO cai dentro (ou na tolerância de 3°C) da faixa.
-- Um freezer realmente quebrado a +5°C (faixa -25/-18) NÃO é tocado: -5
-- continuaria fora de faixa, então não é erro de sinal — é desvio real, e
-- desvio real tem que continuar no histórico.
--
-- ⚠️ RODE OS PASSOS UM DE CADA VEZ, conferindo o resultado antes do próximo.
--    Não selecione trecho nenhum antes de clicar Run (com texto selecionado o
--    SQL Editor executa só a seleção).
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 1 — DIAGNÓSTICO. Só lê. Mostra exatamente o que seria corrigido. ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

select tenant_id,
       equipment_input,
       count(*)                as leituras_afetadas,
       min(created_at)::date   as da_data,
       max(created_at)::date   as ate_data,
       string_agg(distinct value::text, ', ' order by value::text) as valores_hoje,
       min(min_value)          as faixa_min,
       max(max_value)          as faixa_max
  from public.temperature_records
 where value > 0
   and min_value is not null and max_value is not null
   and max_value < 0                                    -- equipamento de congelamento
   and (value < min_value - 3 or value > max_value + 3) -- hoje está fora de faixa
   and (-value) >= min_value - 3                        -- negado, passa a fazer sentido
   and (-value) <= max_value + 3
 group by tenant_id, equipment_input
 order by tenant_id, equipment_input;

-- Confira: os valores em `valores_hoje` devem ser positivos e bater com a
-- faixa se você puser um menos na frente (ex.: faixa -22/-18 e valores 18, 22).
-- Se aparecer algum equipamento que você NÃO reconhece como congelador, PARE.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 2 — A CORREÇÃO. Inverte o sinal preservando a trilha.           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

update public.temperature_records
   set value             = -value,
       -- coalesce: se a leitura JÁ tinha sido corrigida antes, preserva o
       -- primeiro valor original em vez de sobrescrever com o intermediário.
       original_value    = coalesce(original_value, value),
       correction_reason = 'Correção de sinal: leitura de congelados gravada positiva por falta da tecla de menos no teclado do tablet (bug corrigido na v1.9.126).',
       corrected_by      = 'Correção automática — suporte NutriOPS',
       corrected_at      = now()
 where value > 0
   and min_value is not null and max_value is not null
   and max_value < 0
   and (value < min_value - 3 or value > max_value + 3)
   and (-value) >= min_value - 3
   and (-value) <= max_value + 3;

-- O Supabase informa quantas linhas foram atualizadas. Compare com a soma de
-- `leituras_afetadas` do Passo 1 — tem que bater exatamente.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 3 — CONFERÊNCIA. Deve voltar ZERO linhas.                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

select count(*) as ainda_com_sinal_invertido
  from public.temperature_records
 where value > 0
   and min_value is not null and max_value is not null
   and max_value < 0
   and (value < min_value - 3 or value > max_value + 3)
   and (-value) >= min_value - 3
   and (-value) <= max_value + 3;
-- esperado: 0

-- E o que foi corrigido, pra conferir a olho:
select created_at::date as dia, equipment_input,
       original_value as era, value as virou, corrected_at
  from public.temperature_records
 where corrected_by = 'Correção automática — suporte NutriOPS'
 order by created_at desc
 limit 50;

-- Os aparelhos pegam a correção sozinhos no próximo carregamento: o merge do
-- app (mergeByKey, repository.js) desempata pela data e o registro da nuvem
-- vence o cache local — não precisa limpar nada no tablet dela.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 4 — O QUE SOBROU. Toda leitura POSITIVA em equipamento de       ║
-- ║ congelamento, corrigida ou não. O Passo 2 é conservador de propósito  ║
-- ║ (só inverte quando inverter conserta), então aqui aparece o que ficou ║
-- ║ de fora e precisa de decisão humana: ou é desvio real (freezer que    ║
-- ║ de fato esquentou) ou é digitação errada de outro tipo.               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

select tenant_id,
       equipment_input,
       created_at::date as dia,
       value,
       min_value, max_value,
       user_name,
       note,
       case when corrected_at is not null then 'já corrigido no passo 2'
            else '⚠ NÃO corrigido — revisar' end as status
  from public.temperature_records
 where max_value < 0        -- só equipamento que nunca deveria ler positivo
   and value > 0
 order by created_at desc;

-- Linhas "⚠ NÃO corrigido — revisar": confira uma a uma com a nutricionista.
-- Se for erro de digitação de outra natureza (ex.: 5°C que era -25°C), a
-- correção certa é pelo app — tela de Auditoria, botão de corrigir registro,
-- que já pede motivo e guarda o valor original. Não corrija essas no SQL:
-- pelo app a trilha sai com o nome de quem corrigiu, não "suporte NutriOPS".
