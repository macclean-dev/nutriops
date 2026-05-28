// Sync de tenants criados via /admin — espelha em tabela `tenants` no Supabase
// pra que o cliente possa abrir o link `?token=` em qualquer device e baixar
// o tenant pré-configurado pelo admin.
//
// Schema esperado:
//   tenants (
//     id text primary key,
//     access_token text unique not null,
//     name text, segment text, plan text,
//     brand_color text, brand_soft text,
//     equipment_catalog jsonb,
//     modules jsonb,
//     stores jsonb,
//     setup_pin_hash text,                    -- PBKDF2 do PIN de setup (4 dígitos)
//     setup_pin_used_at timestamptz,          -- null = ainda não consumido
//     setup_pin_attempts integer default 0,   -- tentativas erradas no rate limit
//     setup_pin_locked_until timestamptz,     -- bloqueio temporário após N falhas
//     admin_email text, admin_name text,
//     trial_ends_at timestamptz,
//     created_at timestamptz default now(),
//     updated_at timestamptz default now()
//   );

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

// Upsert tenant — chamado quando admin cria/edita cliente no /admin.
// O tenant é a representação operacional (metadata + setup pin hash).
// Não inclui PINs em plain nem o admin owner — esses ficam só no device do
// cliente após o setup.
export async function pushTenant(tenant) {
  if (!isTenantSyncEnabled()) {
    console.debug('[tenant-sync] push skip — Supabase env vars ausentes');
    return { ok: false, reason: 'no-supabase' };
  }
  const row = {
    id: tenant.id,
    access_token: tenant.accessToken,
    name: tenant.name,
    segment: tenant.segment,
    plan: tenant.plan,
    brand_color: tenant.brandColor,
    brand_soft: tenant.brandSoft,
    equipment_catalog: tenant.equipmentCatalog ?? [],
    modules: tenant.modules ?? [],
    stores: tenant.stores ?? [],
    setup_pin_hash: tenant.setupPinHash,
    admin_email: tenant.adminEmail ?? null,
    admin_name: tenant.adminName ?? null,
    trial_ends_at: tenant.trialEndsAt ?? null,
    updated_at: new Date().toISOString(),
  };
  // Em edições subsequentes não sobrescrevemos o hash nem o estado de
  // consumo do setup pin — só os metadados.
  if (!tenant.setupPinHash) delete row.setup_pin_hash;
  try {
    const res = await fetch(`${sbBase()}/tenants`, {
      method: 'POST',
      headers: sbHeaders('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(row),
    });
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
// abre `?token=`.
export async function fetchTenantByToken(token) {
  if (!isTenantSyncEnabled()) return { ok: false, reason: 'no-supabase' };
  if (!token) return { ok: false, reason: 'no-token' };
  try {
    const res = await fetch(
      `${sbBase()}/tenants?access_token=eq.${encodeURIComponent(token)}&limit=1`,
      { headers: sbHeaders() },
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = await res.json();
    if (!rows.length) return { ok: false, reason: 'not-found' };
    return { ok: true, tenant: rowToTenant(rows[0]), raw: rows[0] };
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
// criar o PIN definitivo. Idempotente — se já foi consumido, devolve ok.
export async function markSetupConsumed(tenantId) {
  if (!isTenantSyncEnabled()) return { ok: false, reason: 'no-supabase' };
  try {
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
  } catch (e) {
    console.warn('[tenant-sync] markSetupConsumed failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Incrementa contador de tentativas erradas. Devolve novo estado (incluindo
// lockedUntil quando aplicar). Server-side é mais seguro que só localStorage.
export async function bumpSetupAttempts(tenantId, { maxBeforeLock = 3, lockMinutes = 15 } = {}) {
  if (!isTenantSyncEnabled()) return { ok: false, reason: 'no-supabase' };
  try {
    // Lê o estado atual
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

    const patch = {
      setup_pin_attempts: nextAttempts,
      setup_pin_locked_until: lockedUntil,
      updated_at: new Date().toISOString(),
    };

    const patchRes = await fetch(
      `${sbBase()}/tenants?id=eq.${encodeURIComponent(tenantId)}`,
      {
        method: 'PATCH',
        headers: sbHeaders('return=minimal'),
        body: JSON.stringify(patch),
      },
    );
    if (!patchRes.ok) throw new Error(`patch ${patchRes.status}`);

    return { ok: true, attempts: nextAttempts, lockedUntil };
  } catch (e) {
    console.warn('[tenant-sync] bumpSetupAttempts failed:', e.message);
    return { ok: false, reason: e.message };
  }
}
