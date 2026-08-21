-- ═══════════════════════════════════════════════════════════════════════════
-- Leituras órfãs por RENOMEAÇÃO de equipamento
--
-- O QUE ACONTECEU: renomear um equipamento no app não mexe nas leituras já
-- gravadas — elas guardam o nome ANTIGO em equipment_key/equipment_input, e
-- nem devem ser reescritas (é evidência sanitária, RDC 216). Até a v1.9.196 o
-- app não guardava o nome velho como apelido e as telas casavam
-- leitura↔equipamento por nome EXATO. Resultado: no instante do rename, todo
-- o histórico sumia do card e o equipamento passava a mostrar "sem leitura".
--
-- Caso que revelou (CASA DOCE, 21/08): o catálogo tinha
-- "Banho-maria (Refeitório) — BM.1" marcado como NUNCA medido, enquanto
-- existia leitura de 78° gravada no MESMO dia sob "Banho-maria — BM.1".
--
-- O empurrão veio da própria tela: o bloqueio de nome duplicado sugere "use um
-- nome que os diferencie (ex.: 'X — Padaria')". Quem seguiu o conselho zerou o
-- equipamento.
--
-- A v1.9.196 corrige os dois lados no código (o rename passa a guardar o nome
-- antigo em `aliases`; as telas passam a casar por apelido). Este SQL conserta
-- o que JÁ ficou órfão antes disso — sem tocar em nenhuma leitura.
--
-- ⚠️ RODE UM PASSO DE CADA VEZ. Nenhum passo apaga leitura.
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 1 — DIAGNÓSTICO. Só lê. Nomes de leitura que não batem com nada. ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- Para cada nome que aparece nas leituras, checa se existe entrada no catálogo
-- com esse label OU com esse apelido. O que sobrar é órfão: ou é rename sem
-- apelido, ou é equipamento que nunca foi cadastrado.
with nomes as (
  select tenant_id,
         equipment_key as nome,
         count(*)              as leituras,
         min(created_at)::date as primeira,
         max(created_at)::date as ultima
    from public.temperature_records
   where tenant_id <> '__healthcheck__'
   group by tenant_id, equipment_key
)
select n.tenant_id, n.nome, n.leituras, n.primeira, n.ultima
  from nomes n
 where not exists (
   select 1 from public.equipment_catalog c
    where c.tenant_id = n.tenant_id
      and (lower(c.label) = lower(n.nome)
           or exists (
             select 1
               from jsonb_array_elements_text(
                      case when jsonb_typeof(c.aliases) = 'array' then c.aliases else '[]'::jsonb end
                    ) a(alias)
              where lower(a.alias) = lower(n.nome)))
 )
 order by n.tenant_id, n.leituras desc;

-- COMO LER:
--  · nome parecido com um do catálogo (só mudou um pedaço) → foi RENAME.
--    O conserto é o passo 2: devolver o nome antigo pra `aliases`.
--  · nome que não lembra nenhum equipamento cadastrado → nunca foi
--    cadastrado. Aí o certo é criar a entrada no catálogo (como fizemos com o
--    Cervejeiro da Swiss), não inventar apelido.
--  · vazio aqui = nenhuma leitura órfã. Nada a fazer.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 2 — RELIGAR. Um comando por par (equipamento atual ← nome velho). ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- Acrescenta o nome antigo aos apelidos SEM apagar os que já existem, e sem
-- duplicar se já estiver lá. Troque os três valores e repita por par.
--
-- Exemplo real da CASA DOCE (o Banho-maria):
--
-- update public.equipment_catalog
--    set aliases = (
--          select jsonb_agg(distinct valor)
--            from (
--              select jsonb_array_elements_text(
--                       case when jsonb_typeof(aliases) = 'array' then aliases else '[]'::jsonb end
--                     ) as valor
--              union
--              select 'Banho-maria — BM.1'            -- ← NOME ANTIGO (o das leituras)
--            ) t
--        ),
--        updated_at = now()
--  where tenant_id = 'bf245c3b-2f9'                   -- ← empresa
--    and label     = 'Banho-maria (Refeitório) — BM.1';  -- ← NOME ATUAL (o do catálogo)


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 3 — CONFERÊNCIA. Rode o PASSO 1 de novo.                         ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- Cada par religado no passo 2 deve ter sumido da lista. O que continuar
-- aparecendo é equipamento sem cadastro — decisão separada.

-- Os aparelhos pegam o catálogo novo no próximo sync. Nenhuma leitura foi
-- tocada: o histórico volta a aparecer porque o app passa a reconhecer o nome
-- antigo, não porque o dado mudou.
