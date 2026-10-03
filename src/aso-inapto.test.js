import { describe, it, expect } from 'vitest';
import { employeeAsoStatus, teamAsoSummary, ASO_STATUS_LABEL, DOC_TYPES } from './compliance';
import { computeReadiness, REQUIRED_POPS } from './readiness';
import { sectionAso } from './dossier';

// ─────────────────────────────────────────────────────────────────────────────
// Defeito achado na pesquisa de 03/10: employeeAsoStatus olhava só a validade.
// Um ASO "Inapto" dentro do prazo contava como "Em dia" na tela de ASO, no
// check A7 da Prontidão e no Dossiê. Inapto quer dizer que a pessoa não pode
// manipular alimento (RDC 216 4.6.2), então não é controle de saúde em ordem.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-03T12:00:00').getTime();
const iso = (diasAtras) => new Date(NOW - diasAtras * 86400000).toISOString();
const aso = (subject, resultado, validUntil = '2027-06-01') => ({
  id: `aso-${subject}`, docType: DOC_TYPES.ASO, subject, issuedAt: '2026-06-01', validUntil, resultado,
});

describe('employeeAsoStatus considera o resultado', () => {
  it('Inapto dentro da validade é "inapto", não "ok"', () => {
    expect(employeeAsoStatus('Ana', [aso('Ana', 'inapto')], 12, NOW).status).toBe('inapto');
  });

  it('Inapto já vencido continua "inapto" (é a informação útil)', () => {
    expect(employeeAsoStatus('Ana', [aso('Ana', 'inapto', '2026-01-01')], 12, NOW).status).toBe('inapto');
  });

  it('Apto e Apto com restrição seguem pela validade', () => {
    expect(employeeAsoStatus('Ana', [aso('Ana', 'apto')], 12, NOW).status).toBe('ok');
    expect(employeeAsoStatus('Ana', [aso('Ana', 'apto_restricao')], 12, NOW).status).toBe('ok');
    expect(employeeAsoStatus('Ana', [aso('Ana', 'apto', '2026-01-01')], 12, NOW).status).toBe('expired');
  });

  it('vale o exame MAIS RECENTE: Inapto seguido de novo exame Apto volta a ficar em dia', () => {
    const docs = [aso('Ana', 'inapto', '2026-12-01'), { ...aso('Ana', 'apto', '2027-09-01'), id: 'novo' }];
    expect(employeeAsoStatus('Ana', docs, 12, NOW).status).toBe('ok');
  });

  it('tem rótulo na tela', () => {
    expect(ASO_STATUS_LABEL.inapto).toBe('Inapto');
  });
});

describe('teamAsoSummary conta os inaptos à parte', () => {
  it('inapto não entra em "ok"', () => {
    const r = teamAsoSummary(
      [{ name: 'Ana' }, { name: 'Bia' }],
      [aso('Ana', 'inapto'), aso('Bia', 'apto')], 12, NOW,
    );
    expect(r.ok).toBe(1);
    expect(r.inapto).toBe(1);
  });
});

describe('Prontidão: A7 falha com ASO Inapto', () => {
  const loja = (complianceDocs) => ({
    tenant: { id: 'swiss', name: 'Swiss' }, now: NOW, pendingNc: [],
    products: [{ name: 'Queijo', expiryDate: '2026-12-01' }], turnAlerts: [],
    catalog: [{ label: 'Freezer 1' }],
    temperatureRecords: [{ equipment: 'Freezer 1', value: -20, min: -25, max: -18, createdAt: iso(1) }],
    staff: [{ name: 'Ana', status: 'Ativo' }],
    trainingSessions: [{ status: 'closed', date: '2026-09-01', participants: [{ name: 'Ana', confirmed: true }] }],
    trainingValidityMonths: 12,
    formTemplates: [], formRecords: [], pendingForms: [],
    pops: REQUIRED_POPS.map((r) => ({ title: r.label, category: r.categories[0] ?? 'outros' })),
    companyProfile: { rtNome: 'Ana Paula', rtCrn: '123', alvara: '1' },
    complianceDocs, controlsByType: {},
    sync: { enabled: true, lastSync: iso(1), queueLength: 0 }, localOnly: {},
  });
  const a7 = (docs) => computeReadiness(loja(docs)).groups.flatMap((g) => g.checks).find((c) => c.id === 'a7-aso');

  it('Apto: ok', () => {
    expect(a7([aso('Ana', 'apto')]).status).toBe('ok');
  });

  it('Inapto: fail, e cita quem', () => {
    const c = a7([aso('Ana', 'inapto')]);
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('Ana');
  });
});

describe('Dossiê: situação "Inapto"', () => {
  it('a linha diz Inapto na situação, não "Em dia"', () => {
    const s = sectionAso({ staff: [{ name: 'João', role: 'Colaborador' }], complianceDocs: [aso('João', 'inapto')], now: NOW });
    const situacao = s.rowsHtml.split('<td').pop();
    expect(situacao).toContain('Inapto');
    expect(situacao).not.toContain('Em dia');
    expect(s.title).toContain('0 de 1 em dia');
  });
});
