// ─────────────────────────────────────────────────────────────────────────────
// Sentinela de tendência — item 5 da revisão de produto (09/08).
//
// O sistema guarda meses de leitura por equipamento e só olha o valor de HOJE
// contra a faixa. Uma câmara subindo 0,4°C por semana está contando que o
// compressor vai falhar — semanas antes do primeiro registro fora da faixa.
// Regressão linear simples resolve; não precisa de IA de verdade pra isso.
//
// Calibrado pra não dar alarme falso (a instrução do dono foi "começar
// conservador"): exige um número mínimo de pontos, um intervalo mínimo real
// de dias, e um ajuste (R²) razoável — três leituras erráticas não bastam.
// ─────────────────────────────────────────────────────────────────────────────

export const TREND_DEFAULTS = {
  windowDays: 21,   // olha só as últimas ~3 semanas — tendência velha não importa
  minPoints: 5,     // poucos pontos = regressão não significa nada
  minSpanDays: 5,   // 3 leituras no mesmo dia não é "tendência ao longo do tempo"
  maxDaysAhead: 14, // muito longe no futuro não é acionável agora
  minR2: 0.5,       // qualidade mínima do ajuste — corta ruído aleatório
};

export function detectTrend(readings, limits, opts = {}) {
  const { windowDays, minPoints, minSpanDays, maxDaysAhead, minR2, now } = { ...TREND_DEFAULTS, ...opts };
  const nowMs = now ?? Date.now();

  const pts = (readings ?? [])
    .map((r) => ({ t: new Date(r.createdAt).getTime(), v: Number(r.value) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);

  const cutoff = nowMs - windowDays * 86400000;
  const recent = pts.filter((p) => p.t >= cutoff);
  if (recent.length < minPoints) return null;

  const spanDays = (recent[recent.length - 1].t - recent[0].t) / 86400000;
  if (spanDays < minSpanDays) return null;

  // Regressão linear simples (mínimos quadrados) — x em dias desde o 1º
  // ponto da janela, pra manter os números pequenos e legíveis.
  const x0 = recent[0].t;
  const xs = recent.map((p) => (p.t - x0) / 86400000);
  const ys = recent.map((p) => p.v);
  const n = xs.length;
  const sumX = xs.reduce((a, x) => a + x, 0);
  const sumY = ys.reduce((a, y) => a + y, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null; // todos os pontos no mesmo instante — sem inclinação possível

  const slope = (n * sumXY - sumX * sumY) / denom; // °C por dia
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  const ssTot = ys.reduce((a, y) => a + (y - meanY) ** 2, 0);
  const ssRes = ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  if (r2 < minR2) return null;

  const direction = slope > 0 ? 'rising' : slope < 0 ? 'falling' : null;
  if (!direction) return null;

  const targetLimit = direction === 'rising' ? limits?.max : limits?.min;
  if (targetLimit == null) return null;

  const lastValue = ys[n - 1];
  // Já fora da faixa não é "tendência" — é alerta de verdade, e o resto do
  // sistema (tone da leitura) já cobre isso. A sentinela é só pra ANTES.
  if (direction === 'rising' && lastValue >= targetLimit) return null;
  if (direction === 'falling' && lastValue <= targetLimit) return null;

  const daysToBreach = (targetLimit - lastValue) / slope;
  if (!Number.isFinite(daysToBreach) || daysToBreach <= 0 || daysToBreach > maxDaysAhead) return null;

  return {
    direction, slopePerDay: slope, r2: Math.round(r2 * 100) / 100,
    spanDays: Math.round(spanDays * 10) / 10,
    totalChange: Math.round(slope * spanDays * 10) / 10,
    daysToBreach: Math.round(daysToBreach * 10) / 10,
    lastValue, limit: targetLimit,
  };
}
