import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { filtroInicialDeLoja, useFiltroDeLoja } from './filtro-loja';

// Relato do dono (16/09): "selecionei Swiss mas estou vendo CASA DOCE junto
// com Bäckerei" em Relatórios. A tela tinha filtro próprio começando em
// "Todas as empresas", enquanto Conformidade e Gráficos, no mesmo hub, seguiam
// a loja do menu.

const lojas = [{ id: 'swiss' }, { id: 'backerei' }, { id: 'casadoce' }];

describe('filtroInicialDeLoja', () => {
  it('começa na loja do menu', () => {
    expect(filtroInicialDeLoja('swiss', lojas)).toBe('swiss');
  });
  it('loja fora da lista da tela cai em todas, em vez de mostrar vazio', () => {
    expect(filtroInicialDeLoja('outra', lojas)).toBe('all');
  });
  it('sem loja no menu, todas', () => {
    expect(filtroInicialDeLoja(undefined, lojas)).toBe('all');
    expect(filtroInicialDeLoja('swiss', undefined)).toBe('all');
  });
});

describe('useFiltroDeLoja renderizado', () => {
  beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

  const montar = () => {
    const visto = { filtro: null, set: null };
    function Tela({ ativa }) {
      const [filtro, set] = useFiltroDeLoja(ativa, lojas);
      visto.filtro = filtro; visto.set = set;
      return null;
    }
    const root = createRoot(document.createElement('div'));
    const render = (ativa) => act(() => root.render(React.createElement(Tela, { ativa })));
    return { visto, render, root };
  };

  it('abre na loja do menu e acompanha a troca', async () => {
    const { visto, render, root } = montar();
    await render({ id: 'swiss' });
    expect(visto.filtro).toBe('swiss');
    await render({ id: 'casadoce' });
    expect(visto.filtro).toBe('casadoce');
    act(() => root.unmount());
  });

  it('escolha manual dentro da tela vale até a próxima troca no menu', async () => {
    const { visto, render, root } = montar();
    await render({ id: 'swiss' });
    await act(() => visto.set('all'));
    expect(visto.filtro).toBe('all');
    await render({ id: 'swiss' });              // re-render sem trocar de loja
    expect(visto.filtro).toBe('all');
    await render({ id: 'backerei' });           // trocou no menu
    expect(visto.filtro).toBe('backerei');
    act(() => root.unmount());
  });
});

describe('as cinco telas usam o filtro que segue o menu', () => {
  const leia = (f) => readFileSync(`${process.cwd()}/src/${f}`, 'utf8');
  const telas = ['reports.jsx', 'extras.jsx', 'reports-views.jsx', 'dossie-view.jsx', 'readiness-view.jsx'];

  it.each(telas)('%s não começa mais em "Todas as empresas" fixo', (f) => {
    const fonte = leia(f);
    expect(fonte).toContain('useFiltroDeLoja(activeTenant, allTenants)');
    expect(fonte).not.toContain("const [tenantFilter, setTenantFilter] = useState('all');");
  });

  it('pages.jsx entrega a loja do menu às cinco', () => {
    const pages = leia('pages.jsx');
    for (const tag of ['<ReportsView', '<MonthlyExportView', '<AuditView', '<DossieView'])
      expect(pages, tag).toMatch(new RegExp(`${tag}[^\\n]*activeTenant=\\{rest\\.activeTenant\\}`));
    expect(pages).toMatch(/<ReadinessView[^\n]*activeTenant=\{activeTenant\}/);
  });
});
