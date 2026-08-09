-- Diagnóstico: por que o admin da plataforma vê 0 registros?
-- Só leitura. Rode TUDO de uma vez e me mande as 4 tabelas.

-- (1) A função existe?
select count(*) as funcao_existe
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'is_admin_plataforma';
-- esperado: 1

-- (2) As policies citam o admin? Se vier "FALTANDO", a PARTE B do script
--     anterior não aplicou (talvez só um trecho tenha sido executado).
select tablename,
       case when qual like '%is_admin_plataforma%' then 'ok' else 'FALTANDO' end as tem_admin
  from pg_policies
 where schemaname = 'public' and policyname = 'tenant_isolation'
 order by tablename;
-- esperado: 9 linhas, todas "ok"

-- (3) O JWT simulado chega inteiro na função?
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
-- esperado: admin | true | >700
-- Se papel_lido vier nulo: o claim não chegou (problema da simulação, não do app).
-- Se papel_lido=admin mas funcao_diz_admin=false: a função está errada.
-- Se funcao_diz_admin=true mas temperaturas=0: a policy não foi recriada.

-- (4) O SEU usuário real tem role=admin no app_metadata?
--     Esta é a checagem que vale pra produção — a simulação acima é só teste.
--     Se vier vazio/diferente de "admin", o problema não é a policy: é a conta.
select email,
       coalesce(raw_app_meta_data ->> 'role', '(sem role)') as role_no_app_metadata
  from auth.users
 where email = 'maninthemirror2050@gmail.com';
-- esperado: admin
