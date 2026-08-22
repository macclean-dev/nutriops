-- ═══════════════════════════════════════════════════════════════════════════
-- Ativar a operação de uma empresa (sair do modo implantação)
--
-- POR QUE: toda empresa nasce com `implantacao = true` — fase de treino, em
-- que os alertas de pendência ficam suspensos pra não afogar a equipe em
-- "atrasado" enquanto ela aprende. Isso está certo. O que faltava era a saída:
-- o go-live só existia como UPDATE comentado em docs/casadoce-golive.sql, e a
-- CASA DOCE ficou em implantação desde 12/07 — quase um mês e meio com os
-- alertas de turno DESLIGADOS sem ninguém perceber. Foi um dos motivos de os
-- 12 equipamentos parados não terem gerado aviso nenhum (21/08).
--
-- Modo de treino que não tem botão de sair vira modo permanente.
--
-- A ativação é decisão de negócio, não de suporte: a partir dela a loja passa
-- a ser cobrada por pendência e os registros deixam de ser marcados como
-- treino. Por isso é admin da plataforma, e a tela exige digitar o nome da
-- empresa antes de confirmar.
--
-- COMO RODAR: Supabase → SQL Editor → New query → colar TUDO → Run.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_tenant_implantacao(
  p_tenant_id   text,
  p_implantacao boolean
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
begin
  -- Só o admin da PLATAFORMA. Nem dono de loja, nem RT: sair da implantação
  -- muda a régua de cobrança da loja inteira.
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Só o administrador da plataforma pode ativar ou suspender a operação.'
      using errcode = '42501';
  end if;

  select t.name into v_nome from public.tenants t where t.id = p_tenant_id;
  if v_nome is null then
    raise exception 'Não existe empresa com o id %.', p_tenant_id using errcode = 'P0002';
  end if;

  update public.tenants
     set implantacao = p_implantacao,
         -- `go_live_at` guarda a PRIMEIRA ativação e não é reescrito por uma
         -- reativação: é o marco de quando a loja passou a valer como
         -- operação, e sobrescrever apagaria a linha do tempo da evidência.
         go_live_at  = case when p_implantacao then go_live_at
                            else coalesce(go_live_at, now()) end,
         updated_at  = now()
   where id = p_tenant_id;

  return jsonb_build_object(
    'ok', true, 'id', p_tenant_id, 'nome', v_nome, 'implantacao', p_implantacao,
    'go_live_at', (select t.go_live_at from public.tenants t where t.id = p_tenant_id)
  );
end;
$$;

revoke execute on function public.set_tenant_implantacao(text, boolean) from anon, public;
grant  execute on function public.set_tenant_implantacao(text, boolean) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA
-- ═══════════════════════════════════════════════════════════════════════════

select p.proname as funcao,
       p.prosecdef as security_definer,
       has_function_privilege('anon',          p.oid, 'execute') as anon_pode,
       has_function_privilege('authenticated', p.oid, 'execute') as logado_pode
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'set_tenant_implantacao';
-- Esperado: security_definer = true, anon_pode = false, logado_pode = true.


-- ═══════════════════════════════════════════════════════════════════════════
-- TESTE DE ACEITAÇÃO — empresa DESCARTÁVEL, criada e limpa pela função.
-- Devolve TABELA (o editor do Supabase só mostra o último comando).
-- Não aponta pra cliente real: a trava é pro dia em que alguém errar o id.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.__teste_golive()
returns table (passo text, resultado text)
language plpgsql security definer set search_path = '' as $$
declare
  v_id text := '__teste_golive__';
  v_r  jsonb;
begin
  delete from public.tenants where id = v_id;
  insert into public.tenants (id, access_token, name, segment, plan, implantacao)
  values (v_id, '__token_golive_descartavel__', 'TESTE go-live', 'padaria', 'trial', true);

  perform set_config('request.jwt.claims',
    json_build_object('app_metadata', json_build_object('role','admin'))::text, true);

  -- CHECK 1: ativar tira da implantação e carimba a data
  begin
    v_r := public.set_tenant_implantacao(v_id, false);
    passo := 'CHECK 1 — ativar operacao';
    resultado := case when (v_r ->> 'implantacao') = 'false' and (v_r ->> 'go_live_at') is not null
                      then 'OK ativou e carimbou go_live_at'
                      else 'X resposta inesperada: ' || v_r::text end;
  exception when others then
    passo := 'CHECK 1 — ativar operacao'; resultado := 'X FALHOU: ' || sqlerrm;
  end;
  return next;

  -- CHECK 2: voltar pra implantação NÃO apaga o marco original
  declare v_primeiro timestamptz; v_depois timestamptz;
  begin
    select go_live_at into v_primeiro from public.tenants where id = v_id;
    perform public.set_tenant_implantacao(v_id, true);
    select go_live_at into v_depois from public.tenants where id = v_id;
    passo := 'CHECK 2 — voltar pra implantacao preserva go_live_at';
    resultado := case when v_primeiro is not distinct from v_depois
                      then 'OK marco preservado' else 'X apagou o marco original' end;
  exception when others then
    passo := 'CHECK 2 — voltar pra implantacao preserva go_live_at';
    resultado := 'X FALHOU: ' || sqlerrm;
  end;
  return next;

  -- CHECK 3: id inexistente
  begin
    perform public.set_tenant_implantacao('__nao_existe__', false);
    passo := 'CHECK 3 — id inexistente'; resultado := 'X FALHOU: aceitou';
  exception when others then
    passo := 'CHECK 3 — id inexistente';
    resultado := case when sqlstate = 'P0002' then 'OK recusou'
                      else 'X erro inesperado (' || sqlstate || '): ' || sqlerrm end;
  end;
  return next;

  -- CHECK 4: quem não é admin da plataforma
  perform set_config('request.jwt.claims', json_build_object()::text, true);
  begin
    perform public.set_tenant_implantacao(v_id, false);
    passo := 'CHECK 4 — quem nao e admin da plataforma'; resultado := 'X FALHOU: deixou passar!';
  exception when others then
    passo := 'CHECK 4 — quem nao e admin da plataforma';
    resultado := case when sqlstate = '42501' then 'OK barrou'
                      else 'X barrou pelo motivo errado (' || sqlstate || '): ' || sqlerrm end;
  end;
  return next;

  delete from public.tenants where id = v_id;
  passo := 'CHECK 5 — limpeza';
  resultado := case when exists (select 1 from public.tenants where id = v_id)
                    then 'X sobrou a empresa de teste' else 'OK nada sobrou' end;
  return next;
end;
$$;

select * from public.__teste_golive();

drop function if exists public.__teste_golive();

-- ESPERADO: 5 linhas, todas começando com "OK".
