// ─────────────────────────────────────────────────────────────────────────────
// Regras de validade pós-abertura — o motor das etiquetas (substituto do Suflex).
//
// A regra é POR CATEGORIA, configurada uma vez (aba "Regras" em Validades e
// Estoque), pra abertura de produto ser 1 clique na produção. O campo
// "Validade após abertura (dias)" do produto, quando preenchido, é uma
// exceção que vence a regra da categoria (ex.: um queijo específico que dura
// menos que o padrão de Laticínios).
//
// Unidade em HORAS existe porque carne descongelada trabalha com 48h, não
// "2 dias corridos" — a hora da manipulação importa.
// ─────────────────────────────────────────────────────────────────────────────

// Valores de fábrica — a RT ajusta na aba Regras (ficam no device).
export const DEFAULT_OPEN_RULES = {
  carnes:     { amount: 48,  unit: 'h' },
  laticinios: { amount: 5,   unit: 'd' },
  hortifruti: { amount: 3,   unit: 'd' },
  massas:     { amount: 5,   unit: 'd' },
  confeit:    { amount: 3,   unit: 'd' },
  bebidas:    { amount: 3,   unit: 'd' },
  congelados: { amount: 30,  unit: 'd' },
  secos:      { amount: 30,  unit: 'd' },
  limpeza:    { amount: 90,  unit: 'd' },
  outros:     { amount: 3,   unit: 'd' },
};

const rulesKey = (tenantId) => `nutriops.validity.rules.${tenantId}`;

export function readOpenRules(tenantId) {
  let stored = {};
  try {
    const raw = localStorage.getItem(rulesKey(tenantId));
    if (raw) stored = JSON.parse(raw) ?? {};
  } catch { /* regra de fábrica */ }
  const merged = {};
  for (const cat of Object.keys(DEFAULT_OPEN_RULES)) {
    const s = stored[cat];
    merged[cat] = (s && Number(s.amount) > 0 && (s.unit === 'h' || s.unit === 'd'))
      ? { amount: Number(s.amount), unit: s.unit }
      : DEFAULT_OPEN_RULES[cat];
  }
  return merged;
}

export function writeOpenRules(tenantId, rules) {
  try { localStorage.setItem(rulesKey(tenantId), JSON.stringify(rules)); } catch {}
}

// Exceção do produto vence a regra da categoria.
export function resolveOpenRule(product, rules) {
  const override = Number(product?.daysAfterOpen);
  if (override > 0) return { amount: override, unit: 'd', source: 'produto' };
  const cat = rules?.[product?.category] ?? rules?.outros ?? DEFAULT_OPEN_RULES.outros;
  return { ...cat, source: 'categoria' };
}

// Validade pós-abertura = abertura + regra, NUNCA além da validade original
// de fábrica (se o rótulo diz que vence antes, o rótulo vence).
export function computeOpenedUntil(openedAtIso, rule, expiryDate) {
  const opened = new Date(openedAtIso);
  if (Number.isNaN(opened.getTime())) return { until: null, clamped: false };
  const ms = rule.amount * (rule.unit === 'h' ? 3600000 : 86400000);
  let until = new Date(opened.getTime() + ms);
  let clamped = false;
  if (expiryDate) {
    const limit = new Date(`${expiryDate}T23:59:59`);
    if (!Number.isNaN(limit.getTime()) && until > limit) { until = limit; clamped = true; }
  }
  return { until: until.toISOString(), clamped };
}

export function fmtRule(rule) {
  if (!rule) return '—';
  return rule.unit === 'h' ? `${rule.amount} h` : `${rule.amount} dia${rule.amount === 1 ? '' : 's'}`;
}

export function fmtDateTime(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso ?? '—'; }
}
