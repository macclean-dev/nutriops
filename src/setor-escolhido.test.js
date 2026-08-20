import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  podeMoverPara, applyCategoryPrefs, enxugarPrefs, normalizePrefs,
  CATEGORIA_COM_COMPORTAMENTO,
} from './form-prefs';
import { templateSector } from './forms';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido da RT da CASA DOCE (20/08), com print: ela quer a planilha "Lavagem do
// Filtro de Café" aparecendo na aba de setor "Atendimento Pães e Café", ao lado
// da "Higienização — Atendimento Pães e Café" que já mora lá — SEM renomear a
// planilha (o nome é o que sai no PDF do fiscal). E a "Higienização de
// Hortifrutícolas" numa aba própria.
//
// Antes disso era proibido mover QUALQUER coisa pra dentro de Higienização. O
// motivo era real: o setor vinha só do título ("Higienização — Padaria"), então
// uma planilha com outro padrão de nome chegaria lá sem setor e sumiria de
// todos os filtros. A solução foi tirar a premissa em vez da trava — agora a
// RT escolhe o setor à mão, e a trava só vale quando ela NÃO escolheu.
// ─────────────────────────────────────────────────────────────────────────────

const HIG = CATEGORIA_COM_COMPORTAMENTO;
const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

const filtroCafe = { id: 'cafe', title: 'Lavagem do Filtro de Café', category: 'faxina' };
const hortifruti = { id: 'hf',   title: 'Higienização de Hortifrutícolas', category: 'faxina' };
const nativa     = { id: 'nat',  title: 'Higienização — Atendimento Pães e Café', category: HIG };

describe('podeMoverPara — a trava agora depende do setor, não da categoria', () => {
  it('sem setor escolhido, continua bloqueando (o motivo original segue válido)', () => {
    const r = podeMoverPara(filtroCafe, HIG);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/setor/i);
  });

  it('setor vazio ou só espaço não conta como escolha', () => {
    expect(podeMoverPara(filtroCafe, HIG, '').ok).toBe(false);
    expect(podeMoverPara(filtroCafe, HIG, '   ').ok).toBe(false);
  });

  it('COM setor escolhido, libera — é o pedido da RT', () => {
    expect(podeMoverPara(filtroCafe, HIG, 'Atendimento Pães e Café').ok).toBe(true);
  });

  it('as 21 nativas continuam sem poder SAIR, com ou sem setor', () => {
    expect(podeMoverPara(nativa, 'faxina').ok).toBe(false);
    expect(podeMoverPara(nativa, 'faxina', 'Padaria').ok).toBe(false);
  });
});

describe('fim a fim — a planilha aparece na aba de setor pedida', () => {
  const prefs = {
    templateCategory: { cafe: HIG },
    templateSector:   { cafe: 'Atendimento Pães e Café' },
  };

  it('o filtro de café passa a cair no mesmo setor da ficha nativa, sem ser renomeado', () => {
    const [nat, cafe] = applyCategoryPrefs([nativa, filtroCafe], prefs);
    expect(templateSector(cafe)).toBe('Atendimento Pães e Café');
    expect(templateSector(nat)).toBe('Atendimento Pães e Café'); // a que já existia
    expect(cafe.title).toBe('Lavagem do Filtro de Café');        // nome intacto — vai pro PDF
    expect(cafe.category).toBe(HIG);
  });

  it('as duas ficam lado a lado quando a tela filtra por aquele setor', () => {
    const organizadas = applyCategoryPrefs([nativa, filtroCafe, hortifruti], prefs);
    // mesma expressão que FormsView usa pra montar a lista da aba
    const naAba = organizadas
      .filter((t) => t.category === HIG)
      .filter((t) => templateSector(t) === 'Atendimento Pães e Café');
    expect(naAba.map((t) => t.title)).toEqual([
      'Higienização — Atendimento Pães e Café',
      'Lavagem do Filtro de Café',
    ]);
  });

  it('aba nova só pra ela: um setor que não existia vira uma aba própria', () => {
    const [hf] = applyCategoryPrefs([hortifruti], {
      templateCategory: { hf: HIG },
      templateSector:   { hf: 'Hortifrutícolas' },
    });
    expect(templateSector(hf)).toBe('Hortifrutícolas');
  });

  it('sem setor, o movimento é IGNORADO — não entra em Higienização sem aba', () => {
    const [cafe] = applyCategoryPrefs([filtroCafe], { templateCategory: { cafe: HIG } });
    expect(cafe.category).toBe('faxina');
    expect(templateSector(cafe)).toBeNull();
  });

  it('o setor escolhido vence o título, mas não mexe em quem deriva do nome', () => {
    // nativa sem setorPref continua lendo do próprio título
    expect(templateSector(nativa)).toBe('Atendimento Pães e Café');
    // e uma planilha fora de Higienização nunca tem setor, mesmo com pref
    expect(templateSector({ ...filtroCafe, setorPref: 'Padaria' })).toBeNull();
  });
});

