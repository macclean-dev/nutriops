// ─────────────────────────────────────────────────────────────────────────────
// Uma planilha só por loja, a mesma em todo aparelho (relato da RT, 09/11).
//
// "O preenchimento das planilhas do Terraço e PKS de Higiene Pessoal e
// Controle Integrado de Vetores e Pragas não está sincronizando no meu login,
// de nenhum dia da semana. O histórico consta como sem registros."
//
// Causa: as três planilhas genéricas (Higiene Pessoal, Vetores e Pragas,
// Dedetização) nasciam com `uid()`, ou seja, cada APARELHO sorteava o seu
// código de planilha e de cada campo. A planilha só existe no aparelho: o seed
// nunca sobe pra nuvem (form_templates só recebe o que a RT edita). O registro
// sobe, apontando pro código do computador da loja; no login da RT ele chega,
// mas a planilha dela tem outro código, então o histórico dela fica vazio e o
// registro fica órfão. E mesmo que o código da planilha batesse (a Higiene
// ganhou id fixo em 05/09), as respostas são gravadas pelo código de cada
// CAMPO, também sorteado: a RT veria a linha, mas em branco.
//
// O conserto tem duas metades:
//   · forms.jsx: essas três passam a ter código fixo por loja, de planilha e
//     de campo (idSeedPorTenant), igual em qualquer aparelho;
//   · aqui: o que já foi preenchido nas cópias sorteadas é levado pra planilha
//     fixa, traduzindo as respostas de um campo pro outro pelo RÓTULO (o seed
//     é o mesmo, os rótulos batem). Puro, sem I/O: quem grava é forms.jsx e
//     quem leva pra nuvem é repository.js (enviarPlanilhasMovidas).
//
// O registro mantém o MESMO id: na nuvem a linha é atualizada no lugar, sem
// cópia. Uma cópia nova deixaria a antiga na lista "Planilhas para validar"
// da RT, que lista registro sem conferir a planilha.
// ─────────────────────────────────────────────────────────────────────────────

const normRotulo = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const chavePlanilha = (t) => `${t?.category ?? ''}::${String(t?.title ?? '').trim().toLowerCase()}`;
const camposDe = (t) => (t?.sections ?? []).flatMap((s) => s?.fields ?? []);

// De-para dos campos da cópia pros campos do destino, pelo rótulo.
export function mapaDeCampos(origem, destino) {
  const porRotulo = new Map();
  for (const f of camposDe(destino)) {
    const k = normRotulo(f?.label);
    if (k && !porRotulo.has(k)) porRotulo.set(k, f.id);
  }
  const mapa = new Map();
  for (const f of camposDe(origem)) {
    const para = porRotulo.get(normRotulo(f?.label));
    if (para) mapa.set(f.id, para);
  }
  return mapa;
}

// Resposta de campo sem par no destino fica com a chave antiga: não aparece
// na tela, mas não some do registro.
export function traduzirRespostas(responses, mapa) {
  if (!responses || typeof responses !== 'object') return responses;
  const out = {};
  for (const [k, v] of Object.entries(responses)) out[mapa.get(k) ?? k] = v;
  return out;
}

// +1 ms no carimbo: o sync funde aparelho e nuvem pelo mais recente, com
// empate a favor da nuvem. Sem isso o próximo sync traria de volta a versão
// com o código velho antes de a nova subir. Um milissegundo não muda a data
// que a tela mostra.
function carimboSeguinte(r, agoraMs) {
  const t = new Date(r?.updatedAt ?? r?.createdAt ?? 0).getTime();
  return new Date((Number.isFinite(t) && t > 0 ? t : agoraMs) + 1).toISOString();
}

// `canonicas`: as planilhas de código fixo desta loja (do seed).
// Devolve a lista de planilhas e de registros já unificadas, os registros
// movidos e os que ficaram onde estavam (período já ocupado no destino).
export function unificarCopias({ templates = [], records = [], canonicas = [], agoraMs = Date.now() }) {
  let lista = [...templates];
  let regs = [...records];
  const movidos = [], ficaram = [];

  for (const canonica of canonicas) {
    const k = chavePlanilha(canonica);
    const copias = lista.filter((t) => chavePlanilha(t) === k && t.id !== canonica.id);
    if (!copias.length) continue;

    // A editada pela RT (custom) é o destino: ela já está na nuvem e em todo
    // aparelho, e o ajuste dela vale mais que o seed (mesma regra de
    // readFormTemplates). Sem editada, a de código fixo.
    const destino = copias.find((t) => t.custom === true) ?? lista.find((t) => t.id === canonica.id) ?? canonica;
    // Com destino editado, a própria fixa (se já estiver na lista) também é
    // cópia a unificar: senão a loja veria duas planilhas iguais.
    const mortas = lista.filter((t) => chavePlanilha(t) === k && t !== destino && t.custom !== true);
    if (!mortas.length) continue;

    const mapas = new Map(mortas.map((t) => [t.id, mapaDeCampos(t, destino)]));
    const ocupados = new Set(regs.filter((r) => r.formId === destino.id).map((r) => r.periodKey));
    regs = regs.map((r) => {
      if (!mapas.has(r.formId)) return r;
      // Período já preenchido no destino (dois aparelhos no mesmo dia, ou
      // cópias duplicadas da Swiss/Bäckerei): não funde às cegas. O registro
      // fica onde está, e a cópia dele também (abaixo), pra não sumir da tela.
      if (ocupados.has(r.periodKey)) { ficaram.push({ id: r.id, formId: r.formId, periodKey: r.periodKey }); return r; }
      ocupados.add(r.periodKey);
      movidos.push({ id: r.id, de: r.formId, para: destino.id });
      return {
        ...r,
        formId: destino.id,
        formTitle: destino.title,
        responses: traduzirRespostas(r.responses, mapas.get(r.formId)),
        updatedAt: carimboSeguinte(r, agoraMs),
      };
    });

    // Some a cópia que ficou vazia. A primeira dá lugar ao destino (mesma
    // posição na tela), se ele ainda não estiver na lista.
    const vazias = new Set(mortas.filter((t) => !regs.some((r) => r.formId === t.id)).map((t) => t.id));
    let precisaDestino = !lista.some((t) => t.id === destino.id);
    lista = lista.flatMap((t) => {
      if (!vazias.has(t.id)) return [t];
      if (precisaDestino) { precisaDestino = false; return [destino]; }
      return [];
    });
    if (precisaDestino) lista.push(destino);
  }

  const mudou = lista.length !== templates.length || lista.some((t, i) => t !== templates[i]) || movidos.length > 0;
  return { templates: lista, records: regs, movidos, ficaram, mudou };
}
