import { describe, it, expect } from 'vitest';
import { compareVersions, getUnseenEntries } from './changelog';

describe('compareVersions', () => {
  it('igual retorna 0', () => {
    expect(compareVersions('1.9.110', '1.9.110')).toBe(0);
  });
  it('reconhece patch maior', () => {
    expect(compareVersions('1.9.111', '1.9.110')).toBeGreaterThan(0);
    expect(compareVersions('1.9.110', '1.9.111')).toBeLessThan(0);
  });
  it('não compara como string — 1.9.9 é menor que 1.9.10', () => {
    expect(compareVersions('1.9.10', '1.9.9')).toBeGreaterThan(0);
  });
  it('minor/major maiores vencem mesmo com patch menor', () => {
    expect(compareVersions('1.10.0', '1.9.999')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.9.999')).toBeGreaterThan(0);
  });
});

describe('getUnseenEntries', () => {
  const entries = [
    { version: '1.9.3', items: ['c'] },
    { version: '1.9.2', items: ['b'] },
    { version: '1.9.1', items: ['a'] },
  ];

  it('sem versão vista antes (1º acesso), não mostra nada', () => {
    expect(getUnseenEntries(null, entries)).toEqual([]);
    expect(getUnseenEntries(undefined, entries)).toEqual([]);
  });
  it('devolve só as entradas mais novas que a última vista', () => {
    expect(getUnseenEntries('1.9.1', entries).map((e) => e.version)).toEqual(['1.9.3', '1.9.2']);
  });
  it('já viu a mais recente: nada pendente', () => {
    expect(getUnseenEntries('1.9.3', entries)).toEqual([]);
  });
  it('versão vista mais nova que qualquer entrada (downgrade/teste): nada pendente', () => {
    expect(getUnseenEntries('2.0.0', entries)).toEqual([]);
  });
});
