-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · RLS FASE 3 — policies corrigidas (app_metadata) + rollout
--
-- Fecha o isolamento SERVER-SIDE das 8 tabelas de dados. Corrige o achado
-- adversarial: as policies antigas liam `user_metadata` (EDITÁVEL pelo dono do
-- token → forjável) e tinham bypass por `role` (idem). Aqui passa a ler
-- `app_metadata` (só service role edita) e o bypass some.
--
-- ⚠️ NÃO EXECUTAR SEM O DONO PRESENTE + JANELA DE MONITORAMENTO.
-- Este arquivo tem 4 partes. As Partes A e B são SEGURAS (não ligam RLS, não
-- mudam comportamento — as policies ficam inertes enquanto RLS estiver OFF).
-- A Parte C (enable) é a única perigosa: roda TABELA POR TABELA, monitorando.
-- A Parte D é conferência + rollback.
--
-- ORDEM OBRIGATÓRIA:
--   1) Pré-req fora deste arquivo: VITE_DEVICE_PASSWORD no Vercel + confirmar nos
--      logs (F12 no device) `[device-auth] token obtido pro tenant swiss` (e
--      backerei, dbk-producao). Sem device token funcionando, o enable BLOQUEIA
--      o sync (a anon key só alcança o tenant '__healthcheck__').
--   2) Parte A (app_metadata nas contas device) — rode e confira.
--   3) Parte B (policies) — rode (idempotente, inerte).
--   4) Parte C — UMA tabela por vez, monitorando 24h entre cada.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE A — app_metadata (não-forjável) nas 3 contas device. Rode PRIMEIRO.
-- raw_app_meta_data só é setável por service role / SQL Editor — o próprio
-- usuário NÃO consegue editar (ao contrário de raw_user_meta_data). É isso que
-- torna a policy confiável.
-- ─────────────────────────────────────────────────────────────────────────────

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('role', 'device', 'tenant_id', 'swiss')
 where email = 'device-swiss@nutriops.internal';

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('role', 'device', 'tenant_id', 'backerei')
 where email = 'device-backerei@nutriops.internal';

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('role', 'device', 'tenant_id', 'dbk-producao')
 where email = 'device-dbk@nutriops.internal';

-- Conferência (deve listar as 3 com tenant_id certo):
--   select email, raw_app_meta_data->>'role' as role, raw_app_meta_data->>'tenant_id' as tenant
--   from auth.users where email like 'device-%@nutriops.internal';
--
-- ⚠️ Depois disso, os devices precisam de um TOKEN NOVO pra o app_metadata
-- entrar no JWT. O device-auth cacheia ~1h; force um relogin (feche/reabra o app
-- no device, ou espere o cache expirar) ANTES de ligar RLS, e confirme no F12 um
-- `[device-auth] token obtido`. Tokens antigos (sem app_metadata) tomam 403 sob
-- RLS → o device-auth invalida e reloga sozinho, mas é churn — melhor evitar.


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE B — Policies corrigidas (app_metadata, SEM bypass por role, com exceção
-- do healthcheck). Idempotente. NÃO liga RLS — inerte enquanto RLS off.
--
-- Regra por linha (using = leitura/update/delete; with check = insert/update):
--   tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'   (o device só a sua loja)
--   OR tenant_id = '__healthcheck__'                        (deixa o testWrite passar)
--
-- Sem cláusula `to` → vale pra anon E authenticated:
--   • device (authenticated, app_metadata.tenant_id=swiss) → só linhas de swiss + healthcheck
--   • anon (fallback / testWrite) → app_metadata é null → só alcança '__healthcheck__'
--     (NUNCA dados reais). É isso que fecha o buraco da anon key.
--
-- A visão cross-tenant do admin (/admin HealthView) NÃO passa por aqui (bypass
-- removido de propósito) — vai por um RPC security-definer à parte (ver decisão
-- do /admin no plano). Não ligue RLS antes de resolver o HealthView.
-- ─────────────────────────────────────────────────────────────────────────────

-- temperature_records
drop policy if exists tenant_isolation on public.temperature_records;
create policy tenant_isolation on public.temperature_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');

-- form_records
drop policy if exists tenant_isolation on public.form_records;
create policy tenant_isolation on public.form_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');

-- form_templates
drop policy if exists tenant_isolation on public.form_templates;
create policy tenant_isolation on public.form_templates for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');

-- equipment_catalog
drop policy if exists tenant_isolation on public.equipment_catalog;
create policy tenant_isolation on public.equipment_catalog for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');

-- receiving_records
drop policy if exists tenant_isolation on public.receiving_records;
create policy tenant_isolation on public.receiving_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');

-- products
drop policy if exists tenant_isolation on public.products;
create policy tenant_isolation on public.products for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');

-- stock_logs
drop policy if exists tenant_isolation on public.stock_logs;
create policy tenant_isolation on public.stock_logs for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');

-- special_controls
drop policy if exists tenant_isolation on public.special_controls;
create policy tenant_isolation on public.special_controls for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__')
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__');


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE C — LIGAR RLS. ⚠️ PERIGOSA. UMA TABELA POR VEZ, monitorando 24h entre
-- cada. Começa por special_controls (menor volume/risco). NÃO rode em bloco.
-- Pré-req: Parte A + B rodadas, VITE_DEVICE_PASSWORD no Vercel, device tokens
-- confirmados nos logs, e o HealthView do /admin já resolvido (senão o painel
-- admin fica vazio).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1ª (menor risco) — rode, monitore 24h, valide no app + na REST:
-- alter table public.special_controls   enable row level security;

-- depois, uma a uma:
-- alter table public.stock_logs         enable row level security;
-- alter table public.receiving_records  enable row level security;
-- alter table public.form_templates     enable row level security;
-- alter table public.equipment_catalog  enable row level security;
-- alter table public.products           enable row level security;
-- alter table public.form_records       enable row level security;
-- alter table public.temperature_records enable row level security;  -- a de maior volume, por último


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE D — Conferência + ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────

-- Estado do RLS por tabela:
--   select relname, relrowsecurity from pg_class
--   where relname in ('temperature_records','form_records','form_templates',
--     'equipment_catalog','receiving_records','products','stock_logs','special_controls')
--   order by relname;

-- Prova do isolamento (rode com a ANON key, fora do SQL Editor — ex.: curl):
--   GET /rest/v1/special_controls?select=tenant_id  → deve voltar [] (anon não vê dados)
--   (com um device token válido de swiss, deve voltar só linhas de swiss)

-- ROLLBACK imediato (por tabela, volta ao estado atual na hora):
--   alter table public.special_controls disable row level security;
-- O device-auth segue tentando o JWT; se cair, volta pra anon key — sem quebra.
