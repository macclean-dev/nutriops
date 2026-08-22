-- ═══════════════════════════════════════════════════════════════════════════
-- Remover cliente do painel — RPC com trava de evidência
--
-- POR QUE: o Super Admin nunca teve ação "Remover". Uma vez cadastrado, o
-- cliente ficava na lista pra sempre — inclusive teste e cadastro que deu
-- errado. Em 21/08 o dono precisou de SQL manual + console do navegador pra
-- tirar dois ("TESTE DELETE" e "Fabrizzio Matriz").
--
-- POR QUE PRECISA SER RPC (e não DELETE direto do app): a tabela `tenants`
-- está com RLS deny-all e grants revogados de anon desde
-- docs/security-tenants-lockdown.sql — o app só a alcança por função
-- `security definer`. E apagar só no localStorage seria INÚTIL:
-- `mergeCloudTenants` (tenant-sync.js) reacrescenta o que existir na nuvem no
-- próximo boot.
--
-- A TRAVA VIVE AQUI, NO SERVIDOR, não no botão: se houver QUALQUER registro
-- de evidência do cliente, a função RECUSA. Guarda no cliente é sugestão —
-- um device com bundle antigo, ou alguém chamando a RPC direto, passaria por
-- cima. Evidência sanitária (RDC 216) não pode depender disso.
--
-- O QUE APAGA: a linha em `tenants`, o vínculo das pessoas (`tenant_members`)
-- e as tabelas de CONFIGURAÇÃO (catálogo de equipamentos, equipe, modelos de
-- planilha, regras de validade, config de capacitação, perfil da empresa).
-- O QUE NUNCA APAGA: nada — porque se houvesse evidência a função já teria
-- recusado antes de chegar no delete.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.delete_tenant(p_tenant_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tabela   text;
  v_qtd      bigint;
  v_total    bigint := 0;
  v_detalhe  jsonb  := '{}'::jsonb;
  v_nome     text;
  -- EVIDÊNCIA: o que a fiscalização olha. Qualquer linha aqui bloqueia.
  -- Deliberadamente generoso — inclui `products` e `stock_logs` (morta no
  -- código, viva no banco). Errar pra mais custa um "não deu"; errar pra
  -- menos apaga registro sanitário.
  v_evidencia text[] := array[
    'temperature_records', 'form_records', 'receiving_records', 'products',
    'special_controls', 'stock_logs', 'corrective_actions', 'pops',
    'training_sessions', 'rt_validations', 'compliance_docs',
    'equip_assets', 'maint_logs', 'work_orders'
  ];
  -- CONFIGURAÇÃO: some junto com o cliente. Não é registro de nada que
  -- aconteceu — é cadastro de como a loja é.
  v_config text[] := array[
    'equipment_catalog', 'tenant_staff', 'form_templates',
    'validity_rules', 'training_config', 'company_profile'
  ];
begin
  -- ── 1) Só o admin da PLATAFORMA ─────────────────────────────────────────
  -- Nem dono de loja, nem RT. Apagar empresa não é operação de cliente.
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Só o administrador da plataforma pode remover uma empresa.'
      using errcode = '42501';
  end if;

  if coalesce(trim(p_tenant_id), '') = '' then
    raise exception 'Empresa não informada.' using errcode = '22023';
  end if;

  select t.name into v_nome from public.tenants t where t.id = p_tenant_id;
  if v_nome is null then
    raise exception 'Não existe empresa com o id %.', p_tenant_id using errcode = 'P0002';
  end if;

  -- ── 2) A TRAVA: existe evidência? ───────────────────────────────────────
  foreach v_tabela in array v_evidencia loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tabela)
      into v_qtd using p_tenant_id;
    if v_qtd > 0 then
      v_total := v_total + v_qtd;
      v_detalhe := v_detalhe || jsonb_build_object(v_tabela, v_qtd);
    end if;
  end loop;

  if v_total > 0 then
    raise exception 'A empresa "%" tem % registro(s) e NÃO pode ser removida: %. Suspenda em vez de remover — registro sanitário não se apaga.',
      v_nome, v_total, v_detalhe::text
      using errcode = 'P0001';
  end if;

  -- ── 3) Sem evidência: apaga configuração, vínculo e a empresa ───────────
  foreach v_tabela in array v_config loop
    execute format('delete from public.%I where tenant_id = $1', v_tabela) using p_tenant_id;
  end loop;

  delete from public.tenant_members where tenant_id = p_tenant_id;
  delete from public.tenants        where id        = p_tenant_id;

  return jsonb_build_object('ok', true, 'id', p_tenant_id, 'nome', v_nome);
end;
$$;

