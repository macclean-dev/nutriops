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

// Limite CADASTRADO de verdade, ou null. `Number.isFinite(Number(x))` sozinho
// não serve: `Number(null)` e `Number('')` são 0 — os dois passam como se
// fossem um limite válido de zero grau. Foi assim que um Freezer cadastrado
// com mínimo 12 e máximo VAZIO virou a faixa "entre 12 e 0" (impossível de
// satisfazer: nenhuma leitura consegue ser conforme) em vez de cair na
// heurística de freezer. Achado em produção na Swiss, 20/08 — mesma família
// de coerção do `null <= 3` que o painel admin tinha. Campo vazio significa
// "não cadastrado", e não-cadastrado é exatamente o caso pra heurística.
function limiteCadastrado(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Resolve faixa min/max dado um label e contexto opcional:
//   - 2º arg = array (catálogo de equipamentos) → busca por label/alias
//   - 2º arg = objeto único de equipamento → usa seu minTemp/maxTemp direto
//   - 2º arg ausente → cai na heurística pelo nome
// Faixa PELA METADE (só min ou só max) também cai na heurística: meia faixa
// não julga leitura nenhuma com sentido, e o palpite pelo nome erra menos.
export function resolveLimits(label = '', context = null) {
  // Caso 1: equipment object passado direto
  if (context && !Array.isArray(context) && typeof context === 'object') {
    const mn = limiteCadastrado(context.minTemp);
    const mx = limiteCadastrado(context.maxTemp);
    if (mn !== null && mx !== null) return { min: mn, max: mx };
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
    if (hit) {
      const mn = limiteCadastrado(hit.minTemp);
      const mx = limiteCadastrado(hit.maxTemp);
      if (mn !== null && mx !== null) return { min: mn, max: mx };
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

// Mesma conta, recebendo o registro salvo direto (já carrega value/min/max) —
// item 7 da revisão de produto (09/08): esta fórmula vivia copiada
// (byte-a-byte idêntica) em pages.jsx, reports-views.jsx e reports.jsx.
// Uma só, aqui, pra sempre bater o mesmo número em toda tela.
export function resolveRecordTone(record) {
  return resolveTone(record?.value, record?.min, record?.max);
}

// Conformidade de um equipamento a partir das leituras dele no período.
// Extraída de dentro da ChartsView (onde vivia inline) pra poder ORDENAR a
// lista por ela — pedido da RT da CASA DOCE (15/08): com 40+ equipamentos,
// achar quem está fora de conformidade virou caça ao tesouro.
// `pct` é null (não 0) quando não houve leitura: "sem medição" não é 0% de
// conformidade, é ausência de dado — categoria diferente, tratada à parte.
export function conformityStats(records = []) {
  let ok = 0, warn = 0, danger = 0;
  for (const r of records) {
    const t = resolveRecordTone(r);
    if (t === 'ok') ok++;
    else if (t === 'warn') warn++;
    else if (t === 'danger') danger++;
  }
  const total = records.length;
  return { total, ok, warn, danger, pct: total > 0 ? Math.round((ok / total) * 100) : null };
}

// Ordena "pior primeiro" pra quem está caçando problema. Equipamento sem
// leitura nenhuma vai pro FIM de propósito: não é o pior em conformidade, é
// outro problema (ninguém mediu), e esse já é cobrado pelos alertas de turno.
export function byWorstConformity(a, b) {
  if (a.pct === null && b.pct === null) return 0;
  if (a.pct === null) return 1;
  if (b.pct === null) return -1;
  if (a.pct !== b.pct) return a.pct - b.pct;
  return b.danger - a.danger;   // empate no %: mais críticos primeiro
}

// "Faltou o sinal de menos?" — bug real relatado pela nutricionista da CASA
// DOCE em 14/08: ela digitava -18 num freezer (faixa -25/-18) e o registro
// saía +18, para TODOS os equipamentos de congelamento.
//
// CAUSA: `inputMode="decimal"` não oferece tecla de menos no teclado de
// celular/tablet (nem iOS nem boa parte do Android). Fisicamente não dava pra
// digitar o negativo. O guard que existia era um window.confirm genérico
// ("confira se não é erro de digitação") — dá pra dispensar no reflexo, e foi
// o que aconteceu 5 vezes seguidas.
//
// Esta função identifica o caso com precisão, em vez de só desconfiar de
// "valor alto": só acusa quando o equipamento NÃO aceita positivo (max < 0),
// o valor digitado está fora de faixa, e o mesmo valor NEGADO seria aceitável.
// Um freezer realmente quebrado a +5°C (faixa -25/-18) não cai aqui: -5
// continuaria fora de faixa, então não é erro de sinal — é desvio real.
// Lê temperatura digitada aceitando vírgula decimal. O teclado numérico do
// celular em pt-BR entrega "3,4", e Number("3,4") é NaN — o rascunho contava
// no botão, não era gravado, e sumia no fim da gravação (achado nº10 da
// auditoria de falha silenciosa, 18/08). Devolve NaN pro que realmente não é
// número, pra quem chama poder avisar em vez de descartar calado.
export function parseTemperatura(v) {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim().replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t === '-.') return NaN;
  return Number(t);
}

// Dias corridos entre HOJE e a data — meia-noite com meia-noite. Vivia em
// validity.jsx; movido pra cá (18/08) porque pages.jsx precisava dela pro
// badge de Validades no menu, e um import estático de validity.jsx puxa o
// módulo INTEIRO (componentes React, geração de PDF, leitor de QR) pro bundle
// principal — +161KB carregado em todo login pra usar uma função de 4 linhas.
// `limits.js` é puro e já é importado eager por pages.jsx, então não pesa nada
// a mais aqui.
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr + 'T00:00').getTime() - new Date().setHours(0,0,0,0);
  return Math.round(diff / 86400000);
}

// Conta produtos "problema" (vencidos OU vencendo em 7 dias) — a mesma
// definição que a tela de Validades usa nos cards "Vencendo em 7 dias" +
// "Vencidos" somados. Existia reimplementada 3 VEZES em pages.jsx (RailNav,
// MobileDrawer, BottomNav) com uma fórmula antiga e quebrada (Math.ceil de
// T12:00 contra T00:00, o mesmo off-by-one que daysUntil corrigiu em
// validity.jsx) e ignorando `openedUntil` (validade pós-abertura). As três
// cópias iam divergir umas das outras E do que a tela de Validades mostra —
// é a família de bug desta auditoria (badge ≠ tela). Achado 18/08.
export function contarValidadesEmAlerta(products) {
  return (products ?? []).filter((p) => {
    const efetiva = p.openedUntil ? p.openedUntil.slice(0, 10) : p.expiryDate;
    if (!efetiva) return false;
    const days = daysUntil(efetiva);
    return days !== null && (days < 0 || days <= 7);
  }).length;
}

export function suspectMissingMinus(value, min, max) {
  const v = Number(value), mn = Number(min), mx = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(mn) || !Number.isFinite(mx)) return false;
  if (v <= 0) return false;   // já veio negativo (ou zero): nada a sugerir
  if (mx >= 0) return false;  // faixa aceita positivo — +18 pode ser leitura real
  if (resolveTone(v, mn, mx) !== 'danger') return false;   // como está já serve
  return resolveTone(-v, mn, mx) !== 'danger';             // negado, vira plausível
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
  const porIdentidade = new Map();   // alias+local+faixa → índice em `out`
  const out = [];
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  for (const item of catalog) {
    const key = norm(item?.label);
    if (key && seen.has(key)) continue; // já vi esse label (não-vazio) — pula
    if (key) seen.add(key);

    // Rede contra RENOMEAÇÃO (CASA DOCE, 18/08): a linha na nuvem é
    // identificada por (loja, label) e não tem id próprio. Renomear
    // "Banho-maria — BM.1" pra "Banho-maria (Refeitório) — BM.1" criava linha
    // nova e deixava a velha órfã — o mesmo equipamento aparecia duas vezes.
    // Corrigido na origem (o editor apaga o label antigo); isto aqui limpa a
    // sujeira que já está na nuvem, inclusive a pendência antiga da Swiss.
    //
    // A identidade é o ALIAS (o código do equipamento: "BM.1"), mas exigindo
    // TAMBÉM local e faixa iguais. Só o alias seria frouxo demais: dois
    // equipamentos distintos podem compartilhar apelido por descuido, e aí
    // sumiria um da lista — trocar duplicata por desaparecimento é pior.
    const aliases = Array.isArray(item?.aliases) ? item.aliases.map(norm).filter(Boolean) : [];
    const assinatura = aliases.length
      ? `${aliases.slice().sort().join('|')}::${norm(item?.location)}::${item?.minTemp ?? ''}::${item?.maxTemp ?? ''}`
      : null;
    if (assinatura && porIdentidade.has(assinatura)) continue;
    if (assinatura) porIdentidade.set(assinatura, out.length);

    out.push(item);
  }
  return out;
}

