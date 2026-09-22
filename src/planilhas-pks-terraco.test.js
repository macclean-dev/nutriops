// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFormTemplates, scopeFieldOf, completionPct, extractNonConformities } from './forms';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido da RT da CASA DOCE (28/08): planilhas de higienização do Terraço e do
// PKS, hortifrutícolas para as 3 lojas, e três folhas de ocorrência
// (utensílios novos, desperdícios, perdas) também para as 3.
//
// Os números aqui vêm da CONTAGEM DOS PDFs que ela mandou. Se alguém mexer numa
// lista de tarefas sem olhar o papel, estes testes acusam.
// ─────────────────────────────────────────────────────────────────────────────

const loja = (id, name) => ({ id, name, equipmentCatalog: [] });
const nomes = (tpls) => tpls.map((t) => t.title);
const acha  = (tpls, titulo) => tpls.find((t) => t.title === titulo);
const tarefas = (tpl) => tpl.sections.find((s) => s.id.endsWith('-t'))?.fields ?? [];

beforeEach(() => localStorage.clear());

describe('FABRIZZIO PKS', () => {
  const tpls = () => readFormTemplates(loja('fab-pks', 'FABRIZZIO PKS'));

  it('mantém as 4 que ela marcou como já cadastradas', () => {
    const t = nomes(tpls());
    // Era "Colaboradors", sem o "e". Corrigido na v1.9.235 com a migração de
    // renomeação (renomear-planilha.js) — antes dela, mudar o título faria
    // cada loja ganhar uma SEGUNDA cópia em vez de corrigir a que já tem.
    expect(t).toContain('Higiene Pessoal dos Colaboradores');
    expect(t).toContain('Controle Integrado de Vetores e Pragas');
    expect(t).toContain('Controle de Dedetização');
    expect(t.some((x) => /reservatório/i.test(x))).toBe(true);
  });

  it('ganha as 7 folhas de higienização por setor do PDF', () => {
    const hig = nomes(tpls()).filter((x) => x.startsWith('Higienização — '));
    expect(hig.sort()).toEqual([
      'Higienização — Atendimento (PKS)',
      'Higienização — Copa (PKS)',
      'Higienização — DML (PKS)',
      'Higienização — Depósito de Bebidas (PKS)',
      'Higienização — Higienização de Utensílios (PKS)',
      'Higienização — Produção Quente (PKS)',
      'Higienização — Produção de Gelatos (PKS)',
    ]);
  });

  it('Atendimento tem as 21 tarefas do papel (páginas 1 e 2)', () => {
    expect(tarefas(acha(tpls(), 'Higienização — Atendimento (PKS)'))).toHaveLength(21);
  });

  it('Produção de Gelatos tem as 18 tarefas (páginas 4 e 5 juntas)', () => {
    expect(tarefas(acha(tpls(), 'Higienização — Produção de Gelatos (PKS)'))).toHaveLength(18);
  });

  it('a Caixa de gordura da Produção de Gelatos fica SEM frequência — o papel deixa em branco de propósito', () => {
    const f = tarefas(acha(tpls(), 'Higienização — Produção de Gelatos (PKS)'))
      .find((x) => /Caixa de gordura/.test(x.label));
    expect(f.label).toContain('frequência a definir');
    expect(f.frequency).toBeNull();
  });

  it('as quinzenais do papel viraram quinzenais de verdade, não semanais', () => {
    const gel = tarefas(acha(tpls(), 'Higienização — Produção de Gelatos (PKS)'));
    for (const nome of ['Freezer inox vertical F.1', 'Freezer branco vertical F.2']) {
      expect(gel.find((x) => x.label.startsWith(nome)).frequency).toBe('biweekly');
    }
  });

  it('parede e teto são mensais — cobrar semanalmente inventaria pendência', () => {
    const copa = tarefas(acha(tpls(), 'Higienização — Copa (PKS)'));
    expect(copa.find((x) => x.label.startsWith('Parede')).frequency).toBe('monthly');
    expect(copa.find((x) => x.label.startsWith('Teto')).frequency).toBe('monthly');
  });

  it('o hortifrutícolas do PKS tem UM setor só, como ela disse', () => {
    const hf = acha(tpls(), 'Higienização de Hortifrutícolas');
    expect(scopeFieldOf(hf).options).toEqual(['Produção quente']);
  });
});

