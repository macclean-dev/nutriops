// ─────────────────────────────────────────────────────────────────────────────
// Resumo semanal da RT — item 12 da revisão de produto (09/08). "RT para de
// caçar pendência tela a tela": em vez de abrir Não-conformidades, Ações e
// Planilhas separadamente, um bloco só por empresa com o que aconteceu nos
// últimos 7 dias. Puro — sem I/O; quem lê os dados é RTPanelView (extras.jsx).
// Reaproveita pendingXItems (nonconformities.js, item 2) e filterByPeriod
// (dossier.js, item 10) em vez de recalcular — mesma lição do item 7.
// ─────────────────────────────────────────────────────────────────────────────

import { filterByPeriod } from './dossier';
import { pendingTemperatureItems, pendingReceivingItems, pendingControlItems, pendingFormItems, CONTROL_TYPES } from './nonconformities';

export function computeWeeklySummary({
  tenant, records, receiving = [], controlsByType = {}, templates = [], formRecords = [],
  actions = [], extractNonConformities, resolveTone, now = Date.now(), windowDays = 7,
}) {
  const periodStart = now - windowDays * 86400000;

  const allNc = [
    ...pendingTemperatureItems(records, tenant.id, resolveTone),
    ...pendingReceivingItems(receiving),
    ...Object.keys(CONTROL_TYPES).flatMap((type) => pendingControlItems(type, controlsByType[type])),
    ...pendingFormItems(templates, formRecords, extractNonConformities),
  ];
  const newNonConformities = filterByPeriod(allNc, periodStart, 'at');

  const actionsOpened = filterByPeriod(actions, periodStart, 'createdAt');
  const actionsResolved = actions.filter((a) => a.status === 'resolvida' && a.closedAt && new Date(a.closedAt).getTime() >= periodStart);
  const actionsStillOpen = actions.filter((a) => a.status !== 'resolvida');

  const formsValidatedThisWeek = formRecords.filter((r) => r.validation?.at && new Date(r.validation.at).getTime() >= periodStart);
  const formsAwaitingValidation = formRecords.filter((r) => r.status === 'submitted' && !r.validation);

  return {
    tenantId: tenant.id, tenantName: tenant.name, periodStart, periodEnd: now,
    newNonConformities, actionsOpened, actionsResolved, actionsStillOpen,
    formsValidatedThisWeek, formsAwaitingValidation,
  };
}

export function ncCountBySource(items) {
  const counts = { temperature: 0, receiving: 0, control: 0, form: 0 };
  for (const item of items ?? []) if (counts[item.source] !== undefined) counts[item.source] += 1;
  return counts;
}

// Texto simples reaproveitável tanto pra "copiar" quanto pro corpo de um
// mailto: — sem depender de nenhum template de e-mail configurado à parte.
export function summaryToText(summary) {
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('pt-BR');
  return [
    `Resumo da semana — ${summary.tenantName}`,
    `${fmtDate(summary.periodStart)} a ${fmtDate(summary.periodEnd)}`,
    '',
    `• ${summary.newNonConformities.length} não conformidade(s) nova(s)`,
    `• ${summary.actionsResolved.length} ação(ões) corretiva(s) resolvida(s) · ${summary.actionsStillOpen.length} ainda aberta(s)`,
    `• ${summary.formsValidatedThisWeek.length} planilha(s) validada(s) · ${summary.formsAwaitingValidation.length} aguardando validação`,
  ].join('\n');
}
