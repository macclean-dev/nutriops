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
  let res;
  try {
    res = await fetch(`${sbAuthBase()}${path}`, {
      method: 'POST', headers: sbHeaders(), body: JSON.stringify(body),
    });
  } catch (e) {
    // fetch só rejeita por falha de REDE (offline, DNS, CORS). Marcamos pra
    // quem chama não confundir "sem internet" com "credencial inválida".
    const err = new Error('Sem conexão com o servidor de autenticação.');
    err.isNetworkError = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description ?? data.msg ?? 'Erro de autenticação');
    err.status = res.status; // deixa refreshSession distinguir 5xx/429 de 400/401
    throw err;
  }
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
export function clearAuthSession() {
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
  // Revogar no servidor ANTES de limpar. Antes, o clearAuthSession() vinha
  // primeiro, então readAuthSession() já devolvia null e o POST /logout era
  // código morto — o refresh token seguia válido no servidor após "Sair".
  try {
    if (isSupabaseEnabled()) {
      const s = readAuthSession();
      if (s?.accessToken) {
        await fetch(`${sbAuthBase()}/logout`, {
          method: 'POST',
          headers: { ...sbHeaders(), Authorization: `Bearer ${s.accessToken}` },
        });
      }
    }
  } catch { /* rede caiu — limpa localmente mesmo assim (abaixo) */ }
  clearAuthSession();
}

// ─── Reset password ────────────────────────────────────────────────────────

export async function resetPassword(email) {
  if (!isSupabaseEnabled()) throw new Error('Supabase não configurado.');
  await sbAuthFetch('/recover', { email });
}

// ─── Refresh token ─────────────────────────────────────────────────────────

// ⚠️ SINGLE-FLIGHT (16/08). `syncAllModules` roda 19 tabelas em paralelo e
// cada uma chama getValidAccessToken(). Quando o token de 1h expira, as 19
// tentavam renovar AO MESMO TEMPO com o mesmo refresh token — e o Supabase
// ROTACIONA refresh token no uso: a primeira ganha, as outras 18 recebem
// "already used" (400/401) e o catch abaixo DESLOGAVA a loja inteira.
//
// Efeito observado em produção (15/08, 23:05): banner vermelho "chave do
// Supabase inválida" na CASA DOCE. A chave estava perfeita — o que falhou foi
// a corrida. Sem token válido, sbHeaders cai na anon key (repository.js), que
// sob RLS não alcança tabela real: 401.
//
// Aqui a 1ª chamada faz a renovação e as outras 18 esperam a MESMA promessa.
// Uma requisição só, um vencedor, zero perdedores.
let refreshEmVoo = null;

export async function refreshSession() {
  if (refreshEmVoo) return refreshEmVoo;          // já tem uma em voo: pega carona
  refreshEmVoo = doRefreshSession().finally(() => { refreshEmVoo = null; });
  return refreshEmVoo;
}

async function doRefreshSession() {
  const s = readAuthSession();
  if (!s?.refreshToken || !isSupabaseEnabled()) return null;
  try {
    const data = await sbAuthFetch('/token?grant_type=refresh_token', { refresh_token: s.refreshToken });
    const session = preserveMembershipScope(
      buildSession(data.user, data.access_token, data.refresh_token),
      s,
    );
    saveAuthSession(session);
    return session;
  } catch (e) {
    // Só desloga quando o SERVIDOR rejeitou o refresh token (expirado/revogado).
    // Queda de internet NÃO pode deslogar: o PDV da loja ficaria trancado pra
    // fora do registro sanitário até a rede voltar. Mantém a sessão e tenta
    // de novo depois.
    // Só limpa em rejeição REAL do token (400/401). Rede caída, 5xx ou 429
    // (throttle) são transitórios — manter a sessão e tentar de novo depois,
    // pra não trancar o PDV da loja por instabilidade passageira do servidor.
    if (e?.isNetworkError || e?.status >= 500 || e?.status === 429) return null;

    // Cinto de segurança do single-flight: se OUTRA chamada já renovou com
    // sucesso enquanto esta estava no ar, o token no storage é novo e válido —
    // o 400/401 aqui é só "refresh token já rotacionado", não credencial
    // podre. Deslogar aqui trancaria a loja por uma corrida que já foi vencida.
    const agora = readAuthSession();
    if (agora?.accessToken && agora.accessToken !== s.accessToken && isSessionValid(agora)) return agora;

    clearAuthSession();
    return null;
  }
}

// ─── Build session object ──────────────────────────────────────────────────

