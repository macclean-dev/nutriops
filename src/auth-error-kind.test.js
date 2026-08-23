import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  saveSupabaseConfig, getSupabaseAuthError, clearSupabaseAuthError,
  supabaseRepository, clearOfflineQueue,
} from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// O banner vermelho "chave do Supabase inválida" mentia.
//
// O Postgres devolve negação de RLS como HTTP 401 com código 42501 no CORPO.
// Classificando só pelo status, "você não tem permissão nesta loja" virava
// "sua chave está inválida" — e o conselho na tela era trocar uma chave
// perfeitamente boa. Foi o que atrasou o diagnóstico do incidente de 16/08 na
// CASA DOCE, onde os 108 registros estavam intactos e a policy é que estava
// errada.
//
// Estes testes travam a leitura do CORPO antes de classificar.
// ─────────────────────────────────────────────────────────────────────────────

const nega = (status, body) => Promise.resolve({
  ok: false, status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

// repository.js pega o JWT por `await import('./auth')` (linha 85). Sem este
// mock não existe sessão de verdade no teste, memberTokenFor devolve null e
// TODA requisição sairia como anon — que é exatamente o bug que os testes de
// testWrite abaixo travam. O mock só entrega o token; quem decide usá-lo
// continua sendo memberTokenFor (que exige a sessão cobrir o tenant).
vi.mock('./auth', () => ({ getValidAccessToken: async () => 'jwt-de-teste' }));

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue(); clearSupabaseAuthError();
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('classificação do 401 — permissão não é chave', () => {
  it('42501 no corpo vira kind "rls", não "anon"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { code: '42501', message: 'new row violates row-level security policy' })));
    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 }).catch(() => {});
    expect(getSupabaseAuthError()?.kind).toBe('rls');
  });

  it('a frase "row-level security" sozinha também basta', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { message: 'row-level security policy for table' })));
    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 }).catch(() => {});
    expect(getSupabaseAuthError()?.kind).toBe('rls');
  });

  it('401 SEM sinal de RLS continua sendo problema de credencial', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { message: 'Invalid API key' })));
    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 }).catch(() => {});
    const err = getSupabaseAuthError();
    expect(err).toBeTruthy();
    expect(err.kind).not.toBe('rls');
  });

  it('falhas seguidas do mesmo tipo são contadas — é o que segura o alarme', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { code: '42501' })));
    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 }).catch(() => {});
    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 }).catch(() => {});
    expect(getSupabaseAuthError()?.falhas).toBeGreaterThanOrEqual(2);
  });
});

describe('testWrite — o healthcheck do boot classificava tudo como chave ruim', () => {
  // A sonda agora EXIGE a credencial da pessoa (ver comSessao). Sem isso ela
  // saía como anon e a classificação abaixo nunca era exercitada de verdade.
  // `user.id` é obrigatório desde 21/08: a sonda carimba o uid na linha pra
  // a policy saber de quem ela é (e o DELETE não apagar a dos outros).
  const comSessao = () => localStorage.setItem('nutriops.session',
    JSON.stringify({ tenantId: 'casadoce', accessToken: 'jwt-de-teste', user: { id: 'uid-de-teste' } }));

  it('RLS no healthcheck vira "rls"', async () => {
    comSessao();
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { code: '42501', message: 'row-level security' })));
    const r = await supabaseRepository.testWrite('casadoce');
    expect(r.reason).toBe('rls_blocked');
    expect(getSupabaseAuthError()?.kind).toBe('rls');   // antes: 'anon' → "chave inválida"
  });

  it('401 sem RLS no healthcheck NÃO é classificado como rls', async () => {
    comSessao();
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { message: 'Invalid API key' })));
    const r = await supabaseRepository.testWrite('casadoce');
    expect(r.reason).toBe('auth_error');
    expect(getSupabaseAuthError()?.kind).not.toBe('rls');
  });

  it('não vaza o marcador interno _comJwt como header HTTP', async () => {
    comSessao();
    const spy = vi.fn(() => nega(500, 'erro qualquer'));
    vi.stubGlobal('fetch', spy);
    await supabaseRepository.testWrite('casadoce');
    const headers = spy.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty('_comJwt');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O texto do banner vive em pages.jsx (componente pesado). O que não pode
// voltar é ele afirmar "chave inválida" pra uma negação de permissão.
// ─────────────────────────────────────────────────────────────────────────────
describe('pages.jsx — o banner não pode acusar a chave sem saber', () => {
  const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  it('a mensagem antiga, que afirmava chave inválida, saiu', () => {
    expect(fonte).not.toContain('chave do Supabase inválida');
  });

  it('existe caminho próprio pra falta de permissão', () => {
    expect(fonte).toContain("err.kind === 'rls'");
    expect(fonte).toContain('sem permissão para esta loja');
    expect(fonte).toContain('A chave está certa');
  });

  it('uma falha isolada não pinta a tela de vermelho', () => {
    expect(fonte).toMatch(/if \(\(err\.falhas \?\? 1\) < 2\) return null/);
  });

  it('o botão "Reconectar" não aparece quando o problema não é conexão', () => {
    expect(fonte).toContain('canFix && !sessaoExpirando && !semPermissao');
  });
});
