import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  normalizePrefs, prefsFromProfile, profileWithPrefs, catLabelFor,
  podeMoverPara, applyCategoryPrefs, enxugarPrefs, CATEGORIA_COM_COMPORTAMENTO,
  podeEditarTitulo, FREQUENCIAS,
} from './form-prefs';

const tpl = (id, category, extra = {}) => ({ id, category, title: `T ${id}`, ...extra });

describe('rótulo da aba', () => {
  it('usa o customizado quando existe', () => {
    expect(catLabelFor('faxina', { categoryLabels: { faxina: 'Serviços gerais' } }, 'Faxina')).toBe('Serviços gerais');
  });

  it('sem preferência, fica o padrão', () => {
    expect(catLabelFor('faxina', {}, 'Faxina')).toBe('Faxina');
    expect(catLabelFor('faxina', null, 'Faxina')).toBe('Faxina');
  });

  it('apagar o campo desfaz — aba nunca fica sem nome', () => {
    expect(catLabelFor('faxina', { categoryLabels: { faxina: '' } }, 'Faxina')).toBe('Faxina');
    expect(catLabelFor('faxina', { categoryLabels: { faxina: '   ' } }, 'Faxina')).toBe('Faxina');
  });
});

describe('mover planilha de aba — a trava da Higienização', () => {
  it('movimento comum é permitido', () => {
    expect(podeMoverPara(tpl('a', 'faxina'), 'manutencao').ok).toBe(true);
  });

  it('NÃO deixa mover pra dentro da Higienização (o setor vem do título)', () => {
    const r = podeMoverPara(tpl('a', 'faxina'), CATEGORIA_COM_COMPORTAMENTO);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/setor/i);
  });

  it('NÃO deixa tirar uma das 21 folhas de fora da Higienização', () => {
    const r = podeMoverPara(tpl('h', CATEGORIA_COM_COMPORTAMENTO), 'faxina');
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/setor/i);
  });

  it('o bloqueio SEMPRE vem com motivo — bloqueio mudo é o bug da semana', () => {
    for (const r of [
      podeMoverPara(tpl('a', 'faxina'), CATEGORIA_COM_COMPORTAMENTO),
      podeMoverPara(tpl('h', CATEGORIA_COM_COMPORTAMENTO), 'faxina'),
    ]) {
      expect(r.ok).toBe(false);
      expect(String(r.motivo ?? '').length).toBeGreaterThan(30);
    }
  });

  it('ficar na mesma categoria não é movimento', () => {
    expect(podeMoverPara(tpl('h', CATEGORIA_COM_COMPORTAMENTO), CATEGORIA_COM_COMPORTAMENTO).ok).toBe(true);
  });
});

