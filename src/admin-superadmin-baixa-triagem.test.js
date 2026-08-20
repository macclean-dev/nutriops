import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTenantMetrics, computeTenantAlerts, bucketByDay } from './admin';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 5 achados de gravidade BAIXA sem perda de dado que
// apontam pra src/admin.jsx (4) e src/superadmin-view.jsx (1) — pool de 169
// não-julgados da auditoria de falha silenciosa (18-19/08,
// data_achados_pendentes_19-08.json). Último lote da tier "baixa" — tratados
// juntos de propósito: os dois arquivos compartilham componentes
// (ClientModal/AccessTokenModal, definidos em admin.jsx e reusados por
// superadmin-view.jsx). Rodadas anteriores desta tier: settings.jsx (a30e01c),
// repository.js (0209d0d). Sem @testing-library neste repo (mesma convenção
// do resto da auditoria): UI vira asserção de código-fonte + reimplementação
// pura ("modelo") das decisões; lógica de verdade exportada
// (buildTenantMetrics, computeTenantAlerts, bucketByDay) ganha teste
// comportamental real, chamando a função de PRODUÇÃO — não uma cópia.
//
// Todos os 5 eram reais. Viraram 3 famílias:
//
//   · Família A (T2 + T3, admin.jsx) — AccessTokenModal: "Copiar link" e "Só
//     token" dividiam o mesmo state `copied` (rótulo de "Só token" era string
//     FIXA, nunca refletia nada — quem acendia "Copiado" era sempre o botão
//     vizinho) e a função `copy` não tinha try/catch nem checagem da Clipboard
//     API — falha virava unhandled rejection muda, sem NENHUM feedback.
//     Corrigido com estado por campo ({field, status}) + guarda, mesmo padrão
//     que o SetupPinReveal (linhas acima no mesmo arquivo) já usa.
//
//   · Família B (T6, admin.jsx) — dois defeitos em HealthView, ambos no
//     mesmo bug raiz de "silêncio antes de qualquer regra rodar":
//       B.1 lastActivity vinha de dentro do MESMO agregado filtrado a 7d, e
//           por isso nunca podia passar de ~7 dias — o tier "danger" (10d+)
//           de computeTenantAlerts era estruturalmente inalcançável, e o
//           tenant que passasse de 7 dias sem registro PERDIA a própria
//           chave em metricsByTenant antes da regra de inatividade rodar.
//       B.2 bucketByDay chaveava por data UTC (fatiando a string ISO direto)
//           enquanto o bucket de "hoje" nascia de meia-noite LOCAL — no
//           Brasil (UTC-3), registro feito a partir de ~21h cai no dia UTC
//           seguinte: pro bucket de hoje essa chave não existe (registro
//           silenciosamente descartado); pros dias do meio da janela existe,
//           mas é a ERRADA (registro aparece um dia adiantado).
//     Corrigido: buildTenantMetrics (extraído, exportado, testável) computa
//     lastActivity como MAX sobre os 30d inteiros já buscados (não só 7d);
//     bucketByDay chaveia por data LOCAL (extrai ano/mês/dia do Date, não
//     fatia a string ISO).
//
//   · Família C (T6, superadmin-view.jsx) — Audit log: o badge mostrava
//     audit.length inteiro (ex.: 137) enquanto a lista renderizada cortava
//     fixo em 30 sem paginação nem aviso — quem procurasse uma ação de mais
//     de 30 entradas atrás não tinha como chegar lá pela tela, mesmo com o
//     dado intacto no localStorage (cap real: 500, superadmin.js). Corrigido
//     com "Mostrar mais" (client-side, zero fetch — array já carregado
//     inteiro) + badge honesto ("30 de 137") enquanto a lista está cortada.
// ─────────────────────────────────────────────────────────────────────────────

