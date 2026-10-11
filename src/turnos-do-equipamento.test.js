import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushEquipmentItem, saveSupabaseConfig, clearOfflineQueue } from './repository';
import { readFileSync } from 'node:fs';
import { turnosQueCobram, cobradoNoTurno, rotuloDosTurnos, leiturasEsperadasNoDia } from './turnos-do-equipamento';
import { computeTurnAlertsPure } from './turn-alerts';

// ─────────────────────────────────────────────────────────────────────────────
// Proposta 4 da análise de produto (10/10). A Bancada F.2 da CASA DOCE liga de
// manhã e desliga à tarde (relato da RT, 06/10): cobrada à tarde, vira alerta
// falso; marcada como "só liga quando em uso", perde a cobrança da manhã.
// ─────────────────────────────────────────────────────────────────────────────

const TURNOS = [
  { id: 'manha', name: 'Manhã', start: '07:00', end: '14:59' },
  { id: 'tarde', name: 'Tarde', start: '15:00', end: '22:00' },
];
const F2 = { label: 'Bancada F.2', turnosCobrados: ['manha'] };
const sempre = { label: 'Câmara C.1' };

describe('em quais turnos cobra', () => {
  it('sem escolha: todos (o padrão de sempre)', () => {
    expect(turnosQueCobram(sempre, TURNOS).map((t) => t.id)).toEqual(['manha', 'tarde']);
  });
  it('F.2: só de manhã', () => {
    expect(cobradoNoTurno(F2, TURNOS[0], TURNOS)).toBe(true);
    expect(cobradoNoTurno(F2, TURNOS[1], TURNOS)).toBe(false);
    expect(rotuloDosTurnos(F2, TURNOS)).toBe('Cobrado em: Manhã');
    expect(rotuloDosTurnos(sempre, TURNOS)).toBeNull();
  });
  it('só liga quando em uso: nenhum', () => {
    expect(turnosQueCobram({ label: 'U.3', usoIntermitente: true, turnosCobrados: ['manha'] }, TURNOS)).toEqual([]);
  });
  it('turno escolhido foi apagado: volta a cobrar em todos (nunca deixa de cobrar em silêncio)', () => {
    expect(turnosQueCobram({ label: 'X', turnosCobrados: ['noite'] }, TURNOS).map((t) => t.id)).toEqual(['manha', 'tarde']);
  });
});

describe('alerta de turno', () => {
  const as = (h, m) => { const d = new Date(2026, 9, 10); d.setHours(h, m, 0, 0); return d; };
  const leitura = (equipment, quando) => ({ tenantId: 'cd', equipment, equipmentInput: equipment, equipmentKey: equipment, value: -15, createdAt: quando.toISOString() });

  it('16:00, F.2 medida às 08:00: sem alerta da tarde para ela; a câmara sem leitura à tarde continua cobrada', () => {
    const recs = [leitura('Bancada F.2', as(8, 0)), leitura('Câmara C.1', as(8, 5))];
    const alertas = computeTurnAlertsPure(TURNOS, recs, [F2, sempre], 'cd', false, as(16, 0));
    expect(alertas.filter((a) => a.equipment === 'Bancada F.2')).toEqual([]);
    expect(alertas.map((a) => `${a.equipment}/${a.turn}`)).toEqual(['Câmara C.1/Tarde']);
  });

  it('a manhã da F.2 continua cobrada', () => {
    const alertas = computeTurnAlertsPure(TURNOS, [], [F2], 'cd', false, as(10, 0));
    expect(alertas.map((a) => `${a.equipment}/${a.turn}`)).toEqual(['Bancada F.2/Manhã']);
  });
});

describe('cobertura do dia', () => {
  it('soma os turnos de cada equipamento (antes: todos × todos)', () => {
    expect(leiturasEsperadasNoDia([F2, sempre, { label: 'U.3', usoIntermitente: true }], TURNOS)).toBe(3);
  });
});

describe('nuvem', () => {
  const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
  it('a coluna só vai quando a tela mandou a lista (nada trava na fila antes do SQL); vazia apaga com null', () => {
    expect(repo).toContain('...(Array.isArray(eq.turnosCobrados) ? { turnos_cobrados: eq.turnosCobrados.length ? eq.turnosCobrados : null } : {}),');
  });
  it('o SQL prova o projeto, só acrescenta a coluna e confere', () => {
    const sql = readFileSync(`${process.cwd()}/docs/equipamento-turnos-cobrados.sql`, 'utf8');
    expect(sql).toContain('select current_database()');
    expect(sql).toContain('owuycuyfdngyjsumwgmy');
    expect(sql).toContain('add column if not exists turnos_cobrados jsonb');
    expect(sql).not.toMatch(/drop |create policy|delete from|update public/i);
  });
});

describe('o que vai para a nuvem ao salvar', () => {
  beforeEach(() => {
    localStorage.clear(); clearOfflineQueue();
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const corpo = async (eq) => {
    const spy = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }));
    vi.stubGlobal('fetch', spy);
    await pushEquipmentItem('cd', eq);
    return JSON.parse(spy.mock.calls[0][1].body);
  };
  it('com turnos escolhidos: manda a lista', async () => {
    expect((await corpo(F2)).turnos_cobrados).toEqual(['manha']);
  });
  it('voltou a cobrar em todos (lista vazia): manda null para apagar a escolha antiga', async () => {
    const b = await corpo({ label: 'Bancada F.2', turnosCobrados: [] });
    expect('turnos_cobrados' in b).toBe(true);
    expect(b.turnos_cobrados).toBeNull();
  });
  it('equipamento que nunca usou: nem manda a coluna (outras lojas não dependem do SQL)', async () => {
    expect('turnos_cobrados' in (await corpo(sempre))).toBe(false);
  });
});
