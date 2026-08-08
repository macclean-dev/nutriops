-- ═══════════════════════════════════════════════════════════════════════════
-- Limpa os 4 equipamentos FALSOS gravados na CASA DOCE.
--
-- Quando a loja nasceu no /admin, o app gravou no jsonb equipment_catalog de
-- public.tenants os defaults do segmento 'padaria' (src/segments.js):
--   Câmara Refrigerada · Câmara Congelada · Vitrine Refrigerada · Balcão
--   Refrigerado — todos com location 'Unidade principal'
-- Nenhum deles existe na loja. Os 44 REAIS vivem na TABELA equipment_catalog,
-- que é a fonte de verdade (ver CLAUDE.md).
--
-- Enquanto o jsonb tiver esses 4, todo device NOVO os exibe no primeiro render
-- (antes do sync chegar) — e um device offline fica preso neles, deixando o
-- colaborador registrar temperatura num equipamento que não existe.
-- Esvaziar o jsonb faz o app mostrar "nenhum equipamento" até o sync trazer os
-- 44 de verdade, que é honesto em vez de errado.
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 1 — Conferir o estrago (esperado: 4 itens "Unidade principal" no jsonb,
-- 44 na tabela).
select jsonb_array_length(coalesce(equipment_catalog, '[]'::jsonb)) as no_jsonb_errado,
       (select count(*) from public.equipment_catalog where tenant_id = t.id) as na_tabela_certo
  from public.tenants t
 where t.id = 'bf245c3b-2f9';

-- PASSO 2 — Esvaziar o jsonb. Não apaga NADA de real: a tabela
-- equipment_catalog (44 itens) não é tocada.
update public.tenants
   set equipment_catalog = '[]'::jsonb
 where id = 'bf245c3b-2f9';

-- PASSO 3 — Conferir (esperado: 0 e 44).
select jsonb_array_length(coalesce(equipment_catalog, '[]'::jsonb)) as no_jsonb,
       (select count(*) from public.equipment_catalog where tenant_id = t.id) as na_tabela
  from public.tenants t
 where t.id = 'bf245c3b-2f9';

-- Conferência extra — os 44 reais, por setor:
-- select coalesce(location, '(sem setor)') as setor, count(*)
--   from public.equipment_catalog where tenant_id = 'bf245c3b-2f9'
--  group by 1 order by 1;
