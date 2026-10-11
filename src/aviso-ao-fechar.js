// ─────────────────────────────────────────────────────────────────────────────
// Aviso ao fechar a janela com registro ainda não enviado (09/10).
//
// Relato da RT da CASA DOCE: num computador da matriz, entre 8h e 9h, a
// leitura da Ilha de sobremesa e do Atendimento gelatos deu "erro de
// sincronização", ficou marrom (guardada só neste aparelho) e depois não
// constava nem no próprio computador. O app nunca apaga a fila de envio, nem
// ao sair da conta. O que apaga é o NAVEGADOR: janela anônima ou de convidado,
// ou navegador que limpa os dados ao fechar. Fechar a janela nesse estado
// joga fora o registro.
//
// O navegador não deixa escolher o texto do aviso (mostra o dele, tipo "Sair
// do site? As alterações podem não ser salvas"). Por isso a tela também diz
// "não feche esta janela" onde o pendente aparece.
//
// Revisão adversarial (10/10), duas correções:
//  · RECARGA DO PRÓPRIO APP não avisa. Recarregar não apaga o localStorage,
//    nem em janela anônima, e o aviso travava a atualização automática de
//    versão (main.jsx, controllerchange): o tablet ficava parado na caixa
//    "Sair do site?" e, com "Cancelar", seguia numa versão velha. Todo
//    reload e troca de endereço do app passa por recarregarSemAviso /
//    navegarSemAviso.
//  · Só conta registro das lojas que a sessão alcança. Um item de outra loja,
//    deixado por uma sessão anterior neste aparelho, nunca sobe com o login
//    atual e faria o aviso aparecer em todo fechamento, para sempre.
// ─────────────────────────────────────────────────────────────────────────────

let saidaDoProprioApp = false;

export function marcarSaidaDoProprioApp() { saidaDoProprioApp = true; }

export function recarregarSemAviso() {
  marcarSaidaDoProprioApp();
  window.location.reload();
}

export function navegarSemAviso(url) {
  marcarSaidaDoProprioApp();
  window.location.href = url;
  // mailto: não sai da página; o próximo fechamento de verdade volta a avisar.
  setTimeout(() => { saidaDoProprioApp = false; }, 1000);
}

// Só pra teste: zera a marca entre um caso e outro.
export function _zerarSaidaDoProprioApp() { saidaDoProprioApp = false; }

export function deveAvisarAoFechar(fila) {
  return Array.isArray(fila) && fila.length > 0;
}

// Itens da fila que pertencem às lojas da sessão. Item sem tenant_id conta
// (na dúvida, avisa). Sem lista de lojas (tela de login), não filtra.
export function filaDasLojas(fila, idsDasLojas) {
  if (!Array.isArray(fila)) return [];
  if (!Array.isArray(idsDasLojas) || idsDasLojas.length === 0) return fila;
  return fila.filter((i) => {
    const t = i?.payload?.tenant_id;
    return t === undefined || t === null || idsDasLojas.includes(t);
  });
}

// Liga o aviso e devolve a função que desliga (formato de efeito do React).
// `lerFila` é chamada na hora de fechar, não na instalação: a fila muda o
// tempo todo e o que importa é o estado no instante em que a pessoa fecha.
export function instalarAvisoAoFechar(lerFila, alvo = window) {
  const aoFechar = (e) => {
    if (saidaDoProprioApp) return undefined;
    let fila = [];
    try { fila = lerFila(); } catch { return undefined; }
    if (!deveAvisarAoFechar(fila)) return undefined;
    e.preventDefault();
    e.returnValue = '';   // Chrome/Edge antigos só mostram o aviso com isto
    return '';
  };
  alvo.addEventListener('beforeunload', aoFechar);
  return () => alvo.removeEventListener('beforeunload', aoFechar);
}
