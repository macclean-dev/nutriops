-- ═══════════════════════════════════════════════════════════════════════════
-- Corrige o vínculo do dbk@nutriops.app, criado com a Swiss ativa por engano.
-- A conta (login/senha) está OK — só o tenant_id em tenant_members está errado.
-- ═══════════════════════════════════════════════════════════════════════════

-- PASSO 1 — Conferir o vínculo atual (deve aparecer 'swiss', o errado).
select u.email, m.tenant_id, m.role
  from public.tenant_members m
  join auth.users u on u.id = m.user_id
 where u.email = 'dbk@nutriops.app';

-- PASSO 2 — Corrigir: move o vínculo de 'swiss' pra 'dbk-producao'.
update public.tenant_members m
   set tenant_id = 'dbk-producao'
  from auth.users u
 where u.id = m.user_id
   and u.email = 'dbk@nutriops.app'
   and m.tenant_id = 'swiss';

-- PASSO 3 — Conferir de novo (agora deve aparecer 'dbk-producao').
select u.email, m.tenant_id, m.role
  from public.tenant_members m
  join auth.users u on u.id = m.user_id
 where u.email = 'dbk@nutriops.app';
