// ─────────────────────────────────────────────────────────────────────────────
// Dedupe das planilhas BPF duplicadas (Swiss/Bäckerei/DBK).
//
// CONTEXTO: até a v1.9.133 os seeds dessas três lojas usavam `id: uid()`, então
// sorteavam um UUID novo a cada leitura e o merge por id anexava as planilhas
// de novo — 4 → 8 → 12, multiplicado por 11 call sites. A v1.9.133 estancou
// (o seed passou a casar por categoria+título), mas as cópias JÁ CRIADAS
// continuam nos aparelhos e na nuvem.
//
// POR QUE ISTO É DELICADO, e não um `uniqBy` de uma linha:
// cada `form_record` aponta pro `formId` da CÓPIA em que foi preenchido. Apagar
// cópia sem remapear os registros deixa eles órfãos — e órfão é INVISÍVEL:
// `pendingFormItems` (nonconformities.js) faz `templates.find(t => t.id ===
// rec.formId)` e pula quem não acha. Ou seja, dedupe ingênuo APAGA da Central
// de Não-Conformidades a NC histórica daquelas planilhas. Numa ferramenta de
// conformidade sanitária, isso é destruir evidência.
//
// E tem a trava da nuvem: `unique(tenant_id, form_id, period_key)`. Depois de
// remapear, dois registros de cópias diferentes pro MESMO período colidem.
//
// Por isso este módulo só PLANEJA — puro, sem I/O, sem apagar nada. Quem
// aplica decide depois, olhando o plano. `medirDuplicacao` é pra rodar nos
// devices reais antes de qualquer decisão (pedido do CLAUDE.md).
// ─────────────────────────────────────────────────────────────────────────────

// Mesma chave que `readFormTemplates` (forms.jsx) usa pra estancar: é o que
// define "é a mesma planilha, só que outra cópia".
export function chaveGrupo(t) {
  return `${t?.category ?? ''}::${String(t?.title ?? '').trim().toLowerCase()}`;
}

// Quantos campos a pessoa realmente preencheu. Serve de desempate quando duas
// cópias têm registro do mesmo período: fica o mais completo.
export function contarPreenchidos(record) {
  const r = record?.responses;
  if (!r || typeof r !== 'object') return 0;
  return Object.values(r).filter((v) => v !== null && v !== undefined && v !== '' && v !== false).length;
}

