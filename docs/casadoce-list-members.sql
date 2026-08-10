-- Lista os membros (contas de e-mail) de uma loja — pra a tela de Usuários mostrar
-- quem foi convidado. security definer (lê auth.users), gated por tenant_admin OU
-- Nutricionista RT da loja, OU admin global (10/08 — RT também gerencia a própria
-- equipe, ver supabase/functions/invite-collaborator/index.ts). Nunca devolve
-- senha/hash — só e-mail, nome, papel, acessos.
create or replace function public.list_tenant_members(p_tenant_id text)
returns table (user_id uuid, email text, name text, role text,
               created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not (
    exists (select 1 from public.tenant_members m
             where m.user_id = auth.uid() and m.tenant_id = p_tenant_id
               and m.role in ('tenant_admin', 'Nutricionista RT'))
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  ) then
    raise exception 'list_tenant_members: não autorizado' using errcode = '42501';
  end if;

  return query
    select m.user_id,
           u.email::text,
           coalesce(u.raw_user_meta_data ->> 'name', u.email)::text,
           m.role,
           m.created_at,
           u.last_sign_in_at
      from public.tenant_members m
      join auth.users u on u.id = m.user_id
     where m.tenant_id = p_tenant_id
     order by m.created_at;
end;
$$;

revoke execute on function public.list_tenant_members(text) from anon, public;
grant  execute on function public.list_tenant_members(text) to authenticated;

-- Conferência (simula a dona da CASA DOCE — deve listar a nutricionista + o Fabrício):
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub',(select id::text from auth.users where email='casadocest@gmail.com'))::text, true);
-- set local role authenticated;
-- select email, name, role, last_sign_in_at from public.list_tenant_members('bf245c3b-2f9');
-- rollback;
