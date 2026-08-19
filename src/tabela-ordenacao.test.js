import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ordenarLinhas, proximaOrdem, ariaSort, setaDe, ehVazio } from './tabela-ordenacao';

const COLS = {
  empresa:   { valor: (r) => r.empresa,  tipo: 'texto'  },
  media:     { valor: (r) => r.media,    tipo: 'numero' },
  ultimo:    { valor: (r) => r.ultimo,   tipo: 'data'   },
};
const linha = (empresa, media, ultimo) => ({ empresa, media, ultimo });

describe('ordenação por texto', () => {
  it('respeita acento do pt-BR — o erro que já apareceu neste código', () => {
    const out = ordenarLinhas(
      [linha('Vestiário'), linha('Área de Lavagem'), linha('Bistrô')],
      COLS, { coluna:'empresa', direcao:'asc' });
    expect(out.map(r => r.empresa)).toEqual(['Área de Lavagem', 'Bistrô', 'Vestiário']);
  });

  it('desc inverte', () => {
    const out = ordenarLinhas([linha('A'), linha('C'), linha('B')], COLS, { coluna:'empresa', direcao:'desc' });
    expect(out.map(r => r.empresa)).toEqual(['C', 'B', 'A']);
  });
});

describe('ordenação numérica', () => {
  it('compara como número, não como texto — negativo é o caso que quebra', () => {
    const out = ordenarLinhas(
      [linha('a','3.4'), linha('b','-11.5'), linha('c','-2.7'), linha('d','20')],
      COLS, { coluna:'media', direcao:'asc' });
    expect(out.map(r => r.media)).toEqual(['-11.5', '-2.7', '3.4', '20']);
  });

  it('como texto daria a ordem errada — documenta o porquê do tipo explícito', () => {
    expect(['3.4','-11.5'].sort()).toEqual(['-11.5','3.4']);   // coincide
    expect(['3.4','-2.7','20'].sort()).toEqual(['-2.7','20','3.4']);  // 20 antes de 3.4: errado
  });
});

describe('ordenação por data', () => {
  it('mais antiga primeiro no asc', () => {
    const out = ordenarLinhas(
      [linha('a',null,'2026-08-18'), linha('b',null,'2026-08-01'), linha('c',null,'2026-08-19')],
      COLS, { coluna:'ultimo', direcao:'asc' });
    expect(out.map(r => r.ultimo)).toEqual(['2026-08-01','2026-08-18','2026-08-19']);
  });
});

// ─── O comportamento que mais importa nestas tabelas ────────────────────────
describe('vazio vai sempre pro fim', () => {
  it('no asc', () => {
    const out = ordenarLinhas([linha('a','—'), linha('b','3.4'), linha('c','1.1')], COLS, { coluna:'media', direcao:'asc' });
    expect(out.map(r => r.media)).toEqual(['1.1','3.4','—']);
  });

  it('E no desc — quem ordena por Média quer ver médias, não traços', () => {
    const out = ordenarLinhas([linha('a','—'), linha('b','3.4'), linha('c','1.1')], COLS, { coluna:'media', direcao:'desc' });
    expect(out.map(r => r.media)).toEqual(['3.4','1.1','—']);
  });

  it('reconhece as formas de vazio usadas no app', () => {
    expect(ehVazio('—')).toBe(true);
    expect(ehVazio('  ')).toBe(true);
    expect(ehVazio(null)).toBe(true);
    expect(ehVazio(undefined)).toBe(true);
    expect(ehVazio(0)).toBe(false);      // zero é dado, não vazio (câmara a 0°C)
    expect(ehVazio('0')).toBe(false);
  });
});

