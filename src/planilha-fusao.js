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
export function respostaVazia(v) {
  if (v === undefined || v === null || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.every(respostaVazia);
  if (typeof v === 'object') return Object.values(v).every(respostaVazia);
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

// Mesma regra pro status. Sem base (a pessoa abriu a folha em branco ou está
// gravando uma via extra), "confirmada" vence "rascunho": um rascunho nunca
// rebaixa uma folha que outro aparelho já confirmou.
export function fundirStatus(baseStatus, meu, outro) {
  if (!outro) return meu;
  if (baseStatus === undefined || baseStatus === null) {
    return meu === 'submitted' || outro === 'submitted' ? 'submitted' : meu;
  }
  return meu !== baseStatus ? meu : outro;
}

const quando = (r) => new Date(r?.updatedAt ?? r?.createdAt ?? 0).getTime() || 0;

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
