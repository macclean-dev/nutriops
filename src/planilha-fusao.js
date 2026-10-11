// ─────────────────────────────────────────────────────────────────────────────
// Duas pessoas, dois aparelhos, a MESMA planilha no mesmo período (09/10).
//
// Relato da RT da CASA DOCE (Terraço): "planilha com itens já dados como
// feitos, no outro dia aparece como não feito". Causa: salvar uma planilha
// manda o `responses` INTEIRO, e a nuvem guarda o último a salvar
// (upsert por tenant_id+form_id+period_key). Um computador aberto desde cedo
// tem a cópia da manhã; quem marca um item nele e salva apaga, sem saber, o
// que o tablet marcou à tarde. E um "Salvar rascunho" em cima de uma folha que
// outro aparelho já confirmou fazia a folha voltar a "não feita".
//
// A fusão é de três pontas, campo a campo:
//   · base   = o que a pessoa viu ao ABRIR a planilha;
//   · minhas = o que ela tem na tela ao salvar;
//   · outra  = a versão mais nova que existe agora (nuvem, senão o aparelho).
// Campo que a pessoa mudou (minhas ≠ base) é dela e vence. Campo que ela não
// tocou fica com a outra versão, que pode ter sido preenchido em outro
// aparelho. Assim desmarcar de propósito continua funcionando (é mudança
// dela), e o que ela nem viu não é apagado.
// ─────────────────────────────────────────────────────────────────────────────

// Vazio pra efeito de comparação: campo nunca tocado (undefined), apagado
// (''), checkbox desmarcado (false), lista ou carimbo sem nada dentro.
//
// Exceção: o campo de presença (pragas etc.) guarda `{ detected: false }`
// para "✓ Sem ocorrência". Isso é RESPOSTA, não vazio (mesma regra de
// isPresenceAnswered, forms.jsx). Sem a exceção, a fusão tratava "Sem
// ocorrência" como campo em branco e o descartava em conflito (revisão
// adversarial, 10/10).
export function respostaVazia(v) {
  if (v === undefined || v === null || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.every(respostaVazia);
  if (typeof v === 'object') {
    if (typeof v.detected === 'boolean') return false;
    return Object.values(v).every(respostaVazia);
  }
  return false;
}

const mesmaResposta = (a, b) =>
  (respostaVazia(a) && respostaVazia(b)) || JSON.stringify(a) === JSON.stringify(b);

export function fundirRespostas(base, minhas, outra) {
  const b = base ?? {}, m = minhas ?? {}, o = outra ?? {};
  const resultado = {};
  for (const k of new Set([...Object.keys(m), ...Object.keys(o)])) {
    if (!mesmaResposta(m[k], b[k])) resultado[k] = m[k];
    else if (k in o) resultado[k] = o[k];
    else resultado[k] = m[k];
  }
  return resultado;
}

// Status: "confirmada" é definitiva. Salvar rascunho em cima de uma folha
// que já foi confirmada (por quem salva, quando abriu, ou por outro aparelho
// nesse meio tempo) guarda as mudanças e a mantém confirmada. Decisão do dono
// (10/10), depois da revisão adversarial: a RT abre uma folha confirmada no
// computador pra acrescentar uma observação, toca "Salvar rascunho" por
// hábito, e a folha voltava a "não feita" em todos os aparelhos e na
// Prontidão. Era um dos caminhos do relato do Terraço.
export function fundirStatus(baseStatus, meu, outro) {
  return meu === 'submitted' || outro === 'submitted' || baseStatus === 'submitted' ? 'submitted' : meu;
}

// A assinatura da RT (`validation`) sobrevive a um salvamento que não mudou
// o conteúdo validado: abrir e salvar de novo, ou salvar só o que outro
// aparelho já tinha. Se o conteúdo mudou, ela cai e a folha volta pra fila de
// validação: a RT assinou o que viu, não o que veio depois (revisão
// adversarial, 10/10; antes qualquer salvamento apagava a assinatura).
export function validacaoQueSobrevive(respostasFinais, outra) {
  if (!outra?.validation) return null;
  return mesmasRespostas(respostasFinais, outra.responses) ? outra.validation : null;
}

function mesmasRespostas(a, b) {
  const x = a ?? {}, y = b ?? {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (!mesmaResposta(x[k], y[k])) return false;
  }
  return true;
}

const quando = (r) => new Date(r?.updatedAt ?? r?.createdAt ?? 0).getTime() || 0;

// ─── Reenvio da fila (revisão adversarial, 10/10) ───────────────────────────
// A fusão acima só acontecia no salvamento ONLINE. A planilha salva sem rede
// ia pra fila como o retrato do aparelho naquela hora e, ao reconectar,
// subia por cima de tudo: o que outro aparelho preencheu depois e a
// assinatura da RT sumiam da nuvem. Aqui a linha da fila (formato do banco,
// snake_case) é fundida com a linha que está na nuvem antes de subir.
//
// Sem base conhecida, então base vazia: o que a fila tem preenchido vale,
// o que está em branco nela fica com a nuvem. `updated_at` vira agora, pra
// os outros aparelhos enxergarem a mudança no sync de 2 min (que olha as
// últimas 48h); o id é o da nuvem, pra não reescrever a chave da linha.
export function fundirLinhaDaFila(daFila, daNuvem, agoraIso = new Date().toISOString()) {
  if (!daNuvem) return daFila;
  const responses = fundirRespostas({}, daFila.responses, daNuvem.responses);
  const validation = daFila.validation
    ?? validacaoQueSobrevive(responses, { responses: daNuvem.responses, validation: daNuvem.validation });
  return {
    ...daFila,
    id: daNuvem.id ?? daFila.id,
    responses,
    status: fundirStatus(undefined, daFila.status, daNuvem.status),
    validation: validation ?? null,
    created_at: daNuvem.created_at ?? daFila.created_at,
    updated_at: agoraIso,
  };
}

// A versão mais nova entre as candidatas (nuvem e aparelho).
export function maisRecente(...registros) {
  return registros.filter(Boolean).reduce((a, r) => (!a || quando(r) > quando(a) ? r : a), null);
}

// Um registro por (planilha, período), o mais novo. A nuvem já garante isso
// (unique tenant_id+form_id+period_key), mas o aparelho podia guardar dois:
// o que ele criou com um id e o que o sync trouxe com outro. A tela pegava o
// primeiro da lista, às vezes a cópia velha, e mostrava itens feitos como
// pendentes.
// Mantém a ordem original da lista; só tira as cópias perdedoras.
export function umPorPeriodo(records) {
  const lista = records ?? [];
  const chave = (r) => (r?.formId && r?.periodKey ? `${r.formId}::${r.periodKey}` : null);
  const vencedor = new Map();
  for (const r of lista) {
    const k = chave(r);
    if (k === null) continue;
    const atual = vencedor.get(k);
    if (!atual || quando(r) > quando(atual)) vencedor.set(k, r);
  }
  return lista.filter((r) => { const k = chave(r); return k === null || vencedor.get(k) === r; });
}
