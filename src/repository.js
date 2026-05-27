// ─── NutriOPS Repository v2.0 ──────────────────────────────────────────────
// localStorage como cache local + Supabase como fonte de verdade na nuvem.
// Cada módulo tem suas próprias funções de leitura/escrita.

// ─── Helpers ───────────────────────────────────────────────────────────────

const SUPABASE_KEY = 'nutriops.supabase.config';
const OFFLINE_Q_KEY = 'nutriops.offline.queue';
const SYNC_STATUS_KEY = 'nutriops.sync.status';

export const ls = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
export const lw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ─── Supabase config ───────────────────────────────────────────────────────

export function getSupabaseConfig()         { return ls(SUPABASE_KEY, { url:'', anonKey:'', enabled:false }); }
export function saveSupabaseConfig(config)  { lw(SUPABASE_KEY, config); }
export function isSupabaseEnabled()         { const c = getSupabaseConfig(); return Boolean(c.enabled && c.url && c.anonKey); }

function sbHeaders() {
  const { anonKey } = getSupabaseConfig();
  return { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' };
}
function sbBase() { return `${getSupabaseConfig().url}/rest/v1`; }

// Generic Supabase REST call
async function sbFetch(table, params = {}) {
  const { method='GET', filter='', body=null, prefer='' } = params;
  const url = `${sbBase()}/${table}${filter ? '?'+filter : ''}`;
  const headers = { ...sbHeaders() };
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`SB ${method} ${table}: ${res.status}`);
  if (method === 'DELETE') return true;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Offline queue ─────────────────────────────────────────────────────────

export function getOfflineQueue()   { return ls(OFFLINE_Q_KEY, []); }
export function clearOfflineQueue() { lw(OFFLINE_Q_KEY, []); }

function enqueue(table, operation, payload) {
  const q = getOfflineQueue();
  lw(OFFLINE_Q_KEY, [...q, { table, operation, payload, _at: new Date().toISOString() }]);
}

// ─── Sync status ────────────────────────────────────────────────────────────

export function getSyncStatus()         { return ls(SYNC_STATUS_KEY, { lastSync: null, pending: 0 }); }
export function setSyncStatus(status)   { lw(SYNC_STATUS_KEY, { ...getSyncStatus(), ...status, updatedAt: new Date().toISOString() }); }

// ─── Generic module syncer ──────────────────────────────────────────────────

export async function syncModule({ table, localKey, tenantId, toRow, fromRow, filter = '' }) {
  if (!isSupabaseEnabled() || !navigator.onLine) {
    console.debug(`[repo] syncModule(${table}) skip — offline_or_disabled`);
    return { ok: false, reason: 'offline_or_disabled' };
  }
  console.debug(`[repo] syncModule(${table} tenant=${tenantId}) start`);
  try {
    const q = [`tenant_id=eq.${tenantId}`, 'order=created_at.desc', 'limit=1000', filter].filter(Boolean).join('&');
    const rows = await sbFetch(table, { filter: q });
    const remoteRecords = rows.map(fromRow);
    const local = ls(localKey, []);
    const merged = mergeByKey([...local, ...remoteRecords], 'id');
    lw(localKey, merged);
    console.debug(`[repo] syncModule(${table}) done — pulled ${remoteRecords.length} remote, ${merged.length} total`);
    return { ok: true, count: remoteRecords.length };
  } catch (e) {
    console.warn(`[repo] syncModule(${table}) failed:`, e.message);
    return { ok: false, reason: e.message };
  }
}

function mergeByKey(arr, key) {
  const map = new Map();
  for (const item of arr) {
    const existing = map.get(item[key]);
    if (!existing || new Date(item.updatedAt ?? item.createdAt ?? 0) >= new Date(existing.updatedAt ?? existing.createdAt ?? 0)) {
      map.set(item[key], item);
    }
  }
  return [...map.values()];
}

// ─── Push local data to Supabase ───────────────────────────────────────────

export async function pushModule({ table, localKey, toRow }) {
  if (!isSupabaseEnabled() || !navigator.onLine) {
    console.debug(`[repo] pushModule(${table}) skip — offline_or_disabled`);
    return { ok: false };
  }
  const records = ls(localKey, []);
  if (!records.length) {
    console.debug(`[repo] pushModule(${table}) skip — nada local`);
    return { ok: true, pushed: 0 };
  }
  console.debug(`[repo] pushModule(${table}) start — ${records.length} registros locais`);
  let pushed = 0, failed = 0;
  for (const record of records) {
    try {
      await sbFetch(table, { method: 'POST', body: toRow(record), prefer: 'resolution=merge-duplicates,return=minimal' });
      pushed++;
    } catch (e) {
      failed++;
      if (failed === 1) console.warn(`[repo] pushModule(${table}) primeiro erro:`, e.message);
    }
  }
  console.debug(`[repo] pushModule(${table}) done — ${pushed} ok, ${failed} falharam`);
  return { ok: true, pushed, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPERATURE RECORDS (existing, keep backward compatible)
// ═══════════════════════════════════════════════════════════════════════════

const RECORDS_KEY = 'nutriops.temperature.records';

function tempToRow(input) {
  return {
    id: input.id,
    tenant_id: input.tenantId, tenant_name: input.tenantName,
    equipment_input: input.equipmentInput, equipment_key: input.equipmentKey ?? input.equipment,
    equipment_location: input.equipmentLocation ?? null, measured_at: input.measuredAt,
    value: input.value, min_value: input.min, max_value: input.max,
    note: input.note ?? null, user_name: input.user, user_role: input.role,
    control_mode: input.controlMode ?? 'routine', observation_interval: input.observationInterval ?? null,
    created_at: input.createdAt,
  };
}
function tempFromRow(row) {
  return {
    id: row.id, createdAt: row.created_at,
    tenantId: row.tenant_id, tenantName: row.tenant_name,
    equipmentInput: row.equipment_input, equipmentKey: row.equipment_key,
    equipmentLocation: row.equipment_location, measuredAt: row.measured_at,
    value: row.value, min: row.min_value, max: row.max_value, note: row.note,
    user: row.user_name, role: row.user_role, controlMode: row.control_mode,
    observationInterval: row.observation_interval, equipment: row.equipment_key,
  };
}

export const localRepository = {
  async list({ tenantId, days = 90 } = {}) {
    const records = ls(RECORDS_KEY, []);
    const cutoff = Date.now() - (days > 0 ? days * 86400000 : Infinity);
    return records.filter((r) => {
      if (tenantId && r.tenantId !== tenantId) return false;
      if (days > 0 && new Date(r.createdAt).getTime() < cutoff) return false;
      return true;
    });
  },
  async create(input) {
    const record = { id: input.id ?? crypto.randomUUID(), createdAt: new Date().toISOString(), ...input };
    const current = ls(RECORDS_KEY, []);
    lw(RECORDS_KEY, [record, ...current].slice(0, 1000));
    return record;
  },
  async exportCsv(records = []) {
    const cols = ['createdAt','tenantName','equipmentInput','equipmentKey','equipmentLocation','measuredAt','value','min','max','user','role','note','controlMode'];
    const esc  = (v) => `"${String(v??'').replaceAll('"','""')}"`;
    return [cols.join(','), ...records.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
  },
};

export const supabaseRepository = {
  async list({ tenantId, days = 90 } = {}) {
    const from   = new Date(Date.now() - (days > 0 ? days * 86400000 : 0)).toISOString();
    const filter = [
      tenantId ? `tenant_id=eq.${tenantId}` : null,
      days > 0  ? `created_at=gte.${from}` : null,
      'order=created_at.desc', 'limit=1000',
    ].filter(Boolean).join('&');
    const rows = await sbFetch('temperature_records', { filter });
    // Merge into local cache
    const local = ls(RECORDS_KEY, []);
    const merged = mergeByKey([...local, ...rows.map(tempFromRow)], 'id');
    lw(RECORDS_KEY, merged.slice(0, 1000));
    return rows.map(tempFromRow);
  },
  async create(input) {
    if (!navigator.onLine) {
      const local = await localRepository.create(input);
      enqueue('temperature_records', 'upsert', tempToRow(local));
      return { ...local, _pending: true };
    }
    try {
      const row = await sbFetch('temperature_records', {
        method: 'POST', body: tempToRow({ ...input, id: input.id ?? crypto.randomUUID() }),
        prefer: 'return=representation',
      });
      const record = tempFromRow(Array.isArray(row) ? row[0] : row);
      await localRepository.create(record);
      return record;
    } catch {
      const local = await localRepository.create(input);
      enqueue('temperature_records', 'upsert', tempToRow(local));
      return { ...local, _pending: true };
    }
  },
  async syncQueue() {
    const queue = getOfflineQueue();
    if (!queue.length || !navigator.onLine) {
      console.debug(`[repo] syncQueue skip — ${queue.length} pendentes, online=${navigator.onLine}`);
      return { synced:0, failed:0, remaining:queue.length };
    }
    console.debug(`[repo] syncQueue start — ${queue.length} pendentes`);
    let synced = 0, failed = 0;
    const remaining = [];
    for (const item of queue) {
      try {
        const { table, operation, payload } = item;
        await sbFetch(table, { method:'POST', body:payload, prefer:'resolution=merge-duplicates,return=minimal' });
        synced++;
      } catch { failed++; remaining.push(item); }
    }
    lw(OFFLINE_Q_KEY, remaining);
    setSyncStatus({ lastSync: new Date().toISOString(), pending: remaining.length });
    console.debug(`[repo] syncQueue done — ${synced} ok, ${failed} falharam, ${remaining.length} ainda na fila`);
    return { synced, failed, remaining: remaining.length };
  },
  async exportCsv(records = []) { return localRepository.exportCsv(records); },
  async testConnection() {
    try {
      const res = await fetch(`${sbBase()}/temperature_records?limit=1`, { headers: sbHeaders() });
      if (res.ok)                                    return { ok: true };
      if (res.status === 404)                        return { ok: false, reason: 'table_missing' };
      if (res.status === 401 || res.status === 403)  return { ok: false, reason: 'auth_error' };
      return { ok: false, reason: `http_${res.status}` };
    } catch { return { ok: false, reason: 'network_error' }; }
  },
};

export function getTemperatureRepository() {
  return isSupabaseEnabled() ? supabaseRepository : localRepository;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM RECORDS (Planilhas BPF)
// ═══════════════════════════════════════════════════════════════════════════

function formToRow(r) {
  return {
    id: r.id, tenant_id: r.tenantId, form_id: r.formId, form_title: r.formTitle,
    category: r.category, frequency: r.frequency, period_key: r.periodKey,
    responses: r.responses, status: r.status, validation: r.validation ?? null,
    user_name: r.user, role: r.role,
    created_at: r.createdAt, updated_at: r.updatedAt,
  };
}
function formFromRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id, formId: row.form_id, formTitle: row.form_title,
    category: row.category, frequency: row.frequency, periodKey: row.period_key,
    responses: row.responses, status: row.status, validation: row.validation,
    user: row.user_name, role: row.role,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function syncFormRecords(tenantId) {
  return syncModule({ table:'form_records', localKey:`nutriops.forms.records.${tenantId}`, tenantId, toRow:formToRow, fromRow:formFromRow });
}

export async function pushFormRecord(tenantId, record) {
  const localKey = `nutriops.forms.records.${tenantId}`;
  // Update local first
  const existing = ls(localKey, []);
  const updated  = existing.find(r => r.id === record.id)
    ? existing.map(r => r.id === record.id ? record : r)
    : [...existing, record];
  lw(localKey, updated);
  // Push to Supabase if enabled
  if (!isSupabaseEnabled()) return;
  if (!navigator.onLine) { enqueue('form_records', 'upsert', formToRow(record)); return; }
  try {
    await sbFetch('form_records', { method:'POST', body:formToRow(record), prefer:'resolution=merge-duplicates,return=minimal' });
  } catch { enqueue('form_records', 'upsert', formToRow(record)); }
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM TEMPLATES (customizações por tenant — Vitrine Confeitaria, etc.)
// ═══════════════════════════════════════════════════════════════════════════

function tmplToRow(t, tenantId) {
  return {
    id: t.id, tenant_id: tenantId,
    category: t.category, frequency: t.frequency,
    title: t.title, description: t.description ?? null,
    sections: t.sections,
    updated_at: t.updatedAt ?? new Date().toISOString(),
  };
}
function tmplFromRow(row) {
  return {
    id: row.id, category: row.category, frequency: row.frequency,
    title: row.title, description: row.description,
    sections: row.sections,
    updatedAt: row.updated_at,
  };
}

export async function syncFormTemplates(tenantId) {
  return syncModule({
    table: 'form_templates',
    localKey: `nutriops.forms.templates.${tenantId}`,
    tenantId,
    toRow: (t) => tmplToRow(t, tenantId),
    fromRow: tmplFromRow,
  });
}

export async function pushFormTemplate(tenantId, template) {
  const localKey = `nutriops.forms.templates.${tenantId}`;
  const existing = ls(localKey, []);
  const updated  = existing.find(t => t.id === template.id)
    ? existing.map(t => t.id === template.id ? template : t)
    : [...existing, template];
  lw(localKey, updated);
  if (!isSupabaseEnabled()) return;
  if (!navigator.onLine) { enqueue('form_templates', 'upsert', tmplToRow(template, tenantId)); return; }
  try {
    await sbFetch('form_templates', { method:'POST', body:tmplToRow(template, tenantId), prefer:'resolution=merge-duplicates,return=minimal' });
  } catch { enqueue('form_templates', 'upsert', tmplToRow(template, tenantId)); }
}

// ═══════════════════════════════════════════════════════════════════════════
// RECEIVING RECORDS
// ═══════════════════════════════════════════════════════════════════════════

function recvToRow(r) {
  return {
    id: r.id, tenant_id: r.tenantId, fornecedor: r.fornecedor, nf: r.nf, produto: r.produto,
    quantidade: r.quantidade, validade: r.validade, temperatura: r.temperatura,
    checks: r.checks, resultado: r.resultado, motivo_rejeicao: r.motivoRejeicao, obs: r.obs,
    user_name: r.user, role: r.role, created_at: r.createdAt,
  };
}
function recvFromRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id, fornecedor: row.fornecedor, nf: row.nf, produto: row.produto,
    quantidade: row.quantidade, validade: row.validade, temperatura: row.temperatura,
    checks: row.checks, resultado: row.resultado, motivoRejeicao: row.motivo_rejeicao, obs: row.obs,
    user: row.user_name, role: row.role, createdAt: row.created_at,
  };
}

export async function syncReceiving(tenantId) {
  return syncModule({ table:'receiving_records', localKey:`nutriops.receiving.${tenantId}`, tenantId, toRow:recvToRow, fromRow:recvFromRow });
}

export async function pushReceivingRecord(tenantId, record) {
  const localKey = `nutriops.receiving.${tenantId}`;
  const existing = ls(localKey, []);
  lw(localKey, [record, ...existing].slice(0, 300));
  if (!isSupabaseEnabled()) return;
  if (!navigator.onLine) { enqueue('receiving_records', 'insert', recvToRow(record)); return; }
  try {
    await sbFetch('receiving_records', { method:'POST', body:recvToRow(record), prefer:'return=minimal' });
  } catch { enqueue('receiving_records', 'insert', recvToRow(record)); }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTS & STOCK LOGS
// ═══════════════════════════════════════════════════════════════════════════

function productToRow(p) {
  return {
    id: p.id, tenant_id: p.tenantId ?? p.id, name: p.name, category: p.category,
    conservation: p.conservation, unit: p.unit, min_stock: p.minStock, current_stock: p.currentStock,
    expiry_date: p.expiryDate ?? null, supplier: p.supplier, lot: p.lot,
    days_after_open: p.daysAfterOpen ?? null, is_diamond: p.isDiamond ?? false,
    created_at: p.createdAt, updated_at: p.updatedAt ?? new Date().toISOString(),
  };
}
function productFromRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id, name: row.name, category: row.category,
    conservation: row.conservation, unit: row.unit, minStock: row.min_stock, currentStock: row.current_stock,
    expiryDate: row.expiry_date, supplier: row.supplier, lot: row.lot,
    daysAfterOpen: row.days_after_open, isDiamond: row.is_diamond,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function syncProducts(tenantId) {
  return syncModule({ table:'products', localKey:`nutriops.products.${tenantId}`, tenantId, toRow:productToRow, fromRow:productFromRow });
}

export async function pushProduct(tenantId, product) {
  const localKey = `nutriops.products.${tenantId}`;
  const existing = ls(localKey, []);
  const updated  = existing.find(p => p.id === product.id)
    ? existing.map(p => p.id === product.id ? product : p)
    : [...existing, product];
  lw(localKey, updated);
  if (!isSupabaseEnabled()) return;
  if (!navigator.onLine) { enqueue('products', 'upsert', productToRow({ ...product, tenantId })); return; }
  try {
    await sbFetch('products', { method:'POST', body:productToRow({ ...product, tenantId }), prefer:'resolution=merge-duplicates,return=minimal' });
  } catch { enqueue('products', 'upsert', productToRow({ ...product, tenantId })); }
}

function stockToRow(l, tenantId) {
  return {
    id: l.id, tenant_id: tenantId, product_id: l.productId,
    product_name: l.productName, type: l.type, qty: l.qty,
    note: l.note, user_name: l.user, created_at: l.createdAt,
  };
}

export async function pushStockLog(tenantId, log) {
  const localKey = `nutriops.stocklogs.${tenantId}`;
  const existing = ls(localKey, []);
  lw(localKey, [log, ...existing].slice(0, 500));
  if (!isSupabaseEnabled()) return;
  if (!navigator.onLine) { enqueue('stock_logs', 'insert', stockToRow(log, tenantId)); return; }
  try {
    await sbFetch('stock_logs', { method:'POST', body:stockToRow(log, tenantId), prefer:'return=minimal' });
  } catch { enqueue('stock_logs', 'insert', stockToRow(log, tenantId)); }
}

// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL CONTROLS (óleo, descongelamento, resfriamento, tratamento térmico)
// ═══════════════════════════════════════════════════════════════════════════

function controlToRow(type, record, tenantId) {
  return {
    id: record.id, tenant_id: tenantId, control_type: type,
    data: record, resultado: record.resultado, user_name: record.user,
    created_at: record.createdAt,
  };
}
function controlFromRow(row) {
  return { ...row.data, id: row.id, createdAt: row.created_at };
}

export async function pushSpecialControl(type, tenantId, record) {
  const localKey = `nutriops.${type}.${tenantId}`;
  const existing = ls(localKey, []);
  lw(localKey, [record, ...existing].slice(0, 200));
  if (!isSupabaseEnabled()) return;
  if (!navigator.onLine) { enqueue('special_controls', 'insert', controlToRow(type, record, tenantId)); return; }
  try {
    await sbFetch('special_controls', { method:'POST', body:controlToRow(type, record, tenantId), prefer:'return=minimal' });
  } catch { enqueue('special_controls', 'insert', controlToRow(type, record, tenantId)); }
}

export async function syncSpecialControls(type, tenantId) {
  const localKey = `nutriops.${type}.${tenantId}`;
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false };
  try {
    const rows = await sbFetch('special_controls', { filter:`tenant_id=eq.${tenantId}&control_type=eq.${type}&order=created_at.desc&limit=200` });
    const remote = rows.map(controlFromRow);
    const local  = ls(localKey, []);
    lw(localKey, mergeByKey([...local, ...remote], 'id').slice(0, 200));
    return { ok:true, count:remote.length };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL SYNC — sincroniza todos os módulos de um tenant
// ═══════════════════════════════════════════════════════════════════════════

export async function syncAllModules(tenantId) {
  if (!isSupabaseEnabled() || !navigator.onLine) {
    console.debug('[repo] syncAllModules skip — offline_or_disabled');
    return { ok:false, reason:'offline_or_disabled' };
  }
  console.info(`[repo] syncAllModules start — tenant=${tenantId}`);
  const t0 = Date.now();
  const results = await Promise.allSettled([
    syncFormRecords(tenantId),
    syncFormTemplates(tenantId),
    syncReceiving(tenantId),
    syncProducts(tenantId),
    syncSpecialControls('oil', tenantId),
    syncSpecialControls('thaw', tenantId),
    syncSpecialControls('cool', tenantId),
    syncSpecialControls('thermal', tenantId),
  ]);
  await supabaseRepository.syncQueue();
  setSyncStatus({ lastSync: new Date().toISOString(), pending: getOfflineQueue().length });
  const ok = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
  console.info(`[repo] syncAllModules done — ${ok}/${results.length} módulos ok em ${Date.now()-t0}ms`);
  return { ok: true, synced: ok, total: results.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// MIGRATE ALL — envia tudo do localStorage para o Supabase (uma vez)
// ═══════════════════════════════════════════════════════════════════════════

export async function migrateAllToSupabase(tenants) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false };
  let pushed = 0, failed = 0;

  for (const tenant of tenants) {
    const id = tenant.id;

    // Temperature
    const temps = ls('nutriops.temperature.records', []).filter(r => r.tenantId === id);
    for (const r of temps) {
      try { await sbFetch('temperature_records', { method:'POST', body:tempToRow(r), prefer:'resolution=merge-duplicates,return=minimal' }); pushed++; } catch { failed++; }
    }

    // Form records
    const forms = ls(`nutriops.forms.records.${id}`, []);
    for (const r of forms) {
      try { await sbFetch('form_records', { method:'POST', body:formToRow(r), prefer:'resolution=merge-duplicates,return=minimal' }); pushed++; } catch { failed++; }
    }

    // Receiving
    const recv = ls(`nutriops.receiving.${id}`, []);
    for (const r of recv) {
      try { await sbFetch('receiving_records', { method:'POST', body:recvToRow(r), prefer:'return=minimal' }); pushed++; } catch { failed++; }
    }

    // Products
    const prods = ls(`nutriops.products.${id}`, []);
    for (const p of prods) {
      try { await sbFetch('products', { method:'POST', body:productToRow({ ...p, tenantId:id }), prefer:'resolution=merge-duplicates,return=minimal' }); pushed++; } catch { failed++; }
    }

    // Special controls
    for (const type of ['oil','thaw','cool','thermal']) {
      const controls = ls(`nutriops.${type}.${id}`, []);
      for (const r of controls) {
        try { await sbFetch('special_controls', { method:'POST', body:controlToRow(type, r, id), prefer:'return=minimal' }); pushed++; } catch { failed++; }
      }
    }
  }

  setSyncStatus({ lastSync: new Date().toISOString(), pending: 0 });
  return { ok:true, pushed, failed };
}

// ─── SQL schema ────────────────────────────────────────────────────────────

export const SUPABASE_SQL = `-- NutriOPS · Schema completo v2.0
-- Execute no Supabase → SQL Editor → New query → Run

-- 1. Registros de temperatura
create table if not exists temperature_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null, tenant_name text,
  equipment_input text, equipment_key text, equipment_location text,
  measured_at text, value numeric not null, min_value numeric, max_value numeric,
  note text, user_name text, user_role text,
  control_mode text default 'routine', observation_interval integer,
  created_at timestamptz default now()
);
create index if not exists idx_temp_tenant  on temperature_records(tenant_id);
create index if not exists idx_temp_created on temperature_records(created_at desc);

-- 2. Planilhas BPF
create table if not exists form_records (
  id uuid primary key,
  tenant_id text not null, form_id text, form_title text,
  category text, frequency text, period_key text,
  responses jsonb, status text, validation jsonb,
  user_name text, role text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint form_records_pkey2 unique(tenant_id, form_id, period_key)
);
create index if not exists idx_forms_tenant on form_records(tenant_id);
create index if not exists idx_forms_period on form_records(period_key);

-- 2b. Templates de planilhas (customizações por tenant)
create table if not exists form_templates (
  id uuid primary key,
  tenant_id text not null,
  category text, frequency text,
  title text not null, description text,
  sections jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_tmpl_tenant on form_templates(tenant_id);

-- 3. Recebimento
create table if not exists receiving_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null, fornecedor text, nf text, produto text,
  quantidade text, validade text, temperatura text,
  checks jsonb, resultado text, motivo_rejeicao text, obs text,
  user_name text, role text, created_at timestamptz default now()
);
create index if not exists idx_recv_tenant on receiving_records(tenant_id);

-- 4. Produtos / Validades e Estoque
create table if not exists products (
  id uuid primary key,
  tenant_id text not null, name text not null, category text,
  conservation text, unit text, min_stock numeric, current_stock numeric,
  expiry_date date, supplier text, lot text, days_after_open integer,
  is_diamond boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_products_tenant on products(tenant_id);
create index if not exists idx_products_expiry on products(expiry_date);

-- 5. Movimentações de estoque
create table if not exists stock_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null, product_id uuid, product_name text,
  type text, qty numeric, note text, user_name text,
  created_at timestamptz default now()
);
create index if not exists idx_stocklogs_tenant on stock_logs(tenant_id);

-- 6. Controles especiais
create table if not exists special_controls (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null, control_type text not null,
  data jsonb not null, resultado text, user_name text,
  created_at timestamptz default now()
);
create index if not exists idx_special_tenant on special_controls(tenant_id);
create index if not exists idx_special_type   on special_controls(control_type);`;

// ═══════════════════════════════════════════════════════════════════════════
// USAGE TRACKING
// ═══════════════════════════════════════════════════════════════════════════

const USAGE_KEY = 'nutriops.usage.stats';

export function trackUsage(tenantId, action) {
  try {
    const stats = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}');
    const today = new Date().toISOString().slice(0, 10);
    if (!stats[tenantId]) stats[tenantId] = { actions: {}, lastSeen: null, totalDays: 0, firstSeen: today };
    if (!stats[tenantId].actions[today]) {
      stats[tenantId].actions[today] = {};
      stats[tenantId].totalDays = (stats[tenantId].totalDays || 0) + 1;
    }
    stats[tenantId].actions[today][action] = (stats[tenantId].actions[today][action] || 0) + 1;
    stats[tenantId].lastSeen = new Date().toISOString();
    localStorage.setItem(USAGE_KEY, JSON.stringify(stats));
  } catch { /* silent */ }
}

export function getUsageStats(tenantId) {
  try {
    const stats = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}');
    return stats[tenantId] ?? null;
  } catch { return null; }
}

export function getAllUsageStats() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}'); } catch { return {}; }
}
