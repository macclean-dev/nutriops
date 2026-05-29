import { describe, it, expect } from 'vitest';
import { mergeByKey } from './repository';

describe('mergeByKey', () => {
  it('deduplica por chave', () => {
    const arr = [
      { id: 'a', v: 1, createdAt: '2026-01-01' },
      { id: 'a', v: 2, createdAt: '2026-01-02' },
      { id: 'b', v: 3, createdAt: '2026-01-01' },
    ];
    const out = mergeByKey(arr, 'id');
    expect(out).toHaveLength(2);
    expect(out.map(x => x.id).sort()).toEqual(['a', 'b']);
  });

  it('mantém o mais recente por updatedAt', () => {
    const arr = [
      { id: 'a', v: 'velho', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'a', v: 'novo',  updatedAt: '2026-06-01T00:00:00Z' },
    ];
    const out = mergeByKey(arr, 'id');
    expect(out).toHaveLength(1);
    expect(out[0].v).toBe('novo');
  });

  it('respeita ordem mesmo quando o mais novo vem primeiro', () => {
    const arr = [
      { id: 'a', v: 'novo',  updatedAt: '2026-06-01T00:00:00Z' },
      { id: 'a', v: 'velho', updatedAt: '2026-01-01T00:00:00Z' },
    ];
    const out = mergeByKey(arr, 'id');
    expect(out[0].v).toBe('novo');
  });

  it('usa createdAt quando não há updatedAt', () => {
    const arr = [
      { id: 'a', v: 'velho', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'a', v: 'novo',  createdAt: '2026-06-01T00:00:00Z' },
    ];
    const out = mergeByKey(arr, 'id');
    expect(out[0].v).toBe('novo');
  });

  it('updatedAt tem prioridade sobre createdAt', () => {
    const arr = [
      // createdAt mais novo, mas updatedAt mais velho → perde
      { id: 'a', v: 'A', createdAt: '2026-12-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'a', v: 'B', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' },
    ];
    const out = mergeByKey(arr, 'id');
    expect(out[0].v).toBe('B');
  });

  it('item sem timestamp é tratado como época 0 (perde pra qualquer datado)', () => {
    const arr = [
      { id: 'a', v: 'datado', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'a', v: 'sem-data' },
    ];
    const out = mergeByKey(arr, 'id');
    // sem-data vem por último com timestamp 0 < datado → datado permanece
    expect(out[0].v).toBe('datado');
  });

  it('em timestamps iguais, o último vence (>=)', () => {
    const arr = [
      { id: 'a', v: 'primeiro', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'a', v: 'ultimo',   updatedAt: '2026-01-01T00:00:00Z' },
    ];
    const out = mergeByKey(arr, 'id');
    expect(out[0].v).toBe('ultimo');
  });

  it('array vazio → vazio', () => {
    expect(mergeByKey([], 'id')).toEqual([]);
  });

  it('merge local + remoto (cenário real de sync) não perde nem duplica', () => {
    const local = [
      { id: 'r1', value: 4, updatedAt: '2026-05-01T10:00:00Z' },
      { id: 'r2', value: 5, updatedAt: '2026-05-01T11:00:00Z' }, // só local (pendente)
    ];
    const remoto = [
      { id: 'r1', value: 99, updatedAt: '2026-05-02T10:00:00Z' }, // remoto mais novo
      { id: 'r3', value: 7, updatedAt: '2026-05-01T09:00:00Z' },  // só remoto
    ];
    const out = mergeByKey([...local, ...remoto], 'id');
    expect(out).toHaveLength(3); // r1, r2, r3 — nada perdido
    expect(out.find(x => x.id === 'r1').value).toBe(99); // remoto venceu r1
    expect(out.find(x => x.id === 'r2').value).toBe(5);  // pendente preservado
    expect(out.find(x => x.id === 'r3').value).toBe(7);  // remoto novo entrou
  });
});
