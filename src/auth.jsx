// ─── NutriOPS Auth v1.0 ────────────────────────────────────────────────────
// Supabase Auth with email/password + PIN fallback for kiosk use.
// Falls back gracefully to PIN-only when Supabase is not configured.

import { getSupabaseConfig, isSupabaseEnabled } from './repository';

// ─── Supabase Auth helpers ─────────────────────────────────────────────────

function sbAuthBase() { return `${getSupabaseConfig().url}/auth/v1`; }
function sbHeaders()  {
  const { anonKey } = getSupabaseConfig();
  return { apikey: anonKey, 'Content-Type': 'application/json' };
}

async function sbAuthFetch(path, body) {
  const res = await fetch(`${sbAuthBase()}${path}`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? data.msg ?? 'Erro de autenticação');
  return data;
}

// ─── Auth storage ──────────────────────────────────────────────────────────

const AUTH_SESSION_KEY = 'nutriops.auth.session';

export function readAuthSession() {
  try { const r = localStorage.getItem(AUTH_SESSION_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveAuthSession(s) {
  try { localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(s)); } catch {}
}
function clearAuthSession() {
  try { localStorage.removeItem(AUTH_SESSION_KEY); } catch {}
}

// ─── Sign up ───────────────────────────────────────────────────────────────

export async function signUp({ email, password, name, tenantId, tenantName, role = 'Administrador' }) {
  if (!isSupabaseEnabled()) throw new Error('Supabase não configurado.');
  const data = await sbAuthFetch('/signup', {
    email, password,
    data: { name, tenantId, tenantName, role },
  });
  if (data.user) {
    const session = buildSession(data.user, data.access_token, data.refresh_token);
    saveAuthSession(session);
    return session;
  }
  // Email confirmation required
  return { needsConfirmation: true, email };
}

// ─── Sign in ───────────────────────────────────────────────────────────────

export async function signIn({ email, password }) {
  if (!isSupabaseEnabled()) throw new Error('Supabase não configurado.');
  const data = await sbAuthFetch('/token?grant_type=password', { email, password });
  const session = buildSession(data.user, data.access_token, data.refresh_token);
  saveAuthSession(session);
  return session;
}

// ─── Sign out ──────────────────────────────────────────────────────────────

export async function signOut() {
  clearAuthSession();
  if (!isSupabaseEnabled()) return;
  try {
    const s = readAuthSession();
    if (!s?.accessToken) return;
    await fetch(`${sbAuthBase()}/logout`, {
      method: 'POST',
      headers: { ...sbHeaders(), Authorization: `Bearer ${s.accessToken}` },
    });
  } catch { /* silent */ }
}

// ─── Reset password ────────────────────────────────────────────────────────

export async function resetPassword(email) {
  if (!isSupabaseEnabled()) throw new Error('Supabase não configurado.');
  await sbAuthFetch('/recover', { email });
}

// ─── Refresh token ─────────────────────────────────────────────────────────

export async function refreshSession() {
  const s = readAuthSession();
  if (!s?.refreshToken || !isSupabaseEnabled()) return null;
  try {
    const data = await sbAuthFetch('/token?grant_type=refresh_token', { refresh_token: s.refreshToken });
    const session = buildSession(data.user, data.access_token, data.refresh_token);
    saveAuthSession(session);
    return session;
  } catch { clearAuthSession(); return null; }
}

// ─── Build session object ──────────────────────────────────────────────────

function buildSession(user, accessToken, refreshToken) {
  const meta = user.user_metadata ?? {};
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 3600 * 1000, // 1h
    tenantId:  meta.tenantId ?? null,
    user: {
      id:       user.id,
      email:    user.email,
      name:     meta.name ?? user.email,
      role:     meta.role ?? 'Colaborador',
      location: meta.tenantName ?? '',
    },
  };
}

// ─── Check if session is valid ────────────────────────────────────────────

export function isSessionValid(session) {
  if (!session) return false;
  if (session.expiresAt && Date.now() > session.expiresAt - 60000) return false;
  return true;
}

// ─── MFA / TOTP (2FA do Super Admin) ────────────────────────────────────────
// Fluxo GoTrue: enroll (gera QR/secret) → challenge → verify (código do app).
// Todas as chamadas precisam do access token do admin (Bearer). Nunca lançam
// sem contexto — o gate trata os erros.

function authBearer(accessToken) {
  const { anonKey } = getSupabaseConfig();
  return { apikey: anonKey, 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
}

function mfaToken(accessToken) {
  const t = accessToken ?? readAuthSession()?.accessToken;
  if (!t) throw new Error('Sessão do admin sem token — faça login com e-mail/senha primeiro.');
  return t;
}

// Devolve um access token válido, dando refresh se o atual expirou (~1h). Sem
// isso, o gate do Super Admin travava com 401 mesmo tendo refreshToken válido.
export async function getValidAccessToken() {
  const s = readAuthSession();
  if (!s?.accessToken) return null;
  if (isSessionValid(s)) return s.accessToken;
  const refreshed = await refreshSession();
  return refreshed?.accessToken ?? null;
}

// Remove um fator MFA (usado pra limpar fatores 'unverified' órfãos antes de um
// novo enroll — evita o conflito de friendly_name que travava o setup).
export async function mfaUnenroll(accessToken, factorId) {
  const token = mfaToken(accessToken);
  try {
    await fetch(`${sbAuthBase()}/factors/${factorId}`, { method: 'DELETE', headers: authBearer(token) });
  } catch { /* best-effort */ }
}

// Lista os fatores MFA do usuário (via /auth/v1/user → factors).
export async function mfaListFactors(accessToken) {
  const token = mfaToken(accessToken);
  const res = await fetch(`${sbAuthBase()}/user`, { headers: authBearer(token) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg ?? data.error_description ?? 'Erro ao listar fatores');
  return data?.factors ?? [];
}

// Enroll um fator TOTP novo → devolve { id, totp:{ qr_code, secret, uri } }.
export async function mfaEnroll(accessToken, friendlyName = 'Super Admin') {
  const token = mfaToken(accessToken);
  const res = await fetch(`${sbAuthBase()}/factors`, {
    method: 'POST', headers: authBearer(token),
    body: JSON.stringify({ factor_type: 'totp', friendly_name: friendlyName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg ?? data.error_description ?? 'Erro ao criar fator');
  return data;
}

// Cria um challenge pra um fator → devolve { id }.
export async function mfaChallenge(accessToken, factorId) {
  const token = mfaToken(accessToken);
  const res = await fetch(`${sbAuthBase()}/factors/${factorId}/challenge`, {
    method: 'POST', headers: authBearer(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg ?? data.error_description ?? 'Erro no challenge');
  return data;
}

// Verifica o código do app pra um challenge → eleva a sessão pra AAL2.
// Persiste a sessão nova (com o access token AAL2) pra os próximos requests.
export async function mfaVerify(accessToken, factorId, challengeId, code) {
  const token = mfaToken(accessToken);
  const res = await fetch(`${sbAuthBase()}/factors/${factorId}/verify`, {
    method: 'POST', headers: authBearer(token),
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg ?? data.error_description ?? 'Código inválido');
  if (data.access_token) {
    const session = buildSession(data.user ?? readAuthSession()?.user ?? {}, data.access_token, data.refresh_token);
    saveAuthSession(session);
  }
  return data;
}

// ─── Invite user (admin creates accounts for collaborators) ──────────────

export async function inviteUser({ email, name, role, tenantId, tenantName }) {
  if (!isSupabaseEnabled()) throw new Error('Supabase não configurado.');
  const s = readAuthSession();
  if (!s?.accessToken) throw new Error('Não autenticado.');
  const res = await fetch(`${sbAuthBase()}/admin/users`, {
    method: 'POST',
    headers: { ...sbHeaders(), Authorization: `Bearer ${s.accessToken}` },
    body: JSON.stringify({
      email,
      password: Math.random().toString(36).slice(2, 10), // temp password
      email_confirm: true,
      user_metadata: { name, role, tenantId, tenantName },
    }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.msg ?? 'Erro ao convidar usuário'); }
  return res.json();
}
