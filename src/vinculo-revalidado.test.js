import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Achado no 1º uso real do fluxo multi-unidade (21/08): as 3 contas foram
// vinculadas com sucesso a uma unidade nova, e a dona entrou com o próprio
// e-mail e continuou vendo SÓ a CASA DOCE — sem a empresa nova e sem nenhum
// aviso.
//
// CAUSA: `fetchMemberTenants` só rodava no LOGIN. O efeito de hidratação do
// boot só busca quando falta alguma empresa que JÁ está na sessão, e a sessão
// (persistida no localStorage) ainda listava só a CASA DOCE — então a guarda
// dava `true` e ele nunca refazia a pergunta. O vínculo existia no banco e a
// pessoa não tinha como saber.
//
// Custa suporte a cada abertura de unidade, e o sintoma ("vinculei e não
// apareceu") aponta pro lugar errado — parece que o vínculo falhou.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

const efeito = (() => {
  const ini = fonte.indexOf('  const membroJaRevalidado = useRef(false);');
  return fonte.slice(ini, fonte.indexOf('}, [session?.accessToken]);', ini));
})();

describe('o vínculo é revalidado no boot', () => {
  it('o efeito existe e roda uma vez por montagem', () => {
    expect(efeito).toContain('if (membroJaRevalidado.current) return;');
    expect(efeito).toContain('membroJaRevalidado.current = true;');
  });

  it('só pra sessão de nuvem — PIN não tem vínculo pra revalidar', () => {
    expect(efeito).toContain('if (!session?.accessToken) return;');
  });

  it('busca a lista no servidor, não deduz do que já tem', () => {
    expect(efeito).toContain("import('./tenant-sync').then((m) => m.fetchMemberTenants())");
  });
});

describe('as três coisas que não podem dar errado', () => {
  it('falha de rede NUNCA encolhe o acesso', () => {
    // fetchMemberTenants devolve null pra "não deu pra saber" e [] pra
    // "confirmado: sem vínculo" — distinção de segurança criada em 30/07,
    // quando um [] falso fez a dona da CASA DOCE cair na Swiss.
    expect(efeito).toContain('if (cancelado || !Array.isArray(lista)) return;');
  });

  it('NÃO troca a empresa ativa por baixo de quem está usando', () => {
    // Mexer em tenantId mudaria a loja no meio de um registro de temperatura.
    const setSessao = efeito.slice(efeito.indexOf('setSession((atual) => {'));
    expect(setSessao).toContain('memberTenants: lista.map(');
    expect(setSessao).not.toContain('tenantId:');
  });

  it('não re-renderiza à toa quando nada mudou', () => {
    // Sem a comparação, todo boot reescreveria a sessão e dispararia os
    // efeitos que dependem de session.memberTenants.
    expect(efeito).toContain('if (idsNovos === idsAtuais) return;');
  });
});

describe('o resultado chega às duas listas que importam', () => {
  it('activeTenants ganha a empresa nova', () => {
    expect(efeito).toContain('setActiveTenants((prev) => {');
    expect(efeito).toContain('mergeMemberTenant(c, prev.find((p) => p.id === c.id))');
  });

  it('a sessão persiste o vínculo novo — senão some no próximo F5', () => {
    expect(efeito).toContain('save(SESSION_KEY, proxima);');
  });

  it('visibleTenants lê memberTenants, que é o que este efeito atualiza', () => {
    // Trava a ponta consumidora: sem isso a revalidação atualizaria um campo
    // que ninguém lê.
    expect(fonte).toContain('const ids = new Set(session.memberTenants.map((m) => m.id));');
  });
});
