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
// ─────────────────────────────────────────────────────────────────────────────

export function deveAvisarAoFechar(fila) {
  return Array.isArray(fila) && fila.length > 0;
}

// Liga o aviso e devolve a função que desliga (formato de efeito do React).
// `lerFila` é chamada na hora de fechar, não na instalação: a fila muda o
// tempo todo e o que importa é o estado no instante em que a pessoa fecha.
export function instalarAvisoAoFechar(lerFila, alvo = window) {
  const aoFechar = (e) => {
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
