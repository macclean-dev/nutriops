// ─── NutriOPS Repository v2.0 ──────────────────────────────────────────────
// localStorage como cache local + Supabase como fonte de verdade na nuvem.
// Cada módulo tem suas próprias funções de leitura/escrita.

// ─── Helpers ───────────────────────────────────────────────────────────────

const SUPABASE_KEY = 'nutriops.supabase.config';
const OFFLINE_Q_KEY = 'nutriops.offline.queue';
const SYNC_STATUS_KEY = 'nutriops.sync.status';

export const ls = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
export const lw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Device-auth (Fase 2 do épico RLS) — JWT escopado por tenant, usado no lugar
// da anon key crua quando disponível. Ver ./device-auth.js.
import { getDeviceAccessToken, invalidateDeviceToken } from './device-auth';

// ─── Supabase config ───────────────────────────────────────────────────────

export function getSupabaseConfig()         { return ls(SUPABASE_KEY, { url:'', anonKey:'', enabled:false }); }
export function saveSupabaseConfig(config)  { lw(SUPABASE_KEY, config); }
export function isSupabaseEnabled()         { const c = getSupabaseConfig(); return Boolean(c.enabled && c.url && c.anonKey); }

// Decide se o auto-config do tenant (data.js/onboarding) deve sobrescrever a
// config local de Supabase no login. Puro pra ser testável — a decisão roteia
// dados de produção, então tem que estar coberta.
// Regras:
//  - config setada à mão (source:'manual') é PROTEGIDA (projeto dedicado).
//  - aplica quando: sem config, desabilitada, ou URL/anonKey do tenant mudaram
//    (cobre rotação da anon key seed compartilhada).
export function shouldAutoConfigSupabase(existing, tenantSupabase) {
  if (!tenantSupabase?.url || !tenantSupabase?.anonKey) return { apply: false, reason: 'tenant sem supabase' };
  if (existing?.source === 'manual') return { apply: false, reason: 'config manual protegida' };
  const semConfig    = !existing;
  const desabilitado = !!existing && !existing.enabled;
  const urlMudou     = existing?.url     !== tenantSupabase.url;
  const keyMudou     = existing?.anonKey !== tenantSupabase.anonKey;
  if (semConfig || desabilitado || urlMudou || keyMudou) {
    const reason = semConfig ? 'sem config' : desabilitado ? 'estava desabilitado' : urlMudou ? 'URL mudou' : 'anon key rotacionou';
    return { apply: true, reason };
  }
  return { apply: false, reason: 'já configurado' };
}

