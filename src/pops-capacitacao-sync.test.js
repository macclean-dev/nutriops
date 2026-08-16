import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ls, getOfflineQueue, clearOfflineQueue, saveSupabaseConfig,
  pushPOP, deletePOPCloud, syncPOPs,
  pushTrainingSession, syncTrainingSessions,
  pushTrainingConfig, syncTrainingConfig,
  pushRtValidation, syncRtValidations,
} from './repository';

// Fatia 3 da Prontidão (15/08): POPs, capacitação e validações da RT viviam
// só no localStorage — um wipe apagava os comprovantes da rede inteira
// (auditoria RDC §2/§3.5). Mesma classe de bug da Central de NC.

const okJson = (body) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const online = () => {
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
};

beforeEach(() => { localStorage.clear(); clearOfflineQueue(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('pushPOP / deletePOPCloud', () => {
  const pop = {
    id: 'p1', title: 'Higienização de bancadas', category: 'limpeza',
    objective: 'Evitar contaminação cruzada', steps: ['Retirar resíduos', 'Aplicar detergente'],
    materials: 'Detergente neutro', frequency: 'Diário', responsible: 'Toda a equipe',
    createdAt: '2026-08-15T10:00:00.000Z', updatedAt: '2026-08-15T10:00:00.000Z',
  };

  it('offline: enfileira upsert com o objeto INTEIRO em data (padrão special_controls)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await pushPOP('swiss', pop);
    const [item] = getOfflineQueue();
    expect(item.table).toBe('pops');
    expect(item.payload).toMatchObject({ id: 'p1', tenant_id: 'swiss', title: 'Higienização de bancadas', category: 'limpeza' });
    expect(item.payload.data.steps).toEqual(['Retirar resíduos', 'Aplicar detergente']);
  });

  it('online: upsert (merge-duplicates) — editar um POP reenvia sem duplicar', async () => {
    online();
    const fetchMock = vi.fn(() => okJson(null));
    vi.stubGlobal('fetch', fetchMock);
    await pushPOP('swiss', pop);
    expect(getOfflineQueue()).toHaveLength(0);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/v1/pops');
    expect(opts.headers.Prefer).toContain('merge-duplicates');
  });

  it('delete offline NÃO enfileira — a fila replayaria como upsert e ressuscitaria o POP', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const out = await deletePOPCloud('swiss', 'p1');
    expect(out.ok).toBe(false);
    expect(getOfflineQueue()).toHaveLength(0);
  });

  it('delete online manda DELETE filtrado por tenant E id', async () => {
    online();
    const fetchMock = vi.fn(() => okJson(null));
    vi.stubGlobal('fetch', fetchMock);
    const out = await deletePOPCloud('swiss', 'p1');
    expect(out.ok).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('DELETE');
    expect(url).toContain('tenant_id=eq.swiss');
    expect(url).toContain('id=eq.p1');
  });
});

describe('syncPOPs — nuvem é fonte de verdade (é o que propaga o Remover)', () => {
  it('nuvem com itens SUBSTITUI o local — POP apagado em outro device some daqui', async () => {
    online();
    localStorage.setItem('nutriops.pops.swiss', JSON.stringify([{ id: 'velho', title: 'Apagado lá' }, { id: 'p1', title: 'Fica' }]));
    vi.stubGlobal('fetch', vi.fn(() => okJson([
      { id: 'p1', tenant_id: 'swiss', title: 'Fica', category: 'limpeza', data: { id: 'p1', title: 'Fica', category: 'limpeza' }, created_at: '2026-08-15T10:00:00.000Z', updated_at: '2026-08-15T10:00:00.000Z' },
    ])));
    await syncPOPs('swiss');
    const local = ls('nutriops.pops.swiss', []);
    expect(local).toHaveLength(1);
    expect(local[0].id).toBe('p1');
  });

  it('nuvem VAZIA não apaga o local — loja pré-migração mantém o acervo até o backfill', async () => {
    online();
    localStorage.setItem('nutriops.pops.swiss', JSON.stringify([{ id: 'p1', title: 'Só local ainda' }]));
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));
    await syncPOPs('swiss');
    expect(ls('nutriops.pops.swiss', [])).toHaveLength(1);
  });
});

