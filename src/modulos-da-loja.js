// ─────────────────────────────────────────────────────────────────────────────
// Nem toda loja usa todo módulo.
//
// PKS e Terraço são filiais de apoio da CASA DOCE: recebem da matriz quase
// tudo pronto e não têm fritadeira. Os 5 controles especiais (higiene das
// mãos, saturação do óleo, descongelamento, resfriamento e tratamento
// térmico) não têm o que registrar ali — a aba só ocupava espaço e sugeria
// uma pendência que não existe. Pedido do dono (09/09).
//
// A regra vive aqui, pura, porque a aba é alcançável por QUATRO caminhos:
// menu lateral, menu do celular, Cmd+K e o botão "ir para" da Prontidão.
// Esconder num só deixaria os outros três como porta dos fundos — e a tela
// aberta por um caminho desses não teria como voltar a fazer sentido.
//
// Isto NÃO apaga nada: os registros que a loja já tenha feito continuam no
// banco e nos relatórios. É só a tela que some.
// ─────────────────────────────────────────────────────────────────────────────

const texto = (v) => String(v ?? '').toLowerCase();

// Mesmo casamento por nome que o seedTemplates usa pra escolher as planilhas
// de cada uma — as duas coisas leem daqui pra não divergirem com o tempo.
export function unidadePKS(tenant) {
  const n = texto(tenant?.name);
  return n.includes('pks') || n.includes('parkshopping') || n.includes('park shopping');
}

export function unidadeTerraco(tenant) {
  const n = texto(tenant?.name);
  return n.includes('terraço') || n.includes('terraco');
}

// O hub e as 5 sub-telas. Mesma lista do CONTROLS_KEYS (nav.js); repetida aqui
// de propósito pra este módulo continuar puro e sem dependência de navegação.
export const VIEWS_CONTROLES_ESPECIAIS = ['controls', 'handwash', 'oil', 'thaw', 'cooling', 'thermal'];

export function lojaUsaControlesEspeciais(tenant) {
  return !(unidadePKS(tenant) || unidadeTerraco(tenant));
}

// Uma tela é visível nesta loja? Hoje só os controles especiais entram na
// regra; a assinatura já aceita qualquer view pra a próxima exceção não
// precisar mexer em quem chama.
export function viewVisivelNaLoja(view, tenant) {
  if (VIEWS_CONTROLES_ESPECIAIS.includes(view)) return lojaUsaControlesEspeciais(tenant);
  return true;
}
