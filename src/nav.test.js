import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONTROLS_KEYS, REPORTS_KEYS, TEAM_KEYS,
  isItemActive, buildNavSections, resolveHubTab,
} from './nav';

describe('isItemActive', () => {
  it('match exato sempre é ativo', () => {
    expect(isItemActive('overview', 'overview')).toBe(true);
    expect(isItemActive('forms', 'forms')).toBe(true);
  });

  it('hub controles fica ativo quando uma sub-view dele está aberta', () => {
    expect(isItemActive('controls', 'handwash')).toBe(true);
    expect(isItemActive('controls', 'oil')).toBe(true);
    expect(isItemActive('controls', 'thermal')).toBe(true);
    expect(isItemActive('controls', 'forms')).toBe(false);
  });

  it('hub reportsHub fica ativo nas sub-views de relatório', () => {
    expect(isItemActive('reportsHub', 'dashboard')).toBe(true);
    expect(isItemActive('reportsHub', 'audit')).toBe(true);
    expect(isItemActive('reportsHub', 'monthly')).toBe(true);
    expect(isItemActive('reportsHub', 'overview')).toBe(false);
  });

  it('hub team fica ativo em users/turns/sessions', () => {
    expect(isItemActive('team', 'users')).toBe(true);
    expect(isItemActive('team', 'turns')).toBe(true);
    expect(isItemActive('team', 'sessions')).toBe(true);
    expect(isItemActive('team', 'profile')).toBe(false);
  });

  it('items que não são hubs só ativam em match exato', () => {
    expect(isItemActive('overview', 'forms')).toBe(false);
    expect(isItemActive('profile', 'settings')).toBe(false);
  });
});

describe('buildNavSections', () => {
  it('retorna 4 seções (Operação, Qualidade, Gestão, Conta)', () => {
    const sections = buildNavSections();
    expect(sections).toHaveLength(4);
    expect(sections.map(s => s.label)).toEqual(['Operação', 'Qualidade', 'Gestão', 'Conta']);
  });

  it('Operação inclui o hub controles', () => {
    const sections = buildNavSections();
    const ops = sections.find(s => s.label === 'Operação');
    const keys = ops.items.map(([k]) => k);
    expect(keys).toContain('controls');
    // E NÃO mostra as sub-views direto no rail
    expect(keys).not.toContain('handwash');
    expect(keys).not.toContain('oil');
  });

  it('badges aparecem no item correto quando count > 0', () => {
    const sections = buildNavSections({ validityAlertCount: 3, alertCount: 5 });
    const ops = sections.find(s => s.label === 'Operação');
    const validity = ops.items.find(([k]) => k === 'validity');
    expect(validity[3]).toBe(3);
    const gestao = sections.find(s => s.label === 'Gestão');
    const alerts = gestao.items.find(([k]) => k === 'alerts');
    expect(alerts[3]).toBe(5);
  });

  it('badges são null quando count é 0', () => {
    const sections = buildNavSections();
    const ops = sections.find(s => s.label === 'Operação');
    const validity = ops.items.find(([k]) => k === 'validity');
    expect(validity[3]).toBeNull();
  });
});

describe('resolveHubTab', () => {
  let storage;
  beforeEach(() => {
    const data = {};
    storage = {
      getItem: (k) => data[k] ?? null,
      setItem: (k, v) => { data[k] = v; },
    };
  });

  const SUB = ['handwash', 'oil', 'thaw'];

  it('quando activeView é o hub, usa o default se não tem persistência', () => {
    expect(resolveHubTab('controls', 'controls', 'handwash', SUB, storage)).toBe('handwash');
  });

  it('quando activeView é o hub, usa o persisted se válido', () => {
    storage.setItem('nutriops.controls.lastTab', 'oil');
    expect(resolveHubTab('controls', 'controls', 'handwash', SUB, storage)).toBe('oil');
  });

  it('ignora persisted inválido (sub-view que sumiu) e volta no default', () => {
    storage.setItem('nutriops.controls.lastTab', 'inexistente');
    expect(resolveHubTab('controls', 'controls', 'handwash', SUB, storage)).toBe('handwash');
  });

  it('quando activeView é uma sub-view direto, mantém ela', () => {
    expect(resolveHubTab('thaw', 'controls', 'handwash', SUB, storage)).toBe('thaw');
  });

  it('activeView fora do hub volta no default', () => {
    expect(resolveHubTab('forms', 'controls', 'handwash', SUB, storage)).toBe('handwash');
  });
});

describe('Hub key sets', () => {
  it('controles tem 5 sub-views + o hub', () => {
    expect(CONTROLS_KEYS).toHaveLength(6);
    expect(CONTROLS_KEYS[0]).toBe('controls');
  });

  it('reports tem 5 sub-views + o hub', () => {
    expect(REPORTS_KEYS).toHaveLength(6);
    expect(REPORTS_KEYS[0]).toBe('reportsHub');
  });

  it('team tem 3 sub-views + o hub', () => {
    expect(TEAM_KEYS).toHaveLength(4);
    expect(TEAM_KEYS[0]).toBe('team');
  });
});
