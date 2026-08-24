// ─────────────────────────────────────────────────────────────────────────────
// "Você quis dizer LAYZA CRISTINA PEREIRA LUSTOSA?"
//
// O seletor de operador oferece digitar o nome à mão quando a busca não acha
// ninguém (operator-picker.jsx) — saída necessária, senão a abertura de turno
// vira tela sem saída. Só que ela aceitava a grafia nova em SILÊNCIO, e o
// resultado apareceu no levantamento de 24/08 da CASA DOCE: 35 nomes distintos
// mediram temperatura em 7 dias, 31 não batiam com a lista da loja. A mesma
// pessoa vira "layza cristina", "LAYZA CRISTINA" e "LAYZA CRISTINA PEREIRA
// LUSTOSA" em registros diferentes.
//
// Isso não é cosmético: a RDC 216 exige saber QUEM fez cada aferição, e três
// grafias da mesma pessoa enfraquecem a rastreabilidade numa fiscalização.
//
// Este módulo não decide nada — só responde "tem alguém cadastrado parecido
// com isto?". Quem confirma é a pessoa, na tela. Puro de propósito: recebe a
// lista, não a busca.
// ─────────────────────────────────────────────────────────────────────────────

// Sem acento, sem caixa, sem espaço sobrando. É a forma em que "CRISÓSTOMO" e
// "crisostomo" viram a mesma coisa.
export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Palavras que valem pra comparação. Preposições ("de", "da", "dos") não
// distinguem ninguém e atrapalhariam a contagem; "3 letras ou menos" as tira
// junto com iniciais soltas.
function palavras(s) {
  return normalizar(s).split(' ').filter((t) => t.length > 2);
}

/**
 * Procura na equipe alguém que o texto digitado provavelmente É.
 *
 * A regra é deliberadamente CONSERVADORA — sugerir a pessoa errada é pior que
 * não sugerir: a leitura sairia carimbada em quem não mediu, que é falsear
 * evidência sanitária. Por isso só sugere quando TODAS as palavras do que foi
 * digitado aparecem no nome cadastrado ("Layza Cristina" ⊂ "Layza Cristina
 * Pereira Lustosa"), e só quando UMA única pessoa satisfaz isso.
 *
 * @returns {string|null} o nome cadastrado, ou null quando não dá pra afirmar
 */
export function nomeParecido(staff, digitado) {
  const alvo = palavras(digitado);
  if (alvo.length === 0) return null;

  const nomes = (staff ?? []).map((u) => (typeof u === 'string' ? u : u?.name)).filter(Boolean);

  // Já é exatamente alguém da lista (ignorando acento/caixa) — nada a sugerir.
  const exato = nomes.find((n) => normalizar(n) === normalizar(digitado));
  if (exato) return null;

  const candidatos = nomes.filter((n) => {
    const dele = palavras(n);
    return alvo.every((t) => dele.includes(t));
  });

  // Duas Marias Silva na equipe: escolher uma seria chutar a autoria de um
  // registro sanitário. Melhor deixar a pessoa digitar o nome completo.
  return candidatos.length === 1 ? candidatos[0] : null;
}
