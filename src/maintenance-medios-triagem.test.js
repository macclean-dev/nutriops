import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  printMaintenanceReport,
  sortLogsByExecution,
  isOrderOpen,
  countPlansByTone,
} from './maintenance';

const fonte = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 5 achados de gravidade MÉDIA sem perda de dado que
// apontam pra src/maintenance.jsx (pool de 169 não-julgados da auditoria de
// falha silenciosa, 18-19/08).
//
// Um achado (onDelete do ativo descarta o resultado do delete offline/falho)
// já estava RESOLVIDO por uma rodada anterior desta mesma sessão
// (repository.js, commit 49d2a11): onDelete agora é async, aguarda
// deleteMaintenanceItem e só avisa em falha REAL (reason !== 'offline_or_
// disabled'). Já coberto por
// "maintenance.jsx: onDelete do ativo aguarda deleteMaintenanceItem e só
// avisa em falha REAL" em src/repository-medios-triagem.test.js — não
// duplicado aqui.
//
// Os outros 4 achados eram reais e viraram 4 famílias:
//   · Família 1 (achado "PDF trava") — window.open(...) sem guarda de null
//     em printMaintenanceReport, mesmo padrão já corrigido em
//     reports-views.jsx/dossie-view.jsx.
//   · Família 2 (achado "Histórico fora de ordem") — Histórico e o PDF
//     renderizavam logs na ordem do array (local prepend + remoto anexado no
//     fim pelo sync), não por data de execução.
//   · Família 3 (achado "OS abertas conta canceladas") — o filtro de "aberta"
//     só excluía 'concluida'; 'cancelada' continuava contando pra sempre, e
//     o botão "✓ Concluir" continuava disponível numa OS cancelada (geraria
//     evidência falsa de execução).
//   · Família 4 (achado "badge de atrasadas conta equipamento") — overdue/
//     due30 contavam EQUIPAMENTOS, mas a lista abaixo do card renderiza uma
//     linha por PLANO, e o menu lateral (maintAlertCount, pages.jsx) soma
//     planos — três números diferentes pra mesma coisa. De quebra, o título
//     prometia "vencendo hoje" pro que na verdade é uma janela de 7 dias.
// ─────────────────────────────────────────────────────────────────────────────

describe('Família 1 — PDF de manutenção não estoura mais com pop-up bloqueado, e sai ordenado por execução (achados: "PDF trava" + "Histórico fora de ordem")', () => {
  const tenant = { id: 'padaria-teste', name: 'Padaria Teste' };

  beforeEach(() => { localStorage.clear(); });

  it('window.open devolvendo null (pop-up bloqueado) não estoura TypeError — avisa e sai', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    expect(() => printMaintenanceReport(tenant, [], [], [])).not.toThrow();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/pop-up/i);
  });

  it('com a janela disponível, o histórico do PDF sai ordenado por data de execução (mais recente primeiro), não pela ordem do array', () => {
    const fakeWin = { document: { write: vi.fn(), close: vi.fn() }, print: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin);
    const equipments = [{ id: 'eq1', name: 'Câmara fria', location: 'Cozinha', status: 'Operacional', maintenancePlans: [] }];
    // Ordem de ARRAY propositalmente invertida em relação à data — é
    // exatamente como o sync devolve: local primeiro (mesmo sendo velho),
    // remoto novo anexado no fim (mergeByKey([...local, ...remoteRecords]),
    // repository.js).
    const logs = [
      { id: 'antigo', equipmentId: 'eq1', executedAt: '2026-06-01', title: 'Limpeza de filtro', executedBy: 'Ana', type: 'limpeza' },
      { id: 'hoje',   equipmentId: 'eq1', executedAt: '2026-08-19', title: 'Troca de gaxeta',   executedBy: 'Carlos', type: 'troca' },
    ];
    printMaintenanceReport(tenant, equipments, logs, []);
    expect(fakeWin.document.write).toHaveBeenCalledTimes(1);
    const html = fakeWin.document.write.mock.calls[0][0];
    expect(html).toContain('Troca de gaxeta');
    expect(html).toContain('Limpeza de filtro');
    // "hoje" (19/08) tem que vir ANTES de "antigo" (01/06) na tabela do PDF.
    expect(html.indexOf('Troca de gaxeta')).toBeLessThan(html.indexOf('Limpeza de filtro'));
    expect(fakeWin.document.close).toHaveBeenCalled();
    expect(fakeWin.print).toHaveBeenCalled();
  });

  it('maintenance.jsx: printMaintenanceReport guarda window.open contra null antes do document.write', () => {
    const ini = fonte.indexOf('export function printMaintenanceReport(');
    const fim = fonte.indexOf('const MAINTENANCE_TYPES = [');
    const corpo = fonte.slice(ini, fim);
    const posWin = corpo.indexOf("window.open('', '_blank')");
    const posGuarda = corpo.indexOf('if (!win)');
    const posWrite = corpo.indexOf('win.document.write(');
    expect(posWin).toBeGreaterThan(-1);
    expect(posGuarda).toBeGreaterThan(posWin);
    expect(posWrite).toBeGreaterThan(posGuarda);
    expect(corpo).toContain('window.alert(');
  });
});

