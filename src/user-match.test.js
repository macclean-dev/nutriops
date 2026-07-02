import { describe, it, expect } from 'vitest';
import { findUserByName, normalizeName, loginHandle } from './user-match';
import { getPermissions } from './permissions';

const USERS = [
  { name: 'Fran Souza', role: 'Supervisor' },
  { name: 'Ana Paula', role: 'Nutricionista RT' },
  { name: 'Mateus', role: 'Colaborador' },
];

describe('normalizeName', () => {
  it('lowercases, strips accents e troca espaço por ponto', () => {
    expect(normalizeName('Ana Paula')).toBe('ana.paula');
    expect(normalizeName('Mateus')).toBe('mateus');
    expect(normalizeName('  ')).toBe('.');
  });
});

describe('findUserByName', () => {
  it('acha por primeiro nome', () => {
    expect(findUserByName(USERS, 'fran')?.name).toBe('Fran Souza');
    expect(findUserByName(USERS, 'mateus')?.name).toBe('Mateus');
  });
  it('acha por nome completo com ponto ou por primeiro nome', () => {
    expect(findUserByName(USERS, 'ana.paula')?.name).toBe('Ana Paula');
    expect(findUserByName(USERS, 'ana')?.name).toBe('Ana Paula');
  });
  it('acha por nome completo COM ESPAÇO (bug reportado 06/06)', () => {
    expect(findUserByName(USERS, 'ana paula')?.name).toBe('Ana Paula');
    expect(findUserByName(USERS, 'fran souza')?.name).toBe('Fran Souza');
    expect(findUserByName(USERS, '  fran   souza  ')?.name).toBe('Fran Souza');
  });
  it('ignora @ e caixa', () => {
    expect(findUserByName(USERS, '@FRAN')?.name).toBe('Fran Souza');
  });
  it('retorna null pra desconhecido ou entrada inválida', () => {
    expect(findUserByName(USERS, 'joao')).toBeNull();
    expect(findUserByName(USERS, '')).toBeNull();
    expect(findUserByName(null, 'fran')).toBeNull();
  });
});

describe('canSwitchTenant — quem troca de empresa', () => {
  it('Supervisor, RT e Admin podem trocar; Colaborador não', () => {
    expect(getPermissions('Supervisor').canSwitchTenant).toBe(true);
    expect(getPermissions('Nutricionista RT').canSwitchTenant).toBe(true);
    expect(getPermissions('Administrador').canSwitchTenant).toBe(true);
    expect(getPermissions('Super-admin').canSwitchTenant).toBe(true);
    expect(getPermissions('Colaborador').canSwitchTenant).toBe(false);
  });
  it('Supervisor troca mas NÃO vê dados agregados (multiTenant continua false)', () => {
    expect(getPermissions('Supervisor').multiTenant).toBe(false);
    expect(getPermissions('Nutricionista RT').multiTenant).toBe(true);
  });
});

describe('loginHandle — o que o usuário digita pra logar', () => {
  it('primeiro nome (sem acento) + @ + id da empresa', () => {
    expect(loginHandle('Iuana Silva', 'backerei')).toBe('iuana@backerei');
    expect(loginHandle('Ana Paula Saraiva', 'backerei')).toBe('ana@backerei');
    expect(loginHandle('Mateus', 'dbk-producao')).toBe('mateus@dbk-producao');
  });
  it('tira acento do primeiro nome', () => {
    expect(loginHandle('Antônio Sérgio', 'swiss')).toBe('antonio@swiss');
  });
  it("retorna '' pra nome ou tenant vazios", () => {
    expect(loginHandle('', 'swiss')).toBe('');
    expect(loginHandle('Ana', '')).toBe('');
    expect(loginHandle('   ', 'swiss')).toBe('');
  });
});
