import { describe, it, expect } from 'vitest';
import {
  actionSourceKey, pendingTemperatureItems, pendingReceivingItems,
  pendingControlItems, pendingFormItems, excludeWithAction,
} from './nonconformities';

// Central de Não-Conformidades (item 2 da revisão de produto, 09/08) —
// agrega as 4 origens que hoje não se enxergam: temperatura, recebimento
// rejeitado, controle especial reprovado, NC de planilha.

describe('actionSourceKey', () => {
  it('ação nova (source explícito)', () => {
    expect(actionSourceKey({ source: 'receiving', sourceId: 'r1' })).toBe('receiving::r1');
  });

  it('ação ANTIGA (sem source, só recordId) — assume temperatura, não quebra', () => {
    expect(actionSourceKey({ recordId: 't1' })).toBe('temperature::t1');
  });

  it('sem nada: string previsível, não undefined solto', () => {
    expect(actionSourceKey({})).toBe('temperature::');
  });
});

describe('pendingTemperatureItems', () => {
  const tone = (r) => (r.value > r.max || r.value < r.min ? 'danger' : 'ok');

  it('filtra por tenant e só desvios (ok/neutral saem)', () => {
    const records = [
      { id: 't1', tenantId: 'swiss', value: 38, min: -18, max: 0, equipment: 'Freezer', createdAt: 'x' },
      { id: 't2', tenantId: 'swiss', value: -10, min: -18, max: 0, equipment: 'Freezer', createdAt: 'x' },
      { id: 't3', tenantId: 'backerei', value: 38, min: -18, max: 0, equipment: 'Freezer', createdAt: 'x' },
    ];
    const out = pendingTemperatureItems(records, 'swiss', tone);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'temperature', sourceId: 't1', sourceLabel: 'Freezer', sourceDetail: '38°C · faixa -18–0°C' });
  });
});

describe('pendingReceivingItems', () => {
  it('só resultado rejeitado entra', () => {
    const recv = [
      { id: 'r1', fornecedor: 'União', resultado: 'rejeitado', motivoRejeicao: 'Embalagem violada', createdAt: 'x' },
      { id: 'r2', fornecedor: 'Outro', resultado: 'aceito', createdAt: 'x' },
    ];
    const out = pendingReceivingItems(recv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'receiving', sourceId: 'r1', sourceLabel: 'Recebimento — União', sourceDetail: 'Motivo: Embalagem violada' });
  });

  it('lista vazia/undefined não quebra', () => {
    expect(pendingReceivingItems([])).toEqual([]);
    expect(pendingReceivingItems(undefined)).toEqual([]);
  });
});

describe('pendingControlItems', () => {
  it('óleo: só "reprovado" conta (não "observacao")', () => {
    const oil = [
      { id: 'o1', equipment: 'Fritadeira 1', resultado: 'reprovado', acao: 'Trocar óleo', createdAt: 'x' },
      { id: 'o2', equipment: 'Fritadeira 2', resultado: 'observacao', createdAt: 'x' },
      { id: 'o3', equipment: 'Fritadeira 3', resultado: 'aprovado', createdAt: 'x' },
    ];
    const out = pendingControlItems('oil', oil);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourceLabel: 'Óleo de fritura — Fritadeira 1', sourceDetail: 'Trocar óleo' });
  });

  it('descongelamento/resfriamento/térmico: "nao_conforme" conta, "descartado" NÃO (já foi tratado)', () => {
    const thaw = [
      { id: 't1', product: 'Frango', resultado: 'nao_conforme', obs: 'Descongelou rápido demais', createdAt: 'x' },
      { id: 't2', product: 'Peixe', resultado: 'descartado', createdAt: 'x' },
      { id: 't3', product: 'Carne', resultado: 'conforme', createdAt: 'x' },
    ];
    expect(pendingControlItems('thaw', thaw)).toHaveLength(1);
  });

  it('higiene das mãos usa o campo `result`, não `resultado`', () => {
    const handwash = [
      { id: 'h1', operator: 'Ana', result: 'nao_conforme', obs: 'Não lavou por 20s', createdAt: 'x' },
      { id: 'h2', operator: 'Bia', result: 'conforme', createdAt: 'x' },
    ];
    const out = pendingControlItems('handwash', handwash);
    expect(out).toHaveLength(1);
    expect(out[0].sourceLabel).toBe('Higiene das mãos — Ana');
  });

  it('tipo desconhecido: lista vazia, não quebra', () => {
    expect(pendingControlItems('inexistente', [{ id: 1 }])).toEqual([]);
  });
});

describe('pendingFormItems', () => {
  const templates = [{ id: 'tpl1', title: 'Higienização — Padaria', sections: [
    { id: 's-nc', fields: [{ id: 'ncdesc' }, { id: 'ncacao' }, { id: 'ncresp' }] },
  ]}];
  const extract = (tpl, rec) => {
    const v = rec.responses?.ncdesc;
    return v ? [{ sectionId: 's-nc', description: v, action: rec.responses.ncacao ?? null, responsible: rec.responses.ncresp ?? null }] : [];
  };

  it('junta template + record via extractNonConformities injetada', () => {
    const formRecords = [{ id: 'rec1', formId: 'tpl1', formTitle: 'Higienização — Padaria', responses: { ncdesc: 'Mofo na parede' }, createdAt: 'x' }];
    const out = pendingFormItems(templates, formRecords, extract);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'form', sourceLabel: 'Higienização — Padaria', sourceDetail: 'Mofo na parede' });
    expect(out[0].sourceId).toContain('rec1');
  });

  it('record de um template que não existe mais: ignorado, não quebra', () => {
    const formRecords = [{ id: 'rec1', formId: 'tpl-fantasma', responses: { ncdesc: 'x' } }];
    expect(pendingFormItems(templates, formRecords, extract)).toEqual([]);
  });

  it('sem NC no record: nada é adicionado', () => {
    const formRecords = [{ id: 'rec1', formId: 'tpl1', responses: {} }];
    expect(pendingFormItems(templates, formRecords, extract)).toEqual([]);
  });
});

describe('excludeWithAction — não duplicar item que já tem ação aberta', () => {
  it('remove item cuja source/sourceId já está em alguma ação', () => {
    const items = [
      { source: 'receiving', sourceId: 'r1' },
      { source: 'receiving', sourceId: 'r2' },
    ];
    const actions = [{ source: 'receiving', sourceId: 'r1' }];
    expect(excludeWithAction(items, actions)).toEqual([{ source: 'receiving', sourceId: 'r2' }]);
  });

  it('ação ANTIGA (sem source) exclui corretamente um item de temperatura', () => {
    const items = [{ source: 'temperature', sourceId: 't1' }, { source: 'temperature', sourceId: 't2' }];
    const actions = [{ recordId: 't1' }]; // formato legado
    expect(excludeWithAction(items, actions)).toEqual([{ source: 'temperature', sourceId: 't2' }]);
  });

  it('sem ações: nada é excluído', () => {
    const items = [{ source: 'form', sourceId: 'f1' }];
    expect(excludeWithAction(items, [])).toEqual(items);
    expect(excludeWithAction(items, undefined)).toEqual(items);
  });
});
