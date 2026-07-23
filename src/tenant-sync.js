// Sync de tenants criados via /admin — espelha em tabela `tenants` no Supabase
// pra que o cliente possa abrir o link `?token=` em qualquer device e baixar
// o tenant pré-configurado pelo admin.
//
// ⚠️ SEGURANÇA (v1.9.31+): a `tenants` guarda access_token + setup_pin_hash +
// e-mail do admin. Com a anon key no bundle e RLS OFF, um `GET tenants?select=*`
// baixava TODOS os access_tokens (→ abrir qualquer loja) — a joia da coroa.
// Fix: o acesso anon passa por FUNÇÕES RPC `security definer` (get_tenant_by_token,
// upsert_tenant, mark_setup_consumed, bump_setup_attempts) e a tabela ganha RLS
// deny-all. A anon NÃO toca mais a tabela direto, e o access_token nunca é
// devolvido (o cliente já tem o token na URL). SQL em docs/security-tenants-lockdown.sql.
//
// Rollout sem janela de quebra: cada função tenta a RPC e, se a função ainda não
// existe no banco (404 — antes de rodar o SQL Parte 1), cai no método REST antigo.
// Depois da Parte 2 (RLS on) a RPC sempre existe → o fallback nunca dispara.
//
// Schema esperado (docs/security-tenants-lockdown.sql tem o completo):
//   tenants ( id text pk, access_token text unique, name, segment, plan,
//             brand_color, brand_soft, equipment_catalog jsonb, modules jsonb,
//             stores jsonb, setup_pin_hash text, setup_pin_used_at timestamptz,
//             setup_pin_attempts int, setup_pin_locked_until timestamptz,
//             admin_email, admin_name, trial_ends_at, created_at, updated_at );

const SB_URL = import.meta.env.VITE_SB_URL || '';
const SB_KEY = import.meta.env.VITE_SB_ANON_KEY || '';

function sbHeaders(prefer = '') {
  const h = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  return h;
}

function sbBase() {
  return `${SB_URL.replace(/\/$/, '')}/rest/v1`;
}

export function isTenantSyncEnabled() {
  return Boolean(SB_URL && SB_KEY);
}

