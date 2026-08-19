// ─────────────────────────────────────────────────────────────────────────────
// Ordenação por coluna — padrão de tabela do NutriOPS.
//
// Pedido do dono (19/08): cabeçalho clicável em Relatórios. Adotado como padrão
// pra todas as tabelas do app, então mora aqui em vez de dentro de uma tela.
//
// Três coisas que este projeto exige e um sort ingênuo erra:
//
// 1. `'—'` é o vazio de TODAS essas tabelas (média sem leitura, último registro
//    inexistente). Ordenado como texto, ele se mistura no meio dos números. Aqui
//    vazio vai SEMPRE pro fim, nas duas direções — quem ordena por "Média" quer
//    ver as médias, não os traços.
// 2. Número vem como string formatada ('-11.5', '3.4'). Comparar como texto põe
//    '-11.5' depois de '3.4'. Numérico compara numérico.
// 3. Texto em pt-BR precisa de localeCompare com sensitivity base, senão
//    "Área de Lavagem" cai depois de "Vestiário" por causa do acento — erro que
//    já apareceu neste código antes (ver setores em forms.jsx).
// ─────────────────────────────────────────────────────────────────────────────

export const VAZIOS = ['—', '-', '', null, undefined];

export function ehVazio(v) {
  return VAZIOS.includes(typeof v === 'string' ? v.trim() : v);
}

// 'texto' | 'numero' | 'data'. Explícito na definição da coluna: adivinhar pelo
// primeiro valor erra na primeira linha vazia.
function comparar(a, b, tipo) {
  if (tipo === 'numero') {
    const na = Number(a), nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return 0;
    return na - nb;
  }
  if (tipo === 'data') {
    const ta = new Date(a).getTime(), tb = new Date(b).getTime();
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
    return ta - tb;
  }
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { sensitivity: 'base', numeric: true });
}

// `colunas`: { [id]: { valor: (linha) => any, tipo?: 'texto'|'numero'|'data' } }
// Pura: não muda a lista de entrada.
export function ordenarLinhas(linhas, colunas, ordem) {
  const lista = Array.isArray(linhas) ? [...linhas] : [];
  if (!ordem?.coluna) return lista;
  const def = colunas?.[ordem.coluna];
  if (!def) return lista;
  const dir = ordem.direcao === 'desc' ? -1 : 1;
  return lista.sort((la, lb) => {
    const a = def.valor(la), b = def.valor(lb);
    const va = ehVazio(a), vb = ehVazio(b);
    if (va && vb) return 0;
    if (va) return 1;    // vazio sempre no fim, independente da direção
    if (vb) return -1;
    return comparar(a, b, def.tipo ?? 'texto') * dir;
  });
}

// Ciclo do clique: asc → desc → sem ordenação (volta à ordem natural da tela).
// O terceiro estado importa: sem ele, quem clicou por engano não tem como
// desfazer e a ordem original — que costuma ser a mais útil — fica inalcançável.
export function proximaOrdem(ordemAtual, coluna) {
  if (ordemAtual?.coluna !== coluna) return { coluna, direcao: 'asc' };
  if (ordemAtual.direcao === 'asc')  return { coluna, direcao: 'desc' };
  return { coluna: null, direcao: 'asc' };
}

// Valor de `aria-sort` pro <th> — leitor de tela anuncia a ordenação.
export function ariaSort(ordem, coluna) {
  if (ordem?.coluna !== coluna) return 'none';
  return ordem.direcao === 'desc' ? 'descending' : 'ascending';
}

export function setaDe(ordem, coluna) {
  if (ordem?.coluna !== coluna) return '';
  return ordem.direcao === 'desc' ? '▾' : '▴';
}
