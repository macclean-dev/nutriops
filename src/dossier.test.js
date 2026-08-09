import { describe, it, expect } from 'vitest';
import {
  filterByPeriod, sectionNonConformities, sectionSpecialControls, sectionReceiving,
  sectionValidity, mergeEquipmentsWithCatalog, sectionMaintenance, sectionPOPs, buildDossierHtml,
} from './dossier';

describe('filterByPeriod', () => {
  const list = [
    { id: 1, createdAt: '2026-08-01T10:00:00Z' },
    { id: 2, createdAt: '2026-08-05T10:00:00Z' },
    { id: 3, createdAt: '2026-07-01T10:00:00Z' },
  ];
  it('mantém só registros a partir do início do período', () => {
    const start = new Date('2026-08-01T00:00:00Z').getTime();
    expect(filterByPeriod(list, start).map((r) => r.id)).toEqual([1, 2]);
  });
  it('lista vazia/undefined não quebra', () => {
    expect(filterByPeriod(undefined, 0)).toEqual([]);
    expect(filterByPeriod([], 0)).toEqual([]);
  });
});

describe('sectionNonConformities', () => {
  const actionSourceKey = (a) => `${a.source ?? 'temperature'}::${a.sourceId ?? a.recordId ?? ''}`;

  it('marca item sem ação correspondente', () => {
    const items = [{ source: 'temperature', sourceId: 'r1', sourceLabel: 'Freezer', sourceDetail: '10°C', at: '2026-08-01T10:00:00Z' }];
    const s = sectionNonConformities(items, [], actionSourceKey);
    expect(s.rowsHtml).toContain('Sem ação');
    expect(s.rowsHtml).toContain('Freezer');
  });
  it('casa item com ação pelo actionSourceKey e mostra a descrição', () => {
    const items = [{ source: 'receiving', sourceId: 'rec1', sourceLabel: 'Recebimento — ACME', sourceDetail: 'rejeitado', at: '2026-08-01T10:00:00Z' }];
    const actions = [{ source: 'receiving', sourceId: 'rec1', description: 'Devolvido ao fornecedor' }];
    const s = sectionNonConformities(items, actions, actionSourceKey);
    expect(s.rowsHtml).toContain('Ação registrada');
    expect(s.rowsHtml).toContain('Devolvido ao fornecedor');
  });
  it('lista vazia usa a mensagem de vazio', () => {
    const s = sectionNonConformities([], [], actionSourceKey);
    expect(s.rowsHtml).toBe('');
    expect(s.emptyMessage).toMatch(/nenhuma/i);
  });
});

describe('sectionSpecialControls', () => {
  const CONTROL_TYPES = {
    oil: { label: 'Óleo de fritura', titleField: 'equipment', resultField: 'resultado', badValues: ['reprovado'] },
    cool: { label: 'Resfriamento', titleField: 'product', resultField: 'resultado', badValues: ['nao_conforme'] },
  };
  it('agrega os tipos marcados, sinalizando resultado ruim', () => {
    const s = sectionSpecialControls({
      oil: [{ equipment: 'Fritadeira 1', resultado: 'reprovado', createdAt: '2026-08-01T10:00:00Z', user: 'Fran' }],
      cool: [{ product: 'Frango', resultado: 'conforme', createdAt: '2026-08-02T10:00:00Z', user: 'Ana' }],
    }, CONTROL_TYPES);
    expect(s.rowsHtml).toContain('Fritadeira 1');
    expect(s.rowsHtml).toContain('Frango');
    expect(s.rowsHtml).toContain('#c0392b'); // reprovado em vermelho
  });
  it('tipo sem registros não aparece', () => {
    const s = sectionSpecialControls({ oil: [] }, CONTROL_TYPES);
    expect(s.rowsHtml).toBe('');
  });
});

describe('sectionReceiving', () => {
  it('renderiza fornecedor/produto/resultado', () => {
    const s = sectionReceiving([{ fornecedor: 'Distribuidora ABC', produto: 'Queijo', resultado: 'rejeitado', motivoRejeicao: 'Fora da validade', createdAt: '2026-08-01T10:00:00Z' }]);
    expect(s.rowsHtml).toContain('Distribuidora ABC');
    expect(s.rowsHtml).toContain('Rejeitado');
    expect(s.rowsHtml).toContain('Fora da validade');
  });
});

