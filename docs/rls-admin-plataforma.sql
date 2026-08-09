-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 1 de 3 — Caminho do ADMIN DA PLATAFORMA no RLS
--
-- Pré-requisito pra aposentar o device-token (item 🔴 do CLAUDE.md: a senha
-- VITE_DEVICE_PASSWORD é pública no bundle, então qualquer um loga como o
-- device de qualquer loja e lê os dados dela).
--
-- POR QUE ISTO VEM ANTES: hoje o admin global NÃO está em tenant_members e o
-- JWT dele não tem app_metadata.tenant_id. As policies atuais só liberam por
-- device-token, __healthcheck__ ou is_member — ou seja, quando o dono abre a
-- Swiss no painel, quem busca os dados é o DEVICE-TOKEN. Tirar o device-token
-- sem este caminho trancaria o dono pra fora de todas as lojas.
--
-- Este script é ADITIVO: nada deixa de funcionar. O device-token continua
-- valendo até a Fase 2 (código) sair.
--
-- SEGURANÇA: lê `app_metadata`, NUNCA `user_metadata`. user_metadata é
-- editável pelo próprio usuário via updateUser — confiar nele pra privilégio
-- seria deixar qualquer conta se promover a admin. Mesma regra que o app usa
-- em isGlobalAdmin (src/permissions.js).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PARTE A — O helper ──────────────────────────────────────────────────────
create or replace function public.is_admin_plataforma()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

revoke execute on function public.is_admin_plataforma() from anon, public;
grant  execute on function public.is_admin_plataforma() to authenticated;


-- ── PARTE B — Recria as 9 policies com o caminho novo ───────────────────────
-- Ordem das vias: device-token (sai na Fase 2) · healthcheck · membro · admin.
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


-- ── PARTE C — Storage (fotos de evidência) ──────────────────────────────────
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


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) As 9 policies existem e todas citam o admin?
select tablename,
       case when qual like '%is_admin_plataforma%' then 'ok' else 'FALTANDO' end as tem_admin
  from pg_policies
 where schemaname = 'public' and policyname = 'tenant_isolation'
 order by tablename;
-- esperado: 9 linhas, todas "ok"

-- 2) O ADMIN enxerga as lojas? (era isto que o device-token fazia)
--    Troque o e-mail se o seu admin global for outro.
begin;
select set_config('request.jwt.claims',
  json_build_object(
    'sub', (select id::text from auth.users where email = 'maninthemirror2050@gmail.com'),
    'app_metadata', json_build_object('role', 'admin')
  )::text, true);
set local role authenticated;
select 'admin ve temperaturas' as teste, count(*) from public.temperature_records;
rollback;
-- esperado: contagem > 0 (hoje ~736 entre Swiss e Bäckerei)

-- 3) ⚠️ O MAIS IMPORTANTE: uma loja continua SEM ver a outra?
--    Se esta consulta voltar qualquer linha, PARE e me avise — significa que
--    o caminho do admin vazou pra contas comuns.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id::text from auth.users where email = 'casadocest@gmail.com'))::text, true);
set local role authenticated;
select 'casa doce vendo swiss (deve ser 0)' as teste, count(*)
  from public.temperature_records where tenant_id = 'swiss';
rollback;
-- esperado: 0
