import { describe, it, expect, beforeEach } from 'vitest';
import { computeTurnAlertsPure, computeTurnAlerts, readDismissedAlertIds, dismissAlertId } from './turn-alerts';

// Turnos e catálogo mínimos. `now` fixo em 15/08/2026 às 14:30 (dentro do
// turno da tarde, com o da manhã já encerrado) pra o teste não depender da
// hora em que a suíte roda.
const TURNS = [
  { id: 'manha', name: 'Manhã', start: '06:00', end: '11:59' },
  { id: 'tarde', name: 'Tarde', start: '12:00', end: '17:59' },
  { id: 'noite', name: 'Noite', start: '18:00', end: '23:59' },
];
const NOW = new Date('2026-08-15T14:30:00');
const CATALOG = [{ label: 'Freezer 1' }, { label: 'Geladeira 2' }];

const rec = (equipment, hora) => ({
  tenantId: 'swiss', equipment,
  createdAt: new Date(`2026-08-15T${hora}:00`).toISOString(),
});

describe('computeTurnAlertsPure', () => {
  it('turno encerrado sem registro vira danger; turno em andamento vira warn', () => {
    const alerts = computeTurnAlertsPure(TURNS, [], CATALOG, 'swiss', false, NOW);
    // manhã (encerrada) + tarde (ativa) × 2 equipamentos = 4; noite ainda nem começou
    expect(alerts).toHaveLength(4);
    expect(alerts.filter(a => a.level === 'danger')).toHaveLength(2);
    expect(alerts.filter(a => a.level === 'warn')).toHaveLength(2);
    expect(alerts.some(a => a.turn === 'Noite')).toBe(false);
  });

  it('registro dentro da janela do turno limpa o alerta daquele equipamento', () => {
    const alerts = computeTurnAlertsPure(TURNS, [rec('Freezer 1', '08:00')], CATALOG, 'swiss', false, NOW);
    expect(alerts.some(a => a.equipment === 'Freezer 1' && a.turn === 'Manhã')).toBe(false);
    // e não limpa o da tarde, que é outra janela
    expect(alerts.some(a => a.equipment === 'Freezer 1' && a.turn === 'Tarde')).toBe(true);
  });

  it('registro de OUTRA loja não conta (isolamento por tenant)', () => {
    const deOutraLoja = { ...rec('Freezer 1', '08:00'), tenantId: 'backerei' };
    const alerts = computeTurnAlertsPure(TURNS, [deOutraLoja], CATALOG, 'swiss', false, NOW);
    expect(alerts.some(a => a.equipment === 'Freezer 1' && a.turn === 'Manhã')).toBe(true);
  });

  it('loja em implantação não gera alerta nenhum (CASA DOCE)', () => {
    expect(computeTurnAlertsPure(TURNS, [], CATALOG, 'swiss', true, NOW)).toEqual([]);
  });

  // Bug real da Swiss: catálogo vindo da nuvem trazia "ADEGA DE VINHOS" duas
  // vezes, e cada dupe gerava um alerta extra.
  it('catálogo com duplicata gera UM alerta por equipamento, não dois', () => {
    const comDupe = [{ label: 'Freezer 1' }, { label: 'freezer 1' }, { label: 'Geladeira 2' }];
    const alerts = computeTurnAlertsPure(TURNS, [], comDupe, 'swiss', false, NOW);
    expect(alerts).toHaveLength(4);
  });

  it('sem turnos ou sem catálogo não há o que cobrar', () => {
    expect(computeTurnAlertsPure([], [], CATALOG, 'swiss', false, NOW)).toEqual([]);
    expect(computeTurnAlertsPure(TURNS, [], [], 'swiss', false, NOW)).toEqual([]);
  });
});

describe('dar ciência (dismiss)', () => {
  beforeEach(() => localStorage.clear());

  it('alerta dispensado hoje some da lista, e o pure continua enxergando ele', () => {
    const todos = computeTurnAlertsPure(TURNS, [], CATALOG, 'swiss', false, NOW);
    dismissAlertId('swiss', todos[0].id, NOW);
    expect(computeTurnAlerts(TURNS, [], CATALOG, 'swiss', false, NOW)).toHaveLength(todos.length - 1);
    expect(computeTurnAlertsPure(TURNS, [], CATALOG, 'swiss', false, NOW)).toHaveLength(todos.length);
  });

  it('ciência vale só HOJE — no dia seguinte o alerta volta', () => {
    const todos = computeTurnAlertsPure(TURNS, [], CATALOG, 'swiss', false, NOW);
    dismissAlertId('swiss', todos[0].id, NOW);
    const amanha = new Date('2026-08-16T14:30:00');
    expect(readDismissedAlertIds('swiss', amanha).size).toBe(0);
    expect(computeTurnAlerts(TURNS, [], CATALOG, 'swiss', false, amanha)).toHaveLength(todos.length);
  });

  it('ciência é por loja — não vaza pra outra empresa', () => {
    const todos = computeTurnAlertsPure(TURNS, [], CATALOG, 'swiss', false, NOW);
    dismissAlertId('swiss', todos[0].id, NOW);
    expect(readDismissedAlertIds('backerei', NOW).size).toBe(0);
  });
});
