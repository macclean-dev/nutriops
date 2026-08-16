// ─────────────────────────────────────────────────────────────────────────────
// Documentos de conformidade — ASO, Manual de BP, alvará (Fatia 2b, 15/08).
//
// Os três DESCOBERTOS que sobravam da auditoria RDC: exigências que o fiscal
// pede e que o app não tinha onde anotar (docs/AUDITORIA_RDC_2026.md §3.4,
// §3.18, §3.21). Puro, sem React nem I/O — padrão de `training-status.js`,
// que resolve exatamente o mesmo tipo de pergunta pra capacitação.
//
// A régua é sempre a mesma: uma data de validade, uma janela de aviso antes
// dela, e `unknown` quando não há dado — porque ausência de documento não é
// documento em ordem (a lição do `pct: null` em limits.js).
// ─────────────────────────────────────────────────────────────────────────────

export const DOC_TYPES = { ASO: 'aso', MANUAL_BP: 'manual_bp' };

export const COMPLIANCE_DEFAULTS = {
  // ⚠️ SUPOSIÇÃO (auditoria §4.3): a RDC 216 manda registrar o controle de
  // saúde mas não fixa periodicidade — 12 meses vem do PCMSO/NR-7, que é o
  // usual. O exame traz a própria data de validade quando o médico define
  // outra; este default só serve quando a loja não preencheu.
  asoValidadeMeses: 12,
  avisoDias: 30,     // "vence em breve" — mesma janela do resto do app
};

export const ASO_STATUS_LABEL = {
  ok: 'Em dia', warn: 'Vence em breve', expired: 'Vencido', never: 'Sem ASO',
};

const diaZero = (ms) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

// Dias até a validade. Meia-noite contra meia-noite, mesma conta de
// `productDaysLeft` (readiness.js) pra "vence hoje" não virar "venceu ontem".
export function diasAteVencer(validUntil, now = Date.now()) {
  if (!validUntil) return null;
  const alvo = new Date(`${String(validUntil).slice(0, 10)}T00:00`).getTime();
  if (Number.isNaN(alvo)) return null;
  return Math.round((alvo - diaZero(now)) / 86400000);
}

// Deriva a validade quando o documento não traz uma: data de emissão + a régua
// da loja. Se nem emissão houver, não há o que derivar — `null`, não hoje.
export function validadeEfetiva(doc, meses = COMPLIANCE_DEFAULTS.asoValidadeMeses) {
  if (doc?.validUntil) return String(doc.validUntil).slice(0, 10);
  if (!doc?.issuedAt) return null;
  const d = new Date(`${String(doc.issuedAt).slice(0, 10)}T00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

// Situação do ASO de UM colaborador. Espelha `employeeTrainingStatus`
// (training-status.js) de propósito: a RDC trata capacitação e controle de
// saúde no mesmo §4.6, e as duas telas ficam lendo a mesma gramática.
export function employeeAsoStatus(employeeName, docs, meses = COMPLIANCE_DEFAULTS.asoValidadeMeses, now = Date.now()) {
  const meus = (docs ?? [])
    .filter((d) => d?.docType === DOC_TYPES.ASO && d?.subject === employeeName)
    .map((d) => ({ ...d, _validade: validadeEfetiva(d, meses) }))
    .filter((d) => d._validade)
    .sort((a, b) => new Date(b._validade) - new Date(a._validade));

  if (meus.length === 0) return { status: 'never', diasRestantes: null, doc: null };

  const atual = meus[0];
  const dias = diasAteVencer(atual._validade, now);
  if (dias < 0) return { status: 'expired', diasRestantes: dias, doc: atual };
  if (dias <= COMPLIANCE_DEFAULTS.avisoDias) return { status: 'warn', diasRestantes: dias, doc: atual };
  return { status: 'ok', diasRestantes: dias, doc: atual };
}

// Situação da equipe inteira, já contada — é o que a tela e o check A7 leem.
// Colaborador "Inativo" fica de fora: mesma regra do A4 (a tela Equipe tem
// três status e o app trata Ativo/Pendente como quem opera).
export function teamAsoSummary(staff, docs, meses, now = Date.now()) {
  const ativos = (staff ?? []).filter((u) => (u?.status ?? 'Ativo') !== 'Inativo');
  const situacoes = ativos.map((u) => ({
    name: u.name, role: u.role,
    ...employeeAsoStatus(u.name, docs, meses, now),
  }));
  return {
    total: ativos.length,
    situacoes,
    ok:      situacoes.filter((s) => s.status === 'ok').length,
    warn:    situacoes.filter((s) => s.status === 'warn').length,
    expired: situacoes.filter((s) => s.status === 'expired').length,
    never:   situacoes.filter((s) => s.status === 'never').length,
  };
}

// Manual de Boas Práticas — o app não guarda o arquivo, guarda o ATESTADO de
// que ele existe (versão, data, quem elaborou). É o suficiente pra tela parar
// de responder "sem dado": o fiscal aceita o manual impresso, o que faltava
// era o app saber que ele existe. Sem validade: manual não vence, mas
// desatualizado demais merece ressalva.
export const MANUAL_REVISAO_MESES = 24;

export function manualBpStatus(doc, now = Date.now()) {
  if (!doc || !doc.issuedAt) return { status: 'never', mesesDesde: null };
  const d = new Date(`${String(doc.issuedAt).slice(0, 10)}T00:00`);
  if (Number.isNaN(d.getTime())) return { status: 'never', mesesDesde: null };
  const mesesDesde = Math.floor((diaZero(now) - d.getTime()) / (30 * 86400000));
  return { status: mesesDesde > MANUAL_REVISAO_MESES ? 'warn' : 'ok', mesesDesde };
}

// Alvará: número + validade. Número sem validade continua valendo como "ok
// com ressalva" (era o comportamento da Fatia 1) — agora que existe campo, a
// ressalva vira um convite a preencher em vez de uma limitação do app.
export function alvaraStatus(profile, now = Date.now()) {
  const numero = String(profile?.alvara ?? '').trim();
  if (!numero) return { status: 'fail', numero: '', dias: null };
  const dias = diasAteVencer(profile?.alvaraValidade, now);
  if (dias === null) return { status: 'warn', numero, dias: null };
  if (dias < 0) return { status: 'fail', numero, dias };
  if (dias <= COMPLIANCE_DEFAULTS.avisoDias) return { status: 'warn', numero, dias };
  return { status: 'ok', numero, dias };
}
