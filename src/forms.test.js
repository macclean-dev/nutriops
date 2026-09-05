import { describe, it, expect, beforeEach } from 'vitest';
import { completionPct, generateFormPDF, readFormTemplates, templateSector, quickSign, extractNonConformities, pendingFormsForPeriod, formatPeriodLabel, getPeriodKey, hasEditableTaskSection, extractSelectFields, isTemplateEditable, applySelectFieldEdits, isPresenceAnswered } from './forms';

// Template no formato do CASA DOCE Banheiros, exercitando os tipos novos.
const TPL = {
  id:'t1', category:'faxina', frequency:'daily', title:'Banheiros', description:'x',
  sections:[
    { id:'s1', title:'Limpeza Geral', fields:[
      { id:'lg', label:'Realizada', type:'checkbox' },
      { id:'lgh', label:'Horário', type:'text' },        // text não conta no %
    ]},
    { id:'s2', title:'Manutenção', fields:[
      { id:'mn', label:'Realizada', type:'checkbox' },
      { id:'dt', label:'Data', type:'date' },
    ]},
  ],
};

describe('quickSign — assinatura de 1 toque (revisão de produto 09/08)', () => {
  it('carimba hoje (formato local YYYY-MM-DD) e o nome de quem está registrando', () => {
    const r = quickSign('Fran');
    const hoje = new Date();
    const esperado = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
    expect(r).toEqual({ date: esperado, sig: 'Fran' });
  });

  it('sem nome disponível, não quebra — sig fica vazio (a UI decide o que fazer)', () => {
    expect(quickSign(undefined).sig).toBe('');
    expect(quickSign(null).sig).toBe('');
  });

  it('remove espaço em volta do nome', () => {
    expect(quickSign('  Ana Paula  ').sig).toBe('Ana Paula');
  });
});

describe('extractNonConformities — Central de Não-Conformidades (item 2 da revisão)', () => {
  // Modela exatamente a convenção real (Banheiros, Hortifrutícolas, as 21 de
  // Higienização): seção terminando em "-nc", campos -ncdesc/-ncacao/-ncresp.
  const TPL_NC = {
    id: 'tpl-nc', category: 'faxina', frequency: 'weekly', title: 'Teste NC',
    sections: [
      { id: 's-tarefas', title: 'Tarefas', fields: [{ id: 'tarefa1', label: 'Tarefa', type: 'date_sig' }] },
      { id: 'x-nc', title: 'Não conformidade (se houver)', fields: [
        { id: 'x-ncdesc', label: 'Não conformidade', type: 'text' },
        { id: 'x-ncacao', label: 'Ação corretiva', type: 'text' },
        { id: 'x-ncresp', label: 'Responsável pela correção', type: 'text' },
      ]},
    ],
  };

  it('sem responses: lista vazia, sem quebrar', () => {
    expect(extractNonConformities(TPL_NC, null)).toEqual([]);
    expect(extractNonConformities(TPL_NC, {})).toEqual([]);
  });

  it('seção de NC vazia (usuário não escreveu nada): não conta como NC', () => {
    const record = { responses: { 'x-ncdesc': '', 'x-ncacao': '', 'x-ncresp': '' } };
    expect(extractNonConformities(TPL_NC, record)).toEqual([]);
  });

  it('só espaço em branco também não conta', () => {
    const record = { responses: { 'x-ncdesc': '   ' } };
    expect(extractNonConformities(TPL_NC, record)).toEqual([]);
  });

  it('NC escrita: extrai descrição, ação e responsável', () => {
    const record = { responses: { 'x-ncdesc': 'Piso rachado', 'x-ncacao': 'Chamado o zelador', 'x-ncresp': 'Fran' } };
    expect(extractNonConformities(TPL_NC, record)).toEqual([
      { sectionId: 'x-nc', description: 'Piso rachado', action: 'Chamado o zelador', responsible: 'Fran' },
    ]);
  });

  it('NC com só a descrição (ação/responsável ainda não preenchidos)', () => {
    const record = { responses: { 'x-ncdesc': 'Piso rachado' } };
    expect(extractNonConformities(TPL_NC, record)).toEqual([
      { sectionId: 'x-nc', description: 'Piso rachado', action: null, responsible: null },
    ]);
  });

  it('template sem nenhuma seção de NC: lista vazia', () => {
    const tplSemNc = { id: 't2', sections: [{ id: 's1', fields: [{ id: 'f1', type: 'text' }] }] };
    expect(extractNonConformities(tplSemNc, { responses: { f1: 'qualquer coisa' } })).toEqual([]);
  });

  it('funciona com o padrão real das 21 planilhas de higienização (id gerado por slug)', () => {
    const tpl = {
      id: 'cd-hig-padaria',
      sections: [{ id: 'cd-hig-padaria-nc', title: 'Não conformidade (se houver)', fields: [
        { id: 'cd-hig-padaria-ncdesc', type: 'text' },
        { id: 'cd-hig-padaria-ncacao', type: 'text' },
        { id: 'cd-hig-padaria-ncresp', type: 'text' },
      ]}],
    };
    const record = { responses: { 'cd-hig-padaria-ncdesc': 'Mofo na parede' } };
    expect(extractNonConformities(tpl, record)[0].description).toBe('Mofo na parede');
  });
});

