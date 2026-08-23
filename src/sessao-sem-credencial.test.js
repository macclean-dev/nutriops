import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Achado em PRODUÇÃO (23/08). A dona da CASA DOCE via, ao mesmo tempo:
//   · banner de sincronização em maint_logs e validity_rules
//   · a 2ª unidade (Fabrizzio) sumida do seletor
//   · "cobertura 0%" e 45 equipamentos "sem leitura"
//
// Três sintomas, uma causa. O console mostrou:
//   nutriops.session       → presente (a tela mostrava o nome, o menu, tudo)
//   nutriops.auth.session  → INEXISTENTE (nenhum token, nenhum refresh)
//
// A sessão do app e a credencial do Supabase vivem em chaves SEPARADAS e podem
// divergir — refresh que falhou, signOut pela metade, ou o SetupPinScreen
// sobrescrevendo a sessão do app sem tocar na credencial. Divergindo, o app
// fica meio-deslogado e NÃO SABE: `memberTokenFor` não acha token, toda chamada
// sai anônima, o RLS recusa, e o sintoma aparece como falha de permissão numa
// tabela aleatória — o lugar errado pra procurar.
//
// Fail closed: sem credencial não há sessão.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const auth  = readFileSync(`${process.cwd()}/src/auth.jsx`, 'utf8');

const guarda = (() => {
  const ini = fonte.indexOf('  // Guarda de CREDENCIAL (23/08)');
  return fonte.slice(ini, fonte.indexOf('}, [session?.accessToken, handleLogout]);', ini));
})();

describe('sessão sem credencial é deslogada, não mantida', () => {
  it('a guarda existe e consulta o armazenamento SEPARADO da credencial', () => {
    expect(guarda).toContain('m.readAuthSession()?.accessToken');
    expect(auth).toContain("const AUTH_SESSION_KEY = 'nutriops.auth.session';");
    expect(auth).toContain('export function readAuthSession()');
  });

  it('só examina sessão de NUVEM — PIN e impersonação não têm accessToken', () => {
    expect(guarda).toContain('if (!session?.accessToken) return;');
  });

  it('com credencial no lugar, não faz nada', () => {
    expect(guarda).toContain("if (m.readAuthSession()?.accessToken) return;   // credencial no lugar");
  });

  it('sem credencial, desloga — e deixa rastro no console', () => {
    expect(guarda).toContain('handleLogout();');
    expect(guarda).toMatch(/sessão sem credencial do Supabase — deslogando/);
  });

  it('cancela se o componente desmontar antes do import resolver', () => {
    expect(guarda).toContain('if (cancelado) return;');
  });
});

describe('a guarda de FORMA (30/07) continua ao lado, não foi substituída', () => {
  it('sessão de nuvem sem vínculo nenhum segue sendo deslogada', () => {
    // Ela cobre outra divergência: credencial OK, vínculo ausente. As duas
    // somam — nenhuma torna a outra redundante.
    expect(fonte).toContain('if (session.tenantId || session.memberTenants?.length > 0) return;');
  });
});

describe('handleLogout limpa os DOIS lados', () => {
  it('remove a sessão do app e chama signOut (que limpa a credencial)', () => {
    const ini = fonte.indexOf('const handleLogout = useCallback(() => {');
    const corpo = fonte.slice(ini, fonte.indexOf('}, []);', ini));
    expect(corpo).toContain('localStorage.removeItem(SESSION_KEY);');
    expect(corpo).toContain('m.signOut()');
    // sem isso, deslogar deixaria a metade que causou o problema
    expect(auth).toContain('export function clearAuthSession()');
  });
});
