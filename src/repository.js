// ─── Local storage helpers ─────────────────────────────────────────────────

const RECORDS_KEY     = 'nutriops.temperature.records';
const SUPABASE_KEY    = 'nutriops.supabase.config';
const OFFLINE_Q_KEY   = 'nutriops.offline.queue';

function ls(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function lw(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ─── Supabase config ───────────────────────────────────────────────────────

export function getSupabaseConfig()        { return ls(SUPABASE_KEY, { url: '', anonKey: '', enabled: false }); }
export function saveSupabaseConfig(config) { lw(SUPABASE_KEY, config); }
export function isSupabaseEnabled()        { const c = getSupabaseConfig(); return Boolean(c.enabled && c.url && c.anonKey); }

// ─── Offline queue ─────────────────────────────────────────────────────────

export function getOfflineQueue()          { return ls(OFFLINE_Q_KEY, []); }
export function clearOfflineQueue()        { lw(OFFLINE_Q_KEY, []); }

function enqueueOffline(payload) {
  const q = getOfflineQueue();
  lw(OFFLINE_Q_KEY, [...q, { ...payload, _queuedAt: new Date().toISOString() }]);
}

// ─── Field mapping ─────────────────────────────────────────────────────────

function toRow(input) {
  return {
    tenant_id:            input.tenantId,
    tenant_name:          input.tenantName,
    equipment_input:      input.equipmentInput,
    equipment_key:        input.equipmentKey,
    equipment_location:   input.equipmentLocation ?? null,
    measured_at:          input.measuredAt,
    value:                input.value,
    min_value:            input.min,
    max_value:            input.max,
    note:                 input.note ?? null,
    user_name:            input.user,
    user_role:            input.role,
    control_mode:         input.controlMode ?? 'routine',
    observation_interval: input.observationInterval ?? null,
  };
}

function fromRow(row) {
  return {
    id:                  row.id,
    createdAt:           row.created_at,
    tenantId:            row.tenant_id,
    tenantName:          row.tenant_name,
    equipmentInput:      row.equipment_input,
    equipmentKey:        row.equipment_key,
    equipmentLocation:   row.equipment_location,
    measuredAt:          row.measured_at,
    value:               row.value,
    min:                 row.min_value,
    max:                 row.max_value,
    note:                row.note,
    user:                row.user_name,
    role:                row.user_role,
    controlMode:         row.control_mode,
    observationInterval: row.observation_interval,
    equipment:           row.equipment_key,
  };
}

// ─── localStorage repository ───────────────────────────────────────────────

export const localRepository = {
  async list({ tenantId, days = 90 } = {}) {
    const records = ls(RECORDS_KEY, []);
    const cutoff  = Date.now() - (days > 0 ? days * 86400000 : Infinity);
    return records.filter((r) => {
      if (tenantId && r.tenantId !== tenantId) return false;
      if (days > 0 && new Date(r.createdAt).getTime() < cutoff) return false;
      return true;
    });
  },
  async create(input) {
    const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...input };
    const current = ls(RECORDS_KEY, []);
    lw(RECORDS_KEY, [record, ...current].slice(0, 500));
    return record;
  },
  async exportCsv(records = []) {
    const cols = ['createdAt', 'tenantName', 'equipmentInput', 'equipmentKey', 'equipmentLocation', 'measuredAt', 'value', 'min', 'max', 'user', 'role', 'note', 'controlMode'];
    const esc  = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    return [cols.join(','), ...records.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
  },
};

// ─── Supabase REST repository ──────────────────────────────────────────────

export const supabaseRepository = {
  _headers() {
    const { anonKey } = getSupabaseConfig();
    return { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' };
  },
  _base() { return `${getSupabaseConfig().url}/rest/v1`; },

  async list({ tenantId, days = 90 } = {}) {
    const from   = new Date(Date.now() - (days > 0 ? days * 86400000 : 0)).toISOString();
    const filter = [
      tenantId ? `tenant_id=eq.${tenantId}` : null,
      days > 0  ? `created_at=gte.${from}`   : null,
      'order=created_at.desc', 'limit=500',
    ].filter(Boolean).join('&');
    const res = await fetch(`${this._base()}/temperature_records?${filter}`, { headers: this._headers() });
    if (!res.ok) throw new Error(`Supabase list error: ${res.status}`);
    return (await res.json()).map(fromRow);
  },

  async create(input) {
    // If offline, queue for later and fall back to local
    if (!navigator.onLine) {
      const local = await localRepository.create(input);
      enqueueOffline({ ...input, _localId: local.id });
      return { ...local, _pending: true };
    }
    try {
      const res = await fetch(`${this._base()}/temperature_records`, {
        method:  'POST',
        headers: { ...this._headers(), 'Prefer': 'return=representation' },
        body:    JSON.stringify(toRow(input)),
      });
      if (!res.ok) throw new Error(`Supabase create error: ${res.status}`);
      const [row] = await res.json();
      // Also mirror in localStorage for offline reads
      await localRepository.create({ ...input, id: row.id, createdAt: row.created_at });
      return fromRow(row);
    } catch (err) {
      // Network failed — queue and return local record
      const local = await localRepository.create(input);
      enqueueOffline({ ...input, _localId: local.id });
      return { ...local, _pending: true };
    }
  },

  async syncQueue() {
    const queue = getOfflineQueue();
    if (!queue.length || !navigator.onLine) return { synced: 0, failed: 0, remaining: queue.length };
    let synced = 0, failed = 0;
    const remaining = [];
    for (const item of queue) {
      try {
        const { _queuedAt, _localId, ...payload } = item;
        const res = await fetch(`${this._base()}/temperature_records`, {
          method:  'POST',
          headers: { ...this._headers(), 'Prefer': 'return=representation' },
          body:    JSON.stringify(toRow(payload)),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        synced++;
      } catch {
        failed++;
        remaining.push(item);
      }
    }
    lw(OFFLINE_Q_KEY, remaining);
    return { synced, failed, remaining: remaining.length };
  },

  async exportCsv(records = []) { return localRepository.exportCsv(records); },

  async testConnection() {
    try {
      const res = await fetch(`${this._base()}/temperature_records?limit=1`, { headers: this._headers() });
      if (res.ok)                                 return { ok: true };
      if (res.status === 404)                     return { ok: false, reason: 'table_missing' };
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth_error' };
      return { ok: false, reason: `http_${res.status}` };
    } catch { return { ok: false, reason: 'network_error' }; }
  },
};

// ─── Active repository ─────────────────────────────────────────────────────

export function getTemperatureRepository() {
  return isSupabaseEnabled() ? supabaseRepository : localRepository;
}

// ─── SQL schema ────────────────────────────────────────────────────────────

export const SUPABASE_SQL = `-- NutriOPS · Schema completo
-- Execute no Supabase → SQL Editor → New query → Run

-- Registros de temperatura
create table if not exists temperature_records (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null,
  tenant_name          text,
  equipment_input      text,
  equipment_key        text,
  equipment_location   text,
  measured_at          text,
  value                numeric not null,
  min_value            numeric,
  max_value            numeric,
  note                 text,
  user_name            text,
  user_role            text,
  control_mode         text default 'routine',
  observation_interval integer,
  created_at           timestamptz default now()
);

create index if not exists idx_temp_tenant  on temperature_records(tenant_id);
create index if not exists idx_temp_created on temperature_records(created_at desc);
create index if not exists idx_temp_equip   on temperature_records(equipment_key);`;

