// ─────────────────────────────────────────────────────────────────────────────
// Turnos cadastrados por loja — extraído de pages.jsx (item 7 da revisão de
// produto, 09/08) pra o KPI "cobertura de registro" do dashboard do
// supervisor (overview-v2.jsx, seu próprio chunk lazy-loaded) poder ler o
// número real de turnos em vez de assumir 3 fixo. `computeTurnAlerts`
// (pages.jsx) já lia daqui pra saber quando cobrar pendência; a contagem do
// KPI vivia hardcoded, divergindo se algum dia a loja tiver 2 ou 4 turnos.
// ─────────────────────────────────────────────────────────────────────────────

const turnsKey = (id) => `nutriops.turns.${id}`;
const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

export const DEFAULT_TURNS = [
  { id: 'manha', name: 'Manhã',  start: '06:00', end: '11:59' },
  { id: 'tarde', name: 'Tarde',  start: '12:00', end: '17:59' },
  { id: 'noite', name: 'Noite',  start: '18:00', end: '23:59' },
];

export const readTurns  = (t) => load(turnsKey(t.id), DEFAULT_TURNS);
export const writeTurns = (id, v) => save(turnsKey(id), v);
