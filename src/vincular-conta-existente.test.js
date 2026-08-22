import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// "Vincular conta existente" (21/08) — o botão que faltava pra multi-unidade.
//
// O convite (Edge Function invite-collaborator) SÓ cria conta nova. Com e-mail
// já cadastrado ele devolve 409 dizendo "Peça a um administrador para vinculá-la
// a esta empresa" — e não existia nenhuma interface pra isso: o administrador
// tinha que rodar INSERT à mão em tenant_members.
//
// Isso travava o caso real da CASA DOCE (21/08) abrindo unidades novas: o app
// NÃO suporta N lojas dentro de um tenant (multiStore/stores são metadata morta
// — nunca `true` em lugar nenhum), então cada unidade é um TENANT novo, e a
// dona + a nutricionista já têm conta. Sem o vínculo, cada abertura de loja
// dependia de SQL manual.
//
// A escolha de RPC (e não Edge Function) é deliberada: vincular não cria conta
// nem mexe em senha, então não precisa da service_role — só ler auth.users e
// inserir em tenant_members, os dois dentro de um `security definer`. Mesmo
// padrão do list_tenant_members que já está em produção.
// ─────────────────────────────────────────────────────────────────────────────

const sql   = readFileSync(`${process.cwd()}/docs/vincular-conta-existente.sql`, 'utf8');
const sync  = readFileSync(`${process.cwd()}/src/tenant-sync.js`, 'utf8');
const views = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');
const perms = readFileSync(`${process.cwd()}/src/permissions.js`, 'utf8');

describe('a RPC — as checagens vivem no SERVIDOR, não no formulário', () => {
  it('é security definer e fechada pro anônimo', () => {
    expect(sql).toMatch(/create or replace function public\.link_existing_member\(/);
    expect(sql).toContain('language plpgsql security definer set search_path = \'\'');
    expect(sql).toContain('revoke execute on function public.link_existing_member(text, text, text) from anon, public;');
    expect(sql).toContain('grant  execute on function public.link_existing_member(text, text, text) to authenticated;');
  });

  it('só dono da loja, RT da loja ou admin da plataforma podem vincular', () => {
    // Mesma régua do convite. Vincular abre a MESMA porta que convidar (acesso
    // aos dados desta empresa), então o poder tem que ser o mesmo — nem mais
    // frouxo (RT de fora vinculando gente), nem mais apertado (RT já convida).
    expect(sql).toContain("v_is_admin := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';");
    expect(sql).toMatch(/if not \(v_is_admin or v_my_role in \('tenant_admin', 'Nutricionista RT'\)\) then/);
    expect(sql).toContain("raise exception 'Você não administra esta empresa.' using errcode = '42501';");
  });

  it('lê o papel de quem chama do BANCO, não do JWT', () => {
    // tenant_members é a fonte — o JWT carrega user_metadata que o próprio
    // usuário edita via updateUser. Mesma regra das policies de RLS.
    expect(sql).toMatch(/select m\.role into v_my_role\s*\n\s*from public\.tenant_members m\s*\n\s*where m\.user_id = auth\.uid\(\) and m\.tenant_id = p_tenant_id;/);
    // o único ponto que lê o JWT é app_metadata (que só o service_role escreve)
    const jwtReads = [...sql.matchAll(/auth\.jwt\(\)/g)];
    expect(jwtReads).toHaveLength(1);
    expect(sql).not.toContain("user_metadata ->> 'role'");
  });

  it('o papel pedido passa por allowlist — não dá pra inventar "admin"', () => {
    expect(sql).toContain("if p_role not in ('Colaborador', 'Supervisor', 'Nutricionista RT', 'tenant_admin') then");
    expect(sql).not.toMatch(/p_role in \([^)]*'admin'[^)]*\)/);
  });

  it('RT não promove ninguém a dono da loja', () => {
    expect(sql).toContain("if p_role = 'tenant_admin' and not (v_is_admin or v_my_role = 'tenant_admin') then");
  });

  it('conta inexistente dá erro claro que empurra pro convite', () => {
    expect(sql).toMatch(/if v_user\.id is null then/);
    expect(sql).toContain('Use "Convidar colaborador" para criar uma.');
  });
});

