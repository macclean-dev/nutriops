import { describe, it, expect } from 'vitest';
import { computeTenantAlerts } from './admin';

const T_SWISS = { id: 'swiss', name: 'Swiss', segment: 'Confeitaria' };
const T_BAKERY = { id: 'backerei', name: 'Bäckerei', segment: 'Padaria' };
const TENANTS = [T_SWISS, T_BAKERY];

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString();

describe('computeTenantAlerts', () => {
  it('retorna vazio sem dados', () => {
    expect(computeTenantAlerts({}, [], [])).toEqual([]);
  });

  it('marca inativo warn entre 5-9 dias', () => {
    const metrics = { swiss: { lastActivity: daysAgo(6), conformity: 95 } };
    const alerts = computeTenantAlerts(metrics, TENANTS, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'inactive', severity: 'warn' });
    expect(alerts[0].label).toContain('Swiss');
    expect(alerts[0].label).toContain('6 dias');
  });

  it('marca inativo danger a partir de 10 dias', () => {
    const metrics = { swiss: { lastActivity: daysAgo(15), conformity: 95 } };
    const alerts = computeTenantAlerts(metrics, TENANTS, []);
    expect(alerts[0].severity).toBe('danger');
  });

  it('NÃO marca inativo abaixo de 5 dias', () => {
    const metrics = { swiss: { lastActivity: daysAgo(3), conformity: 95 } };
    expect(computeTenantAlerts(metrics, TENANTS, [])).toEqual([]);
  });

  it('marca conformidade warn entre 50-69%', () => {
    const metrics = { swiss: { lastActivity: daysAgo(1), conformity: 65 } };
    const alerts = computeTenantAlerts(metrics, TENANTS, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'compliance', severity: 'warn' });
  });

  it('marca conformidade danger abaixo de 50%', () => {
    const metrics = { swiss: { lastActivity: daysAgo(1), conformity: 40 } };
    const alerts = computeTenantAlerts(metrics, TENANTS, []);
    expect(alerts[0]).toMatchObject({ kind: 'compliance', severity: 'danger' });
  });

  it('não duplica conformidade quando inativo já foi reportado', () => {
    const metrics = { swiss: { lastActivity: daysAgo(7), conformity: 30 } };
    const alerts = computeTenantAlerts(metrics, TENANTS, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('inactive');
  });

  it('marca trial-warning quando expira em ≤3 dias', () => {
    const c = { id: 'c1', name: 'Café X', active: true, plan: 'trial', trialEndsAt: daysAhead(2) };
    const alerts = computeTenantAlerts({}, [], [c]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'trial-warning', severity: 'warn' });
    expect(alerts[0].label).toContain('Café X');
  });

  it('marca trial-expired quando trialEndsAt < hoje', () => {
    const c = { id: 'c1', name: 'Café X', active: true, plan: 'trial', trialEndsAt: daysAgo(2) };
    const alerts = computeTenantAlerts({}, [], [c]);
    expect(alerts[0]).toMatchObject({ kind: 'trial-expired', severity: 'danger' });
  });

  it('marca overdue pra pagamento atrasado', () => {
    const c = { id: 'c1', name: 'Café X', active: true, plan: 'loja', billingStatus: 'overdue' };
    const alerts = computeTenantAlerts({}, [], [c]);
    expect(alerts[0]).toMatchObject({ kind: 'overdue', severity: 'danger' });
  });

  it('ignora clientes inativos (active=false) pra trial e overdue', () => {
    const clients = [
      { id: 'c1', name: 'X', active: false, plan: 'trial', trialEndsAt: daysAhead(1) },
      { id: 'c2', name: 'Y', active: false, billingStatus: 'overdue' },
    ];
    expect(computeTenantAlerts({}, [], clients)).toEqual([]);
  });

  it('inclui ação edit-client em alertas de trial/overdue', () => {
    const c = { id: 'c1', name: 'Z', active: true, plan: 'trial', trialEndsAt: daysAhead(1) };
    const [alert] = computeTenantAlerts({}, [], [c]);
    expect(alert.action).toEqual({ kind: 'edit-client', target: 'c1' });
  });

  it('inclui ação email em alertas de inatividade quando cliente tem email', () => {
    const metrics = { swiss: { lastActivity: daysAgo(6), conformity: 90 } };
    const clients = [{ id: 'c1', name: 'Swiss Confeitaria', active: true, email: 'sw@x.com', plan: 'loja' }];
    const [alert] = computeTenantAlerts(metrics, TENANTS, clients);
    expect(alert.action).toEqual({ kind: 'email', target: 'sw@x.com' });
  });

  it('ordena por severidade — danger antes de warn', () => {
    const metrics = {
      swiss:    { lastActivity: daysAgo(6) },     // warn (inactive 6d)
      backerei: { lastActivity: daysAgo(15) },    // danger (inactive 15d)
    };
    const alerts = computeTenantAlerts(metrics, TENANTS, []);
    expect(alerts[0].severity).toBe('danger');
    expect(alerts[1].severity).toBe('warn');
  });

  it('combina alertas de tenant + cliente no mesmo array', () => {
    const metrics = { swiss: { lastActivity: daysAgo(15), conformity: 95 } };
    const clients = [
      { id: 'c1', name: 'Outro', active: true, plan: 'trial', trialEndsAt: daysAhead(2) },
      { id: 'c2', name: 'Mais', active: true, billingStatus: 'overdue' },
    ];
    const alerts = computeTenantAlerts(metrics, TENANTS, clients);
    expect(alerts).toHaveLength(3);
    expect(alerts.map(a => a.kind).sort()).toEqual(['inactive', 'overdue', 'trial-warning']);
  });
});
