-- ═══════════════════════════════════════════════════════════════════════════
-- Consulta de uso das lojas (10/10/2026) - SÓ LEITURA
--
-- POR QUE: a análise de produto de 10/10 apontou que quase todo pedido vem da
-- CASA DOCE, e que DBK e Bäckerei aparecem paradas. Cliente que não aparece
-- pode estar satisfeito ou pode ter parado de usar: só o banco responde.
--
-- O QUE FAZ: para cada loja, mostra a data do último registro, há quantos
-- dias ela não registra nada e quantos registros fez nos últimos 30 dias
-- (temperatura, planilha, recebimento e controles especiais).
-- Não altera, não apaga e não cria nada: é só um SELECT.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 0: confirme que você está no projeto do NutriOPS.
-- Na barra de endereço do Supabase deve aparecer owuycuyfdngyjsumwgmy.
-- Se der erro dizendo que a tabela não existe, PARE: é o projeto errado.
select current_database() as banco,
       (select count(*) from public.temperature_records) as leituras_de_temperatura;

-- PASSO 1: uso por loja. A loja que nunca registrou nada aparece com
-- "ultimo_registro" vazio.
with lojas as (
  select id, name from public.tenants
  union
  select * from (values ('swiss', 'Swiss'), ('backerei', 'Bäckerei'), ('dbk-producao', 'DBK Produção')) as seed(id, name)
),
eventos as (
  select tenant_id, created_at as quando, 'temperatura' as tipo from public.temperature_records
  union all
  select tenant_id, coalesce(updated_at, created_at), 'planilha' from public.form_records
  union all
  select tenant_id, created_at, 'recebimento' from public.receiving_records
  union all
  select tenant_id, created_at, 'controle' from public.special_controls
)
select
  l.name                                                                        as loja,
  l.id                                                                          as tenant_id,
  max(e.quando)::date                                                           as ultimo_registro,
  current_date - max(e.quando)::date                                            as dias_sem_registro,
  count(e.quando) filter (where e.quando > now() - interval '30 days')                              as registros_30_dias,
  count(e.quando) filter (where e.tipo = 'temperatura' and e.quando > now() - interval '30 days')   as temperatura_30d,
  count(e.quando) filter (where e.tipo = 'planilha'    and e.quando > now() - interval '30 days')   as planilhas_30d,
  count(e.quando) filter (where e.tipo = 'recebimento' and e.quando > now() - interval '30 days')   as recebimento_30d,
  count(e.quando) filter (where e.tipo = 'controle'    and e.quando > now() - interval '30 days')   as controles_30d
from lojas l
left join eventos e on e.tenant_id = l.id
where l.id <> '__healthcheck__'
group by l.name, l.id
order by dias_sem_registro desc nulls first, loja;
