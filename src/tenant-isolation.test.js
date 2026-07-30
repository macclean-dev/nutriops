import { describe, it, expect } from 'vitest';
import { isGlobalAdmin } from './permissions';

// Regressão do vazamento cross-tenant de 30/07: a dona da CASA DOCE
// (conta Supabase criada no painel, user_metadata role='Administrador' e
// tenantId nulo) era classificada como admin GLOBAL e via os relatórios da
// Swiss. Dois furos, ambos cobertos aqui:
//   1. refreshSession reconstruía a sessão do JWT e perdia o vínculo com a loja.
//   2. isGlobalAdmin aceitava qualquer sessão com tenantId nulo + role
//      'Administrador' — sem exigir o carimbo de admin da plataforma.

const adminDaPlataforma = {
  accessToken: 'jwt', isPlatformAdmin: true, tenantId: null,
  user: { email: 'maninthemirror2050@gmail.com', role: 'Administrador' },
};
const donaDaLoja = {
  accessToken: 'jwt', isPlatformAdmin: false, tenantId: 'bf245c3b-2f9',
  memberTenants: [{ id: 'bf245c3b-2f9', name: 'CASA DOCE', role: 'tenant_admin' }],
  user: { email: 'casadocest@gmail.com', role: 'Administrador' },
};

describe('isGlobalAdmin — quem pode ver TODAS as empresas', () => {
  it('admin da plataforma (app_metadata.role=admin) é global', () => {
    expect(isGlobalAdmin(adminDaPlataforma)).toBe(true);
  });

  it('dona de loja NÃO é global, mesmo com papel "Administrador"', () => {
    expect(isGlobalAdmin(donaDaLoja)).toBe(false);
  });

  it('dona de loja continua NÃO-global se o vínculo (tenantId) se perder no refresh', () => {
    // Exatamente o estado que o bug produzia: tenantId apagado pelo refresh.
    const semTenant = { ...donaDaLoja, tenantId: null };
    expect(isGlobalAdmin(semTenant)).toBe(false);       // barrado por memberTenants
    const semNada = { ...semTenant, memberTenants: [] };
    expect(isGlobalAdmin(semNada)).toBe(false);         // barrado por isPlatformAdmin
  });

  it('sessão Supabase sem o carimbo de plataforma nunca é global', () => {
    const semCarimbo = { accessToken: 'jwt', tenantId: null, user: { role: 'Administrador' } };
    expect(isGlobalAdmin(semCarimbo)).toBe(false);
  });

  it('colaborador de loja não é global', () => {
    expect(isGlobalAdmin({ tenantId: 'swiss', user: { role: 'Colaborador' } })).toBe(false);
  });

  it('sessão por PIN (sem accessToken) segue a regra antiga — não trava o PDV', () => {
    // PIN sempre tem tenantId, então nunca vira global; e sem accessToken o
    // carimbo não é exigido (não deslogar loja por causa de sessão legada).
    expect(isGlobalAdmin({ tenantId: 'swiss', user: { role: 'Administrador' } })).toBe(false);
    expect(isGlobalAdmin({ tenantId: null, user: { role: 'Administrador' } })).toBe(true);
  });

  it('sem sessão não é global', () => {
    expect(isGlobalAdmin(null)).toBe(false);
    expect(isGlobalAdmin(undefined)).toBe(false);
  });
});
