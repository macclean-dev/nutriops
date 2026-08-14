import { describe, it, expect } from 'vitest';
import { accessLogToCsv } from './extras';

// Item 18 da revisão de produto — export do histórico de acessos.
describe('accessLogToCsv', () => {
  it('gera cabeçalho + uma linha por acesso', () => {
    const rows = [
      { at: '2026-08-10T12:00:00Z', email: 'ana@casadoce.com', action: 'login', ipAddress: '200.1.2.3' },
    ];
    const csv = accessLogToCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('at,email,action,ipAddress');
    expect(lines[1]).toBe('"2026-08-10T12:00:00Z","ana@casadoce.com","login","200.1.2.3"');
  });

  it('escapa aspas no valor (nunca quebra a coluna)', () => {
    const csv = accessLogToCsv([{ at: 'x', email: 'ana "RT" saraiva@casadoce.com', action: 'login', ipAddress: '1.1.1.1' }]);
    expect(csv).toContain('"ana ""RT"" saraiva@casadoce.com"');
  });

  it('campo ausente vira célula vazia, não "undefined"', () => {
    const csv = accessLogToCsv([{ at: 'x', email: 'ana@casadoce.com', action: 'login' }]); // sem ipAddress
    expect(csv.split('\n')[1]).toBe('"x","ana@casadoce.com","login",""');
  });

  it('lista vazia vira só o cabeçalho', () => {
    expect(accessLogToCsv([])).toBe('at,email,action,ipAddress');
  });

  it('não quebra com undefined/null', () => {
    expect(accessLogToCsv(undefined)).toBe('at,email,action,ipAddress');
    expect(accessLogToCsv(null)).toBe('at,email,action,ipAddress');
  });
});
