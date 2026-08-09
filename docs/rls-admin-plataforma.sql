-- ═══════════════════════════════════════════════════════════════════════════
-- Caminho do ADMIN DA PLATAFORMA no RLS — pré-requisito pra aposentar o
-- device-token (a senha VITE_DEVICE_PASSWORD é pública no bundle).
--
-- POR QUE: hoje o admin global NÃO está em tenant_members e o JWT dele não tem
-- app_metadata.tenant_id. As policies só liberam por device-token,
-- __healthcheck__ ou is_member — ou seja, quando o dono abre a Swiss no painel,
-- quem busca os dados é o DEVICE-TOKEN. Sem este caminho, tirar o token
-- trancaria o dono pra fora de todas as lojas.
--
-- ADITIVO: nada deixa de funcionar. O device-token segue valendo até o deploy
-- da Fase 2 (código).
--
-- SEGURANÇA: lê `app_metadata`, NUNCA `user_metadata` — este último é editável
-- pelo próprio usuário via updateUser, então confiar nele deixaria qualquer
-- conta se promover a admin. Mesma regra do isGlobalAdmin (src/permissions.js).
--
-- ⚠️ COMO RODAR: são TRÊS execuções separadas. Rode uma, confira o resultado,
-- só então passe pra próxima. Não selecione trecho nenhum antes de clicar Run
-- (com texto selecionado, o SQL Editor executa só a seleção — foi o que fez a
-- primeira tentativa não aplicar nada).
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 1 — A função. Cole SÓ este bloco numa query nova e rode.        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

create or replace function public.is_admin_plataforma()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

revoke execute on function public.is_admin_plataforma() from anon, public;
grant  execute on function public.is_admin_plataforma() to authenticated;

select 'passo 1 ok' as resultado, public.is_admin_plataforma() as sou_admin_agora;
-- esperado: "passo 1 ok" | false   (false está CERTO: você é postgres aqui,
-- não uma sessão autenticada. O que importa é a linha aparecer sem erro.)


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 2 — As 9 policies + storage. Cole SÓ este bloco e rode.         ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

do $$
declare
  t text;
  regra text := '(tenant_id = (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')'
             || ' or tenant_id = ''__healthcheck__'''
             || ' or public.is_member(tenant_id)'
             || ' or public.is_admin_plataforma())';
begin
  foreach t in array array[
    'temperature_records', 'form_records', 'form_templates', 'equipment_catalog',
    'receiving_records', 'products', 'stock_logs', 'special_controls', 'tenant_staff'
  ] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all using %s with check %s',
      t, regra, regra);
  end loop;
end $$;

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

select tablename,
       case when qual like '%is_admin_plataforma%' then 'ok' else 'FALTANDO' end as tem_admin
  from pg_policies
 where schemaname = 'public' and policyname = 'tenant_isolation'
 order by tablename;
-- esperado: 9 linhas, TODAS "ok". Qualquer "FALTANDO" → me avise.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASSO 3 — Conferir. Cole SÓ este bloco e rode.                        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 3a) A SUA conta tem o carimbo de admin? Sem ele a policy nunca libera.
select email,
       coalesce(raw_app_meta_data ->> 'role', '(SEM ROLE — precisa corrigir)') as role_no_app_metadata
  from auth.users
 where email = 'maninthemirror2050@gmail.com';
-- esperado: admin

-- 3b) Simulando o admin: ele enxerga as lojas?
begin;
select set_config('request.jwt.claims',
  json_build_object(
    'sub', (select id::text from auth.users where email = 'maninthemirror2050@gmail.com'),
    'role', 'authenticated',
    'app_metadata', json_build_object('role', 'admin')
  )::text, true);
set local role authenticated;
select auth.jwt() -> 'app_metadata' ->> 'role' as papel_lido,
       public.is_admin_plataforma()            as funcao_diz_admin,
       count(*)                                as temperaturas
  from public.temperature_records;
rollback;
-- esperado: admin | true | mais de 700

-- 3c) ⚠️ O MAIS IMPORTANTE — uma loja continua SEM ver a outra?
begin;
select set_config('request.jwt.claims',
  json_build_object(
    'sub', (select id::text from auth.users where email = 'casadocest@gmail.com'),
    'role', 'authenticated'
  )::text, true);
set local role authenticated;
select count(*) as casa_doce_vendo_swiss
  from public.temperature_records where tenant_id = 'swiss';
rollback;
-- esperado: 0. Qualquer outro número → PARE e me avise.
