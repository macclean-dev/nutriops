import { describe, it, expect } from 'vitest';
import {
  equipamentosForaDaRotina, agruparForaPorSetor, descreverAtraso,
  limiteForaDaRotina, diasDeCalendario, FORA_DA_ROTINA_PADRAO_DIAS,
} from './fora-da-rotina';

// ─────────────────────────────────────────────────────────────────────────────
// Nasceu do caso real da CASA DOCE (21/08): a RT reclamou de registro faltando,
// e a investigação achou 12 equipamentos parados havia 2-3 dias sem que nada no
// app avisasse. Gelateria e Atendimento Pães e Café desde 18/08, Produção de
// Picolés desde 19/08, e um "Ultracongelado U.3" NUNCA medido.
//
// Dois motivos pro silêncio: o alerta de turno só olha HOJE, e ele está
// inteiramente desligado enquanto a loja está em implantação (que é o caso da
// CASA DOCE). Este módulo responde a pergunta que faltava — "faz quantos dias
// que ninguém mede isso".
// ─────────────────────────────────────────────────────────────────────────────

const AGORA = new Date('2026-08-21T14:00:00');
const leitura = (nome, iso, tenantId = 't1') => ({ tenantId, equipmentInput: nome, equipmentKey: nome, createdAt: iso });

describe('diasDeCalendario — conta como a RT conta, não em blocos de 24h', () => {
  it('ontem 23h vs hoje 8h é 1 dia, não 0', () => {
    expect(diasDeCalendario('2026-08-20T23:00:00', '2026-08-21T08:00:00')).toBe(1);
  });

  it('mesmo dia é 0, mesmo com 12h de diferença', () => {
    expect(diasDeCalendario('2026-08-21T07:00:00', '2026-08-21T19:00:00')).toBe(0);
  });

  it('o caso da Gelateria: 18/08 → 21/08 são 3 dias', () => {
    expect(diasDeCalendario('2026-08-18T09:33:00', '2026-08-21T14:00:00')).toBe(3);
  });

  it('data inválida devolve null em vez de NaN', () => {
    expect(diasDeCalendario('não é data', AGORA)).toBeNull();
  });
});

describe('limiteForaDaRotina — o campo apagado não pode listar a loja inteira', () => {
  it('sem perfil, usa o padrão de 2 dias', () => {
    expect(limiteForaDaRotina(undefined)).toBe(FORA_DA_ROTINA_PADRAO_DIAS);
    expect(limiteForaDaRotina({})).toBe(2);
  });

  it('aceita string (o <input type=number> entrega texto)', () => {
    expect(limiteForaDaRotina({ foraDaRotinaDias: '5' })).toBe(5);
  });

  it('vazio, zero, negativo e lixo caem no padrão', () => {
    for (const v of ['', 0, -3, null, 'abc', NaN]) {
      expect(limiteForaDaRotina({ foraDaRotinaDias: v })).toBe(2);
    }
  });
});

describe('equipamentosForaDaRotina — o caso da CASA DOCE', () => {
  const catalog = [
    { label: 'Vitrine refrigerada — V.5',   location: 'Ilha de Sobremesas' },
    { label: 'Bancada refrigerada — R.10',  location: 'Gelateria' },
    { label: 'Ultracongelado U.3',          location: 'Gelateria' },
    { label: 'Freezer horizontal — F.5',    location: 'Produção de Picolés' },
  ];
  const records = [
    leitura('Vitrine refrigerada — V.5',  '2026-08-21T10:59:00'), // hoje
    leitura('Bancada refrigerada — R.10', '2026-08-18T09:34:00'), // 3 dias
    leitura('Freezer horizontal — F.5',   '2026-08-19T19:05:00'), // 2 dias
    // Ultracongelado U.3: nenhuma leitura, nunca
  ];

  it('lista só quem passou do limite, pior primeiro', () => {
    const fora = equipamentosForaDaRotina({ catalog, records, tenantId: 't1', limiteDias: 2, now: AGORA });
    expect(fora.map((f) => f.equipamento)).toEqual([
      'Ultracongelado U.3',          // nunca — o pior
      'Bancada refrigerada — R.10',  // 3 dias
      'Freezer horizontal — F.5',    // 2 dias
    ]);
    // o que foi medido hoje não entra
    expect(fora.some((f) => f.equipamento.includes('V.5'))).toBe(false);
  });

  it('marca o que nunca foi medido de forma distinta de "0 dias"', () => {
    const fora = equipamentosForaDaRotina({ catalog, records, tenantId: 't1', limiteDias: 2, now: AGORA });
    const nunca = fora.find((f) => f.equipamento === 'Ultracongelado U.3');
    expect(nunca.nunca).toBe(true);
    expect(nunca.dias).toBeNull();
    expect(nunca.ultimaLeitura).toBeNull();
  });

  it('subir o limite encurta a lista', () => {
    const fora = equipamentosForaDaRotina({ catalog, records, tenantId: 't1', limiteDias: 3, now: AGORA });
    expect(fora.map((f) => f.equipamento)).toEqual(['Ultracongelado U.3', 'Bancada refrigerada — R.10']);
  });

  it('tudo em dia devolve lista vazia — o card some da tela', () => {
    const hoje = catalog.map((eq) => leitura(eq.label, '2026-08-21T08:00:00'));
    expect(equipamentosForaDaRotina({ catalog, records: hoje, tenantId: 't1', limiteDias: 2, now: AGORA })).toEqual([]);
  });
});

