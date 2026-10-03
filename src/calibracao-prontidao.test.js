import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { planosComVencimento, calibracoesPorPlanilha, daysUntil } from './maintenance-due';
import { computeReadiness, REQUIRED_POPS } from './readiness';
import { readFormTemplates } from './forms';

// ─────────────────────────────────────────────────────────────────────────────
// Candidata 2 da pesquisa de 03/10. RDC 216 4.1.16: "manutenção programada e
// periódica dos equipamentos e utensílios e calibração dos instrumentos ou
// equipamentos de medição, mantendo registro". O app tinha os dois registros
// (planos da Manutenção; planilha de calibração da CASA DOCE) e a Prontidão
// não perguntava: o D3 era um "ok" fixo, e o campo "Data da próxima
// calibração" era gravado e nunca lido.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-03T12:00:00').getTime();

describe('planosComVencimento (extraído da tela de Manutenção, mesma régua)', () => {
  const eq = (plans) => ({ id: 'e1', name: 'Termômetro espeto', maintenancePlans: plans });

  it('sem execução: vale a data prevista no cadastro', () => {
    const [r] = planosComVencimento([eq([{ id: 'p1', type: 'calibracao', frequencyDays: 180, nextDue: '2026-09-01' }])], [], NOW);
    expect(r.plans[0].days).toBeLessThan(0);
    expect(r.plans[0].tone).toBe('expired');
  });

  it('com execução: a próxima conta a partir da última execução', () => {
    const logs = [{ equipmentId: 'e1', planId: 'p1', executedAt: '2026-09-20T10:00:00Z' }];
    const [r] = planosComVencimento([eq([{ id: 'p1', type: 'calibracao', frequencyDays: 180, nextDue: '2026-01-01' }])], logs, NOW);
    expect(r.plans[0].nextDue).toBe('2027-03-19');
    expect(r.plans[0].tone).toBe('ok');
  });

  it('urgentPlan é o mais próximo de vencer, e a lista sai ordenada (a tela exibe nessa ordem)', () => {
    const [r] = planosComVencimento([eq([
      { id: 'a', type: 'limpeza', frequencyDays: 30, nextDue: '2026-12-01' },
      { id: 'b', type: 'calibracao', frequencyDays: 30, nextDue: '2026-10-05' },
    ])], [], NOW);
    expect(r.urgentPlan.id).toBe('b');
    expect(r.plans.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('a tela de Manutenção usa esta função, não uma cópia', () => {
    const tela = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');
    expect(tela).toContain('planosComVencimento(mergedEquipments, logs)');
    expect(tela).not.toContain('function daysUntil(');
  });
});

describe('calibração registrada em planilha (modelo real da CASA DOCE)', () => {
  beforeEach(() => { localStorage.clear(); });
  const tpls = () => readFormTemplates({ id: 'bf245c3b-2f9', name: 'CASA DOCE' });
  const tplCal = () => tpls().find((t) => t.title === 'Calibração de Instrumentos de Medição');
  const reg = (id, equip, prox, createdAt) => ({
    id, formId: tplCal().id, status: 'submitted', createdAt,
    responses: { 'cd-cal-eq': equip, 'cd-cal-prox': prox },
  });

  it('o modelo do seed existe e tem o campo de próxima calibração', () => {
    expect(tplCal()).toBeTruthy();
    expect(calibracoesPorPlanilha([tplCal()], []).temPlanilha).toBe(true);
  });

  it('um instrumento por linha, valendo o registro mais recente', () => {
    const r = calibracoesPorPlanilha(tpls(), [
      reg('1', 'Termômetro 01', '2026-03-01', '2025-09-01T10:00:00Z'),
      reg('2', 'Termômetro 01', '2027-03-01', '2026-09-01T10:00:00Z'),
      reg('3', 'Balança', '2026-09-15', '2026-03-15T10:00:00Z'),
    ]);
    const porNome = Object.fromEntries(r.instrumentos.map((i) => [i.nome, i.proxima]));
    expect(porNome).toEqual({ 'Termômetro 01': '2027-03-01', Balança: '2026-09-15' });
  });

  it('rascunho e data ilegível não contam', () => {
    const rascunho = { ...reg('1', 'T', '2026-01-01', '2026-01-01'), status: 'draft' };
    const ilegivel = reg('2', 'T', 'logo', '2026-01-01');
    expect(calibracoesPorPlanilha(tpls(), [rascunho, ilegivel]).instrumentos).toEqual([]);
  });

  it('loja sem planilha de calibração', () => {
    expect(calibracoesPorPlanilha([{ id: 'x', sections: [{ fields: [{ id: 'a', type: 'date', label: 'Data' }] }] }], []).temPlanilha).toBe(false);
  });
});

describe('Prontidão: B5', () => {
  const loja = (over) => ({
    tenant: { id: 'swiss', name: 'Swiss' }, now: NOW, pendingNc: [], products: [], turnAlerts: [], catalog: [],
    temperatureRecords: [], staff: [], trainingSessions: [], formTemplates: [], formRecords: [], pendingForms: [],
    pops: REQUIRED_POPS.map((r) => ({ title: r.label, category: r.categories[0] ?? 'outros' })),
    companyProfile: {}, complianceDocs: [], controlsByType: {}, sync: {}, localOnly: {}, actions: [], maintenance: [],
    ...over,
  });
  const b5 = (over) => computeReadiness(loja(over)).groups.flatMap((g) => g.checks).find((c) => c.id === 'b5-manutencao');
  const equip = (plans) => planosComVencimento([{ id: 'e1', name: 'Termômetro espeto', maintenancePlans: plans }], [], NOW);

  it('nada registrado: "sem dado", nunca "ok"', () => {
    const c = b5({});
    expect(c.status).toBe('unknown');
    expect(c.navTarget).toBe('maintenance');
  });

  it('plano de calibração vencido: falha, citando o equipamento', () => {
    const c = b5({ maintenance: equip([{ id: 'p', type: 'calibracao', frequencyDays: 180, nextDue: '2026-09-01' }]) });
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('Termômetro espeto');
  });

  it('calibração em dia + outra manutenção atrasada: aviso', () => {
    const c = b5({ maintenance: equip([
      { id: 'p', type: 'calibracao', frequencyDays: 180, nextDue: '2027-01-01' },
      { id: 'q', type: 'limpeza', title: 'Limpeza do condensador', frequencyDays: 30, nextDue: '2026-09-20' },
    ]) });
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('Limpeza do condensador');
  });

  it('calibração da PLANILHA vencida também falha', () => {
    localStorage.clear();
    const tpls = readFormTemplates({ id: 'bf245c3b-2f9', name: 'CASA DOCE' });
    const cal = tpls.find((t) => t.title === 'Calibração de Instrumentos de Medição');
    const c = b5({ formTemplates: tpls, formRecords: [{ id: 'r', formId: cal.id, status: 'submitted', createdAt: '2026-01-01', responses: { 'cd-cal-eq': 'Termômetro 03', 'cd-cal-prox': '2026-07-01' } }] });
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('Termômetro 03');
  });

  it('tudo em dia: ok', () => {
    expect(b5({ maintenance: equip([{ id: 'p', type: 'calibracao', frequencyDays: 180, nextDue: '2027-01-01' }]) }).status).toBe('ok');
  });

  it('é grupo B: falha dá RESSALVAS, não EM RISCO sozinha', () => {
    const r = computeReadiness(loja({ maintenance: equip([{ id: 'p', type: 'calibracao', frequencyDays: 180, nextDue: '2026-09-01' }]) }));
    expect(r.groups.find((g) => g.checks.some((c) => c.id === 'b5-manutencao')).id).toBe('B');
  });

  it('a tela da Prontidão passa os planos já calculados', () => {
    const view = readFileSync(`${process.cwd()}/src/readiness-view.jsx`, 'utf8');
    expect(view).toContain('maintenance: planosComVencimento(readEquipments(tenant.id), maintLogs),');
  });

  it('daysUntil: o dia do prazo vale zero (não vencido), o dia seguinte é vencido', () => {
    // Pode sair -0 (mesmo cálculo da tela antiga): o que importa é não ser < 0.
    expect(daysUntil('2026-10-03', NOW) < 0).toBe(false);
    expect(daysUntil('2026-10-03', NOW) === 0).toBe(true);
    expect(daysUntil('2026-10-02', NOW)).toBe(-1);
    expect(daysUntil('2026-10-04', NOW)).toBe(1);
  });
});
