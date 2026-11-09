-- ═══════════════════════════════════════════════════════════════════════════
-- Conferência: planilhas com código diferente em cada aparelho (09/11/2026)
-- SÓ LEITURA
--
-- POR QUE: a RT relatou que Higiene Pessoal e Vetores e Pragas do Terraço e
-- do PKS "não sincronizam no login dela, o histórico consta sem registros".
-- Causa: essas planilhas (e a Dedetização) ganhavam um código sorteado em
-- cada computador. O registro sobe com o código do computador da loja, e o
-- login da RT procura pelo código dela. A v1.9.285 dá um código fixo por loja
-- e leva o que já foi preenchido quando o computador da loja abre a versão.
--
-- COMO LER: uma linha por (loja, planilha, código). ANTES da correção chegar
-- nos computadores, a mesma planilha da mesma loja aparece com mais de um
-- código, e "tem_planilha_na_nuvem" vem "não" (a planilha só existia no
-- computador). DEPOIS que o computador da loja abrir a v1.9.285, cada loja
-- deve ficar com UM código por planilha. A coluna "tem_planilha_na_nuvem"
-- pode continuar "não": a planilha agora nasce igual em todo aparelho e não
-- precisa estar na nuvem.
--
-- Não altera, não apaga e não cria nada: é só SELECT.
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 0: confirme que você está no projeto do NutriOPS.
-- Na barra de endereço do Supabase deve aparecer owuycuyfdngyjsumwgmy.
select current_database() as banco;

-- PASSO 1: me mande a tabela inteira.
select coalesce(t.name, r.tenant_id)                     as loja,
       r.category                                        as planilha,
       r.form_id                                         as codigo,
       count(*)                                          as registros,
       min(r.period_key)                                 as primeiro_periodo,
       max(r.period_key)                                 as ultimo_periodo,
       case when exists (select 1 from public.form_templates ft where ft.id::text = r.form_id::text)
            then 'sim' else 'não' end                    as tem_planilha_na_nuvem
  from public.form_records r
  left join public.tenants t on t.id = r.tenant_id
 where r.category in ('higiene_pessoal', 'vetores_pragas', 'dedetizacao')
 group by 1, 2, 3
 order by 1, 2, 4 desc;
