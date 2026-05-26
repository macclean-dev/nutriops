import { describe, it, expect, beforeEach } from 'vitest';
import {
  readPinOverride, writePinOverride,
  getEffectivePin, hasPinOverride,
  isWeakPin, WEAK_PINS,
} from './pin';

beforeEach(() => {
  localStorage.clear();
});

describe('isWeakPin', () => {
  it('detecta repetições óbvias', () => {
    expect(isWeakPin('0000')).toBe(true);
    expect(isWeakPin('1111')).toBe(true);
    expect(isWeakPin('9999')).toBe(true);
  });

  it('detecta sequências triviais', () => {
    expect(isWeakPin('1234')).toBe(true);
    expect(isWeakPin('4321')).toBe(true);
    expect(isWeakPin('123456')).toBe(true);
  });

  it('aceita PINs razoáveis', () => {
    expect(isWeakPin('2847')).toBe(false);
    expect(isWeakPin('918273')).toBe(false);
  });

  it('WEAK_PINS é um Set imutável (referência exportada)', () => {
    expect(WEAK_PINS instanceof Set).toBe(true);
    expect(WEAK_PINS.has('0000')).toBe(true);
  });
});

describe('PIN overrides — read/write', () => {
  it('readPinOverride retorna null quando não há override', () => {
    expect(readPinOverride('backerei', 'Fran')).toBe(null);
  });

  it('writePinOverride salva e readPinOverride recupera', () => {
    writePinOverride('backerei', 'Fran', '2847');
    const o = readPinOverride('backerei', 'Fran');
    expect(o.pin).toBe('2847');
    expect(o.changedAt).toBeTruthy();
  });

  it('overrides são separados por tenant', () => {
    writePinOverride('swiss', 'Fran', '1111');
    writePinOverride('backerei', 'Fran', '2222');
    expect(readPinOverride('swiss', 'Fran').pin).toBe('1111');
    expect(readPinOverride('backerei', 'Fran').pin).toBe('2222');
  });

  it('overrides são separados por usuário no mesmo tenant', () => {
    writePinOverride('backerei', 'Fran', '1111');
    writePinOverride('backerei', 'Sila', '2222');
    expect(readPinOverride('backerei', 'Fran').pin).toBe('1111');
    expect(readPinOverride('backerei', 'Sila').pin).toBe('2222');
  });

  it('writePinOverride sobrescreve o anterior', () => {
    writePinOverride('backerei', 'Fran', '1111');
    writePinOverride('backerei', 'Fran', '2222');
    expect(readPinOverride('backerei', 'Fran').pin).toBe('2222');
  });
});

describe('getEffectivePin', () => {
  const fran = { name: 'Fran', pin: '6270' };
  const semPin = { name: 'NoBody' };

  it('sem override, retorna o pin do data.js', () => {
    expect(getEffectivePin('backerei', fran)).toBe('6270');
  });

  it('com override, override vence', () => {
    writePinOverride('backerei', 'Fran', '2847');
    expect(getEffectivePin('backerei', fran)).toBe('2847');
  });

  it('sem pin no user e sem override, cai no fallback 0000', () => {
    expect(getEffectivePin('backerei', semPin)).toBe('0000');
  });
});

describe('hasPinOverride', () => {
  it('retorna false antes do 1º reset', () => {
    expect(hasPinOverride('backerei', 'Fran')).toBe(false);
  });

  it('retorna true após o reset', () => {
    writePinOverride('backerei', 'Fran', '2847');
    expect(hasPinOverride('backerei', 'Fran')).toBe(true);
  });
});
