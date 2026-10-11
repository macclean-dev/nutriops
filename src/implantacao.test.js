import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { novaPlanilha, problemasDaNovaPlanilha, copiarPlanilhas, juntarPrefs, equipamentosParaCopiar } from './implantacao';
import { applyCategoryPrefs, enxugarPrefs } from './form-prefs';
import { extractNonConformities, isTemplateEditable, templateSector, completionPct } from './forms';

// ─────────────────────────────────────────────────────────────────────────────
// Proposta 3 da análise de produto (10/10): implantar loja sem desenvolvedor.
// Em setembro as planilhas do PKS e do Terraço foram transcritas pelo
// desenvolvedor a partir de 6 PDFs da RT, e os equipamentos entraram por SQL.
// ─────────────────────────────────────────────────────────────────────────────

const ID = '11111111-2222-4333-8444-555555555555';
// O título das folhas nativas de Higienização usa esse caractere como
// separador do setor (templateSector, forms.jsx). Escrito por código, é dado.
const TRAVESSAO = '\u2014';
const tarefas = [{ nome: 'Paredes e piso', per: 'weekly' }, { nome: 'Coifa', per: 'monthly' }, { nome: '  ', per: 'weekly' }];

describe('nova planilha', () => {
  const { template, prefs } = novaPlanilha({ titulo: ' Limpeza da câmara ', aba: 'faxina', frequencia: 'weekly', tarefas, id: ID, hojeIso: '2026-10-10T12:00:00Z' });

  it('sai com tarefas (data e assinatura), cada uma com a sua periodicidade', () => {
    const t = template.sections.find((s) => s.id.endsWith('-t'));
    expect(t.fields.map((f) => f.label)).toEqual(['Paredes e piso (semanal)', 'Coifa (mensal)']);
    expect(t.fields.every((f) => f.type === 'date_sig')).toBe(true);
    expect(t.fields.map((f) => f.frequency)).toEqual(['weekly', 'monthly']);
    expect(template.title).toBe('Limpeza da câmara');
    expect(template.custom).toBe(true);
    expect(prefs).toBeNull();
  });

  it('o bloco de NC alimenta a Central de não conformidades', () => {
    const nc = template.sections.find((s) => s.id.endsWith('-nc'));
    const desc = nc.fields.find((f) => f.id.endsWith('ncdesc'));
    const r = { responses: { [desc.id]: 'Ralo entupido' } };
    expect(extractNonConformities(template, r)).toEqual([expect.objectContaining({ description: 'Ralo entupido' })]);
  });

  it('a RT continua conseguindo editar as tarefas depois (Editar planilha)', () => {
    expect(isTemplateEditable(template)).toBe(true);
  });

  it('preencher todas as tarefas devidas dá 100%', () => {
    const t = template.sections.find((s) => s.id.endsWith('-t'));
    const responses = Object.fromEntries(t.fields.map((f) => [f.id, { date: '2026-10-10', sig: 'Ana' }]));
    responses[template.sections[0].fields[0].id] = 'Ana';
    expect(completionPct(template, { responses }, new Date('2026-10-05T12:00:00Z'))).toBe(100);
  });

  it('texto gerado sem travessão', () => {
    expect(JSON.stringify(template)).not.toContain(TRAVESSAO);
  });
});

describe('nova planilha na Higienização', () => {
  const { template, prefs } = novaPlanilha({ titulo: 'Câmara fria', aba: 'higienizacao', setor: 'Confeitaria', tarefas, id: ID });

  it('entra pelo caminho já testado da escolha de setor da RT (base Faxina + preferência)', () => {
    expect(template.category).toBe('faxina');
    expect(prefs).toEqual({ templateCategory: { [ID]: 'higienizacao' }, templateSector: { [ID]: 'Confeitaria' } });
  });

  it('aparece na Higienização, no setor escolhido', () => {
    const [vista] = applyCategoryPrefs([template], juntarPrefs({}, [prefs]));
    expect(vista.category).toBe('higienizacao');
    expect(templateSector(vista)).toBe('Confeitaria');
  });

  it('a preferência sobrevive ao "Organizar" (enxugarPrefs)', () => {
    const enx = enxugarPrefs(juntarPrefs({}, [prefs]), {}, [template]);
    expect(enx.templateSector[ID]).toBe('Confeitaria');
    expect(enx.templateCategory[ID]).toBe('higienizacao');
  });

  it('sem setor, a tela não deixa criar', () => {
    expect(problemasDaNovaPlanilha({ titulo: 'X', aba: 'higienizacao', setor: '', tarefas })).toContain('A aba de Higienização é organizada por setor: escolha o setor.');
    expect(problemasDaNovaPlanilha({ titulo: '', aba: 'faxina', tarefas: [] })).toHaveLength(2);
    expect(problemasDaNovaPlanilha({ titulo: 'X', aba: 'faxina', tarefas })).toEqual([]);
  });
});

