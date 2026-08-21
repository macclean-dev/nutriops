import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { saveSupabaseConfig, supabaseRepository, clearOfflineQueue } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// VARREDURA (21/08) — depois de TRÊS bugs no mesmo dia com a mesma raiz:
// credencial faltando fazendo a requisição sair com a CHAVE ANÔNIMA, que o RLS
// recusa com 42501 porque a policy chama `is_member()`, revogada de anon.
//
//   1. healthcheck do boot — `sbHeaders()` sem argumento (v1.9.194)
//   2. auto-sync do admin global — `session.tenantId` null por design (v1.9.190)
//   3. cadastro de cliente — sessão de PIN sem accessToken (v1.9.201)
//
// Os três descobertos por acaso, nenhum por alarme do próprio sistema. A
// varredura achou mais dois pontos, corrigidos aqui.
//
// Nota: existem TRÊS `sbHeaders` no projeto e só uma é a arriscada.
// `tenant-sync.js` e `auth.jsx` têm homônimas que usam a anon key DE PROPÓSITO
// — rodam antes de existir sessão (onboarding por ?token=, login). Não
// confundir ao ler o código.
// ─────────────────────────────────────────────────────────────────────────────

const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');

const nega = (status, body) => Promise.resolve({
  ok: false, status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ACHADO 1 — pushModule saía como anon e nunca poderia funcionar', () => {
  it('foi removido, não "consertado"', () => {
    // Chamava `sbFetch(table, {...})` sem tenantId: anon, 42501, TODO registro
    // recusado. Estava exportado e sem nenhum chamador desde sempre — quem
    // fosse usar herdava o bug pronto. Manter dead code quebrado é pior que
    // não ter. Mesmo tratamento que pushTenantDirect já tinha recebido.
    expect(repo).not.toContain('export async function pushModule');
    expect(repo).toContain('// (pushModule removido em 21/08');
  });

  it('o substituto legítimo passa o tenant em cada chamada', () => {
    // migrateAllToSupabase faz push em lote passando `id` — é pra lá que quem
    // precisar disso deve olhar.
    expect(repo).toContain('export async function migrateAllToSupabase');
  });
});

describe('ACHADO 2 — "Testar conexão" acusava chave boa de inválida', () => {
  const fn = (() => {
    const ini = repo.indexOf('async testConnection(override) {');
    return repo.slice(ini, repo.indexOf('\n  },', ini));
  })();

  it('lê o CORPO antes de culpar a chave', () => {
    // O teste vai de propósito com a anon key (roda antes de existir sessão).
    // Com RLS ligado a policy chama is_member(), revogada de anon, e o
    // Postgres devolve 401 com 42501 no corpo. Classificando só pelo status,
    // chave PERFEITA virava "✕ Chave inválida" — o mesmo conselho errado que
    // atrasou o diagnóstico de 16/08.
    expect(fn).toContain('const corpo = await res.text().catch(() => \'\');');
    expect(fn).toContain("if (corpo.includes('row-level security') || corpo.includes('42501'))");
  });

  it('42501 vira SUCESSO — ele prova que a conexão está boa', () => {
    // Pra o Postgres chegar a avaliar permissão, ele já aceitou a chave e
    // achou a tabela. Chave inválida morre antes, com outra mensagem.
    expect(fn).toContain('return { ok: true, viaRls: true };');
  });

  it('401 SEM sinal de RLS continua sendo problema de credencial', () => {
    expect(fn).toContain("return { ok: false, reason: 'auth_error' };");
  });
});

describe('o comportamento de testConnection, com fetch mockado', () => {
  it('42501 no corpo devolve ok:true', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { code: '42501', message: 'permission denied' })));
    const r = await supabaseRepository.testConnection();
    expect(r.ok).toBe(true);
    expect(r.viaRls).toBe(true);
  });

  it('a frase "row-level security" sozinha também basta', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { message: 'row-level security policy' })));
    expect((await supabaseRepository.testConnection()).ok).toBe(true);
  });

  it('chave realmente inválida continua reprovando', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { message: 'Invalid API key' })));
    const r = await supabaseRepository.testConnection();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('auth_error');
  });

  it('tabela ausente continua distinta de credencial', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(404, 'not found')));
    expect((await supabaseRepository.testConnection()).reason).toBe('table_missing');
  });

  it('200 continua sendo sucesso simples', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200 })));
    const r = await supabaseRepository.testConnection();
    expect(r.ok).toBe(true);
    expect(r.viaRls).toBeUndefined();
  });
});

describe('o resto da varredura — o que ficou limpo', () => {
  it('toda chamada a sbFetch passa um identificador de loja', () => {
    // Conta os argumentos de TOPO de cada chamada, equilibrando parênteses —
    // regex simples casa entre chamadas e dá falso negativo. 53 chamadas,
    // todas com 3º argumento (tenantId / id / input.tenantId /
    // payload?.tenant_id); a única sem era o pushModule, agora removido.
    const semTenant = [];
    let i = -1;
    while ((i = repo.indexOf('sbFetch(', i + 1)) !== -1) {
      if (repo.slice(Math.max(0, i - 20), i).includes('function ')) continue; // a definição
      // Pula menção dentro de COMENTÁRIO — o próprio comentário que explica a
      // remoção do pushModule cita `sbFetch(table, {...})` e virava achado.
      const inicioLinha = repo.lastIndexOf('\n', i) + 1;
      const prefixo = repo.slice(inicioLinha, i).trimStart();
      if (prefixo.startsWith('//') || prefixo.startsWith('*')) continue;
      let nivel = 0, virgulas = 0, fim = i + 'sbFetch('.length;
      for (; fim < repo.length; fim++) {
        const ch = repo[fim];
        if ('(['.includes(ch) || ch === '{') nivel++;
        else if (')]'.includes(ch) || ch === '}') { if (ch === ')' && nivel === 0) break; nivel--; }
        else if (ch === ',' && nivel === 0) virgulas++;
      }
      if (virgulas + 1 < 3) semTenant.push(repo.slice(i, i + 70));
    }
    expect(semTenant).toEqual([]);
  });

  it('as duas funções de foto repassam o tenantId pro storage', () => {
    expect(repo).toContain('export async function uploadFormPhoto(tenantId, blob, meta) {');
    expect(repo).toContain('export async function signedPhotoUrl(tenantId, path, segundos = 3600) {');
    const usos = [...repo.matchAll(/const \{ Authorization \} = await sbHeaders\(tenantId\);/g)];
    expect(usos).toHaveLength(2);
  });

  it('sbHeaders sem argumento não existe mais no arquivo', () => {
    // Era a assinatura do healthcheck antes da v1.9.194. Qualquer volta dela
    // significa alguma requisição saindo como anon de novo.
    expect(repo).not.toMatch(/await sbHeaders\(\)/);
  });
});