// Casa o texto digitado (case-insensitive, por label OU alias) contra um
// equipamento já cadastrado — sem bater, devolve o texto como veio. Extraído
// de pages.jsx (registro de temperatura) pra ser reaproveitado em qualquer
// campo "Equipamento" de texto livre (controls.jsx) sem duplicar a lógica de
// casamento — "Fritadeira 1" e "fritadeira1" viram o MESMO label cadastrado
// em vez de fragmentar o histórico em registros separados pro mesmo equipamento.
export function normalizeEquipmentName(input, catalog = []) {
  const raw = String(input ?? '').trim(), lower = raw.toLowerCase();
  for (const item of catalog) {
    if (item.label.toLowerCase() === lower) return item.label;
    if (item.aliases?.some((a) => a.toLowerCase() === lower)) return item.label;
  }
  return raw || 'Equipamento sem nome';
}

// DUAS PASSADAS de propósito: o nome EXATO de um equipamento sempre vence o
// APELIDO de outro. A versão de uma passada só percorria o catálogo testando
// "label ou apelido" item a item, então o primeiro da lista com aquele apelido
// vencia — e a CASA DOCE tem o mesmo apelido em duas linhas ("R.2" na Padaria
// e na Confeitaria, "R.12" no Refeitório e no Setor Salgados). O equipamento
// que aparecia antes na lista sequestrava a leitura do outro.
export function getEquipmentEntry(catalog = [], label = '') {
  const lower = String(label ?? '').trim().toLowerCase();
  if (!lower) return null;
  const porNome = (catalog ?? []).find((item) => String(item?.label ?? '').trim().toLowerCase() === lower);
  if (porNome) return porNome;
  return (catalog ?? []).find((item) =>
    Array.isArray(item?.aliases) && item.aliases.some((a) => String(a ?? '').trim().toLowerCase() === lower)) ?? null;
}

