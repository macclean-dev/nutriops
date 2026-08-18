import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ls, lw, saveSupabaseConfig, clearOfflineQueue, supabaseRepository } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// CASA DOCE, 18/08: "cobertura 4% — 6 de 138 leituras esperadas", com a equipe
// registrando normalmente o dia todo. E cada aparelho mostrava um número
// diferente (uma pessoa via 3, o admin via 6).
//
// CAUSA: o cache local é uma lista GLOBAL (todas as lojas juntas) com teto.
// `mergeByKey` devolve na ordem de INSERÇÃO — local primeiro, remoto anexado no
// fim — e o corte era feito nessa ordem crua. Cheio o cache, toda leitura nova
// vinda da nuvem entrava no fim e era decepada pelo slice. Para sempre.
//
// As poucas que sobreviviam eram as criadas NO PRÓPRIO aparelho: cacheTempLocal
// faz [record, ...current], que prependa. Por isso "última atividade há 2 min"
// funcionava enquanto o total do dia ficava em 6 — e por isso cada device tinha
// um número diferente, cada um com um histórico de cortes diferente.
// ─────────────────────────────────────────────────────────────────────────────

const RECORDS_KEY = 'nutriops.temperature.records';
const ok = (body) => Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(body)) });
const diasAtras = (n) => new Date(Date.now() - n*86400000).toISOString();

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  saveSupabaseConfig({ url:'https://x.test', anonKey:'a', enabled:true });
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const encherCache = (n, tenantId='casadoce') => lw(RECORDS_KEY,
  Array.from({length:n}, (_,i) => ({ id:`velho-${i}`, tenantId, value:4, createdAt: diasAtras(30) })));

describe('leitura do dia não pode ser decepada pelo teto do cache', () => {
  it('cache lotado de registros antigos: a leitura de HOJE ainda aparece', async () => {
    encherCache(5000);
    const hoje = new Date().toISOString();
    vi.stubGlobal('fetch', vi.fn(() => ok([{ id:'hoje-1', tenant_id:'casadoce', value:3.4, created_at:hoje }])));

    const lista = await supabaseRepository.list({ tenantId:'casadoce', days:90 });
    expect(lista.some(r => r.id === 'hoje-1')).toBe(true);   // ✅ era false antes
  });

  it('o que é cortado são os MAIS ANTIGOS, não os mais novos', async () => {
    encherCache(5000);
    const hoje = new Date().toISOString();
    vi.stubGlobal('fetch', vi.fn(() => ok([{ id:'hoje-1', tenant_id:'casadoce', value:3.4, created_at:hoje }])));
    await supabaseRepository.list({ tenantId:'casadoce', days:90 });

    const cache = ls(RECORDS_KEY, []);
    expect(cache[0].id).toBe('hoje-1');          // mais recente na frente
    expect(cache.length).toBeLessThanOrEqual(5000);
  });

  it('um dia inteiro da CASA DOCE (60 leituras) entra de uma vez', async () => {
    encherCache(5000);
    const hoje = new Date().toISOString();
    const doDia = Array.from({length:60}, (_,i) => ({ id:`hoje-${i}`, tenant_id:'casadoce', value:3, created_at:hoje }));
    vi.stubGlobal('fetch', vi.fn(() => ok(doDia)));

    const lista = await supabaseRepository.list({ tenantId:'casadoce', days:90 });
    const hojeNaLista = lista.filter(r => r.id.startsWith('hoje-')).length;
    expect(hojeNaLista).toBe(60);
  });

  it('o teto comporta as 4 lojas somadas sem uma expulsar a outra', async () => {
    const hoje = new Date().toISOString();
    for (const loja of ['casadoce','swiss','backerei','dbk']) {
      vi.stubGlobal('fetch', vi.fn(() => ok(
        Array.from({length:60}, (_,i) => ({ id:`${loja}-${i}`, tenant_id:loja, value:3, created_at:hoje })))));
      await supabaseRepository.list({ tenantId:loja, days:90 });
    }
    const cache = ls(RECORDS_KEY, []);
    for (const loja of ['casadoce','swiss','backerei','dbk']) {
      expect(cache.filter(r => r.tenantId === loja)).toHaveLength(60);
    }
  });
});

describe('o que já funcionava não pode regredir', () => {
  it('isolamento por loja continua valendo', async () => {
    const hoje = new Date().toISOString();
    lw(RECORDS_KEY, [{ id:'alheio', tenantId:'swiss', createdAt:hoje }]);
    vi.stubGlobal('fetch', vi.fn(() => ok([{ id:'meu', tenant_id:'casadoce', created_at:hoje }])));
    const lista = await supabaseRepository.list({ tenantId:'casadoce', days:90 });
    expect(lista.map(r => r.id)).toEqual(['meu']);
  });

  it('corte de 90 dias continua valendo', async () => {
    lw(RECORDS_KEY, [{ id:'velho', tenantId:'casadoce', createdAt: diasAtras(200) }]);
    vi.stubGlobal('fetch', vi.fn(() => ok([])));
    expect(await supabaseRepository.list({ tenantId:'casadoce', days:90 })).toHaveLength(0);
  });

  it('registro pendente (criado aqui, ainda não subiu) segue visível', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok:false, status:401, text:()=>Promise.resolve('{}') })));
    await supabaseRepository.create({ id:'pend', tenantId:'casadoce', equipmentInput:'F.2', value:-18, createdAt:new Date().toISOString() });
    vi.stubGlobal('fetch', vi.fn(() => ok([])));
    const lista = await supabaseRepository.list({ tenantId:'casadoce', days:90 });
    expect(lista.some(r => r.id === 'pend')).toBe(true);
  });

  it('falha da nuvem continua caindo no cache em vez de zerar a tela', async () => {
    lw(RECORDS_KEY, [{ id:'a', tenantId:'casadoce', createdAt:new Date().toISOString() }]);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    expect(await supabaseRepository.list({ tenantId:'casadoce', days:90 })).toHaveLength(1);
  });
});