describe('pureza e robustez', () => {
  it('não modifica a lista original', () => {
    const orig = [linha('C'), linha('A')];
    const copia = JSON.parse(JSON.stringify(orig));
    ordenarLinhas(orig, COLS, { coluna:'empresa', direcao:'asc' });
    expect(orig).toEqual(copia);
  });

  it('sem ordem escolhida devolve a ordem natural', () => {
    const orig = [linha('C'), linha('A')];
    expect(ordenarLinhas(orig, COLS, { coluna:null }).map(r=>r.empresa)).toEqual(['C','A']);
  });

  it('coluna desconhecida não quebra', () => {
    expect(ordenarLinhas([linha('A')], COLS, { coluna:'inexistente', direcao:'asc' })).toHaveLength(1);
  });

  it('entrada inválida devolve lista vazia', () => {
    expect(ordenarLinhas(null, COLS, { coluna:'empresa' })).toEqual([]);
  });
});

describe('ciclo do clique', () => {
  it('coluna nova começa em asc', () => {
    expect(proximaOrdem(null, 'media')).toEqual({ coluna:'media', direcao:'asc' });
    expect(proximaOrdem({coluna:'empresa',direcao:'desc'}, 'media')).toEqual({ coluna:'media', direcao:'asc' });
  });

  it('asc → desc → sem ordenação', () => {
    let o = proximaOrdem(null, 'media');
    expect(o.direcao).toBe('asc');
    o = proximaOrdem(o, 'media');
    expect(o.direcao).toBe('desc');
    o = proximaOrdem(o, 'media');
    expect(o.coluna).toBe(null);   // o terceiro clique desfaz — senão não há volta
  });
});

