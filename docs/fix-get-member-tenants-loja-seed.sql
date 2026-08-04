-- ═══════════════════════════════════════════════════════════════════════════
-- Corrige get_member_tenants() pra reconhecer vínculo com loja-seed
-- (Swiss/Bäckerei/DBK Produção) — hoje só funciona pra tenant do modelo nuvem
-- (CASA DOCE), porque faz INNER JOIN com public.tenants. Loja-seed nunca tem
-- linha em public.tenants (só existe em src/tenants-public.js), então o JOIN
-- descarta o vínculo mesmo com a linha certa em tenant_members — e o login
-- por e-mail de swiss@/backerei@/dbk@nutriops.app (e Fran/Ana Paula) quebra:
-- o app acha "sem vínculo" e tenta deslogar por segurança.
--
-- Troca INNER JOIN por LEFT JOIN + usa m.tenant_id (sempre existe) como id,
-- em vez de t.id (fica null quando não há linha em tenants). Nome cai pro
-- próprio id quando não há metadata na nuvem — cosmético, sem efeito prático
-- (loja-seed já mostra o nome certo via tenants-public.js no resto do app).
-- CASA DOCE e futuros tenants /admin continuam com os dados ricos de sempre.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_member_tenants()
returns table (
  id text, name text, segment text, plan text,
  brand_color text, brand_soft text,
  equipment_catalog jsonb, modules jsonb, stores jsonb,
  trial_ends_at timestamptz, implantacao boolean, go_live_at timestamptz, role text
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id as id,
         coalesce(t.name, m.tenant_id) as name,
         coalesce(t.segment, '') as segment,
         t.plan,
         t.brand_color, t.brand_soft,
         coalesce(t.equipment_catalog, '[]'::jsonb),
         coalesce(t.modules, '[]'::jsonb),
         coalesce(t.stores, '[]'::jsonb),
         t.trial_ends_at, coalesce(t.implantacao, true), t.go_live_at, m.role
    from public.tenant_members m
    left join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
   order by coalesce(t.name, m.tenant_id);
$$;

revoke execute on function public.get_member_tenants() from anon, public;
grant  execute on function public.get_member_tenants() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Conferência (simula a Swiss — deve devolver 1 linha, id='swiss', role='Colaborador'):
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub',(select id::text from auth.users where email='swiss@nutriops.app'))::text, true);
-- set local role authenticated;
-- select id, name, role from public.get_member_tenants();
-- rollback;
--
-- Conferência CASA DOCE (deve continuar com nome/segmento/catálogo cheios):
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub',(select id::text from auth.users where email='casadocest@gmail.com'))::text, true);
-- set local role authenticated;
-- select id, name, segment, role from public.get_member_tenants();
-- rollback;
