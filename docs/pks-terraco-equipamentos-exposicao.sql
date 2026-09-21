-- ═══════════════════════════════════════════════════════════════════════════
-- Equipamentos de "Controle de Temperatura dos Alimentos em Exposição" -
-- PKS e Terraço
--
-- POR QUE: a nutricionista mandou a planilha de papel (21/09) e pediu esse
-- controle só pro PKS e pro Terraço. Decidido junto com o dono: isso não
-- precisa de planilha nova - vira EQUIPAMENTO com faixa de temperatura,
-- igual qualquer vitrine/freezer já cadastrado. O app já avalia
-- conforme/desvio sozinho e já aceita quantas leituras quiser no mesmo dia
-- (início e término da distribuição, sem precisar de campo novo nenhum).
--
-- FAIXAS - de onde vieram:
--   Balcão Quente - Exposição: mín. 60°C (é o que o papel exige), máx. 100°C
--     (o papel não define teto; usei um teto folgado só pra nunca acusar
--     "quente demais" por engano - o que importa de verdade é não cair
--     abaixo de 60).
--   Vitrine Fria - Exposição: 0-10°C, batendo exatamente com o "máx. 10°C"
--     do papel - mesma faixa que o app já usa pra equipamento refrigerado
--     comum.
--
-- Cria os DOIS equipamentos nas duas lojas, por segurança (não sei se cada
-- uma tem exposição quente, fria, ou as duas). Se alguma loja não tiver um
-- dos dois tipos, é só remover em Equipamentos → Remover - mais barato tirar
-- o que sobrou do que descobrir depois que faltou um.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente: pode rodar de novo sem duplicar (ON CONFLICT DO NOTHING -
-- se algum equipamento já existir com esse nome exato, ele não é tocado,
-- nem apaga nem sobrescreve o que já estiver lá).
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ ANTES DE QUALQUER COISA: confirme que você está no projeto do NutriOPS.
-- Se der erro dizendo que a tabela não existe, PARE - é o projeto errado.
select current_database() as banco,
       (select count(*) from public.equipment_catalog) as equipamentos_cadastrados;


-- 1ª CONFERÊNCIA - tem que voltar EXATAMENTE 2 linhas (PKS e Terraço). Se
-- vier 0, 1 ou mais de 2, PARE e me mande o resultado antes de continuar -
-- o nome pode estar diferente do que eu imaginei e o insert abaixo erraria
-- de loja.
select id, name
  from public.tenants
 where name ilike '%pks%' or name ilike '%parkshopping%' or name ilike '%park shopping%'
    or name ilike '%terraço%' or name ilike '%terraco%'
 order by name;


-- INSERT - só roda depois de você conferir que a query acima trouxe as 2
-- lojas certas.
insert into public.equipment_catalog (tenant_id, label, aliases, location, min_temp, max_temp, uso_intermitente)
select t.id, v.label, '[]'::jsonb, v.location, v.min_temp, v.max_temp, false
  from public.tenants t
  cross join (values
    ('Balcão Quente - Exposição', 'Atendimento', 60, 100),
    ('Vitrine Fria - Exposição',  'Atendimento',  0,  10)
  ) as v(label, location, min_temp, max_temp)
 where t.name ilike '%pks%' or t.name ilike '%parkshopping%' or t.name ilike '%park shopping%'
    or t.name ilike '%terraço%' or t.name ilike '%terraco%'
on conflict (tenant_id, label) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA FINAL - rode depois; tem que voltar 4 linhas (2 equipamentos ×
-- 2 lojas)
-- ═══════════════════════════════════════════════════════════════════════════
-- select t.name as loja, e.label, e.location, e.min_temp, e.max_temp
--   from public.equipment_catalog e
--   join public.tenants t on t.id = e.tenant_id
--  where e.label in ('Balcão Quente - Exposição', 'Vitrine Fria - Exposição')
--  order by 1, 2;
