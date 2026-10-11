// ─────────────────────────────────────────────────────────────────────────────
// Em quais turnos um equipamento é cobrado (proposta 4 da análise de produto,
// 10/10).
//
// Até aqui havia só duas opções: cobrado em todo turno, ou "só liga quando
// está em uso" (nunca cobrado, v1.9.233, o caso do ultracongelador U.3). A
// Bancada F.2 da CASA DOCE não cabe em nenhuma: liga de manhã e desliga à
// tarde (relato da RT, 06/10). Cobrada à tarde, vira alerta falso ou leitura
// de aparelho desligado registrada como desvio; marcada como intermitente,
// perde a cobrança da manhã, que é real.
//
// `turnosCobrados`: lista de ids de turno. Vazia ou ausente = todos (o padrão
// de sempre). Turno que não existe mais é ignorado; se não sobrar nenhum, o
// equipamento volta a ser cobrado em TODOS: a falha é cobrar a mais, nunca
// deixar de cobrar em silêncio porque alguém apagou um turno.
// ─────────────────────────────────────────────────────────────────────────────

export function turnosQueCobram(eq, turns) {
  const todos = (turns ?? []).filter((t) => t?.id);
  if (eq?.usoIntermitente === true) return [];
  const escolhidos = Array.isArray(eq?.turnosCobrados) ? eq.turnosCobrados : [];
  if (!escolhidos.length) return todos;
  const validos = todos.filter((t) => escolhidos.includes(t.id));
  return validos.length ? validos : todos;
}

export function cobradoNoTurno(eq, turn, turns) {
  return turnosQueCobram(eq, turns).some((t) => t.id === turn?.id);
}

// "Cobrado em: Manhã" / null quando é cobrado em todos (nada a destacar).
export function rotuloDosTurnos(eq, turns) {
  const todos = (turns ?? []).filter((t) => t?.id);
  const cobram = turnosQueCobram(eq, turns);
  if (!cobram.length || cobram.length === todos.length) return null;
  return `Cobrado em: ${cobram.map((t) => t.name).join(', ')}`;
}

// Leituras esperadas no dia: soma, equipamento a equipamento, dos turnos em
// que ele é cobrado (o KPI de cobertura contava todos × todos).
export function leiturasEsperadasNoDia(catalog, turns) {
  return (catalog ?? []).reduce((n, eq) => n + turnosQueCobram(eq, turns).length, 0);
}
