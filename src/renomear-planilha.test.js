import { describe, it, expect } from 'vitest';
import { RENOMEACOES, tituloAtual, aplicarRenomeacoes } from './renomear-planilha';

// ─────────────────────────────────────────────────────────────────────────────
// "Higiene Pessoal dos Colaboradors" — sem o "e" — vive no seed desde sempre e
// aparece em Swiss, Bäckerei, DBK, PKS e Terraço. Não dava pra corrigir de
// passagem: o template nasce com id sorteado, então readFormTemplates só
// reencontra a cópia da loja pelo TÍTULO. Mudar o título faria cada loja ganhar
// uma SEGUNDA planilha em vez de corrigir a que já tem.
// ─────────────────────────────────────────────────────────────────────────────

const t = (title, extra = {}) => ({
  id: 'id-que-ja-existe', category: 'higiene_pessoal', title, v: 1, ...extra,
});

describe('tituloAtual', () => {
  it('traduz o título errado pro certo', () => {
    expect(tituloAtual('higiene_pessoal', 'Higiene Pessoal dos Colaboradors'))
      .toBe('Higiene Pessoal dos Colaboradores');
  });

  it('título já certo passa intacto — a função é idempotente', () => {
    expect(tituloAtual('higiene_pessoal', 'Higiene Pessoal dos Colaboradores'))
      .toBe('Higiene Pessoal dos Colaboradores');
  });

  it('mesma grafia em OUTRA categoria não é tocada — a chave é categoria+título', () => {
    expect(tituloAtual('faxina', 'Higiene Pessoal dos Colaboradors'))
      .toBe('Higiene Pessoal dos Colaboradors');
  });

  it('planilha que não está no mapa passa intacta', () => {
    expect(tituloAtual('faxina', 'Controle de Dedetização')).toBe('Controle de Dedetização');
  });

  it('ignora caixa e espaço ao comparar — o dado da nuvem nem sempre vem limpo', () => {
    expect(tituloAtual('higiene_pessoal', '  higiene pessoal dos colaboradors '))
      .toBe('Higiene Pessoal dos Colaboradores');
  });

  it('nulo não quebra', () => {
    expect(tituloAtual(null, null)).toBe('');
  });
});

describe('aplicarRenomeacoes', () => {
  it('renomeia e avisa que mudou', () => {
    const r = aplicarRenomeacoes([t('Higiene Pessoal dos Colaboradors')]);
    expect(r.mudou).toBe(true);
    expect(r.lista[0].title).toBe('Higiene Pessoal dos Colaboradores');
  });

  it('PRESERVA o id — é ele que amarra os registros já preenchidos', () => {
    const r = aplicarRenomeacoes([t('Higiene Pessoal dos Colaboradors')]);
    expect(r.lista[0].id).toBe('id-que-ja-existe');
  });

  it('preserva o resto, inclusive o `custom` da RT — renomear não é sobrescrever', () => {
    const orig = t('Higiene Pessoal dos Colaboradors', { custom: true, sections: [{ id: 's1' }], v: 7 });
    const r = aplicarRenomeacoes([orig]);
    expect(r.lista[0].custom).toBe(true);
    expect(r.lista[0].sections).toEqual([{ id: 's1' }]);
    expect(r.lista[0].v).toBe(7);
  });

  it('carimba updatedAt novo — senão a linha velha da nuvem desfaz a correção', () => {
    const r = aplicarRenomeacoes([t('Higiene Pessoal dos Colaboradors')], () => '2026-09-05T12:00:00.000Z');
    expect(r.lista[0].updatedAt).toBe('2026-09-05T12:00:00.000Z');
  });

  it('rodar de novo não mexe em nada — idempotente', () => {
    const um = aplicarRenomeacoes([t('Higiene Pessoal dos Colaboradors')]);
    const dois = aplicarRenomeacoes(um.lista);
    expect(dois.mudou).toBe(false);
    expect(dois.lista[0]).toBe(um.lista[0]);   // mesma referência: nada tocado
  });

  it('não carimba updatedAt em quem não mudou', () => {
    const outra = { id:'x', category:'faxina', title:'Controle de Dedetização' };
    const r = aplicarRenomeacoes([outra]);
    expect(r.mudou).toBe(false);
    expect(r.lista[0].updatedAt).toBeUndefined();
  });

  it('lista vazia ou nula não quebra', () => {
    expect(aplicarRenomeacoes([]).lista).toEqual([]);
    expect(aplicarRenomeacoes(null).lista).toEqual([]);
  });
});

describe('o mapa só carrega o que é erro de digitação de verdade', () => {
  it('tem a entrada do Colaboradors', () => {
    expect(RENOMEACOES.some((r) => r.de === 'Higiene Pessoal dos Colaboradors')).toBe(true);
  });

  it('nenhuma entrada renomeia pra ela mesma — seria ruído', () => {
    for (const r of RENOMEACOES) expect(r.de).not.toBe(r.para);
  });

  it('nenhuma entrada sem categoria — a chave é categoria+título', () => {
    for (const r of RENOMEACOES) expect(String(r.categoria).length).toBeGreaterThan(0);
  });
});

