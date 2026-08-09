// ─────────────────────────────────────────────────────────────────────────────
// Central de Não-Conformidades — item 2 da revisão de produto (09/08).
//
// Até aqui uma NC existia em 4 lugares e nenhum lia os outros três: planilha
// (seção "Não conformidade"), recebimento rejeitado, controle especial
// reprovado, e desvio de temperatura (o único com fluxo de ação, exclusivo
// dele). Este módulo normaliza as 4 origens num formato comum — puro, sem
// React — pra CorrectiveActionsView (pages.jsx) só desenhar a tela.
// ─────────────────────────────────────────────────────────────────────────────

// Nome do campo de resultado e do "rótulo" variam por tipo de controle —
// handwash usa `result` (não `resultado`), e o rótulo vem de um campo
// diferente em cada um. Centralizado aqui pra não espalhar esse
// conhecimento pela tela.
export const CONTROL_TYPES = {
  oil:      { label: 'Óleo de fritura',   titleField: 'equipment', resultField: 'resultado', badValues: ['reprovado'] },
  thaw:     { label: 'Descongelamento',   titleField: 'product',   resultField: 'resultado', badValues: ['nao_conforme'] },
  cool:     { label: 'Resfriamento',      titleField: 'product',   resultField: 'resultado', badValues: ['nao_conforme'] },
  thermal:  { label: 'Tratamento térmico', titleField: 'product',  resultField: 'resultado', badValues: ['nao_conforme'] },
  handwash: { label: 'Higiene das mãos',  titleField: 'operator',  resultField: 'result',    badValues: ['nao_conforme'] },
};

// Chave de "já tem ação aberta pra isso" — ações salvas antes desta mudança
// não têm `source`/`sourceId`, só `recordId` (sempre temperatura). Sem essa
// normalização, ações antigas pareceriam "sem ação" e duplicariam.
export function actionSourceKey(a) {
  return `${a.source ?? 'temperature'}::${a.sourceId ?? a.recordId ?? ''}`;
}

export function pendingTemperatureItems(records, tenantId, resolveTone) {
  return records
    .filter((r) => r.tenantId === tenantId)
    .filter((r) => { const t = resolveTone(r); return t !== 'ok' && t !== 'neutral'; })
    .map((r) => ({
      source: 'temperature', sourceId: r.id,
      sourceLabel: r.equipmentInput || r.equipment || '—',
      sourceDetail: `${r.value}°C · faixa ${r.min}–${r.max}°C`,
      at: r.createdAt, raw: r,
    }));
}

export function pendingReceivingItems(receiving) {
  return (receiving ?? [])
    .filter((r) => r.resultado === 'rejeitado')
    .map((r) => ({
      source: 'receiving', sourceId: r.id,
      sourceLabel: `Recebimento — ${r.fornecedor || r.produto || 'Fornecedor'}`,
      sourceDetail: r.motivoRejeicao ? `Motivo: ${r.motivoRejeicao}` : (r.produto ?? ''),
      at: r.createdAt, raw: r,
    }));
}

export function pendingControlItems(type, records) {
  const cfg = CONTROL_TYPES[type];
  if (!cfg) return [];
  return (records ?? [])
    .filter((r) => cfg.badValues.includes(r[cfg.resultField]))
    .map((r) => ({
      source: 'control', sourceId: r.id,
      sourceLabel: `${cfg.label} — ${r[cfg.titleField] || '—'}`,
      sourceDetail: r.acao || r.obs || `Resultado: ${r[cfg.resultField]}`,
      at: r.createdAt, raw: r,
    }));
}

// `extractNonConformities` é injetada (vem de forms.jsx, carregado só sob
// demanda por import dinâmico — CorrectiveActionsView é parte do bundle
// principal, e forms.jsx é o chunk pesado de planilhas; importar direto
// puxaria esse chunk inteiro pro bundle principal).
export function pendingFormItems(templates, formRecords, extractNonConformities) {
  const out = [];
  for (const rec of formRecords ?? []) {
    const tpl = templates.find((t) => t.id === rec.formId);
    if (!tpl) continue;
    for (const nc of extractNonConformities(tpl, rec)) {
      out.push({
        source: 'form', sourceId: `${rec.id}::${nc.sectionId}`,
        sourceLabel: rec.formTitle ?? tpl.title,
        sourceDetail: nc.description,
        at: rec.updatedAt ?? rec.createdAt, raw: { ...nc, recordId: rec.id },
      });
    }
  }
  return out;
}

export function excludeWithAction(items, actions) {
  const taken = new Set((actions ?? []).map(actionSourceKey));
  return items.filter((item) => !taken.has(`${item.source}::${item.sourceId}`));
}
