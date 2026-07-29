-- Log de acessos (IP + horário + usuário) — aprovado sem geolocalização paga.
-- Lê auth.audit_log_entries (só login/logout, não cada token_refreshed) e
-- filtra pelos membros (tenant_members) da loja — nunca solta o log inteiro
-- da instância. Mesmo idioma de gate do docs/casadoce-list-members.sql:
-- tenant_admin da própria loja OU admin global (app_metadata.role='admin').
--
-- p_tenant_id null só é aceito pra admin global (vê o log de todas as lojas).
create or replace function public.get_access_log(p_tenant_id text default null, p_limit integer default 200)
returns table (
  at timestamptz,
  email text,
  ip_address text,
  action text,
  tenant_id text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_is_admin boolean := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
begin
  if p_tenant_id is null then
    if not v_is_admin then
      raise exception 'get_access_log: não autorizado' using errcode = '42501';
    end if;
  else
    if not (
      v_is_admin
      or exists (select 1 from public.tenant_members m
                  where m.user_id = auth.uid() and m.tenant_id = p_tenant_id and m.role = 'tenant_admin')
    ) then
      raise exception 'get_access_log: não autorizado' using errcode = '42501';
    end if;
  end if;

  -- EXISTS (não JOIN) de propósito: um usuário-membro de mais de uma loja não
  -- pode duplicar a linha do login por loja quando p_tenant_id é null (visão
  -- global do admin). Nesse caso a coluna tenant_id fica null (ambíguo — ele
  -- pertence a mais de uma); quando escopado a uma loja, é sempre essa loja.
  return query
    select a.created_at,
           (a.payload ->> 'actor_username')::text,
           a.ip_address::text,
           (a.payload ->> 'action')::text,
           p_tenant_id
      from auth.audit_log_entries a
     where a.payload ->> 'action' in ('login', 'logout')
       and exists (
         select 1 from auth.users u
         join public.tenant_members m on m.user_id = u.id
        where u.email = (a.payload ->> 'actor_username')
          and (p_tenant_id is null or m.tenant_id = p_tenant_id)
       )
     order by a.created_at desc
     limit least(coalesce(p_limit, 200), 500);
end;
$$;

revoke execute on function public.get_access_log(text, integer) from anon, public;
grant  execute on function public.get_access_log(text, integer) to authenticated;

-- Conferência (simula a dona da CASA DOCE — deve ver só os acessos da própria loja):
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub',(select id::text from auth.users where email='casadocest@gmail.com'))::text, true);
-- set local role authenticated;
-- select * from public.get_access_log('bf245c3b-2f9');
-- rollback;
