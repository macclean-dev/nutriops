// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { KioskApp } from './kiosk';
import { clearOfflineQueue } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Relato da RT da CASA DOCE (09/10): "na Confeitaria, quando entra às 16:20
// para registrar a temperatura, os equipamentos ficam com os dois vistos como
// se já estivessem preenchidos".
//
// Revisão adversarial (10/10): o teste de string que travava o reset na
// virada do turno passaria mesmo com a ordem dos efeitos errada. Este monta a
// tela de verdade, com o relógio controlado, e olha o card.
// ─────────────────────────────────────────────────────────────────────────────

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LOJA = 'casadoce';
const TURNOS = [
  { id: 'manha', name: 'Manhã', start: '07:00', end: '14:59' },
  { id: 'tarde', name: 'Tarde', start: '15:00', end: '22:00' },
];
const hoje = (h, m) => { const d = new Date(2026, 9, 9); d.setHours(h, m, 0, 0); return d; };
const leitura = (equipment, quando) => ({
  id: `r-${equipment}-${quando.getTime()}`, tenantId: LOJA, equipment, equipmentKey: equipment,
  equipmentInput: equipment, value: 4, createdAt: quando.toISOString(),
});
const config = {
  tenantId: LOJA, tenantName: 'CASA DOCE', userName: 'Confeitaria', userRole: 'Colaborador',
  // Dois equipamentos: com todos feitos a tela troca a grade pelo "concluído".
  equipmentCatalog: [
    { label: 'Vitrine Confeitaria', location: 'Confeitaria', min: 0, max: 5 },
    { label: 'Geladeira Confeitaria', location: 'Confeitaria', min: 0, max: 5 },
  ],
};

let container, root;
const marcas = () => (container.textContent.match(/✓✓/g) ?? []).length;
const esperarSemente = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  localStorage.setItem(`nutriops.turns.${LOJA}`, JSON.stringify(TURNOS));
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
});

const montar = async () => {
  root = createRoot(container);
  await act(async () => { root.render(<KioskApp config={config} onExit={() => {}} />); });
  await esperarSemente();
};

describe('quiosque: ✓✓ por turno, de verdade na tela', () => {
  it('16:20: a leitura das 08:00 não marca o card (o caso da Confeitaria)', async () => {
    vi.setSystemTime(hoje(16, 20));
    localStorage.setItem('nutriops.temperature.records', JSON.stringify([leitura('Vitrine Confeitaria', hoje(8, 0))]));
    await montar();
    expect(marcas()).toBe(0);
  });

  it('16:20: a leitura das 15:30 marca', async () => {
    vi.setSystemTime(hoje(16, 20));
    localStorage.setItem('nutriops.temperature.records', JSON.stringify([leitura('Vitrine Confeitaria', hoje(15, 30))]));
    await montar();
    expect(marcas()).toBe(1);
  });

  it('tablet aberto na virada do turno: a marca da manhã some sozinha às 15:00', async () => {
    vi.setSystemTime(hoje(14, 50));
    localStorage.setItem('nutriops.temperature.records', JSON.stringify([leitura('Vitrine Confeitaria', hoje(14, 30))]));
    await montar();
    expect(marcas()).toBe(1);                       // manhã: feito

    vi.setSystemTime(hoje(15, 1));
    await act(async () => { vi.advanceTimersByTime(10000); });   // relógio do quiosque roda a cada 10 s
    await esperarSemente();
    expect(marcas()).toBe(0);                       // tarde: pendente de novo
  });
});
