import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ls, lw, getOfflineQueue, clearOfflineQueue, saveSupabaseConfig,
  localRepository,
  getQueueOverflow, clearQueueOverflow,
  staffNameJaExiste, pushStaffMember, deleteStaffMember, syncTenantStaff,
  fetchProductById, pushMaintLog,
  migrateAllToSupabase, valorTemperaturaValido, dataOuNulo,
} from './repository';
import { resolveScannedLabel } from './label-scanner';
import { buildLabelTrace } from './validity-rules';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 6 achados de gravidade BAIXA que apontam pra
// src/repository.js (pool de 169 não-julgados da auditoria de falha silenciosa,
// 18-19/08 — data_achados_pendentes_19-08.json, filtro gravidade=='baixa' &&
// arquivo termina em repository.js). 2 COM perda de dado (achados 1 e 2
// abaixo), 4 sem perda.
//
// repository.js já tinha passado por 3 rodadas anteriores nesta mesma sessão
// (média sem perda 49d2a11/v1.9.168, alta sem perda b9a81bc/v1.9.176 e
// a5250b3/v1.9.180) — e, lendo o código atual em vez de confiar só na
// descrição do achado, mais duas rodadas AINDA MAIS ANTIGAS (médios COM perda
// de dado: 8e40084/v1.9.163 e vizinhos) também já tinham corrigido dois dos 6
// achados desta rodada. Confirmados no código e endurecidos com teste, não
// duplicados.
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

const OFFLINE_Q_KEY = 'nutriops.offline.queue';

