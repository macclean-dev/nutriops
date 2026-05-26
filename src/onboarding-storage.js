// Storage helpers do wizard de onboarding — extraídos pro main bundle não
// puxar o wizard inteiro só pra ler tenants persistidos no localStorage.

const ONBOARDING_KEY = 'nutriops.onboarding.tenants';

export function readOnboardingTenants() {
  try { const r = localStorage.getItem(ONBOARDING_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

export function writeOnboardingTenants(tenants) {
  try { localStorage.setItem(ONBOARDING_KEY, JSON.stringify(tenants)); } catch {}
}

export function clearOnboardingTenants() {
  try { localStorage.removeItem(ONBOARDING_KEY); } catch {}
}
