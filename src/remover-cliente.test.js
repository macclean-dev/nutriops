import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// "Remover" no Super Admin (21/08). O painel nunca teve essa ação: cliente
// cadastrado ficava na lista pra sempre, inclusive teste e cadastro que deu
// errado. O dono precisou de SQL manual + console do navegador pra tirar dois
// ("TESTE DELETE" e "Fabrizzio Matriz").
//
// A ação é destrutiva e mexe em empresa inteira, então a régua é: a trava vive
// no SERVIDOR, o botão só a apresenta. Guarda de UI é sugestão — device com
// bundle antigo, ou chamada direta na RPC, passa por cima dela.
// ─────────────────────────────────────────────────────────────────────────────

const sql   = readFileSync(`${process.cwd()}/docs/remover-cliente.sql`, 'utf8');
const sync  = readFileSync(`${process.cwd()}/src/tenant-sync.js`, 'utf8');
const view  = readFileSync(`${process.cwd()}/src/superadmin-view.jsx`, 'utf8');

describe('a trava vive no servidor', () => {
  it('delete_tenant é security definer e fechada pro anônimo', () => {
    expect(sql).toContain('create or replace function public.delete_tenant(p_tenant_id text)');
    expect(sql).toContain("language plpgsql security definer set search_path = ''");
    expect(sql).toContain('revoke execute on function public.delete_tenant(text) from anon, public;');
  });

  it('só o admin da PLATAFORMA remove — nem dono de loja, nem RT', () => {
    expect(sql).toMatch(/if coalesce\(auth\.jwt\(\) -> 'app_metadata' ->> 'role', ''\) <> 'admin' then/);
    expect(sql).toMatch(/Só o administrador da plataforma pode remover uma empresa/);
  });

  it('conta evidência ANTES e recusa se houver qualquer registro', () => {
    const posConta = sql.indexOf('foreach v_tabela in array v_evidencia loop');
    const posRecusa = sql.indexOf('if v_total > 0 then');
    const posDelete = sql.indexOf('delete from public.tenants        where id        = p_tenant_id;');
    expect(posConta).toBeGreaterThan(-1);
    expect(posRecusa).toBeGreaterThan(posConta);
    expect(posDelete).toBeGreaterThan(posRecusa);
  });

  it('a lista de evidência cobre os módulos de registro, inclusive a tabela morta', () => {
    // stock_logs está morta no código (v1.9.129) mas viva no banco. Errar pra
    // mais custa um "não deu"; errar pra menos apaga registro sanitário.
    for (const t of ['temperature_records', 'form_records', 'receiving_records',
                     'special_controls', 'corrective_actions', 'pops',
                     'training_sessions', 'rt_validations', 'compliance_docs',
                     'equip_assets', 'maint_logs', 'work_orders', 'stock_logs', 'products']) {
      expect(sql).toContain(`'${t}'`);
    }
  });

  it('config sai junto, e evidência NUNCA é apagada', () => {
    // Só chega no delete se v_total for 0 — ou seja, não existe evidência
    // pra apagar. As tabelas de config (catálogo, equipe, modelos) somem com
    // a empresa porque são cadastro, não registro do que aconteceu.
    expect(sql).toContain("v_config text[] := array[");
    expect(sql).toContain("'equipment_catalog', 'tenant_staff', 'form_templates',");
    const delConfig = sql.indexOf('foreach v_tabela in array v_config loop');
    expect(delConfig).toBeGreaterThan(sql.indexOf('if v_total > 0 then'));
  });

  it('a empresa precisa existir — id errado não passa silencioso', () => {
    expect(sql).toContain("raise exception 'Não existe empresa com o id %.', p_tenant_id using errcode = 'P0002';");
  });

  it('contar_registros_tenant não vaza contagem de loja de terceiro', () => {
    expect(sql).toContain('or public.is_member(p_tenant_id)) then');
    expect(sql).toContain('revoke execute on function public.contar_registros_tenant(text) from anon, public;');
  });
});

