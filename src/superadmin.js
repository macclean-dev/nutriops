// ─── Super Admin — fundação (pura e testável) ───────────────────────────────
// Módulo leve pra a área "Super Admin" DENTRO do app (rail), sem puxar o
// admin.jsx pesado. Cobre: catálogo de planos, audit log de ações
// administrativas, lista unificada de tenants (clients do /admin + seeds) e
// helpers puros de mudar plano / suspender.
//
// ⚠️ Enforcement é client-side (MVP): suspensão só "morde" clientes criados via
// /admin (trial.jsx casa por accessToken). Seeds (swiss/backerei/dbk) são
// internos — aparecem pra impersonate/saúde, mas suspender neles é cosmético
// até o épico Auth+RLS (server-side). Ver docs/AUTH_RLS_PLAN.md.

const AUDIT_KEY = 'nutriops.superadmin.audit';
const AUDIT_CAP = 500;

const ls = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const lw = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Catálogo de planos — mesmo do /admin, replicado aqui de propósito pra a view
// do app não importar o chunk pesado do admin.jsx. (De-dup possível no futuro.)
export const PLANS = [
  { id:'trial',      label:'Trial',      color:'#8a4e00', price:0,    maxUsers:5,  description:'14 dias gratuitos' },
  { id:'loja',       label:'Loja',       color:'#00684a', price:149,  maxUsers:15, description:'1 unidade — R$149/mês' },
  { id:'rede',       label:'Rede',       color:'#00a35c', price:349,  maxUsers:999,description:'Até 3 unidades — R$349/mês' },
  { id:'enterprise', label:'Enterprise', color:'#7c3aed', price:null, maxUsers:999,description:'Sob consulta' },
];

export function planLabel(planId) {
  return PLANS.find(p => p.id === normalizePlanId(planId))?.label ?? String(planId ?? '—');
}

// Seeds guardam plano como label ('Pro'/'Enterprise'); clients como id
// ('loja'/'rede'). Normaliza pra um id do catálogo PLANS.
export function normalizePlanId(plan) {
  const p = String(plan ?? '').trim().toLowerCase();
  if (PLANS.some(x => x.id === p)) return p;
  if (p === 'pro') return 'loja';
  if (p === 'enterprise') return 'enterprise';
  if (p === 'rede' || p === 'network') return 'rede';
  if (p === 'trial') return 'trial';
  return 'loja';
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export function readAudit() { return ls(AUDIT_KEY, []); }

// entry: { type, tenantId, tenantName, detail, actor }. Carimba `at` (ISO).
export function appendAudit(entry) {
  const next = [{ ...entry, at: entry?.at ?? new Date().toISOString() }, ...readAudit()].slice(0, AUDIT_CAP);
  lw(AUDIT_KEY, next);
  return next;
}

// ─── Lista unificada de tenants ──────────────────────────────────────────────
// Junta clients (/admin) + seeds numa lista só, sem duplicar por id. Pura.
export function mergeTenants(clients = [], seedTenants = []) {
  const out = [];
  const seen = new Set();
  for (const c of (clients ?? [])) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: c.id, name: c.name ?? c.id, segment: c.segment ?? '',
      plan: normalizePlanId(c.plan), active: c.active !== false,
      createdAt: c.createdAt ?? null, accessToken: c.accessToken ?? null,
      trialEndsAt: c.trialEndsAt ?? null, billingStatus: c.billingStatus ?? null,
      source: 'client',
    });
  }
  for (const t of (seedTenants ?? [])) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({
      id: t.id, name: t.name ?? t.id, segment: t.segment ?? '',
      plan: normalizePlanId(t.plan), active: true,
      createdAt: null, accessToken: null, trialEndsAt: null, billingStatus: null,
      source: 'seed',
    });
  }
  return out;
}

// ─── Ações puras sobre a lista de clients ────────────────────────────────────
// Retornam um NOVO array de clients (o caller persiste + faz audit + pushTenant).
// Só afetam clients reais; se o id for de um seed (sem client), retorna igual.
export function setClientPlan(clients, id, planId) {
  const plan = normalizePlanId(planId);
  return (clients ?? []).map(c => c.id === id ? { ...c, plan, updatedAt: new Date().toISOString() } : c);
}

export function setClientActive(clients, id, active) {
  return (clients ?? []).map(c => c.id === id ? { ...c, active: Boolean(active), updatedAt: new Date().toISOString() } : c);
}
