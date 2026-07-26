import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock do repository: refreshSession chama isSupabaseEnabled() e sbAuthFetch
// usa getSupabaseConfig().url. Fixamos os dois pra isolar a lógica de auth.
vi.mock('./repository', () => ({
  isSupabaseEnabled: () => true,
  getSupabaseConfig: () => ({ url: 'https://x.supabase.co', anonKey: 'anon' }),
}));

const KEY = 'nutriops.auth.session';
const withRefreshToken = () => localStorage.setItem(KEY, JSON.stringify({
  accessToken: 'velho', refreshToken: 'rt-valido', expiresAt: 0, user: { name: 'x' },
}));

describe('refreshSession — sessão não pode cair por falta de internet (v1.9.49)', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('QUEDA DE REDE: mantém a sessão (não desloga o PDV offline)', async () => {
    const { refreshSession } = await import('./auth');
    withRefreshToken();
    // fetch rejeitando = exatamente o que o navegador faz sem internet.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    const r = await refreshSession();

    expect(r).toBeNull();                              // não renovou
    expect(localStorage.getItem(KEY)).not.toBeNull();  // ✅ sessão PRESERVADA
  });

  it('SERVIDOR REJEITA (refresh token expirado/revogado): aí sim desloga', async () => {
    const { refreshSession } = await import('./auth');
    withRefreshToken();
    // resposta HTTP real com erro = token inválido de verdade.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, json: () => Promise.resolve({ error_description: 'invalid refresh token' }),
    })));

    const r = await refreshSession();

    expect(r).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();      // ✅ sessão LIMPA (correto)
  });

  it('getValidAccessToken offline devolve null SEM apagar a sessão', async () => {
    const { getValidAccessToken } = await import('./auth');
    // expiresAt no passado (truthy) → isSessionValid=false → força o refresh,
    // que offline falha por rede. (0 seria falsy e o isSessionValid o trataria
    // como "válida pra sempre" — aresta defensiva anotada no relatório.)
    localStorage.setItem(KEY, JSON.stringify({
      accessToken: 'velho', refreshToken: 'rt-valido',
      expiresAt: Date.now() - 1000, user: { name: 'x' },
    }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    const token = await getValidAccessToken();

    expect(token).toBeNull();
    expect(localStorage.getItem(KEY)).not.toBeNull();  // ✅ dá pra tentar de novo quando a rede voltar
  });
});
