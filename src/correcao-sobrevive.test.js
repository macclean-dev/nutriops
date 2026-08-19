import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ls, lw, saveSupabaseConfig, clearOfflineQueue, localRepository, supabaseRepository, mergeByKey } from './repository';

const RECORDS_KEY = 'nutriops.temperature.records';
const ok = (b) => Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(b)) });

// ─────────────────────────────────────────────────────────────────────────────
// A RT corrige uma leitura na Auditoria. A correção grava local + enfileira.
// No próximo refresh, mergeByKey desempata com `>=` e em list() o remoto entra
// DEPOIS do local — então, no empate, o remoto vence. Como a correção não muda
// o createdAt, ela EMPATAVA com a linha velha da nuvem e era apagada da tela.
// Numa correção de temperatura isso é evidência de fiscalização sumindo:
// originalValue e correctedBy fazem parte da trilha exigida.
// Achado da auditoria (18/08).
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  saveSupabaseConfig({ url:'https://x.test', anonKey:'a', enabled:true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const criadoEm = new Date(Date.now() - 3600000).toISOString();
const original = { id:'r1', tenantId:'casadoce', value:18, createdAt:criadoEm, user:'Ana' };

describe('o desempate que apagava a correção', () => {
  it('sem updatedAt, o remoto velho vence o local corrigido', () => {
    const localCorrigido = { ...original, value:-18, originalValue:18, correctedBy:'RT' };
    const out = mergeByKey([localCorrigido, original], 'id');   // local, depois remoto
    expect(out[0].value).toBe(18);          // ✅ documenta o estrago
    expect(out[0].correctedBy).toBeUndefined();
  });

  it('com updatedAt, a correção vence — é o conserto', () => {
    const localCorrigido = { ...original, value:-18, originalValue:18, correctedBy:'RT', updatedAt:new Date().toISOString() };
    const out = mergeByKey([localCorrigido, original], 'id');
    expect(out[0].value).toBe(-18);
    expect(out[0].correctedBy).toBe('RT');
  });
});

describe('update carimba updatedAt', () => {
  it('localRepository', async () => {
    lw(RECORDS_KEY, [original]);
    const r = await localRepository.update('r1', 'casadoce', { value:-18, originalValue:18, correctedBy:'RT' });
    expect(r.updatedAt).toBeTruthy();
    expect(new Date(r.updatedAt).getTime()).toBeGreaterThan(new Date(criadoEm).getTime());
  });

  it('supabaseRepository offline (fica pendente)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    lw(RECORDS_KEY, [original]);
    const r = await supabaseRepository.update('r1', 'casadoce', { value:-18, correctedBy:'RT' });
    expect(r._pending).toBe(true);
    expect(ls(RECORDS_KEY, [])[0].updatedAt).toBeTruthy();
  });

  it('o round-trip: corrige offline, volta online, o refresh NÃO apaga', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    lw(RECORDS_KEY, [original]);
    await supabaseRepository.update('r1', 'casadoce', { value:-18, originalValue:18, correctedBy:'RT' });

    // volta online; a nuvem ainda tem a versão VELHA (a fila não subiu)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => ok([{ id:'r1', tenant_id:'casadoce', value:18, created_at:criadoEm, user_name:'Ana' }])));
    const lista = await supabaseRepository.list({ tenantId:'casadoce', days:90 });
    expect(lista[0].value).toBe(-18);            // ✅ a correção sobreviveu
    expect(lista[0].correctedBy).toBe('RT');
  });
});
