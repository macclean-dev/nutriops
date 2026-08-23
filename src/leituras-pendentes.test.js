import { describe, it, expect } from 'vitest';
import { leiturasPendentes, equipamentoPendente, descreverPendencia } from './leituras-pendentes';

// Item de fila REAL, no formato que `enqueue()` grava (repository.js:257) com o
// payload que `tempToRow()` monta (repository.js:361) — snake_case. Se o teste
// usar camelCase, ele passa e o app continua quebrado.
const naFila = (tenantId, equip, at = '2026-08-22T10:00:00.000Z') => ({
  table: 'temperature_records', operation: 'upsert', _at: at,
  payload: {
    id: `${equip}-${at}`, tenant_id: tenantId, tenant_name: 'CASA DOCE',
    equipment_input: equip, equipment_key: equip, value: -13.6,
    user_name: 'Colaboradora', created_at: at,
  },
});

describe('leiturasPendentes — o que a pessoa deu como feito e não subiu', () => {
  it('conta só as leituras da loja em foco', () => {
    const fila = [naFila('casadoce', 'F.3'), naFila('swiss', 'Freezer'), naFila('casadoce', 'U.3')];
    expect(leiturasPendentes(fila, 'casadoce').total).toBe(2);
  });

  it('lista os equipamentos pendentes, sem repetir', () => {
    const fila = [
      naFila('casadoce', 'F.3', '2026-08-22T08:00:00.000Z'),
      naFila('casadoce', 'F.3', '2026-08-22T14:00:00.000Z'),
      naFila('casadoce', 'U.3'),
    ];
    const p = leiturasPendentes(fila, 'casadoce');
    expect(p.total).toBe(3);                       // 3 leituras…
    expect(p.equipamentos.sort()).toEqual(['F.3', 'U.3']);  // …em 2 equipamentos
  });

  it('devolve a mais antiga — é ela que diz há quantos dias o dado está preso', () => {
    const fila = [naFila('casadoce', 'F.3', '2026-08-22T14:00:00.000Z'),
                  naFila('casadoce', 'U.3', '2026-08-17T09:00:00.000Z')];
    expect(leiturasPendentes(fila, 'casadoce').maisAntiga).toBe('2026-08-17T09:00:00.000Z');
  });

  it('ignora item de outra tabela na mesma fila', () => {
    const fila = [{ table: 'form_records', operation: 'upsert', payload: { tenant_id: 'casadoce' } }];
    expect(leiturasPendentes(fila, 'casadoce').total).toBe(0);
  });

  it('sem tenantId devolve zero — nunca a fila inteira', () => {
    const fila = [naFila('casadoce', 'F.3'), naFila('swiss', 'Freezer')];
    expect(leiturasPendentes(fila, null).total).toBe(0);
    expect(leiturasPendentes(fila, '').total).toBe(0);
  });

  it('aguenta fila vazia, nula e item torto', () => {
    expect(leiturasPendentes([], 'casadoce').total).toBe(0);
    expect(leiturasPendentes(null, 'casadoce').total).toBe(0);
    expect(leiturasPendentes([null, {}, { table: 'temperature_records' }], 'casadoce').total).toBe(0);
  });

  it('cai no equipment_input quando a linha não tem equipment_key', () => {
    const item = naFila('casadoce', 'F.3');
    delete item.payload.equipment_key;
    expect(leiturasPendentes([item], 'casadoce').equipamentos).toEqual(['F.3']);
  });
});

describe('equipamentoPendente — o card não pode ficar verde por engano', () => {
  const p = { equipamentos: ['Congelador vertical — F.3'] };

  it('casa o nome exato', () => {
    expect(equipamentoPendente(p, 'Congelador vertical — F.3')).toBe(true);
  });

  it('casa apesar de caixa e espaço sobrando', () => {
    expect(equipamentoPendente(p, '  congelador VERTICAL — f.3 ')).toBe(true);
  });

  it('não casa equipamento diferente', () => {
    expect(equipamentoPendente(p, 'U.3')).toBe(false);
  });

  it('label vazio nunca é pendente', () => {
    expect(equipamentoPendente(p, '')).toBe(false);
    expect(equipamentoPendente(p, null)).toBe(false);
  });

  it('sem pendências, nada é pendente', () => {
    expect(equipamentoPendente({ equipamentos: [] }, 'F.3')).toBe(false);
    expect(equipamentoPendente(null, 'F.3')).toBe(false);
  });
});

describe('descreverPendencia — quem lê é a colaboradora, não o dono', () => {
  it('zero pendências não vira aviso', () => {
    expect(descreverPendencia({ total: 0 })).toBeNull();
    expect(descreverPendencia(null)).toBeNull();
  });

  it('singular e plural concordam', () => {
    expect(descreverPendencia({ total: 1 })).toContain('1 leitura ainda não foi enviada');
    expect(descreverPendencia({ total: 4 })).toContain('4 leituras ainda não foram enviadas');
  });

  it('diz onde o dado está — é a informação que salva a leitura', () => {
    expect(descreverPendencia({ total: 2 })).toContain('salvas só neste aparelho');
  });

  it('não usa jargão de TI', () => {
    const txt = `${descreverPendencia({ total: 1 })} ${descreverPendencia({ total: 2 })}`;
    for (const jargao of ['sincroniz', 'fila', 'queue', 'offline', 'servidor', 'Supabase']) {
      expect(txt.toLowerCase()).not.toContain(jargao.toLowerCase());
    }
  });
});
