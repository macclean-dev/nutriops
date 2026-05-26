import { describe, it, expect } from 'vitest';
import { getPermissions, canAccess, ROLES, PERMISSIONS } from './permissions';

describe('permissions', () => {
  it('exporta todos os roles esperados', () => {
    expect(ROLES).toEqual(['Colaborador', 'Supervisor', 'Nutricionista RT', 'Administrador', 'Super-admin']);
  });

  it('getPermissions retorna Colaborador como fallback pra role desconhecido', () => {
    const p = getPermissions('Visitante');
    expect(p).toBe(PERMISSIONS['Colaborador']);
  });

  it('Colaborador vê o hub de controles mas não relatórios', () => {
    expect(canAccess('Colaborador', 'controls')).toBe(true);
    expect(canAccess('Colaborador', 'handwash')).toBe(true);
    expect(canAccess('Colaborador', 'reportsHub')).toBe(false);
    expect(canAccess('Colaborador', 'dashboard')).toBe(false);
  });

  it('Supervisor vê relatórios e auditoria mas não team management', () => {
    expect(canAccess('Supervisor', 'reportsHub')).toBe(true);
    expect(canAccess('Supervisor', 'audit')).toBe(true);
    expect(canAccess('Supervisor', 'team')).toBe(false);
    expect(canAccess('Supervisor', 'users')).toBe(false);
  });

  it('Nutricionista RT vê team mas não settings de admin', () => {
    expect(canAccess('Nutricionista RT', 'team')).toBe(true);
    expect(canAccess('Nutricionista RT', 'users')).toBe(true);
    expect(canAccess('Nutricionista RT', 'rtpanel')).toBe(true);
    expect(canAccess('Nutricionista RT', 'settings')).toBe(false);
  });

  it('Administrador e Super-admin têm acesso total', () => {
    const allKeys = ['controls','reportsHub','team','settings','users','sessions','equipment','dashboard'];
    for (const key of allKeys) {
      expect(canAccess('Administrador', key)).toBe(true);
      expect(canAccess('Super-admin',   key)).toBe(true);
    }
  });

  it('canAccess de view inexistente retorna false', () => {
    expect(canAccess('Administrador', 'inventada')).toBe(false);
  });
});
