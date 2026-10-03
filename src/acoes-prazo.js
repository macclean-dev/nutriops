// ─────────────────────────────────────────────────────────────────────────────
// Prazo das ações corretivas (candidata 7 da pesquisa de 03/10).
//
// A ação corretiva sempre teve campo de prazo, e nada olhava pra ele: uma ação
// aberta com prazo vencido sumia do radar, porque a Prontidão (A1) só procura
// NÃO CONFORMIDADE SEM ação. Ação aberta e esquecida contava como resolvida
// pra todo efeito. Puro, sem I/O: a Central, a Prontidão e o resumo semanal da
// RT leem daqui.
//
// O prazo é uma DATA ('2026-10-03'), não um instante. Vale o dia inteiro: a
// ação só vence no dia seguinte ao prazo, no fuso de quem olha.
// ─────────────────────────────────────────────────────────────────────────────

import { hojeISO } from './compliance';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const meioDia = (iso) => new Date(`${iso}T12:00`).getTime();

// Dias de atraso de UMA ação. `null` quando não há o que cobrar: resolvida,
// sem prazo, prazo ilegível ou ainda dentro do prazo.
export function diasDeAtraso(acao, now = Date.now()) {
  if (!acao || acao.status === 'resolvida') return null;
  const prazo = String(acao.deadline ?? '').slice(0, 10);
  if (!DIA.test(prazo)) return null;
  const dias = Math.round((meioDia(hojeISO(now)) - meioDia(prazo)) / 86400000);
  return dias > 0 ? dias : null;
}

export function acoesVencidas(acoes, now = Date.now()) {
  return (acoes ?? []).filter((a) => diasDeAtraso(a, now) !== null);
}

// '2026-10-03' → '03/10/2026'. `new Date('2026-10-03')` é meia-noite em UTC,
// que no Brasil (UTC-3) cai no dia ANTERIOR: a Central mostrava o prazo um
// dia antes do gravado. Meio-dia local não tem esse problema.
export function formatarPrazo(deadline) {
  const prazo = String(deadline ?? '').slice(0, 10);
  if (!DIA.test(prazo)) return '-';
  return new Date(`${prazo}T12:00`).toLocaleDateString('pt-BR');
}
