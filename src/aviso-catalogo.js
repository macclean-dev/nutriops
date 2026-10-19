// ─────────────────────────────────────────────────────────────────────────────
// Quando mostrar "Esta não é a lista de equipamentos da sua unidade" (19/10).
//
// O aviso existe desde 10/08: aparelho preso na lista de exemplo (os
// genéricos de fábrica) enquanto a nuvem tinha os equipamentos reais. Só que a
// marca era UMA para o aparelho inteiro. Com o sync seguindo a loja do
// seletor (v1.9.272), quem acompanha várias lojas ligava a marca numa loja sem
// equipamento na nuvem e, ao trocar para outra, via o aviso por cima da lista
// CERTA (print do dono no Fabrizzio Terraço, 19/10, com os 11 equipamentos
// reais logo abaixo do aviso).
//
// Agora o aviso só aparece se as duas coisas forem verdade AGORA: a marca é
// desta loja e o que está na tela é mesmo a lista de exemplo.
// ─────────────────────────────────────────────────────────────────────────────

import { isPlaceholderCatalog } from './segments';

export function mostrarAvisoCatalogo({ marcadoPara, lojaNaTela, catalogoNaTela }) {
  if (!marcadoPara || marcadoPara !== lojaNaTela) return false;
  return isPlaceholderCatalog(catalogoNaTela ?? []);
}
