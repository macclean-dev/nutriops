import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildEquipmentHistory } from './overview-v2';
import { confirmParticipantAt } from './training';
import { summarizeDossieRun } from './dossie-view';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos ÚLTIMOS 6 achados de gravidade MÉDIA sem perda de dado do
// pool inteiro (169 não-julgados da auditoria de falha silenciosa, 18-19/08) —
// espalhados em 5 arquivos pequenos: superadmin-view.jsx (2), training.jsx (1),
// import-template-modal.jsx (1), dossie-view.jsx (1), overview-v2.jsx (1).
// Fecha a tier "média sem perda de dado" inteira (69 achados).
//
// Os 6:
//   · overview-v2.jsx (T6, "histórico casa só por label exato") — ACHADO REAL,
//     e a classificação de "código inalcançável" desta auditoria estava
//     ERRADA/DESATUALIZADA pra este achado: confundia o NOME DO ARQUIVO
//     overview-v2.jsx com a VIEW-KEY 'overview-v2'. Desde o commit 2fd22b8
//     (18/07, v1.9.45, "nova Visão Geral (v2) vira o padrão") o arquivo
//     overview-v2.jsx é montado sob a view-key 'overview' — a Visão Geral
//     PADRÃO de todo login, primeiro item do nav (nav.js). É a v1 antiga
//     (OverviewView, dentro de pages.jsx) que ficou dormente sob a view-key
//     'overview-v2' pra rollback — o inverso do que a classificação supunha.
//     Corrigido: equipmentHistory (SupervisorDashboard E ColaboradorDashboard,
//     código idêntico duplicado) casava só por igualdade exata de string;
//     agora casa por label OU alias, case-insensitive — mesma regra do
//     resolveLimits/getEquipmentEntry (limits.js), extraída pra
//     buildEquipmentHistory (exportada, pura).
//   · training.jsx (T4, "toque confirma todos os homônimos") — ACHADO REAL.
//     confirmParticipant casava por p.name === name; duas colaboradoras
//     homônimas (sem guarda contra nome duplicado em team-views.jsx, fora do
//     escopo deste arquivo) confirmavam as DUAS com um toque só. Corrigido pra
//     casar por ÍNDICE na lista (confirmParticipantAt, exportada, pura).
//   · import-template-modal.jsx (T1, "reenviar o mesmo arquivo não faz nada")
//     — ACHADO REAL. <input type="file"> não resetava e.target.value; mesmo
//     padrão já corrigido em forms.jsx/settings.jsx. Corrigido.
//   · dossie-view.jsx (T6, "conta empresas pedidas, não janelas abertas") —
//     ACHADO REAL (a guarda de window.open null JÁ estava corrigida — só a
//     contagem final estava errada). Corrigido: summarizeDossieRun (exportada,
//     pura) conta janelas de fato abertas, não tenants.length.
//   · superadmin-view.jsx T7 ("leitura da nuvem falha vira lista só com
//     seeds, sem avisar") — JÁ ESTAVA RESOLVIDO por uma rodada anterior desta
//     mesma sessão (rodada admin.jsx): o useEffect de hidratação já distingue
//     cloud === null (mostra aviso) de cloud === [] (zero confirmado). Já
//     coberto por "Família B — superadmin-view.jsx: mesmo contrato null/[]
//     não quebra o caller compartilhado" em src/admin-medios-triagem.test.js —
//     não duplicado aqui.
//   · superadmin-view.jsx T4 ("trocar plano revoga o PIN novo de outro
//     device") — ACHADO REAL. bestEffortPush relia o registro CRU do
//     localStorage e mandava pushTenant(c) inteiro; se este device tinha um
//     setupPinHash desatualizado (PIN regenerado em OUTRO device via /admin),
//     esse hash STALE — por ser uma string de verdade, não null — vencia o
//     `coalesce(excluded.setup_pin_hash, t.setup_pin_hash)` da RPC e revogava
//     em silêncio o PIN novo que o cliente já tinha recebido. Corrigido:
//     bestEffortPush agora manda setupPinHash: undefined (mesma disciplina já
//     usada em ClientModal.handleSave, admin.jsx) — um push de PLANO nunca
//     deveria carregar credencial.
//
// Sem @testing-library neste repo (mesmo padrão dos outros arquivos desta
// sessão): lógica pura extraída ganha teste comportamental direto; o resto
// (JSX/handlers inline dentro de componentes não exportados) vira asserção
// posicional sobre o código-fonte.
// ─────────────────────────────────────────────────────────────────────────────

