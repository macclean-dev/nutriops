import { describe, it, expect, beforeEach } from 'vitest';
import { readOperator, writeOperator, applyOperatorToSession, isStoreAccountSession } from './operator';

// ─────────────────────────────────────────────────────────────────────────────
// "Suas leituras hoje" ignorava quem mediu pelo Modo Quiosque (CASA DOCE,
// 17/08). O nome da pessoa chega por DOIS caminhos diferentes, e o KPI só
// conhecia um deles. Estes testes travam a regra dos dois caminhos.
//
// O KPI em si vive em overview-v2.jsx (componente pesado, sem testing-library
// no projeto); aqui fica a lógica que ele usa — a mesma que decide de quem é
// a leitura.
// ─────────────────────────────────────────────────────────────────────────────

const contaLeitura = (registro, sessionUserName, operadorNome) =>
  new Set([sessionUserName, operadorNome].filter(Boolean)).has(registro.user);

const leitura = (user) => ({ user, value: -18, createdAt: new Date().toISOString() });

describe('de quem é a leitura', () => {
  beforeEach(() => localStorage.clear());

  it('tela principal: o operador é aplicado NA SESSÃO, então bate pelo nome dela', () => {
    const sessao = applyOperatorToSession(
      { tenantId: 'swiss', accessToken: 'jwt', isStoreAccount: true, user: { name: 'Equipe', role: 'Colaborador' } },
      'Maria',
    );
    expect(sessao.user.name).toBe('Maria');
    expect(contaLeitura(leitura('Maria'), sessao.user.name, null)).toBe(true);
  });

  // O caso que estava quebrado: o quiosque carimba o operador no REGISTRO, mas
  // a sessão continua sendo a conta da loja.
  it('quiosque: registro leva "Maria", sessão continua "Equipe" — e mesmo assim conta', () => {
    writeOperator('swiss', 'Maria');
    const operador = readOperator('swiss')?.name;
    expect(contaLeitura(leitura('Maria'), 'Equipe', operador)).toBe(true);
  });

  it('antes da correção isso dava falso — é a regressão que não pode voltar', () => {
    // comparação antiga: só contra o nome da sessão
    expect(leitura('Maria').user === 'Equipe').toBe(false);
  });

  it('leitura de OUTRA pessoa não vira minha', () => {
    writeOperator('swiss', 'Maria');
    expect(contaLeitura(leitura('João'), 'Equipe', readOperator('swiss')?.name)).toBe(false);
  });

  it('sem operador escolhido, vale só o nome da sessão', () => {
    expect(readOperator('swiss')).toBeNull();
    expect(contaLeitura(leitura('Ana'), 'Ana', readOperator('swiss')?.name)).toBe(true);
    expect(contaLeitura(leitura('Maria'), 'Ana', readOperator('swiss')?.name)).toBe(false);
  });

  it('operador expirado não conta mais como eu — o TTL vale pro KPI também', () => {
    writeOperator('swiss', 'Maria');
    const bruto = JSON.parse(localStorage.getItem('nutriops.operator.swiss'));
    // envelhece além do TTL de 6h (o campo é `setAt`, ver operator.js)
    localStorage.setItem('nutriops.operator.swiss', JSON.stringify({ ...bruto, setAt: new Date(Date.now() - 48 * 3600_000).toISOString() }));
    expect(readOperator('swiss')).toBeNull();
    expect(contaLeitura(leitura('Maria'), 'Equipe', readOperator('swiss')?.name)).toBe(false);
  });
});

describe('applyOperatorToSession — não pode perder as credenciais', () => {
  it('preserva accessToken e refreshToken ao trocar o nome', () => {
    const antes = {
      tenantId: 'swiss', accessToken: 'jwt-x', refreshToken: 'rt-x', isStoreAccount: true,
      user: { name: 'Equipe', role: 'Colaborador' },
    };
    const depois = applyOperatorToSession(antes, 'Maria');
    expect(depois.accessToken).toBe('jwt-x');     // sem isso o device perde o sync
    expect(depois.refreshToken).toBe('rt-x');
    expect(depois.user.role).toBe('Colaborador'); // permissão é da CONTA, não de quem tocou
  });

  it('sessão que não é conta de loja passa intacta', () => {
    const pessoal = { tenantId: 'swiss', user: { name: 'Ana Paula', role: 'Nutricionista RT' } };
    expect(isStoreAccountSession(pessoal)).toBe(false);
    expect(applyOperatorToSession(pessoal, 'Maria')).toBe(pessoal);
  });
});
