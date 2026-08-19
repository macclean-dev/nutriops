// ─── NutriOPS Repository v2.0 ──────────────────────────────────────────────
// localStorage como cache local + Supabase como fonte de verdade na nuvem.
// Cada módulo tem suas próprias funções de leitura/escrita.

import { writeOpenRules, readRulesUpdatedAt } from './validity-rules';

// ─── Helpers ───────────────────────────────────────────────────────────────

const SUPABASE_KEY = 'nutriops.supabase.config';
const OFFLINE_Q_KEY = 'nutriops.offline.queue';
const SYNC_STATUS_KEY = 'nutriops.sync.status';

export const ls = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
// Toda gravação local do app passa por aqui (30 pontos). O `catch {}` vazio
// engolia QUALQUER falha — e a falha real é localStorage cheio: a partir do
// momento em que enche, nada mais é salvo e cada tela segue confirmando
// sucesso. Não dá pra fazer `lw` lançar (os 30 chamadores não tratam), então:
// devolve booleano pra quem quiser checar, loga, e levanta uma bandeira
// persistente que o app mostra num banner. Achado nº15 da auditoria (18/08).
export const STORAGE_FULL_KEY = 'nutriops.storage.full';
export const lw = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch (e) {
    console.error(`[repo] FALHA ao gravar ${k} — armazenamento cheio?`, e?.name, e?.message);
    try {
      localStorage.setItem(STORAGE_FULL_KEY, JSON.stringify({ chave: k, at: new Date().toISOString() }));
    } catch {}   // se nem isto cabe, o console é o que sobra
    return false;
  }
};
export function getStorageFull() {
  try { return JSON.parse(localStorage.getItem(STORAGE_FULL_KEY) ?? 'null'); } catch { return null; }
}
export function clearStorageFull() {
  try { localStorage.removeItem(STORAGE_FULL_KEY); } catch {}
}

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

// JWT do usuário logado, quando ele tem direito a ESTE tenant. É o que o RLS
// libera — via is_member pro membro, via is_admin_plataforma pro dono.
//
// Antes existia um 2º caminho aqui: o device-token, criado porque o login por
// PIN não gerava sessão Supabase. Com o PIN aposentado (v1.9.97) toda sessão é
// Supabase, então este é o único caminho — e some a senha pública do bundle.
async function memberTokenFor(tenantId) {
  if (!tenantId) return null;
  try {
    const s = ls('nutriops.session', null);
    if (!s) return null;
    // Admin da plataforma alcança qualquer loja. Vem de isPlatformAdmin, que
    // buildSession preenche a partir do app_metadata.role — nunca do
    // user_metadata, que o próprio usuário edita via updateUser.
    const cobre = s.isPlatformAdmin === true
      || s.tenantId === tenantId
      || (Array.isArray(s.memberTenants) && s.memberTenants.some(m => m.id === tenantId));
    if (!cobre) return null;
    const { getValidAccessToken } = await import('./auth');
    return await getValidAccessToken();
  } catch { return null; }
}

