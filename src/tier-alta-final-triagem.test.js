import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { supabaseRepository, saveSupabaseConfig, lw } from './repository';
import { anyFromCache } from './extras';
import { areRulesUnconfirmed } from './validity';
import { computeTurnAlertsPure } from './turn-alerts';
import { dedupeCatalog, getEquipmentEntry } from './limits';
import { isTokenLookupInconclusive } from './tenant-sync';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos ÚLTIMOS 7 achados de gravidade ALTA sem perda de dado do
// pool inteiro (169 não-julgados da auditoria de falha silenciosa, 18-19/08) —
// espalhados em 5 arquivos pequenos: reports-views.jsx (2), overview-v2.jsx
// (2), extras.jsx (1), validity.jsx (1), tenant-sync.js (1). Fecha a tier
// "alta sem perda de dado" inteira (35 achados). Rodadas anteriores: 1
// pages.jsx (c8a947e), 2 repository.js (b9a81bc), 3 settings.jsx (8d7294f),
// 4 maintenance.jsx+dossie-view.jsx (2623fb8), 5 admin.jsx+superadmin-view.jsx
// (ec35f78, v1.9.179).
//
// Os 7:
//   · reports-views.jsx T2 ("correção com Período=Todos não atualiza a
//     tela") — JÁ RESOLVIDO antes desta sessão de triagem manual, na tier
//     MÉDIA (af67790, v1.9.170): submitCorrection já faz
//     setExtraRecords(prev => prev?.map(...)). Coberto por
//     reports-views-medios-triagem.test.js. Não é uma decisão nova.
//   · reports-views.jsx T7 ("Todos" corta o cache global sem ordenar,
//     repository.js:448) — JÁ RESOLVIDO ainda ANTES, na tier ALTA mas na
//     tier GRAVE original (2679fd0, v1.9.155) — mesma correção que
//     v1.9.151 já tinha aplicado no ramo irmão (days>0). Coberto por
//     repository-altos-triagem.test.js ("achado 3/6"). Não é uma decisão
//     nova.
//   · extras.jsx T7 ("relatório mensal sai com 'Nenhum registro no período'
//     quando a leitura da nuvem falha") — ACHADO REAL, ainda aberto.
//     repo.list() nunca lança quando a nuvem falha (cai pro cache local e só
//     loga um console.warn) — mas esse cache não cobre mês fora da janela de
//     90 dias, então a falha virava "0 registros" idêntico a "a loja não
//     registrou nada", num PDF que é evidência de fiscalização RDC 216.
//     Corrigido em duas camadas: repository.js marca `_fromCache: true` no
//     array devolvido quando cai pro cache (mesmo idioma do `_pending` que
//     create()/update() já usam); MonthlyExportView lê esse sinal ANTES do
//     .map() (que descartaria a propriedade), mostra um banner de aviso na
//     tela e embute o mesmo aviso no PDF gerado.
//   · validity.jsx T3 ("`.then()` sem `.catch()` — falha de sync vira prazo
//     de fábrica sem aviso") — ACHADO REAL, ainda aberto. syncValidityRules
//     nunca rejeita (devolve {ok:false,reason}); o `.then()` da tela
//     descartava esse retorno e relia sempre do local — numa loja que nunca
//     sincronizou as regras deste device, isso é DEFAULT_OPEN_RULES inteiro
//     (prazo de fábrica) impresso na etiqueta como se fosse a regra da RT.
//     Corrigido: areRulesUnconfirmed (pura, exportada) decide se a falha
//     merece aviso — só quando NÃO havia nenhuma versão confirmada antes
//     (nem local, nem sync anterior); a tela mostra um banner acima de
//     TODAS as abas (a impressão acontece em Produtos, não só em Regras).
//   · overview-v2.jsx T6 ("mapa de calor semanal usa o catálogo-semente do
//     tenant, não o sincronizado") — ACHADO REAL, ainda aberto (distinto do
//     bug de matching de label/alias já fechado na tier média — este é
//     sobre a FONTE do catálogo, não o casamento de nome). WeeklyHeatmap
//     iterava `t.equipmentCatalog` (a semente de tenants-public.js ou do
//     payload de criação do /admin, nunca atualizada depois) em vez do
//     catálogo vivo (`nutriops.equipment.catalog.{id}`, o que
//     syncEquipmentCatalog/EquipmentView escrevem). Equipamento cadastrado
//     depois da criação da loja nunca aparecia — nem como linha vazia.
//     Corrigido com o mesmo idioma de reports-views.jsx/team-views.jsx
//     (readEquipmentCatalog local, com dedupeCatalog).
//   · overview-v2.jsx T6 ("'Pendentes no turno' mede o DIA, não o turno") —
//     ACHADO REAL, ainda aberto. `pending` filtrava por `todayMs` (meia-
//     noite) — 1 leitura de manhã zerava a pendência dos turnos seguintes, e
//     a equipe da Tarde/Noite via "tudo registrado" com a seção "Registrar
//     agora" sumida, mesmo sem medir nada desde o início do PRÓPRIO turno.
//     Corrigido: ColaboradorDashboard agora usa computeTurnAlertsPure
//     (turn-alerts.js) — a mesma fonte canônica que o badge de alertas e a
//     Prontidão já usam — filtrando só o nível 'warn' (turno ativo agora).
//   · tenant-sync.js T7 ("link ?token= morre na tela de login normal quando
//     a leitura falha por rede/5xx, sem uma palavra pro cliente") — ACHADO
//     REAL, ainda aberto. fetchTenantByToken devolve {ok:false,reason} tanto
//     pra "confirmei que não existe" (reason:'not-found') quanto pra "não
//     deu pra confirmar" (rede, 5xx, sessão) — main.jsx tratava os dois
//     igual: um console.warn mudo, caindo na tela de login comum sem
//     menção ao link. Corrigido: isTokenLookupInconclusive (pura, tenant-
//     sync.js) distingue os dois casos; handleAccessToken (main.jsx) alerta
//     só quando é o 2º (mesmo padrão de alert() já usado 3 linhas abaixo
//     pra "conta inativa") — sem alarmar por token genuinamente inválido.
//
// Sem @testing-library neste repo (mesmo padrão do resto da auditoria):
// lógica pura extraída ganha teste comportamental direto; o resto (JSX/
// handlers inline dentro de componentes não exportados, e main.jsx — que
// dispara ReactDOM.createRoot como efeito colateral do import, então não dá
// pra montar em teste algum) vira asserção posicional sobre o código-fonte.
// ─────────────────────────────────────────────────────────────────────────────