revoke execute on function public.delete_tenant(text) from anon, public;
grant  execute on function public.delete_tenant(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- Contagem de registros de uma empresa — o botão mostra isso ANTES de apagar,
-- e o dossiê/relatório podem reusar. Mesma régua da trava acima.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.contar_registros_tenant(p_tenant_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tabela  text;
  v_qtd     bigint;
  v_total   bigint := 0;
  v_detalhe jsonb  := '{}'::jsonb;
  v_evidencia text[] := array[
    'temperature_records', 'form_records', 'receiving_records', 'products',
    'special_controls', 'stock_logs', 'corrective_actions', 'pops',
    'training_sessions', 'rt_validations', 'compliance_docs',
    'equip_assets', 'maint_logs', 'work_orders'
  ];
begin
  -- Admin da plataforma, ou quem é membro da própria empresa (o dono pode
  -- querer saber quanto tem). Nunca vaza contagem de loja de terceiro.
  if not (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
          or public.is_member(p_tenant_id)) then
    raise exception 'Sem permissão para consultar esta empresa.' using errcode = '42501';
  end if;

  foreach v_tabela in array v_evidencia loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tabela)
      into v_qtd using p_tenant_id;
    v_total := v_total + v_qtd;
    if v_qtd > 0 then v_detalhe := v_detalhe || jsonb_build_object(v_tabela, v_qtd); end if;
  end loop;

  return jsonb_build_object('total', v_total, 'porTabela', v_detalhe);
end;
$$;

revoke execute on function public.contar_registros_tenant(text) from anon, public;
grant  execute on function public.contar_registros_tenant(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════════

select p.proname as funcao,
       p.prosecdef as security_definer,
       has_function_privilege('anon',          p.oid, 'execute') as anon_pode,
       has_function_privilege('authenticated', p.oid, 'execute') as logado_pode
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('delete_tenant', 'contar_registros_tenant')
 order by p.proname;
-- Esperado: 2 linhas, security_definer = true, anon_pode = false, logado_pode = true.


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTE DE ACEITAÇÃO — em empresa DESCARTÁVEL, criada e desfeita aqui dentro.
--
-- NÃO aponte este teste pra um cliente real, nem pra "ver se recusa". A trava
-- é justamente pra o dia em que alguém errar o id; não vale exercitá-la com o
-- dado de produção do lado. (Pedido do dono, 21/08 — e ele está certo.)
--
-- O bloco inteiro roda dentro de uma transação que termina em ROLLBACK: a
-- empresa de teste nunca chega a existir de verdade, e nada é apagado.
-- Rode TUDO de uma vez (não selecione trecho) — o rollback está no fim.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Empresa descartável, id impossível de colidir com cliente.
insert into public.tenants (id, name, segment, plan)
values ('__teste_remocao__', 'TESTE de remoção', 'padaria', 'trial');

-- Uma leitura de temperatura: é o que precisa fazer a remoção RECUSAR.
insert into public.temperature_records
  (id, tenant_id, tenant_name, equipment_input, equipment_key, measured_at,
   value, min_value, max_value, user_name, user_role, created_at)
values (gen_random_uuid(), '__teste_remocao__', 'TESTE de remoção', 'Freezer',
        'Freezer', '08:00', -18, -22, -18, 'teste', 'Colaborador', now());

do $$
declare v_erro text; v_res jsonb;
begin
  -- Vira "admin da plataforma" só dentro desta transação.
  perform set_config('request.jwt.claims',
    json_build_object('app_metadata', json_build_object('role','admin'))::text, true);

  -- ── CHECK 1: COM registro, tem que recusar ────────────────────────────
  -- O bloco begin/exception cria uma subtransação: a exceção esperada não
  -- derruba o resto do teste.
  begin
    perform public.delete_tenant('__teste_remocao__');
    raise warning 'CHECK 1: ✕ FALHOU — apagou uma empresa COM registro!';
  exception when others then
    v_erro := sqlerrm;
    if v_erro like '%não pode ser removida%' then
      raise warning 'CHECK 1: ✓ recusou como devia — %', v_erro;
    else
      raise warning 'CHECK 1: ✕ recusou pelo motivo ERRADO — %', v_erro;
    end if;
  end;

  -- ── CHECK 2: SEM registro, tem que apagar ─────────────────────────────
  delete from public.temperature_records where tenant_id = '__teste_remocao__';
  begin
    v_res := public.delete_tenant('__teste_remocao__');
    raise warning 'CHECK 2: ✓ removeu a empresa vazia — %', v_res::text;
  exception when others then
    raise warning 'CHECK 2: ✕ FALHOU — não removeu empresa vazia: %', sqlerrm;
  end;

  -- ── CHECK 3: id que não existe tem que dar erro claro ─────────────────
  begin
    perform public.delete_tenant('__nao_existe__');
    raise warning 'CHECK 3: ✕ FALHOU — aceitou id inexistente';
  exception when others then
    if sqlerrm like '%Não existe empresa%' then
      raise warning 'CHECK 3: ✓ id inexistente recusado';
    else
      raise warning 'CHECK 3: ✕ erro inesperado — %', sqlerrm;
    end if;
  end;

  -- ── CHECK 4: sem ser admin da plataforma, tem que barrar ──────────────
  perform set_config('request.jwt.claims', json_build_object()::text, true);
  begin
    perform public.delete_tenant('__teste_remocao__');
    raise warning 'CHECK 4: ✕ FALHOU — deixou não-admin remover!';
  exception when others then
    if sqlerrm like '%administrador da plataforma%' then
      raise warning 'CHECK 4: ✓ barrou quem não é admin da plataforma';
    else
      raise warning 'CHECK 4: ✕ barrou pelo motivo errado — %', sqlerrm;
    end if;
  end;
end $$;

-- Desfaz TUDO: a empresa de teste e a leitura nunca existiram.
rollback;

-- Confirmação de que não sobrou nada (roda depois do rollback):
select count(*) as sobrou_teste from public.tenants where id = '__teste_remocao__';
-- Esperado: 0

-- ⚠️ Os 4 CHECKs saem como WARNING. No Supabase SQL Editor eles aparecem no
-- painel de mensagens/logs abaixo do resultado. Os quatro precisam mostrar ✓.