describe('applyCategoryPrefs', () => {
  const base = [tpl('hf', 'faxina'), tpl('cafe', 'faxina'), tpl('h1', CATEGORIA_COM_COMPORTAMENTO)];

  it('move o que foi pedido e não toca no resto', () => {
    const out = applyCategoryPrefs(base, { templateCategory: { hf: 'manutencao' } });
    expect(out.find(t => t.id === 'hf').category).toBe('manutencao');
    expect(out.find(t => t.id === 'cafe').category).toBe('faxina');
  });

  it('IGNORA preferência que viola a trava — pref antiga não quebra a tela', () => {
    const out = applyCategoryPrefs(base, { templateCategory: { cafe: CATEGORIA_COM_COMPORTAMENTO } });
    expect(out.find(t => t.id === 'cafe').category).toBe('faxina');
  });

  it('não modifica a lista original', () => {
    const antes = JSON.parse(JSON.stringify(base));
    applyCategoryPrefs(base, { templateCategory: { hf: 'manutencao' } });
    expect(base).toEqual(antes);
  });

  it('sem preferências, devolve tudo como estava', () => {
    expect(applyCategoryPrefs(base, {}).map(t => t.category)).toEqual(base.map(t => t.category));
    expect(applyCategoryPrefs(base, null).map(t => t.category)).toEqual(base.map(t => t.category));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O risco real de guardar isto dentro do blob de perfil: a tela de perfil
// salvar por cima e apagar em silêncio.
// ─────────────────────────────────────────────────────────────────────────────
describe('convivência com o perfil do estabelecimento', () => {
  const perfil = { cnpj: '00.000.000/0001-00', alvara: '2027-01-01', responsavel: 'Isabela' };

  it('gravar preferências PRESERVA o resto do perfil', () => {
    const novo = profileWithPrefs(perfil, { categoryLabels: { faxina: 'Serviços gerais' } });
    expect(novo.cnpj).toBe(perfil.cnpj);
    expect(novo.alvara).toBe(perfil.alvara);
    expect(novo.formPrefs.categoryLabels.faxina).toBe('Serviços gerais');
  });

  it('salvar o perfil (espalhando prev) PRESERVA as preferências', () => {
    // é exatamente o que settings.jsx faz: setProfile(prev => ({...prev, campo}))
    const comPrefs = profileWithPrefs(perfil, { categoryLabels: { faxina: 'Serviços gerais' } });
    const depoisDeEditarPerfil = { ...comPrefs, alvara: '2028-01-01' };
    expect(prefsFromProfile(depoisDeEditarPerfil).categoryLabels.faxina).toBe('Serviços gerais');
  });

  it('perfil sem preferências devolve vazio, não quebra', () => {
    expect(prefsFromProfile(perfil)).toEqual({ categoryLabels: {}, templateCategory: {}, templateMeta: {} });
    expect(prefsFromProfile(null)).toEqual({ categoryLabels: {}, templateCategory: {}, templateMeta: {} });
  });

  it('lixo no lugar das preferências não derruba nada', () => {
    expect(prefsFromProfile({ formPrefs: 'nao é objeto' })).toEqual({ categoryLabels: {}, templateCategory: {}, templateMeta: {} });
    expect(normalizePrefs({ categoryLabels: null })).toEqual({ categoryLabels: {}, templateCategory: {}, templateMeta: {} });
  });
});

describe('enxugarPrefs — não sincroniza ruído', () => {
  const padroes = { faxina: 'Faxina', manutencao: 'Manutenção' };
  const originais = [tpl('hf', 'faxina'), tpl('cafe', 'faxina')];

  it('descarta rótulo igual ao padrão', () => {
    const out = enxugarPrefs({ categoryLabels: { faxina: 'Faxina', manutencao: 'Serviços' } }, padroes, originais);
    expect(out.categoryLabels).toEqual({ manutencao: 'Serviços' });
  });

  it('descarta movimento que não move', () => {
    const out = enxugarPrefs({ templateCategory: { hf: 'faxina', cafe: 'manutencao' } }, padroes, originais);
    expect(out.templateCategory).toEqual({ cafe: 'manutencao' });
  });

  it('descarta preferência de planilha que não existe mais', () => {
    const out = enxugarPrefs({ templateCategory: { sumiu: 'manutencao' } }, padroes, originais);
    expect(out.templateCategory).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O rename da aba tem que valer em TODO lugar que mostra a categoria (19/08).
// Quando o dono perguntou "como a RT muda esses nomes?", descobri que o
// "Organizar" da v1.9.153 renomeava só a ABA: o card, o cabeçalho do
// preenchimento e o PDF continuavam mostrando o nome de fábrica. A RT
// renomearia "Faxina" pra "Serviços gerais" e veria FAXINA em todo card.
// ─────────────────────────────────────────────────────────────────────────────
describe('o rótulo renomeado vale em todo lugar', () => {
  const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

  it('o card usa rotuloCat, não catMeta cru', () => {
    expect(fonte).toContain('{rotuloCat(tpl.category)} · {freqLabel(tpl.frequency)}');
  });

  it('a tela de preenchimento recebe o rótulo já resolvido', () => {
    expect(fonte).toContain('rotuloCategoria={rotuloCat(filling.template.category)}');
    expect(fonte).toContain('{rotuloCategoria ?? catMeta(template.category).label}');
  });

  it('o PDF da planilha também — é o que vai pro fiscal', () => {
    expect(fonte).toContain('generateFormPDF(template, record, tenant, rotuloCategoria)');
    expect(fonte).toContain('${rotuloCategoria ?? meta.label}');
    expect(fonte).toContain('generateFormPDF(tpl, rec, activeTenant, rotuloCat(tpl.category))');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Título, frequência e descrição por loja (19/08) — o dono perguntou como a RT
// muda "Faxina · Diária" e "Lavagem do Filtro de Café"; a categoria já dava,
// o resto não dava em lugar nenhum. As descrições dos seeds da CASA DOCE dizem
// literalmente "Frequência: diária (a confirmar com a RT)".
// ─────────────────────────────────────────────────────────────────────────────
const tplH = (id) => ({ id, category: CATEGORIA_COM_COMPORTAMENTO, title: 'Higienização — Padaria', frequency: 'weekly', description: 'x' });
const tplF = (id) => ({ id, category: 'faxina', title: 'Lavagem do Filtro de Café', frequency: 'daily', description: 'Registro da lavagem.' });

describe('editar título, frequência e descrição', () => {
  it('aplica os três', () => {
    const [t] = applyCategoryPrefs([tplF('a')], { templateMeta: { a: { title: 'Filtro do Café', frequency: 'weekly', description: 'Nova' } } });
    expect(t.title).toBe('Filtro do Café');
    expect(t.frequency).toBe('weekly');
    expect(t.description).toBe('Nova');
  });

  it('campo vazio não apaga o original — apagar é como se desfaz', () => {
    const [t] = applyCategoryPrefs([tplF('a')], { templateMeta: { a: { title: '   ', description: '' } } });
    expect(t.title).toBe('Lavagem do Filtro de Café');
    expect(t.description).toBe('Registro da lavagem.');
  });

  it('frequência inválida é IGNORADA — viraria período sem rótulo', () => {
    const [t] = applyCategoryPrefs([tplF('a')], { templateMeta: { a: { frequency: 'anual' } } });
    expect(t.frequency).toBe('daily');
  });

  it('só as frequências que o app sabe agrupar são aceitas', () => {
    for (const [f] of FREQUENCIAS) {
      const [t] = applyCategoryPrefs([tplF('a')], { templateMeta: { a: { frequency: f } } });
      expect(t.frequency).toBe(f);
    }
  });
});

describe('a trava do título da Higienização', () => {
  it('bloqueia com motivo — o setor vem do título', () => {
    const r = podeEditarTitulo(tplH('h'));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/setor/i);
  });

  it('e o título dessas NÃO é aplicado nem se estiver gravado', () => {
    const [t] = applyCategoryPrefs([tplH('h')], { templateMeta: { h: { title: 'Outro nome' } } });
    expect(t.title).toBe('Higienização — Padaria');
  });

  it('mas frequência e descrição delas continuam editáveis', () => {
    const [t] = applyCategoryPrefs([tplH('h')], { templateMeta: { h: { frequency: 'monthly', description: 'Nova' } } });
    expect(t.frequency).toBe('monthly');
    expect(t.description).toBe('Nova');
  });

  it('planilha comum pode renomear', () => {
    expect(podeEditarTitulo(tplF('a')).ok).toBe(true);
  });
});

describe('enxugarPrefs com meta', () => {
  const originais = [tplF('a')];
  it('descarta o que é igual ao original', () => {
    const out = enxugarPrefs({ templateMeta: { a: { title: 'Lavagem do Filtro de Café', frequency: 'weekly' } } }, {}, originais);
    expect(out.templateMeta).toEqual({ a: { frequency: 'weekly' } });
  });

  it('descarta planilha que não existe mais', () => {
    expect(enxugarPrefs({ templateMeta: { sumiu: { title: 'X' } } }, {}, originais).templateMeta).toEqual({});
  });

  it('não grava entrada vazia', () => {
    expect(enxugarPrefs({ templateMeta: { a: { title: '  ' } } }, {}, originais).templateMeta).toEqual({});
  });
});

describe('forms.jsx — a terceira seção do Organizar', () => {
  const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

  it('existe a seção de nome/frequência/descrição', () => {
    expect(fonte).toContain('Nome, frequência e descrição de cada planilha');
  });

  it('o título das travadas vira texto, não input', () => {
    expect(fonte).toContain('tituloTravado.ok ? (');
    expect(fonte).toContain('nome fixo');
  });

  it('a frequência só oferece o que o app sabe agrupar', () => {
    expect(fonte).toContain('{FREQUENCIAS.map(([id, rotulo]) =>');
  });

  it('mudar a frequência avisa sobre o período — não é mudança inócua', () => {
    expect(fonte).toContain('Muda o período a partir de agora');
  });

  it('o salvar leva a meta junto', () => {
    expect(fonte).toContain('onSave({ categoryLabels: labels, templateCategory: cats, templateMeta: meta })');
  });
});
