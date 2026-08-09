import { describe, it, expect, beforeEach } from 'vitest';
import { computeTempStats, renderTempRows, computeBpfStats, renderBpfRows, computeTrainingStats, renderTrainRows } from './reports';
import { readFormTemplates, getPeriodKey } from './forms';

// Estas funções foram extraídas de dentro de exportFiscal/generateFiscalPDF
// (item 10 da revisão, dossier.js reaproveita em vez de recalcular). Cobertura
// aqui prova que a extração preservou o comportamento e que o dossiê recebe
// dado de verdade quando os registros existem — sem depender do pipeline
// completo de App()/Supabase pra confirmar.

beforeEach(() => { localStorage.clear(); });

describe('computeTempStats + renderTempRows', () => {
  it('agrega por equipamento e calcula conformidade', () => {
    const records = [
      { tenantId: 'swiss', equipment: 'Freezer', value: -19, min: -25, max: -18, createdAt: new Date().toISOString() },
      { tenantId: 'swiss', equipment: 'Freezer', value: -10, min: -25, max: -18, createdAt: new Date().toISOString() },
    ];
    const stats = computeTempStats(records, 'swiss', 30);
    expect(stats).toHaveLength(1);
    expect(stats[0].equip).toBe('Freezer');
    expect(stats[0].total).toBe(2);
    expect(stats[0].ok).toBe(1);
    expect(stats[0].danger).toBe(1);
    expect(renderTempRows(stats)).toContain('Freezer');
  });

  it('ignora registros de outro tenant ou fora do período', () => {
    const records = [
      { tenantId: 'baeckerei', equipment: 'Freezer', value: -19, min: -25, max: -18, createdAt: new Date().toISOString() },
      { tenantId: 'swiss', equipment: 'Freezer', value: -19, min: -25, max: -18, createdAt: new Date(Date.now() - 100 * 86400000).toISOString() },
    ];
    expect(computeTempStats(records, 'swiss', 30)).toEqual([]);
  });

  it('sem registros retorna linha de mensagem vazia via renderTempRows', () => {
    expect(renderTempRows([])).toBe('');
  });
});

describe('computeBpfStats + renderBpfRows', () => {
  it('planilha sem registro do período atual aparece pendente', () => {
    const tenant = { id: 'unit-test-tenant', name: 'Tenant Teste' };
    const stats = computeBpfStats(tenant);
    expect(stats.length).toBeGreaterThan(0);
    expect(renderBpfRows(stats)).toContain('Pendente');
  });

  it('planilha com registro submetido e validado do período atual aparece concluída', () => {
    const tenant = { id: 'unit-test-tenant-2', name: 'Tenant Teste 2' };
    const [first] = readFormTemplates(tenant);
    const periodKey = getPeriodKey(first.frequency);
    localStorage.setItem('nutriops.forms.records.unit-test-tenant-2', JSON.stringify([
      { id: 'r1', formId: first.id, periodKey, status: 'submitted', validation: { by: 'RT' } },
    ]));
    const stats = computeBpfStats(tenant);
    const stat = stats.find((s) => s.title === first.title);
    expect(stat.periods[0].status).toBe('submitted');
    expect(stat.validated).toBe(1);
    expect(renderBpfRows(stats)).toContain('Concluído');
  });
});

describe('computeTrainingStats + renderTrainRows', () => {
  it('classifica colaborador sem sessão como nunca capacitado', () => {
    localStorage.setItem('nutriops.users.swiss', JSON.stringify([{ name: 'Fran', role: 'Administrador' }]));
    const tenant = { id: 'swiss', name: 'Swiss', usersList: [] };
    const stats = computeTrainingStats(tenant);
    expect(stats).toEqual([{ name: 'Fran', role: 'Administrador', lastDate: null, status: 'never' }]);
    expect(renderTrainRows(stats)).toContain('Nunca capacitado');
  });
});
