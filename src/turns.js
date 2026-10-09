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

// ── Turnos na nuvem (candidata 6 da pesquisa de 03/10) ──────────────────────
// Até a v1.9.266 os turnos viviam SÓ no navegador de cada aparelho: num
// aparelho novo voltavam ao padrão, e dois aparelhos da mesma loja podiam
// cobrar pendência em horários diferentes (alertas, Prontidão A3, cobertura).
// A CASA DOCE opera com "2 tablets e 3 computadores" (relato de 17/08).
//
// Agora moram dentro do perfil da empresa (`company_profile.data.turns`), que
// já sincroniza: sem tabela nova, sem SQL. Lido pela CHAVE do perfil, não por
// settings.jsx, porque este arquivo está no bundle principal (pages.jsx) e a
// tela de Configurações é um chunk pesado.
//
// Ordem de leitura: turnos do perfil (valem pra loja toda) → turnos locais
// deste aparelho (como era antes) → padrão.
const profileKey = (id) => `nutriops.company.profile.${id}`;
const turnosValidos = (v) => Array.isArray(v) && v.length > 0 && v.every((t) => t && t.id && t.start && t.end);

export function turnosDoPerfil(tenantId) {
  const p = load(profileKey(tenantId), null);
  return turnosValidos(p?.turns) ? p.turns : null;
}

export const readTurns  = (t) => turnosDoPerfil(t.id) ?? load(turnsKey(t.id), DEFAULT_TURNS);
export const writeTurns = (id, v) => save(turnsKey(id), v);

// Publica os turnos pra loja toda. Só envia se MUDOU em relação ao que já está
// no perfil: a tela de Turnos grava a cada montagem, e isso não pode virar
// envio. Devolve true quando enviou. `push` injetável pra teste.
export async function publicarTurnos(tenantId, turns, push) {
  if (!turnosValidos(turns)) return false;
  const perfil = load(profileKey(tenantId), {}) ?? {};
  if (JSON.stringify(perfil.turns ?? null) === JSON.stringify(turns)) return false;
  const enviar = push ?? (await import('./repository')).pushCompanyProfile;
  await enviar(tenantId, { ...perfil, turns });
  return true;
}

// Turnos personalizados que ainda não subiram: o aparelho tem algo diferente
// do padrão e o perfil não tem turnos. A tela oferece publicar, em vez de um
// aparelho qualquer decidir sozinho pela loja toda.
export function turnosSoNesteAparelho(tenantId) {
  if (turnosDoPerfil(tenantId)) return false;
  const locais = load(turnsKey(tenantId), null);
  return turnosValidos(locais) && JSON.stringify(locais) !== JSON.stringify(DEFAULT_TURNS);
}

// Turno em andamento agora, com o instante em que começou hoje. Mesma conta
// de computeTurnAlertsPure (turn-alerts.js): minutos do dia, fim inclusivo.
// null quando nenhum turno cobre este horário.
export function turnoAtual(turns, now = new Date()) {
  const agoraMin = now.getHours() * 60 + now.getMinutes();
  for (const t of turns ?? []) {
    if (!t?.start || !t?.end) continue;
    const [sh, sm] = t.start.split(':').map(Number), [eh, em] = t.end.split(':').map(Number);
    const ini = sh * 60 + sm, fim = eh * 60 + em;
    if (agoraMin >= ini && agoraMin <= fim) {
      const inicio = new Date(now); inicio.setHours(sh, sm, 0, 0);
      return { ...t, inicioMs: inicio.getTime() };
    }
  }
  return null;
}
