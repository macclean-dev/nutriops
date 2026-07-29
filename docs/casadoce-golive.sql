-- MODO IMPLANTAÇÃO / GO-LIVE por loja.
-- implantacao=true → loja em treinamento: alertas de pendência suspensos, registros
-- marcados como treino. Nova loja nasce assim. Go-live = virar false + gravar a data.
-- Seeds (Swiss/Bäckerei) não estão nesta tabela → não afetados (seguem operacionais).

alter table public.tenants add column if not exists implantacao boolean default true;
alter table public.tenants add column if not exists go_live_at  timestamptz;

-- get_member_tenants passa a devolver implantacao + go_live_at (drop necessário:
-- muda o tipo de retorno).
drop function if exists public.get_member_tenants();
create function public.get_member_tenants()
returns table (
  id text, name text, segment text, plan text,
  brand_color text, brand_soft text,
  equipment_catalog jsonb, modules jsonb, stores jsonb,
  trial_ends_at timestamptz, implantacao boolean, go_live_at timestamptz, role text
)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.segment, t.plan, t.brand_color, t.brand_soft,
         coalesce(t.equipment_catalog, '[]'::jsonb),
         coalesce(t.modules, '[]'::jsonb),
         coalesce(t.stores, '[]'::jsonb),
         t.trial_ends_at, coalesce(t.implantacao, true), t.go_live_at, m.role
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
   order by t.name;
$$;
revoke execute on function public.get_member_tenants() from anon, public;
grant  execute on function public.get_member_tenants() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- GO-LIVE — rode SÓ quando a equipe estiver treinada (o dono decide). Tira a
-- CASA DOCE da implantação e marca a data oficial de início da conformidade.
-- ═══════════════════════════════════════════════════════════════════════════
-- update public.tenants set implantacao = false, go_live_at = now()
--  where id = 'bf245c3b-2f9';
