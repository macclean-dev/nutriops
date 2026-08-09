import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOfflineQueue, clearOfflineQueue, saveSupabaseConfig,
  pushValidityRules, syncValidityRules,
} from './repository';
import { readOpenRules, readRulesUpdatedAt, writeOpenRules } from './validity-rules';

// Sync das regras de validade (etiquetas) — item pedido pelo dono em 09/08 ao
// descobrir que a nutricionista, trabalhando de casa, não conseguiria fazer a
// mudança chegar no tablet que imprime na produção (localStorage é por
// device). A nuvem passa a ser a fonte de verdade; "mais novo vence" via
// updated_at, pra não perder uma edição feita offline em outro device.

const okJson = (body) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });

beforeEach(() => { localStorage.clear(); clearOfflineQueue(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('pushValidityRules', () => {
  it('offline: grava local (com carimbo) e enfileira a linha certa', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const rules = { carnes: { amount: 48, unit: 'h' }, secos: { amount: 30, unit: 'd' } };
    await pushValidityRules('swiss', rules);

    expect(readOpenRules('swiss').carnes).toEqual({ amount: 48, unit: 'h' });
    expect(readRulesUpdatedAt('swiss')).toBeTruthy();

    const [item] = getOfflineQueue();
    expect(item.table).toBe('validity_rules');
    expect(item.operation).toBe('upsert');
    expect(item.payload.tenant_id).toBe('swiss');
    expect(item.payload.rules).toEqual(rules);
    expect(item.payload.updated_at).toBe(readRulesUpdatedAt('swiss'));
  });

  it('online: manda pro Supabase com upsert (merge-duplicates) e não enfileira', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const fetchMock = vi.fn(() => okJson(null));
    vi.stubGlobal('fetch', fetchMock);

    await pushValidityRules('swiss', { outros: { amount: 3, unit: 'd' } });

    expect(getOfflineQueue()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/v1/validity_rules');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Prefer).toContain('merge-duplicates');
    expect(JSON.parse(opts.body)).toMatchObject({ tenant_id: 'swiss', rules: { outros: { amount: 3, unit: 'd' } } });
  });

  it('online mas o POST falha: cai pra fila em vez de perder o ajuste', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') })));

    await pushValidityRules('swiss', { outros: { amount: 3, unit: 'd' } });

    expect(getOfflineQueue()).toHaveLength(1);
    expect(getOfflineQueue()[0].table).toBe('validity_rules');
  });
});

describe('syncValidityRules', () => {
  it('sem nada local ainda: aplica o que vier da nuvem', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([{
      tenant_id: 'swiss', rules: { carnes: { amount: 24, unit: 'h' } }, updated_at: '2026-08-09T10:00:00.000Z',
    }])));

    const r = await syncValidityRules('swiss');
    expect(r).toEqual({ ok: true, applied: true });
    expect(readOpenRules('swiss').carnes).toEqual({ amount: 24, unit: 'h' });
  });

  it('remoto mais novo que o local: nuvem vence (o cenário pedido — RT ajustou de casa)', async () => {
    writeOpenRules('swiss', { carnes: { amount: 48, unit: 'h' } }, '2026-08-09T08:00:00.000Z');
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([{
      tenant_id: 'swiss', rules: { carnes: { amount: 24, unit: 'h' } }, updated_at: '2026-08-09T12:00:00.000Z',
    }])));

    const r = await syncValidityRules('swiss');
    expect(r.applied).toBe(true);
    expect(readOpenRules('swiss').carnes).toEqual({ amount: 24, unit: 'h' });
  });

  it('local mais novo que o remoto: NÃO sobrescreve (protege edição offline não sincronizada)', async () => {
    writeOpenRules('swiss', { carnes: { amount: 12, unit: 'h' } }, '2026-08-09T15:00:00.000Z');
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([{
      tenant_id: 'swiss', rules: { carnes: { amount: 48, unit: 'h' } }, updated_at: '2026-08-09T10:00:00.000Z',
    }])));

    const r = await syncValidityRules('swiss');
    expect(r.applied).toBe(false);
    expect(readOpenRules('swiss').carnes).toEqual({ amount: 12, unit: 'h' }); // local preservado
  });

  it('nuvem sem nenhuma linha ainda pro tenant: não mexe no local', async () => {
    writeOpenRules('swiss', { carnes: { amount: 12, unit: 'h' } });
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));

    const r = await syncValidityRules('swiss');
    expect(r).toEqual({ ok: true, applied: false });
    expect(readOpenRules('swiss').carnes).toEqual({ amount: 12, unit: 'h' });
  });

  it('offline: não tenta e avisa o motivo', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const r = await syncValidityRules('swiss');
    expect(r).toEqual({ ok: false, reason: 'offline_or_disabled' });
  });

  // Regressão: React StrictMode roda o efeito de montagem 2x (mount → cleanup
  // → mount) — descoberto ao testar no browser, a UI ficava travada no valor
  // de fábrica mesmo com a nuvem já sincronizada no localStorage. A causa era
  // o componente só atualizar o estado quando A PRÓPRIA chamada dizia
  // `applied:true`; a chamada que sobrevive pode terminar depois da outra já
  // ter escrito, e aí recebe `applied:false` mesmo com o valor certo pronto
  // pra ler. A garantia que protege isso: não importa a ordem de chegada,
  // depois que AMBAS as chamadas concorrentes terminam, o local reflete a
  // nuvem — component-side, o fix é reler local sempre, sem checar `applied`.
  it('duas chamadas concorrentes pro mesmo tenant: ao final das duas, o local reflete a nuvem', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([{
      tenant_id: 'swiss', rules: { carnes: { amount: 12, unit: 'h' } }, updated_at: '2026-08-09T13:26:42.029Z',
    }])));

    const [r1, r2] = await Promise.all([syncValidityRules('swiss'), syncValidityRules('swiss')]);

    expect([r1.applied, r2.applied]).toContain(true); // uma das duas aplicou
    expect(readOpenRules('swiss').carnes).toEqual({ amount: 12, unit: 'h' });
  });
});