describe('pendingFormsForPeriod — "minha lista de hoje" (item 4 da revisão)', () => {
  const NOW = new Date('2026-08-09T12:00:00'); // domingo, W32 (ver getPeriodKey)
  const templates = [
    { id: 'tpl-daily',  frequency: 'daily',  title: 'Controle diário',   category: 'faxina' },
    { id: 'tpl-weekly', frequency: 'weekly', title: 'Higienização — Padaria', category: 'higienizacao' },
  ];

  it('template sem nenhum record: entra como "missing"', () => {
    const out = pendingFormsForPeriod(templates, [], NOW);
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.id === 'tpl-daily').status).toBe('missing');
  });

  it('record do período atual com status "submitted": sai da lista', () => {
    const records = [{ formId: 'tpl-daily', periodKey: '2026-08-09', status: 'submitted' }];
    const out = pendingFormsForPeriod(templates, records, NOW);
    expect(out.map((f) => f.id)).toEqual(['tpl-weekly']);
  });

  it('record do período atual com status "draft": continua na lista, com o status certo', () => {
    const records = [{ formId: 'tpl-daily', periodKey: '2026-08-09', status: 'draft' }];
    const out = pendingFormsForPeriod(templates, records, NOW);
    expect(out.find((f) => f.id === 'tpl-daily').status).toBe('draft');
  });

  it('record de um período ANTIGO não conta pro período atual — ainda pendente', () => {
    const records = [{ formId: 'tpl-weekly', periodKey: '2026-W20', status: 'submitted' }];
    const out = pendingFormsForPeriod(templates, records, NOW);
    expect(out.map((f) => f.id)).toContain('tpl-weekly');
  });

  it('sem templates: lista vazia, não quebra', () => {
    expect(pendingFormsForPeriod([], [], NOW)).toEqual([]);
    expect(pendingFormsForPeriod(undefined, undefined, NOW)).toEqual([]);
  });

  it('periodLabel vem preenchido com o intervalo de datas legível (item 15), não "Semana Wnn"', () => {
    const out = pendingFormsForPeriod(templates, [], NOW);
    expect(out.find((f) => f.id === 'tpl-weekly').periodLabel).toMatch(/de \w+$/);
    expect(out.find((f) => f.id === 'tpl-weekly').periodLabel).not.toMatch(/^Semana/);
  });
});

