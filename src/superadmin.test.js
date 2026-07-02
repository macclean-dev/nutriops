import { describe, it, expect, beforeEach } from 'vitest';
import {
  PLANS, planLabel, normalizePlanId, mergeTenants,
  setClientPlan, setClientActive, readAudit, appendAudit,
} from './superadmin';

describe('normalizePlanId', () => {
  it('mantém ids do catálogo', () => {
    expect(normalizePlanId('loja')).toBe('loja');
    expect(normalizePlanId('enterprise')).toBe('enterprise');
  });
  it('mapeia labels dos seeds (Pro→loja, Enterprise→enterprise)', () => {
    expect(normalizePlanId('Pro')).toBe('loja');
    expect(normalizePlanId('Enterprise')).toBe('enterprise');
  });
  it('cai em loja pra desconhecido/vazio', () => {
    expect(normalizePlanId('')).toBe('loja');
    expect(normalizePlanId(null)).toBe('loja');
    expect(normalizePlanId('xyz')).toBe('loja');
  });
});

describe('planLabel', () => {
  it('devolve o label do plano', () => {
    expect(planLabel('rede')).toBe('Rede');
    expect(planLabel('Pro')).toBe('Loja');
  });
});

describe('mergeTenants', () => {
  const clients = [
    { id: 'c1', name: 'Casa Doce', segment: 'Padaria', plan: 'enterprise', active: true, accessToken: 'tok1' },
    { id: 'c2', name: 'Castália', plan: 'rede', active: false },
  ];
  const seeds = [
    { id: 'swiss', name: 'Swiss', segment: 'Confeitaria', plan: 'Pro' },
    { id: 'c1', name: 'Duplicado', plan: 'trial' }, // colide com client c1 → ignorado
  ];
  it('une clients + seeds sem duplicar por id', () => {
    const out = mergeTenants(clients, seeds);
    expect(out.map(t => t.id)).toEqual(['c1', 'c2', 'swiss']);
  });
  it('marca a origem e normaliza o plano', () => {
    const out = mergeTenants(clients, seeds);
    expect(out.find(t => t.id === 'c1').source).toBe('client');
    expect(out.find(t => t.id === 'swiss').source).toBe('seed');
    expect(out.find(t => t.id === 'swiss').plan).toBe('loja'); // Pro→loja
    expect(out.find(t => t.id === 'swiss').active).toBe(true);  // seed sempre ativo
    expect(out.find(t => t.id === 'c2').active).toBe(false);
  });
  it('é robusto a entrada vazia', () => {
    expect(mergeTenants()).toEqual([]);
    expect(mergeTenants(null, null)).toEqual([]);
  });
});

describe('setClientPlan / setClientActive', () => {
  const clients = [{ id: 'c1', name: 'A', plan: 'loja', active: true }];
  it('muda o plano do client certo (normalizando)', () => {
    const out = setClientPlan(clients, 'c1', 'Enterprise');
    expect(out[0].plan).toBe('enterprise');
    expect(out[0].updatedAt).toBeTruthy();
  });
  it('suspende/ativa o client certo', () => {
    expect(setClientActive(clients, 'c1', false)[0].active).toBe(false);
    expect(setClientActive(clients, 'c1', true)[0].active).toBe(true);
  });
  it('não mexe se o id não for um client (ex.: seed)', () => {
    expect(setClientPlan(clients, 'swiss', 'rede')).toEqual(clients);
  });
});

describe('audit log', () => {
  beforeEach(() => { localStorage.clear(); });
  it('append carimba `at` e prepende (mais novo primeiro)', () => {
    appendAudit({ type: 'plan_change', tenantId: 'c1', detail: 'loja→rede', actor: 'admin' });
    appendAudit({ type: 'impersonate_start', tenantId: 'c1', actor: 'admin' });
    const log = readAudit();
    expect(log).toHaveLength(2);
    expect(log[0].type).toBe('impersonate_start');
    expect(log[0].at).toBeTruthy();
  });
});