describe('acessibilidade', () => {
  it('aria-sort reflete o estado', () => {
    expect(ariaSort({coluna:'media',direcao:'asc'}, 'media')).toBe('ascending');
    expect(ariaSort({coluna:'media',direcao:'desc'}, 'media')).toBe('descending');
    expect(ariaSort({coluna:'media',direcao:'asc'}, 'empresa')).toBe('none');
  });

  it('a seta só aparece na coluna ordenada', () => {
    expect(setaDe({coluna:'media',direcao:'asc'}, 'media')).toBe('▴');
    expect(setaDe({coluna:'media',direcao:'desc'}, 'media')).toBe('▾');
    expect(setaDe({coluna:'media',direcao:'asc'}, 'empresa')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guardas do PADRÃO. O pedido do dono (19/08) foi "adote isso como padrão do
// NutriOPS", então o que precisa não regredir é a cobertura: tabela nova sem
// cabeçalho clicável, ou tabela existente que volte ao <th> mudo.
// ─────────────────────────────────────────────────────────────────────────────
describe('padrão de tabela — cobertura', () => {
  const arq = (n) => readFileSync(`${process.cwd()}/src/${n}`, 'utf8');

  it('as 5 tabelas interativas usam o Th ordenável', () => {
    // reports.jsx tem 3 (Temperatura, Planilhas BPF, Capacitação)
    expect((arq('reports.jsx').match(/<Th /g) ?? []).length).toBeGreaterThanOrEqual(24);
    // reports-views.jsx: Auditoria
    expect((arq('reports-views.jsx').match(/<Th /g) ?? []).length).toBeGreaterThanOrEqual(6);
    // validity.jsx: Produtos
    expect((arq('validity.jsx').match(/<Th /g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('cada tabela ordenável declara suas colunas com tipo explícito', () => {
    for (const [nome, mapa] of [
      ['reports.jsx', 'COLS_EQUIP'], ['reports.jsx', 'COLS_BPF'], ['reports.jsx', 'COLS_TREINO'],
      ['reports-views.jsx', 'COLS_AUDITORIA'], ['validity.jsx', 'COLS_VALIDADE'],
    ]) {
      expect(arq(nome), `${nome} sem ${mapa}`).toContain(`const ${mapa} = {`);
    }
  });

  it('toda coluna declarada tem `tipo` — sem ele, número ordena como texto', () => {
    for (const nome of ['reports.jsx', 'reports-views.jsx', 'validity.jsx']) {
      const fonte = arq(nome);
      for (const bloco of fonte.match(/const COLS_\w+ = \{[\s\S]*?\n\};/g) ?? []) {
        for (const linha of bloco.split('\n')) {
          if (!linha.includes('valor:')) continue;
          expect(linha, `${nome}: coluna sem tipo → ${linha.trim()}`).toMatch(/tipo:\s*'(texto|numero|data)'/);
        }
      }
    }
  });

  // Fora do padrão de propósito — documentado pra ninguém "consertar" sem pensar:
  //   · reports-views.jsx:24 e :276 — <table> dentro de string HTML do PDF; não há clique num relatório impresso.
  //   · o heatmap semanal da Visão Geral — colunas são DIAS, ordenar não significa nada.
  //   · src/App.jsx — arquivo morto, não é importado por ninguém (main.jsx usa App de ./pages).
  it('App.jsx continua fora do app — se voltar a ser importado, precisa entrar no padrão', () => {
    const usos = ['main.jsx','pages.jsx'].filter(f => /from '\.\/App'/.test(arq(f)));
    expect(usos).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cards clicáveis (19/08) — extensão do padrão pedida logo depois dos
// cabeçalhos: "faça os cards clicáveis também". Guarda de fonte, no mesmo
// espírito dos testes de cobertura acima — cada tela usa o comportamento que
// bate com a tabela dela: ORDENA quando a linha soma várias categorias
// (equipamento), FILTRA quando a linha já É uma categoria (pessoa/status).
// ─────────────────────────────────────────────────────────────────────────────
describe('cards clicáveis', () => {
  const arq = (n) => readFileSync(`${process.cwd()}/src/${n}`, 'utf8');

  it('TemperatureReport: os 5 cards viram <button class="audit-stat clicavel">', () => {
    const fonte = arq('reports.jsx');
    expect(fonte).toContain('const aoClicarCard = (coluna, direcaoPadrao');
    expect(fonte).toContain('<CardStat coluna="total"');
    expect(fonte).toContain('<CardStat coluna="compliance"');
  });

  it('TemperatureReport: Conformidade geral ordena ASC (pior primeiro) — foge do padrão desc de propósito', () => {
    expect(arq('reports.jsx')).toContain('direcaoPadrao="asc"');
  });

  it('TemperatureReport: clicar no card ativo desliga a ordenação', () => {
    expect(arq('reports.jsx')).toContain("o.coluna === coluna ? { coluna: null, direcao: 'asc' }");
  });

  it('TrainingReport: os 4 cards FILTRAM (cada linha já é uma pessoa com 1 status)', () => {
    const fonte = arq('reports.jsx');
    expect(fonte).toContain('const [statusCard, setStatusCard] = useState(null);');
    expect(fonte).toContain('const dataFiltrada = statusCard ? data.filter(r => r.status === statusCard) : data;');
    expect(fonte).toContain("onClick={() => setStatusCard((cur) => cur===s ? null : s)}");
  });

  it('AuditView: os cards reusam statusFilter — não criam um segundo estado', () => {
    const fonte = arq('reports-views.jsx');
    expect(fonte).toContain("onClick={() => setStatusFilter((s) => s==='ok' ? 'all' : 'ok')}");
    expect(fonte).toContain("onClick={() => setStatusFilter((s) => s==='warn' ? 'all' : 'warn')}");
    expect(fonte).toContain("onClick={() => setStatusFilter((s) => s==='danger' ? 'all' : 'danger')}");
    // não pode existir um useState novo pra isso — reusar é o ponto
    const blocoCards = fonte.slice(fonte.indexOf('<div className="audit-stats">', fonte.indexOf('function AuditView')), fonte.indexOf('</div>\n      <div className="audit-filters">'));
    expect(blocoCards).not.toContain('useState');
  });

  it('todo card clicável tem aria-pressed — leitor de tela precisa saber o estado', () => {
    for (const nome of ['reports.jsx', 'reports-views.jsx']) {
      const fonte = arq(nome);
      const botoesClicaveis = (fonte.match(/className=\{`audit-stat clicavel[^`]*`\}/g) ?? []).length;
      const ariaPressed = (fonte.match(/aria-pressed=\{/g) ?? []).length;
      expect(ariaPressed, `${nome}: ${botoesClicaveis} cards clicáveis mas só ${ariaPressed} aria-pressed`).toBeGreaterThanOrEqual(botoesClicaveis);
    }
  });
});