describe('tenant-sync — as duas chamadas', () => {
  it('deleteTenantCloud PROPAGA o erro: a recusa é o que o admin precisa ler', () => {
    const ini = sync.indexOf('export async function deleteTenantCloud(tenantId) {');
    const corpo = sync.slice(ini, sync.indexOf('\n}', sync.indexOf('return data;', ini)));
    expect(corpo).toContain('throw new Error(data?.message ?? data?.error ??');
    expect(corpo).not.toMatch(/catch\s*\{\s*return/);
  });

  it('404 vira instrução acionável (o SQL não rodou)', () => {
    expect(sync).toContain('rode docs/remover-cliente.sql no Supabase');
  });

  it('contarRegistrosTenant devolve NULL quando não deu pra saber', () => {
    // null ≠ zero. Confundir os dois viraria "0 registros, pode apagar" numa
    // empresa cheia — a mentira mais cara possível nesta tela.
    const ini = sync.indexOf('export async function contarRegistrosTenant(tenantId) {');
    const corpo = sync.slice(ini, sync.indexOf('\n}', sync.indexOf('return await res.json();', ini)));
    expect(corpo).toContain('if (!res.ok) return null;');
    expect(corpo).toContain('if (!token) return null;');
  });
});

describe('o botão e o modal', () => {
  it('só aparece pra CLIENTE e só quando já suspenso', () => {
    // Loja-seed vive no código, não dá pra remover. E exigir suspensão antes
    // obriga a passar por uma ação reversível primeiro — remover nunca é o
    // primeiro clique ao lado de "Entrar como".
    expect(view).toContain("{t.source==='client' && !t.active && (");
    expect(view).toContain('onClick={() => abrirRemover(t)}>Remover</button>');
  });

  it('abrir o modal CONSULTA antes de oferecer qualquer botão perigoso', () => {
    expect(view).toContain('const { contarRegistrosTenant } = await import(\'./tenant-sync\');');
    expect(view).toContain('carregando: true');
  });

  it('"não deu pra contar" RECUSA — não vira "está vazia"', () => {
    expect(view).toContain('const naoDeuPraContar = !carregando && contagem === null;');
    expect(view).toMatch(/"não sei quantos" não é a mesma coisa que "está vazia"/);
  });

  it('o botão de apagar só existe quando o total é ZERO', () => {
    expect(view).toContain('const vazio = total === 0;');
    expect(view).toContain('{vazio && (');
    // com registro, a tela manda suspender em vez de remover
    expect(view).toMatch(/Use <strong>Suspender<\/strong>/);
  });

  it('mostra a contagem por tabela — o admin decide olhando o número', () => {
    expect(view).toContain('{porTabela.map(([tabela, n]) => <li key={tabela}>{tabela}: {n}</li>)}');
  });

  it('só tira da lista local DEPOIS que a nuvem confirmou', () => {
    // Ordem invertida faria o cliente sumir da tela e VOLTAR no próximo boot
    // (mergeCloudTenants reacrescenta o que está na nuvem), parecendo bug.
    const ini = view.indexOf('const confirmarRemover = async () => {');
    const corpo = view.slice(ini, view.indexOf('\n  };', ini));
    expect(corpo.indexOf('await deleteTenantCloud(t.id);')).toBeLessThan(corpo.indexOf('persistClients('));
  });

  it('a remoção entra no log de auditoria, com destaque', () => {
    expect(view).toContain("logAction({ type: 'delete', tenantId: t.id, tenantName: t.name });");
    expect(view).toContain("delete: 'REMOVEU empresa',");
    // mesma cor de alerta do suspend — é a ação mais grave do painel
    expect(view).toContain("(a.type==='suspend'||a.type==='delete')?'var(--red)'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O teste de aceitação do SQL (21/08). A primeira versão sugeria apontar a
// remoção pra CASA DOCE "pra ver se recusa" — o dono barrou, e com razão: a
// trava existe justamente pro dia em que alguém errar o id, e não vale
// exercitá-la com o dado de produção do lado. Nem com rollback.
//
// O teste agora cria uma empresa DESCARTÁVEL dentro de uma transação que
// termina em rollback, e nunca nomeia cliente nenhum.
// ─────────────────────────────────────────────────────────────────────────────
describe('o teste de aceitação não encosta em cliente real', () => {
  it('nenhum id de cliente aparece no arquivo', () => {
    // bf245c3b-2f9 é a CASA DOCE. Nem em comentário.
    expect(sql).not.toContain('bf245c3b-2f9');
    expect(sql).not.toMatch(/CASA DOCE/i);
  });

  it('usa empresa descartável, com id impossível de colidir', () => {
    expect(sql).toContain("v_id  text := '__teste_remocao__';");
  });

  it('o insert traz access_token — a coluna é NOT NULL', () => {
    // Primeira versão omitia e o script morria no 23502 antes de testar nada.
    expect(sql).toContain('insert into public.tenants (id, access_token, name, segment, plan)');
    expect(sql).toContain("'__token_de_teste_descartavel__'");
  });

  it('DEVOLVE TABELA — warning não era legível no editor do Supabase', () => {
    // A 1ª versão usava `raise warning` e o editor mostra só o resultado do
    // ÚLTIMO comando: os 4 CHECKs ficavam invisíveis e o teste não provava
    // nada. Verificação que não dá pra ler não é verificação.
    expect(sql).toContain('returns table (passo text, resultado text)');
    expect(sql).toContain('select * from public.__teste_remocao();');
    // Só em linha EXECUTÁVEL — o comentário acima cita `raise warning` de
    // propósito, pra explicar por que saiu.
    const executaveis = sql.split('\n').filter((l) => !l.trimStart().startsWith('--'));
    expect(executaveis.join('\n')).not.toContain('raise warning');
  });

  it('limpa a empresa de teste no começo E no fim', () => {
    // Sem a limpeza inicial, uma rodada que morreu no meio deixaria lixo que
    // faria a próxima falhar no primary key.
    const ini = sql.indexOf('create or replace function public.__teste_remocao()');
    const corpo = sql.slice(ini);
    const limpezas = [...corpo.matchAll(/delete from public\.tenants\s+where id\s+= v_id;/g)];
    expect(limpezas.length).toBeGreaterThanOrEqual(2);
  });

  it('a função de teste não fica no banco', () => {
    expect(sql).toContain('drop function if exists public.__teste_remocao();');
  });

  it('cobre os 5 caminhos que importam', () => {
    // com registro recusa · vazia apaga · id inexistente · não-admin · limpeza
    for (const c of ['CHECK 1', 'CHECK 2', 'CHECK 3', 'CHECK 4', 'CHECK 5']) expect(sql).toContain(c);
    expect(sql).toMatch(/apagou uma empresa que tinha registro/);
    expect(sql).toMatch(/deixou passar/);
  });

  it('a exceção esperada não derruba o resto do teste', () => {
    // begin/exception cria subtransação — sem isso o CHECK 1 abortaria tudo.
    expect(sql).toContain('exception when others then');
  });

  it('compara SQLSTATE, não redação da mensagem', () => {
    // A 1ª rodada reportou "X motivo errado" numa recusa CORRETA: o
    // comparador era `like '%não pode ser removida%'` e a mensagem diz "NÃO"
    // em MAIÚSCULA — LIKE diferencia caixa no Postgres. O teste acusou a
    // função de errar quando quem errou foi ele.
    expect(sql).toContain("sqlstate = 'P0001'");   // recusa por evidência
    expect(sql).toContain("sqlstate = 'P0002'");   // empresa não existe
    expect(sql).toContain("sqlstate = '42501'");   // não é admin da plataforma
  });

  it('o texto que ainda é comparado usa ILIKE, não LIKE', () => {
    // Confirmação secundária do SQLSTATE. Se voltar a ser case-sensitive, o
    // mesmo falso negativo volta.
    const ini = sql.indexOf('create or replace function public.__teste_remocao()');
    const corpo = sql.slice(ini);
    expect(corpo).not.toMatch(/sqlerrm like |v_err like /);
    expect([...corpo.matchAll(/ilike '%/g)].length).toBeGreaterThanOrEqual(3);
  });

  it('quando falha, mostra o SQLSTATE recebido — pra diagnosticar de primeira', () => {
    expect(sql).toContain("'X motivo errado (' || sqlstate || '): '");
  });
});
