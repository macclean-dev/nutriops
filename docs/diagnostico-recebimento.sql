-- ═══════════════════════════════════════════════════════════════════════════
-- Diagnóstico do recebimento (11/10/2026) - SÓ LEITURA
--
-- POR QUE: a nuvem tem só 2 recebimentos, o último de 04/06. Nenhuma loja da
-- CASA DOCE (que começou em agosto) jamais conseguiu enviar um, embora a tela
-- envie todo registro (pushReceivingRecord, pages.jsx). Então o banco está
-- recusando. As duas causas possíveis:
--   (a) a tabela no banco é diferente da que o app espera: alguma coluna que
--       o app manda não existe, ou existe uma coluna OBRIGATÓRIA que o app
--       não manda;
--   (b) a regra de acesso (RLS) da tabela não reconhece quem entra pela CASA
--       DOCE (vínculo), como aconteceu com a temperatura em 16/08.
-- Esta consulta mostra as duas coisas numa tabela só.
--
-- Não altera, não apaga e não cria nada: é só SELECT.
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 0: confirme que você está no projeto do NutriOPS.
-- Na barra de endereço do Supabase deve aparecer owuycuyfdngyjsumwgmy.
select current_database() as banco,
       (select count(*) from public.receiving_records) as recebimentos_na_nuvem;

-- PASSO 1: o diagnóstico. Copie e me mande a tabela inteira.
select 'coluna' as o_que,
       column_name as nome,
       data_type as detalhe,
       case when is_nullable = 'NO' and column_default is null then 'OBRIGATÓRIA sem padrão' else '' end as atencao
  from information_schema.columns
 where table_schema = 'public' and table_name = 'receiving_records'
union all
select 'regra de acesso',
       policyname,
       cmd,
       case when coalesce(qual, '') like '%is_member%' and coalesce(qual, '') like '%is_admin_plataforma%'
            then 'ok' else 'FALTA O CAMINHO DO VÍNCULO' end
  from pg_policies
 where schemaname = 'public' and tablename = 'receiving_records'
union all
select 'rls ligado',
       'receiving_records',
       case when c.relrowsecurity then 'sim' else 'não' end,
       ''
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'receiving_records'
order by 1, 2;
