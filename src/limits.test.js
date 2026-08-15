import { describe, it, expect } from 'vitest';
import { heuristicLimits, resolveLimits, resolveTone, suggestLimits, dedupeCatalog, normalizeEquipmentName, getEquipmentEntry, suspectMissingMinus, conformityStats, byWorstConformity } from './limits';

describe('heuristicLimits', () => {
  it('freezer/congelado → -25/-18', () => {
    expect(heuristicLimits('Freezer')).toEqual({ min: -25, max: -18 });
    expect(heuristicLimits('Câmara Congelada')).toEqual({ min: -25, max: -18 });
    expect(heuristicLimits('congelador')).toEqual({ min: -25, max: -18 });
  });

  it('resto → 0/9', () => {
    expect(heuristicLimits('Refrigerador')).toEqual({ min: 0, max: 9 });
    expect(heuristicLimits('Vitrine')).toEqual({ min: 0, max: 9 });
    expect(heuristicLimits('')).toEqual({ min: 0, max: 9 });
  });

  it('case-insensitive', () => {
    expect(heuristicLimits('FREEZER')).toEqual({ min: -25, max: -18 });
  });
});

describe('resolveLimits', () => {
  it('usa minTemp/maxTemp do equipamento passado direto', () => {
    expect(resolveLimits('Qualquer', { minTemp: 2, maxTemp: 6 })).toEqual({ min: 2, max: 6 });
  });

  it('ignora equipamento sem min/max válidos e cai na heurística', () => {
    expect(resolveLimits('Freezer', { minTemp: null, maxTemp: undefined })).toEqual({ min: -25, max: -18 });
  });

  it('busca no catálogo por label exato', () => {
    const cat = [{ label: 'Geladeira', minTemp: 1, maxTemp: 5 }];
    expect(resolveLimits('Geladeira', cat)).toEqual({ min: 1, max: 5 });
  });

  it('busca no catálogo por alias', () => {
    const cat = [{ label: 'Refrigerador', aliases: ['geladeira'], minTemp: 1, maxTemp: 5 }];
    expect(resolveLimits('Geladeira', cat)).toEqual({ min: 1, max: 5 });
  });

  it('catálogo sem match cai na heurística', () => {
    const cat = [{ label: 'Outro', minTemp: 1, maxTemp: 5 }];
    expect(resolveLimits('Freezer', cat)).toEqual({ min: -25, max: -18 });
  });

  it('sem contexto cai na heurística', () => {
    expect(resolveLimits('Freezer')).toEqual({ min: -25, max: -18 });
    expect(resolveLimits('Balcão')).toEqual({ min: 0, max: 9 });
  });

  it('catálogo vazio cai na heurística', () => {
    expect(resolveLimits('Freezer', [])).toEqual({ min: -25, max: -18 });
  });

  it('aceita minTemp/maxTemp = 0 (Number.isFinite, não truthy)', () => {
    expect(resolveLimits('X', { minTemp: 0, maxTemp: 0 })).toEqual({ min: 0, max: 0 });
  });
});

describe('resolveTone', () => {
  it('dentro da faixa → ok', () => {
    expect(resolveTone(4, 0, 9)).toBe('ok');
    expect(resolveTone(0, 0, 9)).toBe('ok'); // borda inferior
    expect(resolveTone(9, 0, 9)).toBe('ok'); // borda superior
  });

  it('até 3° fora → warn', () => {
    expect(resolveTone(11, 0, 9)).toBe('warn'); // +2
    expect(resolveTone(12, 0, 9)).toBe('warn'); // +3 exato
    expect(resolveTone(-3, 0, 9)).toBe('warn'); // -3 exato
  });

  it('mais de 3° fora → danger', () => {
    expect(resolveTone(13, 0, 9)).toBe('danger');  // +4
    expect(resolveTone(-4, 0, 9)).toBe('danger');
    expect(resolveTone(30, 0, 9)).toBe('danger');
  });

  it('valor/faixa inválidos (NaN) → neutral', () => {
    expect(resolveTone('abc', 0, 9)).toBe('neutral');
    expect(resolveTone(4, undefined, 9)).toBe('neutral'); // Number(undefined) = NaN
    expect(resolveTone(4, 0, undefined)).toBe('neutral');
    expect(resolveTone(undefined, 0, 9)).toBe('neutral');
  });

  it('quirk: null vira 0 (Number(null)===0), NÃO neutral', () => {
    // Comportamento existente documentado — null min/max é coagido a 0.
    // resolveTone(4, null, 9): faixa 0–9 → ok.
    expect(resolveTone(4, null, 9)).toBe('ok');
    expect(resolveTone(-1, null, 9)).toBe('warn'); // -1 está 1° abaixo de 0
  });

  it('aceita strings numéricas', () => {
    expect(resolveTone('4', '0', '9')).toBe('ok');
  });

  it('faixa de freezer (negativa)', () => {
    expect(resolveTone(-20, -25, -18)).toBe('ok');
    expect(resolveTone(-16, -25, -18)).toBe('warn');  // +2 acima do max
    expect(resolveTone(-10, -25, -18)).toBe('danger'); // muito acima
  });
});