// Ordem de credencial pra REST sob RLS:
//   1. JWT do usuário logado (membro da loja ou admin da plataforma)
//   2. anon key (sob RLS só alcança __healthcheck__)
async function sbHeaders(tenantId) {
  const { anonKey } = getSupabaseConfig();
  let token = anonKey;
  let comJwt = false;
  if (tenantId) {
    const jwt = await memberTokenFor(tenantId);
    if (jwt) { token = jwt; comJwt = true; }
  }
  // `_comJwt` não vai na requisição — sbFetch tira antes de enviar. Serve pra
  // o 401 saber DE QUEM ele é: com JWT é sessão expirando (transitório), com
  // anon key é chave podre mesmo. Sem isso o banner acusava "chave inválida"
  // numa chave perfeita e mandava o dono rotacionar à toa (15/08).
  return { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', _comJwt: comJwt };
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
// `kind` separa os 401 que a UI tratava como um só:
//   'rls'     → o corpo trouxe 42501/row-level security: credencial VÁLIDA,
//               sem permissão pra essa loja. Nunca é problema de chave, e
//               dizer que é manda o suporte trocar uma chave perfeita.
//   'anon'    → a requisição foi com a anon key: chave inválida/rotacionada,
//               ou usuário sem vínculo com a loja. É o caso que pede ação.
//   'session' → foi com o JWT do usuário: sessão expirando. Se cura sozinho
//               no próximo refresh, e alarmar aqui é falso positivo.
// `falhas` conta quantas seguidas — o banner de sessão só aparece se
// insistir, pra um soluço de rede não pintar a tela de vermelho.
function markSupabaseAuthError(status, table, kind = 'anon') {
  try {
    const anterior = getSupabaseAuthError();
    const seguidas = anterior?.kind === kind ? (anterior.falhas ?? 1) + 1 : 1;
    localStorage.setItem(AUTH_ERROR_KEY, JSON.stringify({
      status, table, kind, falhas: seguidas, at: new Date().toISOString(),
    }));
  } catch {}
}

// Generic Supabase REST call. tenantId (opcional) escolhe o JWT de device
// certo em sbHeaders — ver comentário lá.
async function sbFetch(table, params = {}, tenantId = null) {
  const { method='GET', filter='', body=null, prefer='' } = params;
  const url = `${sbBase()}/${table}${filter ? '?'+filter : ''}`;
  const headers = { ...(await sbHeaders(tenantId)) };
  const comJwt = headers._comJwt === true;
  delete headers._comJwt;              // marcador interno, não vai pro servidor
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    // 401/403 = credencial rejeitada ou RLS bloqueando. Marca pra UI mostrar
    // banner — mas dizendo QUAL credencial falhou (ver markSupabaseAuthError).
    // Não há mais cache de token pra invalidar aqui: o JWT vem da sessão do
    // usuário, e refreshSession já cuida de renovar/limpar quando o servidor
    // rejeita (ver src/auth.jsx).
    // Lê body pra incluir a mensagem do Postgres (invalid uuid, NOT NULL,
    // schema mismatch, etc) — crítico pra debug. Sem isso, status code
    // sozinho não diz qual coluna ou constraint falhou.
    let errBody = '';
    try { errBody = await res.text(); } catch {}
    if (errBody) console.warn(`[repo] ${method} ${table} ${res.status} body:`, errBody);
    // A classificação vem DEPOIS de ler o body, senão ela nunca enxerga o
    // 42501: o Postgres devolve negação de RLS como 401, e classificar por
    // status sozinho transforma "sem permissão" em "chave inválida" — a
    // mensagem errada que custou a investigação de 16/08.
    if (res.status === 401 || res.status === 403) {
      const ehRls = errBody.includes('row-level security') || errBody.includes('42501');
      markSupabaseAuthError(res.status, table, ehRls ? 'rls' : comJwt ? 'session' : 'anon');
    }
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

// Remove da fila o que NUNCA vai conseguir subir. Hoje só um caso, real e
// medido (CASA DOCE, 17/08): o quiosque aceitava '-' ou '.' sozinho como
// temperatura, gravava NaN, o JSON virava `value: null` e o Postgres recusava
// com 23502 (value numeric not null) — em toda tentativa, pra sempre. O item
// ficava girando na fila, empurrando o cap de 5000 e escondendo falha real
// atrás de um contador de pendências que nunca zerava.
//
// A guarda do quiosque (kiosk.jsx) impede novos; isto limpa os que já existem.
// Só descarta o que é comprovadamente insalvável: temperatura sem valor
// numérico. Nada de heurística — na dúvida, o item FICA.
export function purgarFilaEnvenenada(queue) {
  const limpa = (queue ?? []).filter((item) => {
    if (item?.table !== 'temperature_records') return true;
    const v = item?.payload?.value;
    return v !== null && v !== undefined && Number.isFinite(Number(v));
  });
  if (limpa.length !== (queue ?? []).length) {
    console.warn(`[repo] fila: descartados ${(queue ?? []).length - limpa.length} registro(s) de temperatura sem valor numérico — nunca subiriam (ver purgarFilaEnvenenada)`);
    lw(OFFLINE_Q_KEY, limpa);
  }
  return limpa;
}

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
// Teto do cache local. É GLOBAL (todas as lojas dividem), então precisa caber
// o dia inteiro das 4 somadas com folga: a CASA DOCE sozinha faz ~60/dia em 46
// equipamentos. 1000 era apertado demais e cortava leitura do dia (ver o
// comentário em supabaseRepository.list). localStorage aguenta ~5MB; um
// registro de temperatura tem ~300 bytes, então 5000 fica em ~1,5MB.
const MAX_CACHE_RECORDS = 5000;

// Filtra a lista já mesclada pelo escopo pedido. Existe pra separar duas coisas
// que estavam grudadas: o TETO DO CACHE (quanto o aparelho guarda) e o QUE A
// TELA RECEBE. Devolver a partir do cache capado fazia o teto virar limite de
// exibição — com "Todos", uma loja com mais registros que o teto passaria a
// mostrar menos do que mostra em "90 dias".
function filtrarEscopo(lista, tenantId, days) {
  const cutoff = days > 0 ? Date.now() - days * 86400000 : null;
  return lista.filter((r) => {
    if (tenantId && r.tenantId !== tenantId) return false;
    if (cutoff != null && new Date(r.createdAt).getTime() < cutoff) return false;
    return true;
  });
}

function tempToRow(input) {
  return {
    id: input.id,
    tenant_id: input.tenantId, tenant_name: input.tenantName,
    equipment_input: input.equipmentInput, equipment_key: input.equipmentKey ?? input.equipment,
    equipment_location: input.equipmentLocation ?? null, measured_at: input.measuredAt,
    value: input.value, min_value: input.min, max_value: input.max,
    note: input.note ?? null, user_name: input.user, user_role: input.role,
    control_mode: input.controlMode ?? 'routine', observation_interval: input.observationInterval ?? null,
    original_value: input.originalValue ?? null, correction_reason: input.correctionReason ?? null,
    corrected_by: input.correctedBy ?? null, corrected_at: input.correctedAt ?? null,
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
    originalValue: row.original_value, correctionReason: row.correction_reason,
    correctedBy: row.corrected_by, correctedAt: row.corrected_at,
  };
}

// Row parcial só com os campos de correção — NUNCA reusar tempToRow aqui:
// ele preenche colunas ausentes com `?? null`, o que apagaria o resto do
// registro num PATCH/upsert parcial.
function correctionToRow(id, tenantId, patch) {
  return {
    id, tenant_id: tenantId,
    value: patch.value,
    original_value: patch.originalValue,
    correction_reason: patch.correctionReason,
    corrected_by: patch.correctedBy,
    corrected_at: patch.correctedAt,
  };
}

// Cache-only write — não enfileira. Usado internamente pelo supabaseRepository
// quando o POST ao remoto já passou, pra evitar duplicação na queue.
function cacheTempLocal(record) {
  const current = ls(RECORDS_KEY, []);
  lw(RECORDS_KEY, [record, ...current].slice(0, MAX_CACHE_RECORDS));
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
  // Correção com trilha de auditoria — nunca sobrescreve sem rastro. `patch`
  // já traz originalValue calculado pelo caller (preserva o 1º valor mesmo
  // que o registro seja corrigido mais de uma vez).
  async update(id, tenantId, patch) {
    const records = ls(RECORDS_KEY, []);
    const idx = records.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    records[idx] = { ...records[idx], ...patch };
    lw(RECORDS_KEY, records);
    enqueue('temperature_records', 'upsert', correctionToRow(id, tenantId, patch));
    return records[idx];
  },
};

export const supabaseRepository = {
  async list({ tenantId, days = 90 } = {}) {
    if (days > 0) {
      const from   = new Date(Date.now() - days * 86400000).toISOString();
      const filter = [
        tenantId ? `tenant_id=eq.${tenantId}` : null,
        `created_at=gte.${from}`,
        'order=created_at.desc', 'limit=1000',
      ].filter(Boolean).join('&');
      // ⚠️ A NUVEM PODE FALHAR — e falhar NÃO pode apagar a tela.
      // Sem este catch, um 401/timeout fazia `list()` estourar, o Promise.all
      // do refreshRecords (pages.jsx) rejeitar e `setRecords` NUNCA ser
      // chamado: a tela ficava com ZERO leituras. Foi o mecanismo que
      // transformou a negação de RLS de 16/08 em "todos os registros da CASA
      // DOCE foram zerados" — os 108 estavam intactos no banco e no cache
      // local, e a tela mostrava vazio. O cache é a rede de segurança: se a
      // nuvem não responde, mostramos o que o aparelho tem.
      let rows;
      try {
        rows = await sbFetch('temperature_records', { filter }, tenantId);
      } catch (e) {
        console.warn(`[repo] list(temperature_records) falhou (${e?.message}) — exibindo o cache local`);
        return localRepository.list({ tenantId, days });
      }
      const local = ls(RECORDS_KEY, []);
      const merged = mergeByKey([...local, ...rows.map(tempFromRow)], 'id');
      // ⚠️ ORDENAR ANTES DE CORTAR. `mergeByKey` devolve na ordem de inserção
      // (local primeiro, remoto anexado no fim) e o cache é GLOBAL — as 4 lojas
      // dividem as mesmas vagas. Cortando na ordem crua, assim que o cache
      // enchia, TODA leitura nova vinda da nuvem caía fora: entrava no fim da
      // lista e o slice a descartava, para sempre.
      //
      // Sintoma em produção (CASA DOCE, 18/08): "cobertura 4% — 6 de 138", com
      // a equipe registrando normalmente. As 6 que sobreviviam eram as criadas
      // NESTE aparelho — cacheTempLocal faz [record, ...current], que PREPENDA.
      // As dos outros aparelhos chegavam pela nuvem e evaporavam. Também
      // explica contagens diferentes por aparelho (uma pessoa via 3, outra 6):
      // cada cache sobreviveu a um corte diferente.
      const porData = merged.sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
      lw(RECORDS_KEY, porData.slice(0, MAX_CACHE_RECORDS));   // cache: capado
      return filtrarEscopo(porData, tenantId, days);          // tela: completo
      // ⚠️ Devolve o MERGE, não só `rows` (CASA DOCE, 17/08). Antes gravava uma
      // coisa e retornava outra: o registro que falhou no POST ficava salvo no
      // cache E na fila offline, mas a tela — que monta `records` puramente
      // deste retorno (pages.jsx refreshRecords) — nunca o via. A leitura
      // "sumia", o equipamento voltava a aparecer como pendente, e a conclusão
      // natural era "não registrou". Só reaparecia depois de sair e entrar,
      // quando a fila subia e o registro passava a existir na nuvem.
      // `filtrarEscopo` reaplica tenant/dias — o cache é GLOBAL (todas as
      // lojas, sem corte de data), então devolver `merged` cru vazaria
      // registro de outra loja pra dentro da tela.
    }
    // days<=0 = "Todos" (item 14). Sem o filtro de data o servidor ainda
    // limitava a 1000 linhas — um tenant com mais de 1000 registros no total
    // continuava mentindo em "Todos", só que por CONTAGEM em vez de por
    // data. Pagina por offset até uma página vir incompleta (<1000, sinal
    // padrão do REST de "acabou" — não precisa de Content-Range/count).
    // MAX_PAGES é só um limite de segurança contra paginação infinita, bem
    // acima de qualquer tenant real hoje (Swiss: ~630 registros/90d).
    const MAX_PAGES = 20;
    let allRows = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const filter = [
        tenantId ? `tenant_id=eq.${tenantId}` : null,
        'order=created_at.desc', 'limit=1000', `offset=${page * 1000}`,
      ].filter(Boolean).join('&');
      let rows;
      try {
        rows = await sbFetch('temperature_records', { filter }, tenantId);
      } catch (e) {
        console.warn(`[repo] list("Todos") falhou (${e?.message}) — exibindo o cache local`);
        return localRepository.list({ tenantId, days });
      }
      allRows = allRows.concat(rows);
      if (rows.length < 1000) break;
    }
    const local = ls(RECORDS_KEY, []);
    const merged = mergeByKey([...local, ...allRows.map(tempFromRow)], 'id');
    // MESMO conserto do ramo de cima (v1.9.151) — que eu apliquei lá e esqueci
    // aqui. Dois defeitos neste `slice`, achados pela auditoria de 18/08:
    //
    // 1. Cortava na ordem de inserção. mergeByKey devolve local-primeiro e o
    //    remoto anexado no fim, então o que veio da nuvem era o primeiro a cair.
    // 2. O teto saía de `allRows.length` — o volume de UMA loja — mas o cache é
    //    GLOBAL. Abrir "Todos" na CASA DOCE (700 registros) cortava o cache
    //    inteiro em 1000 e decapitava Swiss, Bäckerei e DBK, que não têm nada a
    //    ver com o filtro que a pessoa escolheu.
    const porData = merged.sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    lw(RECORDS_KEY, porData.slice(0, MAX_CACHE_RECORDS));   // cache: capado
    return filtrarEscopo(porData, tenantId, days);          // tela: completo
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
  async update(id, tenantId, patch) {
    const applyLocal = (fields) => {
      const records = ls(RECORDS_KEY, []);
      const idx = records.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      records[idx] = { ...records[idx], ...fields };
      lw(RECORDS_KEY, records);
      return records[idx];
    };
    if (!navigator.onLine) {
      enqueue('temperature_records', 'upsert', correctionToRow(id, tenantId, patch));
      return { ...applyLocal(patch), _pending: true };
    }
    try {
      const row = await sbFetch('temperature_records', {
        method: 'PATCH', filter: `id=eq.${id}`,
        body: correctionToRow(id, tenantId, patch),
        prefer: 'return=representation',
      }, tenantId);
      const record = tempFromRow(Array.isArray(row) ? row[0] : row);
      applyLocal(record);
      return record;
    } catch (e) {
      console.warn('[repo] supabaseRepository.update PATCH failed:', e?.message);
      enqueue('temperature_records', 'upsert', correctionToRow(id, tenantId, patch));
      return { ...applyLocal(patch), _pending: true };
    }
  },
  async syncQueue() {
    const queue = purgarFilaEnvenenada(getOfflineQueue());
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
    // `_comJwt` é marcador interno do sbHeaders — precisa sair antes de virar
    // header HTTP, e é ele que diz QUAL credencial foi usada. Sem ler isso, as
    // marcações abaixo caíam todas no default 'anon' e a tela acusava "chave
    // inválida" mesmo com chave boa e sessão válida (incidente de 16/08).
    const hcHeaders = { ...(await sbHeaders()) };
    const hcComJwt = hcHeaders._comJwt === true;
    delete hcHeaders._comJwt;
    try {
      // INSERT
      const insertRes = await fetch(`${sbBase()}/temperature_records`, {
        method: 'POST',
        headers: { ...hcHeaders, Prefer: 'return=minimal' },
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
        // RLS vem ANTES do 401 genérico: o Postgres devolve 401 com 42501 pra
        // negação de permissão, e tratar isso como "credencial ruim" é o que
        // manda o suporte trocar uma chave que está perfeita.
        if (body.includes('row-level security') || body.includes('42501')) {
          markSupabaseAuthError(insertRes.status, 'temperature_records (RLS)', 'rls');
          return { ok: false, reason: 'rls_blocked', status: insertRes.status, body };
        }
        if (insertRes.status === 401 || insertRes.status === 403) {
          markSupabaseAuthError(insertRes.status, 'temperature_records (write)', hcComJwt ? 'session' : 'anon');
          return { ok: false, reason: 'auth_error', status: insertRes.status, body };
        }
        if (insertRes.status === 404) return { ok: false, reason: 'table_missing', body };
        return { ok: false, reason: `http_${insertRes.status}`, status: insertRes.status, body };
      }
      // DELETE por tenant_id — limpa o registro fake E qualquer stray de
      // healthchecks anteriores cujo DELETE falhou (ex.: rede caiu no meio).
      await fetch(`${sbBase()}/temperature_records?tenant_id=eq.__healthcheck__`, {
        method: 'DELETE', headers: hcHeaders,
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
    // `on_conflict` é obrigatório aqui: form_records tem DUAS chaves únicas —
    // `id` (primária) e `unique(tenant_id, form_id, period_key)`. Sem apontar a
    // segunda, o merge-duplicates só resolve pela primária, e dois aparelhos
    // preenchendo a MESMA planilha no MESMO período geram uuids diferentes:
    // não colidem na primária, colidem na composta, e o POST toma 409 (23505)
    // em toda tentativa — a planilha do segundo aparelho fica presa na fila
    // pra sempre. Achado da auditoria de 18/08 (nº 4/18/22, três lentes
    // diferentes chegaram nele).
    //
    // Com o alvo certo o segundo vira UPDATE da linha existente. É "o último a
    // salvar vence" — mesma regra do resto do app. Não é ideal (o certo seria
    // fundir as respostas), mas perde menos que o 409 eterno, onde o segundo
    // preenchimento simplesmente nunca chegava.
    await sbFetch('form_records', {
      method:'POST', body:formToRow(record),
      filter:'on_conflict=tenant_id,form_id,period_key',
      prefer:'resolution=merge-duplicates,return=minimal',
    }, tenantId);
  } catch (e) { logFailAndEnqueue('form_records', 'upsert', formToRow(record), e); }
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM TEMPLATES (customizações por tenant — Vitrine Confeitaria, etc.)
// ═══════════════════════════════════════════════════════════════════════════

export function tmplToRow(t, tenantId) {
  return {
    id: t.id, tenant_id: tenantId,
    category: t.category, frequency: t.frequency,
    title: t.title, description: t.description ?? null,
    sections: t.sections,
    // custom/v não iam pra nuvem — a edição da RT (custom:true) podia ser
    // silenciosamente revertida por um sync num outro device (ou no mesmo,
    // após um pull): sem esses dois campos, o registro que volta da nuvem
    // parece "nunca editado" e readFormTemplates reaplica o seed por cima.
    // Rodar docs/form-templates-custom-column.sql antes do deploy.
    custom: t.custom ?? false, v: t.v ?? 0,
    updated_at: t.updatedAt ?? new Date().toISOString(),
  };
}
export function tmplFromRow(row) {
  return {
    id: row.id, category: row.category, frequency: row.frequency,
    title: row.title, description: row.description,
    sections: row.sections,
    custom: row.custom ?? false, v: row.v ?? 0,
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

// Apagar template na nuvem — online-only, mesmo motivo do deletePOPCloud: a
// fila offline replaya tudo como POST merge-duplicates, então um DELETE
// enfileirado ressuscitaria a cópia que a limpeza acabou de matar.
export async function deleteFormTemplateCloud(tenantId, templateId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false, reason:'offline_or_disabled' };
  try {
    await sbFetch('form_templates', { method:'DELETE', filter:`tenant_id=eq.${tenantId}&id=eq.${templateId}` }, tenantId);
    return { ok:true };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// Aplica a limpeza de planilhas duplicadas (ver src/forms-dedupe.js).
//
// ORDEM IMPORTA: grava local primeiro (o dado do usuário fica seguro mesmo se
// a rede cair no meio), depois reconcilia a nuvem. Se o delete remoto falhar,
// a cópia volta no próximo sync — chato, mas não destrutivo, e o botão pode
// ser clicado de novo.
//
// Só os registros REMAPEADOS sobem: os outros já estão corretos na nuvem, e
// empurrar 41 linhas pra corrigir 35 seria desperdício.
export async function aplicarLimpezaFormularios(tenantId, { templates, records, apagar = [], remapear = [] }) {
  lw(`nutriops.forms.templates.${tenantId}`, templates);
  lw(`nutriops.forms.records.${tenantId}`, records);

  let apagados = 0, falhasApagar = 0;
  for (const id of apagar) {
    const r = await deleteFormTemplateCloud(tenantId, id);
    if (r.ok) apagados++; else falhasApagar++;
  }

  const paraSubir = new Set(remapear.map((r) => r.recordId));
  let subidos = 0;
  for (const rec of records) {
    if (!paraSubir.has(rec.id)) continue;
    await pushFormRecord(tenantId, rec);   // enfileira sozinho se estiver offline
    subidos++;
  }

  return { ok:true, apagados, falhasApagar, subidos };
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

// ⚠️ TEM que ser a MESMA chave que a UI lê (catalogKey em pages.jsx:
// `nutriops.equipment.catalog.{id}`). Antes era `nutriops.equip_assets.{id}` —
// o sync puxava o catálogo da nuvem e gravava numa chave que a tela NÃO lê, então
// tenant sem catálogo no seed (ex.: CASA DOCE) mostrava "nenhum equipamento".
// Nas lojas-seed ficou mascarado porque elas têm o catálogo embutido no build.
const EQ_KEY = (tenantId) => `nutriops.equipment.catalog.${tenantId}`;

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
// TENANT STAFF — lista de nomes da equipe da loja (SEM credencial)
// ═══════════════════════════════════════════════════════════════════════════
// No modelo novo (operador por registro), quem trabalha na loja é só um NOME
// numa lista: entrou alguém = mais um nome; saiu = tira o nome. Mas a lista
// vivia só no localStorage do aparelho — o gerente cadastrava no celular dele
// e o tablet do balcão nunca via. Sem sincronizar, o modelo não fecha.
//
// ⚠️ MESMA CHAVE que readUsers/readStaff leem (`nutriops.users.{id}`). Gravar
// em chave diferente foi exatamente o bug do catálogo de equipamentos (v1.9.60):
// sincronizava pra um lugar que a tela não lia e a loja via "ninguém".
const STAFF_KEY = (tenantId) => `nutriops.users.${tenantId}`;

// ⚠️ `pin` NUNCA vai pra nuvem. O objeto de usuário do data.js carrega o PIN de
// fábrica; isto aqui é lista de nomes, não de credenciais.
function staffToRow(u, tenantId) {
  return {
    tenant_id: tenantId,
    name: u.name,
    role: u.role ?? 'Colaborador',
    location: u.location ?? null,
    status: u.status ?? 'Ativo',
    updated_at: new Date().toISOString(),
  };
}
function staffFromRow(row) {
  return {
    name: row.name,
    role: row.role,
    location: row.location ?? '',
    status: row.status ?? 'Ativo',
  };
}

export async function syncTenantStaff(tenantId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok: false, reason: 'offline_or_disabled' };
  try {
    const rows = await sbFetch('tenant_staff', { filter: `tenant_id=eq.${tenantId}&order=name.asc&limit=300` }, tenantId);
    const remote = rows.map(staffFromRow);
    // Nuvem é a fonte de verdade — mas só sobrescreve se houver alguém lá.
    // Nuvem vazia = loja ainda não migrou; apagar a lista local trancaria a
    // equipe fora do registro.
    if (remote.length > 0) lw(STAFF_KEY(tenantId), remote);
    return { ok: true, count: remote.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FOTOS DE EVIDÊNCIA (Supabase Storage) — bucket `form-photos`, privado.
//
// POR QUE Storage e não base64 no registro: a resposta do formulário vive em
// form_records.responses (jsonb) e no localStorage. Uma foto de celular tem
// 2-4 MB; mesmo reduzida ficaria em ~100 KB, e o localStorage do navegador
// estoura em ~5 MB. Um checklist diário com uma foto encheria o aparelho em
// poucos meses e travaria TODO o app, não só a foto. No registro guardamos só
// o CAMINHO; o arquivo vive no Storage, com a mesma regra de isolamento por
// loja das outras tabelas (docs/form-photos-storage.sql).
//
// Caminho: {tenantId}/{formId}/{periodKey}/{fieldId}-{carimbo}.jpg — o
// tenantId como PRIMEIRA pasta é o que a policy usa pra isolar as lojas.
const PHOTO_BUCKET = 'form-photos';
function sbStorageBase() { return `${getSupabaseConfig().url}/storage/v1`; }

export function buildPhotoPath({ tenantId, formId, periodKey, fieldId }) {
  const seguro = (s) => String(s ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const carimbo = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `${seguro(tenantId)}/${seguro(formId)}/${seguro(periodKey)}/${seguro(fieldId)}-${carimbo}.jpg`;
}

// Envia o blob e devolve o caminho salvo. Lança em falha — quem chama mostra o
// erro em vez de deixar o usuário achar que a foto foi anexada.
export async function uploadFormPhoto(tenantId, blob, meta) {
  if (!isSupabaseEnabled()) throw new Error('Sem conexão com a nuvem — não dá pra anexar foto agora.');
  if (!navigator.onLine)   throw new Error('Sem internet — tire a foto de novo quando reconectar.');
  const path = buildPhotoPath({ tenantId, ...meta });
  const { anonKey } = getSupabaseConfig();
  const { Authorization } = await sbHeaders(tenantId);   // member JWT ou device-token
  const res = await fetch(`${sbStorageBase()}/object/${PHOTO_BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
    body: blob,
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) markSupabaseAuthError(res.status, 'storage');
    let msg = ''; try { msg = await res.text(); } catch {}
    throw new Error(`Falha ao enviar a foto (${res.status})${msg ? ' — ' + msg.slice(0, 120) : ''}`);
  }
  return path;
}

// URL assinada pra exibir. O bucket é privado, então a foto NÃO abre por URL
// pública — cada visualização pede um link temporário.
export async function signedPhotoUrl(tenantId, path, segundos = 3600) {
  if (!isSupabaseEnabled() || !path) return null;
  try {
    const { anonKey } = getSupabaseConfig();
    const { Authorization } = await sbHeaders(tenantId);
    const res = await fetch(`${sbStorageBase()}/object/sign/${PHOTO_BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: segundos }),
    });
    if (!res.ok) return null;
    const { signedURL } = await res.json();
    return signedURL ? `${sbStorageBase()}${signedURL.replace(/^\/storage\/v1/, '')}` : null;
  } catch { return null; }
}

export async function pushStaffMember(tenantId, member) {
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('tenant_staff', 'upsert', staffToRow(member, tenantId));
    return;
  }
  try {
    await sbFetch('tenant_staff', {
      method: 'POST', body: staffToRow(member, tenantId),
      prefer: 'resolution=merge-duplicates,return=minimal',
    }, tenantId);
  } catch (e) { logFailAndEnqueue('tenant_staff', 'upsert', staffToRow(member, tenantId), e); }
}

export async function deleteStaffMember(tenantId, name) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok: false };
  try {
    await sbFetch('tenant_staff', {
      method: 'DELETE',
      filter: `tenant_id=eq.${tenantId}&name=eq.${encodeURIComponent(name)}`,
    }, tenantId);
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// Sobe a lista local inteira (usado na migração de uma loja pro modelo novo).
export async function pushAllStaff(tenantId, staff) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok: false };
  let pushed = 0, failed = 0;
  for (const u of (staff || [])) {
    if (!u?.name) continue;
    try { await pushStaffMember(tenantId, u); pushed++; } catch { failed++; }
  }
  return { ok: true, pushed, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
// RECEIVING RECORDS
// ═══════════════════════════════════════════════════════════════════════════

function recvToRow(r) {
  return {
    id: r.id, tenant_id: r.tenantId, fornecedor: r.fornecedor, nf: r.nf, produto: r.produto,
    quantidade: r.quantidade, validade: r.validade, temperatura: r.temperatura,
    conservacao: r.conservacao ?? null,
    checks: r.checks, resultado: r.resultado, motivo_rejeicao: r.motivoRejeicao, obs: r.obs,
    user_name: r.user, role: r.role, created_at: r.createdAt,
  };
}
function recvFromRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id, fornecedor: row.fornecedor, nf: row.nf, produto: row.produto,
    quantidade: row.quantidade, validade: row.validade, temperatura: row.temperatura,
    conservacao: row.conservacao,
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
    // merge-duplicates: era o ÚNICO push do projeto sem isso, e por isso
    // reenviar um recebimento já subido devolvia 409 (23505, duplicate key)
    // em vez de virar no-op. Como o auto-backfill reenvia tudo, cada boot
    // acumulava um 409 por recebimento antigo, o backfill nunca fechava e
    // repetia pra sempre. A fila já reexecutava com merge — só o caminho
    // direto ficou de fora.
    await sbFetch('receiving_records', { method:'POST', body:recvToRow(record), prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
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
    opened_at: p.openedAt ?? null, opened_until: p.openedUntil ?? null, opened_by: p.openedBy ?? null,
    created_at: p.createdAt, updated_at: p.updatedAt ?? new Date().toISOString(),
  };
}
function productFromRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id, name: row.name, category: row.category,
    conservation: row.conservation, unit: row.unit, minStock: row.min_stock, currentStock: row.current_stock,
    expiryDate: row.expiry_date, supplier: row.supplier, lot: row.lot,
    daysAfterOpen: row.days_after_open, isDiamond: row.is_diamond,
    openedAt: row.opened_at, openedUntil: row.opened_until, openedBy: row.opened_by,
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

// Busca 1 produto na nuvem por id — usado pelo leitor de etiqueta (QR) quando
// o produto não está no cache local do device (loja ainda não sincronizada
// aqui, ou o usuário tem acesso a mais de uma loja). O RLS já protege sozinho:
// se o JWT de quem está lendo não cobre esse tenant, a resposta vem vazia —
// não dá pra usar isto pra "ver se existe" um produto de loja alheia.
export async function fetchProductById(tenantId, productId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return null;
  try {
    const rows = await sbFetch('products', { filter: `tenant_id=eq.${tenantId}&id=eq.${productId}&limit=1` }, tenantId);
    return rows?.[0] ? productFromRow(rows[0]) : null;
  } catch (e) {
    console.warn('[repo] fetchProductById failed:', e.message);
    return null;
  }
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
    await sbFetch('stock_logs', { method:'POST', body:stockToRow(log, tenantId), prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('stock_logs', 'insert', stockToRow(log, tenantId), e); }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDITY RULES (prazo de validade pós-abertura, por categoria)
//
// Diferente dos módulos acima, é 1 linha por tenant (config, não histórico) —
// quem ajusta pode estar em outro device (ex.: a nutricionista trabalhando de
// casa) do que quem imprime a etiqueta na produção. Sem sync, a mudança fica
// presa no device de quem editou e a produção nunca vê o valor novo.
// ═══════════════════════════════════════════════════════════════════════════

function rulesToRow(tenantId, rules, updatedAt) {
  return { tenant_id: tenantId, rules, updated_at: updatedAt };
}

export async function pushValidityRules(tenantId, rules) {
  const updatedAt = new Date().toISOString();
  writeOpenRules(tenantId, rules, updatedAt); // grava local com o mesmo carimbo que vai pra nuvem
  const row = rulesToRow(tenantId, rules, updatedAt);
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('validity_rules', 'upsert', row);
    return;
  }
  try {
    await sbFetch('validity_rules', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('validity_rules', 'upsert', row, e); }
}

// Nuvem só sobrescreve o local quando é mais nova — protege edição feita
// offline neste device enquanto outro ainda não sincronizou a dele.
export async function syncValidityRules(tenantId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false, reason:'offline_or_disabled' };
  try {
    const rows = await sbFetch('validity_rules', { filter:`tenant_id=eq.${tenantId}&limit=1` }, tenantId);
    if (!rows?.length) return { ok:true, applied:false };
    const remote = rows[0];
    const localUpdatedAt = readRulesUpdatedAt(tenantId);
    if (!localUpdatedAt || new Date(remote.updated_at) > new Date(localUpdatedAt)) {
      writeOpenRules(tenantId, remote.rules, remote.updated_at);
      return { ok:true, applied:true };
    }
    return { ok:true, applied:false };
  } catch (e) {
    console.warn('[repo] syncValidityRules failed:', e.message);
    return { ok:false, reason:e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CORRECTIVE ACTIONS — só localStorage até 09/08 (achado da revisão de
// produto): limpar o navegador apagava a evidência de correção de um desvio,
// exigência da própria RDC 216. Muda de status ao longo do tempo (aberta →
// em_andamento → resolvida), por isso upsert como products, não insert puro
// como receiving_records.
//
// `source`/`sourceId` generalizam o que antes era só `recordId` de
// temperatura — a Central de Não-Conformidades abre ação a partir de 4
// origens (temperatura, recebimento rejeitado, controle reprovado, NC de
// planilha). Ações já existentes SEM `source` (salvas antes desta mudança)
// continuam lidas como `source:'temperature'` por quem consome (ver
// actionSourceKey em pages.jsx) — não precisa migrar dado antigo.
// ═══════════════════════════════════════════════════════════════════════════

function actionToRow(a, tenantId) {
  return {
    id: a.id, tenant_id: tenantId,
    source: a.source ?? 'temperature', source_id: a.sourceId ?? a.recordId ?? null,
    source_label: a.sourceLabel ?? a.equipment ?? null,
    source_detail: a.sourceDetail ?? (a.temperature != null ? `${a.temperature}°C` : null),
    description: a.description, responsible: a.responsible ?? null, deadline: a.deadline ?? null,
    status: a.status, resolution: a.resolution ?? null,
    created_at: a.createdAt, updated_at: a.updatedAt ?? new Date().toISOString(), closed_at: a.closedAt ?? null,
  };
}
function actionFromRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id,
    source: row.source, sourceId: row.source_id, sourceLabel: row.source_label, sourceDetail: row.source_detail,
    description: row.description, responsible: row.responsible, deadline: row.deadline,
    status: row.status, resolution: row.resolution,
    createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at,
  };
}

export async function syncCorrectiveActions(tenantId) {
  return syncModule({ table:'corrective_actions', localKey:`nutriops.corrective_actions.${tenantId}`, tenantId, toRow:(a)=>actionToRow(a, tenantId), fromRow:actionFromRow });
}

export async function pushCorrectiveAction(tenantId, action) {
  const row = actionToRow(action, tenantId);
  if (!isSupabaseEnabled() || !navigator.onLine) {
    enqueue('corrective_actions', 'upsert', row);
    return;
  }
  try {
    await sbFetch('corrective_actions', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('corrective_actions', 'upsert', row, e); }
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
    await sbFetch('special_controls', { method:'POST', body:controlToRow(type, record, tenantId), prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
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
// FATIA 3 (15/08) — evidência que sobrevive a wipe: POPs, capacitação e
// validações da RT. Achado da auditoria RDC (docs/AUDITORIA_RDC_2026.md §2):
// tudo que a RT constrói uma vez vivia só no localStorage do device dela —
// um wipe apagava certificados e POPs da rede inteira. Mesma classe de bug
// da Central de NC. SQL: docs/pops-capacitacao-sync.sql (rodar ANTES do
// deploy). `data jsonb` guarda o objeto inteiro (padrão special_controls);
// as colunas soltas são só índice.
//
// Nota: o "pull de stock_logs" que a auditoria também listou MORREU antes de
// nascer — a v1.9.129 removeu o controle de estoque do produto (vive no
// Nexum agora); não há mais tela que consuma nem código que grave stock_logs.
// ═══════════════════════════════════════════════════════════════════════════

// ─── POPs ────────────────────────────────────────────────────────────────
const POPS_KEY = (tenantId) => `nutriops.pops.${tenantId}`;

function popToRow(tenantId, pop) {
  return {
    id: pop.id, tenant_id: tenantId, title: pop.title, category: pop.category ?? null,
    data: pop, created_at: pop.createdAt ?? new Date().toISOString(),
    updated_at: pop.updatedAt ?? new Date().toISOString(),
  };
}
function popFromRow(row) { return { ...row.data, id: row.id }; }

export async function pushPOP(tenantId, pop) {
  const row = popToRow(tenantId, pop);
  if (!isSupabaseEnabled() || !navigator.onLine) { enqueue('pops', 'upsert', row); return; }
  try {
    await sbFetch('pops', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('pops', 'upsert', row, e); }
}

// Mesmo contrato online-only de deleteEquipmentItem/deleteStaffMember: a fila
// offline replaya tudo como POST merge-duplicates, então um DELETE enfileirado
// viraria upsert e RESSUSCITARIA o POP apagado. Offline devolve {ok:false} e
// o POP some só localmente até alguém remover de novo online.
export async function deletePOPCloud(tenantId, popId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false };
  try {
    await sbFetch('pops', { method:'DELETE', filter:`tenant_id=eq.${tenantId}&id=eq.${popId}` }, tenantId);
    return { ok:true };
  } catch (e) { return { ok:false, reason:e.message }; }
}

export async function syncPOPs(tenantId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false, reason:'offline_or_disabled' };
  try {
    const rows = await sbFetch('pops', { filter:`tenant_id=eq.${tenantId}&order=created_at.desc&limit=300` }, tenantId);
    const remote = rows.map(popFromRow);
    // Nuvem é fonte de verdade (mesma regra de tenant_staff/equipment_catalog,
    // lista curada com remoção): é o que faz um "Remover" num device sumir nos
    // outros. Nuvem vazia NÃO apaga local — loja que ainda não migrou mantém
    // os POPs até o backfill subir com eles.
    if (remote.length > 0) lw(POPS_KEY(tenantId), remote);
    return { ok:true, count: remote.length };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// ─── Sessões de capacitação ──────────────────────────────────────────────
const TRAINING_SESSIONS_KEY = (tenantId) => `nutriops.training.sessions.${tenantId}`;

function trainingSessionToRow(tenantId, s) {
  return {
    id: s.id, tenant_id: tenantId, status: s.status ?? 'open', session_date: s.date ?? null,
    data: s, created_at: s.createdAt ?? new Date().toISOString(),
    updated_at: s.updatedAt ?? new Date().toISOString(),
  };
}
function trainingSessionFromRow(row) { return { ...row.data, id: row.id }; }

export async function pushTrainingSession(tenantId, session) {
  const row = trainingSessionToRow(tenantId, session);
  if (!isSupabaseEnabled() || !navigator.onLine) { enqueue('training_sessions', 'upsert', row); return; }
  try {
    await sbFetch('training_sessions', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('training_sessions', 'upsert', row, e); }
}

// Merge (não replace): sessão não tem exclusão na UI, e o merge nunca esconde
// uma sessão criada offline que ainda espera na fila. mergeByKey decide pelo
// updatedAt — confirmação de presença/assinatura da RT bumpa o carimbo.
export async function syncTrainingSessions(tenantId) {
  return syncModule({
    table:'training_sessions', localKey:TRAINING_SESSIONS_KEY(tenantId), tenantId,
    toRow:(s)=>trainingSessionToRow(tenantId, s), fromRow:trainingSessionFromRow,
  });
}

// ─── Config de capacitação (1 linha por tenant, padrão validity_rules) ────
// Sem sync, um device novo volta pro default de 12 meses e o status em-dia/
// vencido de TODA a equipe muda silenciosamente — inclusive o check A4 da
// tela de Prontidão.
const TRAIN_CONFIG_KEY = (tenantId) => `nutriops.training.config.${tenantId}`;

export async function pushTrainingConfig(tenantId, config) {
  const updatedAt = new Date().toISOString();
  lw(TRAIN_CONFIG_KEY(tenantId), { ...config, updatedAt }); // local com o mesmo carimbo da nuvem
  const row = {
    tenant_id: tenantId,
    validity_months: Number(config.validityMonths) || 12,
    crn_number: config.crnNumber ?? '',
    updated_at: updatedAt,
  };
  if (!isSupabaseEnabled() || !navigator.onLine) { enqueue('training_config', 'upsert', row); return; }
  try {
    await sbFetch('training_config', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('training_config', 'upsert', row, e); }
}

// Nuvem só sobrescreve quando é mais nova — protege edição feita offline
// neste device enquanto outro ainda não sincronizou a dele.
export async function syncTrainingConfig(tenantId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false, reason:'offline_or_disabled' };
  try {
    const rows = await sbFetch('training_config', { filter:`tenant_id=eq.${tenantId}&limit=1` }, tenantId);
    if (!rows?.length) return { ok:true, applied:false };
    const remote = rows[0];
    const local = ls(TRAIN_CONFIG_KEY(tenantId), null);
    if (!local?.updatedAt || new Date(remote.updated_at) > new Date(local.updatedAt)) {
      lw(TRAIN_CONFIG_KEY(tenantId), {
        validityMonths: remote.validity_months ?? 12,
        crnNumber: remote.crn_number ?? '',
        updatedAt: remote.updated_at,
      });
      return { ok:true, applied:true };
    }
    return { ok:true, applied:false };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// ─── Validações de período da RT ─────────────────────────────────────────
// A chave local é ÚNICA no device (a tela de Auditoria mostra tudo junto),
// mas cada linha na nuvem tem tenant_id — era o defeito apontado na auditoria
// ("nem é por tenant, cap 50"). Insert-only: assinatura não se edita.
const RT_VALIDATIONS_KEY = 'nutriops.rt.validations';

function rtValidationToRow(tenantId, v) {
  return {
    id: v.id, tenant_id: tenantId, by_name: v.by, role: v.role ?? null,
    period_filter: String(v.periodFilter ?? ''), record_count: v.recordCount ?? 0,
    note: v.note ?? '', created_at: v.at,
  };
}
function rtValidationFromRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id, by: row.by_name, role: row.role,
    at: row.created_at, periodFilter: row.period_filter, recordCount: row.record_count,
    note: row.note ?? '',
  };
}

export async function pushRtValidation(tenantId, validation) {
  const row = rtValidationToRow(tenantId, validation);
  if (!isSupabaseEnabled() || !navigator.onLine) { enqueue('rt_validations', 'insert', row); return; }
  try {
    await sbFetch('rt_validations', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('rt_validations', 'insert', row, e); }
}

export async function syncRtValidations(tenantId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false, reason:'offline_or_disabled' };
  try {
    const rows = await sbFetch('rt_validations', { filter:`tenant_id=eq.${tenantId}&order=created_at.desc&limit=100` }, tenantId);
    const remote = rows.map(rtValidationFromRow);
    const local = ls(RT_VALIDATIONS_KEY, []);
    const merged = mergeByKey([...local, ...remote], 'id')
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 200);
    lw(RT_VALIDATIONS_KEY, merged);
    return { ok:true, count: remote.length };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// FATIA 2b (15/08) — os descobertos que sobravam da auditoria RDC.
// Perfil do estabelecimento na nuvem (§3.21, era local-only), ASO por
// colaborador (§3.4) e atestado do Manual de BP (§3.18).
// SQL: docs/compliance-docs-sync.sql (rodar ANTES do deploy).
// ═══════════════════════════════════════════════════════════════════════════

// ─── Perfil do estabelecimento (1 linha por tenant) ──────────────────────
// Mesmo contrato de training_config/validity_rules: o carimbo decide quem
// vence. Sem isto, a validade do alvará nasceria evaporando junto com o
// aparelho — o defeito que a própria Fatia 2b existe pra fechar.
const COMPANY_PROFILE_KEY = (tenantId) => `nutriops.company.profile.${tenantId}`;

export async function pushCompanyProfile(tenantId, profile) {
  const updatedAt = new Date().toISOString();
  lw(COMPANY_PROFILE_KEY(tenantId), { ...profile, updatedAt }); // local com o mesmo carimbo
  const row = { tenant_id: tenantId, data: { ...profile, updatedAt }, updated_at: updatedAt };
  if (!isSupabaseEnabled() || !navigator.onLine) { enqueue('company_profile', 'upsert', row); return; }
  try {
    await sbFetch('company_profile', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('company_profile', 'upsert', row, e); }
}

export async function syncCompanyProfile(tenantId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false, reason:'offline_or_disabled' };
  try {
    const rows = await sbFetch('company_profile', { filter:`tenant_id=eq.${tenantId}&limit=1` }, tenantId);
    if (!rows?.length) return { ok:true, applied:false };
    const remote = rows[0];
    const local = ls(COMPANY_PROFILE_KEY(tenantId), null);
    if (!local?.updatedAt || new Date(remote.updated_at) > new Date(local.updatedAt)) {
      lw(COMPANY_PROFILE_KEY(tenantId), { ...remote.data, updatedAt: remote.updated_at });
      return { ok:true, applied:true };
    }
    return { ok:true, applied:false };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// ─── Documentos de conformidade (ASO, Manual de BP) ──────────────────────
const COMPLIANCE_KEY = (tenantId) => `nutriops.compliance.${tenantId}`;

function complianceToRow(tenantId, doc) {
  return {
    id: doc.id, tenant_id: tenantId, doc_type: doc.docType,
    subject: doc.subject ?? null, issued_at: doc.issuedAt ?? null,
    valid_until: doc.validUntil ?? null, data: doc,
    created_at: doc.createdAt ?? new Date().toISOString(),
    updated_at: doc.updatedAt ?? new Date().toISOString(),
  };
}
function complianceFromRow(row) {
  return {
    ...row.data, id: row.id, docType: row.doc_type, subject: row.subject,
    issuedAt: row.issued_at, validUntil: row.valid_until,
  };
}

export async function pushComplianceDoc(tenantId, doc) {
  const row = complianceToRow(tenantId, doc);
  if (!isSupabaseEnabled() || !navigator.onLine) { enqueue('compliance_docs', 'upsert', row); return; }
  try {
    await sbFetch('compliance_docs', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
  } catch (e) { logFailAndEnqueue('compliance_docs', 'upsert', row, e); }
}

// Online-only, mesmo motivo do deletePOPCloud: a fila replaya tudo como POST
// merge-duplicates, então um DELETE enfileirado ressuscitaria o documento.
export async function deleteComplianceDoc(tenantId, docId) {
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false };
  try {
    await sbFetch('compliance_docs', { method:'DELETE', filter:`tenant_id=eq.${tenantId}&id=eq.${docId}` }, tenantId);
    return { ok:true };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// Merge por id (não replace): um ASO lançado offline neste aparelho não pode
// sumir quando o pull traz os da nuvem.
export async function syncComplianceDocs(tenantId) {
  return syncModule({
    table:'compliance_docs', localKey:COMPLIANCE_KEY(tenantId), tenantId,
    toRow:(d)=>complianceToRow(tenantId, d), fromRow:complianceFromRow,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MANUTENÇÃO (16/08) — o último módulo local-only da auditoria RDC (§3.15).
// Ativos, execuções e ordens de serviço viviam só no localStorage: limpar o
// aparelho apagava o histórico de manutenção, que a RDC 216 §4.1 manda manter.
// SQL: docs/manutencao-sync.sql (rodar ANTES do deploy).
// ═══════════════════════════════════════════════════════════════════════════

const EQUIP_ASSETS_KEY = (id) => `nutriops.equip_assets.${id}`;
const MAINT_LOGS_KEY   = (id) => `nutriops.maint_logs.${id}`;
const WORK_ORDERS_KEY  = (id) => `nutriops.work_orders.${id}`;

function assetToRow(tenantId, a) {
  return {
    id: a.id, tenant_id: tenantId, name: a.name, location: a.location ?? null,
    status: a.status ?? null, data: a,
    created_at: a.createdAt ?? new Date().toISOString(),
    updated_at: a.updatedAt ?? new Date().toISOString(),
  };
}
function assetFromRow(row) { return { ...row.data, id: row.id }; }

function maintLogToRow(tenantId, l) {
  return {
    id: l.id, tenant_id: tenantId, equipment_id: l.equipmentId ?? null,
    plan_id: l.planId ?? null, type: l.type ?? null, title: l.title ?? null,
    executed_by: l.executedBy ?? null, executed_at: l.executedAt ?? null,
    data: l, created_at: l.createdAt ?? new Date().toISOString(),
  };
}
function maintLogFromRow(row) {
  return { ...row.data, id: row.id, equipmentId: row.equipment_id, executedAt: row.executed_at };
}

function workOrderToRow(tenantId, o) {
  return {
    id: o.id, tenant_id: tenantId, equipment_id: o.equipmentId ?? null,
    status: o.status ?? null, title: o.title ?? null, data: o,
    created_at: o.createdAt ?? new Date().toISOString(),
    updated_at: o.updatedAt ?? new Date().toISOString(),
  };
}
function workOrderFromRow(row) { return { ...row.data, id: row.id, equipmentId: row.equipment_id }; }

// Push por ITEM, ligado nos pontos de mutação da tela (maintenance.jsx).
// De propósito não é push de lista: o effect que grava no localStorage roda a
// cada mudança de state, e empurrar a lista de lá faria 44 requisições pra
// salvar UM equipamento numa loja com 44 ativos.
async function pushItem(tabela, tenantId, item, toRow) {
  if (!item?.id) return { ok: false, reason: 'sem_id' };
  const row = toRow(tenantId, item);
  if (!isSupabaseEnabled() || !navigator.onLine) { enqueue(tabela, 'upsert', row); return { ok: false, reason: 'offline_or_disabled' }; }
  try {
    await sbFetch(tabela, { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' }, tenantId);
    return { ok: true };
  } catch (e) { logFailAndEnqueue(tabela, 'upsert', row, e); return { ok: false, reason: e.message }; }
}

export const pushEquipAsset = (tenantId, item) => pushItem('equip_assets', tenantId, item, assetToRow);
export const pushMaintLog   = (tenantId, item) => pushItem('maint_logs',   tenantId, item, maintLogToRow);
export const pushWorkOrder  = (tenantId, item) => pushItem('work_orders',  tenantId, item, workOrderToRow);

// Apagar é online-only (mesmo motivo do deletePOPCloud): DELETE enfileirado
// seria replayado como upsert e ressuscitaria o item.
export async function deleteMaintenanceItem(tabela, tenantId, itemId) {
  if (!['equip_assets', 'maint_logs', 'work_orders'].includes(tabela)) return { ok:false, reason:'tabela_invalida' };
  if (!isSupabaseEnabled() || !navigator.onLine) return { ok:false, reason:'offline_or_disabled' };
  try {
    await sbFetch(tabela, { method:'DELETE', filter:`tenant_id=eq.${tenantId}&id=eq.${itemId}` }, tenantId);
    return { ok:true };
  } catch (e) { return { ok:false, reason:e.message }; }
}

// Merge por id (não replace): ativo criado offline neste aparelho não pode
// sumir quando o pull traz os da nuvem. mergeByKey desempata pelo updatedAt.
export async function syncEquipAssets(tenantId) {
  return syncModule({
    table:'equip_assets', localKey:EQUIP_ASSETS_KEY(tenantId), tenantId,
    toRow:(a)=>assetToRow(tenantId, a), fromRow:assetFromRow,
  });
}
export async function syncMaintLogs(tenantId) {
  return syncModule({
    table:'maint_logs', localKey:MAINT_LOGS_KEY(tenantId), tenantId,
    toRow:(l)=>maintLogToRow(tenantId, l), fromRow:maintLogFromRow,
  });
}
export async function syncWorkOrders(tenantId) {
  return syncModule({
    table:'work_orders', localKey:WORK_ORDERS_KEY(tenantId), tenantId,
    toRow:(o)=>workOrderToRow(tenantId, o), fromRow:workOrderFromRow,
  });
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
    syncTenantStaff(tenantId),
    syncReceiving(tenantId),
    syncProducts(tenantId),
    syncValidityRules(tenantId),
    syncCorrectiveActions(tenantId),
    syncPOPs(tenantId),
    syncTrainingSessions(tenantId),
    syncTrainingConfig(tenantId),
    syncRtValidations(tenantId),
    syncCompanyProfile(tenantId),
    syncComplianceDocs(tenantId),
    syncEquipAssets(tenantId),
    syncMaintLogs(tenantId),
    syncWorkOrders(tenantId),
    syncSpecialControls('oil', tenantId),
    syncSpecialControls('thaw', tenantId),
    syncSpecialControls('cool', tenantId),
    syncSpecialControls('thermal', tenantId),
    syncSpecialControls('handwash', tenantId),
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
      try { await sbFetch('receiving_records', { method:'POST', body:recvToRow(r), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Products
    const prods = ls(`nutriops.products.${id}`, []);
    for (const p of prods) {
      try { await sbFetch('products', { method:'POST', body:productToRow({ ...p, tenantId:id }), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Special controls
    for (const type of ['oil','thaw','cool','thermal','handwash']) {
      const controls = ls(`nutriops.${type}.${id}`, []);
      for (const r of controls) {
        try { await sbFetch('special_controls', { method:'POST', body:controlToRow(type, r, id), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
      }
    }

    // Corrective actions
    const actions = ls(`nutriops.corrective_actions.${id}`, []);
    for (const a of actions) {
      try { await sbFetch('corrective_actions', { method:'POST', body:actionToRow(a, id), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // POPs (Fatia 3 — é este backfill que sobe o acervo que a RT já tem)
    const pops = ls(`nutriops.pops.${id}`, []);
    for (const p of pops) {
      try { await sbFetch('pops', { method:'POST', body:popToRow(id, p), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Sessões de capacitação (Fatia 3)
    const sessions = ls(`nutriops.training.sessions.${id}`, []);
    for (const s of sessions) {
      try { await sbFetch('training_sessions', { method:'POST', body:trainingSessionToRow(id, s), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Config de capacitação (Fatia 3) — só se existir local; não inventa default
    const trainCfg = ls(`nutriops.training.config.${id}`, null);
    if (trainCfg) {
      const cfgRow = { tenant_id: id, validity_months: Number(trainCfg.validityMonths) || 12, crn_number: trainCfg.crnNumber ?? '', updated_at: trainCfg.updatedAt ?? new Date().toISOString() };
      try { await sbFetch('training_config', { method:'POST', body:cfgRow, prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Validações da RT (Fatia 3) — a chave local é global; sobe só as deste
    // tenant. Legadas sem tenantId ficam locais: não dá pra saber de que loja
    // eram, e inventar seria falsificar assinatura.
    const validations = ls('nutriops.rt.validations', []).filter(v => v.tenantId === id);
    for (const v of validations) {
      try { await sbFetch('rt_validations', { method:'POST', body:rtValidationToRow(id, v), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Perfil do estabelecimento (Fatia 2b) — só se existir local
    const perfil = ls(`nutriops.company.profile.${id}`, null);
    if (perfil) {
      const perfilRow = { tenant_id: id, data: perfil, updated_at: perfil.updatedAt ?? new Date().toISOString() };
      try { await sbFetch('company_profile', { method:'POST', body:perfilRow, prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Documentos de conformidade — ASO, Manual de BP (Fatia 2b)
    const docs = ls(`nutriops.compliance.${id}`, []);
    for (const d of docs) {
      try { await sbFetch('compliance_docs', { method:'POST', body:complianceToRow(id, d), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
    }

    // Manutenção — ativos, execuções e ordens de serviço (16/08)
    for (const [tabela, chave, toRow] of [
      ['equip_assets', `nutriops.equip_assets.${id}`, assetToRow],
      ['maint_logs',   `nutriops.maint_logs.${id}`,   maintLogToRow],
      ['work_orders',  `nutriops.work_orders.${id}`,  workOrderToRow],
    ]) {
      // `id` é primary key not-null. Item local sem id virava POST sem a coluna
      // → 23502 em TODA tentativa, e como o backfill só fecha com failed:0, ele
      // repetia a cada boot pra sempre (era o "auto-backfill incompleto" no
      // console). Diferente do pushItem, este caminho não tinha a guarda.
      //
      // Gera o id e GRAVA DE VOLTA no aparelho, em vez de descartar o item ou
      // de inventar um id só pra este POST: sem persistir, cada boot geraria um
      // id diferente e a mesma manutenção viraria N linhas na nuvem.
      const itens = garantirIds(chave);
      for (const it of itens) {
        try { await sbFetch(tabela, { method:'POST', body:toRow(id, it), prefer:'resolution=merge-duplicates,return=minimal' }, id); pushed++; } catch { failed++; }
      }
    }
  }

  setSyncStatus({ lastSync: new Date().toISOString(), pending: 0 });
  return { ok:true, pushed, failed };
}

// Garante `id` em todo item de uma lista local, persistindo o conserto. Puro o
// suficiente pra testar: devolve a lista já corrigida e só reescreve o
// localStorage se algo mudou. Exportado por causa dos testes.
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function garantirIds(chave) {
  const itens = ls(chave, []);
  if (!Array.isArray(itens)) return [];
  let mudou = false;
  const out = itens.map((it) => {
    if (!it || typeof it !== 'object') return it;
    // Não basta id AUSENTE — id INVÁLIDO passa batido pelo `if (it.id)` e falha
    // pra sempre do mesmo jeito (22P02 em vez de 23502). Achado ao corrigir o
    // dropdown de Ordens de Serviço: converter um item virtual do catálogo
    // (maintenance.jsx, id sintético "cat-<label>") em ativo real reusava esse
    // id truthy-mas-não-uuid. Corrigido na origem também — isto é a rede,
    // pra qualquer outro produtor de id ruim que a gente não tenha achado.
    if (it.id && RE_UUID.test(String(it.id))) return it;
    mudou = true;
    return { ...it, id: crypto.randomUUID() };
  }).filter((it) => it && typeof it === 'object');
  if (mudou || out.length !== itens.length) {
    console.warn(`[repo] ${chave}: itens sem id válido corrigidos e regravados (${itens.length} → ${out.length})`);
    lw(chave, out);
  }
  return out;
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
      n += ls(`nutriops.corrective_actions.${t.id}`, []).length;
      n += ls(`nutriops.pops.${t.id}`, []).length;
      n += ls(`nutriops.training.sessions.${t.id}`, []).length;
      n += ls(`nutriops.compliance.${t.id}`, []).length;
      n += ls(`nutriops.equip_assets.${t.id}`, []).length;
      n += ls(`nutriops.maint_logs.${t.id}`, []).length;
      n += ls(`nutriops.work_orders.${t.id}`, []).length;
      for (const type of ['oil','thaw','cool','thermal','handwash']) {
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
  original_value numeric, correction_reason text, corrected_by text, corrected_at timestamptz,
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
  custom boolean default false, v integer default 0,
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

-- 2d. Equipe da loja — lista de NOMES, sem credencial. É quem pode ser
-- escolhido como operador ("quem está registrando") no aparelho compartilhado.
-- Nunca guardar PIN/senha aqui: identificação, não autenticação.
create table if not exists tenant_staff (
  tenant_id text not null,
  name text not null,
  role text,
  location text,
  status text default 'Ativo',
  updated_at timestamptz default now(),
  primary key (tenant_id, name)
);
create index if not exists idx_staff_tenant on tenant_staff(tenant_id);

-- 3. Recebimento
create table if not exists receiving_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null, fornecedor text, nf text, produto text,
  quantidade text, validade text, temperatura text, conservacao text,
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
  opened_at timestamptz, opened_until timestamptz, opened_by text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_products_tenant on products(tenant_id);
create index if not exists idx_products_expiry on products(expiry_date);
-- Etiquetas de abertura (v1.9.99) — em base já criada, rodar:
-- alter table products add column if not exists opened_at timestamptz;
-- alter table products add column if not exists opened_until timestamptz;
-- alter table products add column if not exists opened_by text;

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

-- 7. ISOLAMENTO POR TENANT (RLS) — LIGADO em produção desde 18/07/2026.
-- ⚠️ ORDEM IMPORTA: as policies (seção 8) vêm ANTES do enable (seção 9).
-- Ligar RLS sem policy = deny-all: o app inteiro para de ler e de escrever.
--
-- 7b. A tabela 'tenants' NÃO é gerenciada por este script: o acesso anon a ela
-- foi migrado pra RPCs security-definer + RLS deny-all — ver
-- docs/security-tenants-lockdown.sql (fecha o alerta do Advisor de access_token/
-- setup_pin_hash expostos). Nunca rode 'disable' nela.

-- 8. Policies de isolamento por tenant.
--
-- ⭐ FONTE DE VERDADE: docs/rls-policies.sql — rode AQUELE arquivo.
--
-- As policies abaixo cobrem os 4 caminhos de acesso:
--   1. tenant_id = app_metadata.tenant_id  → conta presa a uma loja
--   2. tenant_id = '__healthcheck__'       → o testWrite do boot
--   3. is_member(tenant_id)                → login por e-mail com vínculo
--   4. is_admin_plataforma()               → admin da NutriOPS
--
-- ⚠️ O caminho 3 FALTAVA aqui até 16/08/2026, e este bloco é exibido na tela
-- de Configurações pro usuário copiar. Quem copiasse e rodasse REBAIXAVA as
-- policies do banco pra 2 caminhos — foi assim que a temperature_records ficou
-- pra trás e a CASA DOCE perdeu acesso aos próprios 108 registros (a tela
-- mostrava zero, o console alagava de 401/42501, e o dado estava intacto o
-- tempo todo). Se mexer aqui, mexa também em docs/rls-policies.sql.
--
-- Usa app_metadata, NUNCA user_metadata: user_metadata é editável pelo próprio
-- usuário (updateUser), então policy que confia nele é forjável — dava pra virar
-- outro tenant pelo devtools. app_metadata só muda via service_role.
--
-- Sem cláusula 'to' → vale pra anon E authenticated:
--   • device (authenticated, app_metadata.tenant_id=swiss) → linhas de swiss + healthcheck
--   • anon (a chave pública que vai no bundle) → app_metadata é null, alcança só
--     '__healthcheck__' e NUNCA dado real. É isso que fecha o buraco da anon key.
--
-- Não há bypass por role: a visão cross-tenant do /admin vai por RPC
-- security-definer gated por app_metadata.role='admin', não por policy.
-- drop policy if exists = idempotente, pode rodar este script de novo à vontade.

-- As duas funções de apoio (idempotentes — o script pode rodar em base nova).
create or replace function public.is_member(p_tenant_id text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members m
                  where m.user_id = auth.uid() and m.tenant_id = p_tenant_id)
$$;
revoke execute on function public.is_member(text) from anon, public;
grant  execute on function public.is_member(text) to authenticated;

create or replace function public.is_admin_plataforma()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;
revoke execute on function public.is_admin_plataforma() from anon, public;
grant  execute on function public.is_admin_plataforma() to authenticated;

drop policy if exists tenant_isolation on temperature_records;
create policy tenant_isolation on temperature_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

drop policy if exists tenant_isolation on form_records;
create policy tenant_isolation on form_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

drop policy if exists tenant_isolation on form_templates;
create policy tenant_isolation on form_templates for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

drop policy if exists tenant_isolation on equipment_catalog;
create policy tenant_isolation on equipment_catalog for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

drop policy if exists tenant_isolation on tenant_staff;
create policy tenant_isolation on tenant_staff for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

drop policy if exists tenant_isolation on receiving_records;
create policy tenant_isolation on receiving_records for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

drop policy if exists tenant_isolation on products;
create policy tenant_isolation on products for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

drop policy if exists tenant_isolation on stock_logs;
create policy tenant_isolation on stock_logs for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

drop policy if exists tenant_isolation on special_controls;
create policy tenant_isolation on special_controls for all
  using      (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma())
  with check (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id') or tenant_id = '__healthcheck__' or public.is_member(tenant_id) or public.is_admin_plataforma());

-- 9. LIGAR o RLS — só DEPOIS das policies acima existirem.
-- Rollback de emergência (1 comando por tabela): alter table X disable row level security;
alter table temperature_records enable row level security;
alter table form_records         enable row level security;
alter table form_templates       enable row level security;
alter table equipment_catalog    enable row level security;
alter table tenant_staff         enable row level security;
alter table receiving_records    enable row level security;
alter table products             enable row level security;
alter table stock_logs           enable row level security;
alter table special_controls     enable row level security;`;

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
