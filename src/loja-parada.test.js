import { describe, it, expect } from 'vitest';
import { computeTenantAlerts, CARENCIA_LOJA_NOVA_DIAS } from './admin.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Candidata 8 da pesquisa de 03/10. "Saúde dos tenants" alertava loja sem
// registro há 5 ou 10+ dias, mas PULAVA a loja sem métrica nenhuma
// (`if (!m) continue`). A pior situação, loja que nunca registrou ou parou de
// vez, era a única sem alerta: a DBK, "única loja ainda zerada na nuvem"
// (CLAUDE.md), nunca acendeu nada.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-03T12:00:00').getTime();
const DBK = { id: 'dbk-producao', name: 'DBK Produção' };
const SWISS = { id: 'swiss', name: 'Swiss Confeitaria' };
const ativo = (dias) => ({ recordsLast7d: 10, lastActivity: new Date(NOW - dias * 86400000).toISOString(), conformity: 95 });
const ok = { metricasOk: true, now: NOW };
const zerada = (alerts, id) => alerts.find((a) => a.id === `inactive-${id}`);

describe('loja sem nenhum registro em 30 dias', () => {
  it('acende alerta vermelho (o caso da DBK)', () => {
    const a = zerada(computeTenantAlerts({ swiss: ativo(0) }, [SWISS, DBK], [], ok), 'dbk-producao');
    expect(a).toBeTruthy();
    expect(a.severity).toBe('danger');
    expect(a.label).toBe('DBK Produção sem nenhum registro de temperatura nos últimos 30 dias');
  });

  it('loja com registro recente não ganha esse alerta', () => {
    expect(zerada(computeTenantAlerts({ swiss: ativo(0) }, [SWISS], [], ok), 'swiss')).toBeUndefined();
  });
});

describe('não vira alarme falso', () => {
  it('busca das métricas falhou: calado (lista vazia faria TODA loja parecer parada)', () => {
    const alerts = computeTenantAlerts({}, [SWISS, DBK], [], { metricasOk: false, now: NOW });
    expect(alerts).toEqual([]);
  });

  it('sem dizer que a busca deu certo, também calado (falha fechada)', () => {
    expect(computeTenantAlerts({}, [SWISS, DBK], [])).toEqual([]);
  });

  it('loja em implantação (treino): zero registro é esperado', () => {
    const pks = { id: 'pks1', name: 'Fabrizzio PKS' };
    const cliente = { id: 'pks1', name: 'Fabrizzio PKS', implantacao: true, active: true, createdAt: '2026-08-01' };
    expect(zerada(computeTenantAlerts({}, [pks], [cliente], ok), 'pks1')).toBeUndefined();
  });

  it(`loja criada há menos de ${CARENCIA_LOJA_NOVA_DIAS} dias: carência`, () => {
    const nova = { id: 'n1', name: 'Loja Nova' };
    const cliente = { id: 'n1', name: 'Loja Nova', active: true, createdAt: new Date(NOW - 5 * 86400000).toISOString() };
    expect(zerada(computeTenantAlerts({}, [nova], [cliente], ok), 'n1')).toBeUndefined();
  });

  it('passada a carência, alerta', () => {
    const nova = { id: 'n1', name: 'Loja Nova' };
    const cliente = { id: 'n1', name: 'Loja Nova', active: true, createdAt: new Date(NOW - 20 * 86400000).toISOString() };
    expect(zerada(computeTenantAlerts({}, [nova], [cliente], ok), 'n1')).toBeTruthy();
  });

  it('loja suspensa: não é "parada", é decisão sua', () => {
    const cliente = { id: 'x', name: 'DBK Produção', active: false };
    expect(zerada(computeTenantAlerts({}, [DBK], [cliente], ok), 'dbk-producao')).toBeUndefined();
  });
});

describe('o que já existia continua igual', () => {
  it('7 dias sem registro: aviso; 12 dias: vermelho', () => {
    const alerts = computeTenantAlerts({ swiss: ativo(7), 'dbk-producao': ativo(12) }, [SWISS, DBK], [], ok);
    expect(zerada(alerts, 'swiss').severity).toBe('warn');
    expect(zerada(alerts, 'dbk-producao').severity).toBe('danger');
  });
});
