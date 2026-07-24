-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · FASE 2 — Contas reais + vínculos pessoa ↔ empresa
--
-- ORDEM: primeiro CONVIDE as pessoas pelo painel (passo 1, fora daqui), depois
-- rode o SQL de vínculo (passo 2). O vínculo só encontra quem já tem conta.
--
-- ⚠️ NINGUÉM aqui define senha de ninguém. O convite manda um link e a própria
-- pessoa escolhe a senha dela. Você não precisa saber, e não deve.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — Convidar (Supabase → Authentication → Users → "Invite user")
--
--   casadocest@gmail.com   → dona da CASA DOCE
--   <email da Ana Paula>   → RT das 3 unidades
--   <email da Fran>        → supervisora Swiss + Bäckerei
--
-- Cada uma recebe e-mail, clica e define a senha. Só depois rode o PASSO 2.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2a — Conferir quem já aceitou o convite (tem que aparecer antes de
-- vincular; quem não aceitou ainda não existe em auth.users).
-- ─────────────────────────────────────────────────────────────────────────────

select email,
       case when last_sign_in_at is null then 'convidado — ainda não entrou'
            else 'ativo' end as situacao,
       created_at
  from auth.users
 where email in ('casadocest@gmail.com')   -- acrescente os outros e-mails aqui
 order by created_at desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2b — Ver os ids das empresas (só pra conferência visual).
-- ─────────────────────────────────────────────────────────────────────────────

select id, name, segment from public.tenants order by name;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2c — VINCULAR. Casa o e-mail com a empresa pelo NOME, então você não
-- precisa copiar UUID. Idempotente: rodar de novo não duplica.
--
-- Papéis: 'tenant_admin' = dona da loja (cadastra a equipe dela)
--         'Nutricionista RT' | 'Supervisor' | 'Colaborador'
-- ─────────────────────────────────────────────────────────────────────────────

-- CASA DOCE — a dona, com poder de gerir a própria equipe
insert into public.tenant_members (user_id, tenant_id, role)
select u.id, t.id, 'tenant_admin'
  from auth.users u
  join public.tenants t on t.name ilike '%CASA DOCE%'
 where u.email = 'casadocest@gmail.com'
on conflict (user_id, tenant_id) do update set role = excluded.role;


-- ANA PAULA — RT das TRÊS unidades (é isto que o app_metadata escalar não fazia)
-- Descomente e troque o e-mail:
-- insert into public.tenant_members (user_id, tenant_id, role)
-- select u.id, t.id, 'Nutricionista RT'
--   from auth.users u
--   join public.tenants t on t.id in ('swiss','backerei','dbk-producao')
--  where u.email = 'EMAIL_DA_ANA_PAULA'
-- on conflict (user_id, tenant_id) do update set role = excluded.role;


-- FRAN — supervisora de Swiss + Bäckerei
-- Descomente e troque o e-mail:
-- insert into public.tenant_members (user_id, tenant_id, role)
-- select u.id, t.id, 'Supervisor'
--   from auth.users u
--   join public.tenants t on t.id in ('swiss','backerei')
--  where u.email = 'EMAIL_DA_FRAN'
-- on conflict (user_id, tenant_id) do update set role = excluded.role;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — Conferir o resultado. Cada pessoa com suas empresas.
-- ─────────────────────────────────────────────────────────────────────────────

select u.email, m.tenant_id, coalesce(t.name, '(empresa não encontrada)') as empresa, m.role
  from public.tenant_members m
  join auth.users u on u.id = m.user_id
  left join public.tenants t on t.id = m.tenant_id
 order by u.email, empresa;

-- Esperado depois de tudo:
--   casadocest@gmail.com  → CASA DOCE            (tenant_admin)
--   ana paula             → Swiss, Bäckerei, DBK (Nutricionista RT)   ← 3 linhas
--   fran                  → Swiss, Bäckerei      (Supervisor)          ← 2 linhas


-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — desfaz um vínculo específico (a conta em si continua existindo)
-- ─────────────────────────────────────────────────────────────────────────────
-- delete from public.tenant_members m
--  using auth.users u
--  where u.id = m.user_id and u.email = 'EMAIL_AQUI';
