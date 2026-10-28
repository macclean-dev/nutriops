import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// 28/10: a faixa "EM IMPLANTAÇÃO" e a janela de ativação diziam que os
// registros "ficam marcados como treino". Nada no app marca registro como
// treino: o modo só suspende a cobrança de pendência de turno (turn-alerts.js,
// readiness.js A3). O texto fazia a RT achar que o que a equipe registrava
// durante a implantação não valia.

const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const admin = readFileSync(`${process.cwd()}/src/superadmin-view.jsx`, 'utf8');

describe('modo implantação: a tela diz o que ele faz de verdade', () => {
  it('a faixa diz que os registros valem', () => {
    expect(pages).toContain('Fase de treinamento: os alertas de pendência de turno estão suspensos até o início oficial da operação. Os registros valem normalmente.');
  });
  it('nenhuma tela promete marcar registro como treino', () => {
    for (const f of [pages, admin]) expect(f).not.toMatch(/marcados como treino/);
  });
  it('e de fato nada marca: nenhum registro ganha campo de treino', () => {
    const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(repo).not.toMatch(/treino|isTraining|implantacao/);
  });
});
