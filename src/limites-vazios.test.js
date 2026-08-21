import { describe, it, expect } from 'vitest';
import { resolveLimits, resolveTone, heuristicLimits } from './limits';

// ─────────────────────────────────────────────────────────────────────────────
// Achado em PRODUÇÃO (Swiss, 20/08): a linha do Freezer no catálogo estava com
// min_temp = 12 e max_temp VAZIO. O esperado seria cair na heurística de
// freezer (-25/-18); em vez disso a faixa virava "entre 12 e 0", porque
// `Number(null)` é 0 e passava por `Number.isFinite`. Nenhuma leitura consegue
// ser conforme numa faixa dessas — todas saem 'danger', em qualquer
// temperatura. Mesma família do `null <= 3` corrigido no painel admin no
// mesmo dia.
// ─────────────────────────────────────────────────────────────────────────────

describe('limite VAZIO não pode virar zero', () => {
  it('o cenário exato da Swiss: min 12, max vazio → heurística de freezer', () => {
    const eq = { label: 'Freezer', minTemp: 12, maxTemp: null };
    expect(resolveLimits('Freezer', eq)).toEqual({ min: -25, max: -18 });
  });

  it('e com isso um freezer a -18 volta a ser CONFORME', () => {
    const eq = { label: 'Freezer', minTemp: 12, maxTemp: null };
    const { min, max } = resolveLimits('Freezer', eq);
    expect(resolveTone(-18, min, max)).toBe('ok');
    // prova do defeito antigo: a faixa 12/0 condenava qualquer valor
    expect(resolveTone(-18, 12, 0)).toBe('danger');
    expect(resolveTone(0,   12, 0)).toBe('danger');
    expect(resolveTone(12,  12, 0)).toBe('danger');
  });

  it('vale pros três jeitos de "vazio" e pros dois lados da faixa', () => {
    for (const vazio of [null, undefined, '']) {
      expect(resolveLimits('Freezer', { maxTemp: -18, minTemp: vazio })).toEqual(heuristicLimits('Freezer'));
      expect(resolveLimits('Freezer', { minTemp: -21, maxTemp: vazio })).toEqual(heuristicLimits('Freezer'));
    }
  });

  it('mesma regra quando a faixa vem do catálogo (array), não do objeto', () => {
    const catalogo = [{ label: 'Freezer', aliases: ['freezer'], minTemp: 12, maxTemp: null }];
    expect(resolveLimits('freezer', catalogo)).toEqual({ min: -25, max: -18 });
  });

  it('faixa cadastrada de verdade continua vencendo a heurística', () => {
    // a correção não pode fazer o catálogo perder pra o palpite pelo nome
    expect(resolveLimits('Freezer', { minTemp: -21, maxTemp: -18 })).toEqual({ min: -21, max: -18 });
    const catalogo = [{ label: 'Freezer', aliases: [], minTemp: -21, maxTemp: -18 }];
    expect(resolveLimits('Freezer', catalogo)).toEqual({ min: -21, max: -18 });
  });

  it('ZERO de verdade continua sendo um limite válido — não pode virar vazio', () => {
    // geladeira 0..9 é o caso comum do projeto; se o fix confundisse 0 com
    // vazio, toda geladeira cairia na heurística sem necessidade
    expect(resolveLimits('Refrigerador', { minTemp: 0, maxTemp: 9 })).toEqual({ min: 0, max: 9 });
  });
});