function buildSession(user, accessToken, refreshToken) {
  const meta = user.user_metadata ?? {};
  const appMeta = user.app_metadata ?? {};
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 3600 * 1000, // 1h
    tenantId:  meta.tenantId ?? null,
    // Admin da PLATAFORMA (NutriOPS), não de uma loja. Vem do app_metadata, que
    // só o service_role escreve — user_metadata é editável pelo próprio usuário
    // (updateUser), então confiar nele pra privilégio seria forjável.
    isPlatformAdmin: appMeta.role === 'admin',
    // Conta GENÉRICA de loja (Fase 4), não uma pessoa — liga a tela "Quem está
    // registrando?" (src/operator.js). Gravado pelo invite-collaborator no
    // user_metadata; sobrevive ao escopo por membership (scopeSessionToMembership
    // faz spread do objeto de sessão inteiro) e ao preserveMembershipScope do
    // refresh (idem).
    isStoreAccount: meta.isStoreAccount === true,
    user: {
      id:       user.id,
      email:    user.email,
      name:     meta.name ?? user.email,
      role:     meta.role ?? 'Colaborador',
      location: meta.tenantName ?? '',
    },
  };
}

// Reaplica o escopo por loja que o login estabeleceu. buildSession só enxerga o
// user_metadata do JWT — e contas criadas no painel/Edge Function têm
// tenantId nulo lá. Sem isto, o refresh de 1h apagava o vínculo e "promovia" a
// dona da CASA DOCE a admin global, que passava a ver Swiss/Bäckerei/DBK
// (vazamento cross-tenant relatado em 30/07).
export function preserveMembershipScope(fresh, previous) {
  if (!previous?.memberTenants?.length) return fresh;
  return {
    ...fresh,
    tenantId: previous.tenantId ?? fresh.tenantId,
    memberTenants: previous.memberTenants,
    user: {
      ...fresh.user,
      role:     previous.user?.role     ?? fresh.user.role,
      location: previous.user?.location ?? fresh.user.location,
    },
  };
}

// ─── Fase 3: escopo por membership (tenant_members) ─────────────────────────
// O papel no vínculo é conceito de banco; o app conhece outros nomes. tenant_admin
// (dono da loja) = Administrador DENTRO da própria loja (tem tenantId, então NÃO
// é admin global — isGlobalAdmin exige tenantId nulo). Os demais papéis do vínculo
// (Nutricionista RT, Supervisor, Colaborador) já são papéis do app.
const MEMBER_ROLE_TO_APP = { tenant_admin: 'Administrador' };

// Escopa uma sessão Supabase Auth às empresas do membro. Pura e testável: se o
// usuário não pertence a nenhuma empresa (memberTenants vazio), devolve a sessão
// intacta — é o caminho do admin global (papel/tenant vêm do app_metadata).
export function scopeSessionToMembership(session, memberTenants) {
  if (!session || !Array.isArray(memberTenants) || memberTenants.length === 0) return session;
  const primary = memberTenants[0];
  const appRole = MEMBER_ROLE_TO_APP[primary.memberRole] ?? primary.memberRole ?? session.user?.role;
  return {
    ...session,
    tenantId: primary.id,
    user: { ...session.user, role: appRole, location: primary.name ?? session.user?.location },
    memberTenants: memberTenants.map((t) => ({ id: t.id, name: t.name, role: t.memberRole })),
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

// ─── Convidar colaborador — cria conta + vínculo via Edge Function ───────────
// O dono da loja (tenant_admin) cria a conta do colaborador COM senha inicial.
// Passa pela Edge Function invite-collaborator, que guarda a service_role no
// servidor (nunca no bundle) e autoriza pelo JWT do chamador.
//
// ⚠️ O antigo inviteUser chamava /auth/v1/admin/users com o token do usuário —
// endpoint que SÓ aceita service_role, então nunca funcionaria pra um dono comum
// (e, se alguém pusesse a service_role no cliente, seria a chave-mestra no bundle
// público). Removido em favor deste caminho.
export async function inviteCollaborator({ email, name, role, tenantId, password, isStoreAccount = false }) {
  if (!isSupabaseEnabled()) throw new Error('Supabase não configurado.');
  const token = await getValidAccessToken();
  if (!token) throw new Error('Sua sessão expirou. Entre de novo.');
  const { url, anonKey } = getSupabaseConfig();
  const res = await fetch(`${url.replace(/\/$/, '')}/functions/v1/invite-collaborator`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, role, tenantId, password, isStoreAccount }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Erro ao convidar colaborador');
  return data;
}

// Redefine a senha de um colaborador JÁ vinculado à loja (ex.: dono esqueceu
// a senha inicial que definiu no convite). Mesma Edge Function do convite,
// action='reset_password' — o servidor confere que quem chama é tenant_admin
// dessa loja e que o alvo pertence a ela antes de trocar a senha.
export async function resetCollaboratorPassword({ userId, tenantId, password }) {
  if (!isSupabaseEnabled()) throw new Error('Supabase não configurado.');
  const token = await getValidAccessToken();
  if (!token) throw new Error('Sua sessão expirou. Entre de novo.');
  const { url, anonKey } = getSupabaseConfig();
  const res = await fetch(`${url.replace(/\/$/, '')}/functions/v1/invite-collaborator`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset_password', userId, tenantId, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Erro ao redefinir senha');
  return data;
}
