import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compareVersions, getUnseenEntries, normalizeItem, CHANGELOG } from './changelog';

describe('compareVersions', () => {
  it('igual retorna 0', () => {
    expect(compareVersions('1.9.110', '1.9.110')).toBe(0);
  });
  it('reconhece patch maior', () => {
    expect(compareVersions('1.9.111', '1.9.110')).toBeGreaterThan(0);
    expect(compareVersions('1.9.110', '1.9.111')).toBeLessThan(0);
  });
  it('não compara como string — 1.9.9 é menor que 1.9.10', () => {
    expect(compareVersions('1.9.10', '1.9.9')).toBeGreaterThan(0);
  });
  it('minor/major maiores vencem mesmo com patch menor', () => {
    expect(compareVersions('1.10.0', '1.9.999')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.9.999')).toBeGreaterThan(0);
  });
});

describe('getUnseenEntries', () => {
  const entries = [
    { version: '1.9.3', items: ['c'] },
    { version: '1.9.2', items: ['b'] },
    { version: '1.9.1', items: ['a'] },
  ];

  it('sem versão vista antes (1º acesso), não mostra nada', () => {
    expect(getUnseenEntries(null, entries)).toEqual([]);
    expect(getUnseenEntries(undefined, entries)).toEqual([]);
  });
  it('devolve só as entradas mais novas que a última vista', () => {
    expect(getUnseenEntries('1.9.1', entries).map((e) => e.version)).toEqual(['1.9.3', '1.9.2']);
  });
  it('já viu a mais recente: nada pendente', () => {
    expect(getUnseenEntries('1.9.3', entries)).toEqual([]);
  });
  it('versão vista mais nova que qualquer entrada (downgrade/teste): nada pendente', () => {
    expect(getUnseenEntries('2.0.0', entries)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "para cada função adicionada ou melhorada, dar o caminho" (dono, 28/08).
// Saber o que mudou não adianta se a pessoa não acha onde — foi exatamente o
// que aconteceu com o mapa de calor: publicado, anunciado, e ele não achou.
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeItem — aceita os dois formatos', () => {
  it('texto puro vira item sem caminho (são ~30 entradas antigas assim)', () => {
    expect(normalizeItem('Corrigido o cálculo')).toEqual({ text: 'Corrigido o cálculo', path: null });
  });

  it('objeto com caminho passa os dois', () => {
    expect(normalizeItem({ text: 'Mapa de calor', path: 'Visão geral' }))
      .toEqual({ text: 'Mapa de calor', path: 'Visão geral' });
  });

  it('caminho vazio ou só espaço vira null — não renderiza seta órfã', () => {
    expect(normalizeItem({ text: 'x', path: '' }).path).toBeNull();
    expect(normalizeItem({ text: 'x', path: '   ' }).path).toBeNull();
    expect(normalizeItem({ text: 'x' }).path).toBeNull();
  });

  it('apara espaço nas pontas', () => {
    expect(normalizeItem({ text: '  Mudou  ', path: '  Equipe → Usuários  ' }))
      .toEqual({ text: 'Mudou', path: 'Equipe → Usuários' });
  });

  it('item torto não quebra a tela — vira texto vazio, nunca "undefined"', () => {
    expect(normalizeItem(null)).toEqual({ text: '', path: null });
    expect(normalizeItem(undefined).text).toBe('');
    expect(normalizeItem({}).text).toBe('');
  });
});

describe('o CHANGELOG de verdade continua legível pelos dois formatos', () => {
  it('todo item de toda versão normaliza sem erro', () => {
    for (const e of CHANGELOG) {
      for (const item of e.items) {
        const n = normalizeItem(item);
        expect(typeof n.text).toBe('string');
        expect(n.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('as versões recentes têm caminho em pelo menos um item', () => {
    // Não exijo caminho em TODO item: correção de cálculo e aviso não moram
    // em lugar nenhum, e caminho inventado é pior que caminho ausente.
    const recentes = CHANGELOG.slice(0, 5);
    const comCaminho = recentes.filter((e) => e.items.some((i) => normalizeItem(i).path));
    expect(comCaminho.length).toBeGreaterThan(0);
  });
});

describe('a tela do "o que mudou" usa o caminho', () => {
  const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  it('o modal normaliza cada item em vez de imprimir o objeto cru', () => {
    // Sem isto, item no formato novo renderizaria "[object Object]".
    expect(pages).toContain('const { text, path } = normalizeItem(item);');
    expect(pages).not.toContain('{e.items.map((item, i) => <li');
  });

  it('só mostra a seta quando existe caminho', () => {
    expect(pages).toContain('{path && (');
    expect(pages).toContain('➜ {path}');
  });

  it('normalizeItem é importado', () => {
    expect(pages).toContain("import { getUnseenEntries, normalizeItem } from './changelog';");
  });
});

describe('o caminho é legível nos dois temas', () => {
  const css   = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
  const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  // Contraste WCAG, mesma conta do navegador. Medido lá: --primary reprova no
  // escuro (2,05) e --green reprova no claro (3,27). Daí o token novo.
  const rgb = (hex) => [1,3,5].map((i) => parseInt(hex.slice(i,i+2),16));
  const lum = ([r,g,b]) => { const f=(c)=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4};
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const ratio = (a,b) => { const L1=lum(rgb(a)), L2=lum(rgb(b));
    return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); };

  it('usa o token que vira com o tema, não --primary nem --green', () => {
    expect(pages).toContain("color:'var(--green-emphasis)'");
  });

  it('o token existe nos DOIS blocos — só no claro deixaria o escuro ilegível', () => {
    // O corte é no SELETOR (início de linha), não em qualquer menção: os
    // comentários citam `[data-theme="dark"]` pra explicar o par, e cortar na
    // primeira menção deixava o bloco claro vazio — o teste passava/falhava
    // pelo motivo errado.
    const corte = css.indexOf('\n[data-theme="dark"] {');
    expect(corte).toBeGreaterThan(-1);
    const claro  = css.slice(0, corte);
    const escuro = css.slice(corte);
    expect(claro).toContain('--green-emphasis: #00684a');
    expect(escuro).toContain('--green-emphasis: #34d17f');
  });

  it('#00684a sobre branco passa no AA (texto pequeno, mínimo 4,5)', () => {
    expect(ratio('#00684a', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('#34d17f sobre o fundo escuro do card passa no AA', () => {
    expect(ratio('#34d17f', '#04303f')).toBeGreaterThanOrEqual(4.5);
  });

  it('e as duas alternativas descartadas de fato reprovam — é o motivo do token', () => {
    expect(ratio('#00684a', '#04303f')).toBeLessThan(4.5);   // primary no escuro
    expect(ratio('#00a35c', '#ffffff')).toBeLessThan(4.5);   // green no claro
  });
});