const fonteReportsViews = readFileSync(`${process.cwd()}/src/reports-views.jsx`, 'utf8');
const fonteRepository   = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
const fonteExtras       = readFileSync(`${process.cwd()}/src/extras.jsx`, 'utf8');
const fonteValidity     = readFileSync(`${process.cwd()}/src/validity.jsx`, 'utf8');
const fonteOverviewV2   = readFileSync(`${process.cwd()}/src/overview-v2.jsx`, 'utf8');
const fonteMain         = readFileSync(`${process.cwd()}/src/main.jsx`, 'utf8');

const RECORDS_KEY = 'nutriops.temperature.records';
const okJson      = (body) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const falhaDeRede = () => Promise.reject(new TypeError('Failed to fetch'));

beforeEach(() => {
  localStorage.clear();
  saveSupabaseConfig({ url: 'https://fake.supabase.co', anonKey: 'anon-fake', enabled: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

// ═══════════════════════════════════════════════════════════════════════════
// reports-views.jsx — os 2 achados desta rodada, AMBOS JÁ RESOLVIDOS antes
// desta sessão de triagem manual. Confirmação pontual + checagem de que a
// cobertura comportamental completa continua existindo nos arquivos certos.
// ═══════════════════════════════════════════════════════════════════════════

describe('reports-views.jsx — T2 (correção com Período=Todos não atualiza a tela): JÁ RESOLVIDO na tier média (af67790, v1.9.170)', () => {
  it('fonte: submitCorrection já atualiza extraRecords pelo id, sem esperar refetch', () => {
    const ini = fonteReportsViews.indexOf('const submitCorrection = async (r) => {');
    const fim = fonteReportsViews.indexOf('\n  const saveValidation', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonteReportsViews.slice(ini, fim);
    expect(corpo).toContain('setExtraRecords((prev) => prev?.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) ?? prev);');
  });

  it('cobertura comportamental completa (Família 4) continua em reports-views-medios-triagem.test.js — não duplicada aqui', () => {
    const fonteTeste = readFileSync(`${process.cwd()}/src/reports-views-medios-triagem.test.js`, 'utf8');
    expect(fonteTeste).toContain('submitCorrection atualiza extraRecords pelo id, não só a prop `records`');
  });
});

describe('reports-views.jsx — T7 ("Todos" corta o cache sem ordenar, repository.js:448): JÁ RESOLVIDO na tier grave, ANTES desta sessão (2679fd0, v1.9.155)', () => {
  it('fonte: o único chamador de days:0 deste arquivo continua o mesmo — repository.list({ tenantId: t.id, days: 0 })', () => {
    expect(fonteReportsViews).toContain('const items = await repository.list({ tenantId: t.id, days: 0 });');
  });

  it('fonte (repository.js): o ramo days<=0 ordena por createdAt e usa MAX_CACHE_RECORDS — o slice antigo (Math.max(1000, allRows.length), sem ordenar) não existe mais', () => {
    expect(fonteRepository).toContain('const porData = merged.sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));');
    expect(fonteRepository).toContain('return filtrarEscopo(porData, tenantId, days);          // tela: completo');
    expect(fonteRepository).not.toContain('lw(RECORDS_KEY, merged.slice(0, Math.max(1000, allRows.length)));');
  });

  it('cobertura comportamental completa ("achado 3/6") continua em repository-altos-triagem.test.js — não duplicada aqui', () => {
    const fonteTeste = readFileSync(`${process.cwd()}/src/repository-altos-triagem.test.js`, 'utf8');
    expect(fonteTeste).toContain('achado 3/6 — "Todos" ordena antes de cortar o cache global (JÁ CORRIGIDO)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// repository.js — mecanismo real por trás da correção de extras.jsx: o array
// devolvido por supabaseRepository.list() é marcado com `_fromCache: true`
// quando a nuvem falha e ele cai pro cache local (mesmo idioma do `_pending`
// que create()/update() já usam pra escrita que não confirmou).
// ═══════════════════════════════════════════════════════════════════════════

describe('repository.js — supabaseRepository.list() marca _fromCache quando a nuvem falha e cai pro cache local', () => {
  it('days>0: sbFetch rejeita (rede) → cai pro cache local, array marcado com _fromCache:true', async () => {
    lw(RECORDS_KEY, [{ id: 'a', tenantId: 'swiss', createdAt: new Date().toISOString() }]);
    vi.stubGlobal('fetch', vi.fn(falhaDeRede));
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 90 });
    expect(rows._fromCache).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('days>0: leitura com sucesso NÃO marca _fromCache — comportamento normal preservado', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 90 });
    expect(rows._fromCache).toBeUndefined();
  });

  it('days<=0 ("Todos"): sbFetch rejeita → cai pro cache local, também marcado com _fromCache:true', async () => {
    lw(RECORDS_KEY, [{ id: 'b', tenantId: 'swiss', createdAt: new Date().toISOString() }]);
    vi.stubGlobal('fetch', vi.fn(falhaDeRede));
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 0 });
    expect(rows._fromCache).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });

  it('days<=0: leitura com sucesso NÃO marca _fromCache', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 0 });
    expect(rows._fromCache).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// extras.jsx — MonthlyExportView não confunde mais "falha de leitura" com
// "mês sem registro"
// ═══════════════════════════════════════════════════════════════════════════

describe('extras.jsx — anyFromCache agrega o sinal de _fromCache de vários tenants', () => {
  it('nenhum tenant caiu pro cache → false', () => {
    expect(anyFromCache([{ fromCache: false }, { fromCache: false }])).toBe(false);
  });

  it('pelo menos 1 tenant caiu pro cache → true — 1 loja com leitura incompleta já é o suficiente pra não confiar no total do relatório', () => {
    expect(anyFromCache([{ fromCache: false }, { fromCache: true }])).toBe(true);
  });

  it('lista vazia ou ausente (defensivo) → false', () => {
    expect(anyFromCache([])).toBe(false);
    expect(anyFromCache(undefined)).toBe(false);
    expect(anyFromCache(null)).toBe(false);
  });
});

describe('extras.jsx — MonthlyExportView lê o sinal de _fromCache e avisa (fonte)', () => {
  const ini = fonteExtras.indexOf('export function MonthlyExportView({ allTenants, records, session }) {');
  const fim = fonteExtras.indexOf('export function accessLogToCsv', ini);
  const corpo = fonteExtras.slice(ini, fim);

  it('lê items._fromCache ANTES do .map() (que descartaria a propriedade, por não ser índice do array) e agrega com anyFromCache', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain('return { fromCache: Boolean(items._fromCache), items: items.map((r) => ({ ...r, tenantName: r.tenantName ?? t.name })) };');
    expect(corpo).toContain('setExtraFailed(anyFromCache(all));');
  });

  it('falha do Promise.all inteiro (não só de 1 tenant) também marca extraFailed — nenhum caminho de erro fica sem sinal', () => {
    expect(corpo).toContain('.catch(() => { if (!cancelled) { setLoadingExtra(false); setExtraFailed(true); } });');
  });

  it('trocar de mês/empresa reseta extraFailed junto com extraRecords — não herda o aviso de uma consulta anterior', () => {
    expect(corpo).toContain('if (daysNeeded <= 90) { setExtraRecords(null); setExtraFailed(false); return; }');
  });

  it('banner de aviso fica visível na TELA quando extraFailed — não é mais só um console.warn que ninguém lê', () => {
    expect(corpo).toContain('{!loadingExtra && extraFailed && (');
    expect(corpo).toContain('Não foi possível confirmar na nuvem o histórico completo deste mês agora');
  });

  it('o PDF gerado (a evidência de fiscalização de verdade) também carrega o aviso — não só a tela', () => {
    expect(corpo).toContain('${extraFailed ? \'<div class="warn-banner">');
    expect(corpo).toContain('AVISO: a nuvem não confirmou o histórico completo deste mês no momento da geração');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validity.jsx — ValidityStockView não usa mais DEFAULT_OPEN_RULES (prazo de
// fábrica) sem avisar quando a sincronização de regras falha em silêncio
// ═══════════════════════════════════════════════════════════════════════════

describe('validity.jsx — areRulesUnconfirmed decide quando a falha de sync merece aviso', () => {
  it('sync falhou (ok:false) E nunca houve versão confirmada neste device → true (o caso do achado: prazo de fábrica sendo usado sem aviso)', () => {
    expect(areRulesUnconfirmed({ ok: false, reason: 'SB GET validity_rules: 401' }, false)).toBe(true);
  });

  it('sync falhou, mas já havia uma versão confirmada ANTES (local ou sync anterior) → false — "ficou com o valor de antes" não é novidade que mereça alarme', () => {
    expect(areRulesUnconfirmed({ ok: false, reason: 'offline_or_disabled' }, true)).toBe(false);
  });

  it('sync teve sucesso (aplicou mudança remota ou confirmou que o local já era o mais novo) → false, independente de haver confirmação prévia', () => {
    expect(areRulesUnconfirmed({ ok: true, applied: true }, false)).toBe(false);
    expect(areRulesUnconfirmed({ ok: true, applied: false }, false)).toBe(false);
  });

  it('sem resultado (defensivo) → false', () => {
    expect(areRulesUnconfirmed(null, false)).toBe(false);
    expect(areRulesUnconfirmed(undefined, false)).toBe(false);
  });
});

describe('validity.jsx — ValidityStockView passa o resultado real de syncValidityRules pra areRulesUnconfirmed (fonte)', () => {
  const ini = fonteValidity.indexOf('export function ValidityStockView({');
  const fim = fonteValidity.indexOf('\n  const resetForm', ini);
  const corpo = fonteValidity.slice(ini, fim);

  it('o .then() agora recebe o result (antes era descartado) e checa o carimbo local real via readRulesUpdatedAt', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain('syncValidityRules(activeTenant.id).then((result) => {');
    expect(corpo).toContain('setRulesUnconfirmed(areRulesUnconfirmed(result, Boolean(readRulesUpdatedAt(activeTenant.id))));');
  });

  it('reseta rulesUnconfirmed no início de cada troca de tenant — não herda o aviso da loja anterior', () => {
    expect(corpo).toContain('setRulesUnconfirmed(false);');
  });

  it('o `.then()` antigo, que ignorava o resultado por completo, não existe mais neste arquivo', () => {
    expect(fonteValidity).not.toContain("syncValidityRules(activeTenant.id).then(() => {\n      if (vivo) setRules(readOpenRules(activeTenant.id));\n    });");
  });
});

describe('validity.jsx — o banner de aviso aparece pra QUALQUER aba, não só Regras — imprimir pela lista de Produtos também usa o prazo de fábrica sem passar por lá', () => {
  it('o banner (condicionado a rulesUnconfirmed) fica ANTES da renderização condicional por aba, não escondido dentro de renderRules', () => {
    const posBanner = fonteValidity.indexOf('{rulesUnconfirmed && (');
    const posTabs = fonteValidity.indexOf("{tab === 'dashboard' && renderDashboard()}");
    expect(posBanner).toBeGreaterThan(-1);
    expect(posTabs).toBeGreaterThan(posBanner);
  });

  it('o texto do aviso cita a aba Regras E o botão Abrir — pra quem só vê a lista de Produtos entender de onde vem o prazo impresso', () => {
    expect(fonteValidity).toContain('prazo de fábrica do sistema — pode não ser o que a RT configurou pra esta loja');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// overview-v2.jsx — achado 1/2: WeeklyHeatmap lê o catálogo VIVO, não a
// semente do tenant
// ═══════════════════════════════════════════════════════════════════════════

describe('overview-v2.jsx — WeeklyHeatmap usa o catálogo sincronizado (nutriops.equipment.catalog.{id}), não a semente t.equipmentCatalog', () => {
  it('fonte: o loop de linhas do heatmap usa readEquipmentCatalog(t) — o t.equipmentCatalog direto não existe mais ali', () => {
    const ini = fonteOverviewV2.indexOf('function WeeklyHeatmap({ tenants, records, onCellClick }) {');
    const fim = fonteOverviewV2.indexOf('\nfunction ActivityTimeline', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonteOverviewV2.slice(ini, fim);
    // A chamada foi içada pra uma variável em 21/08 (recordBelongsTo precisa do
    // catálogo INTEIRO pra resolver apelido, não só do item da vez). O que este
    // teste protege é a FONTE do catálogo, não a forma do laço.
    expect(corpo).toContain('const catalogoDoTenant = readEquipmentCatalog(t);');
    expect(corpo).toContain('for (const eq of catalogoDoTenant) {');
    expect(corpo).not.toContain('for (const eq of (t.equipmentCatalog || [])) {');
    expect(corpo).not.toContain('t.equipmentCatalog');
  });

  it('fonte: readEquipmentCatalog lê a MESMA chave que syncEquipmentCatalog/EquipmentView escrevem, com dedupeCatalog (mesmo idioma de reports-views.jsx/team-views.jsx/maintenance.jsx)', () => {
    expect(fonteOverviewV2).toContain("const catalogKey = (id) => `nutriops.equipment.catalog.${id}`;");
    expect(fonteOverviewV2).toContain('const readEquipmentCatalog = (t) => dedupeCatalog(load(catalogKey(t.id), t.equipmentCatalog ?? []));');
  });

  it('mecanismo real: equipamento cadastrado DEPOIS da criação da loja (só existe no catálogo vivo, ausente de t.equipmentCatalog) aparece quando lido pela chave certa — e ficaria invisível com t.equipmentCatalog puro (o bug)', () => {
    const tenant = { id: 'casadoce', equipmentCatalog: [{ label: 'Freezer 1', location: 'Cozinha' }] }; // semente: só 1 item, nunca atualizada
    localStorage.setItem('nutriops.equipment.catalog.casadoce', JSON.stringify([
      { label: 'Freezer 1', location: 'Cozinha' },
      { label: 'Câmara nova', location: 'Estoque' }, // cadastrada depois — só existe no catálogo vivo
    ]));
    // Reimplementação fiel do helper de overview-v2.jsx (mesmo texto, mesma
    // chave, mesmo dedupeCatalog REAL importado de limits.js) — prova o
    // mecanismo sem exportar uma função interna só pra teste.
    const catalogKey = (id) => `nutriops.equipment.catalog.${id}`;
    const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
    const readEquipmentCatalog = (t) => dedupeCatalog(load(catalogKey(t.id), t.equipmentCatalog ?? []));

    const vivo = readEquipmentCatalog(tenant).map((e) => e.label);
    const comportamentoAntigo = (tenant.equipmentCatalog || []).map((e) => e.label); // era isso que WeeklyHeatmap usava

    expect(vivo).toEqual(['Freezer 1', 'Câmara nova']);
    expect(comportamentoAntigo).toEqual(['Freezer 1']); // a forma antiga NUNCA veria "Câmara nova"
  });

  it('loja sem catálogo vivo salvo ainda (ex.: criada pelo /admin, nunca abriu Equipamentos neste device) cai pra semente — sem regressão pro caso normal', () => {
    const tenant = { id: 'nova-loja', equipmentCatalog: [{ label: 'Balcão', location: 'Loja' }] };
    const catalogKey = (id) => `nutriops.equipment.catalog.${id}`;
    const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
    const readEquipmentCatalog = (t) => dedupeCatalog(load(catalogKey(t.id), t.equipmentCatalog ?? []));
    expect(readEquipmentCatalog(tenant).map((e) => e.label)).toEqual(['Balcão']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// overview-v2.jsx — achado 2/2: "Pendentes no turno" (ColaboradorDashboard)
// agora é por TURNO, não pelo dia inteiro
// ═══════════════════════════════════════════════════════════════════════════

describe('overview-v2.jsx — computeTurnAlertsPure (mecanismo real por trás do fix): leitura de um turno não conta como "feito" pro turno seguinte', () => {
  const catalog = [{ label: 'Freezer 1', location: 'Cozinha' }, { label: 'Câmara fria', location: 'Estoque' }];
  const turns = [
    { id: 'manha', name: 'Manhã', start: '06:00', end: '11:59' },
    { id: 'tarde', name: 'Tarde', start: '12:00', end: '17:59' },
  ];

  it('os dois equipamentos foram lidos de manhã; às 14h (turno Tarde ativo, zero leituras desde 12h) os DOIS voltam a ficar pendentes — o cenário exato do achado', () => {
    const records = [
      { tenantId: 't1', equipment: 'Freezer 1', createdAt: '2026-08-19T08:00:00' },
      { tenantId: 't1', equipment: 'Câmara fria', createdAt: '2026-08-19T08:30:00' },
    ];
    const agora = new Date('2026-08-19T14:00:00');
    const alerts = computeTurnAlertsPure(turns, records, catalog, 't1', false, agora);
    const pendentesAgora = new Set(alerts.filter((a) => a.level === 'warn').map((a) => a.equipment));
    expect([...pendentesAgora].sort()).toEqual(['Câmara fria', 'Freezer 1']);
  });

  it('uma leitura DENTRO da janela do turno da tarde remove só aquele equipamento da pendência', () => {
    const records = [
      { tenantId: 't1', equipment: 'Freezer 1', createdAt: '2026-08-19T08:00:00' },
      { tenantId: 't1', equipment: 'Freezer 1', createdAt: '2026-08-19T13:00:00' }, // registrado de novo, já na tarde
    ];
    const agora = new Date('2026-08-19T14:00:00');
    const alerts = computeTurnAlertsPure(turns, records, catalog, 't1', false, agora);
    const pendentesAgora = new Set(alerts.filter((a) => a.level === 'warn').map((a) => a.equipment));
    expect(pendentesAgora.has('Freezer 1')).toBe(false); // já medido na tarde
    expect(pendentesAgora.has('Câmara fria')).toBe(true); // essa ainda não
  });

  it('modo implantação (treino) suprime a pendência de turno — mesma regra que o badge de alertas já respeita', () => {
    const records = [];
    const agora = new Date('2026-08-19T14:00:00');
    const alerts = computeTurnAlertsPure(turns, records, catalog, 't1', true, agora);
    expect(alerts).toEqual([]);
  });

  it('o comportamento ANTIGO de `pending` (todayMs = meia-noite) dava "tudo registrado" nesse exato cenário — reimplementação fiel da fórmula que motivou o achado', () => {
    const todayMs = new Date('2026-08-19T00:00:00').getTime();
    const records = [
      { equipment: 'Freezer 1', createdAt: '2026-08-19T08:00:00' },
      { equipment: 'Câmara fria', createdAt: '2026-08-19T08:30:00' },
    ];
    const pendingAntigo = catalog.filter((eq) => {
      const historico = records.filter((r) => r.equipment === eq.label);
      const jaTemHoje = historico.find((r) => new Date(r.createdAt).getTime() >= todayMs);
      return !jaTemHoje;
    });
    expect(pendingAntigo).toEqual([]); // "0 pendentes, tudo registrado" às 14h sem medir nada na tarde — o bug relatado
  });
});

describe('overview-v2.jsx — ColaboradorDashboard usa computeTurnAlertsPure pra "pending", não mais o corte por todayMs (fonte)', () => {
  const ini = fonteOverviewV2.indexOf('function ColaboradorDashboard({ session, activeTenant, equipmentCatalog, records, onLaunchKiosk, onNavigate, onRecordSaved }) {');
  const fim = fonteOverviewV2.indexOf('\n  return (', ini);
  const corpo = fonteOverviewV2.slice(ini, fim);

  it('pending vem de computeTurnAlertsPure, filtrando só o nível "warn" (turno ativo agora)', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain('computeTurnAlertsPure(turns, normalizedForTurns, equipmentCatalog, activeTenant.id, activeTenant.implantacao === true)');
    expect(corpo).toContain("turnAlerts.filter(a => a.level === 'warn')");
  });

  it('o corte antigo por todayMs (equipmentHistory.get + history.find >= todayMs) não existe mais na definição de pending', () => {
    expect(corpo).not.toContain('const history = equipmentHistory.get(eq.label) ?? [];');
    expect(corpo).not.toContain('const lastToday = history.find(r => new Date(r.createdAt).getTime() >= todayMs);');
  });

  it('turns vem de readTurns(activeTenant) — mesma fonte que SupervisorDashboard já usa pro KPI de cobertura, não hardcoded', () => {
    expect(corpo).toContain('const turns = readTurns(activeTenant);');
  });

  it('records são normalizados pro label canônico (getEquipmentEntry) ANTES de entrar em computeTurnAlertsPure — preserva o matching case-insensitive/alias que buildEquipmentHistory garante nesta mesma tela, que a troca pra matching exato do turn-alerts regrediria sem isso', () => {
    expect(corpo).toContain('const entry = getEquipmentEntry(equipmentCatalog || [], r.equipmentInput) ?? getEquipmentEntry(equipmentCatalog || [], r.equipmentKey);');
    expect(corpo).toContain('return entry ? { ...r, equipment: entry.label, equipmentInput: entry.label } : r;');
  });
});

describe('overview-v2.jsx — normalização por alias antes do turno: mecanismo real (getEquipmentEntry + computeTurnAlertsPure juntos)', () => {
  it('equipamento renomeado (label novo "Freezer 01", nome antigo "Freezer" virou alias): registro gravado com o nome ANTIGO, dentro do turno, ainda conta como "feito" pro label NOVO', () => {
    const catalog = [{ label: 'Freezer 01', aliases: ['Freezer'], location: 'Cozinha' }];
    const turns = [{ id: 'tarde', name: 'Tarde', start: '12:00', end: '17:59' }];
    const recordsCrus = [{ tenantId: 't1', equipmentInput: 'Freezer', createdAt: '2026-08-19T13:00:00' }]; // nome velho, mas dentro do turno
    const agora = new Date('2026-08-19T14:00:00');

    // ⚠️ ESTA ASSERÇÃO INVERTEU EM 21/08, e isso é a correção, não uma
    // regressão. Antes, computeTurnAlertsPure casava por nome EXATO, então
    // record cru com o nome antigo virava "pendente por engano" — e esta
    // linha travava esse defeito pra justificar a normalização que a
    // overview-v2 faz antes de chamar. Só que a overview-v2 era a ÚNICA que
    // normalizava: pages.jsx (badge do menu e tela de Alertas) passava os
    // records CRUS, e ali o alerta falso acontecia de verdade.
    // Agora a própria função resolve por apelido (recordBelongsTo), então o
    // caminho cru também acerta e a gambiarra virou redundância inofensiva.
    const semNormalizar = computeTurnAlertsPure(turns, recordsCrus, catalog, 't1', false, agora);
    expect(semNormalizar.some((a) => a.level === 'warn' && a.equipment === 'Freezer 01')).toBe(false);

    // normalizado (o que ColaboradorDashboard faz agora): resolve pro label
    // canônico antes — "Freezer 01" sai da lista de pendentes
    const normalizados = recordsCrus.map((r) => {
      const entry = getEquipmentEntry(catalog, r.equipmentInput) ?? getEquipmentEntry(catalog, r.equipmentKey);
      return entry ? { ...r, equipment: entry.label, equipmentInput: entry.label } : r;
    });
    const comNormalizacao = computeTurnAlertsPure(turns, normalizados, catalog, 't1', false, agora);
    expect(comNormalizacao.some((a) => a.level === 'warn' && a.equipment === 'Freezer 01')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// tenant-sync.js / main.jsx — link ?token= não morre mais em silêncio quando
// a leitura falha por rede/5xx
// ═══════════════════════════════════════════════════════════════════════════

describe('tenant-sync.js — isTokenLookupInconclusive distingue "link confirmado inválido" de "não deu pra confirmar"', () => {
  it('reason "not-found" (consultou e confirmou que o token não existe) → false — não é caso de "tente de novo"', () => {
    expect(isTokenLookupInconclusive({ ok: false, reason: 'not-found' })).toBe(false);
  });

  it('qualquer outro motivo de falha (rede, HTTP 5xx, sessão, Supabase off) → true — merece avisar quem abriu o link, não regenerar o token à toa', () => {
    expect(isTokenLookupInconclusive({ ok: false, reason: 'Failed to fetch' })).toBe(true);
    expect(isTokenLookupInconclusive({ ok: false, reason: '503' })).toBe(true);
    expect(isTokenLookupInconclusive({ ok: false, reason: 'no-supabase' })).toBe(true);
  });

  it('sucesso (ok:true) → false', () => {
    expect(isTokenLookupInconclusive({ ok: true, tenant: {} })).toBe(false);
  });

  it('sem resultado (defensivo) → false', () => {
    expect(isTokenLookupInconclusive(null)).toBe(false);
    expect(isTokenLookupInconclusive(undefined)).toBe(false);
  });
});

describe('tenant-sync.js — fetchTenantByToken + isTokenLookupInconclusive juntos, ponta a ponta (rede real mockada, sem passar por main.jsx)', () => {
  it('Supabase fora do ar (503 na RPC): fetchTenantByToken devolve reason que NÃO é not-found — isTokenLookupInconclusive confirma que merece aviso', async () => {
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' }));
    const { fetchTenantByToken, isTokenLookupInconclusive: isInconclusive } = await import('./tenant-sync.js');

    const result = await fetchTenantByToken('nt_abc123');
    expect(result.ok).toBe(false);
    expect(result.reason).not.toBe('not-found');
    expect(isInconclusive(result)).toBe(true);
  });

  it('token genuinamente inexistente (RPC responde 200 com lista vazia): reason vira not-found — isTokenLookupInconclusive confirma que NÃO merece o aviso de "tente de novo"', async () => {
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '[]', json: async () => [] }));
    const { fetchTenantByToken, isTokenLookupInconclusive: isInconclusive } = await import('./tenant-sync.js');

    const result = await fetchTenantByToken('nt_token_que_nao_existe');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-found');
    expect(isInconclusive(result)).toBe(false);
  });
});

describe('main.jsx — handleAccessToken avisa quando a leitura do token é inconclusiva (fonte — não dá pra montar main.jsx em teste: ReactDOM.createRoot roda como efeito colateral do import)', () => {
  const ini = fonteMain.indexOf('async function handleAccessToken() {');
  const fim = fonteMain.indexOf('\n  // Clean URL without reload', ini);
  const corpo = fonteMain.slice(ini, fim);

  it('importa isTokenLookupInconclusive de tenant-sync.js e usa o result real (antes era só um console.warn, resultado descartado)', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain("const { fetchTenantByToken, isTenantSyncEnabled, isTokenLookupInconclusive } = await import('./tenant-sync');");
    expect(corpo).toContain('lookupInconclusive = isTokenLookupInconclusive(result);');
  });

  it('o early-return de "token não resolvido" agora alerta quando a falha foi inconclusiva — mesmo padrão de alert() já usado logo abaixo pra "conta inativa"', () => {
    const posBlocoTokenInvalido = corpo.indexOf('if (!client && !remoteTenant) {');
    const posAlertLookup = corpo.indexOf('if (lookupInconclusive) {');
    const posBlocoContaInativa = corpo.indexOf('if (client && !client.active) {');
    expect(posBlocoTokenInvalido).toBeGreaterThan(-1);
    expect(posBlocoContaInativa).toBeGreaterThan(posBlocoTokenInvalido);
    // o aviso de lookup fica DENTRO do bloco de token não resolvido — antes
    // do próximo bloco (conta inativa), nunca depois
    expect(posAlertLookup).toBeGreaterThan(posBlocoTokenInvalido);
    expect(posAlertLookup).toBeLessThan(posBlocoContaInativa);
    expect(corpo).toContain("alert('Não foi possível confirmar seu link de acesso agora");
  });

  it('o fallback original (não bloquear a app, só não popular nada) continua de pé — o fix só ACRESCENTA o aviso, não muda o que acontece depois', () => {
    expect(corpo).toContain('// Token inválido ou Supabase off. Não bloqueamos a app — só não popula');
    expect(corpo).toContain('    return;\n  }');
  });

  it('a URL com ?token= não é limpa neste caminho — window.history.replaceState só roda DEPOIS do early-return de "token não resolvido", então recarregar a página tenta de novo sozinho', () => {
    const posEarlyReturn = fonteMain.indexOf('if (!client && !remoteTenant) {', ini);
    const posReplaceState = fonteMain.indexOf('window.history.replaceState', ini);
    expect(posEarlyReturn).toBeGreaterThan(-1);
    expect(posReplaceState).toBeGreaterThan(posEarlyReturn);
  });
});
