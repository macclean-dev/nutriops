// ─────────────────────────────────────────────────────────────────────────────
// Preferências de organização das planilhas BPF, POR LOJA.
//
// Pedido da RT da CASA DOCE (18/08): renomear a aba "Faxina" para "Serviços
// gerais" e tirar dali as planilhas de Hortifrutícolas e de Lavagem do Filtro
// de Café. É o TERCEIRO pedido dessa natureza em um mês — antes vieram a lista
// de setores (07/08) e as tarefas/opções das planilhas (10/08). Os dois viraram
// edição no app e pararam de voltar; este ia voltar também.
//
// POR QUE POR LOJA: "Faxina" é a mesma categoria na Swiss, Bäckerei e DBK.
// Renomear no código imporia o vocabulário da CASA DOCE a três clientes que não
// pediram nada.
//
// ONDE MORA: dentro do blob `company_profile`, que já sincroniza por loja e já
// tem RLS rodada — assim isto não exige mais um SQL antes do deploy (o projeto
// já carrega três pendências desse tipo). É um pouco de invasão semântica: o
// blob é "perfil do estabelecimento". A alternativa era uma tabela nova, e o
// custo dela recai no dono, não no código. Um teste trava o risco real dessa
// escolha — que a tela de perfil sobrescreva estas chaves ao salvar.
// ─────────────────────────────────────────────────────────────────────────────

const VAZIO = { categoryLabels: {}, templateCategory: {}, templateMeta: {} };

// Frequências que o app sabe agrupar (getPeriodKey/formatPeriodLabel em
// forms.jsx). Qualquer outra viraria período sem rótulo.
export const FREQUENCIAS = [
  ['daily',      'Diária'],
  ['weekly',     'Semanal'],
  ['biweekly',   'Quinzenal'],
  ['monthly',    'Mensal'],
  ['semiannual', 'Semestral'],
];

export function normalizePrefs(bruto) {
  const p = bruto ?? {};
  return {
    categoryLabels:   (p.categoryLabels   && typeof p.categoryLabels   === 'object') ? { ...p.categoryLabels }   : {},
    templateCategory: (p.templateCategory && typeof p.templateCategory === 'object') ? { ...p.templateCategory } : {},
    templateMeta:     (p.templateMeta     && typeof p.templateMeta     === 'object') ? { ...p.templateMeta }     : {},
  };
}

export function prefsFromProfile(profile) {
  return normalizePrefs(profile?.formPrefs);
}

// Mescla NÃO destrutiva: o perfil chega inteiro e volta inteiro, com formPrefs
// trocado. Escrever só {formPrefs} apagaria alvará, CNPJ e o resto.
export function profileWithPrefs(profile, prefs) {
  return { ...(profile ?? {}), formPrefs: normalizePrefs(prefs) };
}

// ─── Rótulo da aba ──────────────────────────────────────────────────────────
// Rótulo vazio ou só espaço volta pro padrão: apagar o campo é como a pessoa
// desfaz, e gravar '' deixaria a aba sem nome nenhum.
export function catLabelFor(catId, prefs, padrao) {
  const custom = String(prefs?.categoryLabels?.[catId] ?? '').trim();
  return custom || padrao;
}

// ─── Em qual aba a planilha aparece ─────────────────────────────────────────
// `higienizacao` é a ÚNICA categoria com comportamento: templateSector() deriva
// o setor do TÍTULO ("Higienização — Padaria"). Mover coisa pra dentro dela
// criaria uma folha sem setor no meio das 21, e mover uma das 21 pra fora
// tiraria o setor dela do filtro. Nos dois casos a quebra é silenciosa — a
// família de bug que este projeto passou a semana matando.
export const CATEGORIA_COM_COMPORTAMENTO = 'higienizacao';

