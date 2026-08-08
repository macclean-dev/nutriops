-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · Fotos de evidência nas planilhas (bucket `form-photos`)
--
-- Pedido da nutricionista da CASA DOCE (07/08): "a colaboradora estava com a
-- unha grande, tiro a foto e registro".
--
-- POR QUE Storage e não a foto dentro do registro: form_records.responses é
-- jsonb e também vive no localStorage do aparelho, que estoura em ~5 MB. Uma
-- foto reduzida ainda pesa ~100 KB — um checklist diário encheria o aparelho
-- em poucos meses e travaria o app INTEIRO, não só a foto. No registro fica só
-- o caminho.
--
-- ISOLAMENTO: o bucket é PRIVADO e o caminho começa pelo id da loja
--   {tenant_id}/{form_id}/{periodo}/{campo}-{carimbo}.jpg
-- A policy compara a PRIMEIRA pasta do caminho com o tenant do JWT. Mesmas 3
-- vias das outras 8 tabelas (device-token OR __healthcheck__ OR is_member).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PASSO 1 — Criar o bucket privado (idempotente) ──────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('form-photos', 'form-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- ── PASSO 2 — Policies em storage.objects, escopadas a este bucket ──────────
-- storage.foldername(name) devolve as pastas do caminho; [1] é a primeira,
-- que é o tenant_id. Sem `bucket_id = 'form-photos'` a regra vazaria pra
-- qualquer outro bucket do projeto.

drop policy if exists form_photos_tenant_select on storage.objects;
create policy form_photos_tenant_select on storage.objects for select
  using (
    bucket_id = 'form-photos' and (
      (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
      or public.is_member((storage.foldername(name))[1])
    )
  );

drop policy if exists form_photos_tenant_insert on storage.objects;
create policy form_photos_tenant_insert on storage.objects for insert
  with check (
    bucket_id = 'form-photos' and (
      (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
      or public.is_member((storage.foldername(name))[1])
    )
  );

-- Sem UPDATE de propósito: foto de evidência não se substitui (o upload usa
-- x-upsert:false e carimbo único no nome). Errou? Anexa outra.
drop policy if exists form_photos_tenant_delete on storage.objects;
create policy form_photos_tenant_delete on storage.objects for delete
  using (
    bucket_id = 'form-photos' and (
      (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
      or public.is_member((storage.foldername(name))[1])
    )
  );

-- ── PASSO 3 — Conferência ───────────────────────────────────────────────────
select id, public, file_size_limit from storage.buckets where id = 'form-photos';
-- esperado: form-photos | false | 5242880

select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like 'form_photos%'
 order by policyname;
-- esperado: 3 linhas (delete, insert, select)

-- Isolamento entre lojas (simula a dona da CASA DOCE lendo pasta da Swiss —
-- deve voltar VAZIO):
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub',(select id::text from auth.users where email='casadocest@gmail.com'))::text, true);
-- set local role authenticated;
-- select name from storage.objects where bucket_id='form-photos' and name like 'swiss/%';
-- rollback;