describe('Terraço', () => {
  const tpls = () => readFormTemplates(loja('ter-1', 'CASA DOCE — Terraço'));

  it('ganha as 2 folhas de higienização do PDF', () => {
    const hig = nomes(tpls()).filter((x) => x.startsWith('Higienização — '));
    expect(hig.sort()).toEqual([
      'Higienização — Apoio Atendimento (Terraço)',
      'Higienização — Área de Produção (Terraço)',
    ]);
  });

  it('Apoio Atendimento tem 18 tarefas e Área de Produção 16', () => {
    expect(tarefas(acha(tpls(), 'Higienização — Apoio Atendimento (Terraço)'))).toHaveLength(18);
    expect(tarefas(acha(tpls(), 'Higienização — Área de Produção (Terraço)'))).toHaveLength(16);
  });

  it('o hortifrutícolas do Terraço tem UM setor só', () => {
    expect(scopeFieldOf(acha(tpls(), 'Higienização de Hortifrutícolas')).options)
      .toEqual(['Área de produção']);
  });

  it('nome com "terraco" sem cedilha também casa — ninguém digita cedilha sempre', () => {
    localStorage.clear();
    const t = nomes(readFormTemplates(loja('t2', 'Casa Doce Terraco')));
    expect(t).toContain('Higienização — Área de Produção (Terraço)');
  });

  it('NÃO herda as 21 folhas da matriz mesmo com "casa doce" no nome', () => {
    // A ordem no seedTemplates existe por isto: se o Terraço for renomeado pra
    // "CASA DOCE — Terraço", o match da matriz o capturaria e ele receberia o
    // catálogo inteiro da loja errada.
    expect(nomes(tpls())).not.toContain('Controle de Higienização de Banheiros');
  });
});

describe('as 3 folhas de ocorrência vão pras 3 lojas', () => {
  const titulos = [
    'Recebimento de Novos Utensílios',
    'Controle de Desperdícios (Alimentos)',
    'Controle de Perdas (Utensílios)',
  ];

  for (const [id, nome] of [['bf245c3b','CASA DOCE'], ['fab-pks','FABRIZZIO PKS'], ['ter','CASA DOCE — Terraço']]) {
    it(`${nome} recebe as três`, () => {
      localStorage.clear();
      const t = nomes(readFormTemplates(loja(id, nome)));
      for (const x of titulos) expect(t).toContain(x);
    });
  }

  it('são semestrais — escolha da RT, pra não virar pendência falsa', () => {
    const t = readFormTemplates(loja('fab-pks','FABRIZZIO PKS'));
    for (const x of titulos) expect(acha(t, x).frequency).toBe('semiannual');
  });

  it('cada loja vê os PRÓPRIOS setores', () => {
    localStorage.clear();
    const pks = readFormTemplates(loja('fab-pks','FABRIZZIO PKS'));
    expect(scopeFieldOf(acha(pks, 'Controle de Perdas (Utensílios)')).options)
      .toContain('Produção de gelatos');

    localStorage.clear();
    const ter = readFormTemplates(loja('ter','CASA DOCE — Terraço'));
    expect(scopeFieldOf(acha(ter, 'Controle de Perdas (Utensílios)')).options)
      .toEqual(['Apoio atendimento', 'Área de produção']);
  });

  it('o desperdício tem Motivo E Responsável — ela pediu o Responsável a mais', () => {
    const t = acha(readFormTemplates(loja('bf245c3b','CASA DOCE')), 'Controle de Desperdícios (Alimentos)');
    const rotulos = t.sections.flatMap((s) => s.fields.map((f) => f.label));
    expect(rotulos).toContain('Motivo');
    expect(rotulos).toContain('Responsável');
  });

  it('perdas NÃO tem Motivo — o papel dela não tem', () => {
    const t = acha(readFormTemplates(loja('bf245c3b','CASA DOCE')), 'Controle de Perdas (Utensílios)');
    expect(t.sections.flatMap((s) => s.fields.map((f) => f.label))).not.toContain('Motivo');
  });

  it('cabem 6 ocorrências por folha', () => {
    const t = acha(readFormTemplates(loja('bf245c3b','CASA DOCE')), 'Controle de Perdas (Utensílios)');
    expect(t.sections.filter((s) => /-oc\d+$/.test(s.id))).toHaveLength(6);
  });

  it('UMA ocorrência preenchida já marca 100% — blocos vazios não podem travar a folha', () => {
    const t = acha(readFormTemplates(loja('bf245c3b','CASA DOCE')), 'Controle de Perdas (Utensílios)');
    const rec = { responses: {
      'oc-perd-setor': 'Gelateria',
      'oc-perd-oc1-data': { date: '2026-08-28', sig: 'JOENICE' },
      'oc-perd-oc1-qtd': 2,
    }};
    expect(completionPct(t, rec)).toBe(100);
  });

  it('folha aberta e vazia é 0% — não pode parecer feita sozinha', () => {
    const t = acha(readFormTemplates(loja('bf245c3b','CASA DOCE')), 'Controle de Perdas (Utensílios)');
    expect(completionPct(t, { responses: {} })).toBe(0);
  });
});

