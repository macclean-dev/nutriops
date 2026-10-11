// ─────────────────────────────────────────────────────────────────────────────
// Implantar loja sem desenvolvedor (proposta 3 da análise de produto, 10/10).
//
// Até aqui toda planilha de loja nova entrava por código (seedTemplates em
// forms.jsx, um ramo por cliente, casando por id ou pelo NOME da loja) e todo
// equipamento por SQL. Foi assim com o PKS e o Terraço em setembro: a RT
// mandou 6 PDFs e o desenvolvedor transcreveu tarefa a tarefa. Cada unidade
// nova da rede repete o custo, e o concorrente que a CASA DOCE já usa (SULTS)
// deixa o próprio cliente configurar.
//
// Três peças, todas puras (a tela só chama e grava):
//   · novaPlanilha: a RT cria uma planilha de tarefas do zero.
//   · copiarPlanilhas: traz planilhas de outra loja que ela acompanha.
//   · equipamentosParaCopiar: idem para o cadastro de equipamentos.
//
// Higienização é a única aba com comportamento: o setor de cada folha sai do
// título (o nome da folha nativa traz o setor depois do separador, ex.:
// "Higienização [separador] Padaria") ou de uma escolha da RT guardada nas
// preferências da loja (form-prefs.js, v1.9.189). Planilha nova ou copiada
// que vai para lá entra pelo MESMO caminho já testado da escolha da RT: base
// em "faxina" + preferência movendo para Higienização com o setor. Se a
// preferência não chegar a um aparelho, a planilha aparece em Faxina, nunca
// some.
// ─────────────────────────────────────────────────────────────────────────────

export const PERIODICIDADES = [
  ['daily',    'diária'],
  ['weekly',   'semanal'],
  ['biweekly', 'quinzenal'],
  ['monthly',  'mensal'],
];
const rotuloPer = Object.fromEntries(PERIODICIDADES);

const HIG = 'higienizacao';
// Separador do setor no título das folhas nativas (templateSector, forms.jsx).
const SEPARADOR_DO_SETOR = '\u2014';
const BASE_DA_HIG = 'faxina';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const blocoNC = (pfx) => ({
  id: `${pfx}-nc`, title: 'Não conformidade (se houver)', fields: [
    { id: `${pfx}-ncdesc`, label: 'Não conformidade', type: 'text' },
    { id: `${pfx}-ncacao`, label: 'Ação corretiva', type: 'text' },
    { id: `${pfx}-ncresp`, label: 'Responsável pela correção', type: 'text' },
  ],
});

// Preferência que põe a planilha em Higienização com o setor escolhido.
const prefsParaHigienizacao = (id, setor) => ({ templateCategory: { [id]: HIG }, templateSector: { [id]: setor } });

// Valida o que a tela mandou. Devolve a lista de problemas, em português.
export function problemasDaNovaPlanilha({ titulo, aba, setor, tarefas }) {
  const p = [];
  if (!String(titulo ?? '').trim()) p.push('Dê um nome para a planilha.');
  if (!aba) p.push('Escolha em qual aba ela aparece.');
  if (aba === HIG && !String(setor ?? '').trim()) p.push('A aba de Higienização é organizada por setor: escolha o setor.');
  if (!(tarefas ?? []).some((t) => String(t?.nome ?? '').trim())) p.push('Inclua pelo menos uma tarefa.');
  return p;
}

