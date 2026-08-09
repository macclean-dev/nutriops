// ─────────────────────────────────────────────────────────────────────────────
// Veredito automático dos controles especiais (item 9 da revisão de produto,
// 09/08) — resfriamento e tratamento térmico já calculavam conformidade mas
// deixavam o campo "Resultado" 100% independente, podendo contradizer a
// própria medição. Aqui: o cálculo pré-seleciona o resultado; o usuário só
// precisa justificar se escolher algo diferente do que a medição indica.
// ─────────────────────────────────────────────────────────────────────────────

export function autoVerdict(compliant) {
  if (compliant === null || compliant === undefined) return null;
  return compliant ? 'conforme' : 'nao_conforme';
}

// 'descartado' é uma decisão de descarte de produto, não um julgamento de
// conformidade — nunca conflita com o cálculo.
export function verdictConflicts(compliant, chosen) {
  const expected = autoVerdict(compliant);
  if (expected === null || (chosen !== 'conforme' && chosen !== 'nao_conforme')) return false;
  return chosen !== expected;
}

const THAW_LIMITS = { refrigerador: { max: 4 }, agua_corrente: { max: 21, exclusive: true } };

// microondas/cozimento não têm critério numérico de temperatura final comparável.
export function thawCompliant(methodId, tempEnd) {
  const limit = THAW_LIMITS[methodId];
  if (!limit || tempEnd === '' || tempEnd === null || tempEnd === undefined) return null;
  const t = Number(tempEnd);
  if (Number.isNaN(t)) return null;
  return limit.exclusive ? t < limit.max : t <= limit.max;
}

// Recebimento: allChecksOk hoje é calculado e nunca usado. Sugere o resultado
// a partir dos checks já marcados, sem forçar — o usuário confirma ou muda.
export function receivingSuggestedResult(checks, checkIds) {
  const marked = checkIds.map((id) => checks[id]).filter(Boolean);
  if (marked.length === 0) return null;
  const allOk = marked.length === checkIds.length && marked.every((v) => v === 'C');
  if (allOk) return 'aceito';
  if (marked.includes('NC')) return 'aceito_parcial';
  return null;
}