describe('a CASA DOCE não perdeu nada', () => {
  it('continua com as folhas dela, incluindo o hortifrutícolas de 12 setores', () => {
    const t = readFormTemplates(loja('bf245c3b','CASA DOCE'));
    expect(nomes(t)).toContain('Controle de Higienização de Banheiros');
    expect(scopeFieldOf(acha(t, 'Higienização de Hortifrutícolas')).options.length).toBe(12);
  });

  it('e não recebeu as folhas do PKS nem do Terraço', () => {
    const t = nomes(readFormTemplates(loja('bf245c3b','CASA DOCE')));
    expect(t.some((x) => /\(PKS\)|\(Terraço\)/.test(x))).toBe(false);
  });
});

describe('lojas antigas seguem intactas', () => {
  it('Swiss não ganhou planilha nova', () => {
    const t = nomes(readFormTemplates(loja('swiss','Swiss')));
    expect(t.some((x) => /PKS|Terraço|Desperdícios|Perdas/.test(x))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Controle de Temperatura dos Alimentos em Exposição (22/09): planilha de
// papel anexada por ela, pedido explícito de reprodução: Data (carimbo "Feito
// agora"), 5 campos de temperatura, e o bloco de NC com Data própria (o papel
// tem essa 4ª coluna, diferente de toda outra planilha deste app).
// ─────────────────────────────────────────────────────────────────────────────
describe('Controle de Temperatura dos Alimentos em Exposição', () => {
  const titulo = 'Controle de Temperatura dos Alimentos em Exposição';
  const acharTpl = (tenantLoja) => acha(readFormTemplates(tenantLoja), titulo);

  it('vai pro PKS e pro Terraço, diária', () => {
    for (const t of [acharTpl(loja('fab-pks','FABRIZZIO PKS')), acharTpl(loja('fab-ter','Fabrizzio Terraço'))]) {
      expect(t, titulo).toBeTruthy();
      expect(t.frequency).toBe('daily');
    }
  });

  it('não vai pra CASA DOCE nem pra Swiss, é específico do PKS/Terraço', () => {
    expect(acharTpl(loja('bf245c3b','CASA DOCE'))).toBeUndefined();
    expect(acharTpl(loja('swiss','Swiss'))).toBeUndefined();
  });

  it('Data é o carimbo de 1 toque (date_sig), mesmo "Feito agora" de qualquer outra planilha', () => {
    const t = acharTpl(loja('fab-pks','FABRIZZIO PKS'));
    const data = t.sections[0].fields.find((f) => f.label === 'Data');
    expect(data.type).toBe('date_sig');
  });

  it('5 campos de temperatura, todos number com unit °C (mostra o símbolo fixo no campo)', () => {
    const t = acharTpl(loja('fab-pks','FABRIZZIO PKS'));
    const temps = t.sections[0].fields.filter((f) => f.type === 'number');
    expect(temps).toHaveLength(5);
    expect(temps.every((f) => f.unit === '°C')).toBe(true);
  });

  it('bloco de NC tem Data + os 3 campos padrão - Data é text, não date (senão travaria 100% em todo dia sem NC)', () => {
    const t = acharTpl(loja('fab-pks','FABRIZZIO PKS'));
    const nc = t.sections.find((s) => s.id.endsWith('-nc'));
    expect(nc.fields.map((f) => f.label)).toEqual(['Data', 'Não conformidade', 'Ação corretiva', 'Responsável']);
    expect(nc.fields.find((f) => f.label === 'Data').type).toBe('text');
  });

  it('completionPct chega em 100% preenchendo só o Registro do dia - dia comum, sem NC, não fica preso', () => {
    const t = acharTpl(loja('fab-pks','FABRIZZIO PKS'));
    const responses = {
      'pks-exp-data': { date: '2026-09-22', sig: 'Isabela Lorena' },
      'pks-exp-t1': '62', 'pks-exp-t2': '8', 'pks-exp-t3': '61', 'pks-exp-t4': '9', 'pks-exp-t5': '60',
    };
    expect(completionPct(t, { responses })).toBe(100);
  });

  it('extractNonConformities ainda acha a NC - o 4º campo (Data) não atrapalha o extrator genérico', () => {
    const t = acharTpl(loja('fab-pks','FABRIZZIO PKS'));
    const out = extractNonConformities(t, { responses: {
      'pks-exp-ncdata': '22/09/2026',
      'pks-exp-ncdesc': 'Alimento 3 abaixo de 60°C',
      'pks-exp-ncacao': 'Reaquecido e remedido',
      'pks-exp-ncresp': 'Isabela Lorena',
    } });
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe('Alimento 3 abaixo de 60°C');
    expect(out[0].action).toBe('Reaquecido e remedido');
  });
});
