// ─────────────────────────────────────────────────────────────────────────────
// Aprovação e versão dos POPs (candidata 1 da pesquisa de 03/10).
//
// RDC 216 4.11.2: os POP "devem ser aprovados, datados e assinados pelo
// responsável do estabelecimento". Até a v1.9.265 o POP saía impresso com
// "Nutricionista RT / Data: ____" em branco, não havia aprovação nem edição
// (só criar e apagar), e a Prontidão contava qualquer POP cadastrado.
//
// Quem aprova: decisão do dono em 03/10, "RT ou dono", ou seja, Nutricionista
// RT ou Administrador da loja (Super-admin junto). É a mesma regra da
// assinatura das planilhas (podeValidarPlanilha, permissions.js): conta de
// loja nunca aprova, porque é tablet compartilhado e não uma pessoa.
//
// Versão: editar um POP gera a versão seguinte e derruba a aprovação, porque
// a assinatura vale pro texto que foi lido. A versão anterior vai pro
// histórico com a aprovação que ela tinha: é a trilha do que estava vigente
// em cada data. Tudo dentro do objeto do POP (`pops.data` é jsonb), sem SQL.
// ─────────────────────────────────────────────────────────────────────────────

import { podeValidarPlanilha } from './permissions';

export const podeAprovarPop = (session) => podeValidarPlanilha(session);

export const versaoDoPop = (pop) => (Number(pop?.version) > 0 ? Number(pop.version) : 1);

// Aprovado = existe aprovação E ela é da versão atual. Uma aprovação de
// versão anterior (dado antigo, edição em outro aparelho) não vale.
export function popAprovado(pop) {
  const ap = pop?.approval;
  if (!ap?.at || !ap?.by) return false;
  return (Number(ap.version) > 0 ? Number(ap.version) : 1) === versaoDoPop(pop);
}

export function aprovarPop(pop, session, now = Date.now()) {
  return {
    ...pop,
    approval: {
      by: session?.user?.name ?? '',
      role: session?.user?.role ?? '',
      at: new Date(now).toISOString(),
      version: versaoDoPop(pop),
    },
    updatedAt: new Date(now).toISOString(),
  };
}

const CAMPOS_DO_TEXTO = ['title', 'category', 'objective', 'steps', 'materials', 'frequency', 'responsible'];
const HISTORICO_MAX = 20;

// Nova versão com os campos editados. Se nada do texto mudou, devolve o POP
// como estava: salvar sem mudar não pode derrubar uma aprovação válida.
export function editarPop(pop, campos, session, now = Date.now()) {
  const mudou = CAMPOS_DO_TEXTO.some((k) => JSON.stringify(pop?.[k] ?? null) !== JSON.stringify(campos?.[k] ?? pop?.[k] ?? null));
  if (!mudou) return pop;
  const anterior = {
    version: versaoDoPop(pop),
    ...Object.fromEntries(CAMPOS_DO_TEXTO.map((k) => [k, pop?.[k] ?? null])),
    approval: pop?.approval ?? null,
    updatedBy: pop?.updatedBy ?? pop?.createdBy ?? null,
    updatedAt: pop?.updatedAt ?? pop?.createdAt ?? null,
  };
  return {
    ...pop,
    ...Object.fromEntries(CAMPOS_DO_TEXTO.filter((k) => campos?.[k] !== undefined).map((k) => [k, campos[k]])),
    version: versaoDoPop(pop) + 1,
    approval: null,
    history: [anterior, ...(pop?.history ?? [])].slice(0, HISTORICO_MAX),
    updatedBy: session?.user?.name ?? null,
    updatedAt: new Date(now).toISOString(),
  };
}

// Texto curto pra tela, pro PDF do POP e pro Dossiê.
export function descreverAprovacao(pop) {
  const v = versaoDoPop(pop);
  if (!popAprovado(pop)) return `Versão ${v} · aguardando aprovação`;
  const ap = pop.approval;
  const data = new Date(ap.at).toLocaleDateString('pt-BR');
  return `Versão ${v} · aprovado por ${ap.by}${ap.role ? ` (${ap.role})` : ''} em ${data}`;
}
