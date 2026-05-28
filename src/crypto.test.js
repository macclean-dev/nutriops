import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, generateSetupPin } from './crypto';

describe('crypto', () => {
  describe('hashPin', () => {
    it('é determinístico pro mesmo pin+salt', async () => {
      const a = await hashPin('1234', 'tenant-x');
      const b = await hashPin('1234', 'tenant-x');
      expect(a).toBe(b);
    });

    it('produz hashes diferentes pra salts diferentes (defesa contra rainbow)', async () => {
      const a = await hashPin('1234', 'tenant-x');
      const b = await hashPin('1234', 'tenant-y');
      expect(a).not.toBe(b);
    });

    it('produz hashes diferentes pra pins diferentes (mesmo salt)', async () => {
      const a = await hashPin('1234', 'tenant-x');
      const b = await hashPin('5678', 'tenant-x');
      expect(a).not.toBe(b);
    });

    it('retorna hex de 64 chars (SHA-256, 256 bits)', async () => {
      const hash = await hashPin('1234', 'tenant-x');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejeita pin ou salt vazios', async () => {
      await expect(hashPin('', 'tenant-x')).rejects.toThrow();
      await expect(hashPin('1234', '')).rejects.toThrow();
    });

    it('aceita pin como número e converte', async () => {
      const a = await hashPin('1234', 'salt');
      const b = await hashPin(1234, 'salt');
      expect(a).toBe(b);
    });
  });

  describe('verifyPin', () => {
    it('valida pin correto', async () => {
      const hash = await hashPin('1234', 'tenant-x');
      expect(await verifyPin('1234', 'tenant-x', hash)).toBe(true);
    });

    it('rejeita pin incorreto', async () => {
      const hash = await hashPin('1234', 'tenant-x');
      expect(await verifyPin('5678', 'tenant-x', hash)).toBe(false);
    });

    it('rejeita quando salt não bate (mesmo pin, salt diferente)', async () => {
      const hash = await hashPin('1234', 'tenant-x');
      expect(await verifyPin('1234', 'tenant-y', hash)).toBe(false);
    });

    it('retorna false pra hash null/undefined', async () => {
      expect(await verifyPin('1234', 'tenant-x', null)).toBe(false);
      expect(await verifyPin('1234', 'tenant-x', undefined)).toBe(false);
      expect(await verifyPin('1234', 'tenant-x', '')).toBe(false);
    });
  });

  describe('generateSetupPin', () => {
    it('retorna string de 4 dígitos por default', () => {
      for (let i = 0; i < 50; i++) {
        const pin = generateSetupPin();
        expect(pin).toMatch(/^\d{4}$/);
      }
    });

    it('respeita parâmetro digits', () => {
      expect(generateSetupPin(6)).toMatch(/^\d{6}$/);
      expect(generateSetupPin(3)).toMatch(/^\d{3}$/);
    });

    it('preserva zeros à esquerda', () => {
      // Confirma que padStart funciona pra valores pequenos.
      // Não conseguimos controlar o random, mas geramos muitos e olhamos
      // os que começam com zero.
      const samples = Array.from({ length: 200 }, () => generateSetupPin(4));
      const startsWithZero = samples.filter(p => p.startsWith('0'));
      // ~20 expected (10% chance) — qualquer um valida o padding
      expect(startsWithZero.length).toBeGreaterThan(0);
      expect(startsWithZero.every(p => p.length === 4)).toBe(true);
    });

    it('produz valores distintos entre chamadas (não é constante)', () => {
      const samples = new Set();
      for (let i = 0; i < 30; i++) samples.add(generateSetupPin(4));
      // Com 30 amostras de 10000 possíveis, distintos deve ser >= 25
      expect(samples.size).toBeGreaterThanOrEqual(25);
    });
  });
});
