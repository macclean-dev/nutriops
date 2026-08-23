-- ═══════════════════════════════════════════════════════════════════════════
-- ⭐ FONTE DE VERDADE DAS POLICIES DE RLS — rode ESTE, não os outros.
--
-- POR QUE ESTE ARQUIVO EXISTE (incidente de 16/08/2026):
-- A mesma policy `tenant_isolation` estava definida em QUATRO lugares, cada um
-- com uma regra diferente, e todos fazem `drop policy` antes de `create`.
-- Ou seja: o último que rodasse vencia — sem aviso, sem erro.
--
--   docs/rls-fase3-policies.sql        → 2 caminhos (SEM is_member)  ❌ antigo
--   docs/auth-fase1-tenant-members.sql → 3 caminhos (SEM is_admin)   ❌ antigo
--   SUPABASE_SQL (src/repository.js)   → 2 caminhos                  ❌ antigo
--   docs/rls-admin-plataforma.sql      → 4 caminhos                  ✅ certo
--
-- Resultado real: a `temperature_records` ficou com a regra de 2 caminhos. A
-- CASA DOCE entra por VÍNCULO (tenant_members), não por carimbo no token —
-- então o banco recusou leitura E escrita dela. 108 registros existiam e a
-- tela mostrava zero; o console alagou de 401 com código 42501. Levou horas
-- pra achar porque o erro parecia "chave inválida".
--
-- A partir daqui: mexeu em policy, mexe AQUI. Os outros arquivos ganharam
-- aviso no topo e não devem mais ser executados.
--
-- ⚠️ COMO RODAR: cole o arquivo INTEIRO numa query nova e clique Run UMA vez.
-- Não selecione trecho (com seleção, o editor roda só o selecionado).
-- Idempotente: pode rodar quantas vezes quiser.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── PARTE 1 — As duas funções de apoio ──────────────────────────────────────
-- SEGURANÇA: as duas leem `app_metadata`, NUNCA `user_metadata` — este último
-- é editável pelo próprio usuário via updateUser, então confiar nele deixaria
-- qualquer conta se promover a admin (foi o vazamento de 30/07).

create or replace function public.is_member(p_tenant_id text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members m
     where m.user_id = auth.uid() and m.tenant_id = p_tenant_id
  )
$$;
revoke execute on function public.is_member(text) from anon, public;
grant  execute on function public.is_member(text) to authenticated;

create or replace function public.is_admin_plataforma()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;
revoke execute on function public.is_admin_plataforma() from anon, public;
grant  execute on function public.is_admin_plataforma() to authenticated;


-- ── PARTE 2 — A regra, aplicada a TODAS as tabelas de tenant ────────────────
-- Os 4 caminhos de acesso:
--   1. app_metadata.tenant_id  → conta presa a uma loja (device/loja seed)
--   2. '__healthcheck__'       → o testWrite do boot, que não é dado real
--   3. is_member(tenant_id)    → login por e-mail com vínculo (RT, dono, membro)
--   4. is_admin_plataforma()   → admin da NutriOPS, alcança todas
--
-- O caminho 3 é o que faltava na temperature_records e causou o incidente.
--
-- A lista abaixo tem as 20 tabelas de tenant existentes hoje. AO CRIAR TABELA
-- NOVA: acrescente o nome aqui e rode este arquivo de novo — é tudo que
-- precisa ser feito.

-- ⚠️ O caminho `__healthcheck__` saiu daqui em 21/08 e passou a valer SÓ na
-- `temperature_records` (bloco logo abaixo), escopado ao uid de quem sonda.
--
-- POR QUÊ: a sonda do boot (`testWrite`, repository.js) só escreve em
-- temperature_records — nas outras 19 o caminho nunca teve uso, e abria
-- escrita de linha ARBITRÁRIA pra qualquer conta autenticada, inclusive sem
-- vínculo com loja nenhuma. Não vazava dado (as telas filtram por tenant_id
-- real), mas era superfície de poluição de graça em 19 tabelas de evidência.
-- Achado da revisão adversarial de 21/08.
do $$
declare
  t text;
  regra text := '(tenant_id = (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')'
             || ' or public.is_member(tenant_id)'
             || ' or public.is_admin_plataforma())';