describe('enxugarPrefs — não deixa setor órfão pra trás', () => {
  const padroes = { faxina: 'Faxina', [HIG]: 'Higienização' };
  const originais = [filtroCafe, hortifruti];

  it('grava o setor de quem realmente foi pra Higienização', () => {
    const out = enxugarPrefs(
      { templateCategory: { cafe: HIG }, templateSector: { cafe: 'Atendimento Pães e Café' } },
      padroes, originais);
    expect(out.templateSector).toEqual({ cafe: 'Atendimento Pães e Café' });
  });

  it('mover de volta pra outra aba descarta o setor junto', () => {
    const out = enxugarPrefs(
      { templateCategory: { cafe: 'manutencao' }, templateSector: { cafe: 'Atendimento Pães e Café' } },
      padroes, originais);
    expect(out.templateSector).toEqual({});
  });

  it('setor de planilha que nem foi movida não é gravado', () => {
    const out = enxugarPrefs(
      { templateCategory: {}, templateSector: { hf: 'Hortifrutícolas' } },
      padroes, originais);
    expect(out.templateSector).toEqual({});
  });
});

describe('normalizePrefs — shape novo sem quebrar prefs antigas', () => {
  it('preferência gravada antes desta versão (sem templateSector) continua válida', () => {
    const antiga = { categoryLabels: { faxina: 'Serviços gerais' }, templateCategory: { cafe: 'manutencao' } };
    expect(normalizePrefs(antiga).templateSector).toEqual({});
    expect(normalizePrefs(antiga).categoryLabels).toEqual({ faxina: 'Serviços gerais' });
  });
});

describe('modal — a fiação da escolha de setor', () => {
  it('Higienização entra na lista de destinos (antes era filtrada fora)', () => {
    expect(fonte).toContain('const destinos = catsPresentes;');
    expect(fonte).not.toContain('catsPresentes.filter((c) => c !== CATEGORIA_COM_COMPORTAMENTO)');
  });

  it('o seletor de setor só aparece pra quem está indo pra Higienização', () => {
    expect(fonte).toContain("const vaiPraHigienizacao = !ehHigienizacao && atual === CATEGORIA_COM_COMPORTAMENTO;");
    expect(fonte).toContain('{vaiPraHigienizacao && (');
  });

  it('oferece os setores existentes e a criação de aba nova', () => {
    expect(fonte).toContain('setoresExistentes.map((s) => <option key={s} value={s}>{s}</option>)');
    expect(fonte).toContain('+ Criar aba nova…');
  });

  it('salvar fica travado enquanto houver planilha sem setor', () => {
    expect(fonte).toContain('const semSetor = ordenadas.filter((t) => {');
    expect(fonte).toContain('disabled={semSetor.length > 0}');
  });

  it('o setor escolhido vai junto no payload do salvar', () => {
    expect(fonte).toContain('templateMeta: meta, templateSector: setores })');
  });
});
