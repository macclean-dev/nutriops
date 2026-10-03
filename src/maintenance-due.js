// ─────────────────────────────────────────────────────────────────────────────
// Vencimento dos planos de manutenção, e a resposta da Prontidão pra RDC 216
// 4.1.16: "manutenção programada e periódica dos equipamentos e utensílios e
// calibração dos instrumentos ou equipamentos de medição, mantendo registro".
//
// O cálculo de vencimento vivia DENTRO da tela de Manutenção. Saiu pra cá
// (candidata 2 da pesquisa de 03/10) pra Prontidão usar a mesma régua; o
// comportamento da tela é o mesmo de antes, linha por linha.
// ─────────────────────────────────────────────────────────────────────────────

export function addDays(iso, days, now = Date.now()) {
  const d = new Date(iso || new Date(now));
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(dateStr, now = Date.now()) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
}

export function dueTone(days) {
  if (days === null) return 'neutral';
  if (days < 0)  return 'expired';
  if (days <= 7)  return 'danger';
  if (days <= 30) return 'warn';
  return 'ok';
}

// Cada equipamento com os planos já calculados: próxima data (a partir da
// última execução registrada do plano, ou da data prevista no cadastro),
// dias até ela e tom. `urgentPlan` = o plano mais próximo de vencer.
export function planosComVencimento(equipments, logs, now = Date.now()) {
  return (equipments ?? []).map((eq) => {
    const plans = (eq.maintenancePlans ?? []).map((plan) => {
      const lastLog = (logs ?? [])
        .filter((l) => l.equipmentId === eq.id && l.planId === plan.id)
        .sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt))[0];
      const nextDue = lastLog
        ? addDays(lastLog.executedAt, plan.frequencyDays, now)
        : plan.nextDue ?? addDays(new Date(now).toISOString(), plan.frequencyDays, now);
      const days = daysUntil(nextDue, now);
      return { ...plan, nextDue, lastLog, days, tone: dueTone(days) };
    });
    // Ordena `plans` NO LUGAR, como a tela sempre fez: a lista de planos de
    // cada equipamento é exibida nesta ordem (mais urgente primeiro).
    const urgentPlan = plans.sort((a, b) => (a.days ?? 999) - (b.days ?? 999))[0];
    return { ...eq, plans, urgentPlan };
  });
}

// ── Calibração registrada em PLANILHA (CASA DOCE: "Calibração de Instrumentos
// de Medição") ─────────────────────────────────────────────────────────────
// O campo "Data da próxima calibração" (`cd-cal-prox`) era gravado e nunca
// lido por nada. Casa pelo RÓTULO do campo, não pelo id do seed: uma planilha
// equivalente criada pela RT também conta. Uma linha por instrumento
// (campo "Identificação do equipamento"), valendo o registro mais recente.
const EH_CAMPO_PROXIMA = (f) => f?.type === 'date' && /pr[oó]xima\s+calibra/i.test(String(f?.label ?? ''));
const EH_CAMPO_EQUIP = (f) => /identifica[cç][aã]o do equipamento|^equipamento$|instrumento/i.test(String(f?.label ?? ''));

export function calibracoesPorPlanilha(formTemplates, formRecords) {
  const porTemplate = new Map();
  for (const t of formTemplates ?? []) {
    const campos = (t.sections ?? []).flatMap((s) => s.fields ?? []);
    const prox = campos.find(EH_CAMPO_PROXIMA);
    if (!prox) continue;
    porTemplate.set(t.id, { prox: prox.id, equip: campos.find(EH_CAMPO_EQUIP)?.id ?? null });
  }
  if (porTemplate.size === 0) return { temPlanilha: false, instrumentos: [] };

  const ultimo = new Map();   // instrumento → registro mais recente
  for (const r of formRecords ?? []) {
    const ids = porTemplate.get(r.formId);
    if (!ids || r.status !== 'submitted') continue;
    const proxima = String(r.responses?.[ids.prox] ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(proxima)) continue;
    const nome = String((ids.equip && r.responses?.[ids.equip]) || 'Instrumento sem identificação').trim();
    const antes = ultimo.get(nome);
    if (!antes || new Date(r.createdAt) > new Date(antes.createdAt)) ultimo.set(nome, { nome, proxima, createdAt: r.createdAt });
  }
  return { temPlanilha: true, instrumentos: [...ultimo.values()] };
}
