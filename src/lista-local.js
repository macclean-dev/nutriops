// ─────────────────────────────────────────────────────────────────────────────
// Listas locais que TAMBÉM recebem dado do sync.
//
// Achado nº1 da auditoria de falha silenciosa (18/08), com perda de dado. O
// padrão estava repetido em 5 telas:
//
//     useEffect(() => { setRecords(readOil(id)); }, [id]);          // lê no mount
//     useEffect(() => { writeOil(id, records); }, [id, records]);   // regrava TUDO
//
// A tela lê o localStorage uma vez, na montagem. Depois o sync grava ali os
// registros que vieram da nuvem — mas o `records` da tela continua o de antes.
// No próximo registro que a pessoa fizer, o segundo efeito regrava a lista
// ANTIGA por cima, e o que o sync trouxe desaparece do aparelho.
//
// Duas falhas somadas, as duas mudas:
//   · a tela nunca relê depois do sync (mostra vazio, ou parado no antigo);
//   · e ainda apaga o que o sync trouxe, na primeira interação.
//
// A correção é dos dois lados: gravar MESCLANDO com o que está no storage
// naquele instante, e reler quando o sync avisar que terminou.
//
// ⚠️ Só vale pra lista SÓ-ACRÉSCIMO (óleo, descongelamento, resfriamento,
// tratamento térmico, higienização das mãos). Onde existe exclusão — POPs — a
// mescla ressuscitaria o que a pessoa apagou; ver achado 77 da auditoria, que
// é outro conserto.
// ─────────────────────────────────────────────────────────────────────────────

export const SYNC_EVENT = 'nutriops:sync-aplicado';

// Avisa as telas abertas de que o localStorage mudou por baixo delas.
export function notificarSyncAplicado(detalhe) {
  try { window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: detalhe ?? {} })); } catch {}
}

// União por chave, mantendo a versão mais recente de cada item e a ordem
// cronológica decrescente (é como todas essas telas exibem).
export function mesclarPorChave(listas, chave = 'id') {
  const mapa = new Map();
  let semChave = [];
  for (const lista of listas) {
    for (const item of (Array.isArray(lista) ? lista : [])) {
      if (!item || typeof item !== 'object') continue;
      const k = item[chave];
      if (k == null || k === '') { semChave.push(item); continue; }  // sem id: não dá pra deduplicar, preserva
      const atual = mapa.get(k);
      if (!atual || quando(item) >= quando(atual)) mapa.set(k, item);
    }
  }
  return [...mapa.values(), ...semChave].sort((a, b) => quando(b) - quando(a));
}

function quando(item) {
  const t = new Date(item?.updatedAt ?? item?.createdAt ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Grava a lista da tela SEM apagar o que chegou por outro caminho desde a
// última leitura. Devolve a lista efetivamente gravada.
export function gravarMesclando(read, write, tenantId, listaDaTela, chave = 'id') {
  const noStorage = read(tenantId);
  const mesclada = mesclarPorChave([listaDaTela, noStorage], chave);
  write(tenantId, mesclada);
  return mesclada;
}