describe('suggestLimits', () => {
  it('é a heurística pelo nome', () => {
    expect(suggestLimits('Freezer')).toEqual({ min: -25, max: -18 });
    expect(suggestLimits('Geladeira')).toEqual({ min: 0, max: 9 });
  });
});

describe('dedupeCatalog — remove equipamento duplicado (bug Swiss)', () => {
  it('colapsa labels iguais mantendo a 1ª ocorrência', () => {
    const cat = [
      { label: 'Freezer', location: 'Cozinha' },
      { label: 'Refrigerador' },
      { label: 'Freezer', location: 'Salão' }, // dupe exato
    ];
    const out = dedupeCatalog(cat);
    expect(out).toHaveLength(2);
    expect(out.map(e => e.label)).toEqual(['Freezer', 'Refrigerador']);
    expect(out[0].location).toBe('Cozinha'); // manteve a 1ª
  });
  it('colapsa variações de caixa e espaço', () => {
    const out = dedupeCatalog([
      { label: 'ADEGA DE VINHOS' },
      { label: '  adega de vinhos ' }, // mesma coisa (caixa+espaço)
      { label: 'Balcão Refrigerado cozinha' },
      { label: 'Balcão Refrigerado Cozinha' },
    ]);
    expect(out).toHaveLength(2);
  });
  it('preserva itens sem label e é robusto a entrada inválida', () => {
    expect(dedupeCatalog(null)).toEqual([]);
    expect(dedupeCatalog([])).toEqual([]);
    const semLabel = [{ label: '' }, { location: 'x' }];
    expect(dedupeCatalog(semLabel)).toHaveLength(2); // não colapsa vazios
  });
});

describe('normalizeEquipmentName', () => {
  const catalog = [
    { label: 'Fritadeira 1', aliases: ['fritadeira um', 'fryer 1'] },
    { label: 'Forno Combinado', aliases: [] },
  ];

  it('casa por label exato (case-insensitive) e devolve o label canônico', () => {
    expect(normalizeEquipmentName('fritadeira 1', catalog)).toBe('Fritadeira 1');
    expect(normalizeEquipmentName('FRITADEIRA 1', catalog)).toBe('Fritadeira 1');
  });
  it('casa por alias e devolve o label canônico — evita fragmentar o histórico', () => {
    expect(normalizeEquipmentName('fritadeira um', catalog)).toBe('Fritadeira 1');
    expect(normalizeEquipmentName('Fryer 1', catalog)).toBe('Fritadeira 1');
  });
  it('sem casar com nada do catálogo, devolve o texto digitado como veio (trim)', () => {
    expect(normalizeEquipmentName('  Tacho novo  ', catalog)).toBe('Tacho novo');
  });
  it('texto vazio vira "Equipamento sem nome"', () => {
    expect(normalizeEquipmentName('', catalog)).toBe('Equipamento sem nome');
    expect(normalizeEquipmentName('   ', catalog)).toBe('Equipamento sem nome');
  });
});