// tenantId opcional: quando presente, tenta usar o JWT do device daquele
// tenant (Fase 2); sem tenantId, ou se o device-auth falhar por qualquer
// motivo, cai pra anon key — comportamento idêntico ao de antes da Fase 2.
async function sbHeaders(tenantId) {
  const { anonKey } = getSupabaseConfig();
  let token = anonKey;
  if (tenantId) {
    const deviceToken = await getDeviceAccessToken(tenantId);
    if (deviceToken) token = deviceToken;
  }
  return { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
function sbBase() { return `${getSupabaseConfig().url}/rest/v1`; }

// Flag persistente — quando anon key rotaciona, devices ficam com key
// inválida. Detectamos 401/403 e marcamos pra que pages.jsx mostre banner.
const AUTH_ERROR_KEY = 'nutriops.supabase.auth_error';
export function getSupabaseAuthError() {
  try { return JSON.parse(localStorage.getItem(AUTH_ERROR_KEY) ?? 'null'); } catch { return null; }
}
export function clearSupabaseAuthError() {
  try { localStorage.removeItem(AUTH_ERROR_KEY); } catch {}
}
function markSupabaseAuthError(status, table) {
  try {
    localStorage.setItem(AUTH_ERROR_KEY, JSON.stringify({
      status, table, at: new Date().toISOString(),
    }));
  } catch {}
}

// Generic Supabase REST call. tenantId (opcional) escolhe o JWT de device
// certo em sbHeaders — ver comentário lá.
async function sbFetch(table, params = {}, tenantId = null) {
  const { method='GET', filter='', body=null, prefer='' } = params;
  const url = `${sbBase()}/${table}${filter ? '?'+filter : ''}`;
  const headers = { ...(await sbHeaders(tenantId)) };
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    // 401/403 = anon key inválida ou RLS bloqueando. Marca pra UI mostrar banner.
    if (res.status === 401 || res.status === 403) {
      markSupabaseAuthError(res.status, table);
      // Se havia tenant, o JWT do device pode ter sido rejeitado (revogado/
      // rotacionado) — invalida o cache pra forçar novo login no próximo request,
      // em vez de repetir o mesmo token ruim até ele expirar (~1h).
      if (tenantId) invalidateDeviceToken(tenantId);
    }
    // Lê body pra incluir a mensagem do Postgres (invalid uuid, NOT NULL,
    // schema mismatch, etc) — crítico pra debug. Sem isso, status code
    // sozinho não diz qual coluna ou constraint falhou.
    let errBody = '';
    try { errBody = await res.text(); } catch {}
    if (errBody) console.warn(`[repo] ${method} ${table} ${res.status} body:`, errBody);
    throw new Error(`SB ${method} ${table}: ${res.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
  }
  // Sucesso → limpa flag se existia (key foi corrigida)
  if (getSupabaseAuthError()) clearSupabaseAuthError();
  if (method === 'DELETE') return true;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Offline queue ─────────────────────────────────────────────────────────

export function getOfflineQueue()   { return ls(OFFLINE_Q_KEY, []); }
export function clearOfflineQueue() { lw(OFFLINE_Q_KEY, []); }

// Cap pra não estourar localStorage em devices que nunca habilitam Supabase.
// 5000 é > 1 ano de uso normal (15 registros/dia × 365 ≈ 5500).
const OFFLINE_Q_CAP = 5000;

function enqueue(table, operation, payload) {
  const q = getOfflineQueue();
  const next = [...q, { table, operation, payload, _at: new Date().toISOString() }];
  if (next.length > OFFLINE_Q_CAP) {
    console.warn(`[repo] offline queue atingiu ${OFFLINE_Q_CAP} items — descartando os mais antigos`);
    next.splice(0, next.length - OFFLINE_Q_CAP);
  }
  lw(OFFLINE_Q_KEY, next);
}

// Helper: loga erro de push e enfileira pra retry. Sem o log, falhas viram
// invisíveis e o user nunca sabe que tem sync quebrado.
function logFailAndEnqueue(table, operation, payload, err) {
  console.warn(`[repo] push ${table} falhou (${err?.message ?? err}) — enfileirando pra retry`);
  enqueue(table, operation, payload);
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
    const rows = await sbFetch(table, { filter: q }, tenantId);
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

// Dedup por chave mantendo o item mais recente (updatedAt, senão createdAt).
// Núcleo da resolução de conflito local↔remoto no sync — bug aqui = perda de
// dado ou sobrescrita stale. Exportado pra ser testável.
export function mergeByKey(arr, key) {
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

// Cache-only write — não enfileira. Usado internamente pelo supabaseRepository
// quando o POST ao remoto já passou, pra evitar duplicação na queue.
function cacheTempLocal(record) {
  const current = ls(RECORDS_KEY, []);
  lw(RECORDS_KEY, [record, ...current].slice(0, 1000));
  return record;
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
    cacheTempLocal(record);
    // Enfileira mesmo sem Supabase habilitado — quando ativar depois, syncQueue
    // empurra tudo. Sem isso, temps gravadas em modo local somem da cloud.
    enqueue('temperature_records', 'upsert', tempToRow(record));
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
    const rows = await sbFetch('temperature_records', { filter }, tenantId);
    // Merge into local cache
    const local = ls(RECORDS_KEY, []);
    const merged = mergeByKey([...local, ...rows.map(tempFromRow)], 'id');
    lw(RECORDS_KEY, merged.slice(0, 1000));
    return rows.map(tempFromRow);
  },
  async create(input) {
    if (!navigator.onLine) {
      // Caminho offline: localRepository.create já salva local + enfileira
      const local = await localRepository.create(input);
      return { ...local, _pending: true };
    }
    try {
      const row = await sbFetch('temperature_records', {
        method: 'POST', body: tempToRow({ ...input, id: input.id ?? crypto.randomUUID() }),
        prefer: 'return=representation',
      }, input.tenantId);
      const record = tempFromRow(Array.isArray(row) ? row[0] : row);
      // POST funcionou — só cacheia local, NÃO enfileira (evita duplicação)
      cacheTempLocal(record);
      return record;
    } catch (e) {
      console.warn('[repo] supabaseRepository.create POST failed:', e?.message);
      // Falhou: salva local + enfileira pro retry
      const local = await localRepository.create(input);
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
        // tenant_id vem do próprio payload (já é a row snake_case) — a fila é
        // global, itens de tenants diferentes podem estar misturados nela.
        await sbFetch(table, { method:'POST', body:payload, prefer:'resolution=merge-duplicates,return=minimal' }, payload?.tenant_id);
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
      const res = await fetch(`${sbBase()}/temperature_records?limit=1`, { headers: await sbHeaders() });
      if (res.ok)                                    return { ok: true };
      if (res.status === 404)                        return { ok: false, reason: 'table_missing' };
      if (res.status === 401 || res.status === 403)  return { ok: false, reason: 'auth_error' };
      return { ok: false, reason: `http_${res.status}` };
    } catch { return { ok: false, reason: 'network_error' }; }
  },
  // Health-check de escrita: insere um registro fake e deleta. Detecta RLS
  // bloqueando insert mesmo com GET funcionando. Bug observado na Swiss:
  // form_records sincronizava (RLS off) mas temperature_records não (RLS on
  // ou outro motivo) — falha silenciosa porque catch só enfileirava.
  async testWrite() {
    // ID precisa ser UUID válido (coluna é tipo uuid). Sem prefix.
    // Identificamos como healthcheck via tenant_id='__healthcheck__' pra delete.
    const fakeId = crypto.randomUUID();
    try {
      // INSERT
      const insertRes = await fetch(`${sbBase()}/temperature_records`, {
        method: 'POST',
        headers: { ...(await sbHeaders()), Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: fakeId,
          tenant_id: '__healthcheck__',
          tenant_name: '__healthcheck__',
          equipment_input: 'healthcheck',
          equipment_key: 'healthcheck',
          measured_at: new Date().toISOString(),
          value: 0, min_value: 0, max_value: 0,
          user_name: 'system', user_role: 'healthcheck',
          control_mode: 'healthcheck',
          created_at: new Date().toISOString(),
        }),
      });
      if (!insertRes.ok) {
        const body = await insertRes.text().catch(() => '');
        if (insertRes.status === 401 || insertRes.status === 403) {
          markSupabaseAuthError(insertRes.status, 'temperature_records (write)');
          return { ok: false, reason: 'auth_error', status: insertRes.status, body };
        }
        if (insertRes.status === 404) return { ok: false, reason: 'table_missing', body };
        if (body.includes('row-level security') || body.includes('42501')) {
          markSupabaseAuthError(insertRes.status, 'temperature_records (RLS)');
          return { ok: false, reason: 'rls_blocked', status: insertRes.status, body };
        }
        return { ok: false, reason: `http_${insertRes.status}`, status: insertRes.status, body };
      }
      // DELETE por tenant_id — limpa o registro fake E qualquer stray de
      // healthchecks anteriores cujo DELETE falhou (ex.: rede caiu no meio).
      await fetch(`${sbBase()}/temperature_records?tenant_id=eq.__healthcheck__`, {
        method: 'DELETE', headers: await sbHeaders(),
      });
      // Escrita OK → limpa flag de auth error se existia (key foi corrigida).
      // testWrite usa fetch cru, então não passa pelo clear do sbFetch.
      if (getSupabaseAuthError()) clearSupabaseAuthError();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'network_error', error: e?.message };
    }
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
  // Enfileira mesmo com Supabase off — quando o user habilitar depois,
  // syncQueue() empurra tudo. Evita perda silenciosa.
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('form_records', 'upsert', formToRow(record));
    return;
  }
  try {
    await sbFetch('form_records', { method:'POST', body:formToRow(record), prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('form_records', 'upsert', formToRow(record), e); }
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
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('form_templates', 'upsert', tmplToRow(template, tenantId));
    return;
  }
  try {
    await sbFetch('form_templates', { method:'POST', body:tmplToRow(template, tenantId), prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('form_templates', 'upsert', tmplToRow(template, tenantId), e); }
}

// ═══════════════════════════════════════════════════════════════════════════
// EQUIPMENT CATALOG (por tenant — label/aliases/location/min/max)
// ═══════════════════════════════════════════════════════════════════════════

function eqToRow(eq, tenantId) {
  return {
    tenant_id: tenantId,
    label: eq.label,
    aliases: Array.isArray(eq.aliases) ? eq.aliases : [],
    location: eq.location ?? null,
    min_temp: eq.minTemp ?? null,
    max_temp: eq.maxTemp ?? null,
    updated_at: new Date().toISOString(),
  };
}
function eqFromRow(row) {
  return {
    label: row.label,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    location: row.location,
    minTemp: row.min_temp,
    maxTemp: row.max_temp,
  };
}

const EQ_KEY = (tenantId) => `nutriops.equip_assets.${tenantId}`;

export async function syncEquipmentCatalog(tenantId) {
  if (!isSupabaseEnabled() || !navigator.onLine) {
    console.debug('[repo] syncEquipmentCatalog skip — offline_or_disabled');
    return { ok: false, reason: 'offline_or_disabled' };
  }
  console.debug(`[repo] syncEquipmentCatalog(tenant=${tenantId}) start`);
  try {
    const q = `tenant_id=eq.${tenantId}&order=label.asc&limit=500`;
    const rows = await sbFetch('equipment_catalog', { filter: q }, tenantId);
    const remote = rows.map(eqFromRow);
    // Estratégia: cloud é a fonte de verdade. Substitui o local.
    // (Cadastro de equipamento é raro o suficiente pra não termos conflitos.)
    if (remote.length > 0) {
      lw(EQ_KEY(tenantId), remote);
    }
    console.debug(`[repo] syncEquipmentCatalog done — ${remote.length} itens`);
    return { ok: true, count: remote.length };
  } catch (e) {
    console.warn(`[repo] syncEquipmentCatalog failed:`, e.message);
    return { ok: false, reason: e.message };
  }
}

export async function pushEquipmentItem(tenantId, equipment) {
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('equipment_catalog', 'upsert', eqToRow(equipment, tenantId));
    return;
  }
  try {
    await sbFetch('equipment_catalog', {
      method: 'POST',
      body: eqToRow(equipment, tenantId),
      prefer: 'resolution=merge-duplicates,return=minimal',
    }, tenantId);
  } catch (e) { logFailAndEnqueue('equipment_catalog', 'upsert', eqToRow(equipment, tenantId), e); }
}

export async function pushAllEquipment(tenantId, catalog) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok: false };
  let pushed = 0, failed = 0;
  for (const eq of (catalog || [])) {
    try { await pushEquipmentItem(tenantId, eq); pushed++; }
    catch { failed++; }
  }
  return { ok: true, pushed, failed };
}

export async function deleteEquipmentItem(tenantId, label) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok: false };
  try {
    await sbFetch('equipment_catalog', {
      method: 'DELETE',
      filter: `tenant_id=eq.${tenantId}&label=eq.${encodeURIComponent(label)}`,
    }, tenantId);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
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
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('receiving_records', 'insert', recvToRow(record));
    return;
  }
  try {
    await sbFetch('receiving_records', { method:'POST', body:recvToRow(record), prefer:'return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('receiving_records', 'insert', recvToRow(record), e); }
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
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('products', 'upsert', productToRow({ ...product, tenantId }));
    return;
  }
  try {
    await sbFetch('products', { method:'POST', body:productToRow({ ...product, tenantId }), prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('products', 'upsert', productToRow({ ...product, tenantId }), e); }
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
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('stock_logs', 'insert', stockToRow(log, tenantId));
    return;
  }
  try {
    await sbFetch('stock_logs', { method:'POST', body:stockToRow(log, tenantId), prefer:'return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('stock_logs', 'insert', stockToRow(log, tenantId), e); }
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
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('special_controls', 'insert', controlToRow(type, record, tenantId));
    return;
  }
  try {
    await sbFetch('special_controls', { method:'POST', body:controlToRow(type, record, tenantId), prefer:'return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('special_controls', 'insert', controlToRow(type, record, tenantId), e); }
}

export async function syncSpecialControls(type, tenantId) {
  const localKey = `nutriops.${type}.${tenantId}`;
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false };
  try {
    const rows = await sbFetch('special_controls', { filter:`tenant_id=eq.${tenantId}&control_type=eq.${type}&order=created_at.desc&limit=200` }, tenantId);
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
    syncEquipmentCatalog(tenantId),
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
      try { await sbFetch('temperature_records', { method:'POST', body:tempToRow(r), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Form records
    const forms = ls(`nutriops.forms.records.${id}`, []);
    for (const r of forms) {
      try { await sbFetch('form_records', { method:'POST', body:formToRow(r), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Receiving
    const recv = ls(`nutriops.receiving.${id}`, []);
    for (const r of recv) {
      try { await sbFetch('receiving_records', { method:'POST', body:recvToRow(r), prefer:'return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Products
    const prods = ls(`nutriops.products.${id}`, []);
    for (const p of prods) {
      try { await sbFetch('products', { method:'POST', body:productToRow({ ...p, tenantId:id }), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Special controls
    for (const type of ['oil','thaw','cool','thermal']) {
      const controls = ls(`nutriops.${type}.${id}`, []);
      for (const r of controls) {
        try { await sbFetch('special_controls', { method:'POST', body:controlToRow(type, r, id), prefer:'return=minimal' }, id); pushed++; } catch { failed++; }
      }
    }
  }

  setSyncStatus({ lastSync: new Date().toISOString(), pending: 0 });
  return { ok:true, pushed, failed };
}

// ─── Auto-backfill (auto-cura sem admin) ────────────────────────────────────
// Conta registros locais de TODOS os módulos pra saber se há backlog antigo
// (registros salvos antes do mecanismo de fila) que precisa subir.
export function countAllLocalRecords(tenants) {
  let n = 0;
  try {
    n += ls('nutriops.temperature.records', []).length;
    for (const t of tenants ?? []) {
      n += ls(`nutriops.forms.records.${t.id}`, []).length;
      n += ls(`nutriops.receiving.${t.id}`, []).length;
      n += ls(`nutriops.products.${t.id}`, []).length;
      for (const type of ['oil','thaw','cool','thermal']) {
        n += ls(`nutriops.${type}.${t.id}`, []).length;
      }
    }
  } catch {}
  return n;
}

// Decide se o backfill automático deve rodar no boot. Roda 1x por device:
// precisa de Supabase ligado, online, ainda não feito, e haver dado local.
// Pura e testável — a orquestração (chamar migrate + marcar done) fica em pages.jsx.
export function shouldAutoBackfill({ enabled, online, alreadyDone, localCount }) {
  return Boolean(enabled && online && !alreadyDone && localCount > 0);
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

-- 2c. Catálogo de equipamentos por tenant (nome, faixa, localização)
create table if not exists equipment_catalog (
  tenant_id text not null,
  label text not null,
  aliases jsonb,
  location text,
  min_temp numeric,
  max_temp numeric,
  updated_at timestamptz default now(),
  primary key (tenant_id, label)
);
create index if not exists idx_eq_tenant on equipment_catalog(tenant_id);

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
create index if not exists idx_special_type   on special_controls(control_type);

-- 7. RLS desabilitada — auth é PIN local hoje, anon key tem acesso total.
-- As policies abaixo (seção 8) já existem mas NÃO fazem efeito enquanto RLS
-- estiver off — Postgres só aplica policy em tabela com RLS habilitada.
-- Sem isso, devices em prod falham silenciosamente em pushes (bug Swiss).
alter table temperature_records disable row level security;
alter table form_records         disable row level security;
alter table form_templates       disable row level security;
alter table equipment_catalog    disable row level security;
alter table receiving_records    disable row level security;
alter table products             disable row level security;
alter table stock_logs           disable row level security;
alter table special_controls     disable row level security;

-- 7b. Tabela 'tenants' (espelho do /admin). ATENÇÃO: o acesso anon a ela foi
-- migrado pra funções RPC security-definer + RLS deny-all — ver
-- docs/security-tenants-lockdown.sql (fecha o alerta do Advisor de access_token/
-- setup_pin_hash expostos). NÃO deixar mais RLS off aqui: o disable abaixo é
-- legado; a fonte de verdade agora é o arquivo de lockdown.
-- alter table tenants disable row level security;  -- (revogado pelo lockdown)

-- 8. Policies RLS por tenant — PREPARADAS mas SEM EFEITO (RLS off acima).
-- Fase 0 do épico Auth+RLS (docs/AUTH_RLS_PLAN.md): escreve e testa as
-- policies com segurança, sem arriscar os 3 clientes em produção. A troca
-- pra valer só acontece na Fase 3, quando TODOS os tenants já tiverem
-- device-token funcionando (troca o 'disable' acima pra 'enable').
--
-- Assume tenant_id no JWT em user_metadata (contas device por tenant, ou
-- o admin global com role Administrador/Super-admin vendo tudo).
-- drop policy if exists = idempotente, pode rodar este script de novo à vontade.

drop policy if exists tenant_isolation on temperature_records;
create policy tenant_isolation on temperature_records for all
  using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'))
  with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'));

drop policy if exists tenant_isolation on form_records;
create policy tenant_isolation on form_records for all
  using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'))
  with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'));

drop policy if exists tenant_isolation on form_templates;
create policy tenant_isolation on form_templates for all
  using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'))
  with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'));

drop policy if exists tenant_isolation on equipment_catalog;
create policy tenant_isolation on equipment_catalog for all
  using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'))
  with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'));

drop policy if exists tenant_isolation on receiving_records;
create policy tenant_isolation on receiving_records for all
  using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'))
  with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'));

drop policy if exists tenant_isolation on products;
create policy tenant_isolation on products for all
  using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'))
  with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'));

drop policy if exists tenant_isolation on stock_logs;
create policy tenant_isolation on stock_logs for all
  using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'))
  with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'));

drop policy if exists tenant_isolation on special_controls;
create policy tenant_isolation on special_controls for all
  using (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'))
  with check (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id') or (auth.jwt() -> 'user_metadata' ->> 'role') in ('Administrador','Super-admin'));`;

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
