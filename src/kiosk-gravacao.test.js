import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ls, lw, getOfflineQueue, clearOfflineQueue, saveSupabaseConfig,
  supabaseRepository, localRepository, purgarFilaEnvenenada,
} from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Incidente CASA DOCE (17/08): "o NutriOPS só registra a temperatura pela tela
// inicial; pelo Quiosque não registra". A investigação achou TRÊS defeitos
// distintos que produzem esse relato. Estes testes travam os dois que vivem no
// repositório; o do teclado (✓ mudo) está em kiosk.jsx e é de UI.
// ─────────────────────────────────────────────────────────────────────────────

const RECORDS_KEY = 'nutriops.temperature.records';
const okJson = (body) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const nega = (status, body) => Promise.resolve({ ok: false, status, text: () => Promise.resolve(JSON.stringify(body)) });

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ─── 1. O registro pendente PRECISA aparecer na tela ────────────────────────
// list() gravava local+nuvem no cache e devolvia SÓ a nuvem. O registro que
// falhou no POST ficava salvo e enfileirado, mas invisível — a leitura "sumia"
// e só voltava depois de sair e entrar (quando a fila subia).
describe('supabaseRepository.list — mostra o que ainda não subiu', () => {
  const leitura = (over = {}) => ({
    id: 'r1', tenantId: 'casadoce', equipmentInput: 'Bancada congelada — F.2',
    value: -11, min: -18, max: -12, user: 'Maria',
    createdAt: new Date().toISOString(), ...over,
  });

  it('POST falha ⇒ a leitura fica salva, enfileirada E VISÍVEL na lista', async () => {
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { message: 'JWT expired' })));
    const criado = await supabaseRepository.create(leitura());
    expect(criado._pending).toBe(true);
    expect(ls(RECORDS_KEY, [])).toHaveLength(1);      // salva
    expect(getOfflineQueue()).toHaveLength(1);         // enfileirada

    vi.stubGlobal('fetch', vi.fn(() => okJson([])));   // nuvem ainda vazia
    const lista = await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });
    expect(lista).toHaveLength(1);                     // ✅ APARECE
    expect(lista[0].id).toBe('r1');
  });

  it('não vaza registro de OUTRA loja pro cache global da tela', async () => {
    lw(RECORDS_KEY, [
      { id: 'meu',   tenantId: 'casadoce', createdAt: new Date().toISOString() },
      { id: 'alheio', tenantId: 'swiss',   createdAt: new Date().toISOString() },
    ]);
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));
    const lista = await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });
    expect(lista.map((r) => r.id)).toEqual(['meu']);   // ✅ isolamento mantido
  });

  it('respeita o corte de 90 dias — não traz histórico antigo do cache', async () => {
    const velho = new Date(Date.now() - 200 * 86400000).toISOString();
    lw(RECORDS_KEY, [
      { id: 'novo',  tenantId: 'casadoce', createdAt: new Date().toISOString() },
      { id: 'velho', tenantId: 'casadoce', createdAt: velho },
    ]);
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));
    const lista = await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });
    expect(lista.map((r) => r.id)).toEqual(['novo']);
  });

  it('não duplica quando o mesmo registro está no cache E na nuvem', async () => {
    const agora = new Date().toISOString();
    lw(RECORDS_KEY, [{ id: 'r1', tenantId: 'casadoce', value: -11, createdAt: agora }]);
    vi.stubGlobal('fetch', vi.fn(() => okJson([
      { id: 'r1', tenant_id: 'casadoce', value: -11, created_at: agora },
    ])));
    const lista = await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });
    expect(lista).toHaveLength(1);
  });
});

// ─── 2. A fila não pode guardar o que nunca vai subir ───────────────────────
// O quiosque aceitava '-' sozinho, gravava NaN → value:null → o Postgres
// recusava com 23502 em TODA tentativa. O item girava na fila pra sempre.
describe('purgarFilaEnvenenada', () => {
  const item = (value) => ({ table: 'temperature_records', operation: 'upsert', payload: { id: 'x', tenant_id: 'casadoce', value } });

  it('descarta temperatura sem valor numérico — nunca subiria', () => {
    const out = purgarFilaEnvenenada([item(null), item(-11)]);
    expect(out).toHaveLength(1);
    expect(out[0].payload.value).toBe(-11);
  });

  it('descarta também NaN e string não-numérica', () => {
    expect(purgarFilaEnvenenada([item(NaN), item('abc'), item(undefined)])).toHaveLength(0);
  });

  it('valor 0 é legítimo (câmara a 0°C) — NÃO descarta', () => {
    expect(purgarFilaEnvenenada([item(0)])).toHaveLength(1);
  });

  it('não toca em item de OUTRA tabela, mesmo sem campo value', () => {
    const outra = { table: 'form_records', operation: 'upsert', payload: { id: 'f1', tenant_id: 'casadoce' } };
    expect(purgarFilaEnvenenada([outra])).toHaveLength(1);
  });

  it('fila limpa passa intacta e não reescreve o storage à toa', () => {
    const fila = [item(-11), item(5)];
    expect(purgarFilaEnvenenada(fila)).toEqual(fila);
  });

  it('não quebra com fila vazia ou indefinida', () => {
    expect(purgarFilaEnvenenada([])).toEqual([]);
    expect(purgarFilaEnvenenada(undefined)).toEqual([]);
  });
});

// ─── 3. O round-trip completo, que é o que a nutricionista viveu ────────────
describe('cenário real: tablet sem sync, leitura crítica no quiosque', () => {
  it('a leitura aparece na hora e sobe sozinha quando o sync volta', async () => {
    // Tablet com 401: o POST falha
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { code: '42501' })));
    await supabaseRepository.create({
      id: 'r-critica', tenantId: 'casadoce', equipmentInput: 'Bancada congelada — F.2',
      value: -3, min: -22, max: -18, user: 'Maria', note: 'Bancada não estava gelando',
      createdAt: new Date().toISOString(),
    });

    // ANTES do sync: a pessoa PRECISA ver a leitura dela
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));
    expect(await supabaseRepository.list({ tenantId: 'casadoce', days: 90 })).toHaveLength(1);

    // Sync volta: a fila sobe
    vi.stubGlobal('fetch', vi.fn(() => okJson(null)));
    const r = await supabaseRepository.syncQueue();
    expect(r.synced).toBe(1);
    expect(getOfflineQueue()).toHaveLength(0);
  });
});
