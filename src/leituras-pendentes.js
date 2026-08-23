// ─────────────────────────────────────────────────────────────────────────────
// Leituras que a pessoa deu como feitas mas que NÃO chegaram na nuvem.
//
// Motivo (relato da RT da CASA DOCE, 23/08): "teve 2 dias seguidos, 17/08 e
// 18/08, com o preenchimento realizado na minha presença, corretamente, e o dia
// 17 já não consta no sistema". O quiosque fazia:
//
//     await repository.create(payload);
//     setSavedValues(prev => ({ ...prev, [active.label]: value }));
//
// e `create()` NUNCA lança. Quando o POST falha (offline, sessão sem credencial,
// RLS) ele salva local, enfileira e devolve `{ _pending: true }` — um objeto
// normal. O quiosque pintava o card de verde, somava no contador e no fim
// anunciava "Todos os registros concluídos!". A leitura ficava presa na fila
// DAQUELE aparelho. Na gelateria são 4 colaboradoras em 12x36, cada dia a
// aferição no celular de uma — o aparelho com a fila só volta 36h depois, e a
// nutricionista, olhando o dela, não vê nada.
//
// Este módulo lê a fila de saída e diz quem ainda não subiu. Puro de propósito:
// recebe a fila, não a busca — assim o teste cobre o formato real do item
// enfileirado (`{ table, operation, payload, _at }`, payload em snake_case).
// ─────────────────────────────────────────────────────────────────────────────

// Nome que a fila guarda pro equipamento. `tempToRow` grava os dois campos;
// `equipment_key` é o que casa com `catalog[].label` (o quiosque manda os dois
// iguais), e `equipment_input` fica de reserva pra linha vinda de outro caminho.
function nomeDoEquipamento(payload) {
  const bruto = payload?.equipment_key ?? payload?.equipment_input ?? '';
  return String(bruto).trim();
}

/**
 * @param fila     array de `getOfflineQueue()`
 * @param tenantId loja em foco; sem ele, devolve zero (nunca a fila inteira —
 *                 mostrar pendência de OUTRA loja no quiosque desta seria pior
 *                 que não mostrar nada)
 * @returns {{ total:number, equipamentos:string[], maisAntiga:string|null }}
 */
export function leiturasPendentes(fila, tenantId) {
  const vazio = { total: 0, equipamentos: [], maisAntiga: null };
  if (!tenantId || !Array.isArray(fila)) return vazio;

  const equipamentos = new Set();
  let total = 0, maisAntiga = null;

  for (const item of fila) {
    if (item?.table !== 'temperature_records') continue;
    if (item?.payload?.tenant_id !== tenantId) continue;
    total += 1;
    const nome = nomeDoEquipamento(item.payload);
    if (nome) equipamentos.add(nome);
    const at = item?._at;
    if (at && (maisAntiga === null || at < maisAntiga)) maisAntiga = at;
  }

  return { total, equipamentos: [...equipamentos], maisAntiga };
}

/**
 * Um card só pode ficar verde quando a leitura chegou na nuvem. Comparação por
 * nome normalizado porque o catálogo pode ter espaço/caixa diferente do que foi
 * enfileirado meses atrás.
 */
export function equipamentoPendente(pendentes, label) {
  const alvo = String(label ?? '').trim().toLowerCase();
  if (!alvo) return false;
  return (pendentes?.equipamentos ?? []).some((e) => String(e).trim().toLowerCase() === alvo);
}

/**
 * Texto humano pro aviso. Sem jargão: quem lê é a colaboradora no celular, não
 * o dono. "Enviar" e não "sincronizar" — ela não sabe o que é sincronizar.
 */
export function descreverPendencia(pendentes) {
  const n = pendentes?.total ?? 0;
  if (n <= 0) return null;
  return n === 1
    ? '1 leitura ainda não foi enviada — ela está salva só neste aparelho.'
    : `${n} leituras ainda não foram enviadas — elas estão salvas só neste aparelho.`;
}
