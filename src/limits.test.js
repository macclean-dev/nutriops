import { describe, it, expect } from 'vitest';
import { heuristicLimits, resolveLimits, resolveTone, suggestLimits } from './limits';

describe('heuristicLimits', () => {
  it('freezer/congelado → -25/-18', () => {
    expect(heuristicLimits('Freezer')).toEqual({ min: -25, max: -18 });
    expect(heuristicLimits('Câmara Congelada')).toEqual({ min: -25, max: -18 });
    expect(heuristicLimits('congelador')).toEqual({ min: -25, max: -18 });
  });

  it('resto → 0/9', () => {
    expect(heuristicLimits('Refrigerador')).toEqual({ min: 0, max: 9 });
    expect(heuristicLimits('Vitrine')).toEqual({ min: 0, max: 9 });
    expect(heuristicLimits('')).toEqual({ min: 0, max: 9 });
  });

  it('case-insensitive', () => {
    expect(heuristicLimits('FREEZER')).toEqual({ min: -25, max: -18 });
  });
});

describe('resolveLimits', () => {
  it('usa minTemp/maxTemp do equipamento passado direto', () => {
    expect(resolveLimits('Qualquer', { minTemp: 2, maxTemp: 6 })).toEqual({ min: 2, max: 6 });
  });

  it('ignora equipamento sem min/max válidos e cai na heurística', () => {
    expect(resolveLimits('Freezer', { minTemp: null, maxTemp: undefined })).toEqual({ min: -25, max: -18 });
  });

  it('busca no catálogo por label exato', () => {
    const cat = [{ label: 'Geladeira', minTemp: 1, maxTemp: 5 }];
    expect(resolveLimits('Geladeira', cat)).toEqual({ min: 1, max: 5 });
  });

  it('busca no catálogo por alias', () => {
    const cat = [{ label: 'Refrigerador', aliases: ['geladeira'], minTemp: 1, maxTemp: 5 }];
    expect(resolveLimits('Geladeira', cat)).toEqual({ min: 1, max: 5 });
  });

  it('catálogo sem match cai na heurística', () => {
    const cat = [{ label: 'Outro', minTemp: 1, maxTemp: 5 }];
    expect(resolveLimits('Freezer', cat)).toEqual({ min: -25, max: -18 });
  });

  it('sem contexto cai na heurística', () => {
    expect(resolveLimits('Freezer')).toEqual({ min: -25, max: -18 });
    expect(resolveLimits('Balcão')).toEqual({ min: 0, max: 9 });
  });

  it('catálogo vazio cai na heurística', () => {
    expect(resolveLimits('Freezer', [])).toEqual({ min: -25, max: -18 });
  });

  it('aceita minTemp/maxTemp = 0 (Number.isFinite, não truthy)', () => {
    expect(resolveLimits('X', { minTemp: 0, maxTemp: 0 })).toEqual({ min: 0, max: 0 });
  });
});

describe('resolveTone', () => {
  it('dentro da faixa → ok', () => {
    expect(resolveTone(4, 0, 9)).toBe('ok');
    expect(resolveTone(0, 0, 9)).toBe('ok'); // borda inferior
    expect(resolveTone(9, 0, 9)).toBe('ok'); // borda superior
  });

  it('até 3° fora → warn', () => {
    expect(resolveTone(11, 0, 9)).toBe('warn'); // +2
    expect(resolveTone(12, 0, 9)).toBe('warn'); // +3 exato
    expect(resolveTone(-3, 0, 9)).toBe('warn'); // -3 exato
  });

  it('mais de 3° fora → danger', () => {
    expect(resolveTone(13, 0, 9)).toBe('danger');  // +4
    expect(resolveTone(-4, 0, 9)).toBe('danger');
    expect(resolveTone(30, 0, 9)).toBe('danger');
  });

  it('valor/faixa inválidos (NaN) → neutral', () => {
    expect(resolveTone('abc', 0, 9)).toBe('neutral');
    expect(resolveTone(4, undefined, 9)).toBe('neutral'); // Number(undefined) = NaN
    expect(resolveTone(4, 0, undefined)).toBe('neutral');
    expect(resolveTone(undefined, 0, 9)).toBe('neutral');
  });

  it('quirk: null vira 0 (Number(null)===0), NÃO neutral', () => {
    // Comportamento existente documentado — null min/max é coagido a 0.
    // resolveTone(4, null, 9): faixa 0–9 → ok.
    expect(resolveTone(4, null, 9)).toBe('ok');
    expect(resolveTone(-1, null, 9)).toBe('warn'); // -1 está 1° abaixo de 0
  });

  it('aceita strings numéricas', () => {
    expect(resolveTone('4', '0', '9')).toBe('ok');
  });

  it('faixa de freezer (negativa)', () => {
    expect(resolveTone(-20, -25, -18)).toBe('ok');
    expect(resolveTone(-16, -25, -18)).toBe('warn');  // +2 acima do max
    expect(resolveTone(-10, -25, -18)).toBe('danger'); // muito acima
  });
});

describe('suggestLimits', () => {
  it('é a heurística pelo nome', () => {
    expect(suggestLimits('Freezer')).toEqual({ min: -25, max: -18 });
    expect(suggestLimits('Geladeira')).toEqual({ min: 0, max: 9 });
  });
});