describe('não vaza entre lojas', () => {
  const catalog = [{ label: 'Freezer', location: 'Cozinha' }];

  it('leitura de OUTRA loja não conta como cobertura', () => {
    const outraLoja = [leitura('Freezer', '2026-08-21T08:00:00', 'outra')];
    const fora = equipamentosForaDaRotina({ catalog, records: outraLoja, tenantId: 't1', limiteDias: 2, now: AGORA });
    expect(fora).toHaveLength(1);
    expect(fora[0].nunca).toBe(true);
  });
});

describe('equipamento renomeado não vira falso abandonado', () => {
  // É o defeito da v1.9.196 chegando aqui: sem recordBelongsTo, a leitura
  // gravada com o nome ANTIGO não contaria e o equipamento apareceria como
  // parado — justamente o alarme falso que este card não pode dar.
  const catalog = [{ label: 'Banho-maria (Refeitório) — BM.1', aliases: ['Banho-maria — BM.1'], location: 'Refeitório' }];

  it('leitura com o nome antigo conta como medição', () => {
    const records = [leitura('Banho-maria — BM.1', '2026-08-21T10:48:00')];
    expect(equipamentosForaDaRotina({ catalog, records, tenantId: 't1', limiteDias: 2, now: AGORA })).toEqual([]);
  });

  it('sem leitura nenhuma continua sendo listado — o fix não cega o card', () => {
    const fora = equipamentosForaDaRotina({ catalog, records: [], tenantId: 't1', limiteDias: 2, now: AGORA });
    expect(fora).toHaveLength(1);
    expect(fora[0].nunca).toBe(true);
  });
});

describe('robustez — não pode estourar com dado sujo', () => {
  it('catálogo vazio ou ausente', () => {
    expect(equipamentosForaDaRotina({})).toEqual([]);
    expect(equipamentosForaDaRotina({ catalog: [], records: [] })).toEqual([]);
    expect(equipamentosForaDaRotina()).toEqual([]);
  });

  it('leitura com createdAt inválido é ignorada, não derruba a conta', () => {
    const catalog = [{ label: 'Freezer', location: 'Cozinha' }];
    const records = [leitura('Freezer', 'data podre'), leitura('Freezer', '2026-08-18T08:00:00')];
    const fora = equipamentosForaDaRotina({ catalog, records, tenantId: 't1', limiteDias: 2, now: AGORA });
    expect(fora).toHaveLength(1);
    expect(fora[0].dias).toBe(3);
  });

  it('catálogo com duplicata não lista o mesmo equipamento duas vezes', () => {
    const catalog = [{ label: 'Freezer', location: 'Cozinha' }, { label: 'Freezer', location: 'Cozinha' }];
    expect(equipamentosForaDaRotina({ catalog, records: [], tenantId: 't1', limiteDias: 2, now: AGORA })).toHaveLength(1);
  });
});

describe('agruparPorSetor — a RT pensa por setor, não por equipamento avulso', () => {
  const itens = [
    { equipamento: 'Ultracongelado U.3',         setor: 'Gelateria',           dias: null, nunca: true },
    { equipamento: 'Bancada refrigerada — R.10', setor: 'Gelateria',           dias: 3,    nunca: false },
    { equipamento: 'Freezer horizontal — F.5',   setor: 'Produção de Picolés', dias: 2,    nunca: false },
    { equipamento: 'Solto',                      setor: null,                  dias: 2,    nunca: false },
  ];

  it('junta por setor e o setor com o pior caso vem primeiro', () => {
    const g = agruparForaPorSetor(itens);
    expect(g.map((x) => x.setor)).toEqual(['Gelateria', 'Produção de Picolés', 'Sem setor']);
    expect(g[0].equipamentos).toHaveLength(2);
  });

  it('equipamento sem setor não some da lista', () => {
    expect(agruparForaPorSetor(itens).find((g) => g.setor === 'Sem setor').equipamentos).toHaveLength(1);
  });

  it('lista vazia devolve grupo vazio', () => {
    expect(agruparForaPorSetor([])).toEqual([]);
    expect(agruparForaPorSetor()).toEqual([]);
  });
});

describe('descreverAtraso — texto que a RT lê', () => {
  it('singular, plural e nunca', () => {
    expect(descreverAtraso({ dias: 1, nunca: false })).toBe('há 1 dia sem leitura');
    expect(descreverAtraso({ dias: 3, nunca: false })).toBe('há 3 dias sem leitura');
    expect(descreverAtraso({ dias: null, nunca: true })).toBe('nunca medido');
  });
});
