import { describe, it, expect } from 'vitest';
import {
  getPeriodKey, makePeriodKey, splitPeriodKey, scopeFieldOf,
  formatPeriodLabel, pendingFormsForPeriod,
} from './forms';

// ─────────────────────────────────────────────────────────────────────────────
// Pergunta da nutricionista (18/08): "Na higienização das Hortifrutícolas só
// consigo fazer o preenchimento de 1 setor por dia?"
//
// Sim — e o efeito era pior que um bloqueio. O registro é chaveado por
// (formId, periodKey), o periodKey era só a data, e "Setor" é conteúdo do
// formulário. Confeitaria e Café no mesmo dia caíam na MESMA linha, e o save
// substitui `responses` e `user` inteiros: a segunda equipe apagava a primeira
// sem nenhum aviso. Evidência de conformidade RDC 216 sumindo em silêncio —
// a mesma família de bug da semana toda.
//
// A Higienização por ÁREA nunca sofreu disso: usa um template por setor. As
// planilhas de EQUIPE usam um template só, com campo "Setor" — e é aí que a
// chave precisa do setor junto.
// ─────────────────────────────────────────────────────────────────────────────

const DIA = new Date('2026-08-18T10:00:00');

const tplComEscopo = {
  id: 'hortifruti', frequency: 'daily', scopeBy: 'cd-hf-setor',
  sections: [{ id: 's1', fields: [
    { id: 'cd-hf-data', label: 'Data', type: 'date_sig' },
    { id: 'cd-hf-setor', label: 'Setor', type: 'select', options: ['Confeitaria', 'Café / Atendimento'] },
  ]}],
};
const tplSemEscopo = {
  id: 'filtro-cafe', frequency: 'daily',
  sections: [{ id: 's1', fields: [{ id: 'x', label: 'Produto', type: 'text' }] }],
};

describe('a colisão que apagava o registro da primeira equipe', () => {
  it('mesma data + setores diferentes ⇒ chaves DIFERENTES', () => {
    const a = makePeriodKey('daily', DIA, 'Confeitaria');
    const b = makePeriodKey('daily', DIA, 'Café / Atendimento');
    expect(a).not.toBe(b);
  });

  it('antes da correção as duas eram a MESMA chave — a regressão a evitar', () => {
    expect(getPeriodKey('daily', DIA)).toBe(getPeriodKey('daily', DIA));
  });

  it('mesmo setor no mesmo dia continua sendo a mesma via (edita, não duplica)', () => {
    expect(makePeriodKey('daily', DIA, 'Confeitaria'))
      .toBe(makePeriodKey('daily', DIA, 'Confeitaria'));
  });

  it('setores iguais em dias diferentes são vias diferentes', () => {
    const outroDia = new Date('2026-08-19T10:00:00');
    expect(makePeriodKey('daily', DIA, 'Confeitaria'))
      .not.toBe(makePeriodKey('daily', outroDia, 'Confeitaria'));
  });
});

describe('compatibilidade com o que já está gravado', () => {
  it('sem setor, a chave é EXATAMENTE a antiga — registro legado continua abrindo', () => {
    expect(makePeriodKey('daily', DIA, '')).toBe(getPeriodKey('daily', DIA));
    expect(makePeriodKey('daily', DIA, null)).toBe(getPeriodKey('daily', DIA));
    expect(makePeriodKey('daily', DIA, undefined)).toBe(getPeriodKey('daily', DIA));
  });

  it('setor só com espaços não cria escopo fantasma', () => {
    expect(makePeriodKey('daily', DIA, '   ')).toBe(getPeriodKey('daily', DIA));
  });

  it('splitPeriodKey lê chave antiga e nova', () => {
    expect(splitPeriodKey('2026-08-18')).toEqual({ base: '2026-08-18', scope: null });
    expect(splitPeriodKey('2026-08-18::Confeitaria')).toEqual({ base: '2026-08-18', scope: 'Confeitaria' });
  });

  it('setor com barra e espaço (Café / Atendimento) sobrevive ao round-trip', () => {
    const k = makePeriodKey('daily', DIA, 'Café / Atendimento');
    expect(splitPeriodKey(k).scope).toBe('Café / Atendimento');
  });
});

describe('o rótulo do período não pode virar "Invalid Date"', () => {
  it('chave com escopo mostra data legível + setor', () => {
    const k = makePeriodKey('daily', DIA, 'Confeitaria');
    const label = formatPeriodLabel('daily', k);
    expect(label).toContain('Confeitaria');
    expect(label).not.toMatch(/Invalid/i);
    expect(label).not.toContain('::');
  });

  it('chave antiga continua com o rótulo de sempre', () => {
    expect(formatPeriodLabel('daily', '2026-08-18'))
      .toBe(formatPeriodLabel('daily', splitPeriodKey('2026-08-18').base));
  });
});

describe('scopeFieldOf — explícito, não adivinhado', () => {
  it('acha o campo declarado em scopeBy', () => {
    expect(scopeFieldOf(tplComEscopo)?.id).toBe('cd-hf-setor');
  });

  it('planilha sem scopeBy não ganha escopo, mesmo tendo select', () => {
    expect(scopeFieldOf(tplSemEscopo)).toBeNull();
    expect(scopeFieldOf({ ...tplComEscopo, scopeBy: undefined })).toBeNull();
  });

  it('scopeBy apontando pra campo inexistente devolve null em vez de quebrar', () => {
    expect(scopeFieldOf({ ...tplComEscopo, scopeBy: 'nao-existe' })).toBeNull();
  });
});

describe('pendência: um setor preenchido já tira a planilha do vermelho', () => {
  it('registro de um setor conta como feito no período', () => {
    const rec = { formId: 'hortifruti', periodKey: makePeriodKey('daily', DIA, 'Confeitaria'), status: 'submitted' };
    const pend = pendingFormsForPeriod([tplComEscopo], [rec], DIA);
    expect(pend.find((p) => p.id === 'hortifruti')).toBeUndefined();
  });

  it('nenhum setor preenchido ⇒ segue pendente', () => {
    const pend = pendingFormsForPeriod([tplComEscopo], [], DIA);
    expect(pend.find((p) => p.id === 'hortifruti')).toBeDefined();
  });

  it('registro de OUTRO dia não tira a pendência de hoje', () => {
    const ontem = new Date('2026-08-17T10:00:00');
    const rec = { formId: 'hortifruti', periodKey: makePeriodKey('daily', ontem, 'Confeitaria'), status: 'submitted' };
    expect(pendingFormsForPeriod([tplComEscopo], [rec], DIA).find((p) => p.id === 'hortifruti')).toBeDefined();
  });
});