// O TÍTULO das 21 folhas de Higienização é dado, não rótulo: templateSector()
// deriva o setor dele ("Higienização — Padaria" → "Padaria"). Renomear quebra
// o filtro por setor em silêncio — a mesma razão pela qual elas não mudam de
// aba. Descrição e frequência dessas continuam editáveis.
export function podeEditarTitulo(template) {
  if (template?.category !== CATEGORIA_COM_COMPORTAMENTO) return { ok: true };
  return { ok: false, motivo: 'O setor desta planilha vem do título dela (ex.: "Higienização — Padaria"). Renomear tiraria ela do filtro por setor.' };
}

export function podeMoverPara(template, destino) {
  const origem = template?.category;
  if (!destino || destino === origem) return { ok: true };
  if (destino === CATEGORIA_COM_COMPORTAMENTO) {
    return { ok: false, motivo: 'A aba de Higienização é organizada por setor, e o setor vem do título da planilha (ex.: "Higienização — Padaria"). Uma planilha movida pra cá ficaria sem setor.' };
  }
  if (origem === CATEGORIA_COM_COMPORTAMENTO) {
    return { ok: false, motivo: 'Esta planilha faz parte do conjunto por setor da Higienização. Tirá-la daqui a removeria do filtro por setor.' };
  }
  return { ok: true };
}

// Aplica as preferências na lista lida do seed/cache. Pura: a lista de entrada
// não é modificada, e movimento proibido é IGNORADO (defesa: preferência antiga
// gravada antes de uma trava nova não pode quebrar a tela).
export function applyCategoryPrefs(templates, prefs) {
  const p = normalizePrefs(prefs);
  const validas = new Set(FREQUENCIAS.map(([id]) => id));
  return (templates ?? []).map((t) => {
    let out = t;
    const destino = p.templateCategory[t?.id];
    if (destino && destino !== t.category && podeMoverPara(t, destino).ok) {
      out = { ...out, category: destino };
    }
    // Título/frequência/descrição por loja. Cada campo é validado na aplicação,
    // não só na gravação: preferência antiga, gravada antes de uma trava nova,
    // não pode quebrar a tela.
    const m = p.templateMeta[t?.id];
    if (m) {
      const titulo = String(m.title ?? '').trim();
      if (titulo && podeEditarTitulo(out).ok) out = { ...out, title: titulo };
      if (m.frequency && validas.has(m.frequency)) out = { ...out, frequency: m.frequency };
      const desc = String(m.description ?? '').trim();
      if (desc) out = { ...out, description: desc };
    }
    return out;
  });
}

// Só grava o que DIFERE do padrão — preferência que repete o default é ruído
// que sincroniza à toa e mascara o que a RT realmente mudou.
export function enxugarPrefs(prefs, padroes, templatesOriginais) {
  const p = normalizePrefs(prefs);
  const labels = {};
  for (const [id, valor] of Object.entries(p.categoryLabels)) {
    const v = String(valor ?? '').trim();
    if (v && v !== padroes?.[id]) labels[id] = v;
  }
  const porId = new Map((templatesOriginais ?? []).map((t) => [t.id, t.category]));
  const cats = {};
  for (const [id, destino] of Object.entries(p.templateCategory)) {
    if (destino && porId.has(id) && destino !== porId.get(id)) cats[id] = destino;
  }
  const meta = {};
  for (const [id, m] of Object.entries(p.templateMeta)) {
    const orig = (templatesOriginais ?? []).find((t) => t.id === id);
    if (!orig || !m) continue;
    const limpo = {};
    const titulo = String(m.title ?? '').trim();
    const desc   = String(m.description ?? '').trim();
    if (titulo && titulo !== orig.title)             limpo.title = titulo;
    if (m.frequency && m.frequency !== orig.frequency) limpo.frequency = m.frequency;
    if (desc && desc !== orig.description)           limpo.description = desc;
    if (Object.keys(limpo).length) meta[id] = limpo;
  }
  return { categoryLabels: labels, templateCategory: cats, templateMeta: meta };
}

export { VAZIO as PREFS_VAZIAS };