// "Esta leitura é deste equipamento?" — a pergunta que as telas faziam
// comparando NOME COM NOME (`r.equipmentInput === eq.label`), sem olhar
// apelido nenhum.
//
// POR QUE ISSO ERA UM BUG (CASA DOCE, 21/08): renomear um equipamento no app
// não mexe nas leituras já gravadas — elas guardam o nome ANTIGO em
// equipment_key/equipment_input. Com casamento exato, o histórico inteiro
// somia do card no instante do rename. Caso real: "Banho-maria — BM.1" virou
// "Banho-maria (Refeitório) — BM.1" e o equipamento passou a mostrar "sem
// leitura" mesmo sendo medido todo dia. Pior: o próprio app SUGERE esse
// rename ("Use um nome que os diferencie, ex.: 'X — Padaria'") quando barra
// nome duplicado — ou seja, seguir o conselho da tela apagava a evidência da
// tela. A RT registrou como "o preenchimento foi realizado e não constou".
//
// Resolve pelo catálogo INTEIRO e compara o resultado, em vez de casar nome
// com nome: assim uma leitura pertence a UM equipamento só, mesmo com apelido
// repetido entre setores — se casasse direto, a leitura de "R.2" apareceria
// no card da Padaria E no da Confeitaria, dobrando evidência sanitária.
export function recordBelongsTo(catalog, record, equipment) {
  const alvo = String(equipment?.label ?? '').trim().toLowerCase();
  if (!alvo) return false;
  for (const nome of [record?.equipmentInput, record?.equipmentKey, record?.equipment]) {
    const bruto = String(nome ?? '').trim();
    if (!bruto) continue;
    if (bruto.toLowerCase() === alvo) return true;
    const entry = getEquipmentEntry(catalog, bruto);
    if (entry && String(entry.label).trim().toLowerCase() === alvo) return true;
  }
  return false;
}
