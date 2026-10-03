import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { diasDeAtraso, acoesVencidas, formatarPrazo } from './acoes-prazo';
import { computeReadiness, REQUIRED_POPS } from './readiness';
import { computeWeeklySummary, summaryToText } from './weekly-summary';

// ─────────────────────────────────────────────────────────────────────────────
// Candidata 7 da pesquisa de 03/10: a ação corretiva tinha prazo e nada olhava
// pra ele. Ação aberta com prazo vencido sumia do radar (a Prontidão A1 só vê
// NC SEM ação), a ação não podia ser editada (`editingId` sem UI) e fechar não
// exigia dizer o que foi feito.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-03T15:00:00').getTime();
const acao = (over = {}) => ({ id: 'a1', status: 'aberta', deadline: '2026-10-01', sourceLabel: 'Freezer F.2', ...over });

describe('diasDeAtraso', () => {
  it('prazo passado: dias de atraso', () => {
    expect(diasDeAtraso(acao(), NOW)).toBe(2);
  });

  it('o dia do prazo ainda vale: vence no dia SEGUINTE', () => {
    expect(diasDeAtraso(acao({ deadline: '2026-10-03' }), NOW)).toBeNull();
    expect(diasDeAtraso(acao({ deadline: '2026-10-02' }), NOW)).toBe(1);
  });

  it('em andamento também vence', () => {
    expect(diasDeAtraso(acao({ status: 'em_andamento' }), NOW)).toBe(2);
  });

  it('resolvida, sem prazo ou prazo ilegível: nada a cobrar', () => {
    expect(diasDeAtraso(acao({ status: 'resolvida' }), NOW)).toBeNull();
    expect(diasDeAtraso(acao({ deadline: '' }), NOW)).toBeNull();
    expect(diasDeAtraso(acao({ deadline: 'amanhã' }), NOW)).toBeNull();
    expect(diasDeAtraso(null, NOW)).toBeNull();
  });

  it('acoesVencidas filtra só as atrasadas', () => {
    const lista = [acao(), acao({ id: 'a2', deadline: '2026-12-01' }), acao({ id: 'a3', status: 'resolvida' })];
    expect(acoesVencidas(lista, NOW).map((a) => a.id)).toEqual(['a1']);
  });
});

describe('formatarPrazo', () => {
  it('mostra o dia GRAVADO (new Date("2026-10-01") cairia em 30/09 no Brasil)', () => {
    expect(formatarPrazo('2026-10-01')).toBe('01/10/2026');
  });
  it('sem prazo: hífen', () => {
    expect(formatarPrazo('')).toBe('-');
    expect(formatarPrazo(null)).toBe('-');
  });
});

describe('Prontidão: C4', () => {
  const loja = (actions) => ({
    tenant: { id: 'swiss', name: 'Swiss' }, now: NOW, pendingNc: [], actions,
    products: [], turnAlerts: [], catalog: [], temperatureRecords: [], staff: [],
    trainingSessions: [], formTemplates: [], formRecords: [], pendingForms: [],
    pops: REQUIRED_POPS.map((r) => ({ title: r.label, category: r.categories[0] ?? 'outros' })),
    companyProfile: {}, complianceDocs: [], controlsByType: {}, sync: {}, localOnly: {},
  });
  const c4 = (actions) => computeReadiness(loja(actions)).groups.flatMap((g) => g.checks).find((c) => c.id === 'c4-acoes-vencidas');

  it('ação atrasada: aviso, citando a origem e os dias', () => {
    const c = c4([acao()]);
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('Freezer F.2, 2 dia(s)');
    expect(c.navTarget).toBe('actions');
  });

  it('sem atraso: ok', () => {
    expect(c4([acao({ deadline: '2026-12-01' })]).status).toBe('ok');
    expect(c4([]).status).toBe('ok');
  });

  it('a tela da Prontidão passa as ações da loja', () => {
    const view = readFileSync(`${process.cwd()}/src/readiness-view.jsx`, 'utf8');
    expect(view).toContain('actions: readActions(tenant.id),');
  });
});

describe('resumo da semana da RT', () => {
  it('conta e escreve as vencidas', () => {
    const s = computeWeeklySummary({ tenant: { id: 'swiss', name: 'Swiss' }, records: [], actions: [acao()], extractNonConformities: () => [], resolveTone: () => 'ok', now: NOW });
    expect(s.actionsOverdue).toHaveLength(1);
    expect(summaryToText(s)).toContain('1 com prazo vencido');
  });

  it('sem vencidas, o texto não muda', () => {
    const s = computeWeeklySummary({ tenant: { id: 'swiss', name: 'Swiss' }, records: [], actions: [], extractNonConformities: () => [], resolveTone: () => 'ok', now: NOW });
    expect(summaryToText(s)).not.toContain('prazo vencido');
  });
});

describe('Central de Não Conformidades', () => {
  const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
  const central = pages.slice(pages.indexOf('function CorrectiveActionsView('), pages.indexOf('// ─── Alerts View'));

  it('mostra o selo de prazo vencido e o contador no topo', () => {
    expect(central).toContain('Prazo vencido há {atraso} dia(s)');
    expect(central).toContain('{vencidas} com prazo vencido');
  });

  it('o prazo exibido não usa mais new Date(a.deadline) (mostrava um dia antes)', () => {
    expect(central).not.toContain('new Date(a.deadline).toLocaleDateString');
    expect(central).toContain('formatarPrazo(a.deadline)');
  });

  it('dá pra editar responsável e prazo de ação aberta, e salvar sobe pra nuvem', () => {
    expect(central).toContain('Editar prazo');
    const save = central.slice(central.indexOf('const saveEdit = (id) => {'), central.indexOf('const advanceStatus'));
    expect(save).toContain('pushCorrectiveAction(activeTenant.id, updated)');
  });

  it('fechar exige descrever a resolução (botão e função)', () => {
    expect(central).toContain('onClick={() => advanceStatus(a.id)} disabled={!resolution.trim()}');
    const adv = central.slice(central.indexOf('const advanceStatus = (id) => {'), central.indexOf('const removeAction'));
    expect(adv).toContain("if (alvo?.status === 'em_andamento' && !resolution.trim()) return;");
  });
});
