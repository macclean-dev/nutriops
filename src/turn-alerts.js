// ─────────────────────────────────────────────────────────────────────────────
// Alertas de turno — extraídos de pages.jsx (Fatia 1 da "Prontidão para
// Fiscalização", 15/08). A lógica é a MESMA, byte a byte; só mudou de casa.
//
// Motivo da mudança: a tela de Prontidão precisa saber de pendência de turno
// de TODAS as lojas visíveis da RT, não só da ativa. Ela é uma view lazy —
// importar `pages.jsx` de dentro dela seria import circular (pages importa a
// view). Módulo próprio resolve, e de quebra vira testável.
//
// `computeTurnAlertsPure` não toca localStorage (dá pra fixar o `now` no
// teste); `computeTurnAlerts` é o wrapper que ainda tira da lista o que o
// usuário já dispensou hoje — exatamente como era antes.
// ─────────────────────────────────────────────────────────────────────────────

import { dedupeCatalog } from './limits';

// Map { alertId: 'dow mon dd yyyy' }. Um alerta fica dispensado só HOJE — no
// dia seguinte, se ainda estiver pendente, reaparece. Poda entradas antigas.
const dismissedAlertsKey = (tenantId) => `nutriops.alerts.dismissed.${tenantId}`;

const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const save = (key, val)      => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

export function readDismissedAlertIds(tenantId, now = new Date()) {
  const today = now.toDateString();
  const map = load(dismissedAlertsKey(tenantId), {});
  return new Set(Object.keys(map).filter(id => map[id] === today));
}

export function dismissAlertId(tenantId, id, now = new Date()) {
  const today = now.toDateString();
  const map = load(dismissedAlertsKey(tenantId), {});
  // poda entradas de dias anteriores + marca esta como dispensada hoje
  const pruned = {}; for (const k of Object.keys(map)) if (map[k] === today) pruned[k] = today;
  pruned[id] = today;
  save(dismissedAlertsKey(tenantId), pruned);
}

// Núcleo puro: sem localStorage, sem Date.now() escondido. Devolve TODOS os
// alertas do momento, inclusive os que já receberam ciência.
export function computeTurnAlertsPure(turns, records, equipCatalog, tenantId, emImplantacao, now = new Date()) {
  // Modo implantação: enquanto a loja treina a equipe, não cobra pendências de
  // turno (senão vira uma enxurrada de "atrasados" falsos — 44 equip × turnos).
  // Só afeta lojas com a flag (CASA DOCE); seeds operacionais não têm → seguem.
  if (emImplantacao) return [];
  const catalog = dedupeCatalog(equipCatalog); // catálogo pode chegar com dupe (nuvem) → alerta em dobro
  if (!turns?.length || !catalog?.length) return [];
  const todayStr = now.toDateString(), nowMin = now.getHours() * 60 + now.getMinutes();
  const alerts = [];
  for (const turn of turns) {
    const [sh, sm] = turn.start.split(':').map(Number), [eh, em] = turn.end.split(':').map(Number);
    const startMin = sh * 60 + sm, endMin = eh * 60 + em;
    const isActive = nowMin >= startMin && nowMin <= endMin, isPast = nowMin > endMin;
    if (!isActive && !isPast) continue;
    for (const eq of catalog) {
      const hasRecord = records.some((r) => {
        if (r.tenantId !== tenantId) return false;
        if ((r.equipment || r.equipmentInput) !== eq.label) return false;
        const rd = new Date(r.createdAt); if (rd.toDateString() !== todayStr) return false;
        const rMin = rd.getHours() * 60 + rd.getMinutes();
        return rMin >= startMin && rMin <= endMin;
      });
      if (!hasRecord) alerts.push({ id: `${turn.id}-${eq.label}`, turn: turn.name, equipment: eq.label, level: isActive ? 'warn' : 'danger', message: isActive ? `Pendente no turno ${turn.name}` : `Sem registro no turno ${turn.name} (encerrado)` });
    }
  }
  return alerts;
}

export function computeTurnAlerts(turns, records, equipCatalog, tenantId, emImplantacao, now = new Date()) {
  const alerts = computeTurnAlertsPure(turns, records, equipCatalog, tenantId, emImplantacao, now);
  // Remove os que o usuário já deu ciência HOJE (some da lista E do badge).
  const dismissed = readDismissedAlertIds(tenantId, now);
  return dismissed.size ? alerts.filter(a => !dismissed.has(a.id)) : alerts;
}
