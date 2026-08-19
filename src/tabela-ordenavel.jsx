// ─────────────────────────────────────────────────────────────────────────────
// Cabeçalho de tabela clicável — o padrão de tabela do NutriOPS (19/08).
//
// Uso:
//   const { ordem, aoClicar, ordenar } = useOrdenacao();
//   const linhas = ordenar(dados, COLUNAS);
//   ...
//   <thead><tr>
//     <Th id="empresa" ordem={ordem} onClick={aoClicar}>Empresa</Th>
//     <Th id="media" ordem={ordem} onClick={aoClicar} num>Média</Th>
//   </tr></thead>
//
// COLUNAS é { id: { valor, tipo } } — ver tabela-ordenacao.js.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import { ordenarLinhas, proximaOrdem, ariaSort, setaDe } from './tabela-ordenacao';

export function useOrdenacao(inicial = { coluna: null, direcao: 'asc' }) {
  const [ordem, setOrdem] = useState(inicial);
  const aoClicar = useCallback((coluna) => setOrdem((o) => proximaOrdem(o, coluna)), []);
  const ordenar = useCallback((linhas, colunas) => ordenarLinhas(linhas, colunas, ordem), [ordem]);
  return { ordem, aoClicar, ordenar, setOrdem };
}

// `num` alinha à direita (coluna numérica) — segue o que estas tabelas já fazem.
export function Th({ id, ordem, onClick, children, num = false, title }) {
  const ativo = ordem?.coluna === id;
  return (
    <th aria-sort={ariaSort(ordem, id)} style={{ padding: 0 }}>
      {/* botão de verdade, não <th onClick>: precisa ser alcançável por teclado
          e anunciado como controle. Herda a tipografia do th pra não mudar o
          visual de nenhuma tabela existente. */}
      <button
        type="button"
        onClick={() => onClick(id)}
        title={title ?? `Ordenar por ${typeof children === 'string' ? children : id}`}
        style={{
          all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4, width: '100%',
          justifyContent: num ? 'flex-end' : 'flex-start',
          padding: 'inherit', font: 'inherit', color: ativo ? 'var(--primary)' : 'inherit',
          fontWeight: ativo ? 700 : 'inherit',
        }}
      >
        {children}
        {/* espaço reservado sempre: sem isso a coluna "pula" de largura ao
            ganhar a seta, e a tabela inteira treme a cada clique. */}
        <span aria-hidden="true" style={{ width: '0.7em', display: 'inline-block', opacity: ativo ? 1 : 0.25 }}>
          {ativo ? setaDe(ordem, id) : '⇅'}
        </span>
      </button>
    </th>
  );
}
