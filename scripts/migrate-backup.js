// Migração one-shot do backup local (JSON exportado do localStorage) pro
// Supabase. Idempotente — usa upsert merge-duplicates, então rodar 2x não
// duplica nada.
//
// Uso:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJhbGc... \
//   node scripts/migrate-backup.js /caminho/do/backup.json
//
// Ou via npm script:
//   npm run migrate:backup -- /caminho/do/backup.json
//
// Precondição: as tabelas do schema (SUPABASE_SQL em src/repository.js)
// já devem existir no Supabase. Se não existirem, o script avisa e mostra
// como rodar.

import fs from 'node:fs/promises';
import process from 'node:process';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const backupPath = process.argv[2];

function die(msg, code = 1) { console.error(`✗ ${msg}`); process.exit(code); }

if (!SUPABASE_URL || !SUPABASE_KEY) die('Faltam env vars: SUPABASE_URL e SUPABASE_ANON_KEY.');
if (!backupPath) die('Uso: node scripts/migrate-backup.js <caminho-do-backup.json>');

// ─── Transforms (cópias fiéis de src/repository.js) ──────────────────────
function tempToRow(i) {
  return {
    id: i.id,
    tenant_id: i.tenantId, tenant_name: i.tenantName,
    equipment_input: i.equipmentInput, equipment_key: i.equipmentKey ?? i.equipment,
    equipment_location: i.equipmentLocation ?? null,
    measured_at: i.measuredAt,
    value: i.value, min_value: i.min, max_value: i.max,
    note: i.note ?? null,
    user_name: i.user, user_role: i.role,
    control_mode: i.controlMode ?? 'routine',
    observation_interval: i.observationInterval ?? null,
    created_at: i.createdAt,
  };
}
function formToRow(r) {
  return {
    id: r.id, tenant_id: r.tenantId,
    form_id: r.formId, form_title: r.formTitle,
    category: r.category, frequency: r.frequency, period_key: r.periodKey,
    responses: r.responses, status: r.status, validation: r.validation ?? null,
    user_name: r.user, role: r.role,
    created_at: r.createdAt, updated_at: r.updatedAt,
  };
}
function tmplToRow(t, tenantId) {
  return {
    id: t.id, tenant_id: tenantId,
    category: t.category, frequency: t.frequency,
    title: t.title, description: t.description ?? null,
    sections: t.sections,
    updated_at: t.updatedAt ?? new Date().toISOString(),
  };
}

// ─── REST helper ─────────────────────────────────────────────────────────
async function sbFetch(method, table, params = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}${params.query ? '?' + params.query : ''}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (params.prefer) headers.Prefer = params.prefer;
  const res = await fetch(url, {
    method, headers,
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${res.status} ${res.statusText} — ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res;
}

async function tablesExist() {
  try {
    await sbFetch('HEAD', 'temperature_records', { query: 'limit=1' });
    await sbFetch('HEAD', 'form_records',        { query: 'limit=1' });
    return true;
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
}

async function upsert(table, row) {
  await sbFetch('POST', table, {
    body: row,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────
console.log(`→ Lendo backup: ${backupPath}`);
const raw = await fs.readFile(backupPath, 'utf8');
const data = JSON.parse(raw);
console.log(`  ${Object.keys(data).length} chaves no backup`);

console.log(`\n→ Verificando schema em ${SUPABASE_URL}...`);
const ok = await tablesExist();
if (!ok) {
  console.error('\n✗ Tabelas temperature_records e/ou form_records não existem nesse projeto Supabase.');
  console.error('  Abra o Dashboard → SQL Editor → New query e cole o conteúdo de');
  console.error('  SUPABASE_SQL exportado em src/repository.js (linhas ~494-562).');
  console.error('  Depois rode esse script de novo.');
  process.exit(2);
}
console.log('  ✓ schema ok');

let totalOk = 0, totalFail = 0;
const failures = [];

// Temperature records
const tempsRaw = data['nutriops.temperature.records'];
if (tempsRaw) {
  const temps = JSON.parse(tempsRaw);
  console.log(`\n→ temperature_records — ${temps.length} registros`);
  let ok = 0, fail = 0;
  for (const t of temps) {
    try { await upsert('temperature_records', tempToRow(t)); ok++; }
    catch (e) { fail++; failures.push({ table: 'temperature_records', id: t.id, err: e.message }); }
  }
  console.log(`  ${ok} ok / ${fail} falharam`);
  totalOk += ok; totalFail += fail;
}

// Form records — find all tenant keys (nutriops.forms.records.<tenantId>)
const formKeys = Object.keys(data).filter(k => k.startsWith('nutriops.forms.records.'));
for (const key of formKeys) {
  const forms = JSON.parse(data[key]);
  if (!forms.length) continue;
  const tenant = key.replace('nutriops.forms.records.', '');
  console.log(`\n→ form_records — tenant=${tenant} (${forms.length} registros)`);
  let ok = 0, fail = 0;
  for (const f of forms) {
    try { await upsert('form_records', formToRow(f)); ok++; }
    catch (e) { fail++; failures.push({ table: `form_records[${tenant}]`, id: f.id, err: e.message }); }
  }
  console.log(`  ${ok} ok / ${fail} falharam`);
  totalOk += ok; totalFail += fail;
}

// Form templates — find all tenant keys (nutriops.forms.templates.<tenantId>)
const tmplKeys = Object.keys(data).filter(k => k.startsWith('nutriops.forms.templates.'));
for (const key of tmplKeys) {
  const tmpls = JSON.parse(data[key]);
  if (!tmpls.length) continue;
  const tenant = key.replace('nutriops.forms.templates.', '');
  console.log(`\n→ form_templates — tenant=${tenant} (${tmpls.length} templates)`);
  let ok = 0, fail = 0;
  for (const t of tmpls) {
    try { await upsert('form_templates', tmplToRow(t, tenant)); ok++; }
    catch (e) { fail++; failures.push({ table: `form_templates[${tenant}]`, id: t.id, err: e.message }); }
  }
  console.log(`  ${ok} ok / ${fail} falharam`);
  totalOk += ok; totalFail += fail;
}

console.log(`\n──────────────────────────────────`);
console.log(`Total: ${totalOk} ok, ${totalFail} falharam`);
if (failures.length) {
  console.log('\nDetalhes das falhas:');
  for (const f of failures.slice(0, 10)) {
    console.log(`  - ${f.table} ${f.id}: ${f.err.slice(0, 120)}`);
  }
  if (failures.length > 10) console.log(`  ... (+${failures.length - 10} mais)`);
}
process.exit(totalFail > 0 ? 1 : 0);
