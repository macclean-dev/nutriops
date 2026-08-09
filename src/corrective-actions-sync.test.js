import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ls, getOfflineQueue, clearOfflineQueue, saveSupabaseConfig,
  pushCorrectiveAction, syncCorrectiveActions, pushSpecialControl,
} from './repository';

// Ações corretivas + higienização das mãos viviam só no localStorage até
// 09/08 (achado da revisão de produto) — limpar o device apagava evidência
// de correção de desvio, exigência da RDC 216.

const okJson = (body) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });

beforeEach(() => { localStorage.clear(); clearOfflineQueue(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('pushCorrectiveAction', () => {
  const acaoTemperatura = {
    id: 'a1', tenantId: 'swiss', recordId: 'rec1', equipment: 'Freezer', temperature: 38,
    deviation: 'danger', description: 'Fora da faixa', responsible: 'Fran', deadline: '2026-08-10',
    status: 'aberta', resolution: '', createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z',
  };

  it('offline: enfileira já no formato genérico (source/sourceId), derivado do formato legado', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await pushCorrectiveAction('swiss', acaoTemperatura);
    const [item] = getOfflineQueue();
    expect(item.table).toBe('corrective_actions');
    expect(item.payload).toMatchObject({
      tenant_id: 'swiss', source: 'temperature', source_id: 'rec1',
      source_label: 'Freezer', source_detail: '38°C', description: 'Fora da faixa',
    });
  });

  it('ação já no formato novo (source explícito) é respeitada, não sobrescrita pelo fallback legado', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const acaoForm = {
      id: 'a2', tenantId: 'swiss', source: 'form', sourceId: 'rec9',
      sourceLabel: 'Higienização — Padaria', sourceDetail: 'Piso rachado',
      description: 'Piso rachado', status: 'aberta', createdAt: '2026-08-09T10:00:00.000Z',
    };
    await pushCorrectiveAction('swiss', acaoForm);
    const [item] = getOfflineQueue();
    expect(item.payload).toMatchObject({ source: 'form', source_id: 'rec9', source_label: 'Higienização — Padaria' });
  });

  it('online: upsert (merge-duplicates) — uma ação pode ser enviada de novo ao mudar de status', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const fetchMock = vi.fn(() => okJson(null));
    vi.stubGlobal('fetch', fetchMock);

    await pushCorrectiveAction('swiss', acaoTemperatura);

    expect(getOfflineQueue()).toHaveLength(0);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/v1/corrective_actions');
    expect(opts.headers.Prefer).toContain('merge-duplicates');
  });

  it('falha no POST online: cai pra fila em vez de perder a correção', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') })));

    await pushCorrectiveAction('swiss', acaoTemperatura);
    expect(getOfflineQueue()).toHaveLength(1);
  });
});

describe('syncCorrectiveActions', () => {
  it('puxa da nuvem e converte de volta pro formato local (source/sourceId)', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([{
      id: 'a1', tenant_id: 'swiss', source: 'receiving', source_id: 'r1',
      source_label: 'Recebimento — Fornecedor X', source_detail: 'Motivo: embalagem violada',
      description: 'Embalagem violada', responsible: 'Fran', deadline: '2026-08-10',
      status: 'aberta', resolution: null, created_at: '2026-08-09T10:00:00.000Z', updated_at: '2026-08-09T10:00:00.000Z', closed_at: null,
    }])));

    await syncCorrectiveActions('swiss');
    const local = ls('nutriops.corrective_actions.swiss', []);
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ source: 'receiving', sourceId: 'r1', sourceLabel: 'Recebimento — Fornecedor X' });
  });
});

describe('pushSpecialControl("handwash", ...) — reaproveita special_controls', () => {
  it('grava na MESMA chave que HandwashView lê (nutriops.handwash.{id})', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const record = { id: 'h1', tenantId: 'swiss', operator: 'Fran', moment: 'Início das atividades', result: 'conforme', createdAt: '2026-08-09T10:00:00.000Z' };
    await pushSpecialControl('handwash', 'swiss', record);
    expect(ls('nutriops.handwash.swiss', [])).toHaveLength(1);
    const [item] = getOfflineQueue();
    expect(item.table).toBe('special_controls');
    expect(item.payload.control_type).toBe('handwash');
  });
});