describe('os dois vetos que evitam estrago silencioso', () => {
  it('não vincula o admin da PLATAFORMA — isso o rebaixaria sem avisar', () => {
    // isGlobalAdmin exige memberTenants VAZIO. Vincular o admin a uma loja o
    // transforma em admin de loja e ele perde a área Super Admin, em silêncio.
    expect(perms).toContain('if (session.memberTenants?.length > 0) return false;');
    expect(sql).toContain("if coalesce(v_user.raw_app_meta_data ->> 'role', '') = 'admin' then");
    expect(sql).toMatch(/perder o acesso global/);
  });

  it('não vincula conta de LOJA — o tablet de uma unidade não grava na outra', () => {
    // Conta de loja é o login compartilhado do aparelho do balcão. Vinculada a
    // duas empresas, ela gravaria evidência sanitária na unidade errada.
    expect(sql).toContain("if coalesce(v_user.raw_user_meta_data ->> 'isStoreAccount', 'false') = 'true' then");
    expect(sql).toMatch(/ela pertence a uma unidade só/);
  });

  it('os dois vetos vêm ANTES do insert', () => {
    const posAdmin = sql.indexOf("raw_app_meta_data ->> 'role', '') = 'admin'");
    const posLoja  = sql.indexOf("raw_user_meta_data ->> 'isStoreAccount'");
    const posIns   = sql.indexOf('insert into public.tenant_members');
    expect(posAdmin).toBeGreaterThan(-1);
    expect(posLoja).toBeGreaterThan(-1);
    expect(posIns).toBeGreaterThan(posAdmin);
    expect(posIns).toBeGreaterThan(posLoja);
  });

  it('vincular de novo atualiza o papel em vez de estourar', () => {
    expect(sql).toContain('on conflict (user_id, tenant_id) do update set role = excluded.role;');
    // e a UI precisa saber diferenciar "novo vínculo" de "já estava lá"
    expect(sql).toContain("'ja_existia', (v_existente is not null)");
  });

  it('RETURNS JSONB — parâmetro de saída colidia com nome de coluna', () => {
    // Quebrou em produção (21/08): `returns table (user_id uuid, ...)` faz
    // esses nomes virarem VARIÁVEIS no plpgsql, e o `on conflict (user_id,
    // tenant_id)` vira ambíguo — "column reference user_id is ambiguous".
    // jsonb não tem parâmetro de saída, então a colisão não pode voltar.
    expect(sql).toContain('returns jsonb');
    expect(sql).toContain('return jsonb_build_object(');
    // Só em linha EXECUTÁVEL: o comentário logo acima da função cita o
    // `returns table (user_id ...)` de propósito, pra explicar por que saiu.
    const executaveis = sql.split('\n').filter((l) => !l.trimStart().startsWith('--'));
    expect(executaveis.join('\n')).not.toMatch(/returns table \(user_id/);
  });

  it('tem DROP antes — Postgres não troca tipo de retorno com create or replace', () => {
    const posDrop = sql.indexOf('drop function if exists public.link_existing_member(text, text, text);');
    const posCreate = sql.indexOf('create or replace function public.link_existing_member(');
    expect(posDrop).toBeGreaterThan(-1);
    expect(posCreate).toBeGreaterThan(posDrop);
  });
});

describe('linkExistingMember (tenant-sync.js) — propaga o erro em vez de engolir', () => {
  it('manda os 3 parâmetros com o prefixo p_ que o PostgREST exige', () => {
    expect(sync).toContain('export async function linkExistingMember({ tenantId, email, role = \'Colaborador\' }) {');
    expect(sync).toContain("body: JSON.stringify({ p_tenant_id: tenantId, p_email: email, p_role: role }),");
    expect(sync).toContain('/rpc/link_existing_member');
  });

  it('NÃO tem o catch-que-devolve-vazio das irmãs — o formulário precisa do motivo', () => {
    const ini = sync.indexOf('export async function linkExistingMember');
    const corpo = sync.slice(ini, sync.indexOf('\n}', sync.indexOf('return { userId', ini)));
    // fetchMemberTenants/fetchTenantModules terminam em `catch { return []; }`.
    // Aqui isso viraria um botão que não faz nada e não diz por quê.
    expect(corpo).not.toMatch(/catch\s*\{\s*return\s*\[\]/);
    expect(corpo).toContain('throw new Error(data?.message ?? data?.error ??');
  });

  it('404 vira instrução acionável (o SQL não rodou), não "erro desconhecido"', () => {
    expect(sync).toContain('rode docs/vincular-conta-existente.sql no Supabase');
  });

  it('resposta sem user_id não passa por sucesso', () => {
    // Checa o CAMPO, não só a existência do objeto: a RPC quebrada devolvia
    // resposta que não era vínculo nenhum, e um `if (!row)` deixaria passar.
    expect(sync).toContain('const row = Array.isArray(data) ? data[0] : data;');
    expect(sync).toContain('if (!row?.user_id) throw new Error(');
  });
});

describe('a UI na tela de Usuários', () => {
  it('o card existe e só aparece pra quem pode convidar', () => {
    const ini = views.indexOf('<h2>Vincular conta existente</h2>');
    expect(ini).toBeGreaterThan(-1);
    // o card está dentro de um `{canInvite && (` — mesma guarda do convite
    const antes = views.slice(0, ini);
    expect(antes.lastIndexOf('{canInvite && (')).toBeGreaterThan(antes.lastIndexOf('</article>') - 400);
  });

  it('valida o e-mail antes de chamar o servidor', () => {
    expect(views).toContain("if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) { setLnkMsg({ tone:'danger', text:'E-mail inválido.' }); return; }");
  });

  it('o erro do servidor chega na tela — não vira toast genérico nem console', () => {
    expect(views).toContain("setLnkMsg({ tone:'danger', text: e.message });");
  });

  it('distingue vínculo novo de atualização de papel', () => {
    expect(views).toContain('r.jaExistia');
    expect(views).toMatch(/já fazia parte de/);
    expect(views).toMatch(/agora também acessa/);
  });

  it('explica que a pessoa mantém o mesmo login', () => {
    // Sem isso o dono cria uma SEGUNDA conta pra mesma pessoa e os registros
    // dela ficam divididos entre dois nomes na trilha de auditoria.
    expect(views).toMatch(/MESMO e-mail e senha/);
    expect(views).toMatch(/os registros dela ficariam divididos entre dois nomes/);
  });

  it('recarrega a lista de membros no sucesso', () => {
    const ini = views.indexOf('const handleLink = async () => {');
    const corpo = views.slice(ini, views.indexOf('setLinking(false);', ini));
    expect(corpo).toContain('loadMembers();');
  });

  it('o botão trava enquanto envia (sem duplo clique = duplo vínculo)', () => {
    expect(views).toContain("disabled={linking || !lnkEmail}>{linking ? 'Vinculando…' : 'Vincular a esta empresa'}");
  });
});

describe('o comportamento, com o fetch mockado', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.localStorage = {
      _d: { 'nutriops.session': JSON.stringify({ accessToken: 'tok', tenantId: 'x' }) },
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    };
  });
  afterEach(() => { globalThis.fetch = origFetch; vi.resetModules(); });

  const carregar = async () => {
    vi.resetModules();
    vi.doMock('./auth', () => ({ getValidAccessToken: async () => 'tok' }));
    return await import('./tenant-sync');
  };

  it('vínculo novo devolve jaExistia:false', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ([{ user_id: 'u1', email: 'a@b.com', name: 'Ana', role: 'Nutricionista RT', ja_existia: false }]),
    }));
    const m = await carregar();
    if (!m.isTenantSyncEnabled()) return; // sem env no CI — as asserções de fonte já cobrem
    const r = await m.linkExistingMember({ tenantId: 't2', email: 'a@b.com', role: 'Nutricionista RT' });
    expect(r).toEqual({ userId: 'u1', email: 'a@b.com', name: 'Ana', role: 'Nutricionista RT', jaExistia: false });
  });

  it('a mensagem do raise exception chega intacta em quem chamou', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ message: 'Não existe conta com o e-mail x@y.com. Use "Convidar colaborador" para criar uma.' }),
    }));
    const m = await carregar();
    if (!m.isTenantSyncEnabled()) return;
    await expect(m.linkExistingMember({ tenantId: 't2', email: 'x@y.com' }))
      .rejects.toThrow(/Não existe conta com o e-mail/);
  });

  it('array vazio NÃO passa por sucesso', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ([]) }));
    const m = await carregar();
    if (!m.isTenantSyncEnabled()) return;
    await expect(m.linkExistingMember({ tenantId: 't2', email: 'a@b.com' }))
      .rejects.toThrow(/não confirmou o vínculo/);
  });
});
