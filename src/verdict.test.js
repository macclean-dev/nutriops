import { describe, it, expect } from 'vitest';
import { autoVerdict, verdictConflicts, thawCompliant, receivingSuggestedResult } from './verdict';

describe('autoVerdict', () => {
  it('retorna null quando não há cálculo ainda', () => {
    expect(autoVerdict(null)).toBe(null);
    expect(autoVerdict(undefined)).toBe(null);
  });
  it('mapeia true/false pra conforme/nao_conforme', () => {
    expect(autoVerdict(true)).toBe('conforme');
    expect(autoVerdict(false)).toBe('nao_conforme');
  });
});

describe('verdictConflicts', () => {
  it('sem cálculo, nunca conflita', () => {
    expect(verdictConflicts(null, 'conforme')).toBe(false);
    expect(verdictConflicts(null, 'nao_conforme')).toBe(false);
  });
  it('sem escolha ainda, não conflita', () => {
    expect(verdictConflicts(true, '')).toBe(false);
  });
  it('escolha alinhada ao cálculo não conflita', () => {
    expect(verdictConflicts(true, 'conforme')).toBe(false);
    expect(verdictConflicts(false, 'nao_conforme')).toBe(false);
  });
  it('escolha contrária ao cálculo conflita', () => {
    expect(verdictConflicts(true, 'nao_conforme')).toBe(true);
    expect(verdictConflicts(false, 'conforme')).toBe(true);
  });
  it('descartado nunca conflita, mesmo contrariando o cálculo', () => {
    expect(verdictConflicts(true, 'descartado')).toBe(false);
    expect(verdictConflicts(false, 'descartado')).toBe(false);
  });
});

describe('thawCompliant', () => {
  it('sem temperatura informada, retorna null', () => {
    expect(thawCompliant('refrigerador', '')).toBe(null);
    expect(thawCompliant('refrigerador', null)).toBe(null);
  });
  it('refrigerador: conforme até 4°C inclusive', () => {
    expect(thawCompliant('refrigerador', '4')).toBe(true);
    expect(thawCompliant('refrigerador', '3.5')).toBe(true);
    expect(thawCompliant('refrigerador', '4.1')).toBe(false);
  });
  it('agua_corrente: conforme abaixo de 21°C (exclusivo)', () => {
    expect(thawCompliant('agua_corrente', '20.9')).toBe(true);
    expect(thawCompliant('agua_corrente', '21')).toBe(false);
  });
  it('microondas e cozimento não têm critério numérico — sempre null', () => {
    expect(thawCompliant('microondas', '80')).toBe(null);
    expect(thawCompliant('cozimento', '90')).toBe(null);
  });
  it('valor não numérico retorna null', () => {
    expect(thawCompliant('refrigerador', 'abc')).toBe(null);
  });
});

describe('receivingSuggestedResult', () => {
  const ids = ['temp', 'embalagem', 'validade'];

  it('nenhum check marcado ainda: sem sugestão', () => {
    expect(receivingSuggestedResult({}, ids)).toBe(null);
  });
  it('todos conformes: sugere aceito', () => {
    expect(receivingSuggestedResult({ temp: 'C', embalagem: 'C', validade: 'C' }, ids)).toBe('aceito');
  });
  it('algum NC entre os marcados: sugere aceito parcial', () => {
    expect(receivingSuggestedResult({ temp: 'C', embalagem: 'NC' }, ids)).toBe('aceito_parcial');
  });
  it('marcados parcialmente mas todos C (checks pendentes): sem sugestão ainda', () => {
    expect(receivingSuggestedResult({ temp: 'C' }, ids)).toBe(null);
  });
});