// ─── Integração: a loja que JÁ TEM a planilha com o nome errado ──────────────
// É o cenário que importa. Swiss, Bäckerei e DBK têm a cópia gravada com
// "Colaboradors" e um id sorteado lá atrás. O que não pode acontecer de jeito
// nenhum é elas ganharem uma segunda planilha.
import { readFormTemplates } from './forms';
import { chaveGrupoDoRegistro, chaveGrupo } from './forms-dedupe';

describe('loja com a planilha antiga: corrige, não duplica', () => {
  const SWISS = { id: 'swiss', name: 'Swiss', equipmentCatalog: [] };
  const KEY = 'nutriops.forms.templates.swiss';

  // Como a cópia está gravada hoje: título errado, id sorteado, sem `v`.
  const comoEstaHoje = () => {
    const tpls = readFormTemplates(SWISS);              // gera o seed
    const antigas = tpls.map((t) => t.category === 'higiene_pessoal'
      ? { ...t, id: 'id-sorteado-la-atras', title: 'Higiene Pessoal dos Colaboradors', v: undefined }
      : t);
    localStorage.setItem(KEY, JSON.stringify(antigas));
  };

  it('fica com UMA planilha de higiene pessoal, não duas', () => {
    localStorage.clear(); comoEstaHoje();
    const depois = readFormTemplates(SWISS).filter((t) => t.category === 'higiene_pessoal');
    expect(depois).toHaveLength(1);
  });

  it('e ela está com o nome CERTO', () => {
    localStorage.clear(); comoEstaHoje();
    const t = readFormTemplates(SWISS).find((x) => x.category === 'higiene_pessoal');
    expect(t.title).toBe('Higiene Pessoal dos Colaboradores');
  });

  it('preservando o id antigo — é pra ele que os registros já preenchidos apontam', () => {
    localStorage.clear(); comoEstaHoje();
    const t = readFormTemplates(SWISS).find((x) => x.category === 'higiene_pessoal');
    expect(t.id).toBe('id-sorteado-la-atras');
  });

  it('a correção fica GRAVADA — não é só o retorno da função', () => {
    localStorage.clear(); comoEstaHoje();
    readFormTemplates(SWISS);
    const gravado = JSON.parse(localStorage.getItem(KEY));
    const hp = gravado.filter((t) => t.category === 'higiene_pessoal');
    expect(hp).toHaveLength(1);
    expect(hp[0].title).toBe('Higiene Pessoal dos Colaboradores');
  });

  it('ler duas vezes não cria nada — a segunda leitura é estável', () => {
    localStorage.clear(); comoEstaHoje();
    readFormTemplates(SWISS);
    const antes = readFormTemplates(SWISS).length;
    expect(readFormTemplates(SWISS)).toHaveLength(antes);
  });

  it('cópia `custom` da RT também é renomeada — o conteúdo dela fica intacto', () => {
    localStorage.clear();
    const tpls = readFormTemplates(SWISS);
    const antigas = tpls.map((t) => t.category === 'higiene_pessoal'
      ? { ...t, id:'id-custom', title:'Higiene Pessoal dos Colaboradors', custom:true,
          sections:[{ id:'editada-pela-rt', title:'Minha seção', fields:[] }] }
      : t);
    localStorage.setItem(KEY, JSON.stringify(antigas));
    const t = readFormTemplates(SWISS).find((x) => x.category === 'higiene_pessoal');
    expect(t.title).toBe('Higiene Pessoal dos Colaboradores');
    expect(t.custom).toBe(true);
    expect(t.sections[0].id).toBe('editada-pela-rt');   // nada do seed entrou
  });
});

describe('registro preenchido ANTES da correção continua achando a planilha', () => {
  it('o órfão casa pela chave traduzida', () => {
    const antigo = { category: 'higiene_pessoal', formTitle: 'Higiene Pessoal dos Colaboradors' };
    const novo   = { category: 'higiene_pessoal', formTitle: 'Higiene Pessoal dos Colaboradores' };
    const planilhaRenomeada = { category: 'higiene_pessoal', title: 'Higiene Pessoal dos Colaboradores' };
    // Mesma chave dos dois lados = a ferramenta de deduplicação reconecta o
    // registro velho em vez de listá-lo como "órfão sem destino".
    expect(chaveGrupoDoRegistro(antigo)).toBe(chaveGrupoDoRegistro(novo));
    // e as duas batem com a planilha renomeada — que é o que faz a reconexão
    // funcionar de verdade
    expect(chaveGrupoDoRegistro(antigo)).toBe(chaveGrupo(planilhaRenomeada));
  });
});