describe('sortLogsByExecution — helper puro por trás do achado "Histórico fora de ordem"', () => {
  it('ordena por executedAt desc, independente da ordem de entrada', () => {
    const logs = [
      { id: 'a', executedAt: '2026-01-10' },
      { id: 'b', executedAt: '2026-08-19' },
      { id: 'c', executedAt: '2026-05-01' },
    ];
    expect(sortLogsByExecution(logs).map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('não muta o array original — logs é state do React (setLogs)', () => {
    const logs = [{ id: 'a', executedAt: '2026-01-01' }, { id: 'b', executedAt: '2026-08-01' }];
    const original = [...logs];
    sortLogsByExecution(logs);
    expect(logs).toEqual(original);
  });

  it('replica o cenário exato do achado: local (prepend, já mais novo primeiro) + remoto (append no fim, sem reordenar)', () => {
    // syncModule monta assim: mergeByKey([...local, ...remoteRecords], 'id')
    // — local fica na frente, remoto (mesmo que MAIS recente) cai no fim.
    const local = [{ id: 'tablet-hoje', executedAt: '2026-08-19', title: 'Registro do tablet hoje' }];
    const remotoAnexadoNoFim = [{ id: 'laptop-mes-passado', executedAt: '2026-07-01', title: 'Execução antiga' }];
    const arrayComoOSyncDevolve = [...local, ...remotoAnexadoNoFim];
    // já estava correto neste caso específico (local É o mais novo) — o bug
    // aparece quando é o REMOTO que é o mais novo:
    const local2 = [{ id: 'laptop-mes-passado', executedAt: '2026-07-01' }];
    const remoto2MaisNovo = [{ id: 'tablet-hoje', executedAt: '2026-08-19' }];
    const arrayInvertido = [...local2, ...remoto2MaisNovo];
    expect(arrayInvertido.map((l) => l.id)).toEqual(['laptop-mes-passado', 'tablet-hoje']); // sem sort: velho aparece primeiro
    expect(sortLogsByExecution(arrayInvertido).map((l) => l.id)).toEqual(['tablet-hoje', 'laptop-mes-passado']); // corrigido
    expect(sortLogsByExecution(arrayComoOSyncDevolve).map((l) => l.id)).toEqual(['tablet-hoje', 'laptop-mes-passado']);
  });

  it('maintenance.jsx: o Histórico usa sortLogsByExecution — não mais logs.map cru', () => {
    expect(fonte).toContain(': sortLogsByExecution(logs).map(l => {');
    expect(fonte).not.toMatch(/:\s*logs\.map\(l => \{/);
  });
});

describe('Família 3 — "OS abertas" não conta mais canceladas, e "✓ Concluir" some pra OS cancelada (achado "OS abertas conta canceladas")', () => {
  it('isOrderOpen exclui concluida E cancelada — só essas duas ficam de fora', () => {
    expect(isOrderOpen({ status: 'pendente' })).toBe(true);
    expect(isOrderOpen({ status: 'em_andamento' })).toBe(true);
    expect(isOrderOpen({ status: 'concluida' })).toBe(false);
    expect(isOrderOpen({ status: 'cancelada' })).toBe(false);
  });

  it('documenta o defeito original: o filtro velho (!==concluida) contava cancelada como aberta', () => {
    const orders = [{ status: 'cancelada' }, { status: 'pendente' }];
    const contagemAntiga = orders.filter((o) => o.status !== 'concluida').length;
    expect(contagemAntiga).toBe(2); // errado — "cancelada" não devia contar
    expect(orders.filter(isOrderOpen).length).toBe(1); // corrigido
  });

  it('cancelar uma OS baixa "OS abertas" na mesma hora, sem precisar clicar em "✓ Concluir"', () => {
    const orders = [
      { id: 'o1', status: 'pendente' },
      { id: 'o2', status: 'em_andamento' },
    ];
    expect(orders.filter(isOrderOpen).length).toBe(2);
    const depoisDeCancelarA_o2 = orders.map((o) => (o.id === 'o2' ? { ...o, status: 'cancelada' } : o));
    expect(depoisDeCancelarA_o2.filter(isOrderOpen).length).toBe(1); // baixou sem precisar "Concluir"
  });

  it('maintenance.jsx: openOrders, a lista do Painel e o botão "✓ Concluir" usam isOrderOpen', () => {
    expect(fonte).toContain('const openOrders = orders.filter(isOrderOpen).length;');
    expect(fonte).toContain('{orders.filter(isOrderOpen).map(o => (');
    expect(fonte).toContain('{isOrderOpen(o) && (');
    expect(fonte).not.toContain("orders.filter(o => o.status !== 'concluida')");
    expect(fonte).not.toContain("orders.filter(o=>o.status!=='concluida')");
    expect(fonte).not.toContain("{o.status !== 'concluida' && (");
  });
});

describe('Família 4 — badge "Manutenções atrasadas" conta planos (tarefas), não equipamentos (achado "badge conta equipamento")', () => {
  it('countPlansByTone soma por PLANO, não por equipamento', () => {
    const equipmentsWithDue = [
      { id: 'eq1', plans: [{ tone: 'danger' }, { tone: 'expired' }, { tone: 'danger' }, { tone: 'ok' }] }, // 1 equipamento, 3 planos vencidos/críticos
      { id: 'eq2', plans: [{ tone: 'ok' }] },
    ];
    expect(countPlansByTone(equipmentsWithDue, ['expired', 'danger'])).toBe(3);
  });

  it('documenta o defeito original: contar equipamentos dava "1" onde a lista embaixo renderiza 3 linhas', () => {
    const equipmentsWithDue = [{ id: 'eq1', plans: [{ tone: 'danger' }, { tone: 'expired' }, { tone: 'danger' }] }];
    const contagemAntiga = equipmentsWithDue.filter((e) => e.plans.some((p) => p.tone === 'expired' || p.tone === 'danger')).length;
    expect(contagemAntiga).toBe(1); // errado — subestima o passivo, e destoa da lista de 3 linhas
    expect(countPlansByTone(equipmentsWithDue, ['expired', 'danger'])).toBe(3); // corrigido, bate com as 3 linhas
  });

  it('agora bate com o critério do menu lateral (maintAlertCount, pages.jsx soma planos com days<=7)', () => {
    // 1 equipamento, 4 planos vencidos — é literalmente o cenário do achado
    // (badge dizia "1", menu lateral dizia "4").
    const equipmentsWithDue = [{ id: 'camara-fria', plans: Array.from({ length: 4 }, () => ({ tone: 'danger' })) }];
    expect(countPlansByTone(equipmentsWithDue, ['expired', 'danger'])).toBe(4);
  });

  it('maintenance.jsx: overdue e due30 usam countPlansByTone', () => {
    expect(fonte).toContain("const overdue  = countPlansByTone(equipmentsWithDue, ['expired', 'danger']);");
    expect(fonte).toContain("const due30    = countPlansByTone(equipmentsWithDue, ['warn']);");
    expect(fonte).not.toMatch(/const overdue\s*=\s*equipmentsWithDue\.filter/);
    expect(fonte).not.toMatch(/const due30\s*=\s*equipmentsWithDue\.filter/);
  });

  it('maintenance.jsx: o título não promete mais "vencendo hoje" pro que é uma janela de 7 dias (tom danger cobre 0 a 7 dias — dueTone)', () => {
    expect(fonte).not.toContain('<h2>Manutenções atrasadas ou vencendo hoje</h2>');
    expect(fonte).toContain('Manutenções atrasadas ou vencendo em até 7 dias');
  });
});
