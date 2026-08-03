import { describe, it, expect, beforeEach } from 'vitest';
import {
  readOperator, writeOperator, clearOperator, isOperatorExpired,
  needsOperator, applyOperatorToSession, isStoreAccountSession, OPERATOR_TTL_MS,
} from './operator';

const lojaSession  = { isStoreAccount: true, tenantId: 'swiss', storeName: 'Swiss',
                       user: { name: 'Swiss', role: 'Colaborador', location: 'Swiss' } };
const pessoaSession = { tenantId: 'bf245c3b-2f9', accessToken: 'jwt',
                        user: { name: 'Isabela', role: 'Nutricionista RT' } };

beforeEach(() => localStorage.clear());

describe('operador atual — expiração', () => {
  it('sem operador gravado = expirado', () => {
    expect(isOperatorExpired(null)).toBe(true);
    expect(isOperatorExpired({ name: 'Emmilyn' })).toBe(true);      // sem setAt
    expect(isOperatorExpired({ setAt: new Date().toISOString() })).toBe(true); // sem nome
  });

  it('vale dentro das 6h no mesmo dia', () => {
    const agora = new Date('2026-08-03T14:00:00').getTime();
    const setAt = new Date('2026-08-03T10:00:00').toISOString();   // 4h atrás
    expect(isOperatorExpired({ name: 'Emmilyn', setAt }, agora)).toBe(false);
  });

  it('expira depois de 6h', () => {
    const agora = new Date('2026-08-03T17:30:00').getTime();
    const setAt = new Date('2026-08-03T10:00:00').toISOString();   // 7h30 atrás
    expect(isOperatorExpired({ name: 'Emmilyn', setAt }, agora)).toBe(true);
  });

  it('expira na virada do dia mesmo dentro das 6h', () => {
    // Turno da madrugada: 23h de ontem → 2h de hoje são 3h de diferença, mas é
    // OUTRO dia. Carimbar a leitura de hoje em quem entrou ontem seria mentira.
    const agora = new Date('2026-08-04T02:00:00').getTime();
    const setAt = new Date('2026-08-03T23:00:00').toISOString();
    expect(isOperatorExpired({ name: 'Emmilyn', setAt }, agora)).toBe(true);
  });

  it('readOperator devolve null quando expirado (não vaza nome velho)', () => {
    const velho = { name: 'Emmilyn', setAt: new Date(Date.now() - OPERATOR_TTL_MS - 1000).toISOString() };
    localStorage.setItem('nutriops.operator.swiss', JSON.stringify(velho));
    expect(readOperator('swiss')).toBeNull();
  });
});

describe('operador atual — leitura e escrita', () => {
  it('grava e lê por loja, sem misturar entre lojas', () => {
    writeOperator('swiss', 'Emmilyn');
    writeOperator('backerei', 'Iuana');
    expect(readOperator('swiss').name).toBe('Emmilyn');
    expect(readOperator('backerei').name).toBe('Iuana');
  });

  it('ignora nome vazio', () => {
    expect(writeOperator('swiss', '   ')).toBeNull();
    expect(readOperator('swiss')).toBeNull();
  });

  it('clearOperator apaga', () => {
    writeOperator('swiss', 'Emmilyn');
    clearOperator('swiss');
    expect(readOperator('swiss')).toBeNull();
  });
});

describe('quem precisa escolher operador', () => {
  it('conta de loja sem operador precisa escolher', () => {
    expect(needsOperator(lojaSession)).toBe(true);
  });

  it('conta de loja com operador válido não precisa', () => {
    writeOperator('swiss', 'Emmilyn');
    expect(needsOperator(lojaSession)).toBe(false);
  });

  it('conta pessoal NUNCA precisa — ela já é a pessoa', () => {
    expect(needsOperator(pessoaSession)).toBe(false);
    expect(isStoreAccountSession(pessoaSession)).toBe(false);
  });

  it('sessão por PIN (legado) não é afetada', () => {
    const pin = { tenantId: 'swiss', user: { name: 'Fran', role: 'Supervisor' } };
    expect(needsOperator(pin)).toBe(false);
  });
});

describe('aplicar operador na sessão', () => {
  it('o nome do operador entra em user.name — é ele que vai no registro', () => {
    const s = applyOperatorToSession(lojaSession, 'Emmilyn');
    expect(s.user.name).toBe('Emmilyn');
  });

  it('o papel continua sendo o da CONTA DA LOJA (permissão não muda por operador)', () => {
    const s = applyOperatorToSession(lojaSession, 'Emmilyn');
    expect(s.user.role).toBe('Colaborador');
  });

  it('não mexe em sessão pessoal', () => {
    expect(applyOperatorToSession(pessoaSession, 'Outro')).toBe(pessoaSession);
  });
});