describe('sectionValidity', () => {
  const now = new Date('2026-08-09T12:00:00Z').getTime();
  it('inclui produto vencido e produto vencendo em breve', () => {
    const products = [
      { name: 'Já venceu', expiryDate: '2026-08-01' },
      { name: 'Vence em 5 dias', expiryDate: '2026-08-14' },
      { name: 'Vence em 60 dias', expiryDate: '2026-10-08' },
    ];
    const s = sectionValidity(products, now, 30);
    expect(s.rowsHtml).toContain('Já venceu');
    expect(s.rowsHtml).toContain('Vence em 5 dias');
    expect(s.rowsHtml).not.toContain('Vence em 60 dias');
    expect(s.rowsHtml).toContain('Vencido há');
  });
  it('produto aberto usa a validade pós-abertura, não a de fábrica', () => {
    const products = [{ name: 'Molho aberto', expiryDate: '2027-01-01', openedUntil: '2026-08-10T00:00:00.000Z' }];
    const s = sectionValidity(products, now, 30);
    expect(s.rowsHtml).toContain('Molho aberto');
  });
  it('sem produtos no horizonte fica vazio', () => {
    const s = sectionValidity([{ name: 'Longe', expiryDate: '2027-01-01' }], now, 30);
    expect(s.rowsHtml).toBe('');
  });
});

describe('mergeEquipmentsWithCatalog', () => {
  it('não duplica equipamento já cadastrado como ativo', () => {
    const equipments = [{ id: 'a1', name: 'Freezer' }];
    const catalog = [{ label: 'Freezer' }, { label: 'Refrigerador' }];
    const merged = mergeEquipmentsWithCatalog(equipments, catalog);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.name)).toEqual(['Freezer', 'Refrigerador']);
  });
});

describe('sectionMaintenance', () => {
  it('resolve o nome do equipamento pelo id do log', () => {
    const equipments = [{ id: 'a1', name: 'Freezer' }];
    const logs = [{ equipmentId: 'a1', executedAt: '2026-08-01T10:00:00Z', type: 'limpeza', title: 'Limpeza geral', executedBy: 'Fran' }];
    const s = sectionMaintenance(equipments, logs);
    expect(s.rowsHtml).toContain('Freezer');
    expect(s.rowsHtml).toContain('Limpeza geral');
  });
});

describe('sectionPOPs', () => {
  it('lista título/categoria/frequência', () => {
    const s = sectionPOPs([{ title: 'Higienização de bancadas', category: 'limpeza', frequency: 'Diária', responsible: 'Equipe' }]);
    expect(s.rowsHtml).toContain('Higienização de bancadas');
    expect(s.title).toContain('1 documentados');
  });
});

describe('buildDossierHtml', () => {
  it('monta capa, seções numeradas e assinatura RT', () => {
    const html = buildDossierHtml({
      tenantName: 'Swiss',
      periodLabel: 'Últimos 30 dias',
      companyProfile: { razaoSocial: 'Swiss Confeitaria LTDA', cnpj: '00.000.000/0001-00', rtNome: 'Dra. Ana', rtCrn: 'CRN-1234' },
      sections: [
        { title: 'Controle de Temperatura', headers: ['Equipamento'], rowsHtml: '', emptyMessage: 'Sem registros' },
        { title: 'Não Conformidades', headers: ['Origem'], rowsHtml: '<tr><td>x</td></tr>', emptyMessage: 'Nada' },
      ],
      generatedAt: new Date('2026-08-09T12:00:00Z').getTime(),
    });
    expect(html).toContain('Swiss Confeitaria LTDA');
    expect(html).toContain('00.000.000/0001-00');
    expect(html).toContain('1. Controle de Temperatura');
    expect(html).toContain('2. Não Conformidades');
    expect(html).toContain('Sem registros');
    expect(html).toContain('Dra. Ana');
    expect(html).toContain('CRN-1234');
  });
  it('escapa nomes de empresa/RT pra evitar HTML injetado no PDF', () => {
    const html = buildDossierHtml({
      tenantName: '<img src=x onerror=alert(1)>',
      periodLabel: '7 dias',
      companyProfile: {},
      sections: [],
      generatedAt: Date.now(),
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
