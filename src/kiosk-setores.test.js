import { describe, it, expect } from 'vitest';
import { ordenarPorSetor, agruparPorSetor } from './setores';
import { seedSavedValuesFromToday, firstPendingIndexIfUntouched } from './kiosk';

// Pedido do cliente (07/08): com 44 equipamentos numa grade única, o
// colaborador da Padaria caçava os dele no meio dos da Gelateria. Cada um
// cuida da própria área.
describe('captura de temperatura agrupada por setor', () => {
  const catalogo = [
    { label:'Forno 02',   location:'Fornos' },
    { label:'Batedeira',  location:'Confeitaria' },
    { label:'Freezer',    location:null },            // sem setor
    { label:'Forno 01',   location:'Fornos' },
    { label:'Balança',    location:'confeitaria' },   // caixa diferente
    { label:'Câmara C.1', location:'Câmaras' },
  ];

  it('ordena por setor e, dentro dele, por nome — sem setor vai pro fim', () => {
    const nomes = ordenarPorSetor(catalogo).map(e => e.label);
    expect(nomes).toEqual(['Câmara C.1', 'Balança', 'Batedeira', 'Forno 01', 'Forno 02', 'Freezer']);
  });

  it('não muta a lista original', () => {
    const antes = catalogo.map(e => e.label);
    ordenarPorSetor(catalogo);
    expect(catalogo.map(e => e.label)).toEqual(antes);
  });

  // O quiosque navega por ÍNDICE do catálogo (activeIdx) e o avanço automático
  // procura o próximo índice não registrado. Se o índice do grupo não for o do
  // array ordenado, tocar num card seleciona OUTRO equipamento — e a leitura
  // vai parar no lugar errado.
  it('o índice de cada item aponta pro array ORDENADO, não pro original', () => {
    const ordenado = ordenarPorSetor(catalogo);
    for (const { itens } of agruparPorSetor(ordenado)) {
      for (const { item, i } of itens) expect(ordenado[i].label).toBe(item.label);
    }
  });

  it('agrupa em blocos contíguos, um por setor', () => {
    const grupos = agruparPorSetor(ordenarPorSetor(catalogo));
    expect(grupos.map(g => g.setor)).toEqual(['Câmaras', 'confeitaria', 'Fornos', 'Sem setor']);
    expect(grupos.find(g => g.setor === 'Fornos').itens).toHaveLength(2);
  });

  it('sem setor nenhum cadastrado, vira um bloco só (o cabeçalho some na tela)', () => {
    const grupos = agruparPorSetor(ordenarPorSetor([{ label:'A' }, { label:'B' }]));
    expect(grupos).toHaveLength(1);
    expect(grupos[0].setor).toBe('Sem setor');
  });

  it('variações de caixa/acento viram UM setor, rotulado pela grafia dominante', () => {
    const misto = [
      { label:'A', location:'Confeitaria' }, { label:'B', location:'confeitaria' },
      { label:'C', location:'CONFEITARIA' }, { label:'D', location:'Confeitaria' },
      { label:'E', location:'Confeitaria' },
    ];
    const grupos = agruparPorSetor(ordenarPorSetor(misto));
    expect(grupos).toHaveLength(1);                 // um bloco, não quatro
    expect(grupos[0].itens).toHaveLength(5);
    expect(grupos[0].setor).toBe('Confeitaria');    // 3x vence 1x e 1x
  });

  it('location só com espaços conta como sem setor', () => {
    const grupos = agruparPorSetor(ordenarPorSetor([{ label:'A', location:'   ' }]));
    expect(grupos[0].setor).toBe('Sem setor');
  });
});

// Achado da revisão de produto (09/08): equipamento medido de manhã por
// outra pessoa/sessão aparecia como pendente à tarde no mesmo tablet,
// convidando duplicata. seedSavedValuesFromToday resolve isso lendo o que já
// foi registrado hoje antes de mostrar a grade.
describe('seedSavedValuesFromToday', () => {
  const HOJE_10H = new Date(); HOJE_10H.setHours(10, 0, 0, 0);
  const nowMs = HOJE_10H.getTime();

  it('marca como feito o que já foi registrado hoje', () => {
    const recs = [{ equipment: 'Freezer', value: -18, createdAt: new Date(nowMs - 3600000).toISOString() }];
    expect(seedSavedValuesFromToday(recs, nowMs)).toEqual({ Freezer: -18 });
  });

  it('ignora leitura de ONTEM — equipamento continua pendente hoje', () => {
    const ontem = new Date(nowMs); ontem.setDate(ontem.getDate() - 1); ontem.setHours(23, 0, 0, 0);
    const recs = [{ equipment: 'Freezer', value: -18, createdAt: ontem.toISOString() }];
    expect(seedSavedValuesFromToday(recs, nowMs)).toEqual({});
  });

  it('duas leituras hoje do mesmo equipamento: fica a mais recente', () => {
    const recs = [
      { equipment: 'Freezer', value: -18, createdAt: new Date(nowMs - 3 * 3600000).toISOString() },
      { equipment: 'Freezer', value: -20, createdAt: new Date(nowMs - 1 * 3600000).toISOString() },
    ];
    expect(seedSavedValuesFromToday(recs, nowMs)).toEqual({ Freezer: -20 });
  });

  it('ordem de chegada não importa (a mais recente por timestamp vence, não a última do array)', () => {
    const recs = [
      { equipment: 'Freezer', value: -20, createdAt: new Date(nowMs - 1 * 3600000).toISOString() },
      { equipment: 'Freezer', value: -18, createdAt: new Date(nowMs - 3 * 3600000).toISOString() },
    ];
    expect(seedSavedValuesFromToday(recs, nowMs)).toEqual({ Freezer: -20 });
  });

  it('sem registros: objeto vazio, sem quebrar', () => {
    expect(seedSavedValuesFromToday([], nowMs)).toEqual({});
    expect(seedSavedValuesFromToday(undefined, nowMs)).toEqual({});
  });

  it('createdAt inválido é ignorado em vez de quebrar', () => {
    const recs = [{ equipment: 'Freezer', value: -18, createdAt: 'lixo' }];
    expect(seedSavedValuesFromToday(recs, nowMs)).toEqual({});
  });
});

describe('firstPendingIndexIfUntouched', () => {
  const catalog = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];

  it('card 0 já feito e ninguém navegou: pula pro primeiro pendente', () => {
    expect(firstPendingIndexIfUntouched(catalog, { A: -18 }, 0)).toBe(1);
  });

  it('card 0 ainda pendente: fica no 0', () => {
    expect(firstPendingIndexIfUntouched(catalog, {}, 0)).toBe(0);
  });

  it('usuário já navegou pra outro card: não interfere', () => {
    expect(firstPendingIndexIfUntouched(catalog, { A: -18 }, 2)).toBe(2);
  });

  it('tudo já feito: mantém o índice atual (a tela de "tudo concluído" assume)', () => {
    expect(firstPendingIndexIfUntouched(catalog, { A: -18, B: -18, C: -18 }, 0)).toBe(0);
  });

  it('catálogo vazio não quebra', () => {
    expect(firstPendingIndexIfUntouched([], {}, 0)).toBe(0);
  });
});
