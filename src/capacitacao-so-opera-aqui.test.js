import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { cobraCapacitacaoAqui } from './training-status';
import { computeReadiness, REQUIRED_POPS } from './readiness';
import { computeTrainingStats } from './reports';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido da RT da CASA DOCE (06/10): "quando coloca uma pessoa da Casa Doce no
// Fabrizzio e marca a opção 'só opera aqui', fica pendente o treinamento,
// mesmo a pessoa já tendo o treinamento no Casa Doce". Desde a v1.9.226 o
// "Só opera aqui" tirava a pessoa só do ASO; agora tira também da cobrança de
// capacitação desta loja, nos 7 lugares que cobram.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-06T12:00:00').getTime();

describe('cobraCapacitacaoAqui', () => {
  it('"Só opera aqui" fica fora; o resto continua cobrado', () => {
    expect(cobraCapacitacaoAqui({ name: 'Ana', asoExterno: true })).toBe(false);
    expect(cobraCapacitacaoAqui({ name: 'Bia' })).toBe(true);
    expect(cobraCapacitacaoAqui({ name: 'Cid', asoExterno: false })).toBe(true);
  });
});

describe('Prontidão A4 não cobra quem só opera aqui', () => {
  const a4 = (staff) => computeReadiness({
    tenant: { id: 'fab' }, now: NOW, pendingNc: [], products: [], turnAlerts: [], catalog: [], temperatureRecords: [],
    staff, trainingSessions: [], formTemplates: [], formRecords: [], pendingForms: [],
    pops: REQUIRED_POPS.map((r) => ({ title: r.label, category: r.categories[0] ?? 'outros' })),
    companyProfile: {}, complianceDocs: [], controlsByType: {}, sync: {}, localOnly: {}, actions: [], maintenance: [],
  }).groups.flatMap((g) => g.checks).find((c) => c.id === 'a4-capacitacao');

  it('pessoa da CASA DOCE operando no Fabrizzio: sem pendência de capacitação aqui', () => {
    const c = a4([{ name: 'Maria (Casa Doce)', status: 'Ativo', asoExterno: true }]);
    expect(c.detail).not.toContain('Maria (Casa Doce)');
    expect(c.status).not.toBe('fail');
  });

  it('funcionária do próprio Fabrizzio sem treinamento continua cobrada', () => {
    const c = a4([{ name: 'Joana', status: 'Ativo' }, { name: 'Maria (Casa Doce)', status: 'Ativo', asoExterno: true }]);
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('Joana');
    expect(c.detail).not.toContain('Maria (Casa Doce)');
  });
});

describe('relatórios e Dossiê', () => {
  beforeEach(() => { localStorage.clear(); });
  it('a capacitação do Dossiê lista só quem é cobrado aqui', () => {
    localStorage.setItem('nutriops.users.fab', JSON.stringify([{ name: 'Joana' }, { name: 'Maria', asoExterno: true }]));
    expect(computeTrainingStats({ id: 'fab' }).map((r) => r.name)).toEqual(['Joana']);
  });
});

describe('os 7 lugares que cobram capacitação usam a mesma regra', () => {
  const usa = (arq) => readFileSync(`${process.cwd()}/src/${arq}`, 'utf8').includes('cobraCapacitacaoAqui');
  for (const arq of ['readiness.js', 'extras.jsx', 'reports.jsx', 'pages.jsx', 'reports-views.jsx', 'training.jsx']) {
    it(arq, () => { expect(usa(arq)).toBe(true); });
  }
});
