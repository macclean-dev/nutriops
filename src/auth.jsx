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
