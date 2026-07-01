// ─── Device Auth (Fase 2 do épico Auth+RLS — docs/AUTH_RLS_PLAN.md) ────────
// Cada tenant tem uma conta Supabase Auth "device" (device-{tenantId}@
// nutriops.internal) cujo JWT carrega tenant_id no user_metadata. Quando RLS
// for ligada (Fase 3), a policy usa esse claim pra autorizar a escrita — não
// mais a anon key crua, que dá acesso a todos os tenants.
//
// O colaborador continua com PIN local — este token é do DEVICE (a estação),
// não da pessoa. Ninguém digita nada; o device loga sozinho em background.
//
// Falha SEMPRE degrada em silêncio: se não houver senha configurada, a rede
// cair, ou a credencial for rejeitada, retorna null. Quem chama (sbHeaders em
// repository.js) cai de volta pra anon key — nunca derruba um sync que já
// funcionava. Hoje, com RLS ainda OFF, isso não muda nada em produção; só
// prepara o mecanismo pra quando a Fase 3 ligar RLS de verdade.
//
// NÃO importa nada de ./repository — repository.js importa DESTE módulo, e
// import circular entre os dois seria frágil. Por isso lê a config do
// Supabase direto do localStorage aqui (duplicação pequena, de propósito).

const SUPABASE_CONFIG_KEY = 'nutriops.supabase.config';
const STORAGE_PREFIX = 'nutriops.device.auth.';

function readSupabaseConfig() {
  try {
    const raw = localStorage.getItem(SUPABASE_CONFIG_KEY);
    return raw ? JSON.parse(raw) : { url: '', anonKey: '' };
  } catch { return { url: '', anonKey: '' }; }
}

export function deviceEmail(tenantId) {
  return `device-${tenantId}@nutriops.internal`;
}

// Senha por tenant, com fallback pra uma senha compartilhada (VITE_DEVICE_PASSWORD).
// Permite trocar pra senhas distintas por tenant no futuro só adicionando a
// env var específica (VITE_DEVICE_PASSWORD_SWISS etc.) — sem mudar código.
function devicePassword(tenantId) {
  const envKey = `VITE_DEVICE_PASSWORD_${String(tenantId).toUpperCase().replace(/-/g, '_')}`;
  return import.meta.env[envKey] || import.meta.env.VITE_DEVICE_PASSWORD || '';
}

function readCache(tenantId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tenantId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeCache(tenantId, session) {
  try { localStorage.setItem(STORAGE_PREFIX + tenantId, JSON.stringify(session)); } catch {}
}

// Pura e testável — margem de 60s pra não usar um token que expira no meio
// de uma requisição em andamento.
export function isTokenValid(cached, now = Date.now()) {
  return Boolean(cached?.accessToken && cached?.expiresAt && now < cached.expiresAt - 60000);
}

async function passwordSignIn(tenantId) {
  const password = devicePassword(tenantId);
  if (!password) return null; // sem senha configurada pra esse tenant — sem device-auth
  const { url, anonKey } = readSupabaseConfig();
  if (!url || !anonKey) return null;
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: deviceEmail(tenantId), password }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.access_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

// Obtém um access token válido pro device do tenant, ou null se qualquer
// coisa falhar. Nunca lança — quem chama trata null caindo pra anon key.
export async function getDeviceAccessToken(tenantId) {
  if (!tenantId) return null;
  try {
    const cached = readCache(tenantId);
    if (isTokenValid(cached)) return cached.accessToken;
    const session = await passwordSignIn(tenantId);
    if (!session) return null;
    writeCache(tenantId, session);
    console.info(`[device-auth] token obtido pro tenant ${tenantId}`);
    return session.accessToken;
  } catch (e) {
    console.debug(`[device-auth] falhou pro tenant ${tenantId} — caindo pra anon key:`, e?.message ?? e);
    return null;
  }
}