// Planilha de tarefas no mesmo formato das de higienização do seed (higSetor,
// forms.jsx): responsável da folha, tarefas com data e assinatura (cada uma
// com a sua periodicidade) e o bloco de não conformidade que a Central de NC
// lê (extractNonConformities procura a seção "-nc" e o campo "ncdesc").
export function novaPlanilha({ titulo, aba, frequencia = 'weekly', setor = '', tarefas = [], id, hojeIso = new Date().toISOString() }) {
  const pfx = `rt-${String(id).slice(0, 8)}`;
  const vaiPraHig = aba === HIG;
  const template = {
    id, custom: true, v: 1,
    category: vaiPraHig ? BASE_DA_HIG : aba,
    frequency: frequencia,
    title: String(titulo).trim(),
    description: `Criada pela RT em ${new Date(hojeIso).toLocaleDateString('pt-BR')}. Registre data e assinatura de cada tarefa concluída.`,
    sections: [
      { id: `${pfx}-cab`, title: 'Identificação', fields: [
        { id: `${pfx}-resp`, label: 'Responsável pela folha', type: 'text' },
      ]},
      { id: `${pfx}-t`, title: 'Tarefas', fields: tarefas
        .filter((t) => String(t?.nome ?? '').trim())
        .map((t, i) => ({
          id: `${pfx}-${i}`,
          label: `${String(t.nome).trim()} (${rotuloPer[t.per] ?? rotuloPer[frequencia] ?? 'semanal'})`,
          type: 'date_sig',
          frequency: rotuloPer[t.per] ? t.per : null,
        })) },
      blocoNC(pfx),
    ],
    updatedAt: hojeIso,
  };
  return { template, prefs: vaiPraHig ? prefsParaHigienizacao(id, String(setor).trim()) : null };
}

// Planilhas de outra loja. `origem` já com as preferências DELA aplicadas
// (applyCategoryPrefs), pra copiar o que a RT vê lá: aba, título, setor.
// Ids novos (form_templates é chaveada por id: o mesmo id sobrescreveria a
// planilha da outra loja). Ids de seção e campo ficam: respostas são por
// loja, não colidem. Planilha com o mesmo título na mesma aba aqui não é
// copiada de novo.
export function copiarPlanilhas(origem, destino, { ids, novoId = () => crypto.randomUUID(), setorDe = () => null, hojeIso = new Date().toISOString() } = {}) {
  const jaTem = new Set((destino ?? []).map((t) => `${t.category}::${norm(t.title)}`));
  const escolhidas = (origem ?? []).filter((t) => !ids || ids.includes(t.id));
  const copias = [], repetidas = [];
  for (const t of escolhidas) {
    if (jaTem.has(`${t.category}::${norm(t.title)}`)) { repetidas.push(t); continue; }
    const id = novoId();
    const { setorPref, ...semPref } = t;
    // Setor vindo da escolha da RT (não do título): leva junto como preferência.
    const setorEscolhido = t.category === HIG && !String(t.title ?? '').includes(SEPARADOR_DO_SETOR) ? (setorPref ?? setorDe(t)) : null;
    const template = {
      ...JSON.parse(JSON.stringify(semPref)),
      id, custom: true, v: 1, updatedAt: hojeIso,
      ...(setorEscolhido ? { category: BASE_DA_HIG } : {}),
    };
    copias.push({ template, prefs: setorEscolhido ? prefsParaHigienizacao(id, setorEscolhido) : null, origemId: t.id });
    jaTem.add(`${t.category}::${norm(t.title)}`);
  }
  return { copias, repetidas };
}

// Junta as preferências de várias planilhas novas nas da loja.
export function juntarPrefs(atuais, patches) {
  const out = {
    ...(atuais ?? {}),
    templateCategory: { ...(atuais?.templateCategory ?? {}) },
    templateSector: { ...(atuais?.templateSector ?? {}) },
  };
  for (const p of patches ?? []) {
    if (!p) continue;
    Object.assign(out.templateCategory, p.templateCategory);
    Object.assign(out.templateSector, p.templateSector);
  }
  return out;
}

// Equipamentos de outra loja que ainda não existem aqui (o nome é a chave na
// nuvem: equipment_catalog é (tenant_id, label)). Copia nome, setor, faixa,
// apelidos e "uso intermitente".
export function equipamentosParaCopiar(origem, destino) {
  const aqui = new Set((destino ?? []).map((e) => norm(e.label)));
  const novos = [], repetidos = [];
  for (const e of origem ?? []) {
    if (!e?.label) continue;
    if (aqui.has(norm(e.label))) { repetidos.push(e); continue; }
    aqui.add(norm(e.label));
    novos.push({
      label: e.label, aliases: Array.isArray(e.aliases) ? [...e.aliases] : [],
      location: e.location ?? null, minTemp: e.minTemp ?? null, maxTemp: e.maxTemp ?? null,
      usoIntermitente: e.usoIntermitente === true,
    });
  }
  return { novos, repetidos };
}
