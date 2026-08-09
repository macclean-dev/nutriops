// ─────────────────────────────────────────────────────────────────────────────
// Status de capacitação canônico — item 7 da revisão de produto (09/08).
//
// Havia 3 definições divergentes espalhadas pelo app: `validityMonths*30*0.85`
// (correto, respeita a configuração de cada loja) em pages.jsx e
// reports-views.jsx, e `306/365 dias FIXOS` (ignora a configuração) em
// reports.jsx — duas vezes. 306/365 só bate com o padrão de fábrica por
// coincidência aproximada: `validityMonths=12` dá `limitDays=360`, não 365 —
// já na configuração padrão há uma janela real de 5 dias (361–365) onde as
// duas contas discordam. Pra qualquer loja que mude o `validityMonths`, o
// relatório com o valor fixo fica completamente errado.
//
// Módulo isolado, sem React: `training.jsx` (a tela) e `reports.jsx`/
// `reports-views.jsx`/`extras.jsx`/`pages.jsx` (outras telas, algumas
// lazy-loaded) importam daqui em vez de reimplementar cada uma a sua conta.
// ─────────────────────────────────────────────────────────────────────────────

export function employeeTrainingStatus(employeeName, sessions, validityMonths = 12, now = Date.now()) {
  const completed = (sessions ?? [])
    .filter((s) => s.status === 'closed' && s.participants?.some((p) => p.name === employeeName && p.confirmed))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (completed.length === 0) return { status: 'never', daysAgo: null, session: null };

  const last = completed[0];
  const daysAgo = Math.floor((now - new Date(last.date).getTime()) / 86400000);
  const limitDays = validityMonths * 30;

  if (daysAgo <= limitDays * 0.85) return { status: 'ok', daysAgo, session: last };
  if (daysAgo <= limitDays)        return { status: 'warn', daysAgo, session: last };
  return                                  { status: 'expired', daysAgo, session: last };
}