const fonte          = readFileSync(`${process.cwd()}/src/admin.jsx`, 'utf8');
const fonteSuperAdmin = readFileSync(`${process.cwd()}/src/superadmin-view.jsx`, 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA A (T2 + T3) — AccessTokenModal: copy() ganha estado por campo + guarda
// ═══════════════════════════════════════════════════════════════════════════

describe('Família A — AccessTokenModal.copy() não confirma mais no botão errado nem engole falha de clipboard', () => {
  const iniATM = fonte.indexOf('export function AccessTokenModal({ client, onClose, onClientUpdate }) {');
  const fimATM = fonte.indexOf('// HEALTH VIEW — saúde operacional dos tenants', iniATM);
  const corpo = fonte.slice(iniATM, fimATM);

  it('existe o componente e a slice não está vazia', () => {
    expect(iniATM).toBeGreaterThan(-1);
    expect(corpo.length).toBeGreaterThan(0);
  });

  it('o `copied` boolean único sumiu — vira copyState com campo próprio ({field, status})', () => {
    expect(corpo).not.toContain('const [copied, setCopied] = useState(false);');
    expect(corpo).toContain("const [copyState, setCopyState] = useState({ field: null, status: null });");
  });

  it('copy() recebe (text, field) — não é mais fixo num texto só', () => {
    expect(corpo).toContain('const copy = (text, field) => {');
  });

  it('checa a Clipboard API ANTES de chamar .writeText — mesma guarda do SetupPinReveal', () => {
    expect(corpo).toContain('if (!navigator.clipboard?.writeText) {');
  });

  it('tem .then/.catch encadeado — não é mais um await solto sem try/catch nem .catch', () => {
    expect(corpo).not.toContain('const copy = async (text) => {\n    await navigator.clipboard.writeText(text);');
    expect(corpo).toMatch(/navigator\.clipboard\.writeText\(text\)\s*\.then\(\(\) => \{[\s\S]*?\}\)\s*\.catch\(\(\) => \{/);
  });

  it('os dois botões passam o PRÓPRIO field ("url" / "token") — não chamam mais copy(x) com 1 argumento só', () => {
    expect(corpo).toContain("onClick={() => copy(url, 'url')}");
    expect(corpo).toContain("onClick={() => copy(client.accessToken, 'token')}");
    expect(corpo).not.toContain('onClick={() => copy(url)}');
    expect(corpo).not.toContain('onClick={() => copy(client.accessToken)}');
  });

  it('"Só token" deixou de ser rótulo FIXO — agora reflete copyState igual ao "Copiar link"', () => {
    expect(corpo).not.toMatch(/>\s*Só token\s*<\/button>/);
    expect(corpo).toContain("copyState.field==='token' && copyState.status==='copied' ? 'Copiado'");
    expect(corpo).toContain("copyState.field==='url' && copyState.status==='copied' ? 'Copiado'");
  });

  it('falha de clipboard ganhou estado visível ("Falha — copie manualmente") nos dois botões', () => {
    const ocorrencias = corpo.split("'Falha — copie manualmente'").length - 1;
    expect(ocorrencias).toBe(2);
  });

  // Prova por reimplementação (mesma técnica de "modelo" já usada em
  // admin-medios-triagem.test.js Família C, pra este MESMO componente): sem
  // @testing-library, modela a árvore de decisão do rótulo de cada botão a
  // partir de copyState, e comprova que o bug antigo (state único
  // compartilhado) não se reproduz mais.
  function decideLabel(copyState, field, defaultLabel) {
    if (copyState.field !== field) return defaultLabel;
    if (copyState.status === 'copied') return 'Copiado';
    if (copyState.status === 'failed') return 'Falha — copie manualmente';
    return defaultLabel;
  }

  it('ANTES (bug): um `copied` booleano compartilhado faria os DOIS rótulos flipar juntos — comprovado com o modelo do state antigo', () => {
    // reimplementação do contrato antigo: um único boolean, sem noção de "qual" campo
    function decideLabelAntigo(copiedBoolCompartilhado, defaultLabel) {
      return copiedBoolCompartilhado ? 'Copiado' : defaultLabel;
    }
    const copiedComTokenClicado = true; // clicou "Só token", setCopied(true) executou
    // o botão "Copiar link" também acendia "Copiado" — ESSE é o bug do achado T2
    expect(decideLabelAntigo(copiedComTokenClicado, 'Copiar link')).toBe('Copiado');
  });

  it('DEPOIS (corrigido): copiar "Só token" NÃO acende "Copiado" no botão "Copiar link" — cada campo tem seu próprio status', () => {
    const state = { field: 'token', status: 'copied' };
    expect(decideLabel(state, 'token', 'Só token')).toBe('Copiado');
    expect(decideLabel(state, 'url', 'Copiar link')).toBe('Copiar link'); // não contaminado
  });

  it('DEPOIS: copiar "Copiar link" não acende nada em "Só token"', () => {
    const state = { field: 'url', status: 'copied' };
    expect(decideLabel(state, 'url', 'Copiar link')).toBe('Copiado');
    expect(decideLabel(state, 'token', 'Só token')).toBe('Só token');
  });

  // Modela os 3 desfechos do handler assíncrono (mesma técnica usada pro
  // SetupPinReveal na rodada média) — comprova que os 2 caminhos de falha
  // (sem API / rejeição) agora produzem um resultado DISTINTO de "nada
  // aconteceu", cada um preso ao field certo.
  function simulateCopy({ hasClipboardApi, writeRejects }, field) {
    if (!hasClipboardApi) return { field, status: 'failed' };
    return writeRejects ? { field, status: 'failed' } : { field, status: 'copied' };
  }

  it('modelo: sem Clipboard API (contexto inseguro / navegador antigo) → failed no campo certo (era: nada, unhandled)', () => {
    expect(simulateCopy({ hasClipboardApi: false, writeRejects: false }, 'token')).toEqual({ field: 'token', status: 'failed' });
  });

  it('modelo: API existe mas writeText rejeita (permissão negada) → failed no campo certo (era: unhandled rejection muda)', () => {
    expect(simulateCopy({ hasClipboardApi: true, writeRejects: true }, 'url')).toEqual({ field: 'url', status: 'failed' });
  });

  it('modelo: caminho feliz continua copied, no campo certo', () => {
    expect(simulateCopy({ hasClipboardApi: true, writeRejects: false }, 'token')).toEqual({ field: 'token', status: 'copied' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA B.1 (T6) — buildTenantMetrics: lastActivity não fica mais preso à
// mesma janela de 7d das métricas "recentes" — o tier danger (10d+) volta a
// ser alcançável.
// ═══════════════════════════════════════════════════════════════════════════

describe('Família B.1 — buildTenantMetrics: lastActivity vem do histórico completo (30d), não só do recorte de 7d', () => {
  it('fonte: buildTenantMetrics é exportado e usado pelo HealthView (não ficou como useMemo inline intestável)', () => {
    expect(fonte).toContain('export function buildTenantMetrics(records) {');
    expect(fonte).toContain('const metricsByTenant = useMemo(() => buildTenantMetrics(records), [records]);');
  });

  // Reimplementação EXATA do código antigo (o que existia antes desta
  // correção — lastActivity computado de dentro do mesmo agregado já
  // filtrado a 7d), pra comprovar o defeito de forma isolada.
  function buildTenantMetricsAntigo(records) {
    const sevenDaysAgoMs = Date.now() - 7 * 86400000;
    const out = {};
    for (const r of records) {
      if (new Date(r.created_at).getTime() < sevenDaysAgoMs) continue;
      const tid = r.tenant_id;
      if (!out[tid]) out[tid] = { records: [], users: new Set() };
      out[tid].records.push(r);
    }
    const final = {};
    for (const [tid, { records: recs }] of Object.entries(out)) {
      final[tid] = { recordsLast7d: recs.length, lastActivity: recs[0]?.created_at, conformity: null, activeUsers7d: 0, nonCompliant: 0 };
    }
    return final;
  }

  const dozeDiasAtras = new Date(Date.now() - 12 * 86400000).toISOString();
  const registroAntigo = [{ tenant_id: 't1', created_at: dozeDiasAtras, value: 4, min_value: 2, max_value: 6, user_name: 'Ana' }];

  it('ANTES (reimplementação do bug): tenant com UM registro há 12 dias (fora da janela de 7d) não ganha entrada NENHUMA — sem lastActivity pra calcular dias', () => {
    const metrics = buildTenantMetricsAntigo(registroAntigo);
    expect(metrics['t1']).toBeUndefined();
  });

  it('DEPOIS (buildTenantMetrics real): o mesmo tenant ganha entrada com lastActivity correto, mesmo sem nenhum registro nos últimos 7d', () => {
    const metrics = buildTenantMetrics(registroAntigo);
    expect(metrics['t1']).toBeDefined();
    expect(metrics['t1'].lastActivity).toBe(dozeDiasAtras);
    expect(metrics['t1'].recordsLast7d).toBe(0); // continua 0 — métrica "recente" não muda de propósito
  });

  it('mecanismo ponta a ponta (computeTenantAlerts REAL, não modelo): com metrics do buildTenantMetrics ANTIGO, nenhum alerta de inatividade aparece — o tier danger (10d+) era estruturalmente inalcançável', () => {
    const metricsAntigo = buildTenantMetricsAntigo(registroAntigo);
    const tenant = { id: 't1', name: 'DBK Produção' };
    const alerts = computeTenantAlerts(metricsAntigo, [tenant], []);
    expect(alerts.find(a => a.tenant?.id === 't1')).toBeUndefined();
  });

  it('mecanismo ponta a ponta: com metrics do buildTenantMetrics NOVO (real, importado — não modelo), o alerta danger aparece, com a contagem certa de dias', () => {
    const metricsNovo = buildTenantMetrics(registroAntigo);
    const tenant = { id: 't1', name: 'DBK Produção' };
    const alerts = computeTenantAlerts(metricsNovo, [tenant], []);
    const alerta = alerts.find(a => a.tenant?.id === 't1');
    expect(alerta).toBeDefined();
    expect(alerta.severity).toBe('danger');
    expect(alerta.label).toBe('DBK Produção sem registros há 12 dias');
  });

  it('o tier "warn" (5-9d) também passa a disparar pra quem já saiu da janela de 7d (achado: "some em vez de escalar")', () => {
    const seteDiasAtras = new Date(Date.now() - 8 * 86400000).toISOString();
    const metrics = buildTenantMetrics([{ tenant_id: 't2', created_at: seteDiasAtras, value: 4, min_value: 2, max_value: 6 }]);
    const alerts = computeTenantAlerts(metrics, [{ id: 't2', name: 'Bäckerei' }], []);
    const alerta = alerts.find(a => a.tenant?.id === 't2');
    expect(alerta).toBeDefined();
    expect(alerta.severity).toBe('warn');
  });

  it('recordsLast7d/activeUsers7d/conformity continuam escopados a 7d — não regrediu a métrica "saúde recente" quando o tenant TEM registro recente', () => {
    const hoje = new Date().toISOString();
    const records = [
      { tenant_id: 't3', created_at: hoje, value: 4, min_value: 2, max_value: 6, user_name: 'Ana' },
      { tenant_id: 't3', created_at: hoje, value: 10, min_value: 2, max_value: 6, user_name: 'Beto' }, // fora da faixa
    ];
    const metrics = buildTenantMetrics(records);
    expect(metrics['t3'].recordsLast7d).toBe(2);
    expect(metrics['t3'].activeUsers7d).toBe(2);
    expect(metrics['t3'].conformity).toBe(50); // 1 de 2 dentro da faixa
    expect(metrics['t3'].nonCompliant).toBe(1);
  });

  it('lastActivity é o MAIS RECENTE (MAX real), não "o primeiro do array" — não depende da API devolver ordenado', () => {
    const maisAntigo = new Date(Date.now() - 3 * 86400000).toISOString();
    const maisRecente = new Date(Date.now() - 1 * 86400000).toISOString();
    // propositalmente fora de ordem: o mais antigo vem PRIMEIRO no array
    const records = [
      { tenant_id: 't4', created_at: maisAntigo, value: 4, min_value: 2, max_value: 6 },
      { tenant_id: 't4', created_at: maisRecente, value: 4, min_value: 2, max_value: 6 },
    ];
    expect(buildTenantMetrics(records)['t4'].lastActivity).toBe(maisRecente);
  });

  it('tenant com registro recente E antigo: recordsLast7d conta só o recente, mas lastActivity reflete o dado real mais novo', () => {
    const hoje = new Date().toISOString();
    const onzeDiasAtras = new Date(Date.now() - 11 * 86400000).toISOString();
    const records = [
      { tenant_id: 't5', created_at: onzeDiasAtras, value: 4, min_value: 2, max_value: 6 },
      { tenant_id: 't5', created_at: hoje, value: 4, min_value: 2, max_value: 6 },
    ];
    const metrics = buildTenantMetrics(records);
    expect(metrics['t5'].recordsLast7d).toBe(1);
    expect(metrics['t5'].lastActivity).toBe(hoje);
  });

  it('registro sem tenant_id é ignorado, não quebra nem cria entrada "undefined"', () => {
    const metrics = buildTenantMetrics([{ created_at: new Date().toISOString(), value: 4, min_value: 2, max_value: 6 }]);
    expect(Object.keys(metrics)).toHaveLength(0);
  });

  it('array vazio devolve objeto vazio, sem quebrar', () => {
    expect(buildTenantMetrics([])).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA B.2 (T6) — bucketByDay: chaveia por data LOCAL, não UTC
// ═══════════════════════════════════════════════════════════════════════════

describe('Família B.2 — bucketByDay chaveia por data LOCAL (registro noturno não some nem desloca de dia)', () => {
  // Reimplementação EXATA do código antigo (fatiava a string ISO — sempre
  // UTC — tanto pros buckets quanto pros registros).
  function bucketByDayAntigo(records, days = 30) {
    const buckets = new Map();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of records) {
      const day = r.created_at?.slice(0, 10);
      if (day && buckets.has(day)) buckets.set(day, buckets.get(day) + 1);
    }
    return [...buckets.entries()].map(([date, count]) => ({ date, count }));
  }

  // Registro feito ÀS 23h30 hora local, "hoje" — o caso mais grave do achado
  // (some sem nenhum sinal, porque não existe bucket de "amanhã").
  function registroTarde(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(23, 30, 0, 0);
    return { created_at: d.toISOString() };
  }

  it('ANTES (reimplementação do bug): registro de HOJE à noite (23h30 local) some do total — nenhum bucket o contém', () => {
    const out = bucketByDayAntigo([registroTarde(0)], 30);
    const total = out.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(0); // o bug: o registro existe mas não é contado em NENHUM lugar
  });

  it('DEPOIS (bucketByDay real): o mesmo registro de hoje à noite é contado — cai no bucket de hoje', () => {
    const out = bucketByDay([registroTarde(0)], 30);
    const total = out.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1);
    expect(out[out.length - 1].count).toBe(1); // último bucket = hoje
  });

  it('ANTES (reimplementação do bug): registro de ONTEM à noite (23h30 local) é contado, mas no bucket ERRADO — aparece em "hoje"', () => {
    const outAntigo = bucketByDayAntigo([registroTarde(1)], 30);
    const hojeAntigo = outAntigo[outAntigo.length - 1];
    const ontemAntigo = outAntigo[outAntigo.length - 2];
    expect(hojeAntigo.count).toBe(1);   // deslocado pra hoje — errado
    expect(ontemAntigo.count).toBe(0);  // deveria estar aqui
  });

  it('DEPOIS (bucketByDay real): o registro de ontem à noite cai no bucket de ONTEM, não no de hoje', () => {
    const out = bucketByDay([registroTarde(1)], 30);
    const hoje = out[out.length - 1];
    const ontem = out[out.length - 2];
    expect(ontem.count).toBe(1);
    expect(hoje.count).toBe(0);
  });

  it('registro de manhã/tarde (hora que não cruza fronteira UTC) continua contado no dia certo nos dois — não regrediu o caminho feliz', () => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    const registroDeManha = { created_at: d.toISOString() };
    const out = bucketByDay([registroDeManha], 7);
    expect(out[out.length - 1].count).toBe(1);
  });

  it('lida com created_at ausente/nulo/inválido sem quebrar (mesma tolerância de antes)', () => {
    const out = bucketByDay([{ created_at: null }, {}, { created_at: 'não-é-uma-data' }, registroTarde(0)], 7);
    const total = out.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1); // só o válido conta
  });

  it('continua devolvendo N buckets ordenados cronologicamente (contrato existente preservado)', () => {
    const out = bucketByDay([], 30);
    expect(out).toHaveLength(30);
    const dates = out.map(b => b.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('fonte: bucketByDay não fatia mais a string ISO crua (nem pro bucket nem pro registro) — usa Date + getters locais', () => {
    const iniFn = fonte.indexOf('export function bucketByDay(records, days = 30) {');
    const fimFn = fonte.indexOf('\n}', fonte.indexOf('return [...buckets.entries()]', iniFn));
    const corpoFn = fonte.slice(iniFn, fimFn);
    expect(corpoFn).not.toContain('.toISOString().slice(0, 10)');
    expect(corpoFn).not.toContain('r.created_at?.slice(0, 10)');
    expect(corpoFn).toContain('localDateKey(d)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA C (T6) — superadmin-view.jsx: Audit log — badge honesto + "Mostrar mais"
// ═══════════════════════════════════════════════════════════════════════════

describe('Família C — SuperAdminView: audit log para de cortar em 30 sem dizer', () => {
  it('fonte: existe AUDIT_PAGE (30) e auditVisible inicializado com ele', () => {
    expect(fonteSuperAdmin).toContain('const AUDIT_PAGE = 30;');
    expect(fonteSuperAdmin).toContain('const [auditVisible, setAuditVisible] = useState(AUDIT_PAGE);');
  });

  it('fonte: a lista renderizada corta por auditVisible (estado), não mais por um "30" fixo no JSX', () => {
    expect(fonteSuperAdmin).toContain('audit.slice(0, auditVisible)');
    expect(fonteSuperAdmin).not.toContain('audit.slice(0, 30)');
  });

  it('fonte: o badge deixa de afirmar o total quando a lista está cortada — mostra "N de M"', () => {
    expect(fonteSuperAdmin).toContain('{audit.length > auditVisible ? `${auditVisible} de ${audit.length}` : audit.length}');
  });

  it('fonte: existe um caminho pra ver o resto — botão "Mostrar mais" só aparece quando há mais do que o visível', () => {
    expect(fonteSuperAdmin).toContain('{audit.length > auditVisible && (');
    expect(fonteSuperAdmin).toContain('onClick={() => setAuditVisible(v => v + AUDIT_PAGE)}');
  });

  // Prova por reimplementação (mesma técnica de "modelo" do resto da
  // auditoria): modela o par badge/showMore exatamente como o componente
  // decide, com os números do próprio achado (137 total, 30 visíveis).
  function decideAuditView(auditLength, auditVisible) {
    const badge = auditLength > auditVisible ? `${auditVisible} de ${auditLength}` : String(auditLength);
    const showMore = auditLength > auditVisible;
    const shown = Math.min(auditLength, auditVisible);
    return { badge, showMore, shown };
  }

  it('ANTES (bug, comprovado com os números do achado): 137 no total, badge mostra "137" mas só 30 renderizam — nada avisa do corte', () => {
    // reimplementação do contrato antigo: badge = total bruto, sem relação com quanto é mostrado
    const badgeAntigo = String(137);
    const mostradoAntigo = Math.min(137, 30);
    expect(badgeAntigo).toBe('137'); // promete 137
    expect(mostradoAntigo).toBe(30);  // entrega 30 — a mentira do achado
  });

  it('DEPOIS: 137 no total, 30 visíveis → badge diz "30 de 137" (honesto) e sinaliza que dá pra ver mais', () => {
    const r = decideAuditView(137, 30);
    expect(r.badge).toBe('30 de 137');
    expect(r.showMore).toBe(true);
    expect(r.shown).toBe(30);
  });

  it('poucas ações (menos que uma página): badge mostra só o total, sem "Mostrar mais" fantasma', () => {
    const r = decideAuditView(20, 30);
    expect(r.badge).toBe('20');
    expect(r.showMore).toBe(false);
    expect(r.shown).toBe(20);
  });

  it('clicar "Mostrar mais" uma vez (auditVisible 30→60) avança o corte e atualiza o badge', () => {
    const r = decideAuditView(137, 60);
    expect(r.badge).toBe('60 de 137');
    expect(r.showMore).toBe(true);
  });

  it('clicar até ultrapassar o total: badge volta a mostrar só o número — a ação de mês passado agora é alcançável', () => {
    const r = decideAuditView(137, 150);
    expect(r.badge).toBe('137');
    expect(r.showMore).toBe(false);
    expect(r.shown).toBe(137); // Math.min trava no total real, não estoura
  });

  it('caso-limite: total igual ao visível não mostra "de" nem botão (>, não >=)', () => {
    const r = decideAuditView(30, 30);
    expect(r.badge).toBe('30');
    expect(r.showMore).toBe(false);
  });
});
