// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CorrectiveActionsView } from './pages';

// A Central de NC renderizada de verdade com o caso da F.2 (7 desvios de
// agosto) atrás de 20 desvios mais novos: o que antes ficava escondido no
// "Ver os outros" agora aparece como um grupo, primeiro da lista.

const loja = { id: 'cd', name: 'CASA DOCE' };
const leitura = (id, equipment, at, value) => ({ id, tenantId: 'cd', equipment, equipmentInput: equipment, value, min: -22, max: -18, createdAt: at });
const F2 = [12, 12, 13, 13, 13, 14, 14].map((d, i) => leitura(`f2-${i}`, 'Bancada congelada F.2', `2026-08-${d}T1${i}:00:00Z`, -3 - i));
const novas = Array.from({ length: 20 }, (_, i) => leitura(`n-${i}`, `Freezer ${i}`, `2026-10-0${1 + (i % 9)}T12:00:00Z`, -5));

beforeEach(() => { localStorage.clear(); });

describe('Central de NC na tela', () => {
  const html = renderToStaticMarkup(<CorrectiveActionsView activeTenant={loja} allTenants={[loja]} onTenantChange={() => {}} records={[...novas, ...F2]} />);

  it('a F.2 aparece como um grupo, com a contagem e as datas, antes das novas', () => {
    expect(html).toContain('7 ocorrências, de 12/08 a 14/08');
    expect(html.indexOf('Bancada congelada F.2')).toBeLessThan(html.indexOf('Freezer 0'));
  });

  it('dá para abrir uma ação para o grupo inteiro', () => {
    expect(html).toContain('Abrir ação para as 7');
  });

  it('nenhum grupo fica escondido atrás de "Ver os outros"', () => {
    expect(html).not.toContain('Ver os outros');
    for (let i = 0; i < 20; i++) expect(html).toContain(`Freezer ${i}<`);
  });
});
