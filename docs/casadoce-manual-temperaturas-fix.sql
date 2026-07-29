-- CASA DOCE — correção das faixas de temperatura conforme "Manual de
-- Temperaturas" da nutricionista (resposta de 29/07). A Fase A (docs/
-- casadoce-equipamentos-fase-a.sql) usou faixas genéricas por categoria;
-- o manual real trouxe números mais específicos por tipo de equipamento.
-- Idempotente — update por (tenant_id, label) exato, só toca o que mudou.

-- Vitrine Refrigerada (Atendimento pães/café + Ilha de Sobremesas): 2°C a 6°C
-- (Fase A usava 0-4, igual ao refrigerador comum — ela separou essa faixa)
update public.equipment_catalog set min_temp=2, max_temp=6, updated_at=now()
 where tenant_id='bf245c3b-2f9' and label in (
   'Vitrine refrigerada — V.1', 'Vitrine refrigerada — V.5', 'Vitrine refrigerada — V.6',
   'Vitrine refrigerada — V.7', 'Vitrine refrigerada — V.8'
 );

-- Vitrine Aquecida (Atendimento pães/café): mínima 60°C, máxima 75°C
-- (Fase A tinha 80-90 — chutado errado, ela corrigiu)
update public.equipment_catalog set min_temp=60, max_temp=75, updated_at=now()
 where tenant_id='bf245c3b-2f9' and label='Vitrine aquecida — V.2';

-- Vitrine Congelada / gelato (Atendimento Gelatos): -16°C a -14°C
-- (Fase A tinha -14/-12, banda errada — ela corrigiu)
update public.equipment_catalog set min_temp=-16, max_temp=-14, updated_at=now()
 where tenant_id='bf245c3b-2f9' and label in (
   'Vitrine congelada (gelato) — V.3', 'Vitrine congelada (gelato) — V.4'
 );

-- Geladeira do Refeitório: mínima 0°C, máxima 5°C (ela deu faixa própria pro
-- refeitório, diferente do 0-4 genérico das outras geladeiras/bancadas)
update public.equipment_catalog set min_temp=0, max_temp=5, updated_at=now()
 where tenant_id='bf245c3b-2f9' and label='Geladeira — R.12' and location='Refeitório';

-- Banho-maria (Refeitório): mínima 60°C, máxima 85°C
-- (Fase A tinha 80-90, chutado errado — ela corrigiu)
update public.equipment_catalog set min_temp=60, max_temp=85, updated_at=now()
 where tenant_id='bf245c3b-2f9' and label='Banho-maria — BM.1';

-- Sem mudança (já batiam com o manual): Câmara de refrigeração/congelamento
-- (0-4 / -22-18), todos os Refrigerador/Bancada/Geladeira genéricos (0-4),
-- todos os Freezer/Congelador (ideal -22/-18, dentro da faixa -25 a -15 dela).

-- Conferência:
-- select label, location, min_temp, max_temp from public.equipment_catalog
--  where tenant_id='bf245c3b-2f9' order by label;

-- ⚠️ PENDENTE — "Vitrine Seca" (ambiente, 18°C a 22°C, atendimento pães e
-- café) apareceu no manual dela mas NÃO está nos 44 equipamentos da Fase A.
-- Confirmar com o dono/nutricionista se é um equipamento físico a cadastrar
-- (quantos? qual código?) antes de inserir.
