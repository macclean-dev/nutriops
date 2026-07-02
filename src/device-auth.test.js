import { describe, it, expect } from 'vitest';
import { isTokenValid, deviceEmail, invalidateDeviceToken } from './device-auth';

describe('deviceEmail', () => {
  it('deriva o e-mail do device a partir do tenant_id', () => {
    expect(deviceEmail('swiss')).toBe('device-swiss@nutriops.internal');
    expect(deviceEmail('dbk-producao')).toBe('device-dbk-producao@nutriops.internal');
  });
});

describe('isTokenValid — cache do JWT de device', () => {
  const NOW = 1_000_000_000_000;

  it('válido quando falta bem mais que a margem de 60s', () => {
    expect(isTokenValid({ accessToken: 'x', expiresAt: NOW + 3600_000 }, NOW)).toBe(true);
  });
  it('inválido se já expirou', () => {
    expect(isTokenValid({ accessToken: 'x', expiresAt: NOW - 1000 }, NOW)).toBe(false);
  });
  it('inválido dentro da margem de 60s antes de expirar', () => {
    expect(isTokenValid({ accessToken: 'x', expiresAt: NOW + 30_000 }, NOW)).toBe(false);
  });
  it('inválido sem cache, sem accessToken ou sem expiresAt', () => {
    expect(isTokenValid(null, NOW)).toBe(false);
    expect(isTokenValid({ expiresAt: NOW + 3600_000 }, NOW)).toBe(false);
    expect(isTokenValid({ accessToken: 'x' }, NOW)).toBe(false);
  });
});

describe('invalidateDeviceToken — limpa token rejeitado', () => {
  it('remove o cache do tenant (força novo login no próximo getDeviceAccessToken)', () => {
    const key = 'nutriops.device.auth.swiss';
    localStorage.setItem(key, JSON.stringify({ accessToken: 'x', expiresAt: Date.now() + 3600_000 }));
    expect(localStorage.getItem(key)).not.toBeNull();
    invalidateDeviceToken('swiss');
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('não quebra se não havia cache', () => {
    expect(() => invalidateDeviceToken('inexistente')).not.toThrow();
  });
});
