import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// CASA DOCE, 18/08. A nutricionista: "as leituras de hoje continuam sem
// aparecer na aba inicial, aparecendo somente 3".
//
// A foto do aparelho dela fechou o caso, e NÃO era sincronização:
//   "Boa noite, Equipe."            → conta compartilhada, sem operador
//   PENDENTES NO TURNO  10 de 46    → 36 equipamentos JÁ medidos hoje
//   SUAS LEITURAS HOJE   3          → só os gravados com o nome "Equipe"
//
// O card estava certo e era inútil: numa conta compartilhada, "suas" não tem
// dono. E o dashboard do colaborador não tinha NENHUMA lista das leituras do
// dia da loja — essa seção só existia na visão do supervisor.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => localStorage.clear());

describe('o número que ela via', () => {
  const hoje = new Date().toISOString();
  const registros = [
    { user: 'Equipe', createdAt: hoje }, { user: 'Equipe', createdAt: hoje }, { user: 'Equipe', createdAt: hoje },
    ...Array.from({ length: 33 }, () => ({ user: 'Renata Rodrigues', createdAt: hoje })),
  ];
  const meusNomes = (sessionName, operador) => new Set([sessionName, operador].filter(Boolean));

  it('o filtro pessoal devolve 3 — era isso na tela dela', () => {
    const meus = registros.filter(r => meusNomes('Equipe', null).has(r.user));
    expect(meus).toHaveLength(3);
  });

  it('a loja inteira devolve 36 — o número que ela procurava', () => {
    expect(registros).toHaveLength(36);
  });

  it('com operador escolhido, o pessoal passa a ser o dela e faz sentido', () => {
    const meus = registros.filter(r => meusNomes('Equipe', 'Renata Rodrigues').has(r.user));
    expect(meus).toHaveLength(36);   // 3 da conta + 33 dela
  });
});

// A primeira versão desta correção detectava "conta sem dono" via
// isStoreAccountSession. Ela erraria EXATAMENTE o caso de origem: a sessão da
// CASA DOCE se chama "Equipe" mas não é conta de loja (não passa pelo seletor
// de operador — verificado no browser). Detectar tipo de conta é frágil;
// mostrar os dois números não é.
describe('overview-v2.jsx — os consertos continuam no lugar', () => {
  const fonte = readFileSync(`${process.cwd()}/src/overview-v2.jsx`, 'utf8');

  it('o total da loja aparece no card, sem depender de tipo de conta', () => {
    expect(fonte).toContain('const mostrarTotalDaLoja = lojaHoje.length !== myToday.length;');
    expect(fonte).toContain('`loja: ${lojaHoje.length} hoje`');
  });

  it('não voltou a heurística por tipo de conta', () => {
    // só linhas executáveis — o comentário do porquê CITA isStoreAccountSession
    const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(codigo).not.toContain('contaSemDono');
    expect(codigo).not.toContain('isStoreAccountSession');
  });

  it('o colaborador passou a ter a atividade da loja, que só o supervisor tinha', () => {
    expect(fonte).toContain('Atividade da loja hoje');
    expect(fonte).toContain('<ActivityTimeline records={lojaHoje} limit={12} />');
  });

  it('o card pessoal continua contando o pessoal — rótulo e valor batem', () => {
    expect(fonte).toContain('label="Suas leituras hoje"');
    expect(fonte).toContain('value={myToday.length}');
  });
});
