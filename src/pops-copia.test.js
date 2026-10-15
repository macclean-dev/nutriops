import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { copiarPops } from './implantacao';
import { popAprovado, descreverAprovacao, aprovarPop } from './pop-aprovacao';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido da RT da CASA DOCE (14/10): "consigo cadastrar todos os POPs na Casa
// Doce e somente passar para as outras filiais, ou tenho necessariamente que
// cadastrar em todos?". O "Copiar de outra loja" já existia para planilhas e
// equipamentos (v1.9.275); faltava POP.
// ─────────────────────────────────────────────────────────────────────────────

const RT = { user: { name: 'Nutri', role: 'Nutricionista RT' } };
const aprovado = aprovarPop({
  id: 'pop-matriz-1', title: 'Higienização de hortifrutícolas', category: 'higiene', objective: 'Reduzir carga microbiana',
  steps: ['Lavar', 'Imergir 15 min', 'Enxaguar'], materials: 'Hipoclorito', frequency: 'Diário', responsible: 'Cozinha',
  version: 3, history: [{ version: 2 }, { version: 1 }], createdBy: 'Nutri', createdAt: '2026-09-01T10:00:00Z',
}, RT, Date.parse('2026-10-01T10:00:00Z'));
const outro = { id: 'pop-matriz-2', title: 'Controle de pragas', category: 'pragas', steps: ['Inspecionar'], version: 1 };

describe('copiar POPs de outra loja', () => {
  let n = 0;
  const { copias, repetidos } = copiarPops([aprovado, outro], [{ id: 'pks-1', title: 'CONTROLE DE PRAGAS' }], {
    lojaOrigem: 'CASA DOCE', quem: 'Nutri', novoId: () => `novo-${n++}`, hojeIso: '2026-10-14T12:00:00Z',
  });

  it('leva o texto inteiro do POP', () => {
    expect(copias).toHaveLength(1);
    const c = copias[0];
    expect(c.title).toBe(aprovado.title);
    expect(c.steps).toEqual(['Lavar', 'Imergir 15 min', 'Enxaguar']);
    expect(c.materials).toBe('Hipoclorito');
  });

  it('chega aguardando aprovação NESTA loja (RDC 216 4.11.2), em versão 1', () => {
    expect(popAprovado(aprovado)).toBe(true);
    expect(popAprovado(copias[0])).toBe(false);
    expect(descreverAprovacao(copias[0])).toBe('Versão 1 · aguardando aprovação');
    expect(copias[0].history).toBeUndefined();
  });

  it('id novo e a trilha de onde veio', () => {
    expect(copias[0].id).toBe('novo-0');
    expect(copias[0].copiadoDe).toEqual({ loja: 'CASA DOCE', popId: 'pop-matriz-1', versao: 3, em: '2026-10-14T12:00:00Z' });
    expect(aprovado.id).toBe('pop-matriz-1');   // a origem não é alterada
  });

  it('POP com o mesmo título aqui não é copiado de novo (sem caixa e acento)', () => {
    expect(repetidos.map((p) => p.id)).toEqual(['pop-matriz-2']);
  });

  it('a RT aprova a cópia com um toque e aí ela vale', () => {
    expect(popAprovado(aprovarPop(copias[0], RT))).toBe(true);
  });
});

describe('a tela de POPs', () => {
  const c = readFileSync(`${process.cwd()}/src/controls.jsx`, 'utf8');
  it('o botão aparece só para quem edita POP e acompanha mais de uma loja', () => {
    expect(c).toContain('{isRT && outrasLojas.length > 0 && <button className="secondary-action" onClick={() => { setAvisoCopia(null); setCopiarOpen(true); }}>Copiar de outra loja</button>}');
  });
  it('cada cópia sobe para a nuvem', () => {
    expect(c).toContain('for (const p of copias) pushPOP(activeTenant.id, p);');
  });
});