beforeEach(() => { localStorage.clear(); clearOfflineQueue(); clearQueueOverflow(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// Achado 1/6 [COM PERDA DE DADO] — Teto da fila offline (5000) descarta os
// registros MAIS ANTIGOS só com console.warn
// ═══════════════════════════════════════════════════════════════════════════
//
// REAL. O descarte em si (manter os 5000 mais recentes) não é o bug — é o
// SILÊNCIO: nenhuma bandeira persistente, só um console.warn num tablet onde
// ninguém abre o console. Mesmo padrão do STORAGE_FULL_KEY (achado nº15).
// Corrigido: enqueue() agora liga nutriops.offline.queue.overflow (contagem
// acumulada + carimbo), exportado via getQueueOverflow/clearQueueOverflow, e
// pages.jsx ganhou um banner (QueueOverflowBanner) no mesmo lugar do
// StorageFullBanner.
describe('achado 1/6 — fila offline no teto: descarte silencioso agora liga uma bandeira persistente', () => {
  it('mecanismo real: passar do teto apaga de vez o item mais antigo — não é "movido", nunca mais existe em lugar nenhum', async () => {
    // Fila cheia EXATAMENTE no teto — array cresce por append, então reg-0 é
    // o mais antigo (o primeiro a esperar, o que a auditoria diz que importa
    // mais: é dado que nunca chegou na nuvem).
    const cheia = Array.from({ length: 5000 }, (_, i) => ({
      table: 'temperature_records', operation: 'upsert', payload: { id: `reg-${i}` },
    }));
    lw(OFFLINE_Q_KEY, cheia);
    expect(getOfflineQueue()).toHaveLength(5000);

    // Mais UM salvamento — localRepository.create sempre enfileira, mesmo com
    // Supabase desligado (ver comentário em create()), então nem precisa
    // mockar fetch/online aqui.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await localRepository.create({ id: 'novo-1', tenantId: 'swiss', value: 3, measuredAt: new Date().toISOString() });

    const depois = getOfflineQueue();
    expect(depois).toHaveLength(5000);                                        // o teto se manteve
    expect(depois.some((it) => it.payload?.id === 'reg-0')).toBe(false);        // a PROVA da perda: sumiu de vez
    expect(depois.some((it) => it.payload?.id === 'reg-1')).toBe(true);         // o 2º mais antigo sobreviveu
    expect(depois.some((it) => it.payload?.id === 'novo-1')).toBe(true);        // o novo entrou
  });

  it('a mesma perda liga nutriops.offline.queue.overflow — antes só existia um console.warn', async () => {
    expect(getQueueOverflow()).toBeNull();
    lw(OFFLINE_Q_KEY, Array.from({ length: 5000 }, (_, i) => ({ table: 'temperature_records', operation: 'upsert', payload: { id: `reg-${i}` } })));

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await localRepository.create({ id: 'novo-1', tenantId: 'swiss', value: 3, measuredAt: new Date().toISOString() });

    const overflow = getQueueOverflow();
    expect(overflow).not.toBeNull();
    expect(overflow.descartados).toBe(1);
    expect(typeof overflow.at).toBe('string');
  });

  it('descartes em rodadas diferentes ACUMULAM na bandeira — não perde a contagem da vez anterior', async () => {
    lw(OFFLINE_Q_KEY, Array.from({ length: 5000 }, (_, i) => ({ table: 'temperature_records', operation: 'upsert', payload: { id: `reg-${i}` } })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await localRepository.create({ id: 'novo-1', tenantId: 'swiss', value: 1, measuredAt: new Date().toISOString() });
    await localRepository.create({ id: 'novo-2', tenantId: 'swiss', value: 2, measuredAt: new Date().toISOString() });
    await localRepository.create({ id: 'novo-3', tenantId: 'swiss', value: 3, measuredAt: new Date().toISOString() });

    expect(getQueueOverflow().descartados).toBe(3);
    expect(getOfflineQueue()).toHaveLength(5000);
  });

  it('abaixo do teto, nada é descartado e a bandeira nunca liga', async () => {
    lw(OFFLINE_Q_KEY, Array.from({ length: 10 }, (_, i) => ({ table: 'temperature_records', operation: 'upsert', payload: { id: `reg-${i}` } })));
    await localRepository.create({ id: 'novo-1', tenantId: 'swiss', value: 3, measuredAt: new Date().toISOString() });
    expect(getOfflineQueue()).toHaveLength(11);
    expect(getQueueOverflow()).toBeNull();
  });

  it('clearQueueOverflow limpa a bandeira — é o que o botão "Dispensar" do banner chama', async () => {
    lw(OFFLINE_Q_KEY, Array.from({ length: 5000 }, (_, i) => ({ table: 'temperature_records', operation: 'upsert', payload: { id: `reg-${i}` } })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await localRepository.create({ id: 'novo-1', tenantId: 'swiss', value: 1, measuredAt: new Date().toISOString() });
    expect(getQueueOverflow()).not.toBeNull();

    clearQueueOverflow();
    expect(getQueueOverflow()).toBeNull();
  });

  it('fonte: pages.jsx importa os getters/clearers novos e renderiza o QueueOverflowBanner ao lado do StorageFullBanner', () => {
    const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
    expect(fonte).toContain('getQueueOverflow, clearQueueOverflow');
    expect(fonte).toContain('function QueueOverflowBanner()');
    expect(fonte).toContain('<StorageFullBanner />');
    expect(fonte).toContain('<QueueOverflowBanner />');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 2/6 [COM PERDA DE DADO] — Dois colaboradores com o mesmo nome
// colidem na chave (tenant_id, name); o sync apaga um deles da lista da loja
// ═══════════════════════════════════════════════════════════════════════════
//
// REAL — confirmado com o schema de verdade: docs/tenant-staff.sql declara
// `primary key (tenant_id, name)`, sem id nenhum. Duas pessoas diferentes com
// o mesmo nome (homônimo, ou a loja só cadastra o primeiro nome) fazem o
// upsert da segunda SOBRESCREVER a linha da primeira na nuvem — não cria uma
// segunda linha. syncTenantStaff substitui a lista local pela nuvem sempre que
// ela não vem vazia, e uma das duas pessoas desaparece da tela sem nenhum
// aviso. Migrar a tabela pra um id de verdade é mudança de schema (fora do
// escopo desta correção) — a correção é uma guarda no cliente que barra a
// colisão ANTES dela chegar na nuvem: staffNameJaExiste (repository.js),
// chamada por saveUser (team-views.jsx) antes de qualquer gravação.
describe('achado 2/6 — colisão de nome em (tenant_id, name): guarda nova barra ANTES da gravação', () => {
  describe('staffNameJaExiste — guarda pura', () => {
    it('detecta colisão exata', () => {
      expect(staffNameJaExiste([{ name: 'Ana' }], 'Ana')).toBe(true);
    });

    it('normaliza espaço e maiúscula/minúscula — é assim que o Postgres compara texto também', () => {
      expect(staffNameJaExiste([{ name: 'Ana Paula' }], '  ana paula  ')).toBe(true);
    });

    it('não acusa colisão entre nomes diferentes', () => {
      expect(staffNameJaExiste([{ name: 'Ana' }], 'Ana Paula')).toBe(false);
    });

    it('editar sem trocar o nome não colide com a própria pessoa (excludeName)', () => {
      const lista = [{ name: 'Ana' }, { name: 'Bia' }];
      expect(staffNameJaExiste(lista, 'Ana', { excludeName: 'Ana' })).toBe(false);
    });

    it('renomear PRA um nome que já é de outra pessoa ainda colide, mesmo excluindo o nome antigo', () => {
      const lista = [{ name: 'Ana' }, { name: 'Bia' }];
      expect(staffNameJaExiste(lista, 'Bia', { excludeName: 'Ana' })).toBe(true);
    });

    it('lista vazia ou nome vazio nunca colidem', () => {
      expect(staffNameJaExiste([], 'Ana')).toBe(false);
      expect(staffNameJaExiste([{ name: 'Ana' }], '')).toBe(false);
      expect(staffNameJaExiste([{ name: 'Ana' }], '   ')).toBe(false);
    });
  });

  it('mecanismo real: duas pessoas DIFERENTES com o mesmo nome — a 2ª upsert apaga a 1ª na nuvem e o sync some com uma delas no aparelho', async () => {
    online();
    // "Banco" fake com upsert por (tenant_id, name) — a MESMA semântica da PK
    // real (docs/tenant-staff.sql: primary key (tenant_id, name)).
    const nuvem = new Map();
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      const u = String(url);
      if (opts?.method === 'POST' && u.includes('tenant_staff')) {
        const row = JSON.parse(opts.body);
        nuvem.set(`${row.tenant_id}::${row.name}`, row);   // upsert de verdade: SOBRESCREVE
        return okJson(null);
      }
      if (u.includes('tenant_staff')) return okJson([...nuvem.values()]);
      return okJson(null);
    }));

    // Sem a guarda: a loja cadastra "Ana" (Colaboradora da Cozinha) e depois
    // OUTRA "Ana" (Supervisora do Salão, pessoa diferente) — exatamente como
    // team-views.jsx faria SEM checar staffNameJaExiste antes.
    await pushStaffMember('swiss', { name: 'Ana', role: 'Colaborador', location: 'Cozinha', status: 'Ativo' });
    await pushStaffMember('swiss', { name: 'Ana', role: 'Supervisor', location: 'Salão', status: 'Ativo' });

    expect(nuvem.size).toBe(1);   // a nuvem só tem UMA linha — a PK comeu a outra

    // Local, antes do sync, ainda tem as duas (era o que a tela mostrava).
    lw('nutriops.users.swiss', [
      { name: 'Ana', role: 'Colaborador', location: 'Cozinha', status: 'Ativo' },
      { name: 'Ana', role: 'Supervisor', location: 'Salão', status: 'Ativo' },
    ]);
    expect(ls('nutriops.users.swiss', [])).toHaveLength(2);

    // Próximo boot online: syncTenantStaff substitui o local pelo remoto.
    await syncTenantStaff('swiss');

    const depois = ls('nutriops.users.swiss', []);
    // A PROVA da perda: a "Ana" Colaboradora da Cozinha SUMIU da lista da
    // loja — sem nenhum erro, sem nenhuma mensagem.
    expect(depois).toHaveLength(1);
    expect(depois[0].role).toBe('Supervisor');
  });

  it('com a guarda, o 2º cadastro nunca sairia do cliente — staffNameJaExiste barra ANTES do pushStaffMember', () => {
    const listaAtual = [{ name: 'Ana', role: 'Colaborador', location: 'Cozinha', status: 'Ativo' }];
    expect(staffNameJaExiste(listaAtual, 'Ana', { excludeName: null })).toBe(true);
  });

  it('fonte: team-views.jsx importa staffNameJaExiste e interrompe saveUser com alert ANTES de gravar (setUsers/pushStaffMember)', () => {
    const fonte = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');
    expect(fonte).toContain("import { isSupabaseEnabled as supabaseEnabled, staffNameJaExiste } from './repository';");
    expect(fonte).toContain('if (staffNameJaExiste(users, trimmedName, { excludeName: nomeAntigo })) {');

    const idxGuarda = fonte.indexOf('if (staffNameJaExiste(users, trimmedName');
    const idxSetUsers = fonte.indexOf('setUsers((prev) => isEditing ? prev.map((u, i) => i === editingIndex ? user : u) : [...prev, user]);');
    expect(idxGuarda).toBeGreaterThan(-1);
    expect(idxSetUsers).toBeGreaterThan(idxGuarda);   // a guarda vem ANTES da gravação de verdade
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 3/6 [sem perda] — Renomear colaborador offline deixa a pessoa
// duplicada na nuvem (delete do nome antigo descartado, push do novo enfileirado)
// ═══════════════════════════════════════════════════════════════════════════
//
// JÁ RESOLVIDO pela tier média (49d2a11/v1.9.168, família 1): deleteStaffMember
// devolve reason:'offline_or_disabled' no early-return, e team-views.jsx (tanto
// o rename em saveUser quanto o removeUser) só chama alert() em falha REAL —
// offline nunca dispara, porque é esperado (delete é online-only por design:
// enfileirar um DELETE seria replayado como upsert e ressuscitaria a linha —
// mesmo padrão já estabelecido nesta auditoria pra equipamento/POP/ASO/ativo
// de manutenção). O residual que o achado descreve ("a duplicata reaparece até
// alguém repetir a ação online") é a MESMA característica aceita em todo
// módulo com delete online-only do app — não uma falha silenciosa nova.
// Tratado como decisão arquitetural já tomada nesta auditoria, não uma
// correção pendente; endurecido aqui com teste de trava.
describe('achado 3/6 — renomear colaborador offline: já resolvido pela tier média, endurecido com trava', () => {
  it('deleteStaffMember offline devolve reason explícito (não {ok:false} pelado, que o .catch(()=>{}) antigo não pegava)', async () => {
    offline();
    expect(await deleteStaffMember('swiss', 'Ana')).toEqual({ ok: false, reason: 'offline_or_disabled' });
  });

  it('fonte: TODO call site de deleteStaffMember em team-views.jsx guarda o offline', () => {
    const fonte = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');
    const chamadas = (fonte.match(/deleteStaffMember\(/g) ?? []).length;
    const guardas  = (fonte.match(/if \(!r\.ok && r\.reason !== 'offline_or_disabled'\) \{/g) ?? []).length;
    // Número fixo aqui era 2 (rename + remover) e quebrou quando "Mover de
    // unidade" virou o terceiro (v1.9.230) — sendo que o terceiro guarda
    // certo. Amarrar guarda-a-chamada testa a REGRA e não precisa de manutenção
    // a cada call site novo; um que esqueça a guarda continua sendo pego.
    expect(chamadas).toBeGreaterThanOrEqual(2);
    expect(guardas).toBe(chamadas);
  });

  it('fonte: o push do nome NOVO continua enfileirando mesmo offline — só o delete do nome antigo é online-only (por design, não bug)', () => {
    const fonte = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(fonte).toContain("enqueue('tenant_staff', 'upsert', staffToRow(member, tenantId));");
    expect(fonte).toContain('export async function deleteStaffMember(tenantId, name) {');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 4/6 [sem perda] — Leitor de etiqueta: falha de rede é apresentada
// como "produto não existe"
// ═══════════════════════════════════════════════════════════════════════════
//
// REAL, corrigido nesta rodada. fetchProductById devolvia `null` cru pros três
// casos (offline, RLS, exceção de rede) — indistinguível de "chequei e não
// existe". Agora devolve { product, checkFailed }: checkFailed:true só quando
// não deu pra confirmar nada, nunca quando a nuvem respondeu de verdade (achou
// ou confirmou ausência). label-scanner.jsx mostra uma mensagem diferente pra
// cada caso.
describe('achado 4/6 — leitor de etiqueta: falha de rede não é mais apresentada como "produto não existe"', () => {
  it('fetchProductById: sucesso com produto encontrado → checkFailed:false', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn(() => okJson([{ id: 'p1', tenant_id: 'swiss', name: 'Açúcar' }])));
    const r = await fetchProductById('swiss', 'p1');
    expect(r.checkFailed).toBe(false);
    expect(r.product?.name).toBe('Açúcar');
  });

  it('fetchProductById: nuvem respondeu vazio (confirmadamente não existe) → checkFailed:false, product:null', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));
    const r = await fetchProductById('swiss', 'nao-existe');
    expect(r).toEqual({ product: null, checkFailed: false });
  });

  it('fetchProductById: falha de rede real (fetch rejeita) → checkFailed:true — ANTES colapsava no MESMO null de "não existe"', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn(falhaDeRede));
    const r = await fetchProductById('swiss', 'p1');
    expect(r).toEqual({ product: null, checkFailed: true });
  });

  it('fetchProductById: RLS recusa (401/42501) → checkFailed:true', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { code: '42501', message: 'row-level security' })));
    const r = await fetchProductById('swiss', 'p1');
    expect(r).toEqual({ product: null, checkFailed: true });
  });

  it('fetchProductById: offline → checkFailed:true (não afirma que o produto não existe)', async () => {
    offline();
    const r = await fetchProductById('swiss', 'p1');
    expect(r).toEqual({ product: null, checkFailed: true });
  });

  it('resolveScannedLabel propaga checkFailed pro resultado que a tela lê', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn(falhaDeRede));
    const trace = buildLabelTrace('swiss', 'p-fora-do-cache', null);
    const r = await resolveScannedLabel(trace, { activeTenantId: 'swiss', activeTenantProducts: [], allTenants: [{ id: 'swiss', name: 'Swiss' }] });
    expect(r.product).toBeNull();
    expect(r.checkFailed).toBe(true);
  });

  it('resolveScannedLabel: produto achado em memória não precisa perguntar pra nuvem — checkFailed fica false, sem chamar fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const trace = buildLabelTrace('swiss', 'p1', null);
    const r = await resolveScannedLabel(trace, { activeTenantId: 'swiss', activeTenantProducts: [{ id: 'p1', name: 'Açúcar' }], allTenants: [] });
    expect(r.checkFailed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fonte: label-scanner.jsx mostra uma mensagem DIFERENTE pra falha de rede (checkFailed) e pra "não existe" confirmado', () => {
    const fonte = readFileSync(`${process.cwd()}/src/label-scanner.jsx`, 'utf8');
    expect(fonte).toContain('if (!product && checkFailed) {');
    expect(fonte).toContain('Não consegui verificar esse produto agora');
    expect(fonte).toContain('Não encontrei esse produto');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 5/6 [sem perda] — Auto-backfill empurra o cache de temperatura sem a
// guarda de valor — um registro com value nulo trava o backfill pra sempre
// ═══════════════════════════════════════════════════════════════════════════
//
// JÁ RESOLVIDO — não pela tier média/alta desta sessão (que o CLAUDE.md lista
// como as 3 rodadas anteriores em repository.js), mas por uma rodada AINDA
// MAIS ANTIGA desta mesma auditoria: 8e40084 (v1.9.163, "4 famílias dos
// achados médios com perda de dado" — família E cobria exatamente isto).
// Confirmado lendo o código atual: migrateAllToSupabase já usa
// valorTemperaturaValido antes do POST de temperatura. Endurecido com teste
// funcional (mock de fetch, não só leitura de fonte).
describe('achado 5/6 — auto-backfill sem guarda de valor: já resolvido (8e40084/v1.9.163), endurecido', () => {
  it('valorTemperaturaValido rejeita null/undefined/NaN/"-" e aceita número finito', () => {
    expect(valorTemperaturaValido(null)).toBe(false);
    expect(valorTemperaturaValido(undefined)).toBe(false);
    expect(valorTemperaturaValido(NaN)).toBe(false);
    expect(valorTemperaturaValido('-')).toBe(false);
    expect(valorTemperaturaValido(4)).toBe(true);
    expect(valorTemperaturaValido('4.5')).toBe(true);
  });

  it('mecanismo real: migrateAllToSupabase PULA o registro de temperatura com value:null — nunca tenta o POST, nunca conta como failed', async () => {
    online();
    const posts = [];
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      if (opts?.method === 'POST') posts.push(String(url));
      return okJson(null);
    }));
    lw('nutriops.temperature.records', [
      { id: 't1', tenantId: 'swiss', value: null, measuredAt: '2026-08-17T10:00:00.000Z' },   // envenenado (bug pré-v1.9.143)
      { id: 't2', tenantId: 'swiss', value: 4,    measuredAt: '2026-08-17T10:05:00.000Z' },   // válido
    ]);

    const r = await migrateAllToSupabase([{ id: 'swiss' }]);

    expect(posts.filter((u) => u.includes('temperature_records'))).toHaveLength(1);   // só o válido foi tentado
    expect(r.failed).toBe(0);   // o envenenado NUNCA conta como failed — senão o backfill nunca fecha e repete pra sempre
    expect(r.pushed).toBeGreaterThanOrEqual(1);
  });

  it('fonte: migrateAllToSupabase usa valorTemperaturaValido antes do POST de temperatura', () => {
    const fonte = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(fonte).toContain('if (!valorTemperaturaValido(r.value)) continue;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 6/6 [sem perda] — Execução de manutenção com o campo de data limpo
// vira string vazia numa coluna `date` — 22007 em toda tentativa
// ═══════════════════════════════════════════════════════════════════════════
//
// JÁ RESOLVIDO — mesma rodada antiga do achado 5/6 (8e40084/v1.9.163, família
// A: "string vazia em coluna date"), que criou dataOuNulo e já cobria as 3
// colunas expostas, INCLUSIVE maint_logs.executed_at (a que este achado
// aponta). Confirmado lendo o código atual. Endurecido com teste funcional via
// pushMaintLog (a função pública que chama maintLogToRow por baixo).
describe('achado 6/6 — execução de manutenção com data vazia (22007): já resolvido (8e40084/v1.9.163), endurecido', () => {
  it('dataOuNulo converte string vazia e undefined em null, preserva data válida', () => {
    expect(dataOuNulo('')).toBeNull();
    expect(dataOuNulo('   ')).toBeNull();
    expect(dataOuNulo(undefined)).toBeNull();
    expect(dataOuNulo(null)).toBeNull();
    expect(dataOuNulo('2026-08-19')).toBe('2026-08-19');
  });

  it('mecanismo real: pushMaintLog com o campo de data limpo (executedAt:"") NUNCA manda string vazia pro Postgres', async () => {
    online();
    let bodyEnviado = null;
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      if (opts?.method === 'POST') bodyEnviado = JSON.parse(opts.body);
      return okJson(null);
    }));

    const r = await pushMaintLog('swiss', { id: 'log1', equipmentId: 'eq1', title: 'Troca de filtro', executedAt: '' });

    expect(r.ok).toBe(true);
    expect(bodyEnviado.executed_at).toBeNull();      // NUNCA '' — Postgres recusaria com 22007 em toda tentativa
    expect(bodyEnviado.executed_at).not.toBe('');
  });

  it('fonte: maintLogToRow usa dataOuNulo em executed_at (não `?? null`, que não protege string vazia)', () => {
    const fonte = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(fonte).toContain('executed_by: l.executedBy ?? null, executed_at: dataOuNulo(l.executedAt),');
  });
});