// Frequência de PLANILHA semestral (v1.9.134): a RDC 216 §4.4 exige
// higienização do reservatório a cada 6 meses, e não havia como representar
// isso — mensal cobraria 6× a mais e mancharia a Prontidão de pendência falsa.
describe('frequência semestral', () => {
  it('1º semestre vai até junho; julho já é o 2º', () => {
    expect(getPeriodKey('semiannual', new Date('2026-01-01T12:00'))).toBe('2026-S1');
    expect(getPeriodKey('semiannual', new Date('2026-06-30T12:00'))).toBe('2026-S1');
    expect(getPeriodKey('semiannual', new Date('2026-07-01T12:00'))).toBe('2026-S2');
    expect(getPeriodKey('semiannual', new Date('2026-12-31T12:00'))).toBe('2026-S2');
  });

  it('vira semestre novo na virada do ano', () => {
    expect(getPeriodKey('semiannual', new Date('2027-01-02T12:00'))).toBe('2027-S1');
  });

  it('rótulo sai legível pro colaborador, não "2026-S2"', () => {
    expect(formatPeriodLabel('semiannual', '2026-S1')).toBe('1º semestre de 2026');
    expect(formatPeriodLabel('semiannual', '2026-S2')).toBe('2º semestre de 2026');
  });

  it('entrega feita no semestre atual tira a planilha da lista de pendências', () => {
    const NOW = new Date('2026-08-15T12:00:00');   // 2º semestre
    const tpl = [{ id: 'res', frequency: 'semiannual', title: 'Reservatório', category: 'potabilidade' }];
    expect(pendingFormsForPeriod(tpl, [], NOW)).toHaveLength(1);
    expect(pendingFormsForPeriod(tpl, [{ formId: 'res', periodKey: '2026-S2', status: 'submitted' }], NOW)).toHaveLength(0);
    // entrega do semestre PASSADO não vale pro atual
    expect(pendingFormsForPeriod(tpl, [{ formId: 'res', periodKey: '2026-S1', status: 'submitted' }], NOW)).toHaveLength(1);
  });
});

describe('completionPct — tipos date e checkbox (Fase B)', () => {
  it('vazio = 0%', () => {
    expect(completionPct(TPL, { responses:{} })).toBe(0);
  });
  it('checkbox só conta quando MARCADO (true); false não conta', () => {
    // campos que contam: lg(checkbox), mn(checkbox), dt(date) = 3 (lgh é text, ignorado)
    expect(completionPct(TPL, { responses:{ lg:false } })).toBe(0);   // false não conta
    expect(completionPct(TPL, { responses:{ lg:true } })).toBe(33);   // 1/3
  });
  it('date conta quando preenchido', () => {
    expect(completionPct(TPL, { responses:{ dt:'2026-07-28' } })).toBe(33); // 1/3
  });
  it('tudo preenchido = 100%', () => {
    expect(completionPct(TPL, { responses:{ lg:true, mn:true, dt:'2026-07-28', lgh:'08:00' } })).toBe(100);
  });
});

// Bug de produção achado em 15/08 e vivo desde a v1.9.93: os seeds de
// Swiss/Bäckerei/DBK usam `id: uid()`, então sorteavam um UUID novo a cada
// leitura e o merge por id anexava as planilhas de novo. 4 → 8 → 12 em três
// leituras, ×11 call sites. A CASA DOCE escapou por ter ids fixos.
describe('readFormTemplates — seed de id sorteado não pode duplicar', () => {
  beforeEach(() => localStorage.clear());
  const SWISS = { id:'swiss', name:'Swiss' };

  it('ler várias vezes mantém a MESMA quantidade de planilhas', () => {
    const n1 = readFormTemplates(SWISS).length;
    expect(n1).toBe(5);   // 4 do seed original + reservatório (Fatia 2a)
    expect(readFormTemplates(SWISS)).toHaveLength(n1);
    expect(readFormTemplates(SWISS)).toHaveLength(n1);
  });

  it('não cria título repetido (era 3 cópias de "Controle de Dedetização")', () => {
    readFormTemplates(SWISS); readFormTemplates(SWISS); readFormTemplates(SWISS);
    const titulos = readFormTemplates(SWISS).map(t => t.title);
    expect(new Set(titulos).size).toBe(titulos.length);
  });

  it('o id da 1ª leitura sobrevive — é pra ele que os registros já preenchidos apontam', () => {
    const idOriginal = readFormTemplates(SWISS).find(t => t.category === 'dedetizacao').id;
    readFormTemplates(SWISS); readFormTemplates(SWISS);
    expect(readFormTemplates(SWISS).find(t => t.category === 'dedetizacao').id).toBe(idOriginal);
  });

  // Sem preservar o id de quem já estava, o v-bump viraria uma duplicata nova
  // pelo outro caminho — e órfãos todo o histórico daquela planilha.
  it('v-bump casado por título atualiza no lugar, sem trocar o id', () => {
    const atuais = readFormTemplates(SWISS);
    const ded = atuais.find(t => t.category === 'dedetizacao');
    const antiga = { ...ded, v: -1, sections: [{ id:'velha', title:'Antiga', fields:[] }] };
    localStorage.setItem('nutriops.forms.templates.swiss',
      JSON.stringify(atuais.map(t => t.id === ded.id ? antiga : t)));

    const depois = readFormTemplates(SWISS);
    expect(depois).toHaveLength(5);
    const atualizada = depois.find(t => t.category === 'dedetizacao');
    expect(atualizada.id).toBe(ded.id);                      // id preservado
    expect(atualizada.sections[0].title).toBe('Registro do serviço'); // conteúdo novo
  });

  it('planilha custom da RT continua intocada mesmo casando por título', () => {
    const atuais = readFormTemplates(SWISS);
    const ded = atuais.find(t => t.category === 'dedetizacao');
    const editada = { ...ded, custom: true, title: ded.title, sections: [{ id:'dela', title:'Do jeito dela', fields:[] }] };
    localStorage.setItem('nutriops.forms.templates.swiss',
      JSON.stringify(atuais.map(t => t.id === ded.id ? editada : t)));

    const depois = readFormTemplates(SWISS);
    expect(depois).toHaveLength(5);
    expect(depois.find(t => t.category === 'dedetizacao').sections[0].title).toBe('Do jeito dela');
  });
});

