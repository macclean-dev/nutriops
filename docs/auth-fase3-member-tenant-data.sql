-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · FASE 3 (parte servidor) — metadata da loja pro MEMBRO autenticado
--
-- POR QUE: quando o dono da loja logar por e-mail num device novo, o app precisa
-- da metadata da empresa (nome, cor, segmento, lojas, módulos, catálogo) pra
-- montar a tela. Mas a tabela `tenants` está com grants revogados (lockdown de
-- 10/07) e a get_tenant_by_token exige o access_token — que um membro logado não
-- tem. Esta RPC preenche a lacuna: devolve a metadata das empresas às quais o
-- CHAMADOR pertence (via tenant_members), e SÓ dessas.
--
-- SEGURANÇA:
--   • security definer, mas o escopo é o próprio auth.uid() (join em
--     tenant_members) — o chamador só recebe as próprias empresas.
--   • NÃO devolve access_token nem setup_pin_hash. Um membro não precisa deles,
--     e devolvê-los vazaria a credencial da loja pra qualquer colaborador.
--   • grant só pra authenticated.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_member_tenants()
returns table (
  id text, name text, segment text, plan text,
  brand_color text, brand_soft text,
  equipment_catalog jsonb, modules jsonb, stores jsonb,
  trial_ends_at timestamptz, role text
)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.segment, t.plan,
         t.brand_color, t.brand_soft,
         coalesce(t.equipment_catalog, '[]'::jsonb),
         coalesce(t.modules, '[]'::jsonb),
         coalesce(t.stores, '[]'::jsonb),
         t.trial_ends_at, m.role
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
   order by t.name
$$;

revoke execute on function public.get_member_tenants() from anon, public;
grant  execute on function public.get_member_tenants() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO — simula a sessão da dona da CASA DOCE (sem ninguém logar).
-- Esperado: 1 linha, CASA DOCE, role tenant_admin, SEM colunas de segredo.
-- ═══════════════════════════════════════════════════════════════════════════
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', (select id::text from auth.users
--                              where email = 'casadocest@gmail.com'))::text, true);
-- set local role authenticated;
-- select id, name, segment, role, jsonb_array_length(stores) as n_lojas
--   from public.get_member_tenants();
-- rollback;

-- Prova negativa (anon não alcança): fora de sessão, deve dar erro de permissão.
-- select * from public.get_member_tenants();   -- esperado: permission denied


-- ROLLBACK:
-- drop function if exists public.get_member_tenants();
