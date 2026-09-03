// ─────────────────────────────────────────────────────────────────────────────
// Mover uma pessoa da equipe de uma empresa para outra.
//
// Pedido do dono (28/08): "como mudar um colaborador de unidade? Parece que ela
// cadastrou tudo na casa doce. Quando edito, ele abre os dados mas se eu mudar
// a empresa ele apaga tudo."
//
// O seletor de empresa do topo NÃO serve pra isso, e o comportamento que parece
// bug é proposital: trocar de empresa no meio de uma edição descarta o
// formulário porque a lista em memória é de OUTRA loja — deixar continuar
// gravaria a equipe de uma sob a chave da outra (o bug de contaminação que o
// comentário de `usersTenant` documenta em team-views.jsx). Faltava a operação
// de verdade, que é esta.
//
// O que se move é o CADASTRO (o nome que aparece no seletor de operador e no
// controle de ASO). O histórico — temperaturas, planilhas — fica onde foi
// registrado, e tem que ficar: é evidência sanitária carimbada com a empresa
// onde a medição aconteceu. Reescrever isso seria falsear registro.
// ─────────────────────────────────────────────────────────────────────────────

const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Decide se dá pra mover, e o que gravar de cada lado.
 *
 * @param pessoa      objeto do colaborador na loja de origem
 * @param origem      { id, name }
 * @param destino     { id, name }
 * @param equipeDestino lista de colaboradores JÁ cadastrados no destino
 * @returns {{ ok:boolean, motivo?:string, pessoa?:object }}
 */
export function planejarMudancaDeUnidade(pessoa, origem, destino, equipeDestino) {
  const nome = String(pessoa?.name ?? '').trim();
  if (!nome) return { ok: false, motivo: 'sem_nome' };
  if (!destino?.id) return { ok: false, motivo: 'sem_destino' };
  if (destino.id === origem?.id) return { ok: false, motivo: 'mesma_empresa' };

  // A chave real na nuvem é (tenant_id, name), sem id — mesma armadilha que
  // `staffNameJaExiste` já cobre no cadastro. Mover pra cima de um homônimo
  // apagaria a linha do destino em silêncio no próximo sync.
  if ((equipeDestino ?? []).some((u) => norm(u?.name) === norm(nome))) {
    return { ok: false, motivo: 'ja_existe_no_destino' };
  }

  return {
    ok: true,
    // `asoExterno` NÃO viaja: ele significa "o ASO desta pessoa é controlado
    // por outra empresa", e isso é uma afirmação sobre a loja onde ela está
    // cadastrada. Movida pra empresa que de fato assina a carteira dela, a
    // marca deixa de fazer sentido — e mantê-la a tiraria do controle de saúde
    // dos DOIS lados, que é exatamente o buraco que ninguém percebe.
    pessoa: { ...pessoa, name: nome, asoExterno: false },
  };
}

export function explicarRecusa(motivo, nomeDestino) {
  switch (motivo) {
    case 'ja_existe_no_destino':
      return `Já existe alguém com esse nome em ${nomeDestino}. Nomes iguais colidem e um dos dois some da lista sem aviso — mova com o nome completo, ou ajuste o cadastro que já está lá.`;
    case 'mesma_empresa': return 'Essa pessoa já está nesta empresa.';
    case 'sem_destino':   return 'Escolha a empresa de destino.';
    case 'sem_nome':      return 'Cadastro sem nome não pode ser movido.';
    default:              return 'Não foi possível mover.';
  }
}

/**
 * Texto do aviso antes de mover. Diz o que NÃO se move, porque é a parte que
 * gera dúvida depois ("cadê os registros dela?").
 */
export function avisoDaMudanca(nome, origemNome, destinoNome) {
  return `Mover ${nome} de ${origemNome} para ${destinoNome}?\n\n`
    + `O cadastro passa a valer em ${destinoNome}: é lá que ela vai aparecer pra registrar temperatura e no controle de ASO.\n\n`
    + `As leituras e planilhas que ela já preencheu FICAM em ${origemNome} — registro sanitário fica onde foi feito.`;
}
