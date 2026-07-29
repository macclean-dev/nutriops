import { describe, it, expect, beforeEach } from 'vitest';
import { localRepository, ls, lw, getOfflineQueue, clearOfflineQueue } from './repository';

const RECORDS_KEY = 'nutriops.temperature.records';

beforeEach(() => {
  localStorage.clear();
  clearOfflineQueue();
});

describe('localRepository.update — correção com trilha de auditoria', () => {
  it('corrige o valor mantendo original/motivo/quem/quando', async () => {
    lw(RECORDS_KEY, [{ id: 'r1', tenantId: 'casadoce', value: 19, note: 'ok' }]);
    const updated = await localRepository.update('r1', 'casadoce', {
      value: -19, originalValue: 19, correctionReason: 'erro de digitação — faltou o sinal', correctedBy: 'Fran', correctedAt: '2026-07-28T12:00:00Z',
    });
    expect(updated.value).toBe(-19);
    expect(updated.originalValue).toBe(19);
    expect(updated.correctedBy).toBe('Fran');
    expect(updated.note).toBe('ok'); // campos não relacionados à correção continuam intactos
  });

  it('preserva o valor original na 2ª correção (não deixa o rastro se perder)', async () => {
    lw(RECORDS_KEY, [{ id: 'r1', tenantId: 'casadoce', value: 19, originalValue: 19, correctedBy: 'Fran', correctedAt: '2026-07-28T12:00:00Z', correctionReason: 'typo' }]);
    // 2ª correção: caller deve passar originalValue = r.originalValue ?? r.value (feito em pages.jsx)
    const updated = await localRepository.update('r1', 'casadoce', {
      value: -18, originalValue: 19, correctionReason: 'ajuste fino após conferência', correctedBy: 'Ana Paula', correctedAt: '2026-07-28T13:00:00Z',
    });
    expect(updated.originalValue).toBe(19); // continua sendo o valor ORIGINAL, não o -19 intermediário
    expect(updated.value).toBe(-18);
  });

  it('enfileira só as colunas de correção — não apaga o resto do registro no upsert remoto', async () => {
    lw(RECORDS_KEY, [{ id: 'r1', tenantId: 'casadoce', value: 19 }]);
    await localRepository.update('r1', 'casadoce', { value: -19, originalValue: 19, correctionReason: 'typo', correctedBy: 'Fran', correctedAt: '2026-07-28T12:00:00Z' });
    const [item] = getOfflineQueue();
    expect(item.table).toBe('temperature_records');
    expect(item.payload).toEqual({
      id: 'r1', tenant_id: 'casadoce', value: -19, original_value: 19,
      correction_reason: 'typo', corrected_by: 'Fran', corrected_at: '2026-07-28T12:00:00Z',
    });
  });

  it('retorna null se o registro não existe localmente', async () => {
    const result = await localRepository.update('inexistente', 'casadoce', { value: 1, correctionReason: 'x', correctedBy: 'x', correctedAt: 'x' });
    expect(result).toBeNull();
  });
});