// Escolhe qual cópia sobrevive. Ordem de prioridade:
//   1. `custom` — a RT editou as tarefas dessa cópia. Perder isso é perder
//      trabalho dela (equipamento que ela cadastrou na planilha, rótulo que
//      ela corrigiu). Ganha de tudo.
//   2. mais registros — menos remapeamento, menos risco.
//   3. mais antiga — determinístico e, na dúvida, é pra ela que os registros
//      históricos mais provavelmente apontam.
//   4. id — desempate final, pra o plano ser reprodutível.
export function escolherSobrevivente(copias, registrosPorId) {
  return [...copias].sort((a, b) => {
    const ca = a.custom === true, cb = b.custom === true;
    if (ca !== cb) return ca ? -1 : 1;
    const ra = registrosPorId.get(a.id)?.length ?? 0;
    const rb = registrosPorId.get(b.id)?.length ?? 0;
    if (ra !== rb) return rb - ra;
    const ta = new Date(a.updatedAt ?? 0).getTime();
    const tb = new Date(b.updatedAt ?? 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

// Entre dois registros do mesmo período, qual fica. Entregue vence rascunho —
// é o que tem valor de evidência; depois o mais completo; depois o mais novo.
export function escolherRegistro(a, b) {
  const sa = a?.status === 'submitted', sb = b?.status === 'submitted';
  if (sa !== sb) return sa ? a : b;
  const va = a?.validation ? 1 : 0, vb = b?.validation ? 1 : 0;
  if (va !== vb) return va > vb ? a : b;      // validado pela RT pesa
  const pa = contarPreenchidos(a), pb = contarPreenchidos(b);
  if (pa !== pb) return pa > pb ? a : b;
  return new Date(a?.updatedAt ?? 0) >= new Date(b?.updatedAt ?? 0) ? a : b;
}

// ─── O plano ────────────────────────────────────────────────────────────────
// Não muda nada: descreve o que MUDARIA. Campos:
//   grupos      — um por planilha lógica, com a sobrevivente e as mortas
//   remapear    — [{ recordId, de, para }] registros que trocam de formId
//   colisoes    — mesmo período em cópias diferentes; uma fica, a outra é
//                 preservada dentro da vencedora (nunca apagada)
//   apagar      — ids de template que somem (só template, nunca registro)
// A chave vista do lado do REGISTRO. O record carrega `formTitle` e `category`
// copiados do template no momento em que foi preenchido (forms.jsx `handleSave`)
// — é o que permite reconectar um órfão à planilha certa mesmo quando o
// template original sumiu do aparelho.
export function chaveGrupoDoRegistro(r) {
  return `${r?.category ?? ''}::${String(r?.formTitle ?? '').trim().toLowerCase()}`;
}

export function planejarDedupe(templates = [], records = []) {
  const registrosPorId = new Map();
  for (const r of records ?? []) {
    if (!registrosPorId.has(r.formId)) registrosPorId.set(r.formId, []);
    registrosPorId.get(r.formId).push(r);
  }

  const porChave = new Map();
  for (const t of templates ?? []) {
    const k = chaveGrupo(t);
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(t);
  }

  const grupos = [], remapear = [], colisoes = [], apagar = [], orfaosRecuperados = [], orfaosSemDestino = [];

  // Qual template representa cada planilha lógica depois da limpeza. Vale
  // tanto pra grupo com cópias quanto pra planilha única — é aqui que os
  // órfãos vão se reconectar.
  const canonicoPorChave = new Map();

  for (const [chave, copias] of porChave) {
    if (copias.length < 2) { canonicoPorChave.set(chave, copias[0]); continue; }
    const sobrevivente = escolherSobrevivente(copias, registrosPorId);
    canonicoPorChave.set(chave, sobrevivente);
    const mortos = copias.filter((c) => c.id !== sobrevivente.id);
    for (const m of mortos) apagar.push(m.id);

    grupos.push({
      chave, titulo: sobrevivente.title, categoria: sobrevivente.category,
      copias: copias.length,
      sobrevivente: sobrevivente.id,
      sobreviventeCustom: sobrevivente.custom === true,
      mortos: mortos.map((m) => m.id),
      registrosPorCopia: copias.map((c) => ({ id: c.id, registros: (registrosPorId.get(c.id) ?? []).length })),
    });
  }

  // Períodos já ocupados em cada template canônico. Serve pros dois caminhos
  // abaixo (cópia morta e órfão) respeitarem a mesma trava da nuvem.
  const periodosPorCanonico = new Map();
  const ocupados = (id) => {
    if (!periodosPorCanonico.has(id)) {
      const m = new Map();
      for (const r of registrosPorId.get(id) ?? []) m.set(r.periodKey, r);
      periodosPorCanonico.set(id, m);
    }
    return periodosPorCanonico.get(id);
  };

  // Reatribui UM registro ao template canônico, resolvendo colisão de período.
  // Trava da nuvem: unique(tenant_id, form_id, period_key) — dois registros não
  // podem coexistir com o mesmo formId+período. Um vence, o outro é guardado
  // DENTRO do vencedor (`_duplicatasMescladas`), nunca descartado.
  const atribuir = (r, deId, canonico, origem) => {
    const porPeriodo = ocupados(canonico.id);
    const existente = porPeriodo.get(r.periodKey);
    if (!existente) {
      porPeriodo.set(r.periodKey, r);
      remapear.push({ recordId: r.id, de: deId, para: canonico.id, periodKey: r.periodKey, origem });
      return;
    }
    const vencedor = escolherRegistro(existente, r);
    const perdedor = vencedor === existente ? r : existente;
    porPeriodo.set(r.periodKey, vencedor);
    colisoes.push({
      periodKey: r.periodKey, formIdFinal: canonico.id,
      fica: vencedor.id, mesclado: perdedor.id, origem,
      motivo: vencedor.status === 'submitted' && perdedor.status !== 'submitted' ? 'entregue vence rascunho'
            : vencedor.validation && !perdedor.validation ? 'validado pela RT'
            : contarPreenchidos(vencedor) !== contarPreenchidos(perdedor) ? 'mais completo'
            : 'mais recente',
    });
    if (vencedor !== existente) {
      remapear.push({ recordId: vencedor.id, de: deId, para: canonico.id, periodKey: r.periodKey, origem });
    }
  };

  // ── Caminho 1: registros presos nas cópias que vão morrer ────────────────
  for (const g of grupos) {
    const canonico = canonicoPorChave.get(g.chave);
    for (const mortoId of g.mortos) {
      for (const r of registrosPorId.get(mortoId) ?? []) atribuir(r, mortoId, canonico, 'copia');
    }
  }

  // ── Caminho 2: RECUPERAÇÃO DE ÓRFÃOS ─────────────────────────────────────
  // Registro cujo formId não existe mais em template nenhum. Ele JÁ está
  // invisível hoje: `pendingFormItems` (nonconformities.js) faz
  // `templates.find(t => t.id === rec.formId)` e pula o que não acha — ou seja,
  // a NC histórica dessas planilhas sumiu da Central sem ninguém notar.
  // Medido em 16/08: 35 dos 41 registros da Swiss estavam assim.
  // O próprio registro carrega `formTitle` e `category` (forms.jsx handleSave),
  // então dá pra reconectar com segurança à planilha certa.
  const idsVivos = new Set((templates ?? []).map((t) => t.id));
  for (const r of records ?? []) {
    if (idsVivos.has(r.formId)) continue;
    const canonico = canonicoPorChave.get(chaveGrupoDoRegistro(r));
    if (!canonico) {
      // Não existe planilha com esse título/categoria — provavelmente uma
      // planilha que saiu do seed. Fica órfão MESMO, e é reportado: apagar
      // seria destruir evidência sem ter pra onde levar.
      orfaosSemDestino.push({ recordId: r.id, formId: r.formId, titulo: r.formTitle, categoria: r.category });
      continue;
    }
    orfaosRecuperados.push({ recordId: r.id, de: r.formId, para: canonico.id, titulo: r.formTitle });
    atribuir(r, r.formId, canonico, 'orfao');
  }

  return {
    grupos, remapear, colisoes, apagar, orfaosRecuperados, orfaosSemDestino,
    resumo: {
      templatesAntes: (templates ?? []).length,
      templatesDepois: (templates ?? []).length - apagar.length,
      planilhasDuplicadas: grupos.length,
      copiasExcedentes: apagar.length,
      registrosRemapeados: remapear.length,
      colisoesDePeriodo: colisoes.length,
      // O ganho que não é cosmético: registros que estavam INVISÍVEIS na
      // Central de Não-Conformidades e voltam a aparecer.
      orfaosRecuperados: orfaosRecuperados.length,
      orfaosSemDestino: orfaosSemDestino.length,
      // Nenhum registro é perdido: os que colidem viram `_duplicatasMescladas`
      // dentro do vencedor. Este número existe pra conferência.
      registrosPreservados: (records ?? []).length,
    },
  };
}

// Aplica o plano — puro: recebe e devolve arrays, não toca localStorage.
// Quem persiste é o call site, depois de olhar o plano.
export function aplicarDedupe(templates = [], records = [], plano) {
  const mortos = new Set(plano.apagar);
  const remapPorRecord = new Map(plano.remapear.map((r) => [r.recordId, r.para]));
  const mesclados = new Map();                       // recordId perdedor → vencedor
  for (const c of plano.colisoes) mesclados.set(c.mesclado, c.fica);

  const templatesLimpos = (templates ?? []).filter((t) => !mortos.has(t.id));

  const porId = new Map((records ?? []).map((r) => [r.id, r]));
  const registrosLimpos = [];
  for (const r of records ?? []) {
    if (mesclados.has(r.id)) continue;               // vai pra dentro do vencedor
    const novoFormId = remapPorRecord.get(r.id) ?? r.formId;
    const anexos = plano.colisoes
      .filter((c) => c.fica === r.id)
      .map((c) => porId.get(c.mesclado))
      .filter(Boolean);
    registrosLimpos.push({
      ...r,
      formId: novoFormId,
      ...(anexos.length ? { _duplicatasMescladas: anexos } : {}),
    });
  }

  return { templates: templatesLimpos, records: registrosLimpos };
}