// Chama uma função RPC. Devolve o Response cru pra quem chama decidir fallback.
//
// `token` (JWT da sessão) é OPCIONAL de propósito: as RPCs de onboarding
// (get_tenant_by_token, mark_setup_consumed, bump_setup_attempts) rodam ANTES de
// existir qualquer sessão e precisam mesmo ir como anon. Quem exige privilégio
// (upsert_tenant) passa o token — só assim o Postgres enxerga `authenticated` em
// vez de `anon`, e o gate de role no banco consegue funcionar.
async function sbRpc(fn, args, { token } = {}) {
  return fetch(`${sbBase()}/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${token || SB_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args ?? {}),
  });
}

// 404 = função não existe ainda (antes de rodar o SQL Parte 1) → fallback seguro
// pro método REST antigo. Qualquer outro status é erro real (não mascarar).
function rpcMissing(res) {
  return res.status === 404;
}

// Upsert tenant — chamado quando admin cria/edita cliente no /admin (e quando o
// Super Admin muda o plano). Vai pela RPC upsert_tenant; fallback REST direto.
export async function pushTenant(tenant) {
  if (!isTenantSyncEnabled()) {
    console.debug('[tenant-sync] push skip — Supabase env vars ausentes');
    return { ok: false, reason: 'no-supabase' };
  }
  // upsert_tenant cria/sobrescreve empresa — inclui access_token e setup_pin_hash.
  // Só o admin global pode chamar, então vai com o JWT da sessão e NUNCA cai pra
  // anon: se caísse, o Postgres veria role=anon e o gate server-side seria inútil.
  // Sem sessão o erro tem que aparecer, não ser mascarado.
  const { getValidAccessToken } = await import('./auth');
  const token = await getValidAccessToken();
  if (!token) {
    console.warn('[tenant-sync] push abortado — sem sessão de admin válida');
    return { ok: false, reason: 'no-session' };
  }
  try {
    const res = await sbRpc('upsert_tenant', {
      p_id: tenant.id,
      p_access_token: tenant.accessToken,
      p_name: tenant.name ?? null,
      p_segment: tenant.segment ?? null,
      p_plan: tenant.plan ?? null,
      p_brand_color: tenant.brandColor ?? null,
      p_brand_soft: tenant.brandSoft ?? null,
      p_equipment_catalog: tenant.equipmentCatalog ?? [],
      p_modules: tenant.modules ?? [],
      p_stores: tenant.stores ?? [],
      p_setup_pin_hash: tenant.setupPinHash ?? null, // null = não sobrescreve (a RPC faz coalesce)
      p_admin_email: tenant.adminEmail ?? null,
      p_admin_name: tenant.adminName ?? null,
      p_trial_ends_at: tenant.trialEndsAt ?? null,
    }, { token });
    // Sem fallback REST aqui: a tabela `tenants` está com RLS deny-all, então o
    // caminho direto nunca funciona — ele só mascarava permission-denied como
    // "RPC ausente" e produzia mensagem de erro enganosa.
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${res.status} ${txt}`);
    }
    return { ok: true };
  } catch (e) {
    console.warn('[tenant-sync] push failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Busca um tenant pelo access_token — chamado por main.jsx quando o cliente
// abre `?token=`. Via RPC get_tenant_by_token (NÃO devolve o access_token — o
// cliente já o tem na URL). Fallback REST direto se a RPC ainda não existe.
export async function fetchTenantByToken(token) {
  if (!isTenantSyncEnabled()) return { ok: false, reason: 'no-supabase' };
  if (!token) return { ok: false, reason: 'no-token' };
  try {
    const res = await sbRpc('get_tenant_by_token', { p_token: token });
    if (rpcMissing(res)) return fetchTenantByTokenDirect(token);
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = await res.json();
    if (!rows || !rows.length) return { ok: false, reason: 'not-found' };
    // Reata o access_token (a RPC não devolve por segurança) — o cliente já o tem.
    const row = { ...rows[0], access_token: token };
    return { ok: true, tenant: rowToTenant(row), raw: row };
  } catch (e) {
    console.warn('[tenant-sync] fetch failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

function rowToTenant(row) {
  return {
    id: row.id,
    accessToken: row.access_token,
    name: row.name,
    segment: row.segment,
    plan: row.plan,
    brandColor: row.brand_color,
    brandSoft: row.brand_soft,
    equipmentCatalog: row.equipment_catalog ?? [],
    modules: row.modules ?? [],
    stores: row.stores ?? [{ id: `${row.id}-main`, name: `${row.name} — Principal`, location: 'Principal' }],
    setupPinHash: row.setup_pin_hash,
    setupPinUsedAt: row.setup_pin_used_at,
    setupPinAttempts: row.setup_pin_attempts ?? 0,
    setupPinLockedUntil: row.setup_pin_locked_until,
    adminEmail: row.admin_email,
    adminName: row.admin_name,
    trialEndsAt: row.trial_ends_at,
    multiStore: false,
    audit: [], forms: [], alertsList: [],
  };
}

// Marca o setup PIN como consumido. Chamado após o cliente acertar o PIN e
// criar o PIN definitivo. Idempotente. Via RPC mark_setup_consumed; fallback REST.
export async function markSetupConsumed(tenantId) {
  if (!isTenantSyncEnabled()) return { ok: false, reason: 'no-supabase' };
  try {
    const res = await sbRpc('mark_setup_consumed', { p_tenant_id: tenantId });
    if (rpcMissing(res)) return markSetupConsumedDirect(tenantId);
    if (!res.ok) throw new Error(`${res.status}`);
    return { ok: true };
  } catch (e) {
    console.warn('[tenant-sync] markSetupConsumed failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Incrementa contador de tentativas erradas do setup PIN (server-side, mais
// seguro que só localStorage). Via RPC bump_setup_attempts; fallback REST.
export async function bumpSetupAttempts(tenantId, { maxBeforeLock = 3, lockMinutes = 15 } = {}) {
  if (!isTenantSyncEnabled()) return { ok: false, reason: 'no-supabase' };
  try {
    const res = await sbRpc('bump_setup_attempts', {
      p_tenant_id: tenantId, p_max: maxBeforeLock, p_lock_minutes: lockMinutes,
    });
    if (rpcMissing(res)) return bumpSetupAttemptsDirect(tenantId, { maxBeforeLock, lockMinutes });
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = await res.json();
    const r = (rows && rows[0]) || {};
    if (r.attempts == null) return { ok: false, reason: 'not-found' };
    return { ok: true, attempts: r.attempts, lockedUntil: r.locked_until ?? null };
  } catch (e) {
    console.warn('[tenant-sync] bumpSetupAttempts failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// ─── Lista de tenants do Supabase (fonte da verdade pro painel admin) ────────
// O /admin e o Super Admin listavam clientes só do localStorage (por-device) →
// um cliente criado noutro aparelho não aparecia. Aqui a lista vem do banco via
// RPC admin_list_tenants (gated por app_metadata.role='admin', com o JWT do
// admin). Dev-safe: sem token / RPC ausente / erro → devolve [] e o caller
// mantém a lista local (não derruba o painel).
export async function fetchAllTenantsFromCloud() {
  if (!isTenantSyncEnabled()) return [];
  try {
    const { getValidAccessToken } = await import('./auth');
    const token = await getValidAccessToken();
    if (!token) return [];
    const res = await fetch(`${sbBase()}/rpc/admin_list_tenants`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return []; // 404 (RPC ausente) / 401 / etc → mantém local
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

function cloudRowToClient(row) {
  return {
    id: row.id,
    name: row.name ?? '',
    email: row.admin_email ?? '',
    contact: row.admin_name ?? '',
    plan: row.plan ?? 'trial',
    segment: row.segment ?? '',
    active: row.active ?? true, // `tenants` ainda não tem coluna active → default true (gap conhecido)
    accessToken: row.access_token,
    setupPinHash: row.setup_pin_hash ?? null,
    setupPinUsedAt: row.setup_pin_used_at ?? null,
    brandColor: row.brand_color ?? null,
    brandSoft: row.brand_soft ?? null,
    equipmentCatalog: row.equipment_catalog ?? [],
    modules: row.modules ?? [],
    stores: row.stores ?? [],
    trialEndsAt: row.trial_ends_at ?? null,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? null,
    _fromCloud: true,
  };
}

// Merge: Supabase = fonte da verdade dos campos sincronizados; o local mantém os
// campos que só existem no painel (phone/cnpj/notes/billing). Tenants da nuvem
// que não existem local (criados noutro device) são ADICIONADOS. NÃO remove
// locais ausentes na nuvem (evita perda de rascunho).
export function mergeCloudTenants(localClients = [], cloudRows = []) {
  const byId = new Map((localClients ?? []).map(c => [c.id, c]));
  for (const row of (cloudRows ?? [])) {
    if (!row?.id) continue;
    const existing = byId.get(row.id);
    if (existing) {
      byId.set(row.id, {
        ...existing,
        name:             row.name ?? existing.name,
        plan:             row.plan ?? existing.plan,
        segment:          row.segment ?? existing.segment,
        accessToken:      row.access_token ?? existing.accessToken,
        setupPinHash:     row.setup_pin_hash ?? existing.setupPinHash,
        setupPinUsedAt:   row.setup_pin_used_at ?? existing.setupPinUsedAt,
        brandColor:       row.brand_color ?? existing.brandColor,
        brandSoft:        row.brand_soft ?? existing.brandSoft,
        equipmentCatalog: row.equipment_catalog ?? existing.equipmentCatalog,
        modules:          row.modules ?? existing.modules,
        stores:           row.stores ?? existing.stores,
        trialEndsAt:      row.trial_ends_at ?? existing.trialEndsAt,
        updatedAt:        row.updated_at ?? existing.updatedAt,
      });
    } else {
      byId.set(row.id, cloudRowToClient(row));
    }
  }
  return [...byId.values()];
}

// ─── Fallbacks REST diretos (usados só enquanto as RPCs não existem no banco,
// i.e. antes de rodar o SQL Parte 1). Depois da Parte 2 (RLS on) a tabela fica
// deny-all e estes caminhos param de ser alcançados — a RPC sempre existe. ──────

// (pushTenantDirect removido: escrevia direto na tabela `tenants`, que hoje está
// com RLS deny-all + grants revogados. Nunca funcionaria, e mascarava erro de
// permissão como "RPC ausente". O upsert vai só pela RPC, com o JWT do admin.)

async function fetchTenantByTokenDirect(token) {
  const res = await fetch(
    `${sbBase()}/tenants?access_token=eq.${encodeURIComponent(token)}&limit=1`,
    { headers: sbHeaders() },
  );
  if (!res.ok) throw new Error(`${res.status}`);
  const rows = await res.json();
  if (!rows.length) return { ok: false, reason: 'not-found' };
  return { ok: true, tenant: rowToTenant(rows[0]), raw: rows[0] };
}

async function markSetupConsumedDirect(tenantId) {
  const res = await fetch(
    `${sbBase()}/tenants?id=eq.${encodeURIComponent(tenantId)}`,
    {
      method: 'PATCH',
      headers: sbHeaders('return=minimal'),
      body: JSON.stringify({
        setup_pin_used_at: new Date().toISOString(),
        setup_pin_attempts: 0,
        setup_pin_locked_until: null,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!res.ok) throw new Error(`${res.status}`);
  return { ok: true };
}

async function bumpSetupAttemptsDirect(tenantId, { maxBeforeLock = 3, lockMinutes = 15 } = {}) {
  const fetchRes = await fetch(
    `${sbBase()}/tenants?id=eq.${encodeURIComponent(tenantId)}&select=setup_pin_attempts,setup_pin_locked_until&limit=1`,
    { headers: sbHeaders() },
  );
  if (!fetchRes.ok) throw new Error(`fetch ${fetchRes.status}`);
  const rows = await fetchRes.json();
  if (!rows.length) return { ok: false, reason: 'not-found' };

  const prevAttempts = rows[0].setup_pin_attempts ?? 0;
  const nextAttempts = prevAttempts + 1;
  const shouldLock = nextAttempts >= maxBeforeLock;
  const lockedUntil = shouldLock
    ? new Date(Date.now() + lockMinutes * 60_000).toISOString()
    : rows[0].setup_pin_locked_until ?? null;

  const patchRes = await fetch(
    `${sbBase()}/tenants?id=eq.${encodeURIComponent(tenantId)}`,
    {
      method: 'PATCH',
      headers: sbHeaders('return=minimal'),
      body: JSON.stringify({
        setup_pin_attempts: nextAttempts,
        setup_pin_locked_until: lockedUntil,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!patchRes.ok) throw new Error(`patch ${patchRes.status}`);
  return { ok: true, attempts: nextAttempts, lockedUntil };
}
