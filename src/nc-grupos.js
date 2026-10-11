// ─────────────────────────────────────────────────────────────────────────────
// Central de não conformidades agrupada (proposta 2 da análise de produto,
// 10/10).
//
// Relato da RT da CASA DOCE (06/10): as ações dos desvios de agosto "ela não
// vê". A lista era plana, do mais novo para o mais antigo e cortada em 15
// com "Ver os outros N": os 7 desvios da Bancada F.2 (12 a 14/08) ficavam
// atrás do corte, e cada um pedia uma ação separada. Enquanto não têm ação, o
// check A1 da Prontidão deixa a loja EM RISCO.
//
// Agora a lista é agrupada por origem + equipamento/planilha ("Bancada F.2:
// 7 desvios, de 12/08 a 14/08"), com o grupo mais ANTIGO primeiro (é o que
// foi esquecido), e dá para abrir UMA ação para o grupo inteiro: o app cria
// uma ação por ocorrência, todas com a mesma descrição, responsável e prazo.
// Assim nada muda no banco (corrective_actions continua uma linha por
// sourceId) e excludeWithAction segue tirando cada uma da lista.
// ─────────────────────────────────────────────────────────────────────────────

const ts = (item) => new Date(item?.at ?? 0).getTime() || 0;

export function agruparPendencias(itens) {
  const porChave = new Map();
  for (const item of itens ?? []) {
    const chave = `${item.source}::${item.sourceLabel ?? 'Sem nome'}`;
    if (!porChave.has(chave)) porChave.set(chave, { chave, source: item.source, sourceLabel: item.sourceLabel ?? 'Sem nome', itens: [] });
    porChave.get(chave).itens.push(item);
  }
  const grupos = [...porChave.values()].map((g) => {
    const itensOrdenados = [...g.itens].sort((a, b) => ts(a) - ts(b));
    return { ...g, itens: itensOrdenados, inicio: itensOrdenados[0]?.at ?? null, fim: itensOrdenados.at(-1)?.at ?? null };
  });
  return grupos.sort((a, b) => ts({ at: a.inicio }) - ts({ at: b.inicio }));
}

// Filtros da tela. `dias` null = todo o período; `busca` procura no nome do
// equipamento/planilha, sem acento e sem caixa.
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filtrarPendencias(itens, { origem = 'all', dias = null, busca = '', agora = Date.now() } = {}) {
  const corte = dias ? agora - dias * 86400000 : null;
  const termo = semAcento(busca).trim();
  return (itens ?? []).filter((i) =>
    (origem === 'all' || i.source === origem)
    && (corte === null || ts(i) >= corte)
    && (!termo || semAcento(i.sourceLabel).includes(termo)));
}

const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');

// "7 ocorrências, de 12/08 a 14/08" / "1 ocorrência, em 12/08"
export function resumoDoGrupo(grupo) {
  const n = grupo?.itens?.length ?? 0;
  const ini = dia(grupo?.inicio), fim = dia(grupo?.fim);
  const quando = !ini ? '' : ini === fim ? `, em ${ini}` : `, de ${ini} a ${fim}`;
  return `${n} ocorrência${n === 1 ? '' : 's'}${quando}`;
}

// Uma ação por ocorrência do lote, todas com o mesmo texto, responsável e
// prazo. `novoId` injetável para teste.
export function acoesDoLote(itens, { tenantId, description, responsible, deadline, agoraIso = new Date().toISOString(), novoId = () => crypto.randomUUID() }) {
  return (itens ?? []).map((item) => ({
    id: novoId(), tenantId,
    source: item.source, sourceId: item.sourceId,
    sourceLabel: item.sourceLabel, sourceDetail: item.sourceDetail,
    description, responsible, deadline, status: 'aberta', resolution: '',
    createdAt: agoraIso, updatedAt: agoraIso,
  }));
}
