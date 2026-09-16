// ─────────────────────────────────────────────────────────────────────────────
// Quanto histórico de temperatura o aparelho guarda.
//
// O teto antigo era por QUANTIDADE (5000 leituras) e partia de uma conta
// errada: "~300 bytes por leitura, então 1,5 MB". Medido na nuvem em 16/09, a
// leitura média tem ~540 caracteres (CASA DOCE: 2652 leituras, 1443 KB). E o
// Safari conta o armazenamento do site em bytes de UTF-16 (2 por caractere)
// dentro de uns 5 MB. 5000 leituras davam ~2,7 milhões de caracteres, ~5,4 MB
// no Safari: o teto sozinho já não cabia. O cache é GLOBAL (todas as lojas
// que o aparelho vê), então no Mac do dono ele encheu primeiro. Sintoma: faixa
// vermelha "armazenamento deste aparelho está cheio" em 16/09, 20:14.
//
// Agora o teto é por TAMANHO. A nuvem continua com tudo e é de lá que as telas
// leem quando estão online; este cache só serve pra quando a nuvem não
// responde. Duas semanas de todas as lojas cabem com folga no orçamento.
//
// O que NUNCA sai: leitura que ainda está na fila pra subir. Enquanto ela não
// chegou na nuvem, este aparelho é o único lugar onde ela existe na tela.
// ─────────────────────────────────────────────────────────────────────────────

// ~700 mil caracteres = ~1,4 MB no Safari. Deixa espaço pras planilhas, ASOs e
// o resto, que dividem os mesmos 5 MB.
export const ORCAMENTO_CARACTERES = 700_000;
export const MAXIMO_LEITURAS = 5000;

const tamanho = (r) => {
  try { return JSON.stringify(r).length; } catch { return 0; }
};

// `lista` já vem da mais nova pra mais antiga (quem chama ordena).
export function podarCacheTemperaturas(lista, {
  orcamento = ORCAMENTO_CARACTERES,
  maximo = MAXIMO_LEITURAS,
  pendentes = new Set(),
} = {}) {
  if (!Array.isArray(lista)) return [];
  const fica = [];
  let usado = 0;
  let cheio = false;
  for (const r of lista) {
    if (pendentes.has(r?.id)) { fica.push(r); usado += tamanho(r); continue; }
    if (cheio) continue;
    const t = tamanho(r);
    if (fica.length >= maximo || usado + t > orcamento) { cheio = true; continue; }
    fica.push(r);
    usado += t;
  }
  return fica;
}

// Ids de leitura de temperatura que ainda esperam na fila offline.
export function idsPendentes(fila) {
  const ids = new Set();
  for (const item of Array.isArray(fila) ? fila : []) {
    if (item?.table === 'temperature_records' && item?.payload?.id) ids.add(item.payload.id);
  }
  return ids;
}
