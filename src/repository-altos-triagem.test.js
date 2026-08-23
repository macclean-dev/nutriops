import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ls, lw, getOfflineQueue, clearOfflineQueue, saveSupabaseConfig,
  migrateAllToSupabase, supabaseRepository, syncAllModules,
  getSyncStatus, setSyncStatus, getSupabaseAuthError, clearSupabaseAuthError,
  pushEquipAsset, pushMaintLog,
} from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// 2ª rodada da tier "alta / sem perda de dado" — pool dos 6 achados desta
// categoria que apontam pra src/repository.js (data_achados_pendentes_19-08
// .json, filtro gravidade=='alta' && perdaDeDado==false && arquivo termina em
// repository.js). 1ª rodada foi pages.jsx (commit c8a947e, v1.9.175).
//
// Numeração abaixo = ordem em que os achados saíram do filtro, 1-indexado.
// Dois deles (5 e 6) são a MESMA causa raiz por lentes diferentes
// (readiness-view.jsx vs settings.jsx lendo o mesmo carimbo) — tratados como
// uma família só, igual o resto desta auditoria já faz.
// ─────────────────────────────────────────────────────────────────────────────

const okJson = (body) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const nega = (status, body) => Promise.resolve({
  ok: false, status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});
const falhaDeRede = () => Promise.reject(new TypeError('Failed to fetch'));
const online = () => {
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
};
const offline = () => { vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); };

