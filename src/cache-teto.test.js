import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos achados não-julgados da auditoria (19/08). Estes quatro
// vieram de achados que o limite de uso impediu de verificar — foram
// confirmados lendo o código, não por agente.
// ─────────────────────────────────────────────────────────────────────────────
describe('ramo "Todos" — o irmão que a v1.9.151 esqueceu', () => {
  const pagina = (n, tenant='casadoce') => Array.from({length:n},(_,i)=>({
    id:`${tenant}-${i}`, tenant_id:tenant, value:3, created_at:new Date(Date.now()-i*60000).toISOString(),
  }));

  it('não decapita o cache das OUTRAS lojas', async () => {
    // 3000 registros de outras lojas já no cache
    lw(RECORDS_KEY, Array.from({length:3000},(_,i)=>({
      id:`swiss-${i}`, tenantId:'swiss', value:2, createdAt:new Date(Date.now()-i*60000).toISOString(),
    })));
    vi.stubGlobal('fetch', vi.fn(() => ok(pagina(700))));
    await supabaseRepository.list({ tenantId:'casadoce', days:0 });   // "Todos" na CASA DOCE
    const cache = ls(RECORDS_KEY, []);
    expect(cache.filter(r => r.tenantId === 'swiss').length).toBe(3000);  // ✅ intactos
  });

  it('o teto do cache NÃO vira teto de exibição', async () => {
    // loja com mais registros que o teto do cache
    // ids únicos POR PÁGINA — com ids repetidos o mergeByKey dedupa tudo em
    // 1000 e o teste mede a própria fixture, não o código.
    let chamada = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      const p = chamada++;
      if (p >= 6) return ok([]);
      return ok(Array.from({length:1000},(_,i)=>({
        id:`casadoce-p${p}-${i}`, tenant_id:'casadoce', value:3,
        created_at:new Date(Date.now()-(p*1000+i)*60000).toISOString(),
      })));
    }));
    const lista = await supabaseRepository.list({ tenantId:'casadoce', days:0 });
    expect(lista.length).toBeGreaterThan(5000);   // ✅ a tela recebe tudo
    expect(ls(RECORDS_KEY, []).length).toBeLessThanOrEqual(5000);  // ✅ o cache fica capado
  });

  it('"Todos" nunca devolve menos que "90 dias"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok(pagina(300))));
    const todos = await supabaseRepository.list({ tenantId:'casadoce', days:0 });
    vi.stubGlobal('fetch', vi.fn(() => ok(pagina(300))));
    const noventa = await supabaseRepository.list({ tenantId:'casadoce', days:90 });
    expect(todos.length).toBeGreaterThanOrEqual(noventa.length);
  });
});

describe('form_records — a segunda chave única', () => {
  it('o upsert aponta pro alvo composto, senão dá 409 eterno', () => {
    const fonte = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(fonte).toContain("filter:'on_conflict=tenant_id,form_id,period_key'");
  });

  it('a tabela realmente tem as duas chaves — é o que torna o on_conflict obrigatório', () => {
    const fonte = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(fonte).toContain('constraint form_records_pkey2 unique(tenant_id, form_id, period_key)');
  });
});

describe('perfil do estabelecimento — salvar não pode apagar o que o sync trouxe', () => {
  it('mescla sobre o que está gravado agora, não sobre o retrato da montagem', () => {
    const fonte = readFileSync(`${process.cwd()}/src/settings.jsx`, 'utf8');
    expect(fonte).toContain('const atual = readCompanyProfile(id);');
    expect(fonte).toContain('const mesclado = { ...atual, ...profile };');
    expect(fonte).not.toContain('pushCompanyProfile(id, profile);');
  });
});

describe('manutenção — converter ativo virtual religa o histórico', () => {
  it('remapeia execuções e ordens do id sintético pro uuid novo', () => {
    const fonte = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');
    expect(fonte).toContain("const idAntigo = editEquip?._fromCatalog ? editEquip.id : null;");
    expect(fonte).toContain('l.equipmentId === idAntigo ? { ...l, equipmentId: eq.id } : l');
    expect(fonte).toContain('o.equipmentId === idAntigo ? { ...o, equipmentId: eq.id } : o');
  });
});
