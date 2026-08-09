import { describe, it, expect } from 'vitest';
import { employeeTrainingStatus } from './training-status';

// Item 7 da revisão de produto (09/08) — antes havia 3 contas divergentes de
// "capacitação vencendo"; esta é a canônica que todas as telas passam a usar.

const DAY = 86400000;
const NOW = new Date('2026-08-09T12:00:00').getTime();

function closedSession(daysAgo, name = 'Fran') {
  return { status: 'closed', date: new Date(NOW - daysAgo * DAY).toISOString(), participants: [{ name, confirmed: true }] };
}

describe('employeeTrainingStatus', () => {
  it('nunca participou de nenhuma sessão fechada: "never"', () => {
    expect(employeeTrainingStatus('Fran', [], 12, NOW)).toEqual({ status: 'never', daysAgo: null, session: null });
  });

  it('sessão aberta (não fechada) não conta como participação válida', () => {
    const sessions = [{ status: 'open', date: new Date(NOW - 10*DAY).toISOString(), participants: [{ name:'Fran', confirmed:true }] }];
    expect(employeeTrainingStatus('Fran', sessions, 12, NOW).status).toBe('never');
  });

  it('participação sem confirmação não conta', () => {
    const sessions = [{ status:'closed', date: new Date(NOW - 10*DAY).toISOString(), participants: [{ name:'Fran', confirmed:false }] }];
    expect(employeeTrainingStatus('Fran', sessions, 12, NOW).status).toBe('never');
  });

  it('dentro de 85% do prazo (validityMonths padrão=12 → limite 360 dias, 85% = 306): "ok"', () => {
    expect(employeeTrainingStatus('Fran', [closedSession(300)], 12, NOW).status).toBe('ok');
    expect(employeeTrainingStatus('Fran', [closedSession(306)], 12, NOW).status).toBe('ok'); // limite exato, inclusivo
  });

  it('entre 85% e 100% do prazo: "warn"', () => {
    expect(employeeTrainingStatus('Fran', [closedSession(307)], 12, NOW).status).toBe('warn');
    expect(employeeTrainingStatus('Fran', [closedSession(360)], 12, NOW).status).toBe('warn'); // limite exato, ainda warn
  });

  it('além do prazo: "expired"', () => {
    expect(employeeTrainingStatus('Fran', [closedSession(361)], 12, NOW).status).toBe('expired');
  });

  it('a divergência real que motivou o item 7: 306/365 fixo dizia "warn" aos 363 dias; a conta certa (config=12 meses → limite 360) já diz "expired"', () => {
    const r = employeeTrainingStatus('Fran', [closedSession(363)], 12, NOW);
    expect(r.status).toBe('expired'); // NÃO 'warn' — é o que o valor fixo 365 dizia errado
  });

  it('respeita validityMonths customizado (loja com prazo de 6 meses, não 12)', () => {
    // limite = 6*30 = 180 dias; 85% = 153
    expect(employeeTrainingStatus('Fran', [closedSession(150)], 6, NOW).status).toBe('ok');
    expect(employeeTrainingStatus('Fran', [closedSession(160)], 6, NOW).status).toBe('warn');
    expect(employeeTrainingStatus('Fran', [closedSession(181)], 6, NOW).status).toBe('expired');
  });

  it('pega a sessão MAIS RECENTE entre várias, não a primeira do array', () => {
    const sessions = [closedSession(300), closedSession(10), closedSession(200)];
    const r = employeeTrainingStatus('Fran', sessions, 12, NOW);
    expect(r.daysAgo).toBe(10);
  });

  it('filtra por nome do participante — sessão de outra pessoa não conta', () => {
    const sessions = [closedSession(10, 'Ana Paula')];
    expect(employeeTrainingStatus('Fran', sessions, 12, NOW).status).toBe('never');
  });

  it('validityMonths ausente cai no padrão de 12 meses', () => {
    const r = employeeTrainingStatus('Fran', [closedSession(300)], undefined, NOW);
    expect(r.status).toBe('ok');
  });
});