// repository.js pega o JWT por `await import('./auth')`. Sem este mock não
// existe token no teste e TODA chamada sai como anon — o que, desde 23/08,
// classifica como kind 'anon' e não 'rls'. Os testes abaixo são sobre RLS
// (credencial boa, policy recusando), então precisam do token.
vi.mock('./auth', () => ({ getValidAccessToken: async () => 'jwt-de-teste' }));

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue(); clearSupabaseAuthError();
  // Sessão real (23/08): a classificação passou a distinguir 'anon' (saiu sem
  // credencial) de 'rls' (credencial boa, policy recusando). Sem sessão aqui,
  // toda chamada seria 'anon' e os testes de RLS não exercitariam RLS.
  localStorage.setItem('nutriops.session', JSON.stringify(
    { tenantId: 'casadoce', accessToken: 'jwt-de-teste', user: { id: 'uid-de-teste' } }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// Achado 1/6 — "Migrar registros locais" offline responde "✓ undefined
// registros migrados. Todos os módulos sincronizados" sem enviar nada
// ═══════════════════════════════════════════════════════════════════════════
//
// JÁ CORRIGIDO antes desta sessão: commit 49d2a11 (v1.9.168, tier "média sem
// perda de dado" em repository.js) — mesmo trecho, achado equivalente sob
// outra lente. `migrateAllToSupabase` agora devolve `pushed:0, failed:0`
// explícitos no early-return offline, e settings.jsx (handleMigrate) checa
// `result.ok` ANTES de montar a frase. Cobertura completa já existe em
// repository-medios-triagem.test.js (Família 2). Aqui só a confirmação
// pontual de que este achado específico está fechado.
describe('achado 1/6 — migrateAllToSupabase offline não finge sucesso (JÁ CORRIGIDO)', () => {
  it('early-return offline devolve pushed:0/failed:0 explícitos — nunca undefined', async () => {
    offline();
    const out = await migrateAllToSupabase([{ id: 'swiss' }]);
    expect(out).toEqual({ ok: false, reason: 'offline_or_disabled', pushed: 0, failed: 0 });
    expect(out.pushed).not.toBeUndefined();
    expect(out.failed).not.toBeUndefined();
  });

  it('settings.jsx: handleMigrate checa result.ok antes de montar "✓ N migrados" — não confia em pushed cru', () => {
    const fonte = readFileSync(`${process.cwd()}/src/settings.jsx`, 'utf8');
    expect(fonte).toContain('if (!result.ok) {');
    expect(fonte).toContain('Sem internet no momento — nada foi migrado. Tente de novo quando reconectar.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 2/6 — syncQueue engole o motivo de cada falha e a tela responde
// "0 sincronizado" em verde
// ═══════════════════════════════════════════════════════════════════════════
//
// PARCIALMENTE já corrigido antes desta sessão: commit 1c53a0f6 (v1.9.167,
// tier "média sem perda de dado" em pages.jsx) trocou o texto fixo em VERDE
// do OfflineIndicator por uma cor condicional (vermelho quando failed>0) e
// passou a mostrar "N falhou(aram) — segue na fila". O sintoma citado pelo
// achado ("0 sincronizado" em verde, sem cor de erro) não reproduz mais.
//
// RESIDUAL fechado nesta rodada: o próprio trecho citado pelo achado
// (repository.js:510-522 no snapshot original) inclui o catch mudo
// `catch { failed++; remaining.push(item); }` — diferente de QUALQUER outro
// caminho de push do arquivo (ver logFailAndEnqueue), syncQueue não logava
// nada por item, então uma tabela sem SQL rodado (404) ou fora do ar ficava
// girando pra sempre sem deixar rastro nem no console. E a MESMA linha
// carimbava lastSync=agora mesmo com 0 itens saindo — igual ao defeito dos
// achados 5/6 abaixo, na função irmã.
describe('achado 2/6 — pages.jsx: OfflineIndicator não mostra mais "0 sincronizado" em verde (JÁ CORRIGIDO)', () => {
  const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  it('a cor do resultado depende de failed>0 — não é mais fixa em verde', () => {
    expect(fonte).toContain("color: syncResult.failed > 0 ? 'var(--red)' : 'var(--green)'");
  });

  it('falhas aparecem explicitamente ("N falhou/falharam — segue na fila")', () => {
    expect(fonte).toContain("falhou${syncResult.failed > 1 ? 'ram' : ''} — segue na fila");
  });
});

describe('achado 2/6 — syncQueue agora loga o motivo de CADA falha (RESIDUAL corrigido nesta rodada)', () => {
  it('POST recusado (tabela sem SQL, 404): console.warn cita a tabela E o motivo — antes o catch era mudo', async () => {
    offline();
    await pushEquipAsset('swiss', { id: 'a1', name: 'Freezer 1' });   // enfileira (offline)
    expect(getOfflineQueue()).toHaveLength(1);

    online();
    vi.stubGlobal('fetch', vi.fn(() => nega(404, 'relation "equip_assets" does not exist')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await supabaseRepository.syncQueue();
    expect(result.failed).toBe(1);
    const mensagens = warn.mock.calls.map((c) => String(c[0]));
    expect(mensagens.some((m) => m.includes('syncQueue') && m.includes('equip_assets') && m.includes('mantido na fila'))).toBe(true);
  });

  it('falha de rede pura (fetch rejeita, sem resposta HTTP) também é logada — não só erro HTTP', async () => {
    offline();
    await pushEquipAsset('swiss', { id: 'a1', name: 'Freezer 1' });

    online();
    vi.stubGlobal('fetch', vi.fn(falhaDeRede));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await supabaseRepository.syncQueue();
    const mensagens = warn.mock.calls.map((c) => String(c[0]));
    expect(mensagens.some((m) => m.includes('syncQueue: equip_assets falhou'))).toBe(true);
  });
});

describe('achado 2/6 — syncQueue não carimba lastSync quando nada sai de verdade (RESIDUAL corrigido nesta rodada)', () => {
  it('fila com 1 item, falha total (0 sincronizados) — lastSync permanece com o valor ANTERIOR', async () => {
    offline();
    await pushEquipAsset('swiss', { id: 'a1', name: 'Freezer 1' });

    online();
    setSyncStatus({ lastSync: '2026-08-18T10:00:00.000Z' });
    vi.stubGlobal('fetch', vi.fn(() => nega(404, '')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await supabaseRepository.syncQueue();
    expect(result.synced).toBe(0);
    expect(getSyncStatus().lastSync).toBe('2026-08-18T10:00:00.000Z');   // não virou "agora"
  });

  it('fila com 2 itens, 1 sai — lastSync agora É atualizado (o caso parcial continua sendo "sync aconteceu")', async () => {
    offline();
    await pushEquipAsset('swiss', { id: 'a1', name: 'Freezer 1' });
    await pushMaintLog('swiss', { id: 'l1', equipmentId: 'a1' });

    online();
    setSyncStatus({ lastSync: '2026-08-18T10:00:00.000Z' });
    vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('equip_assets') ? nega(404, '') : okJson(null))));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await supabaseRepository.syncQueue();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(getSyncStatus().lastSync).not.toBe('2026-08-18T10:00:00.000Z');
  });

  it('fila vazia continua sem tocar em lastSync (early-return, comportamento preexistente)', async () => {
    online();
    setSyncStatus({ lastSync: '2026-08-18T10:00:00.000Z' });
    const result = await supabaseRepository.syncQueue();
    expect(result).toEqual({ synced: 0, failed: 0, remaining: 0 });
    expect(getSyncStatus().lastSync).toBe('2026-08-18T10:00:00.000Z');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 3/6 — O filtro "Todos" corta o cache ANTES de ordenar — o mesmo
// defeito da v1.9.151, no ramo irmão que não foi corrigido
// ═══════════════════════════════════════════════════════════════════════════
//
// JÁ CORRIGIDO antes desta sessão: commit 2679fd09 (v1.9.155, "4 achados
// graves da triagem manual") — item 2 do commit é literalmente este achado
// ("O ramo 'Todos' ficou sem o conserto de ontem — MEU ERRO"). O ramo days<=0
// de supabaseRepository.list ordena por createdAt ANTES de cortar, com teto
// MAX_CACHE_RECORDS (global, não allRows.length). Cobertura dedicada e
// extensa já existe em cache-teto.test.js. Aqui só a confirmação pontual.
describe('achado 3/6 — "Todos" ordena antes de cortar o cache global (JÁ CORRIGIDO)', () => {
  const RECORDS_KEY = 'nutriops.temperature.records';
  const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString();

  beforeEach(() => { online(); });

  it('leitura de OUTRO aparelho, mais recente, sobrevive ao corte mesmo com o cache global cheio', async () => {
    // 4000 registros antigos de outra loja já preenchem boa parte do teto global
    lw(RECORDS_KEY, Array.from({ length: 4000 }, (_, i) => ({ id: `velho-${i}`, tenantId: 'swiss', value: 4, createdAt: diasAtras(60) })));
    const remoto = Array.from({ length: 50 }, (_, i) => ({
      id: `casadoce-${i}`, tenant_id: 'casadoce', value: 3, created_at: diasAtras(0),
    }));
    vi.stubGlobal('fetch', vi.fn(() => okJson(remoto)));

    const lista = await supabaseRepository.list({ tenantId: 'casadoce', days: 0 });
    expect(lista).toHaveLength(50);   // nenhum decepado — não é "6 de 138"
    const cache = ls(RECORDS_KEY, []);
    expect(cache.filter((r) => r.id?.startsWith?.('casadoce-'))).toHaveLength(50);
  });

  it('fonte: o ramo days<=0 ordena por createdAt e usa MAX_CACHE_RECORDS, não allRows.length', () => {
    const fonte = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    // o teto antigo e capenga (Math.max(1000, allRows.length)) não pode sobrar
    expect(fonte).not.toContain('Math.max(1000, allRows.length)');
    const ocorrencias = (fonte.match(/const porData = merged\.sort\(\(a, b\) => new Date\(b\.createdAt \?\? 0\) - new Date\(a\.createdAt \?\? 0\)\);\n\s*lw\(RECORDS_KEY, porData\.slice\(0, MAX_CACHE_RECORDS\)\);/g) ?? []).length;
    expect(ocorrencias).toBe(2);   // os dois ramos (days>0 e "Todos") usam o MESMO padrão
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 4/6 — Sucesso de uma tabela apaga o 401 de outra — o banner
// vermelho nunca chega a 2 falhas e nunca aparece
// ═══════════════════════════════════════════════════════════════════════════
//
// REAL, corrigido nesta rodada. sbFetch limpava o carimbo de auth error em
// QUALQUER sucesso, de QUALQUER tabela. syncAllModules dispara 22 GETs em
// paralelo — bastava 1 tabela negada por RLS pra cair aqui: o sucesso de
// qualquer uma das outras 21 apagava o carimbo antes do contador de
// `falhas` seguidas chegar a 2, e o banner (pages.jsx, exige >=2) ficava
// estruturalmente incapaz de nascer. É a mesma mecânica do incidente de
// 16/08 (CASA DOCE, policy sem is_member), continuando ativa no código.
describe('achado 4/6 — sucesso em OUTRA tabela não apaga mais o 401 de RLS de uma tabela diferente', () => {
  it('temperature_records nega por RLS; equip_assets aceita logo depois — o carimbo de temperature_records SOBREVIVE', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn((url) => (
      String(url).includes('temperature_records')
        ? nega(401, { code: '42501', message: 'row-level security' })
        : okJson(null)
    )));

    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });   // falha, marca o carimbo
    expect(getSupabaseAuthError()?.kind).toBe('rls');
    expect(getSupabaseAuthError()?.table).toBe('temperature_records');

    await pushEquipAsset('casadoce', { id: 'eq1', name: 'Freezer 1' });   // sucesso, tabela DIFERENTE

    // Regra velha: getSupabaseAuthError() seria null aqui (bug). Regra nova:
    // o carimbo continua de pé, porque o sucesso não foi na mesma tabela.
    expect(getSupabaseAuthError()).not.toBeNull();
    expect(getSupabaseAuthError()?.table).toBe('temperature_records');
  });

  it('com o carimbo preservado, duas falhas seguidas na MESMA tabela (com sucesso de outra no meio) chegam a falhas>=2 — o banner pode nascer', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn((url) => (
      String(url).includes('temperature_records')
        ? nega(401, { code: '42501', message: 'row-level security' })
        : okJson(null)
    )));

    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });     // falha 1 (temperature_records)
    await pushEquipAsset('casadoce', { id: 'eq1', name: 'F1' });           // sucesso (equip_assets) — não deve resetar
    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });     // falha 2 (temperature_records)

    expect(getSupabaseAuthError()?.falhas).toBeGreaterThanOrEqual(2);
  });

  it('sucesso na MESMA tabela que estava falhando ainda limpa o carimbo — não virou "nunca mais limpa"', async () => {
    online();
    let falha = true;
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).includes('temperature_records')) {
        return falha ? nega(401, { code: '42501', message: 'row-level security' }) : okJson([]);
      }
      return okJson(null);
    }));

    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });
    expect(getSupabaseAuthError()).not.toBeNull();

    falha = false;   // a MESMA tabela volta a funcionar
    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });
    expect(getSupabaseAuthError()).toBeNull();   // cura de verdade continua limpando
  });

  it('kind anon/session (credencial inteira, não por tabela) continuam sendo limpos por sucesso em QUALQUER tabela — sem regressão', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn((url) => (
      String(url).includes('temperature_records')
        ? nega(401, { message: 'Invalid API key' })   // sem sinal de RLS
        : okJson(null)
    )));

    await supabaseRepository.list({ tenantId: 'casadoce', days: 90 });
    // 'session' e não 'anon': a chamada FOI com JWT (o mock de ./auth entrega
    // token), e desde 23/08 'anon' significa especificamente "saiu sem
    // credencial". O que este teste protege vale pros dois — são kinds da
    // CREDENCIAL inteira, não de uma tabela, então sucesso em qualquer tabela
    // prova a cura.
    expect(getSupabaseAuthError()?.kind).toBe('session');

    await pushEquipAsset('casadoce', { id: 'eq1', name: 'F1' });   // tabela diferente, mas credencial é a mesma
    expect(getSupabaseAuthError()).toBeNull();   // isto CONTINUA limpando — comportamento correto pra esse kind
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achados 5/6 e 6/6 — syncAllModules carimba "última sincronização: agora"
// mesmo com 0 de 22 módulos sincronizados — e Prontidão/Configurações leem
// esse carimbo como prova de que a evidência está na nuvem
// ═══════════════════════════════════════════════════════════════════════════
//
// Mesma causa raiz, duas lentes (readiness-view.jsx:122→readiness.js D1, e
// settings.jsx:480) — tratados como uma família, igual o resto da auditoria.
// REAL, corrigido nesta rodada: setSyncStatus só recebe `lastSync` quando
// pelo menos 1/22 módulos confirmou ida-e-volta com a nuvem. `ok` no retorno
// também passou a refletir isso (era sempre `true`, mesmo com synced:0).
describe('achados 5/6 e 6/6 — syncAllModules só carimba lastSync quando algo realmente sincronizou', () => {
  it('0/22 módulos ok (rede "online" mas sem resposta real — portal cativo/servidor fora do ar): lastSync NÃO muda, ok:false', async () => {
    online();
    setSyncStatus({ lastSync: '2026-08-18T10:00:00.000Z' });
    vi.stubGlobal('fetch', vi.fn(falhaDeRede));

    const result = await syncAllModules('swiss');
    expect(result.synced).toBe(0);
    expect(result.ok).toBe(false);   // era sempre true antes — mentia sucesso total
    // O carimbo ANTERIOR (verdadeiro) sobrevive — não vira "agora".
    expect(getSyncStatus().lastSync).toBe('2026-08-18T10:00:00.000Z');
  });

  it('pelo menos 1/22 módulos ok: lastSync passa a refletir "agora" — o caso parcial continua sendo sync real', async () => {
    online();
    setSyncStatus({ lastSync: '2026-08-18T10:00:00.000Z' });
    vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('form_records') ? okJson([]) : falhaDeRede())));

    const antes = Date.now();
    const result = await syncAllModules('swiss');
    expect(result.synced).toBeGreaterThanOrEqual(1);
    expect(result.ok).toBe(true);
    const carimbo = getSyncStatus().lastSync;
    expect(carimbo).not.toBe('2026-08-18T10:00:00.000Z');
    expect(new Date(carimbo).getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('22/22 ok: comportamento normal preservado — sem regressão no caminho feliz', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));

    const result = await syncAllModules('swiss');
    expect(result.synced).toBe(result.total);
    expect(result.ok).toBe(true);
    expect(getSyncStatus().lastSync).not.toBeNull();
  });

  it('readiness-view.jsx e settings.jsx leem o MESMO getSyncStatus().lastSync — a correção vale pras duas telas', () => {
    const readinessView = readFileSync(`${process.cwd()}/src/readiness-view.jsx`, 'utf8');
    const settings = readFileSync(`${process.cwd()}/src/settings.jsx`, 'utf8');
    expect(readinessView).toContain('lastSync: getSyncStatus().lastSync');
    expect(settings).toContain('const s = getSyncStatus();');
  });

  it('offline_or_disabled continua devolvendo ok:false sem tocar em setSyncStatus — early-return preexistente intacto', async () => {
    offline();
    setSyncStatus({ lastSync: '2026-08-18T10:00:00.000Z' });
    const result = await syncAllModules('swiss');
    expect(result).toEqual({ ok: false, reason: 'offline_or_disabled' });
    expect(getSyncStatus().lastSync).toBe('2026-08-18T10:00:00.000Z');
  });
});
