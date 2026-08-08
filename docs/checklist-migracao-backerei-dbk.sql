-- ═══════════════════════════════════════════════════════════════════════════
-- Conferência antes de migrar Bäckerei e DBK pro modelo conta-de-loja.
-- Só LEITURA — não altera nada. Rode e compare com o "esperado" de cada bloco.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) As contas existem e estão carimbadas como CONTA DE LOJA?
--    O carimbo isStoreAccount é o que liga a tela "Quem está registrando?".
--    Sem ele a conta loga normal e nunca pede operador — falha silenciosa.
select email,
       coalesce(raw_user_meta_data ->> 'isStoreAccount', 'FALTANDO') as conta_de_loja,
       raw_user_meta_data ->> 'name' as nome,
       case when last_sign_in_at is null then 'nunca entrou' else 'já entrou' end as situacao
  from auth.users
 where email in ('backerei@nutriops.app', 'dbk@nutriops.app')
 order by email;
-- esperado: 2 linhas, conta_de_loja = true nas duas


-- 2) O vínculo com a loja certa está lá?
select u.email, m.tenant_id, m.role
  from public.tenant_members m
  join auth.users u on u.id = m.user_id
 where u.email in ('backerei@nutriops.app', 'dbk@nutriops.app')
 order by u.email;
-- esperado:
--   backerei@nutriops.app | backerei      | Colaborador
--   dbk@nutriops.app      | dbk-producao  | Colaborador


-- 3) Quanto dado cada loja já tem na nuvem?
--    A DBK está listada no CLAUDE.md como a única ainda zerada. Se continuar
--    em 0 depois do 1º login online do aparelho dela, o auto-backfill não
--    rodou e vale investigar — é a pendência 🔴 aberta.
select t.tenant_id,
       count(*) filter (where t.origem = 'temperatura') as temperaturas,
       count(*) filter (where t.origem = 'planilha')    as planilhas,
       count(*) filter (where t.origem = 'equipamento') as equipamentos
  from (
    select tenant_id, 'temperatura' as origem from public.temperature_records
    union all select tenant_id, 'planilha'    from public.form_records
    union all select tenant_id, 'equipamento' from public.equipment_catalog
  ) t
 where t.tenant_id in ('backerei', 'dbk-producao', 'swiss')
 group by t.tenant_id
 order by t.tenant_id;


-- 4) A equipe já foi cadastrada na nuvem? (tenant_staff)
--    Vazio é NORMAL agora: enquanto ninguém cadastrar em Equipe › Usuários, o
--    seletor de operador usa a lista embutida no app — que está desatualizada
--    (tem gente que já saiu). Cadastrar substitui e sincroniza entre aparelhos.
select tenant_id, count(*) as pessoas
  from public.tenant_staff
 where tenant_id in ('backerei', 'dbk-producao', 'swiss')
 group by tenant_id
 order by tenant_id;