describe('seedTemplates CASA DOCE — 36 planilhas BPF (Fase A+B+C + 21 de higienização + reservatório + 3 de ocorrência)', () => {
  beforeEach(() => localStorage.clear());
  const CD = { id:'bf245c3b-2f9', name:'CASA DOCE' };

  it('retorna 36 templates com ids uuid únicos', () => {
    const tpls = readFormTemplates(CD);
    // 33 → 36 em 28/08: entraram Recebimento de Novos Utensílios, Controle de
    // Desperdícios (Alimentos) e Controle de Perdas (Utensílios), as três
    // pedidas pela RT pras três lojas.
    expect(tpls).toHaveLength(36);
    const ids = tpls.map(t => t.id);
    expect(new Set(ids).size).toBe(36);                        // sem colisão de uuid
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('todo campo tem id/label/type; ids de campo não repetem no template', () => {
    for (const t of readFormTemplates(CD)) {
      const fieldIds = [];
      for (const s of t.sections) for (const f of s.fields) {
        expect(Boolean(f.id && f.label && f.type)).toBe(true);
        fieldIds.push(f.id);
      }
      expect(new Set(fieldIds).size).toBe(fieldIds.length);    // sem campo duplicado
    }
  });

  it('carrinhos tem os 32 códigos como checklist (1 data/responsável pro lote)', () => {
    const carr = readFormTemplates(CD).find(t => t.title.includes('Carrinhos'));
    const checklist = carr.sections.find(s => s.id === 'cd-carr-lav');
    expect(checklist.fields).toHaveLength(32);
    expect(checklist.fields.every(f => f.type === 'checkbox')).toBe(true);
    const registro = carr.sections.find(s => s.id === 'cd-carr-reg');
    expect(registro.fields.map(f => f.type)).toEqual(['date', 'text']);
  });

  // Higienização por setor (Fase D). O filtro de setor da tela de Planilhas
  // deriva o setor do TÍTULO — não há coluna `sector` em form_templates, então
  // um campo solto no objeto não sobreviveria ao round-trip da nuvem. Se o
  // formato "Higienização — Setor" quebrar, o filtro silenciosamente esvazia.
  it('as 21 planilhas de higienização expõem o setor pelo título', () => {
    const higs = readFormTemplates(CD).filter(t => t.category === 'higienizacao');
    expect(higs).toHaveLength(21);
    const setores = higs.map(templateSector);
    expect(setores.every(Boolean)).toBe(true);                 // nenhum null
    expect(new Set(setores).size).toBe(21);                    // setor não repete
    expect(setores).toContain('Padaria');
    expect(setores).toContain('Área de Lavagem — Bistrô');     // título com 2 travessões
  });

  it('templateSector devolve null pra planilha que não é de higienização', () => {
    const faxina = readFormTemplates(CD).find(t => t.category === 'faxina');
    expect(templateSector(faxina)).toBeNull();
    expect(templateSector(null)).toBeNull();
  });

  it('cada tarefa de higienização é data+assinatura e declara o período', () => {
    const padaria = readFormTemplates(CD).find(t => t.title === 'Higienização — Padaria');
    const tarefas = padaria.sections.find(s => s.id === 'cd-hig-padaria-t').fields;
    expect(tarefas).toHaveLength(14);
    expect(tarefas.every(f => f.type === 'date_sig')).toBe(true);
    // Período no nome (a coluna "Período" do papel) — sem isso o colaborador
    // não sabe se a tarefa é semanal ou mensal.
    expect(tarefas.every(f => /\((semanal|mensal|quinzenal|diária|frequência a definir)\)$/.test(f.label))).toBe(true);
    // Toda folha termina no bloco de não conformidade, como o papel.
    expect(padaria.sections.at(-1).id).toBe('cd-hig-padaria-nc');
  });

  // Dois furos reais achados ao entregar as 21 de higienização (05/08). Sem
  // estes, planilha nova NUNCA alcança loja que já rodava.
  it('CACHE VAZIO ([] é truthy!) não impede o seed', () => {
    localStorage.setItem('nutriops.forms.templates.bf245c3b-2f9', '[]');
    expect(readFormTemplates(CD)).toHaveLength(36);
  });

  // Sem isto, TODO ajuste pedido pela nutricionista (07/08) ficaria invisível
  // pra ela: a planilha já existia no cache, então o merge por id a ignorava.
  it('planilha do seed que MUDOU de versão substitui a antiga do cache', () => {
    const atuais = readFormTemplates(CD);
    const higiene = atuais.find(t => t.category === 'higiene_pessoal');
    // Simula o cache da loja com a versão ANTIGA (sem os campos novos).
    const antiga = { ...higiene, v: 1, sections: [{ id:'velha', title:'Verificação', fields:[
      { id:'cd-hig-unha', label:'Unha', type:'cnc' },
    ]}]};
    localStorage.setItem('nutriops.forms.templates.bf245c3b-2f9',
      JSON.stringify(atuais.map(t => t.id === higiene.id ? antiga : t)));

    const depois = readFormTemplates(CD).find(t => t.id === higiene.id);
    const campos = depois.sections.flatMap(s => s.fields);
    expect(campos.find(f => f.id === 'cd-hig-unha').label).toBe('Unhas limpas, sem esmalte ou base');
    expect(campos.some(f => f.id === 'cd-hig-setor')).toBe(true);
    // Carimbo pra vencer a linha velha da nuvem no mergeByKey do sync.
    expect(depois.updatedAt).toBeTruthy();
  });

  // A RT edita a planilha de higienização pra incluir equipamento novo. Se um
  // bump de versão meu passasse por cima, ela perderia o cadastro dela.
  it('planilha marcada como custom NUNCA é sobrescrita pelo seed', () => {
    const atuais = readFormTemplates(CD);
    const padaria = atuais.find(t => t.title === 'Higienização — Padaria');
    const editada = {
      ...padaria, v: 1, custom: true,
      sections: padaria.sections.map(s => s.id.endsWith('-t')
        ? { ...s, fields: [...s.fields, { id:'cd-hig-padaria-x99', label:'Refrigerador R.20 (semanal)', type:'date_sig' }] }
        : s),
    };
    localStorage.setItem('nutriops.forms.templates.bf245c3b-2f9',
      JSON.stringify(atuais.map(t => t.id === padaria.id ? editada : t)));

    const depois = readFormTemplates(CD).find(t => t.id === padaria.id);
    const labels = depois.sections.flatMap(s => s.fields).map(f => f.label);
    expect(labels).toContain('Refrigerador R.20 (semanal)');   // v:1 < v:2 e mesmo assim sobreviveu
    expect(depois.custom).toBe(true);
  });

  it('planilha de MESMA versão não é sobrescrita (edição da loja sobrevive)', () => {
    const atuais = readFormTemplates(CD);
    const alvo = atuais.find(t => t.category === 'higiene_pessoal');
    localStorage.setItem('nutriops.forms.templates.bf245c3b-2f9',
      JSON.stringify(atuais.map(t => t.id === alvo.id ? { ...t, description:'ajustado pela RT' } : t)));
    const depois = readFormTemplates(CD).find(t => t.id === alvo.id);
    expect(depois.description).toBe('ajustado pela RT');
  });

  it('planilha NOVA do seed entra em quem já tinha cache; edição local sobrevive', () => {
    const antigas = readFormTemplates(CD).slice(0, 11)
      .map(t => t.title === 'Higienização — Padaria' ? t : { ...t, description:'editado pela loja' });
    localStorage.setItem('nutriops.forms.templates.bf245c3b-2f9', JSON.stringify(antigas));

    const depois = readFormTemplates(CD);
    expect(depois).toHaveLength(36);                            // as 21 chegaram
    // O que a loja editou não foi sobrescrito pelo seed.
    expect(depois.find(t => t.id === antigas[0].id).description).toBe('editado pela loja');
    expect(new Set(depois.map(t => t.id)).size).toBe(36);       // sem duplicar
  });

  it('vetores customizado: sem Pombo, com Abelha', () => {
    const vet = readFormTemplates(CD).find(t => t.category === 'vetores_pragas');
    const labels = vet.sections.flatMap(s => s.fields).map(f => f.label);
    expect(labels.some(l => l.includes('Pombo'))).toBe(false);
    expect(labels.some(l => l.includes('Abelha'))).toBe(true);
  });

  // Pedidos da nutricionista (07/08). Antes destes campos não dava pra saber
  // QUANDO, QUEM verificou nem QUAL setor/banheiro — registro inútil numa
  // fiscalização. O setor virou lista fechada de propósito: texto livre geraria
  // "Padaria"/"padaria" e impediria filtrar o histórico.
  const campos = (t) => t.sections.flatMap(s => s.fields);
  const acha = (t, id) => campos(t).find(f => f.id === id);

  it('vetores, higiene pessoal e hortifrutícolas ganharam setor como LISTA', () => {
    const tpls = readFormTemplates(CD);
    for (const [cat, id] of [['vetores_pragas','cd-vet-setor'], ['higiene_pessoal','cd-hig-setor']]) {
      const campo = acha(tpls.find(t => t.category === cat), id);
      expect(campo?.type).toBe('select');
      expect(campo.options).toContain('Padaria');
      expect(campo.options).toContain('Garçons');
      expect(campo.options).toHaveLength(12);
    }
    expect(acha(tpls.find(t => t.title.includes('Hortifrutícolas')), 'cd-hf-setor')?.type).toBe('select');
  });

  it('data e responsável presentes onde faltavam', () => {
    const tpls = readFormTemplates(CD);
    const higiene  = tpls.find(t => t.category === 'higiene_pessoal');
    const vetores  = tpls.find(t => t.category === 'vetores_pragas');
    const residuos = tpls.find(t => t.category === 'residuos');
    const banheiro = tpls.find(t => t.title.includes('Banheiros'));

    expect(acha(higiene, 'cd-hig-data')?.type).toBe('date');
    expect(acha(higiene, 'cd-hig-resp')?.type).toBe('text');
    expect(acha(vetores, 'cd-vet-data')?.type).toBe('date');
    expect(acha(vetores, 'cd-vet-resp')?.type).toBe('text');
    expect(acha(residuos, 'cd-res-data')?.type).toBe('date');
    expect(acha(residuos, 'cd-res-resp')?.type).toBe('text');
    expect(acha(banheiro, 'cd-ban-resp')?.type).toBe('text');
    expect(acha(banheiro, 'cd-ban-local')?.options).toContain('Acessível / PCD');
  });

  it('opção de banheiro "Vestiário" virou "Unissex 1º andar" (pedido da nutricionista, 10/08)', () => {
    const banheiro = readFormTemplates(CD).find(t => t.id === 'c61acf39-5ff8-404e-8fae-f9f68734f1b2');
    const options = acha(banheiro, 'cd-ban-local')?.options;
    expect(options).toContain('Unissex 1º andar');
    expect(options).not.toContain('Vestiário');
  });

  it('higiene pessoal: avental+uniforme juntos, sapato e unhas detalhados', () => {
    const higiene = readFormTemplates(CD).find(t => t.category === 'higiene_pessoal');
    expect(acha(higiene, 'cd-hig-uniforme').label).toBe('Avental / uniforme');
    expect(acha(higiene, 'cd-hig-sapato').label).toBe('Sapato fechado e antiderrapante');
    expect(acha(higiene, 'cd-hig-unha').label).toBe('Unhas limpas, sem esmalte ou base');
    expect(acha(higiene, 'cd-hig-avental')).toBeUndefined();   // fundido no uniforme
  });

  it('higiene pessoal tem campo de foto (evidência de não conformidade)', () => {
    const higiene = readFormTemplates(CD).find(t => t.category === 'higiene_pessoal');
    expect(acha(higiene, 'cd-hig-foto')?.type).toBe('photo');
  });

  // Foto e observação NÃO entram no percentual: são opcionais por natureza.
  // Contando a foto, a planilha ficaria eternamente "incompleta" nos dias em
  // que não houve nada pra fotografar — e o alerta de pendência dispararia à toa.
  it('foto não conta no percentual de preenchimento', () => {
    const tpl = { sections:[{ id:'s', fields:[
      { id:'a', label:'Unha', type:'cnc' },
      { id:'f', label:'Foto', type:'photo' },
      { id:'o', label:'Obs',  type:'text' },
    ]}]};
    expect(completionPct(tpl, { responses:{ a:'C' } })).toBe(100);
  });

  it('cada planilha de higienização tem responsável e mês de referência', () => {
    const higs = readFormTemplates(CD).filter(t => t.category === 'higienizacao');
    for (const h of higs) {
      expect(campos(h).some(f => f.label === 'Responsável pelo setor')).toBe(true);
      expect(campos(h).some(f => f.label === 'Mês / ano de referência')).toBe(true);
    }
  });

  it('banheiros e hortifrutícolas têm bloco de não conformidade completo (desc+ação+responsável)', () => {
    const tpls = readFormTemplates(CD);
    for (const title of ['Banheiros', 'Hortifrutícolas']) {
      const t = tpls.find(x => x.title.includes(title));
      const ncSection = t.sections.find(s => s.title.includes('conformidade'));
      const labels = ncSection.fields.map(f => f.label);
      expect(labels.some(l => l.includes('conformidade'))).toBe(true);
      expect(labels.some(l => l.includes('corretiva'))).toBe(true);
      expect(labels.some(l => l.includes('Responsável'))).toBe(true);
    }
  });
});

describe('generateFormPDF — não quebra com date/checkbox e formata certo', () => {
  const rec = { id:'r1', periodKey:'2026-07-28', responses:{ lg:true, mn:false, dt:'2026-07-28', lgh:'08:00' } };
  const html = generateFormPDF(TPL, rec, { id:'bf245c3b-2f9', name:'CASA DOCE' });
  it('gera HTML sem lançar', () => { expect(typeof html).toBe('string'); expect(html.length).toBeGreaterThan(100); });
  it('checkbox marcado vira ✓ SIM', () => { expect(html).toContain('SIM'); });
  it('date vira DD/MM/AAAA', () => { expect(html).toContain('28/07/2026'); });
});

describe('formatPeriodLabel — período legível pra semana (item 15)', () => {
  it('semana dentro de um mês só: "D–D de mês"', () => {
    const key = getPeriodKey('weekly', new Date(2026, 7, 9)); // domingo 9/ago/2026
    expect(key).toBe('2026-W33');
    expect(formatPeriodLabel('weekly', key)).toBe('9–15 de agosto');
  });

  it('semana cruzando dois meses: "D mês – D mês"', () => {
    const key = getPeriodKey('weekly', new Date(2026, 7, 30)); // domingo 30/ago/2026
    expect(key).toBe('2026-W36');
    expect(formatPeriodLabel('weekly', key)).toBe('30 ago – 5 set');
  });

  it('chave malformada cai no fallback antigo em vez de quebrar', () => {
    expect(formatPeriodLabel('weekly', 'lixo')).toBe('Semana lixo');
  });
});

describe('autonomia da RT — editar tarefas e opções de lista (10/08)', () => {
  const comTarefaESelect = {
    id: 'x1', category: 'faxina', v: 2,
    sections: [
      { id: 'x1-cab', title: 'Identificação', fields: [
        { id: 'x1-local', label: 'Qual local', type: 'select', options: ['A', 'B'] },
        { id: 'x1-resp', label: 'Responsável', type: 'text' },
      ]},
      { id: 'x1-t', title: 'Tarefas', fields: [
        { id: 'x1-t-0', label: 'Piso', type: 'date_sig' },
      ]},
    ],
  };
  const soChecklistFixo = {
    id: 'x2', category: 'higiene_pessoal',
    sections: [{ id: 'x2-a', title: 'Verificação', fields: [{ id: 'x2-f1', label: 'Uniforme', type: 'cnc' }] }],
  };

  describe('hasEditableTaskSection', () => {
    it('true quando existe seção terminada em -t', () => {
      expect(hasEditableTaskSection(comTarefaESelect)).toBe(true);
    });
    it('false sem nenhuma seção -t', () => {
      expect(hasEditableTaskSection(soChecklistFixo)).toBe(false);
    });
  });

  describe('extractSelectFields', () => {
    it('encontra campos select em qualquer seção, com índices corretos', () => {
      const found = extractSelectFields(comTarefaESelect);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ sIdx: 0, fIdx: 0, id: 'x1-local', label: 'Qual local', options: ['A', 'B'] });
    });
    it('sem campo select, lista vazia', () => {
      expect(extractSelectFields(soChecklistFixo)).toEqual([]);
    });
  });

  describe('isTemplateEditable', () => {
    it('editável por ter seção -t OU campo select', () => {
      expect(isTemplateEditable(comTarefaESelect)).toBe(true);
    });
    it('não editável sem nenhum dos dois (checklist 100% fixo)', () => {
      expect(isTemplateEditable(soChecklistFixo)).toBe(false);
    });
  });

  describe('applySelectFieldEdits', () => {
    it('aplica as opções editadas no campo certo, preservando o resto do template intacto', () => {
      const edits = [{ sIdx: 0, fIdx: 0, options: ['A', 'B', 'C (novo)'] }];
      const sections = applySelectFieldEdits(comTarefaESelect.sections, edits);
      expect(sections[0].fields[0].options).toEqual(['A', 'B', 'C (novo)']);
      expect(sections[0].fields[1]).toEqual(comTarefaESelect.sections[0].fields[1]); // campo vizinho intocado
      expect(sections[1]).toEqual(comTarefaESelect.sections[1]); // outra seção intocada
    });
  });
});

