// ─────────────────────────────────────────────────────────────────────────────
// Renomear uma planilha do seed SEM duplicar a cópia que as lojas já têm.
//
// O problema: `TPL_HIGIENE_PESSOAL` nasceu com `id: uid()` — id sorteado a cada
// chamada — e sem `v`. Por isso `readFormTemplates` só reencontra a cópia da
// loja pelo TÍTULO (`categoria::título`). Mudar o título quebra esse casamento:
// o seed vira "planilha nova", entra como uma SEGUNDA cópia, e a loja fica com
// duas — que é a mesma duplicação que a ferramenta de deduplicação existe pra
// limpar.
//
// Foi o que travou o conserto do "Higiene Pessoal dos Colaboradors" (sem o "e")
// quando ele apareceu em 05/09: um erro de digitação de uma letra, visível em
// três lojas em produção, que não dava pra corrigir de passagem.
//
// A saída é renomear a cópia da LOJA antes de comparar. Aí o casamento por
// título volta a funcionar, o id de sempre é preservado (os registros
// históricos apontam pra ele) e o `v` novo do seed substitui a definição pelo
// caminho normal.
//
// Idempotente por construção: depois de renomeado, o título velho não casa
// mais. Roda em toda leitura sem efeito.
// ─────────────────────────────────────────────────────────────────────────────

// `de` é o título ERRADO que está gravado nas lojas; `para` é o do seed.
// Acrescentar aqui é o jeito de renomear qualquer planilha do seed daqui em
// diante — nunca trocar o título direto no template sem passar por isto.
export const RENOMEACOES = [
  {
    categoria: 'higiene_pessoal',
    de:   'Higiene Pessoal dos Colaboradors',
    para: 'Higiene Pessoal dos Colaboradores',
  },
];

const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Título canônico de hoje. Usado nos DOIS lados da comparação — no template e
 * no registro — pra que registro antigo (que carrega `formTitle` congelado no
 * momento do preenchimento) continue casando com a planilha renomeada.
 */
export function tituloAtual(categoria, titulo) {
  const r = RENOMEACOES.find((x) => norm(x.categoria) === norm(categoria) && norm(x.de) === norm(titulo));
  return r ? r.para : String(titulo ?? '');
}

/**
 * Aplica as renomeações à lista de planilhas da loja.
 *
 * Preserva TUDO menos o título — inclusive o `id`, que é o que amarra os
 * registros já preenchidos, e o `custom`, porque renomear não é sobrescrever o
 * que a RT editou: o conteúdo dela continua intacto, só o rótulo com erro de
 * digitação muda.
 *
 * @returns {{ lista: Array, mudou: boolean }}
 */
export function aplicarRenomeacoes(templates, agora = () => new Date().toISOString()) {
  let mudou = false;
  const lista = (templates ?? []).map((t) => {
    const novo = tituloAtual(t?.category, t?.title);
    if (!t || novo === t.title) return t;
    mudou = true;
    // `updatedAt` novo é essencial: o sync funde local↔nuvem por mergeByKey,
    // que escolhe o mais recente. Sem o carimbo, a linha velha da nuvem —
    // ainda com o título errado — desfaria a correção no boot seguinte.
    return { ...t, title: novo, updatedAt: agora() };
  });
  return { lista, mudou };
}
