import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mesclarPorChave, gravarMesclando, notificarSyncAplicado, SYNC_EVENT } from './lista-local';

const t = (n) => new Date(Date.now() - n * 60000).toISOString();
const r = (id, over = {}) => ({ id, value: 1, createdAt: t(10), ...over });

describe('mesclarPorChave', () => {
  it('une as duas listas sem perder ninguém', () => {
    const out = mesclarPorChave([[r('a')], [r('b')]]);
    expect(out.map(x => x.id).sort()).toEqual(['a', 'b']);
  });

  it('item repetido fica com a versão mais recente', () => {
    const out = mesclarPorChave([
      [r('a', { value: 1, updatedAt: t(10) })],
      [r('a', { value: 2, updatedAt: t(1) })],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(2);
  });

  it('devolve em ordem cronológica decrescente', () => {
    const out = mesclarPorChave([[r('velho', { createdAt: t(100) }), r('novo', { createdAt: t(1) })]]);
    expect(out.map(x => x.id)).toEqual(['novo', 'velho']);
  });

  it('item SEM id é preservado — não dá pra deduplicar, mas não pode sumir', () => {
    const out = mesclarPorChave([[{ createdAt: t(5), value: 9 }], [r('a')]]);
    expect(out).toHaveLength(2);
  });

  it('lixo não derruba nada', () => {
    expect(mesclarPorChave([null, undefined, [null, 'x', 3], [r('a')]])).toHaveLength(1);
  });
});

// ─── O cenário exato do achado ──────────────────────────────────────────────
describe('gravarMesclando — o registro que o sync trouxe não pode ser apagado', () => {
  const KEY = 'nutriops.oil.casadoce';
  const read  = (id) => JSON.parse(localStorage.getItem(`nutriops.oil.${id}`) ?? '[]');
  const write = (id, v) => localStorage.setItem(`nutriops.oil.${id}`, JSON.stringify(v));

  beforeEach(() => localStorage.clear());

  it('o caso real: tela montou com 1, sync trouxe 20, a pessoa registra 1 → ficam 22', () => {
    // a tela leu isto na montagem
    const daTela = [r('meu-antigo', { createdAt: t(120) })];
    // depois disso o sync gravou 20 registros de outro aparelho
    write('casadoce', [
      ...Array.from({ length: 20 }, (_, i) => r(`nuvem-${i}`, { createdAt: t(60 + i) })),
      ...daTela,
    ]);
    // a pessoa registra mais um; a tela manda [novo, ...listaAntiga]
    const gravada = gravarMesclando(read, write, 'casadoce', [r('novo', { createdAt: t(0) }), ...daTela]);

    expect(gravada).toHaveLength(22);
    expect(gravada.filter(x => x.id.startsWith('nuvem-'))).toHaveLength(20);  // ✅ sobreviveram
    expect(gravada[0].id).toBe('novo');
    expect(JSON.parse(localStorage.getItem(KEY))).toHaveLength(22);
  });

  it('sem a mescla, os 20 seriam apagados — é a regressão que não pode voltar', () => {
    write('casadoce', Array.from({ length: 20 }, (_, i) => r(`nuvem-${i}`)));
    write('casadoce', [r('novo')]);                       // o comportamento ANTIGO
    expect(read('casadoce')).toHaveLength(1);             // documenta o estrago
  });

  it('storage vazio: grava o que a tela tem', () => {
    expect(gravarMesclando(read, write, 'casadoce', [r('a'), r('b')])).toHaveLength(2);
  });

  it('nada novo na tela: o storage passa intacto', () => {
    const nuvem = [r('n1'), r('n2')];
    write('casadoce', nuvem);
    expect(gravarMesclando(read, write, 'casadoce', nuvem)).toHaveLength(2);
  });

  it('edição na tela vence a cópia velha do storage', () => {
    write('casadoce', [r('a', { value: 1, updatedAt: t(50) })]);
    const out = gravarMesclando(read, write, 'casadoce', [r('a', { value: 99, updatedAt: t(0) })]);
    expect(out[0].value).toBe(99);
  });
});

describe('aviso de sync', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dispara um evento que as telas podem ouvir', () => {
    const ouvinte = vi.fn();
    window.addEventListener(SYNC_EVENT, ouvinte);
    notificarSyncAplicado({ tenantId: 'casadoce' });
    expect(ouvinte).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYNC_EVENT, ouvinte);
  });

  it('não quebra se o ambiente não tiver window utilizável', () => {
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => { throw new Error('x'); });
    expect(() => notificarSyncAplicado()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guardas de fonte: o padrão estava repetido em 5 telas e é fácil alguém
// reintroduzir a versão antiga ao mexer numa delas.
// ─────────────────────────────────────────────────────────────────────────────
describe('as 5 telas não podem voltar a sobrescrever o sync', () => {
  const controls = readFileSync(`${process.cwd()}/src/controls.jsx`, 'utf8');
  const extras   = readFileSync(`${process.cwd()}/src/extras.jsx`, 'utf8');
  const pages    = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  it('nenhuma grava a lista crua por cima do storage', () => {
    for (const [nome, fonte, pares] of [
      ['controls.jsx', controls, [['readOil','writeOil'],['readThaw','writeThaw'],['readCool','writeCool'],['readThermal','writeThermal']]],
      ['extras.jsx',   extras,   [['readHandwash','writeHandwash']]],
    ]) {
      for (const [, wr] of pares) {
        const cru = new RegExp(`useEffect\\(\\(\\) => \\{ ${wr}\\(activeTenant\\.id, records\\); \\}`);
        expect(cru.test(fonte), `${nome}: ${wr} voltou a gravar cru`).toBe(false);
      }
    }
  });

  it('as 5 gravam mesclando', () => {
    const total = (controls.match(/gravarMesclando\(/g) ?? []).length
                + (extras.match(/gravarMesclando\(/g) ?? []).length;
    expect(total).toBe(5);
  });

  it('as 5 se reinscrevem no aviso de sync', () => {
    const total = (controls.match(/addEventListener\(SYNC_EVENT, reler\)/g) ?? []).length
                + (extras.match(/addEventListener\(SYNC_EVENT, reler\)/g) ?? []).length;
    expect(total).toBe(5);
  });

  it('e removem o ouvinte ao desmontar — senão vaza a cada troca de loja', () => {
    const total = (controls.match(/removeEventListener\(SYNC_EVENT, reler\)/g) ?? []).length
                + (extras.match(/removeEventListener\(SYNC_EVENT, reler\)/g) ?? []).length;
    expect(total).toBe(5);
  });

  it('alguém realmente dispara o aviso — sem isso a releitura nunca acontece', () => {
    expect(pages).toContain('notificarSyncAplicado({ tenantId: tenantAlvo, trigger })');
  });
});
