// ─────────────────────────────────────────────────────────────────────────────
// Frequência própria por tarefa dentro de uma planilha — item 13 da revisão
// de produto (09/08). "Paredes (trimestral)" numa planilha semanal de faxina
// cobrava toda semana porque só a planilha tinha frequência, não a tarefa.
// `field.frequency` (opcional) sobrepõe a frequência da planilha só pra essa
// tarefa — sem ele, comportamento idêntico ao de sempre (sempre devido).
//
// Os "buckets" abaixo são só pra comparar "mudou de ciclo" — não são as
// mesmas chaves de `getPeriodKey` (que servem pra agrupar records por
// período da PLANILHA, não da tarefa individual). 'biweekly' usa a mesma
// definição (dia ≤15 / >15) que `getPeriodKey` já usa, por consistência.
// ─────────────────────────────────────────────────────────────────────────────

const FREQUENCY_DAYS = { daily: 1, weekly: 7, biweekly: 15, monthly: 30, bimonthly: 60, quarterly: 90, annual: 365 };

function bucketKey(frequency, date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  switch (frequency) {
    case 'daily':     return `${y}-${m}-${date.getDate()}`;
    case 'weekly':    { const start = new Date(y, 0, 1); const days = Math.floor((date - start) / 86400000); return `${y}-w${Math.floor(days / 7)}`; }
    case 'biweekly':  return `${y}-${m}-${date.getDate() <= 15 ? 'a' : 'b'}`;
    case 'monthly':   return `${y}-${m}`;
    case 'bimonthly': return `${y}-${Math.floor(m / 2)}`;
    case 'quarterly': return `${y}-${Math.floor(m / 3)}`;
    case 'annual':    return `${y}`;
    default:          return `${y}-${m}-${date.getDate()}`;
  }
}

// Devido = é a primeira instância da planilha desde que o "ciclo" da tarefa
// mudou (comparado com um período de planilha atrás). Se a tarefa não tem
// frequência própria, ou a própria frequência dela é igual ou MAIS curta que
// a da planilha (ex.: tarefa diária numa planilha semanal), sempre devido —
// o modelo de 1-record-por-período-da-planilha não tem como cobrar mais
// vezes que isso mesmo que a tarefa "devesse" ser mais frequente.
export function isFieldDue(field, templateFrequency, now = new Date()) {
  const fieldFreq = field?.frequency;
  if (!fieldFreq || fieldFreq === templateFrequency) return true;
  const fieldDays = FREQUENCY_DAYS[fieldFreq] ?? 0;
  const templateDays = FREQUENCY_DAYS[templateFrequency] ?? 0;
  if (fieldDays <= templateDays) return true;
  const previous = new Date(now.getTime() - templateDays * 86400000);
  return bucketKey(fieldFreq, now) !== bucketKey(fieldFreq, previous);
}

export function dueFields(fields, templateFrequency, now = new Date()) {
  return (fields ?? []).filter((f) => isFieldDue(f, templateFrequency, now));
}
