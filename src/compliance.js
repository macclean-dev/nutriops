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

export const DOC_TYPES = { ASO: 'aso', MANUAL_BP: 'manual_bp', LEAVE: 'leave_status' };

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

// Afastamento não é resultado de exame — é a situação da pessoa (pedido do
// dono, 23/08: colaboradora em licença aparecia com ASO "Vencido" na Central
// de NC, um alarme falso pra quem nem está trabalhando). Fica como documento
// próprio (`DOC_TYPES.LEAVE`), igual ao ASO, e não dentro do campo
// `resultado` do exame — misturar as duas coisas quebraria a leitura de quem
// vier consultar esse histórico depois (auditoria, fiscal): "licença
// maternidade" não é um resultado de exame físico.
export const LEAVE_TYPE_LABEL = {
  afastado: 'Afastado(a)',
  licenca_maternidade: 'Licença maternidade',
};

// Data de hoje em ISO curto, no fuso de QUEM ESTÁ OLHANDO. `toISOString()`
// devolve UTC: no Brasil (UTC-3) qualquer registro feito depois das 21h
// nasceria com a data de amanhã. Vale pro default do campo de início do
// afastamento (pedido da RT, 24/08) e pra qualquer outro campo de data que
// venha depois.
export function hojeISO(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Texto da linha: "Licença maternidade desde 24/08/2026". Sem data (registro
// gravado antes deste campo existir, v1.9.222) devolve só o rótulo — nunca
// inventa uma data nem esconde o afastamento.
export function descreverAfastamento(leaveType, startedAt) {
  const rotulo = LEAVE_TYPE_LABEL[leaveType];
  if (!rotulo) return null;
  const iso = String(startedAt ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return rotulo;
  const d = new Date(`${iso}T12:00`);
  if (Number.isNaN(d.getTime())) return rotulo;
  return `${rotulo} desde ${d.toLocaleDateString('pt-BR')}`;
}

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

// Afastamento é lido do mesmo `docs` que o ASO, com doc_type próprio — sem
// unique constraint em compliance_docs (mesmo problema do `latestManualBp`
// logo abaixo), então dois aparelhos offline podem gravar cada um sua linha;
// pega a mais recente por updatedAt. Ausência de doc = pessoa não está
// afastada — aqui, diferente do ASO, ausência É o estado normal.
export function currentLeave(subject, docs) {
  let latest = null;
  for (const d of (docs ?? [])) {
    if (d?.docType !== DOC_TYPES.LEAVE || d?.subject !== subject) continue;
    if (!latest || new Date(d.updatedAt ?? 0) >= new Date(latest.updatedAt ?? 0)) latest = d;
  }
  return latest?.leaveType ? latest : null;
}

// Situação da equipe inteira, já contada — é o que a tela e o check A7 leem.
// Colaborador "Inativo" fica de fora: mesma regra do A4 (a tela Equipe tem
// três status e o app trata Ativo/Pendente como quem opera).
export function teamAsoSummary(staff, docs, meses, now = Date.now()) {
  const ativos = (staff ?? []).filter((u) => (u?.status ?? 'Ativo') !== 'Inativo');
  const situacoes = ativos.map((u) => {
    const licenca = currentLeave(u.name, docs);
    return {
      name: u.name, role: u.role,
      leaveType: licenca?.leaveType ?? null,
      leaveStartedAt: licenca?.startedAt ?? null,
      ...employeeAsoStatus(u.name, docs, meses, now),
    };
  });
  // `status` (ok/warn/expired/never) continua honesto pra quem editar o ASO
  // dela — só as CONTAGENS do topo (o que pinta a Central de NC) ignoram
  // quem está afastada, pra não soar alarme de gente que não está trabalhando.
  const contáveis = situacoes.filter((s) => !s.leaveType);
  return {
    total: ativos.length,
    situacoes,
    ok:      contáveis.filter((s) => s.status === 'ok').length,
    warn:    contáveis.filter((s) => s.status === 'warn').length,
    expired: contáveis.filter((s) => s.status === 'expired').length,
    never:   contáveis.filter((s) => s.status === 'never').length,
    leave:   situacoes.filter((s) => s.leaveType).length,
  };
}

// Manual de Boas Práticas — o app não guarda o arquivo, guarda o ATESTADO de
// que ele existe (versão, data, quem elaborou). É o suficiente pra tela parar
// de responder "sem dado": o fiscal aceita o manual impresso, o que faltava
// era o app saber que ele existe. Sem validade: manual não vence, mas
// desatualizado demais merece ressalva.
export const MANUAL_REVISAO_MESES = 24;

// Duas lojas (ou o mesmo aparelho offline duas vezes) podem registrar o
// Manual sem nunca ter sincronizado entre si: cada uma sorteia um `id` novo
// (settings.jsx ManualBpCard), e como `compliance_docs` não tem unique em
// (tenant_id, doc_type) — só `id uuid primary key` — as DUAS linhas convivem
// pra sempre: mergeByKey (repository.js) dedupa por id, não por tipo. Quem lia
// com `.find(d => d.docType === 'manual_bp')` pegava sempre a PRIMEIRA da
// lista — que é sempre a do PRÓPRIO aparelho, porque o merge põe local antes
// de remoto (`[...local, ...remoteRecords]`) — então cada aparelho ficava
// preso na sua versão pra sempre, mesmo depois do outro atualizar a revisão.
// Pegar a mais RECENTE por updatedAt faz os dois aparelhos convergirem pro
// mesmo resultado assim que sincronizarem, sem precisar apagar a linha velha
// nem mexer no schema. Achado nº4 da triagem da auditoria (19/08).
export function latestManualBp(docs) {
  let latest = null;
  for (const d of (docs ?? [])) {
    if (d?.docType !== DOC_TYPES.MANUAL_BP) continue;
    if (!latest) { latest = d; continue; }
    const a = new Date(d?.updatedAt ?? d?.createdAt ?? 0).getTime();
    const b = new Date(latest?.updatedAt ?? latest?.createdAt ?? 0).getTime();
    if (a >= b) latest = d;
  }
  return latest;
}

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