const fonteOverviewV2   = readFileSync(`${process.cwd()}/src/overview-v2.jsx`, 'utf8');
const fonteTraining     = readFileSync(`${process.cwd()}/src/training.jsx`, 'utf8');
const fonteImportModal  = readFileSync(`${process.cwd()}/src/import-template-modal.jsx`, 'utf8');
const fonteDossie       = readFileSync(`${process.cwd()}/src/dossie-view.jsx`, 'utf8');
const fonteSuperAdmin   = readFileSync(`${process.cwd()}/src/superadmin-view.jsx`, 'utf8');
const fontePages        = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const fonteNav          = readFileSync(`${process.cwd()}/src/nav.js`, 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
// overview-v2.jsx — ALCANCE primeiro, depois o achado
// ═══════════════════════════════════════════════════════════════════════════

describe('overview-v2.jsx — ALCANCE: é a Visão Geral padrão desde 18/07 (v1.9.45), não código morto', () => {
  it('pages.jsx monta OverviewV2 (componente deste arquivo) sob a view-key "overview" — a que o nav expõe por padrão', () => {
    expect(fontePages).toContain("const OverviewV2           = lazyView(() => import('./overview-v2'), 'OverviewV2');");
    expect(fontePages).toContain("activeView === 'overview'   && <OverviewV2");
  });

  it('nav.js expõe a view-key "overview" (não "overview-v2") como 1º item de "Operação" — é a home de todo login', () => {
    expect(fonteNav).toContain("['overview',  'overview',  'Visão geral']");
  });

  it('é a v1 antiga (OverviewView) que ficou dormente sob a view-key "overview-v2" pra rollback — o inverso da suposição de "arquivo overview-v2.jsx = view-key overview-v2 = fora do nav"', () => {
    expect(fontePages).toContain("activeView === 'overview-v2' && <OverviewView");
  });

  it('BetaBar (o "escape" que a classificação antiga citava) está mesmo morta — mas isso é só uma função interna não chamada, não prova que o ARQUIVO inteiro é inalcançável', () => {
    expect(fonteOverviewV2).toContain('function BetaBar({ onBack }) {'); // a função existe...
    expect(fonteOverviewV2).toContain('v2 é a Visão Geral padrão (não é mais beta) — sem a BetaBar promocional.'); // ...mas nunca é chamada
  });
});

describe('overview-v2.jsx — buildEquipmentHistory casa por label OU alias, case-insensitive (mesma regra do resolveLimits)', () => {
  const catalog = [
    { label: 'Freezer 01', aliases: ['Freezer'], location: 'Cozinha', minTemp: -25, maxTemp: -18 },
    { label: 'Câmara fria', aliases: [], location: 'Estoque', minTemp: 0, maxTemp: 9 },
  ];

  it('equipamento RENOMEADO: registro salvo com o nome ANTERIOR (agora um alias) reconecta ao card atual', () => {
    // Caminho do achado: "Freezer" virou "Freezer 01" no catálogo; os
    // registros antigos continuam com equipmentInput: "Freezer".
    const records = [{ id: 'r1', equipmentInput: 'Freezer', value: -20, createdAt: '2026-08-01T10:00:00Z' }];
    const map = buildEquipmentHistory(catalog, records);
    expect(map.get('Freezer 01')).toHaveLength(1);
    expect(map.get('Freezer 01')[0].id).toBe('r1');
  });

  it('case diferente do label cadastrado (digitação livre no campo texto do TemperatureCapture) também casa', () => {
    const records = [{ id: 'r2', equipmentInput: 'freezer 01', value: -19, createdAt: '2026-08-02T10:00:00Z' }];
    const map = buildEquipmentHistory(catalog, records);
    expect(map.get('Freezer 01')).toHaveLength(1);
    expect(map.get('Freezer 01')[0].id).toBe('r2');
  });

  it('equipmentKey serve de fallback quando equipmentInput não casa com nada do catálogo', () => {
    const records = [{ id: 'r3', equipmentInput: 'texto digitado errado', equipmentKey: 'Câmara fria', value: 5, createdAt: '2026-08-03T10:00:00Z' }];
    const map = buildEquipmentHistory(catalog, records);
    expect(map.get('Câmara fria')).toHaveLength(1);
    expect(map.get('Câmara fria')[0].id).toBe('r3');
  });

  it('sem match nenhum (equipamento removido de vez do catálogo): registro continua descartado do mapa — não é regressão, é o comportamento correto', () => {
    const records = [{ id: 'r4', equipmentInput: 'Fritadeira que não existe mais', value: 5, createdAt: '2026-08-04T10:00:00Z' }];
    const map = buildEquipmentHistory(catalog, records);
    expect([...map.values()].flat().some((r) => r.id === 'r4')).toBe(false);
  });

  it('mantém ordem cronológica (mais antigo primeiro via unshift) — comportamento pré-existente preservado', () => {
    const records = [
      { id: 'novo',   equipmentInput: 'Freezer 01', value: -19, createdAt: '2026-08-05T10:00:00Z' },
      { id: 'antigo', equipmentInput: 'Freezer 01', value: -20, createdAt: '2026-08-01T10:00:00Z' },
    ]; // tenantRecords chega em ordem desc (mais novo primeiro); unshift inverte
    const map = buildEquipmentHistory(catalog, records);
    expect(map.get('Freezer 01').map((r) => r.id)).toEqual(['antigo', 'novo']);
  });

  it('SupervisorDashboard e ColaboradorDashboard delegam pro mesmo helper — o bug era duplicado byte-a-byte nos dois, agora é uma fonte só', () => {
    const ocorrencias = fonteOverviewV2.split('buildEquipmentHistory(equipmentCatalog, tenantRecords)').length - 1;
    // 1 na definição + 2 nos call sites (Supervisor e Colaborador)
    expect(ocorrencias).toBe(3);
    expect(fonteOverviewV2).not.toContain('map.get(r.equipmentInput) ?? map.get(r.equipmentKey)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// training.jsx — confirmParticipantAt
// ═══════════════════════════════════════════════════════════════════════════

describe('training.jsx — confirmParticipantAt confirma só a LINHA tocada, não todo mundo com o mesmo nome', () => {
  it('duas participantes homônimas: confirmar o índice 0 NÃO confirma o índice 1', () => {
    const participantes = [
      { name: 'Maria Silva', role: 'Cozinheira',           confirmed: false, confirmedAt: null }, // foi ao treino
      { name: 'Maria Silva', role: 'Auxiliar de cozinha',  confirmed: false, confirmedAt: null }, // homônima, NÃO foi
      { name: 'Ana Paula',   role: 'Confeiteira',           confirmed: false, confirmedAt: null },
    ];
    const atualizado = confirmParticipantAt(participantes, 0, '2026-08-19T12:00:00.000Z');
    expect(atualizado[0].confirmed).toBe(true);
    expect(atualizado[0].confirmedAt).toBe('2026-08-19T12:00:00.000Z');
    expect(atualizado[1].confirmed).toBe(false); // a homônima não tocada continua pendente
    expect(atualizado[1].confirmedAt).toBeNull();
    expect(atualizado[2].confirmed).toBe(false);
  });

  it('confirmar o índice 1 (a segunda Maria) não reconfirma retroativamente a primeira', () => {
    const participantes = [
      { name: 'Maria Silva', confirmed: false, confirmedAt: null },
      { name: 'Maria Silva', confirmed: false, confirmedAt: null },
    ];
    const atualizado = confirmParticipantAt(participantes, 1, 'TS');
    expect(atualizado[0].confirmed).toBe(false);
    expect(atualizado[1].confirmed).toBe(true);
  });

  it('não muta o array original (mesma disciplina de imutabilidade do resto do app)', () => {
    const participantes = [{ name: 'Maria Silva', confirmed: false, confirmedAt: null }];
    confirmParticipantAt(participantes, 0, 'TS');
    expect(participantes[0].confirmed).toBe(false);
  });

  it('confirmedAt tem default de new Date().toISOString() quando omitido', () => {
    const antes = Date.now();
    const [p] = confirmParticipantAt([{ name: 'X', confirmed: false }], 0);
    const depois = Date.now();
    const ts = new Date(p.confirmedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(antes);
    expect(ts).toBeLessThanOrEqual(depois);
  });

  it('índice fora do alcance não quebra nem confirma nada (defensivo)', () => {
    const participantes = [{ name: 'X', confirmed: false }];
    const atualizado = confirmParticipantAt(participantes, 5, 'TS');
    expect(atualizado).toEqual(participantes);
  });
});

describe('training.jsx — SessionDetail usa índice, não nome (fonte)', () => {
  it('confirmingIndex substitui confirmingName por completo — nenhum resquício do state antigo', () => {
    expect(fonteTraining).toContain('const [confirmingIndex, setConfirmingIndex] = useState(null);');
    expect(fonteTraining).not.toContain('confirmingName');
  });

  it('confirmParticipant do componente delega pra confirmParticipantAt — não reimplementa o .map inline de novo', () => {
    expect(fonteTraining).toContain('participants: confirmParticipantAt(session.participants, index)');
  });

  it('os dois onClick de confirmação (mostrar botão / confirmar de fato) usam o índice "i" do map, não p.name', () => {
    expect(fonteTraining).toContain('onClick={() => confirmParticipant(i)}');
    expect(fonteTraining).toContain('onClick={() => setConfirmingIndex(i)}');
    expect(fonteTraining).not.toContain('confirmParticipant(p.name)');
    expect(fonteTraining).not.toContain('setConfirmingName(p.name)');
  });

  it('as listas que renderizavam key={p.name} (lista de presença + botões de certificado) agora incluem o índice na key — evita colisão do React entre linhas homônimas', () => {
    const ocorrencias = fonteTraining.split('key={`${p.name}-${i}`}').length - 1;
    expect(ocorrencias).toBe(2);
    expect(fonteTraining).not.toContain('key={p.name}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// import-template-modal.jsx — reenvio do mesmo arquivo após erro
// ═══════════════════════════════════════════════════════════════════════════

describe('import-template-modal.jsx — reenviar o MESMO arquivo depois de um erro agora funciona', () => {
  it('o <input type="file"> reseta e.target.value logo após capturar o arquivo (mesmo padrão de forms.jsx:354 e settings.jsx)', () => {
    const posInput = fonteImportModal.indexOf('<input type="file" accept="image/*,application/pdf"');
    expect(posInput).toBeGreaterThan(-1);
    const posFimTag = fonteImportModal.indexOf('/>', posInput);
    expect(posFimTag).toBeGreaterThan(posInput);
    const trechoInput = fonteImportModal.slice(posInput, posFimTag);
    expect(trechoInput).toContain('handleFile(e.target.files?.[0])');
    expect(trechoInput).toContain("e.target.value = '';");
    // reset DEPOIS de capturar o arquivo (senão files?.[0] já teria sumido)
    expect(trechoInput.indexOf('handleFile(')).toBeLessThan(trechoInput.indexOf("e.target.value = '';"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dossie-view.jsx — summarizeDossieRun
// ═══════════════════════════════════════════════════════════════════════════

describe('dossie-view.jsx — summarizeDossieRun conta janelas de fato ABERTAS, não empresas pedidas', () => {
  it('tudo abriu: ok, count = quantidade pedida', () => {
    expect(summarizeDossieRun(4, 4)).toEqual({ ok: true, count: 4 });
  });

  it('bloqueador de pop-up barrou 3 das 4 (só a 1ª ativação de clique vale): ok:false, mensagem cita quanto abriu de fato', () => {
    const r = summarizeDossieRun(4, 1);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('3 de 4');
    expect(r.message).toContain('abriu só 1');
  });

  it('empresa única bloqueada: mensagem no singular, sem número confuso ("0 de 1")', () => {
    const r = summarizeDossieRun(1, 0);
    expect(r.ok).toBe(false);
    expect(r.message).toBe('O navegador bloqueou a janela de impressão. Libere pop-ups para este site e gere de novo.');
  });

  it('nenhuma empresa selecionada (edge case defensivo): não afirma bloqueio inexistente', () => {
    expect(summarizeDossieRun(0, 0)).toEqual({ ok: true, count: 0 });
  });
});

describe('dossie-view.jsx — handleGenerate usa o contador real (fonte)', () => {
  it('opened só incrementa DEPOIS do guard de null, e o resultado final vem de summarizeDossieRun — não sobrou o bug antigo (tenants.length direto)', () => {
    const ini = fonteDossie.indexOf('const handleGenerate = async () => {');
    const fim = fonteDossie.indexOf('\n  return (', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonteDossie.slice(ini, fim);
    const posGuard     = corpo.indexOf('if (!win) continue');
    const posIncrement = corpo.indexOf('opened++;');
    const posResumo    = corpo.indexOf('setResult(summarizeDossieRun(tenants.length, opened));');
    expect(posGuard).toBeGreaterThan(-1);
    expect(posIncrement).toBeGreaterThan(posGuard);
    expect(posResumo).toBeGreaterThan(posIncrement);
    expect(corpo).not.toContain('setResult({ ok: true, count: tenants.length });');
  });

  it('a guarda de window.open contra null (já corrigida numa rodada anterior desta auditoria) continua de pé', () => {
    const ini = fonteDossie.indexOf('const handleGenerate = async () => {');
    const corpo = fonteDossie.slice(ini, fonteDossie.indexOf('\n  return (', ini));
    expect(corpo).toContain("window.open('', '_blank')");
    expect(corpo).toContain('if (!win) continue');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// superadmin-view.jsx — T4 (T7 já resolvido e já testado em admin-medios-triagem.test.js)
// ═══════════════════════════════════════════════════════════════════════════

describe('superadmin-view.jsx — T4: mudar plano não revoga mais o PIN novo gerado em outro device', () => {
  it('bestEffortPush nunca manda o setupPinHash local pro pushTenant — vira undefined pra RPC não sobrescrever a nuvem', () => {
    const ini = fonteSuperAdmin.indexOf('const bestEffortPush = async (tenantId) => {');
    const fim = fonteSuperAdmin.indexOf('\n  const changePlan', ini);
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    const corpo = fonteSuperAdmin.slice(ini, fim);
    expect(corpo).toContain('pushTenant({ ...c, setupPinHash: undefined })');
    // a forma antiga (bug): mandava o registro cru sem tirar o campo
    expect(corpo).not.toMatch(/return await pushTenant\(c\);/);
  });

  it('changePlan é o único chamador de bestEffortPush — o fix cobre o único caminho de push deste arquivo', () => {
    const chamadas = fonteSuperAdmin.split('bestEffortPush(tenant.id)').length - 1;
    expect(chamadas).toBe(1); // só dentro de changePlan
    expect(fonteSuperAdmin).toContain('const bestEffortPush = async (tenantId) => {'); // a única definição
  });
});

describe('tenant-sync.js pushTenant — mecanismo real por trás do achado: setupPinHash undefined vira null na RPC (coalesce preserva a nuvem); valor real VENCE o coalesce', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock('./auth');
    vi.resetModules();
  });

  const baseTenant = {
    id: 'casadoce', accessToken: 'nt_abc', name: 'CASA DOCE', segment: 'Padaria', plan: 'loja',
    brandColor: '#000', brandSoft: '#fff', equipmentCatalog: [], modules: [], stores: [],
    adminEmail: 'x@x.com', adminName: 'X', trialEndsAt: null,
  };

  it('setupPinHash: undefined (o que bestEffortPush manda agora) vira p_setup_pin_hash: null no corpo da RPC — coalesce preserva o hash da nuvem', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.doMock('./auth', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('jwt-valido') }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const { pushTenant } = await import('./tenant-sync.js');

    const r = await pushTenant({ ...baseTenant, setupPinHash: undefined });
    expect(r.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.p_setup_pin_hash).toBeNull();
  });

  it('setupPinHash com valor real (o bug ANTES do fix: bestEffortPush mandava `c` cru) vaza direto pro corpo da RPC — é isso que vencia o coalesce e revogava o PIN novo', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.doMock('./auth', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('jwt-valido') }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const { pushTenant } = await import('./tenant-sync.js');

    await pushTenant({ ...baseTenant, setupPinHash: 'HASH_ANTIGO_H1' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.p_setup_pin_hash).toBe('HASH_ANTIGO_H1');
  });
});
