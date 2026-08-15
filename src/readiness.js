// ─────────────────────────────────────────────────────────────────────────────
// Prontidão para Fiscalização — motor de decisão (Fatia 1, 15/08).
//
// Origem: `docs/AUDITORIA_RDC_2026.md` §5. O app registra conformidade muito
// bem, mas ninguém sabia responder "a loja está pronta pra uma fiscalização
// AGORA?" sem abrir sete telas. Aqui essa resposta vira uma conta só, pura e
// testável — padrão de `limits.js`/`verdict.js`/`nonconformities.js`.
//
// Três decisões que valem mais que o código:
//
// 1. `unknown` é status de primeira classe. Ausência de dado NÃO é "ok" — é a
//    mesma lição do `pct: null` em `conformityStats` (limits.js:68). Uma loja
//    sem produto cadastrado não tem "estoque em ordem"; ela tem um módulo
//    vazio, o que é outra coisa.
// 2. `unknown` NUNCA gera EM RISCO. Falta de dado não é infração comprovada —
//    seria injusto pintar de vermelho quem só não capturou ainda.
// 3. Sem score numérico. Um "87% pronta" seria inventado e indefensável na
//    frente do fiscal. Veredito categórico + contagem por gravidade.
//
// Este módulo NÃO lê localStorage nem importa React: quem busca os dados é a
// view (`readiness-view.jsx`), do mesmo jeito que `dossie-view.jsx` alimenta
// o `dossier.js`.
// ─────────────────────────────────────────────────────────────────────────────

import { conformityStats } from './limits';
import { employeeTrainingStatus } from './training-status';

// ─── Suposições e réguas ────────────────────────────────────────────────────
// ⚠️ `dedetizacaoMeses` é SUPOSIÇÃO, não texto de norma (auditoria §4.1): a
// RDC 216 não fixa prazo de dedetização — 6 meses é o contrato típico de
// mercado. A VISA local e o contrato da loja mandam mais que isto. Na Fatia 2
// vira configurável por loja; até lá, uma constante honesta e comentada é
// melhor que um número escondido no meio de um `if`.
export const READINESS_DEFAULTS = {
  dedetizacaoMeses: 6,        // suposição §4.1 — sem tela de config nesta fatia
  dedetizacaoAvisoDias: 30,   // avisa antes de vencer, em vez de só no dia
  ncWindowDays: 30,           // §4.11 manda reter registro por ≥30 dias
  cicloDias: 30,              // "ciclo" dos controles especiais
  desvioJanelaDias: 7,        // janela de "desvio crítico recorrente"
  desvioCriticoMin: 2,        // 2+ críticos no MESMO equipamento = recorrente
  syncStaleDias: 7,           // sync mais velho que isso já é sinal amarelo
};

// Os 4 POPs obrigatórios da RDC 216 §4.11. O módulo de POPs (controls.jsx) tem
// categoria livre e nenhuma categoria para "reservatório" — então o casamento
// é por categoria OU por palavra no título, e é DELIBERADAMENTE frouxo: o
// resultado só gera `warn`, nunca `fail`, porque o POP pode existir em papel
// (e a RDC aceita papel). Errar pra menos aqui custa um aviso; errar pra mais
// custaria a confiança na tela inteira.
export const REQUIRED_POPS = [
  { id: 'higienizacao', label: 'Higienização de instalações, equipamentos e móveis',
    categories: ['limpeza'],      keywords: ['higieniza', 'limpeza', 'desinfec', 'sanitiza'] },
  { id: 'pragas', label: 'Controle integrado de vetores e pragas',
    categories: ['pragas'],       keywords: ['praga', 'vetor', 'dedetiz', 'inseto', 'roedor'] },
  { id: 'reservatorio', label: 'Higienização do reservatório de água',
    categories: [],               keywords: ['reservat', 'caixa d', 'caixa-d', 'cisterna', 'potabil'] },
  { id: 'higiene_saude', label: 'Higiene e saúde dos manipuladores',
    categories: ['higiene'],      keywords: ['higiene pessoal', 'manipulador', 'saude', 'saúde'] },
];

export const VERDICT_LABEL = {
  ready:     'PRONTA',
  attention: 'PRONTA COM RESSALVAS',
  risk:      'EM RISCO',
};

