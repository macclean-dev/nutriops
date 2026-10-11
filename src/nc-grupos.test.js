import { describe, it, expect } from 'vitest';
import { agruparPendencias, filtrarPendencias, resumoDoGrupo, acoesDoLote } from './nc-grupos';
import { excludeWithAction } from './nonconformities';

// ─────────────────────────────────────────────────────────────────────────────
// Proposta 2 da análise de produto (10/10). A RT da CASA DOCE não achava as
// ações dos 7 desvios da Bancada F.2 (12 a 14/08): a Central listava as 15
// mais recentes e o resto ficava atrás de "Ver os outros".
// ─────────────────────────────────────────────────────────────────────────────

const temp = (id, label, at, detalhe = '') => ({ source: 'temperature', sourceId: id, sourceLabel: label, sourceDetail: detalhe, at });
const F2 = [12, 12, 13, 13, 13, 14, 14].map((d, i) => temp(`f2-${i}`, 'Bancada congelada F.2', `2026-08-${d}T1${i}:00:00Z`, `-${3 + i}°C`));
const recentes = Array.from({ length: 20 }, (_, i) => temp(`v-${i}`, `Vitrine ${i}`, `2026-10-0${1 + (i % 9)}T10:00:00Z`));

describe('agrupar', () => {
  it('os 7 desvios da F.2 viram UM grupo, mesmo com 20 pendências mais novas', () => {
    const grupos = agruparPendencias([...recentes, ...F2]);
    const f2 = grupos.find((g) => g.sourceLabel.includes('F.2'));
    expect(f2.itens).toHaveLength(7);
    expect(resumoDoGrupo(f2)).toBe('7 ocorrências, de 12/08 a 14/08');
  });

  it('o grupo mais antigo vem primeiro (é o que foi esquecido)', () => {
    expect(agruparPendencias([...recentes, ...F2])[0].sourceLabel).toContain('F.2');
  });

  it('mesmo nome em origens diferentes são grupos diferentes', () => {
    const g = agruparPendencias([temp('1', 'Câmara', '2026-10-01T00:00:00Z'), { ...temp('2', 'Câmara', '2026-10-02T00:00:00Z'), source: 'form' }]);
    expect(g).toHaveLength(2);
  });

  it('dentro do grupo, da mais antiga para a mais nova', () => {
    const [g] = agruparPendencias([temp('b', 'X', '2026-10-02T12:00:00Z'), temp('a', 'X', '2026-10-01T12:00:00Z')]);
    expect(g.itens.map((i) => i.sourceId)).toEqual(['a', 'b']);
    expect(resumoDoGrupo({ itens: [g.itens[0]], inicio: g.inicio, fim: g.inicio })).toBe('1 ocorrência, em 01/10');
  });
});

describe('filtrar', () => {
  const agora = Date.parse('2026-10-10T12:00:00Z');
  const itens = [...F2, ...recentes, { ...temp('r', 'Leite', '2026-10-09T10:00:00Z'), source: 'receiving' }];

  it('por origem', () => {
    expect(filtrarPendencias(itens, { origem: 'receiving' }).map((i) => i.sourceId)).toEqual(['r']);
  });
  it('por período: últimos 30 dias tira agosto', () => {
    expect(filtrarPendencias(itens, { dias: 30, agora }).some((i) => i.sourceId.startsWith('f2'))).toBe(false);
  });
  it('por equipamento, sem acento e sem caixa', () => {
    expect(filtrarPendencias(itens, { busca: 'BANCADA congelada' })).toHaveLength(7);
    expect(filtrarPendencias([temp('c', 'Câmara C.1', '2026-10-01T00:00:00Z')], { busca: 'camara' })).toHaveLength(1);
  });
  it('sem filtro: tudo', () => {
    expect(filtrarPendencias(itens)).toHaveLength(itens.length);
  });
});

describe('uma ação para o grupo inteiro', () => {
  let n = 0;
  const lote = acoesDoLote(F2, { tenantId: 'cd', description: 'Bancada em degelo; produto descartado.', responsible: 'Ana', deadline: '2026-10-12', agoraIso: '2026-10-10T12:00:00Z', novoId: () => `a${n++}` });

  it('cria uma ação por ocorrência, com o mesmo texto, responsável e prazo', () => {
    expect(lote).toHaveLength(7);
    expect(new Set(lote.map((a) => a.sourceId)).size).toBe(7);
    expect(lote.every((a) => a.description === 'Bancada em degelo; produto descartado.' && a.responsible === 'Ana' && a.deadline === '2026-10-12' && a.status === 'aberta')).toBe(true);
    expect(lote[0].sourceDetail).toBe(F2[0].sourceDetail);
  });

  it('as 7 saem da lista de pendências (cada uma casada com a sua ação)', () => {
    expect(excludeWithAction([...F2, ...recentes], lote)).toHaveLength(recentes.length);
  });
});
