// Resolução de faixa de temperatura permitida por equipamento.
// Prioridade:
//   1) min/max cadastrados no equipamento (catálogo)
//   2) heurística pelo nome (freezer/congel → -25/-18, resto → 0/9)
//
// Compartilhado entre overview-v2.jsx, controls.jsx, kiosk.jsx, pages.jsx,
// admin.jsx (health view).

// Heurística básica usada como fallback quando o catálogo não tem min/max
export function heuristicLimits(label = '') {
  const l = String(label).toLowerCase();
  if (l.includes('freezer') || l.includes('congel') || l.includes('congelada'))
    return { min: -25, max: -18 };
  return { min: 0, max: 9 };
}

// Resolve faixa min/max dado um label e contexto opcional:
//   - 2º arg = array (catálogo de equipamentos) → busca por label/alias
//   - 2º arg = objeto único de equipamento → usa seu minTemp/maxTemp direto
//   - 2º arg ausente → cai na heurística pelo nome
export function resolveLimits(label = '', context = null) {
  // Caso 1: equipment object passado direto
  if (context && !Array.isArray(context) && typeof context === 'object') {
    const mn = Number(context.minTemp);
    const mx = Number(context.maxTemp);
    if (Number.isFinite(mn) && Number.isFinite(mx)) return { min: mn, max: mx };
  }
  // Caso 2: catálogo (array) — busca por label exato ou alias
  if (Array.isArray(context) && context.length) {
    const norm = String(label).toLowerCase().trim();
    const hit = context.find(eq => {
      const l = String(eq.label || '').toLowerCase().trim();
      if (l === norm) return true;
      const aliases = Array.isArray(eq.aliases) ? eq.aliases : [];
      return aliases.some(a => String(a).toLowerCase().trim() === norm);
    });
    if (hit && Number.isFinite(Number(hit.minTemp)) && Number.isFinite(Number(hit.maxTemp))) {
      return { min: Number(hit.minTemp), max: Number(hit.maxTemp) };
    }
  }
  // Fallback: heurística pelo nome
  return heuristicLimits(label);
}

// Tone (ok/warn/danger) dado um valor e a faixa.
export function resolveTone(value, min, max) {
  const v = Number(value), mn = Number(min), mx = Number(max);
  if (isNaN(v) || isNaN(mn) || isNaN(mx)) return 'neutral';
  if (v >= mn && v <= mx) return 'ok';
  if (v >= mn - 3 && v <= mx + 3) return 'warn';
  return 'danger';
}

// Sugestão automática pela inteligência do nome — usado pelo formulário de
// cadastro de equipamento pra pré-preencher os campos quando o usuário digita
// "Freezer" ou similar.
export function suggestLimits(label = '') {
  return heuristicLimits(label);
}

// Remove equipamentos duplicados por label (case/espaço-insensitive), mantendo
// a 1ª ocorrência. Catálogos vindos da nuvem às vezes têm o mesmo equipamento
// 2x (ex.: recadastrado com caixa diferente) — bug observado na Swiss, onde
// "ADEGA DE VINHOS" e "Balcão Refrigerado cozinha" apareciam 2x na lista de
// pendências. Sem dedup, cada dupe gera um alerta de turno extra. Pura e
// testável — aplicada onde o catálogo é resolvido (equipmentCatalog em pages).
export function dedupeCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];
  const seen = new Set();
  const out = [];
  for (const item of catalog) {
    const key = String(item?.label ?? '').trim().toLowerCase();
    if (key && seen.has(key)) continue; // já vi esse label (não-vazio) — pula
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}