begin
  foreach t in array array[
    -- núcleo operacional
    -- 'temperature_records' saiu da lista: tem bloco próprio abaixo, com o
    -- caminho da sonda escopado ao uid.
    'form_records', 'form_templates', 'equipment_catalog',
    'receiving_records', 'products', 'special_controls', 'tenant_staff',
    'stock_logs',                      -- morta no código (v1.9.129), viva no banco
    -- validades e não-conformidades
    'validity_rules', 'corrective_actions',
    -- Fatia 3 da Prontidão (v1.9.132)
    'pops', 'training_sessions', 'training_config', 'rt_validations',
    -- Fatia 2b da Prontidão (v1.9.135)
    'company_profile', 'compliance_docs',
    -- Manutenção (v1.9.140) — o último módulo a sair do local-only
    'equip_assets', 'maint_logs', 'work_orders'
  ] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all using %s with check %s',
      t, regra, regra);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- temperature_records: os 4 caminhos + a SONDA DO BOOT, escopada.
--
-- A sonda (`testWrite`, repository.js) grava uma linha com
-- tenant_id='__healthcheck__' pra provar que a escrita nesta tabela funciona —
-- ela existe porque em 30/05 a form_records sincronizava e a
-- temperature_records não, em silêncio.
--
-- `user_name = auth.uid()::text` é o que mudou em 21/08. Antes o caminho era
-- incondicional, e aí:
--   · qualquer conta autenticada (mesmo SEM vínculo) escrevia linha arbitrária;
--   · o DELETE por tenant_id apagava a sonda de TODO MUNDO — num boot
--     concorrente, derrubava o healthcheck de outra loja e gerava falso
--     negativo que ninguém saberia de onde veio.
-- Agora a linha de sonda tem dono: você só escreve e apaga a sua.
drop policy if exists tenant_isolation on public.temperature_records;
create policy tenant_isolation on public.temperature_records for all
  using (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
    or (tenant_id = '__healthcheck__' and user_name = auth.uid()::text)
  )
  with check (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or public.is_member(tenant_id)
    or public.is_admin_plataforma()
    or (tenant_id = '__healthcheck__' and user_name = auth.uid()::text)
  );
alter table public.temperature_records enable row level security;

-- Varre sondas órfãs de antes deste SQL (user_name='system', sem dono).
delete from public.temperature_records
 where tenant_id = '__healthcheck__' and user_name = 'system';


-- ── PARTE 3 — Storage das fotos de planilha ─────────────────────────────────
-- Mesma regra dos 4 caminhos, aplicada ao bucket `form-photos`. O tenantId é
-- a PRIMEIRA pasta do caminho do arquivo — é isso que isola as lojas.
-- (Esta parte ficou de fora em 16/08 porque o bloco quebrou no meio de um
-- copiar/colar e o Postgres desfez a transação inteira.)

drop policy if exists form_photos_tenant_select on storage.objects;
create policy form_photos_tenant_select on storage.objects for select
  using (bucket_id = 'form-photos' and (
    (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or public.is_member((storage.foldername(name))[1])
    or public.is_admin_plataforma()));

drop policy if exists form_photos_tenant_insert on storage.objects;
create policy form_photos_tenant_insert on storage.objects for insert
  with check (bucket_id = 'form-photos' and (
    (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or public.is_member((storage.foldername(name))[1])
    or public.is_admin_plataforma()));

drop policy if exists form_photos_tenant_delete on storage.objects;
create policy form_photos_tenant_delete on storage.objects for delete
  using (bucket_id = 'form-photos' and (
    (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    or public.is_member((storage.foldername(name))[1])
    or public.is_admin_plataforma()));


-- ── PARTE 4 — Conferência ───────────────────────────────────────────────────
-- Esperado: 20 linhas, TODAS com os_4_caminhos = 'ok'.
-- Qualquer 'FALTA ALGO' → a tabela ficou pra trás, me avise.

select tablename,
       case when qual like '%is_member%' and qual like '%is_admin_plataforma%'
            then 'ok' else 'FALTA ALGO' end as os_4_caminhos
  from pg_policies
 where schemaname = 'public' and policyname = 'tenant_isolation'
 order by tablename;