// Veredito → classe de badge do design system (styles.css:263-267).
export const VERDICT_TONE = { ready: 'ok', attention: 'warn', risk: 'danger' };

export const STATUS_LABEL = { ok: 'Em ordem', warn: 'Ressalva', fail: 'Pendente', unknown: 'Sem dado' };
export const STATUS_TONE  = { ok: 'ok',       warn: 'warn',     fail: 'danger',   unknown: 'neutral' };

// Pior primeiro — é a ordem em que a RT quer ler.
const STATUS_ORDER = { fail: 0, warn: 1, unknown: 2, ok: 3 };
export function byWorstStatus(a, b) { return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]; }

const GROUP_TITLES = {
  A: 'Gera auto de infração na hora',
  B: 'Documentação que o fiscal pede na entrada',
  C: 'Registros vivos dos últimos 30 dias',
  D: 'A evidência sobrevive a uma troca de aparelho?',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const chk = (id, label, status, detail, severity, navTarget = null) =>
  ({ id, label, status, detail, severity, navTarget });

const txt = (v) => String(v ?? '').trim();
const lower = (v) => txt(v).toLowerCase();
const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
const diasDesde = (iso, now) => Math.floor((now - new Date(iso).getTime()) / 86400000);

// Mesma conta de dias do `sectionValidity` (dossier.js:98-104) — meia-noite
// contra meia-noite, pra "vence hoje" não virar "vencido ontem" por fuso.
export function productDaysLeft(product, now = Date.now()) {
  const effective = product?.openedUntil ? String(product.openedUntil).slice(0, 10) : product?.expiryDate;
  if (!effective) return null;
  return Math.round((new Date(effective + 'T00:00').getTime() - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
}

export function popMatchesRequirement(pop, requirement) {
  if (requirement.categories.includes(lower(pop?.category))) return true;
  const title = lower(pop?.title);
  return requirement.keywords.some((k) => title.includes(k));
}

export function missingRequiredPOPs(pops = []) {
  return REQUIRED_POPS.filter((req) => !(pops ?? []).some((pop) => popMatchesRequirement(pop, req)));
}

// Equipamentos com desvio CRÍTICO recorrente na janela. Reaproveita
// `conformityStats` (limits.js) em vez de recontar tone na mão — uma régua só.
export function recurrentCriticalEquipment(records = [], { minCritical = 2 } = {}) {
  const byEquip = new Map();
  for (const r of records) {
    const key = txt(r?.equipment || r?.equipmentInput) || '—';
    if (!byEquip.has(key)) byEquip.set(key, []);
    byEquip.get(key).push(r);
  }
  return [...byEquip.entries()]
    .map(([equipment, recs]) => ({ equipment, ...conformityStats(recs) }))
    .filter((e) => e.danger >= minCritical)
    .sort((a, b) => b.danger - a.danger);
}

// ─── Veredito ───────────────────────────────────────────────────────────────
//
// FAIL no grupo A ⇒ EM RISCO (é o que autua na hora).
// Qualquer fail/warn em qualquer grupo, ou `unknown` no grupo A ⇒ RESSALVAS.
// `unknown` fora do A não puxa o veredito: B4 (Manual de BP) e C3 (controle
// sem inferência segura) são buracos conhecidos de captura, não risco medido.
//
// Consequência assumida: enquanto A6 (reservatório) e A7 (ASO) não tiverem
// captura — a Fatia 2 —, NENHUMA loja lê "PRONTA". É proposital: são duas
// exigências clássicas de autuação que o app hoje não sabe responder, e
// carimbar "PRONTA" sem elas seria mentira confortável.
export function computeVerdict(groups = []) {
  const groupA = groups.find((g) => g.id === 'A')?.checks ?? [];
  if (groupA.some((c) => c.status === 'fail')) return 'risk';
  const all = groups.flatMap((g) => g.checks);
  if (all.some((c) => c.status === 'fail' || c.status === 'warn')) return 'attention';
  if (groupA.some((c) => c.status === 'unknown')) return 'attention';
  return 'ready';
}

export function countByStatus(groups = []) {
  const counts = { ok: 0, warn: 0, fail: 0, unknown: 0 };
  for (const g of groups) for (const c of g.checks) counts[c.status] += 1;
  return counts;
}

// ─── Motor ──────────────────────────────────────────────────────────────────

export function computeReadiness(inputs = {}) {
  const {
    tenant = {},
    now = Date.now(),
    defaults = READINESS_DEFAULTS,
    pendingNc = [],              // NC já filtradas por período E por excludeWithAction
    products = [],
    turnAlerts = [],
    catalog = [],                // catálogo de temperatura, já dedupado
    temperatureRecords = [],     // só os desta loja
    staff = [],
    trainingSessions = [],
    trainingValidityMonths = 12,
    formTemplates = [],
    formRecords = [],
    pendingForms = [],
    pops = [],
    companyProfile = {},
    controlsByType = {},
    sync = {},
    localOnly = {},
  } = inputs;

  const cfg = { ...READINESS_DEFAULTS, ...defaults };

  // ── Grupo A — gera auto de infração na hora ───────────────────────────────
  const a = [];

  // A1 · NC sem ação corretiva registrada (as 4 origens de nonconformities.js)
  a.push(chk('a1-nc-sem-acao', 'Não conformidade sem ação corretiva',
    pendingNc.length > 0 ? 'fail' : 'ok',
    pendingNc.length > 0
      ? `${plural(pendingNc.length, 'não conformidade', 'não conformidades')} dos últimos ${cfg.ncWindowDays} dias sem ação registrada. O fiscal cobra a evidência da correção, não só o registro do desvio.`
      : `Nenhuma não conformidade em aberto nos últimos ${cfg.ncWindowDays} dias.`,
    'critical', 'actions'));

  // A2 · Produto vencido no estoque
  if ((products ?? []).length === 0) {
    a.push(chk('a2-vencidos', 'Produto vencido no estoque', 'unknown',
      'Nenhum produto cadastrado em Validades — o app não tem como saber o que está no estoque. Isso é ausência de dado, não estoque em ordem.',
      'critical', 'validity'));
  } else {
    const vencidos = products
      .map((p) => ({ ...p, days: productDaysLeft(p, now) }))
      .filter((p) => p.days !== null && p.days < 0)
      .sort((x, y) => x.days - y.days);
    const pior = vencidos[0];
    a.push(chk('a2-vencidos', 'Produto vencido no estoque',
      vencidos.length > 0 ? 'fail' : 'ok',
      vencidos.length > 0
        ? `${plural(vencidos.length, 'produto vencido', 'produtos vencidos')} ainda no estoque — o mais antigo é "${txt(pior.name) || 'sem nome'}", vencido há ${Math.abs(pior.days)} dia(s). Produto vencido em área de manipulação é autuação na hora.`
        : 'Nenhum produto vencido no estoque.',
      'critical', 'validity'));
  }

  // A3 · Temperatura — turnos de hoje pendentes
  if (tenant.implantacao === true) {
    a.push(chk('a3-turno', 'Registro de temperatura por turno', 'ok',
      'Loja em implantação: os alertas de pendência de turno ficam suspensos até o início oficial da operação.',
      'critical', 'alerts'));
  } else if ((catalog ?? []).length === 0) {
    a.push(chk('a3-turno', 'Registro de temperatura por turno', 'unknown',
      'Nenhum equipamento no catálogo desta loja — sem catálogo, o app não tem como cobrar registro de turno nem provar cobertura.',
      'critical', 'equipment'));
  } else {
    // `turnAlerts` tem um item por PAR (turno × equipamento) — contar o array
    // direto dizia "20 equipamentos sem registro" numa loja com 10, porque o
    // mesmo freezer aparece uma vez por turno vencido. Contamos equipamentos
    // DISTINTOS, e tiramos dos "pendentes" quem já entrou em "atrasados" pra
    // não somar a mesma geladeira duas vezes na frase.
    const atrasados = new Set(turnAlerts.filter((t) => t.level === 'danger').map((t) => t.equipment));
    const pendentes = new Set(turnAlerts.filter((t) => t.level === 'warn').map((t) => t.equipment));
    for (const eq of atrasados) pendentes.delete(eq);
    a.push(chk('a3-turno', 'Registro de temperatura por turno',
      atrasados.size > 0 ? 'fail' : pendentes.size > 0 ? 'warn' : 'ok',
      atrasados.size > 0
        ? `${plural(atrasados.size, 'equipamento ficou', 'equipamentos ficaram')} sem registro em turno já encerrado hoje${pendentes.size ? `, e mais ${pendentes.size} está(ão) pendente(s) no turno atual` : ''}. Planilha de temperatura com buraco é o primeiro item que o fiscal folheia.`
        : pendentes.size > 0
          ? `${plural(pendentes.size, 'equipamento pendente', 'equipamentos pendentes')} no turno atual — ainda dá tempo de registrar.`
          : `Nenhum equipamento pendente nos turnos avaliados hoje (${catalog.length} no catálogo).`,
      'critical', 'alerts'));
  }

  // A3b · Desvio crítico recorrente nos últimos 7 dias
  const janela = now - cfg.desvioJanelaDias * 86400000;
  const recentes = (temperatureRecords ?? []).filter((r) => new Date(r.createdAt).getTime() >= janela);
  if (recentes.length === 0) {
    a.push(chk('a3-desvio', 'Desvio crítico recorrente de temperatura', 'unknown',
      `Nenhuma leitura de temperatura nos últimos ${cfg.desvioJanelaDias} dias. Sem leitura não há como afirmar que os equipamentos estão em faixa — isso é ausência de dado, não conformidade.`,
      'critical', 'charts'));
  } else {
    const recorrentes = recurrentCriticalEquipment(recentes, { minCritical: cfg.desvioCriticoMin });
    const criticos = conformityStats(recentes).danger;
    a.push(chk('a3-desvio', 'Desvio crítico recorrente de temperatura',
      recorrentes.length > 0 ? 'fail' : criticos > 0 ? 'warn' : 'ok',
      recorrentes.length > 0
        ? `${plural(recorrentes.length, 'equipamento com', 'equipamentos com')} desvio crítico repetido em ${cfg.desvioJanelaDias} dias — o pior é "${recorrentes[0].equipment}" (${recorrentes[0].danger} leituras fora). Repetição indica equipamento com defeito, não erro de leitura.`
        : criticos > 0
          ? `${plural(criticos, 'leitura crítica isolada', 'leituras críticas isoladas')} nos últimos ${cfg.desvioJanelaDias} dias, sem repetição no mesmo equipamento.`
          : `${recentes.length} leituras nos últimos ${cfg.desvioJanelaDias} dias, nenhuma crítica.`,
      'critical', 'charts'));
  }

  // A4 · Capacitação vencida ou nunca feita (§4.6 — "comprovada mediante documentação")
  const AVISO_LOCAL = 'Atenção: capacitação hoje vive só no localStorage deste aparelho (auditoria §3.5) — se a RT usa outro device, os comprovantes de lá não chegam aqui.';
  // `!== 'Inativo'`, não `=== 'Ativo'`: a tela Equipe oferece três status
  // (Ativo/Pendente/Inativo) e o resto do app trata "Pendente" como gente que
  // opera — ela aparece no login (pages.jsx) e no seletor de operador
  // (operator-picker.jsx:22), ambos filtrando só `!== 'Inativo'`. Com o filtro
  // estrito, um manipulador "Pendente" sem capacitação nenhuma sumia do A4 e a
  // loja lia "todos em dia".
  const ativos = (staff ?? []).filter((u) => (u?.status ?? 'Ativo') !== 'Inativo');
  if (ativos.length === 0) {
    a.push(chk('a4-capacitacao', 'Capacitação dos manipuladores', 'unknown',
      `Nenhum colaborador ativo cadastrado nesta loja — sem equipe cadastrada não há como verificar capacitação. ${AVISO_LOCAL}`,
      'critical', 'training'));
  } else {
    const situacoes = ativos.map((u) => ({ name: u.name, ...employeeTrainingStatus(u.name, trainingSessions, trainingValidityMonths, now) }));
    const vencidos = situacoes.filter((s) => s.status === 'expired' || s.status === 'never');
    const renovar = situacoes.filter((s) => s.status === 'warn');
    a.push(chk('a4-capacitacao', 'Capacitação dos manipuladores',
      vencidos.length > 0 ? 'fail' : renovar.length > 0 ? 'warn' : 'ok',
      vencidos.length > 0
        ? `${plural(vencidos.length, 'colaborador ativo', 'colaboradores ativos')} de ${ativos.length} com capacitação vencida ou nunca registrada (${vencidos.slice(0, 3).map((s) => s.name).join(', ')}${vencidos.length > 3 ? '…' : ''}). ${AVISO_LOCAL}`
        : renovar.length > 0
          ? `${plural(renovar.length, 'colaborador entrando', 'colaboradores entrando')} na janela de renovação. ${AVISO_LOCAL}`
          : `Todos os ${ativos.length} colaboradores ativos com capacitação em dia. ${AVISO_LOCAL}`,
      'critical', 'training'));
  }

  // A5 · Dedetização vencida (prazo = suposição, ver READINESS_DEFAULTS)
  const tplDedetizacao = new Set((formTemplates ?? []).filter((t) => t.category === 'dedetizacao').map((t) => t.id));
  // Data = `createdAt` (quando o comprovante foi lançado), NUNCA `updatedAt`:
  // a validação da RT reescreve `updatedAt` sem tocar no conteúdo
  // (forms.jsx `handleValidate`), então uma dedetização de 8 meses atrás
  // "rejuvenescia" no dia em que a RT carimbasse a planilha — justo o
  // vencimento que este check existe pra pegar.
  // Limitação conhecida: a data REAL da dedetização é um campo dentro das
  // respostas, e o id desse campo muda por seed. Lançamento retroativo
  // continua contando pela data do lançamento. Fica pra Fatia 2.
  const regsDedetizacao = tplDedetizacao.size === 0 ? [] : (formRecords ?? [])
    .filter((r) => tplDedetizacao.has(r.formId) && r.status === 'submitted')
    .sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
  if (tplDedetizacao.size === 0) {
    a.push(chk('a5-dedetizacao', 'Comprovante de dedetização', 'unknown',
      'Esta loja não tem planilha de dedetização cadastrada — não dá pra afirmar nada sobre o controle de pragas por empresa especializada.',
      'critical', 'forms'));
  } else if (regsDedetizacao.length === 0) {
    a.push(chk('a5-dedetizacao', 'Comprovante de dedetização', 'unknown',
      'Nenhum comprovante de dedetização preenchido até agora. A planilha existe, mas nunca foi entregue — sem registro, o app não sabe se a loja está em dia.',
      'critical', 'forms'));
  } else {
    const ultimo = regsDedetizacao[0];
    const dias = diasDesde(ultimo.createdAt, now);
    const limite = cfg.dedetizacaoMeses * 30;
    a.push(chk('a5-dedetizacao', 'Comprovante de dedetização',
      dias > limite ? 'fail' : (limite - dias) <= cfg.dedetizacaoAvisoDias ? 'warn' : 'ok',
      dias > limite
        ? `Última dedetização registrada há ${dias} dias — passou do prazo de ${cfg.dedetizacaoMeses} meses adotado como régua.`
        : (limite - dias) <= cfg.dedetizacaoAvisoDias
          ? `Última dedetização há ${dias} dias; pela régua de ${cfg.dedetizacaoMeses} meses, vence em ${limite - dias} dia(s). Vale agendar a próxima.`
          : `Última dedetização registrada há ${dias} dias, dentro da régua de ${cfg.dedetizacaoMeses} meses.`,
      'critical', 'forms'));
  }

  // A6/A7 · Sem captura no app até a Fatia 2 — `unknown` honesto + o caminho.
  a.push(chk('a6-reservatorio', 'Higienização semestral do reservatório', 'unknown',
    'O app ainda não captura este registro (auditoria §3.7). A RDC 216 exige higienização do reservatório em intervalo máximo de 6 meses, COM registro — hoje isso vive no papel da loja. Entra na Fatia 2.',
    'critical'));
  a.push(chk('a7-aso', 'Controle de saúde dos manipuladores (ASO)', 'unknown',
    'O app ainda não captura este registro (auditoria §3.4). É item clássico de autuação: o fiscal pede ASO/exames válidos por colaborador. Entra na Fatia 2.',
    'critical'));

  // ── Grupo B — documentação de entrada ─────────────────────────────────────
  const b = [];
  const rtNome = txt(companyProfile.rtNome), rtCrn = txt(companyProfile.rtCrn);
  const faltaRT = [!rtNome && 'nome da RT', !rtCrn && 'CRN'].filter(Boolean);
  b.push(chk('b1-rt-crn', 'Responsável Técnico e CRN no perfil',
    faltaRT.length > 0 ? 'fail' : 'ok',
    faltaRT.length > 0
      ? `Falta preencher ${faltaRT.join(' e ')} em Configurações. Sem isso, os PDFs e o dossiê saem sem a identificação que o fiscal confere primeiro.`
      : `${rtNome} · ${rtCrn}.`,
    'high', 'settings'));

  const alvara = txt(companyProfile.alvara);
  b.push(chk('b2-alvara', 'Alvará sanitário',
    alvara ? 'ok' : 'fail',
    alvara
      ? `Alvará ${alvara} registrado. Ressalva: o app guarda só o número — a DATA DE VALIDADE não é rastreada, então esta tela não avisa se ele venceu. Entra na Fatia 2.`
      : 'Número do alvará não preenchido em Configurações.',
    'high', 'settings'));

  const popsFaltando = missingRequiredPOPs(pops);
  b.push(chk('b3-pops', 'Os 4 POPs obrigatórios (§4.11)',
    popsFaltando.length > 0 ? 'warn' : 'ok',
    popsFaltando.length > 0
      ? `Não encontrei POP para: ${popsFaltando.map((p) => p.label).join('; ')}. Só ressalva, não pendência: o POP pode existir impresso — mas aí ele não sai no dossiê, e some se este aparelho for trocado.`
      : 'Os 4 POPs obrigatórios estão cadastrados.',
    'high', 'pops'));

  b.push(chk('b4-manual-bp', 'Manual de Boas Práticas', 'unknown',
    'O app ainda não registra a existência do Manual (auditoria §3.18) — nem arquivo, nem versão/data. O fiscal aceita o manual impresso, mas esta tela não tem como afirmar que ele existe. Entra na Fatia 2.',
    'high'));

  // ── Grupo C — registros vivos dos últimos 30 dias ─────────────────────────
  const c = [];
  if ((formTemplates ?? []).length === 0) {
    c.push(chk('c1-planilhas', 'Planilhas BPF do período', 'unknown',
      'Nenhuma planilha BPF cadastrada nesta loja.',
      'medium', 'forms'));
  } else {
    c.push(chk('c1-planilhas', 'Planilhas BPF do período',
      pendingForms.length > 0 ? 'warn' : 'ok',
      pendingForms.length > 0
        ? `${plural(pendingForms.length, 'planilha em aberto', 'planilhas em aberto')} no período atual: ${pendingForms.slice(0, 3).map((f) => f.title).join('; ')}${pendingForms.length > 3 ? '…' : ''}.`
        : `Todas as ${formTemplates.length} planilhas do período atual entregues.`,
      'medium', 'forms'));
  }

  const aguardando = (formRecords ?? []).filter((r) => r.status === 'submitted' && !r.validation);
  c.push(chk('c2-validacao-rt', 'Planilhas aguardando validação da RT',
    aguardando.length > 0 ? 'warn' : 'ok',
    aguardando.length > 0
      ? `${plural(aguardando.length, 'planilha entregue', 'planilhas entregues')} sem o carimbo de validação da RT. A RDC 275 reforça registro verificado — planilha sem verificação vale menos numa inspeção.`
      : 'Nenhuma planilha entregue esperando validação.',
    'medium', 'forms'));

  // C3 · Aplicabilidade inferida do catálogo. "Tem fritadeira ⇒ óleo é
  // aplicável" é a ÚNICA inferência segura hoje (auditoria §4). Descongelamento,
  // resfriamento e térmico dependem do que a loja produz, coisa que o catálogo
  // não conta — então `unknown`, nunca `fail`. Conservador de propósito: um
  // falso "faltou registrar" queima a credibilidade da tela inteira.
  const temFritadeira = (catalog ?? []).some((eq) => lower(eq?.label).includes('frit'));
  if (!temFritadeira) {
    c.push(chk('c3-controles', 'Controles especiais aplicáveis no ciclo', 'unknown',
      'Não dá pra inferir com segurança quais controles especiais se aplicam a esta loja: o catálogo de equipamentos é a única pista disponível e não há fritadeira nele. Descongelamento, resfriamento e tratamento térmico dependem do que a loja produz — o app não pergunta isso ainda.',
      'medium', 'controls'));
  } else {
    const cicloStart = now - cfg.cicloDias * 86400000;
    const regsOleo = (controlsByType.oil ?? []).filter((r) => new Date(r.createdAt).getTime() >= cicloStart);
    c.push(chk('c3-controles', 'Controle de óleo de fritura no ciclo',
      regsOleo.length > 0 ? 'ok' : 'warn',
      regsOleo.length > 0
        ? `${plural(regsOleo.length, 'teste de óleo registrado', 'testes de óleo registrados')} nos últimos ${cfg.cicloDias} dias (aplicável porque há fritadeira no catálogo).`
        : `Há fritadeira no catálogo e nenhum teste de óleo nos últimos ${cfg.cicloDias} dias. A fita de acidez é o que a VISA pede pra provar troca de óleo.`,
      'medium', 'oil'));
  }

  // ── Grupo D — a evidência sobrevive? ──────────────────────────────────────
  const d = [];
  if (!sync.enabled) {
    d.push(chk('d1-sync', 'Sincronização com a nuvem', 'fail',
      'Supabase desligado neste aparelho: TODO registro está só aqui. Perder ou limpar o device apaga a evidência — e a RDC exige reter registro por no mínimo 30 dias.',
      'low', 'settings'));
  } else if (!sync.lastSync) {
    d.push(chk('d1-sync', 'Sincronização com a nuvem', 'warn',
      'Supabase ligado, mas este aparelho ainda não completou nenhum sync. Até o primeiro, os dados daqui não existem na nuvem.',
      'low', 'settings'));
  } else {
    const dias = diasDesde(sync.lastSync, now);
    d.push(chk('d1-sync', 'Sincronização com a nuvem',
      dias > cfg.syncStaleDias ? 'warn' : 'ok',
      dias > cfg.syncStaleDias
        ? `Último sync há ${dias} dias. Nada garante que o que foi registrado desde então chegou na nuvem.`
        : `Último sync há ${dias} dia(s).`,
      'low', 'settings'));
  }

  const fila = sync.queueLength ?? 0;
  d.push(chk('d2-fila', 'Fila de envio offline',
    fila > 0 ? 'warn' : 'ok',
    fila > 0
      ? `${plural(fila, 'registro esperando', 'registros esperando')} pra subir. Eles existem só neste aparelho até a fila esvaziar.`
      : 'Fila vazia — nada preso neste aparelho.',
    'low', 'settings'));

  const soLocal = [
    localOnly.pops > 0 && plural(localOnly.pops, 'POP', 'POPs'),
    localOnly.training > 0 && plural(localOnly.training, 'capacitação', 'capacitações'),
    localOnly.maintenance > 0 && plural(localOnly.maintenance, 'registro de manutenção', 'registros de manutenção'),
  ].filter(Boolean);
  d.push(chk('d3-local-only', 'Dados que existem só neste aparelho',
    soLocal.length > 0 ? 'warn' : 'ok',
    soLocal.length > 0
      ? `${soLocal.join(', ')} não sincronizam com a nuvem (auditoria §2). Limpar ou trocar este aparelho apaga essa evidência sem deixar rastro. A Fatia 3 resolve.`
      : 'Nenhum POP, capacitação ou manutenção registrado neste aparelho — nada a perder aqui, mas também nada a apresentar.',
    'low'));

  const groups = [
    { id: 'A', title: GROUP_TITLES.A, checks: a },
    { id: 'B', title: GROUP_TITLES.B, checks: b },
    { id: 'C', title: GROUP_TITLES.C, checks: c },
    { id: 'D', title: GROUP_TITLES.D, checks: d },
  ];

  return {
    tenantId: tenant.id ?? null,
    tenantName: tenant.name ?? '',
    verdict: computeVerdict(groups),
    counts: countByStatus(groups),
    groups,
    generatedAt: now,
  };
}
