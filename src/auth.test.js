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

  it('SERVIDOR 503 (transitório): mantém a sessão — não desloga por instabilidade', async () => {
    const { refreshSession } = await import('./auth');
    withRefreshToken();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 503, json: () => Promise.resolve({ msg: 'service unavailable' }),
    })));
    const r = await refreshSession();
    expect(r).toBeNull();
    expect(localStorage.getItem(KEY)).not.toBeNull();  // ✅ preservada
  });

  it('SERVIDOR 429 (throttle): mantém a sessão', async () => {
    const { refreshSession } = await import('./auth');
    withRefreshToken();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 429, json: () => Promise.resolve({ msg: 'too many requests' }),
    })));
    const r = await refreshSession();
    expect(r).toBeNull();
    expect(localStorage.getItem(KEY)).not.toBeNull();  // ✅ preservada
  });

  it('SERVIDOR 401 (token revogado): LIMPA a sessão — segurança não regride', async () => {
    const { refreshSession } = await import('./auth');
    withRefreshToken();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 401, json: () => Promise.resolve({ error_description: 'invalid refresh token' }),
    })));
    const r = await refreshSession();
    expect(r).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();       // ✅ limpa (correto)
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

describe('scopeSessionToMembership — escopo da sessão por vínculo (Fase 3)', () => {
  const base = { accessToken: 'jwt', tenantId: null, user: { name: 'Dona', role: 'Colaborador', location: '' } };

  it('sem vínculo: devolve a sessão INTACTA (caminho do admin global)', async () => {
    const { scopeSessionToMembership } = await import('./auth');
    expect(scopeSessionToMembership(base, [])).toBe(base);
    expect(scopeSessionToMembership(base, undefined)).toBe(base);
  });

  it('dono da loja (tenant_admin) vira Administrador COM tenantId — não é admin global', async () => {
    const { scopeSessionToMembership, isSessionValid } = await import('./auth');
    const s = scopeSessionToMembership(base, [
      { id: 'bf245c3b-2f9', name: 'CASA DOCE', memberRole: 'tenant_admin' },
    ]);
    expect(s.tenantId).toBe('bf245c3b-2f9');
    expect(s.user.role).toBe('Administrador');   // tenant_admin → Administrador
    expect(s.user.location).toBe('CASA DOCE');
    // tem tenantId → NÃO é admin global (não vê o portfólio das outras lojas)
    expect(!s.tenantId).toBe(false);
    void isSessionValid;
  });

  it('RT/Supervisor multi-empresa: papel do vínculo preservado + lista de empresas', async () => {
    const { scopeSessionToMembership } = await import('./auth');
    const s = scopeSessionToMembership(base, [
      { id: 'swiss',    name: 'Swiss',    memberRole: 'Nutricionista RT' },
      { id: 'backerei', name: 'Bäckerei', memberRole: 'Nutricionista RT' },
      { id: 'dbk-producao', name: 'DBK', memberRole: 'Nutricionista RT' },
    ]);
    expect(s.user.role).toBe('Nutricionista RT');  // já é papel do app → preservado
    expect(s.tenantId).toBe('swiss');              // primeira como ativa
    expect(s.memberTenants).toHaveLength(3);       // seletor mostra as 3
    expect(s.memberTenants.map(t => t.id)).toEqual(['swiss','backerei','dbk-producao']);
  });

  // Fase 4 (03/08): conta de LOJA (login compartilhado do balcão) precisa
  // continuar marcada como tal depois de escopada pra loja — é esse carimbo
  // que liga a tela "Quem está registrando?" (src/operator.js). Um bug aqui
  // faria a conta logar normal e nunca pedir operador, silenciosamente.
  it('carimbo isStoreAccount sobrevive ao escopo por membership', async () => {
    const { scopeSessionToMembership } = await import('./auth');
    const contaDeLoja = { ...base, isStoreAccount: true, user: { name: 'Swiss', role: 'Colaborador', location: '' } };
    const s = scopeSessionToMembership(contaDeLoja, [
      { id: 'swiss', name: 'Swiss', memberRole: 'Colaborador' },
    ]);
    expect(s.isStoreAccount).toBe(true);
    expect(s.tenantId).toBe('swiss');
  });

  it('sessão pessoal (sem isStoreAccount) não vira conta de loja por engano', async () => {
    const { scopeSessionToMembership } = await import('./auth');
    const s = scopeSessionToMembership(base, [{ id: 'swiss', name: 'Swiss', memberRole: 'Supervisor' }]);
    expect(s.isStoreAccount).toBeUndefined();
  });
});

// Regressão do vazamento cross-tenant de 30/07: refreshSession reconstruía a
// sessão a partir do JWT (buildSession), e o user_metadata de contas criadas no
// painel/Edge Function tem tenantId nulo — então o vínculo com a loja sumia a
// cada renovação de token (~1h) e a dona da CASA DOCE virava "admin global".
describe('preserveMembershipScope — o refresh não pode perder o vínculo com a loja', () => {
  const anterior = {
    tenantId: 'bf245c3b-2f9',
    memberTenants: [{ id: 'bf245c3b-2f9', name: 'CASA DOCE', role: 'tenant_admin' }],
    user: { email: 'casadocest@gmail.com', role: 'Administrador', location: 'CASA DOCE' },
  };
  // O que buildSession devolve: sem tenantId, papel cru do user_metadata.
  const novoDoJwt = {
    accessToken: 'novo', refreshToken: 'r2', tenantId: null, isPlatformAdmin: false,
    user: { email: 'casadocest@gmail.com', role: 'Colaborador', location: '' },
  };

  it('mantém loja, papel e lista de empresas após renovar o token', async () => {
    const { preserveMembershipScope } = await import('./auth');
    const s = preserveMembershipScope(novoDoJwt, anterior);
    expect(s.tenantId).toBe('bf245c3b-2f9');
    expect(s.user.role).toBe('Administrador');
    expect(s.user.location).toBe('CASA DOCE');
    expect(s.memberTenants).toHaveLength(1);
    expect(s.accessToken).toBe('novo');           // token novo é o que vale
  });

  it('sessão sem vínculo (admin da plataforma) passa intacta', async () => {
    const { preserveMembershipScope } = await import('./auth');
    const semVinculo = { tenantId: null, user: { role: 'Administrador' } };
    const fresh = { ...novoDoJwt, isPlatformAdmin: true };
    expect(preserveMembershipScope(fresh, semVinculo)).toEqual(fresh);
  });
});
