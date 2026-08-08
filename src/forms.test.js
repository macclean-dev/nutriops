import { describe, it, expect, beforeEach } from 'vitest';
import { completionPct, generateFormPDF, readFormTemplates, templateSector } from './forms';

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

describe('seedTemplates CASA DOCE — 32 planilhas BPF (Fase A+B+C + 21 de higienização)', () => {
  beforeEach(() => localStorage.clear());
  const CD = { id:'bf245c3b-2f9', name:'CASA DOCE' };

  it('retorna 32 templates com ids uuid únicos', () => {
    const tpls = readFormTemplates(CD);
    expect(tpls).toHaveLength(32);
    const ids = tpls.map(t => t.id);
    expect(new Set(ids).size).toBe(32);                        // sem colisão de uuid
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
    expect(readFormTemplates(CD)).toHaveLength(32);
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
    expect(depois).toHaveLength(32);                            // as 21 chegaram
    // O que a loja editou não foi sobrescrito pelo seed.
    expect(depois.find(t => t.id === antigas[0].id).description).toBe('editado pela loja');
    expect(new Set(depois.map(t => t.id)).size).toBe(32);       // sem duplicar
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
