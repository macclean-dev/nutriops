-- ═══════════════════════════════════════════════════════════════════════════
-- AÇÕES CORRETIVAS: 3 desvios reais do Freezer (Swiss)
--
-- POR QUE: depois de corrigir o sinal invertido das leituras
-- (docs/fix-freezer-swiss-sinal-invertido.sql), 3 das 4 leituras continuaram
-- MUITO fora da faixa (-21/-18) mesmo já negativas:
--     04/06 → -0,19°C · 11/07 → -3°C · 29/07 → -2°C
-- Ou seja: não era só erro de digitação — o freezer realmente não estava
-- congelando nessas datas. A RDC 216 exige ação corretiva registrada pra cada
-- desvio; sem isso o check A1 da Prontidão fica pendente pra sempre.
--
-- Mesma conclusão que já valeu pra Bancada congelada F.2 da CASA DOCE.
--
-- O QUE ESTE SCRIPT FAZ: cria uma ação corretiva por leitura desviante,
-- ligada ao registro de origem (`source_id`), com status 'aberta' — pra que a
-- nutricionista preencha a apuração e a resolução na Central de Não
-- Conformidades. NÃO altera nenhuma leitura.
--
-- ⚠️ RODE UM PASSO DE CADA VEZ, conferindo o resultado. Não selecione trecho
--    antes de clicar Run (com seleção, o editor executa só o selecionado).
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 1 — DIAGNÓSTICO. Só lê. Confirma QUAIS leituras vão gerar ação.  ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

select id,
       created_at::date as dia,
       original_value   as gravado_era,
       value            as valor_corrigido,
       min_value, max_value,
       user_name,
       case when exists (
              select 1 from public.corrective_actions ca
               where ca.tenant_id = 'swiss' and ca.source_id = tr.id::text
            ) then 'JÁ TEM ação — não duplicar'
            else 'vai gerar ação'
       end as situacao
  from public.temperature_records tr
 where tenant_id = 'swiss'
   and (equipment_input ilike '%freezer%' or equipment_key ilike '%freezer%')
   and value > -18                      -- acima do teto = não estava congelando
 order by created_at desc;

-- ESPERADO: 3 linhas (04/06, 11/07, 29/07), todas "vai gerar ação".
-- A de 11/08 (-18°C) NÃO deve aparecer — ela ficou dentro da faixa.
-- Se aparecer número diferente de 3, PARE e me avise antes do passo 2.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 2 — CRIA AS AÇÕES. Só rode depois de conferir o passo 1.        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

insert into public.corrective_actions
  (id, tenant_id, source, source_id, source_label, source_detail,
   description, responsible, status, created_at, updated_at)
select gen_random_uuid(),
       'swiss',
       'temperature',
       tr.id::text,
       'Freezer',
       tr.value || '°C · faixa ' || tr.min_value || ' a ' || tr.max_value || '°C · leitura de ' || to_char(tr.created_at, 'DD/MM/YYYY'),
       'Desvio de temperatura no Freezer: leitura de ' || tr.value || '°C, muito acima do teto de -18°C. '
         || 'Identificado em 21/08/2026, ao corrigir o sinal das leituras gravadas positivas '
         || '(o teclado do tablet não tinha tecla de menos na época — corrigido no app na v1.9.126). '
         || 'O desvio estava escondido atrás do sinal errado. '
         || 'APURAR: o que causou (porta aberta, degelo, falha do compressor, sobrecarga), '
         || 'qual o destino dado aos alimentos armazenados, e o que foi feito pra normalizar.',
       null,
       'aberta',
       now(),
       now()
  from public.temperature_records tr
 where tr.tenant_id = 'swiss'
   and (tr.equipment_input ilike '%freezer%' or tr.equipment_key ilike '%freezer%')
   and tr.value > -18
   and not exists (                    -- idempotente: rodar de novo não duplica
         select 1 from public.corrective_actions ca
          where ca.tenant_id = 'swiss' and ca.source_id = tr.id::text
       );

-- O Supabase informa quantas linhas inseriu. Tem que ser 3.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 3 — CONFERÊNCIA.                                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

select created_at::date as criada_em,
       source_label     as equipamento,
       source_detail    as contexto,
       status,
       responsible      as responsavel
  from public.corrective_actions
 where tenant_id = 'swiss' and source_label = 'Freezer'
 order by source_detail;
-- Esperado: 3 linhas, todas status 'aberta'.

-- As 3 aparecem na Central de Não Conformidades no próximo carregamento do
-- app. A nutricionista preenche responsável, prazo e resolução por lá — quando
-- as 3 forem resolvidas, o check A1 da Prontidão fecha.
