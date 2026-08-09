// ─────────────────────────────────────────────────────────────────────────────
// Config do modo quiosque — separado de kiosk.jsx de propósito: kiosk.jsx é
// lazy-loaded (KioskApp/KioskSetup/FormKioskApp só entram no bundle quando o
// quiosque abre). pages.jsx precisa checar se há um quiosque configurado logo
// no boot (pra restaurar depois de um reload) — um import estático de dentro
// de kiosk.jsx puxaria o módulo inteiro pro bundle principal e cancelaria o
// lazy-load. Este arquivo não importa nada pesado, então pages.jsx pode
// importá-lo direto sem esse efeito colateral.
// ─────────────────────────────────────────────────────────────────────────────

const KIOSK_KEY = 'nutriops.kiosk.config';
const ls = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const lw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function readKioskConfig() { return ls(KIOSK_KEY, null); }
export function writeKioskConfig(v) { lw(KIOSK_KEY, v); }

// Um config salvo de OUTRA loja (ex.: a conta trocou de empresa) não deve
// reabrir o quiosque errado — só restaura quando o tenant bate com o atual.
export function resolveInitialKioskConfig(saved, activeTenantId) {
  return saved?.tenantId === activeTenantId ? saved : null;
}
