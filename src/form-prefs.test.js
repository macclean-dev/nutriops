import { describe, it, expect } from 'vitest';
import {
  normalizePrefs, prefsFromProfile, profileWithPrefs, catLabelFor,
  podeMoverPara, applyCategoryPrefs, enxugarPrefs, CATEGORIA_COM_COMPORTAMENTO,
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
    expect(prefsFromProfile(perfil)).toEqual({ categoryLabels: {}, templateCategory: {} });
    expect(prefsFromProfile(null)).toEqual({ categoryLabels: {}, templateCategory: {} });
  });

  it('lixo no lugar das preferências não derruba nada', () => {
    expect(prefsFromProfile({ formPrefs: 'nao é objeto' })).toEqual({ categoryLabels: {}, templateCategory: {} });
    expect(normalizePrefs({ categoryLabels: null })).toEqual({ categoryLabels: {}, templateCategory: {} });
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