describe('copiar planilhas de outra loja', () => {
  const origem = [
    { id: 'o1', category: 'higienizacao', title: `Higienização ${TRAVESSAO} Padaria`, frequency: 'weekly', sections: [{ id: 'a-t', fields: [] }] },
    { id: 'o2', category: 'faxina', title: 'Banheiros', frequency: 'daily', sections: [] },
    { id: 'o3', category: 'higienizacao', title: 'Lavagem do Filtro de Café', setorPref: 'Atendimento', frequency: 'daily', sections: [] },
  ];
  const destino = [{ id: 'd1', category: 'faxina', title: 'banheiros' }];
  let n = 0;
  const { copias, repetidas } = copiarPlanilhas(origem, destino, { novoId: () => `novo-${n++}` });

  it('ids novos (o mesmo id sobrescreveria a planilha da outra loja) e marcadas como da RT', () => {
    expect(copias.map((c) => c.template.id)).toEqual(['novo-0', 'novo-1']);
    expect(copias.every((c) => c.template.custom === true)).toBe(true);
    expect(origem[0].id).toBe('o1');   // a origem não é alterada
  });

  it('a que já existe aqui (mesmo título e aba) não é copiada de novo', () => {
    expect(repetidas.map((t) => t.id)).toEqual(['o2']);
  });

  it('setor que vem do título viaja no título; setor escolhido pela RT viaja como preferência', () => {
    expect(copias[0].template.category).toBe('higienizacao');
    expect(copias[0].prefs).toBeNull();
    expect(copias[1].template.category).toBe('faxina');
    expect(copias[1].template.setorPref).toBeUndefined();
    expect(copias[1].prefs.templateSector['novo-1']).toBe('Atendimento');
  });

  it('só as escolhidas', () => {
    expect(copiarPlanilhas(origem, [], { ids: ['o2'], novoId: () => 'x' }).copias).toHaveLength(1);
  });
});

describe('copiar equipamentos de outra loja', () => {
  const origem = [
    { label: 'Freezer F.1', location: 'Confeitaria', minTemp: -22, maxTemp: -18, aliases: ['F1'] },
    { label: 'Câmara C.1', location: 'Câmaras', minTemp: 0, maxTemp: 5, usoIntermitente: true },
    { label: '' },
  ];
  it('traz nome, setor, faixa, apelidos e uso intermitente; pula o que já existe (o nome é a chave na nuvem)', () => {
    const { novos, repetidos } = equipamentosParaCopiar(origem, [{ label: 'freezer f.1' }]);
    expect(repetidos.map((e) => e.label)).toEqual(['Freezer F.1']);
    expect(novos).toEqual([{ label: 'Câmara C.1', aliases: [], location: 'Câmaras', minTemp: 0, maxTemp: 5, usoIntermitente: true }]);
  });
});

describe('as telas', () => {
  const f = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
  const p = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
  it('Nova planilha e Copiar de outra loja só para quem organiza planilhas (RT e administrador)', () => {
    expect(f).toContain("{isRT && <button className=\"secondary-action\" style={{ fontSize:12 }} onClick={() => setNovaOpen(true)}>Nova planilha</button>}");
    expect(f).toContain('{isRT && outrasLojas.length > 0 && <button');
  });
  it('Equipamentos: copiar aparece só para quem acompanha mais de uma loja', () => {
    expect(p).toContain('{outrasLojas.length > 0 && <button className="secondary-action" style={{ fontSize: 12 }} onClick={() => { setAvisoCopia(null); setCopiarEquip(true); }}>Copiar de outra loja</button>}');
  });
});