describe('pushTrainingSession / syncTrainingSessions', () => {
  const sessao = {
    id: 's1', tenantId: 'swiss', status: 'closed', title: 'BPF básico', date: '2026-08-01',
    participants: [{ name: 'Ana', role: 'Colaborador', confirmed: true, confirmedAt: '2026-08-01T15:00:00.000Z' }],
    createdAt: '2026-08-01T14:00:00.000Z', updatedAt: '2026-08-01T15:00:00.000Z',
  };

  it('offline: enfileira com participants preservados dentro de data', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await pushTrainingSession('swiss', sessao);
    const [item] = getOfflineQueue();
    expect(item.table).toBe('training_sessions');
    expect(item.payload).toMatchObject({ id: 's1', tenant_id: 'swiss', status: 'closed', session_date: '2026-08-01' });
    expect(item.payload.data.participants[0]).toMatchObject({ name: 'Ana', confirmed: true });
  });

  it('sync MESCLA (não substitui): sessão criada offline neste device sobrevive ao pull', async () => {
    online();
    localStorage.setItem('nutriops.training.sessions.swiss', JSON.stringify([
      { id: 'local1', status: 'open', title: 'Criada offline', updatedAt: '2026-08-15T09:00:00.000Z' },
    ]));
    vi.stubGlobal('fetch', vi.fn(() => okJson([
      { id: 's1', tenant_id: 'swiss', status: 'closed', session_date: '2026-08-01', data: sessao, created_at: sessao.createdAt, updated_at: sessao.updatedAt },
    ])));
    await syncTrainingSessions('swiss');
    const local = ls('nutriops.training.sessions.swiss', []);
    expect(local).toHaveLength(2);
    expect(local.map((s) => s.id).sort()).toEqual(['local1', 's1']);
  });

  it('edição mais nova na nuvem (presença confirmada em outro device) vence a cópia local', async () => {
    online();
    localStorage.setItem('nutriops.training.sessions.swiss', JSON.stringify([
      { id: 's1', status: 'open', participants: [{ name: 'Ana', confirmed: false }], updatedAt: '2026-08-01T14:00:00.000Z' },
    ]));
    vi.stubGlobal('fetch', vi.fn(() => okJson([
      { id: 's1', tenant_id: 'swiss', status: 'closed', session_date: '2026-08-01', data: sessao, created_at: sessao.createdAt, updated_at: sessao.updatedAt },
    ])));
    await syncTrainingSessions('swiss');
    const [s] = ls('nutriops.training.sessions.swiss', []);
    expect(s.status).toBe('closed');
    expect(s.participants[0].confirmed).toBe(true);
  });
});

describe('pushTrainingConfig / syncTrainingConfig — 1 linha por tenant, carimbo decide', () => {
  it('push grava local COM o mesmo updatedAt que vai pra nuvem', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await pushTrainingConfig('swiss', { validityMonths: 24, crnNumber: '1-999' });
    const local = ls('nutriops.training.config.swiss', null);
    expect(local.validityMonths).toBe(24);
    expect(local.updatedAt).toBeTruthy();
    const [item] = getOfflineQueue();
    expect(item.table).toBe('training_config');
    expect(item.payload).toMatchObject({ tenant_id: 'swiss', validity_months: 24, crn_number: '1-999' });
    expect(item.payload.updated_at).toBe(local.updatedAt);
  });

  it('nuvem mais NOVA sobrescreve o local — device novo herda a validade certa (não os 12 meses de fábrica)', async () => {
    online();
    localStorage.setItem('nutriops.training.config.swiss', JSON.stringify({ validityMonths: 12, crnNumber: '', updatedAt: '2026-08-01T10:00:00.000Z' }));
    vi.stubGlobal('fetch', vi.fn(() => okJson([{ tenant_id: 'swiss', validity_months: 24, crn_number: '1-999', updated_at: '2026-08-10T10:00:00.000Z' }])));
    const out = await syncTrainingConfig('swiss');
    expect(out.applied).toBe(true);
    expect(ls('nutriops.training.config.swiss', null).validityMonths).toBe(24);
  });

  it('nuvem mais VELHA não sobrescreve edição local ainda não sincronizada', async () => {
    online();
    localStorage.setItem('nutriops.training.config.swiss', JSON.stringify({ validityMonths: 6, crnNumber: '', updatedAt: '2026-08-14T10:00:00.000Z' }));
    vi.stubGlobal('fetch', vi.fn(() => okJson([{ tenant_id: 'swiss', validity_months: 24, crn_number: '', updated_at: '2026-08-10T10:00:00.000Z' }])));
    const out = await syncTrainingConfig('swiss');
    expect(out.applied).toBe(false);
    expect(ls('nutriops.training.config.swiss', null).validityMonths).toBe(6);
  });
});

describe('pushRtValidation / syncRtValidations', () => {
  const val = { id: 'v1', tenantId: 'swiss', by: 'Ana Paula', role: 'Nutricionista RT', at: '2026-08-15T12:00:00.000Z', periodFilter: '30', recordCount: 42, note: 'Tudo revisado' };

  it('offline: enfileira insert com tenant_id — era o que faltava pra assinatura valer por loja', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await pushRtValidation('swiss', val);
    const [item] = getOfflineQueue();
    expect(item.table).toBe('rt_validations');
    expect(item.payload).toMatchObject({ id: 'v1', tenant_id: 'swiss', by_name: 'Ana Paula', record_count: 42, period_filter: '30' });
  });

  it('sync mescla na chave global do device sem duplicar por id e ordena mais novo primeiro', async () => {
    online();
    localStorage.setItem('nutriops.rt.validations', JSON.stringify([
      { id: 'v1', tenantId: 'swiss', by: 'Ana Paula', at: '2026-08-15T12:00:00.000Z', recordCount: 42 },
      { id: 'legado', by: 'Fran', at: '2026-08-01T12:00:00.000Z', recordCount: 7 },
    ]));
    vi.stubGlobal('fetch', vi.fn(() => okJson([
      { id: 'v1', tenant_id: 'swiss', by_name: 'Ana Paula', role: 'Nutricionista RT', period_filter: '30', record_count: 42, note: '', created_at: '2026-08-15T12:00:00.000Z' },
      { id: 'v2', tenant_id: 'swiss', by_name: 'Ana Paula', role: 'Nutricionista RT', period_filter: '7', record_count: 12, note: '', created_at: '2026-08-16T12:00:00.000Z' },
    ])));
    await syncRtValidations('swiss');
    const local = ls('nutriops.rt.validations', []);
    expect(local).toHaveLength(3); // v1 (dedup), v2 (novo), legado (preservado)
    expect(local[0].id).toBe('v2'); // mais novo primeiro
    expect(local.some((v) => v.id === 'legado')).toBe(true);
  });
});
