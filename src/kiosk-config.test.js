import { describe, it, expect, beforeEach } from 'vitest';
import { readKioskConfig, writeKioskConfig, resolveInitialKioskConfig } from './kiosk-config';

// Achado da revisão de produto (09/08): readKioskConfig existia e nunca era
// chamada — qualquer reload do tablet (acidental, atualização do service
// worker) devolvia o quiosque pro app normal, perdendo a seleção de
// equipamentos configurada. Este módulo é separado de kiosk.jsx (lazy-loaded,
// pesado) justamente pra pages.jsx poder checar isso no boot sem puxar o
// bundle inteiro do quiosque.

beforeEach(() => localStorage.clear());

describe('readKioskConfig / writeKioskConfig', () => {
  it('sem nada salvo, devolve null', () => {
    expect(readKioskConfig()).toBeNull();
  });

  it('round-trip simples', () => {
    const cfg = { tenantId: 'swiss', tenantName: 'Swiss', equipmentCatalog: [{ label: 'Freezer' }] };
    writeKioskConfig(cfg);
    expect(readKioskConfig()).toEqual(cfg);
  });

  it('writeKioskConfig(null) limpa — é o que Sair do quiosque precisa fazer', () => {
    writeKioskConfig({ tenantId: 'swiss' });
    writeKioskConfig(null);
    expect(readKioskConfig()).toBeNull();
  });
});

describe('resolveInitialKioskConfig', () => {
  it('sem config salvo: não restaura nada', () => {
    expect(resolveInitialKioskConfig(null, 'swiss')).toBeNull();
  });

  it('config do MESMO tenant: restaura', () => {
    const saved = { tenantId: 'swiss', equipmentCatalog: [] };
    expect(resolveInitialKioskConfig(saved, 'swiss')).toBe(saved);
  });

  it('config de OUTRA loja (conta trocou de empresa): não restaura o quiosque errado', () => {
    const saved = { tenantId: 'backerei', equipmentCatalog: [] };
    expect(resolveInitialKioskConfig(saved, 'swiss')).toBeNull();
  });
});
