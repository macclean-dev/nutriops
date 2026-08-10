import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localRepository, supabaseRepository, saveSupabaseConfig, lw } from './repository';

const RECORDS_KEY = 'nutriops.temperature.records';

beforeEach(() => {
  localStorage.clear();
  saveSupabaseConfig({ url: 'https://fake.supabase.co', anonKey: 'anon-fake', enabled: true });
});

describe('localRepository.list', () => {
  const now = Date.now();
  const DAY = 86400000;

  it('days>0 filtra por tenant e por corte de data', () => {
    lw(RECORDS_KEY, [
      { id: 'a', tenantId: 'swiss', createdAt: new Date(now - 5 * DAY).toISOString() },
      { id: 'b', tenantId: 'swiss', createdAt: new Date(now - 100 * DAY).toISOString() },
      { id: 'c', tenantId: 'outra', createdAt: new Date(now - 1 * DAY).toISOString() },
    ]);
    return localRepository.list({ tenantId: 'swiss', days: 90 }).then((rows) => {
      expect(rows.map((r) => r.id)).toEqual(['a']);
    });
  });

  it('days<=0 (item 14, "Todos") não corta por data — devolve tudo do tenant', () => {
    lw(RECORDS_KEY, [
      { id: 'a', tenantId: 'swiss', createdAt: new Date(now - 5 * DAY).toISOString() },
      { id: 'b', tenantId: 'swiss', createdAt: new Date(now - 900 * DAY).toISOString() },
      { id: 'c', tenantId: 'outra', createdAt: new Date(now - 1 * DAY).toISOString() },
    ]);
    return localRepository.list({ tenantId: 'swiss', days: 0 }).then((rows) => {
      expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
    });
  });
});

describe('supabaseRepository.list — paginação do "Todos" (item 14)', () => {
  function mockFetchPages(pageSizes) {
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      const size = pageSizes[call] ?? 0;
      call += 1;
      const rows = Array.from({ length: size }, (_, i) => ({ id: `r${call}-${i}`, tenant_id: 'swiss', created_at: new Date().toISOString() }));
      return { ok: true, text: async () => JSON.stringify(rows) };
    });
    return () => call;
  }

  it('days>0 faz UMA chamada só, com filtro de data e sem offset', async () => {
    const getCalls = mockFetchPages([3]);
    await supabaseRepository.list({ tenantId: 'swiss', days: 90 });
    expect(getCalls()).toBe(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('created_at=gte.');
    expect(url).not.toContain('offset=');
  });

  it('days<=0 com uma página incompleta para na primeira chamada', async () => {
    const getCalls = mockFetchPages([250]);
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 0 });
    expect(getCalls()).toBe(1);
    expect(rows).toHaveLength(250);
    expect(global.fetch.mock.calls[0][0]).not.toContain('created_at=gte.');
  });

  it('days<=0 pagina até a página vir incompleta, concatenando tudo', async () => {
    const getCalls = mockFetchPages([1000, 1000, 400]);
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 0 });
    expect(getCalls()).toBe(3);
    expect(rows).toHaveLength(2400);
    const offsets = global.fetch.mock.calls.map((c) => new URL(c[0]).searchParams.get('offset'));
    expect(offsets).toEqual(['0', '1000', '2000']);
  });

  it('days<=0 respeita o teto de segurança de páginas mesmo se todas vierem cheias', async () => {
    const getCalls = mockFetchPages(Array(30).fill(1000));
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 0 });
    expect(getCalls()).toBe(20); // MAX_PAGES
    expect(rows).toHaveLength(20000);
  });
});
