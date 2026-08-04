-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · FASE 2 — Contas reais + vínculos pessoa ↔ empresa
--
-- ORDEM: primeiro CRIE as contas pelo painel do app (passo 1, fora daqui),
-- depois rode o SQL de vínculo (passo 2). O vínculo só encontra quem já tem
-- conta — sem isso o INSERT roda sem erro mas não insere nada (0 linhas).
--
-- ⚠️ Senha inicial é definida ali mesmo, na tela — não é uma senha que eu
-- escolho ou vejo. Combine com cada pessoa por um canal separado (WhatsApp).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — Criar em Equipe → Usuários → "Convidar colaborador", trocando a
-- empresa ativa no seletor do topo antes de cada uma:
--
--   Empresa ativa | E-mail                          | Perfil            | conta de loja?
--   Swiss         | swiss@nutriops.app               | Colaborador       | sim
--   Bäckerei      | backerei@nutriops.app            | Colaborador       | sim
--   DBK Produção  | dbk@nutriops.app                 | Colaborador       | sim
--   Swiss         | fran@backerei.nutriops.app        | Supervisor        | não
--   Swiss         | anapaula@backerei.nutriops.app    | Nutricionista RT  | não
--
-- Fran e Ana Paula entram só pela Swiss aqui — o convite vincula só à empresa
-- ativa no momento. O vínculo delas com as outras lojas é o PASSO 2 abaixo.
-- casadocest@gmail.com já foi criada antes (Fase 1) — segue no SQL só de
-- conferência/idempotência, não precisa recriar.
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
 where email in (
   'casadocest@gmail.com',
   'swiss@nutriops.app', 'backerei@nutriops.app', 'dbk@nutriops.app',
   'fran@backerei.nutriops.app', 'anapaula@backerei.nutriops.app'
 )
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
-- Conta criada via "Convidar colaborador" com Swiss ativa (Nutricionista RT).
-- Este INSERT é idempotente (on conflict), então a linha da Swiss já criada
-- pelo convite só tem o role reafirmado — as novidades são Bäckerei e DBK.
insert into public.tenant_members (user_id, tenant_id, role)
select u.id, tid, 'Nutricionista RT'
  from auth.users u, unnest(array['swiss','backerei','dbk-producao']) as tid
 where u.email = 'anapaula@backerei.nutriops.app'
on conflict (user_id, tenant_id) do update set role = excluded.role;


-- FRAN — supervisora de Swiss + Bäckerei
-- Conta criada via "Convidar colaborador" com Swiss ativa (Supervisor).
-- Idempotente pelo mesmo motivo acima — a novidade é a Bäckerei.
insert into public.tenant_members (user_id, tenant_id, role)
select u.id, tid, 'Supervisor'
  from auth.users u, unnest(array['swiss','backerei']) as tid
 where u.email = 'fran@backerei.nutriops.app'
on conflict (user_id, tenant_id) do update set role = excluded.role;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — Conferir o resultado. Cada pessoa com suas empresas.
-- ─────────────────────────────────────────────────────────────────────────────

select u.email, m.tenant_id, coalesce(t.name, '(empresa não encontrada)') as empresa, m.role
  from public.tenant_members m
  join auth.users u on u.id = m.user_id
  left join public.tenants t on t.id = m.tenant_id
 order by u.email, empresa;

-- Esperado depois de tudo:
--   casadocest@gmail.com          → CASA DOCE            (tenant_admin)
--   swiss@nutriops.app            → Swiss                (Colaborador)   ← conta de loja
--   backerei@nutriops.app         → Bäckerei             (Colaborador)   ← conta de loja
--   dbk@nutriops.app              → DBK Produção         (Colaborador)   ← conta de loja
--   anapaula@backerei.nutriops.app → Swiss, Bäckerei, DBK (Nutricionista RT) ← 3 linhas
--   fran@backerei.nutriops.app     → Swiss, Bäckerei      (Supervisor)        ← 2 linhas
--
-- As 3 contas de loja aparecem com só 1 linha cada — o vínculo delas já saiu
-- certo direto do convite (Colaborador na própria loja), não precisam de
-- PASSO 2. Só Fran e Ana Paula (multi-loja) dependem do INSERT acima.


-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — desfaz um vínculo específico (a conta em si continua existindo)
-- ─────────────────────────────────────────────────────────────────────────────
-- delete from public.tenant_members m
--  using auth.users u
--  where u.id = m.user_id and u.email = 'EMAIL_AQUI';
