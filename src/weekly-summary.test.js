import { describe, it, expect } from 'vitest';
import { computeWeeklySummary, ncCountBySource, summaryToText } from './weekly-summary';

const NOW = new Date('2026-08-09T12:00:00Z').getTime();
const DAY = 86400000;
const tenant = { id: 'swiss', name: 'Swiss' };
const resolveTone = (r) => (r.value < r.min || r.value > r.max ? 'danger' : 'ok');

describe('computeWeeklySummary', () => {
  it('conta não conformidade de temperatura só dentro da janela de 7 dias', () => {
    const records = [
      { id: 't1', tenantId: 'swiss', equipment: 'Freezer', value: -10, min: -25, max: -18, createdAt: new Date(NOW - 2 * DAY).toISOString() },
      { id: 't2', tenantId: 'swiss', equipment: 'Freezer', value: -10, min: -25, max: -18, createdAt: new Date(NOW - 20 * DAY).toISOString() },
    ];
    const summary = computeWeeklySummary({ tenant, records, resolveTone, now: NOW });
    expect(summary.newNonConformities).toHaveLength(1);
    expect(summary.newNonConformities[0].sourceLabel).toBe('Freezer');
  });

  it('agrega recebimento rejeitado e controle reprovado dentro da janela', () => {
    const receiving = [{ id: 'r1', resultado: 'rejeitado', produto: 'Queijo', createdAt: new Date(NOW - DAY).toISOString() }];
    const controlsByType = { oil: [{ id: 'o1', equipment: 'Fritadeira', resultado: 'reprovado', createdAt: new Date(NOW - DAY).toISOString() }] };
    const summary = computeWeeklySummary({ tenant, records: [], receiving, controlsByType, resolveTone, now: NOW });
    expect(summary.newNonConformities).toHaveLength(2);
  });

  it('ação resolvida fora da janela não conta como resolvida esta semana, mas conta como aberta se ainda não fechou', () => {
    const actions = [
      { id: 'a1', status: 'resolvida', createdAt: new Date(NOW - 30 * DAY).toISOString(), closedAt: new Date(NOW - 1 * DAY).toISOString() },
      { id: 'a2', status: 'resolvida', createdAt: new Date(NOW - 30 * DAY).toISOString(), closedAt: new Date(NOW - 30 * DAY).toISOString() },
      { id: 'a3', status: 'aberta', createdAt: new Date(NOW - 1 * DAY).toISOString() },
    ];
    const summary = computeWeeklySummary({ tenant, records: [], actions, resolveTone, now: NOW });
    expect(summary.actionsResolved.map((a) => a.id)).toEqual(['a1']);
    expect(summary.actionsOpened.map((a) => a.id)).toEqual(['a3']);
    expect(summary.actionsStillOpen.map((a) => a.id)).toEqual(['a3']);
  });

  it('planilha validada esta semana conta, planilha validada há mais tempo não', () => {
    const formRecords = [
      { id: 'f1', status: 'submitted', validation: { by: 'RT', at: new Date(NOW - 2 * DAY).toISOString() } },
      { id: 'f2', status: 'submitted', validation: { by: 'RT', at: new Date(NOW - 40 * DAY).toISOString() } },
      { id: 'f3', status: 'submitted', validation: null },
    ];
    const summary = computeWeeklySummary({ tenant, records: [], formRecords, resolveTone, now: NOW });
    expect(summary.formsValidatedThisWeek.map((f) => f.id)).toEqual(['f1']);
    expect(summary.formsAwaitingValidation.map((f) => f.id)).toEqual(['f3']);
  });

  it('sem nenhum dado, devolve tudo zerado sem quebrar', () => {
    const summary = computeWeeklySummary({ tenant, records: [], resolveTone, now: NOW });
    expect(summary.newNonConformities).toEqual([]);
    expect(summary.actionsStillOpen).toEqual([]);
    expect(summary.formsAwaitingValidation).toEqual([]);
  });
});

describe('ncCountBySource', () => {
  it('agrupa por origem e ignora fontes desconhecidas', () => {
    const items = [{ source: 'temperature' }, { source: 'temperature' }, { source: 'receiving' }, { source: 'inventado' }];
    expect(ncCountBySource(items)).toEqual({ temperature: 2, receiving: 1, control: 0, form: 0 });
  });
  it('lista vazia/undefined não quebra', () => {
    expect(ncCountBySource([])).toEqual({ temperature: 0, receiving: 0, control: 0, form: 0 });
    expect(ncCountBySource(undefined)).toEqual({ temperature: 0, receiving: 0, control: 0, form: 0 });
  });
});

describe('summaryToText', () => {
  it('inclui nome do tenant e as 3 contagens', () => {
    const summary = computeWeeklySummary({ tenant, records: [], resolveTone, now: NOW });
    const text = summaryToText(summary);
    expect(text).toContain('Swiss');
    expect(text).toContain('0 não conformidade(s) nova(s)');
    expect(text).toContain('0 ação(ões) corretiva(s) resolvida(s)');
    expect(text).toContain('0 planilha(s) validada(s)');
  });
});
