import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { podarCacheTemperaturas, idsPendentes, ORCAMENTO_CARACTERES } from './cache-temperaturas';
import {
  ls, lw, saveSupabaseConfig, clearOfflineQueue, supabaseRepository,
  getStorageFull, STORAGE_FULL_KEY,
} from './repository';

// Faixa vermelha no Safari do dono em 16/09, 20:14: "O armazenamento deste
// aparelho está cheio". Medido na nuvem no mesmo dia: a leitura de temperatura
// tem ~540 caracteres (CASA DOCE: 2652 leituras = 1443 KB), não os ~300 da
// conta que justificou o teto de 5000. 5000 x 540 = 2,7 milhões de caracteres,
// ~5,4 MB no Safari (2 bytes por caractere). O teto sozinho estourava o site.

vi.mock('./auth', () => ({ getValidAccessToken: async () => 'jwt-de-teste' }));

const RECORDS_KEY = 'nutriops.temperature.records';
const minutosAtras = (n) => new Date(Date.now() - n * 60000).toISOString();

// Leitura com os campos de tempFromRow (repository.js) e o TAMANHO de produção.
const leitura = (i, extra = {}) => ({
  id: `3f6c2a1e-8b4d-4c2a-9e1f-${String(i).padStart(12, '0')}`, createdAt: minutosAtras(i),
  tenantId: 'bf245c3b-2f9a-4c1e-9a55-3c1f0e2d7b10', tenantName: 'CASA DOCE',
  equipmentInput: 'R.10 Refrigerador Gelateria', equipmentKey: 'R.10 Refrigerador Gelateria',
  equipmentLocation: 'Gelateria', measuredAt: minutosAtras(i),
  value: 4.2, min: 0, max: 5, note: null,
  user: 'RAIANE DOS SANTOS', role: 'Colaborador', controlMode: 'turno',
  observationInterval: null, equipment: 'R.10 Refrigerador Gelateria',
  originalValue: null, correctionReason: null, correctedBy: null, correctedAt: null,
  ...extra,
});
const tamanhoDe = (lista) => JSON.stringify(lista).length;

describe('podarCacheTemperaturas', () => {
  it('a leitura de teste tem o tamanho de produção (~540 caracteres)', () => {
    const t = JSON.stringify(leitura(1)).length;
    expect(t).toBeGreaterThan(450);
    expect(t).toBeLessThan(650);
  });

  it('5000 leituras reais NÃO cabem mais inteiras: o cache fica dentro do orçamento', () => {
    const lista = Array.from({ length: 5000 }, (_, i) => leitura(i));
    expect(tamanhoDe(lista)).toBeGreaterThan(2_000_000);   // era isto que ia pro Safari
    const podada = podarCacheTemperaturas(lista);
    expect(tamanhoDe(podada)).toBeLessThanOrEqual(ORCAMENTO_CARACTERES + podada.length + 2);
    expect(podada.length).toBeGreaterThan(1000);           // ainda cobre ~2 semanas de todas as lojas
  });

  it('fica com as MAIS RECENTES e larga as mais antigas', () => {
    const lista = Array.from({ length: 3000 }, (_, i) => leitura(i));   // i=0 é a mais nova
    const podada = podarCacheTemperaturas(lista);
    expect(podada[0].id).toBe(lista[0].id);
    expect(podada.map((r) => r.id)).toEqual(lista.slice(0, podada.length).map((r) => r.id));
  });

  it('leitura ainda na fila NUNCA sai, mesmo sendo a mais antiga de todas', () => {
    const lista = Array.from({ length: 3000 }, (_, i) => leitura(i));
    const antiga = lista[2999].id;
    const podada = podarCacheTemperaturas(lista, { pendentes: new Set([antiga]) });
    expect(podada.some((r) => r.id === antiga)).toBe(true);
    // sem a proteção, ela seria a primeira a cair
    expect(podarCacheTemperaturas(lista).some((r) => r.id === antiga)).toBe(false);
  });

  it('lista pequena passa inteira', () => {
    const lista = Array.from({ length: 50 }, (_, i) => leitura(i));
    expect(podarCacheTemperaturas(lista)).toHaveLength(50);
  });

  it('idsPendentes só pega temperatura', () => {
    const fila = [
      { table: 'temperature_records', payload: { id: 'a' } },
      { table: 'form_records', payload: { id: 'b' } },
      { table: 'temperature_records', payload: {} },
    ];
    expect([...idsPendentes(fila)]).toEqual(['a']);
    expect(idsPendentes(null).size).toBe(0);
  });
});

describe('no repositório de verdade', () => {
  beforeEach(() => {
    localStorage.clear(); clearOfflineQueue();
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    localStorage.setItem('nutriops.session', JSON.stringify(
      { tenantId: 'casadoce', accessToken: 'jwt-de-teste', user: { id: 'uid-de-teste' } }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('um aparelho com o cache cheio fica dentro do orçamento no próximo carregamento, e a tela continua recebendo tudo', async () => {
    lw(RECORDS_KEY, Array.from({ length: 5000 }, (_, i) => leitura(i + 100)));
    const remoto = Array.from({ length: 20 }, (_, i) => ({
      id: `nova-${i}`, tenant_id: 'casadoce', value: 3, created_at: minutosAtras(i),
    }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(remoto)) })));

    const tela = await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });
    expect(tela.filter((r) => r.id.startsWith('nova-'))).toHaveLength(20);

    const cache = ls(RECORDS_KEY, []);
    expect(localStorage.getItem(RECORDS_KEY).length).toBeLessThanOrEqual(ORCAMENTO_CARACTERES + cache.length + 2);
    expect(cache.filter((r) => r.id.startsWith('nova-'))).toHaveLength(20);   // as novas nunca caem
  });

  it('a faixa vermelha some sozinha quando a chave que falhou volta a gravar', () => {
    localStorage.setItem(STORAGE_FULL_KEY, JSON.stringify({ chave: RECORDS_KEY, at: '2026-09-16T23:14:58Z' }));
    expect(getStorageFull()).not.toBeNull();
    lw('outra.chave', [1]);                 // outra chave gravar não prova nada
    expect(getStorageFull()).not.toBeNull();
    lw(RECORDS_KEY, [leitura(1)]);          // a mesma chave gravou: tem espaço
    expect(getStorageFull()).toBeNull();
  });
});
