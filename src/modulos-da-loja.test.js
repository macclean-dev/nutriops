import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  unidadePKS, unidadeTerraco, lojaUsaControlesEspeciais,
  viewVisivelNaLoja, VIEWS_CONTROLES_ESPECIAIS,
} from './modulos-da-loja';
import { CONTROLS_KEYS } from './nav';

// Pedido do dono (09/09): "No PKS e no Terraço pode excluir a aba de Controles
// especiais. Como lá não tem fritadeira, não fazemos o preenchimento da
// saturação do óleo. E a maior parte das coisas já vai para as filiais tudo
// pronto."

describe('quem é PKS / Terraço', () => {
  it('reconhece as duas pelas variações de nome que existem hoje', () => {
    for (const n of ['FABRIZZIO PKS', 'Fabrizzio ParkShopping', 'fabrizzio park shopping'])
      expect(unidadePKS({ name: n }), n).toBe(true);
    for (const n of ['Fabrizzio Terraço', 'FABRIZZIO TERRACO', 'fabrizzio terraço'])
      expect(unidadeTerraco({ name: n }), n).toBe(true);
  });

  it('não pega a matriz nem as outras lojas', () => {
    for (const n of ['CASA DOCE', 'Fabrizzio Matriz', 'Swiss', 'Bäckerei', 'DBK Produção']) {
      expect(unidadePKS({ name: n }), n).toBe(false);
      expect(unidadeTerraco({ name: n }), n).toBe(false);
      expect(lojaUsaControlesEspeciais({ name: n }), n).toBe(true);
    }
  });

  it('loja sem nome não perde módulo — na dúvida, mostra', () => {
    expect(lojaUsaControlesEspeciais(undefined)).toBe(true);
    expect(lojaUsaControlesEspeciais({})).toBe(true);
    expect(viewVisivelNaLoja('oil', undefined)).toBe(true);
  });
});

describe('a aba some no PKS e no Terraço', () => {
  const filiais = [{ name: 'FABRIZZIO PKS' }, { name: 'Fabrizzio Terraço' }];

  it('o hub e as 5 sub-telas somem — não só o item do menu', () => {
    for (const loja of filiais)
      for (const v of VIEWS_CONTROLES_ESPECIAIS)
        expect(viewVisivelNaLoja(v, loja), `${loja.name} / ${v}`).toBe(false);
  });

  it('cobre exatamente as views do hub — se o hub ganhar uma sub-tela, esta lista tem que acompanhar', () => {
    expect([...VIEWS_CONTROLES_ESPECIAIS].sort()).toEqual([...CONTROLS_KEYS].sort());
  });

  it('nenhum outro módulo é afetado', () => {
    for (const loja of filiais)
      for (const v of ['overview', 'forms', 'validity', 'equipment', 'readiness', 'team', 'settings'])
        expect(viewVisivelNaLoja(v, loja), `${loja.name} / ${v}`).toBe(true);
  });
});

describe('a aba está fechada nos QUATRO caminhos que chegam nela', () => {
  // Esconder num só deixa os outros como porta dos fundos. Cada asserção
  // aponta o arquivo que fecha um caminho.
  const leia = (f) => readFileSync(`${process.cwd()}/src/${f}`, 'utf8');

  it('menu lateral e menu do celular (pages.jsx)', () => {
    const pages = leia('pages.jsx');
    const filtros = pages.split('canAccess(session?.user?.role, key)').length - 1;
    expect(filtros, 'os dois menus filtram por papel').toBe(2);
    expect(pages.split('viewVisivelNaLoja(key, activeTenant)').length - 1,
      'algum dos dois menus deixou de filtrar por loja').toBe(2);
  });

  it('Cmd+K (commands.js)', () => {
    expect(leia('commands.js')).toContain('viewVisivelNaLoja(view, ctx?.activeTenant)');
  });

  it('botão "Resolver →" da Prontidão (readiness-view.jsx)', () => {
    expect(leia('readiness-view.jsx')).toContain('viewVisivelNaLoja(check.navTarget, { name: tenantName })');
  });

  it('a rota: quem está na tela e troca de loja não fica preso nela (pages.jsx)', () => {
    const pages = leia('pages.jsx');
    expect(pages).toContain("const activeView = viewVisivelNaLoja(activeViewBruta, activeTenant) ? activeViewBruta : 'overview';");
    // derivado no render, não num efeito — efeito pinta a tela errada antes
    expect(pages).not.toMatch(/useEffect\([^)]*setActiveView\('overview'\)/);
  });
});
