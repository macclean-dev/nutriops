-- ═══════════════════════════════════════════════════════════════════════════
-- Corrige as 3 contas de loja criadas ANTES do checkbox "É conta de loja"
-- existir no código (v1.9.82). A conta em si (login/senha) está OK — só falta
-- o carimbo isStoreAccount no user_metadata, que é o que liga a tela
-- "Quem está registrando?" (src/operator.js lê esse campo).
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 1 — Conferir o estado atual (esperado: isStoreAccount ausente/false
-- nas 3, já que foram criadas antes do checkbox existir).
select email, raw_user_meta_data
  from auth.users
 where email in ('swiss@nutriops.app', 'backerei@nutriops.app', 'dbk@nutriops.app');

-- PASSO 2 — Corrigir: adiciona isStoreAccount:true sem apagar o resto do
-- metadata (ex.: o "name" que você já preencheu na criação).
update auth.users
   set raw_user_meta_data = raw_user_meta_data || '{"isStoreAccount": true}'::jsonb
 where email in ('swiss@nutriops.app', 'backerei@nutriops.app', 'dbk@nutriops.app');

-- PASSO 3 — Conferir de novo (isStoreAccount deve aparecer true nas 3).
select email, raw_user_meta_data ->> 'isStoreAccount' as is_store_account, raw_user_meta_data ->> 'name' as name
  from auth.users
 where email in ('swiss@nutriops.app', 'backerei@nutriops.app', 'dbk@nutriops.app');