describe('isPresenceAnswered — bug real de produção (CASA DOCE, 10/08)', () => {
  it('nunca tocado (undefined/null) não conta como respondido', () => {
    expect(isPresenceAnswered(undefined)).toBe(false);
    expect(isPresenceAnswered(null)).toBe(false);
  });
  it('respondido "sem ocorrência" (detected:false) conta como respondido', () => {
    expect(isPresenceAnswered({ detected: false })).toBe(true);
  });
  it('respondido "detectado" conta como respondido', () => {
    expect(isPresenceAnswered({ detected: true, location: 'Salão' })).toBe(true);
  });
});

describe('completionPct + campo presence — reproduz o bug relatado pela CASA DOCE', () => {
  const TPL_VETORES_MIN = {
    frequency: 'daily',
    sections: [{ id: 's1', fields: [
      { id: 'abelha', label: 'Abelha (A)', type: 'presence' },
      { id: 'barata', label: 'Barata (B)', type: 'presence' },
    ]}],
  };

  it('planilha nunca tocada fica em 0%, mesmo o botão "parecendo" já respondido na UI', () => {
    expect(completionPct(TPL_VETORES_MIN, { responses: {} })).toBe(0);
  });
  it('respondendo explicitamente "sem ocorrência" nos dois campos, vai a 100%', () => {
    const responses = { abelha: { detected: false }, barata: { detected: false } };
    expect(completionPct(TPL_VETORES_MIN, { responses })).toBe(100);
  });
  it('misto: só um respondido fica em 50%', () => {
    const responses = { abelha: { detected: false } };
    expect(completionPct(TPL_VETORES_MIN, { responses })).toBe(50);
  });
});