describe('getEquipmentEntry', () => {
  const catalog = [{ label: 'Freezer 1', aliases: ['freezer um'], minTemp: -25, maxTemp: -18 }];

  it('encontra por label ou alias, case-insensitive', () => {
    expect(getEquipmentEntry(catalog, 'freezer 1')?.maxTemp).toBe(-18);
    expect(getEquipmentEntry(catalog, 'Freezer Um')?.maxTemp).toBe(-18);
  });
  it('sem casar, devolve null', () => {
    expect(getEquipmentEntry(catalog, 'Inexistente')).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug real (14/08): a nutricionista da CASA DOCE digitava -18 no freezer e
// gravava +18 — `inputMode="decimal"` não tem tecla de menos no celular.
// ─────────────────────────────────────────────────────────────────────────────
describe('suspectMissingMinus', () => {
  const FREEZER = [-25, -18];   // Bancada congelada — F.2, o caso reportado

  it('pega o caso reportado: +18 num freezer -25/-18', () => {
    expect(suspectMissingMinus(18, ...FREEZER)).toBe(true);
  });

  it('pega outros valores plausíveis do mesmo freezer', () => {
    expect(suspectMissingMinus(20, ...FREEZER)).toBe(true);
    expect(suspectMissingMinus(22, ...FREEZER)).toBe(true);
  });

  it('valor já negativo não é suspeito', () => {
    expect(suspectMissingMinus(-18, ...FREEZER)).toBe(false);
    expect(suspectMissingMinus(-30, ...FREEZER)).toBe(false); // desvio real, não sinal
  });

  it('freezer REALMENTE quebrado a +5 não vira -5 — negar não conserta', () => {
    expect(suspectMissingMinus(5, ...FREEZER)).toBe(false);
  });

  it('equipamento que aceita positivo nunca acusa (geladeira 0-5)', () => {
    expect(suspectMissingMinus(18, 0, 5)).toBe(false);
    expect(suspectMissingMinus(3, 0, 5)).toBe(false);
  });

  it('banho-maria (60-85) nunca acusa — max positivo', () => {
    expect(suspectMissingMinus(70, 60, 85)).toBe(false);
  });

  it('valor dentro/perto da faixa não acusa mesmo em freezer', () => {
    expect(suspectMissingMinus(0, ...FREEZER)).toBe(false);
  });

  it('não quebra com entrada inválida', () => {
    expect(suspectMissingMinus('', -25, -18)).toBe(false);
    expect(suspectMissingMinus(18, null, undefined)).toBe(false);
    expect(suspectMissingMinus(NaN, -25, -18)).toBe(false);
  });
});

// Pedido da RT (15/08): com 40+ equipamentos, achar quem está fora de
// conformidade virava caça ao tesouro na lista.
describe('conformityStats', () => {
  const rec = (value, min = -25, max = -18) => ({ value, min, max });

  it('conta ok/desvio/crítico e calcula a %', () => {
    const s = conformityStats([rec(-20), rec(-20), rec(-16), rec(30)]);
    expect(s).toEqual({ total: 4, ok: 2, warn: 1, danger: 1, pct: 50 });
  });

  it('tudo dentro da faixa = 100%', () => {
    expect(conformityStats([rec(-20), rec(-22)]).pct).toBe(100);
  });

  it('sem leitura devolve pct null, NÃO zero — ausência de dado não é 0%', () => {
    expect(conformityStats([])).toEqual({ total: 0, ok: 0, warn: 0, danger: 0, pct: null });
    expect(conformityStats(undefined).pct).toBe(null);
  });
});

describe('byWorstConformity', () => {
  const eq = (pct, danger = 0) => ({ pct, danger });

  it('pior conformidade primeiro', () => {
    const out = [eq(100), eq(25), eq(67)].sort(byWorstConformity).map(e => e.pct);
    expect(out).toEqual([25, 67, 100]);
  });

  it('empate no % desempata por mais críticos', () => {
    const out = [eq(50, 1), eq(50, 4)].sort(byWorstConformity).map(e => e.danger);
    expect(out).toEqual([4, 1]);
  });

  it('sem leitura (null) vai pro FIM, não pro topo', () => {
    const out = [eq(null), eq(100), eq(25)].sort(byWorstConformity).map(e => e.pct);
    expect(out).toEqual([25, 100, null]);
  });

  it('só nulls não quebra a ordenação', () => {
    expect([eq(null), eq(null)].sort(byWorstConformity)).toHaveLength(2);
  });
});
