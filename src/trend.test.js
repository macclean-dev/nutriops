import { describe, it, expect } from 'vitest';
import { detectTrend, TREND_DEFAULTS } from './trend';

// Sentinela de tendência (item 5 da revisão de produto, 09/08) — regressão
// linear simples sobre leituras recentes, calibrada pra não dar alarme falso.

const DAY = 86400000;
const NOW = new Date('2026-08-09T12:00:00').getTime();

// Gera N leituras espaçadas por `stepDays`, terminando "hoje" (i=n-1), com
// valor subindo/caindo linearmente a partir de `start` na taxa `perDay`.
function series(start, perDay, n, stepDays = 2) {
  return Array.from({ length: n }, (_, i) => {
    const daysAgo = (n - 1 - i) * stepDays;
    return { value: start + perDay * i * stepDays, createdAt: new Date(NOW - daysAgo * DAY).toISOString() };
  });
}

describe('detectTrend — o caso real da revisão (câmara subindo, a caminho de sair da faixa)', () => {
  it('câmara subindo ~0,4°C/dia, ainda dentro da faixa mas indo estourar em poucos dias: detecta', () => {
    // -6, -5.6, -5.2, -4.8, -4.4, -4.0 (passo de 2 dias, sobe 0.4/dia => 0.8 a cada leitura)
    const readings = series(-6, 0.4, 6, 2); // 10 dias de janela, sobe até -4
    const trend = detectTrend(readings, { min: -18, max: 0 }, { now: NOW });
    expect(trend).not.toBeNull();
    expect(trend.direction).toBe('rising');
    expect(trend.daysToBreach).toBeGreaterThan(0);
    expect(trend.lastValue).toBeLessThan(0); // ainda dentro da faixa
  });

  it('câmara caindo, indo estourar o mínimo: detecta "falling"', () => {
    const readings = series(-10, -0.4, 6, 2); // desce de -10 até -12
    const trend = detectTrend(readings, { min: -18, max: 0 }, { now: NOW });
    expect(trend).not.toBeNull();
    expect(trend.direction).toBe('falling');
  });
});

describe('detectTrend — guardas contra alarme falso', () => {
  it('poucos pontos (menos que o mínimo): não alarma', () => {
    const readings = series(-6, 0.4, 3, 2); // só 3 pontos
    expect(detectTrend(readings, { min: -18, max: 0 }, { now: NOW })).toBeNull();
  });

  it('pontos concentrados num intervalo curto (menos que minSpanDays): não alarma', () => {
    const readings = [0,1,2,3,4].map(i => ({ value: -6 + i*0.4, createdAt: new Date(NOW - i*3600000).toISOString() })); // horas, não dias
    expect(detectTrend(readings, { min: -18, max: 0 }, { now: NOW })).toBeNull();
  });

  it('leituras erráticas (R² baixo): não alarma mesmo com pontos e intervalo suficientes', () => {
    const readings = [-6, -2, -7, -1, -8, -3].map((v, i) => ({ value: v, createdAt: new Date(NOW - (5-i)*3*DAY).toISOString() }));
    expect(detectTrend(readings, { min: -18, max: 0 }, { now: NOW })).toBeNull();
  });

  it('tendência estável (sem inclinação real): não alarma', () => {
    const readings = series(-6, 0, 6, 2); // sempre -6
    expect(detectTrend(readings, { min: -18, max: 0 }, { now: NOW })).toBeNull();
  });

  it('já está FORA da faixa: não é "tendência", é alerta de verdade — a sentinela fica calada', () => {
    const readings = series(2, 0.4, 6, 2); // já positivo, faixa é -18 a 0
    expect(detectTrend(readings, { min: -18, max: 0 }, { now: NOW })).toBeNull();
  });

  it('projeção de estouro longe demais no futuro (> maxDaysAhead): não alarma agora', () => {
    const readings = series(-15, 0.02, 6, 2); // subida bem lenta
    expect(detectTrend(readings, { min: -18, max: 0 }, { now: NOW })).toBeNull();
  });

  it('sem limite superior/inferior cadastrado pro lado que importa: não quebra, não alarma', () => {
    const readings = series(-6, 0.4, 6, 2);
    expect(detectTrend(readings, { min: -18, max: null }, { now: NOW })).toBeNull();
  });

  it('sem leituras: não quebra', () => {
    expect(detectTrend([], { min: -18, max: 0 }, { now: NOW })).toBeNull();
    expect(detectTrend(undefined, { min: -18, max: 0 }, { now: NOW })).toBeNull();
  });

  it('createdAt/value inválidos são ignorados, não quebram o cálculo', () => {
    const readings = [
      { value: 'lixo', createdAt: new Date(NOW).toISOString() },
      { value: -6, createdAt: 'data-invalida' },
      ...series(-6, 0.4, 6, 2),
    ];
    expect(() => detectTrend(readings, { min: -18, max: 0 }, { now: NOW })).not.toThrow();
  });
});

describe('detectTrend — parâmetros configuráveis (pra calibrar depois sem mexer no código)', () => {
  it('minPoints mais permissivo deixa passar uma série curta', () => {
    const readings = series(-6, 0.4, 4, 2);
    expect(detectTrend(readings, { min: -18, max: 0 }, { now: NOW })).toBeNull();
    expect(detectTrend(readings, { min: -18, max: 0 }, { now: NOW, minPoints: 4 })).not.toBeNull();
  });

  it('TREND_DEFAULTS exporta os valores documentados (referência pra quem for calibrar)', () => {
    expect(TREND_DEFAULTS).toMatchObject({ windowDays: 21, minPoints: 5, minSpanDays: 5, maxDaysAhead: 14, minR2: 0.5 });
  });
});
