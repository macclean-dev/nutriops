// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KioskApp } from './kiosk';
import { clearOfflineQueue } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Relato da RT da CASA DOCE (23/08), gelateria:
//   "Teve 2 dias seguidos, 17/08 e 18/08, com o preenchimento realizado na
//    minha presença, corretamente, e o dia 17 já não consta no sistema."
//   "No dia 19, cliquei no setor da gelateria e apareceu 'todos os registros
//    concluídos'."
//
// Duas causas independentes, as duas nesta tela. Estes testes travam as duas.
// ─────────────────────────────────────────────────────────────────────────────

const FILA_KEY = 'nutriops.offline.queue';

const equip = (label, location = 'Gelateria') => ({ label, location, min: -18, max: -11 });

const config = (catalogo) => ({
  tenantId: 'casadoce', tenantName: 'CASA DOCE',
  userName: 'Colaboradora', userRole: 'Colaborador',
  equipmentCatalog: catalogo,
});

const naFila = (equipLabel) => ({
  table: 'temperature_records', operation: 'upsert', _at: '2026-08-22T10:00:00.000Z',
  payload: { id: `x-${equipLabel}`, tenant_id: 'casadoce', equipment_key: equipLabel,
             equipment_input: equipLabel, value: -13.6, created_at: '2026-08-22T10:00:00.000Z' },
});

const render = (cfg) => renderToStaticMarkup(<KioskApp config={cfg} onExit={() => {}} />);

beforeEach(() => { localStorage.clear(); clearOfflineQueue(); });

describe('catálogo vazio não pode virar "concluído"', () => {
  it('NÃO anuncia registros concluídos quando não há equipamento nenhum', () => {
    const html = render(config([]));
    expect(html).not.toContain('Todos os registros concluídos');
    // `[].every()` é true — era isso que produzia o parabéns por nada.
    expect(html).not.toContain('Todos os 0 equipamentos');
  });

  it('explica o que houve e manda NÃO registrar', () => {
    const html = render(config([]));
    expect(html).toContain('Nenhum equipamento neste aparelho');
    expect(html).toContain('não registre nada por enquanto');
  });

  it('com equipamento no catálogo, a tela de vazio não aparece', () => {
    const html = render(config([equip('F.3')]));
    expect(html).not.toContain('Nenhum equipamento neste aparelho');
    expect(html).toContain('F.3');
  });
});

describe('leitura presa na fila deste aparelho fica visível', () => {
  it('mostra o aviso de não-enviado quando há leitura na fila da loja', () => {
    localStorage.setItem(FILA_KEY, JSON.stringify([naFila('F.3')]));
    const html = render(config([equip('F.3'), equip('U.3')]));
    expect(html).toContain('ainda não foi enviada');
    expect(html).toContain('salva só neste aparelho');
  });

  it('diz para NÃO repetir a medição em outro celular', () => {
    localStorage.setItem(FILA_KEY, JSON.stringify([naFila('F.3')]));
    const html = render(config([equip('F.3')]));
    expect(html).toContain('Não repita a medição em outro celular');
  });

  it('marca o card do equipamento pendente, não o dos outros', () => {
    localStorage.setItem(FILA_KEY, JSON.stringify([naFila('F.3')]));
    const html = render(config([equip('F.3'), equip('U.3')]));
    expect(html).toContain('NÃO ENVIADO');
    expect((html.match(/NÃO ENVIADO/g) ?? []).length).toBe(1);   // só o F.3
  });

  it('fila de OUTRA loja não polui o quiosque desta', () => {
    localStorage.setItem(FILA_KEY, JSON.stringify([
      { ...naFila('Freezer'), payload: { ...naFila('Freezer').payload, tenant_id: 'swiss' } },
    ]));
    const html = render(config([equip('F.3')]));
    expect(html).not.toContain('ainda não foi enviada');
    expect(html).not.toContain('NÃO ENVIADO');
  });

  it('fila vazia não mostra aviso nenhum', () => {
    const html = render(config([equip('F.3')]));
    expect(html).not.toContain('ainda não foi enviada');
    expect(html).not.toContain('NÃO ENVIADO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O ramo `allSaved` depende de estado que só o efeito de semeadura preenche —
// renderToStaticMarkup não roda efeito. A regra fica travada no texto-fonte.
// ─────────────────────────────────────────────────────────────────────────────
describe('regras que o render estático não alcança — travadas na fonte', () => {
  const fonte = require('node:fs').readFileSync(`${process.cwd()}/src/kiosk.jsx`, 'utf8');

  it('"tudo registrado" exige catálogo não-vazio', () => {
    expect(fonte).toContain('catalog.length > 0 && catalog.every');
  });

  it('0 °C conta como registrado — comparação por undefined, não por verdade', () => {
    expect(fonte).toContain('savedValues[eq.label] !== undefined');
    expect(fonte).not.toMatch(/catalog\.every\(eq => savedValues\[eq\.label\]\)/);
  });

  it('nada pendente pode contar como concluído', () => {
    expect(fonte).toContain('tudoRegistrado && pendentes.total === 0');
  });

  it('o save LÊ o retorno do create em vez de descartá-lo', () => {
    expect(fonte).toContain('const salvo = await repository.create(payload)');
    expect(fonte).toContain("Boolean(salvo?._pending)");
    expect(fonte).not.toMatch(/^\s+await repository\.create\(payload\);\s*$/m);
  });

  it('o overlay não afirma "Registro salvo" quando ficou pendente', () => {
    expect(fonte).toContain("pendente ? 'Salvo neste aparelho — ainda falta enviar' : 'Registro salvo'");
  });
});
