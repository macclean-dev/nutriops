-- Item 18 da revisão de produto (retomado 13/08): filtros e export no
-- histórico de acessos. Duas mudanças em `get_access_log` (docs/access-log.sql):
--
-- 1) FILTRO DE PERÍODO — vira parâmetro da própria função (p_since/p_until),
--    aplicado ANTES do `limit`. A função já trava em 500 linhas
--    (`limit least(coalesce(p_limit,200),500)`) e não pagina — um filtro só
--    no client, sobre essas 200-500 linhas mais recentes, mentiria pro
--    usuário: "julho vazio" podia significar só que julho nem chegou a
--    entrar na janela trazida, não que não houve acesso. Mesmo raciocínio já
--    usado no item 14 (teto silencioso de 90 dias).
--
-- 2) RT TAMBÉM ADMINISTRA A PRÓPRIA EQUIPE — mesmo bug já corrigido hoje em
--    invite-collaborator e list_tenant_members: o app libera a aba "Histórico
--    de acessos" pro papel Nutricionista RT (permissions.js), mas o servidor
--    só aceitava tenant_admin. Resultado: RT via a aba, a RPC rejeitava
--    (42501), e como fetchAccessLog trata erro devolvendo [] em silêncio, a
--    tela mostrava "nenhum acesso" — indistinguível de vazio de verdade.
--
-- CREATE OR REPLACE preserva os 2 parâmetros originais (p_tenant_id, p_limit)
-- na mesma posição e só ACRESCENTA p_since/p_until no fim — não precisa DROP.
create or replace function public.get_access_log(
  p_tenant_id text default null,
  p_limit integer default 200,
  p_since timestamptz default null,
  p_until timestamptz default null
)
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
                  where m.user_id = auth.uid() and m.tenant_id = p_tenant_id
                    and m.role in ('tenant_admin', 'Nutricionista RT'))
    ) then
      raise exception 'get_access_log: não autorizado' using errcode = '42501';
    end if;
  end if;

  return query
    select a.created_at,
           (a.payload ->> 'actor_username')::text,
           a.ip_address::text,
           (a.payload ->> 'action')::text,
           p_tenant_id
      from auth.audit_log_entries a
     where a.payload ->> 'action' in ('login', 'logout')
       and (p_since is null or a.created_at >= p_since)
       and (p_until is null or a.created_at <= p_until)
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

revoke execute on function public.get_access_log(text, integer, timestamptz, timestamptz) from anon, public;
grant  execute on function public.get_access_log(text, integer, timestamptz, timestamptz) to authenticated;

-- Conferência (simula a nutricionista da CASA DOCE — antes tomava 42501, agora vê):
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub',(select id::text from auth.users where email='<e-mail da RT aqui>'))::text, true);
-- set local role authenticated;
-- select * from public.get_access_log('bf245c3b-2f9', 200, now() - interval '30 days', null);
-- rollback;
