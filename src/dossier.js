// ─────────────────────────────────────────────────────────────────────────────
// Dossiê de fiscalização em 1 clique — item 10 da revisão de produto (09/08).
//
// O PDF fiscal (reports.jsx) já cruza temperatura + BPF + capacitação. Fora
// dele, seis caminhos de impressão isolados (controles especiais, recebimento,
// validades, manutenção, não-conformidades, POPs) — a RT precisa saber onde
// mora cada um quando a vigilância chega. Este módulo é só a MONTAGEM do HTML;
// puro, sem I/O — quem lê os dados (localStorage, imports dinâmicos dos
// chunks pesados) é a view (dossie.jsx). Reaproveita computeTempStats/
// computeBpfStats/computeTrainingStats/renderTempRows/renderBpfRows/
// renderTrainRows de reports.jsx em vez de recalcular (mesma lição do item 7:
// uma régua só).
// ─────────────────────────────────────────────────────────────────────────────

function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return '—'; } }
function fmtDateTime(iso) { try { return new Date(iso).toLocaleString('pt-BR'); } catch { return '—'; } }

export function filterByPeriod(list, periodStart, dateField = 'createdAt') {
  return (list ?? []).filter((r) => new Date(r?.[dateField]).getTime() >= periodStart);
}

// ─── Não conformidades (reaproveita a agregação do item 2) ─────────────────

export function sectionNonConformities(ncItems, actions, actionSourceKey) {
  const byKey = new Map();
  for (const a of actions ?? []) byKey.set(actionSourceKey(a), a);

  const rows = (ncItems ?? []).map((item) => {
    const action = byKey.get(`${item.source}::${item.sourceId}`);
    return `<tr>
      <td>${esc(item.sourceLabel)}</td>
      <td>${esc(item.sourceDetail)}</td>
      <td>${fmtDateTime(item.at)}</td>
      <td style="color:${action ? '#00a35c' : '#c0392b'};font-weight:700">${action ? '✓ Ação registrada' : 'Sem ação'}</td>
      <td>${action ? esc(action.description) : '—'}</td>
    </tr>`;
  }).join('');

  return {
    title: 'Não Conformidades e Ações Corretivas',
    headers: ['Origem', 'Detalhe', 'Data', 'Status', 'Ação tomada'],
    rowsHtml: rows,
    emptyMessage: 'Nenhuma não conformidade no período — parabéns.',
  };
}

// ─── Controles especiais (5 tipos, mesmo mapeamento de nonconformities.js) ──

const CONTROL_RESULT_LABEL = { conforme: 'Conforme', nao_conforme: 'Não conforme', descartado: 'Descartado', reprovado: 'Reprovado', aprovado: 'Aprovado' };

export function sectionSpecialControls(recordsByType, controlTypes) {
  const rows = [];
  for (const [type, cfg] of Object.entries(controlTypes)) {
    for (const r of recordsByType[type] ?? []) {
      const resultValue = r[cfg.resultField];
      const bad = cfg.badValues.includes(resultValue);
      rows.push(`<tr>
        <td>${esc(cfg.label)}</td>
        <td>${esc(r[cfg.titleField] || '—')}</td>
        <td>${fmtDateTime(r.createdAt)}</td>
        <td style="color:${bad ? '#c0392b' : '#00a35c'};font-weight:700">${esc(CONTROL_RESULT_LABEL[resultValue] ?? resultValue ?? '—')}</td>
        <td>${esc(r.user || '—')}</td>
      </tr>`);
    }
  }
  return {
    title: 'Controles Especiais',
    headers: ['Tipo', 'Item', 'Data', 'Resultado', 'Responsável'],
    rowsHtml: rows.join(''),
    emptyMessage: 'Sem registros de controles especiais no período.',
  };
}

// ─── Recebimento ────────────────────────────────────────────────────────────

const RECEIVING_RESULT_LABEL = { aceito: 'Aceito', rejeitado: 'Rejeitado', aceito_parcial: 'Aceito parcial' };

export function sectionReceiving(receivingRecords) {
  const rows = (receivingRecords ?? []).map((r) => `<tr>
    <td>${esc(r.fornecedor)}</td>
    <td>${esc(r.produto)}</td>
    <td>${fmtDateTime(r.createdAt)}</td>
    <td style="color:${r.resultado === 'aceito' ? '#00a35c' : r.resultado === 'rejeitado' ? '#c0392b' : '#8a4e00'};font-weight:700">${RECEIVING_RESULT_LABEL[r.resultado] ?? r.resultado ?? '—'}</td>
    <td>${esc(r.motivoRejeicao || '—')}</td>
  </tr>`).join('');

  return {
    title: 'Recebimento de Mercadorias',
    headers: ['Fornecedor', 'Produto', 'Data', 'Resultado', 'Motivo / ressalva'],
    rowsHtml: rows,
    emptyMessage: 'Sem recebimentos registrados no período.',
  };
}

// ─── Validades (fotografia do momento, não é por período) ──────────────────

export function sectionValidity(products, now = Date.now(), horizonDays = 30) {
  const withDays = (products ?? []).map((p) => {
    const effective = p.openedUntil ? p.openedUntil.slice(0, 10) : p.expiryDate;
    const days = effective ? Math.round((new Date(effective + 'T00:00').getTime() - new Date(now).setHours(0, 0, 0, 0)) / 86400000) : null;
    return { ...p, days };
  }).filter((p) => p.days !== null && p.days <= horizonDays)
    .sort((a, b) => a.days - b.days);

  const rows = withDays.map((p) => `<tr>
    <td>${esc(p.name)}</td>
    <td>${esc(p.category || '—')}</td>
    <td>${p.openedUntil ? fmtDate(p.openedUntil) : fmtDate(p.expiryDate)}</td>
    <td style="color:${p.days < 0 ? '#c0392b' : p.days <= 7 ? '#8a4e00' : '#5c6c7a'};font-weight:700">${p.days < 0 ? `Vencido há ${Math.abs(p.days)}d` : p.days === 0 ? 'Vence hoje' : `${p.days}d`}</td>
  </tr>`).join('');

  return {
    title: `Validades — vencidos e a vencer em ${horizonDays} dias`,
    headers: ['Produto', 'Categoria', 'Validade efetiva', 'Situação'],
    rowsHtml: rows,
    emptyMessage: 'Nenhum produto vencido ou vencendo no horizonte considerado.',
  };
}

// ─── Manutenção ─────────────────────────────────────────────────────────────

export function mergeEquipmentsWithCatalog(equipments, catalog) {
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const assetNames = new Set((equipments ?? []).map((e) => norm(e.name)));
  const catalogOnly = (catalog ?? [])
    .filter((c) => c.label && !assetNames.has(norm(c.label)))
    .map((c) => ({ id: `cat-${c.label}`, name: c.label, location: c.location ?? '', status: 'Operacional', maintenancePlans: [] }));
  return [...(equipments ?? []), ...catalogOnly];
}

export function sectionMaintenance(mergedEquipments, periodLogs) {
  const rows = (periodLogs ?? []).map((l) => {
    const eq = (mergedEquipments ?? []).find((e) => e.id === l.equipmentId);
    return `<tr>
      <td>${fmtDate(l.executedAt)}</td>
      <td>${esc(eq?.name || '—')}</td>
      <td>${esc(l.type)}</td>
      <td>${esc(l.title)}</td>
      <td>${esc(l.executedBy)}</td>
    </tr>`;
  }).join('');

  return {
    title: `Manutenção de Equipamentos (${(mergedEquipments ?? []).length} cadastrados)`,
    headers: ['Data', 'Equipamento', 'Tipo', 'Tarefa', 'Executado por'],
    rowsHtml: rows,
    emptyMessage: 'Sem execuções de manutenção no período.',
  };
}

// ─── POPs (documento estático — lista de referência, não registro de período) ─

export function sectionPOPs(pops) {
  const rows = (pops ?? []).map((p) => `<tr>
    <td>${esc(p.title)}</td>
    <td>${esc(p.category || '—')}</td>
    <td>${esc(p.frequency || '—')}</td>
    <td>${esc(p.responsible || '—')}</td>
  </tr>`).join('');

  return {
    title: `Procedimentos Operacionais Padrão (${(pops ?? []).length} documentados)`,
    headers: ['POP', 'Categoria', 'Frequência', 'Responsável'],
    rowsHtml: rows,
    emptyMessage: 'Nenhum POP cadastrado ainda.',
  };
}

// ─── Montagem final ─────────────────────────────────────────────────────────

function renderSection(section, index) {
  const cols = section.headers.length;
  return `<h2>${index}. ${esc(section.title)}</h2>
  <table><thead><tr>${section.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${section.rowsHtml || `<tr><td colspan="${cols}">${esc(section.emptyMessage)}</td></tr>`}</tbody></table>`;
}

export function buildDossierHtml({ tenantName, periodLabel, companyProfile, sections, generatedAt, deviceMismatch = false }) {
  const p = companyProfile ?? {};
  const date = new Date(generatedAt ?? Date.now()).toLocaleString('pt-BR');
  const sectionsHtml = sections.map((s, i) => renderSection(s, i + 1)).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>Dossiê de Fiscalização — ${esc(tenantName)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:10px;color:#001e2b;padding:20px}
    .company-header{display:flex;justify-content:space-between;padding:8px 12px;background:#f9fbfa;border:1px solid #c1ccd6;border-radius:4px;margin-bottom:12px}
    .company-name{font-size:13px;font-weight:800}.company-detail{font-size:9px;color:#5c6c7a}
    h1{font-size:16px;font-weight:800;margin-bottom:4px}
    h2{font-size:12px;font-weight:700;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid #c1ccd6;color:#00684a;page-break-after:avoid}
    .meta{color:#5c6c7a;font-size:9px;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #c1ccd6}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}
    th{background:#f9fbfa;padding:5px 8px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #c1ccd6;color:#5c6c7a}
    td{padding:6px 8px;border-bottom:1px solid #eaeef2;font-size:9px}
    tr:last-child td{border-bottom:none}
    .sig{display:flex;gap:40px;margin-top:32px}
    .sig-line{flex:1;border-top:1px solid #374151;padding-top:4px;font-size:9px;color:#5c6c7a;text-align:center}
    .footer{margin-top:16px;padding-top:8px;border-top:1px solid #c1ccd6;font-size:8px;color:#9198a1;display:flex;justify-content:space-between}
    .device-warning{background:#fdf3e0;border:1px solid #e0a72e;color:#7a4a00;padding:8px 12px;border-radius:4px;margin-bottom:12px;font-size:9px;font-weight:700;line-height:1.4}
    @page{size:A4;margin:12mm}
  </style></head><body>
  <div class="company-header">
    <div>
      <div class="company-name">${esc(p.razaoSocial || tenantName)}</div>
      ${p.cnpj ? `<div class="company-detail">CNPJ: ${esc(p.cnpj)}</div>` : ''}
      ${p.endereco ? `<div class="company-detail">${esc(p.endereco)}</div>` : ''}
    </div>
    ${p.atividade ? `<div style="font-size:10px;font-weight:700;color:#00684a">${esc(p.atividade)}</div>` : ''}
  </div>
  <h1>Dossiê de Fiscalização Sanitária</h1>
  ${deviceMismatch ? `<div class="device-warning">⚠ Gerado neste aparelho para uma empresa diferente da sessão ativa. As seções abaixo (exceto Temperatura) refletem só o que este dispositivo já sincronizou localmente para ${esc(tenantName)} e podem estar incompletas ou desatualizadas — confirme num aparelho que sincroniza esta empresa como principal antes de apresentar ao fiscal.</div>` : ''}
  <div class="meta">
    <strong>${esc(tenantName)}</strong> · Período: ${esc(periodLabel)} · Gerado em ${date} · RDC 216/2004 · NutriOPS
  </div>
  ${sectionsHtml}
  <div class="sig">
    <div class="sig-line">Responsável pela empresa · Data: ___/___/______</div>
    <div class="sig-line">${esc(p.rtNome || 'Nutricionista RT')}${p.rtCrn ? ` · ${esc(p.rtCrn)}` : ''}</div>
  </div>
  <div class="footer"><span>NutriOPS · RDC 216/2004 · ${esc(p.razaoSocial || tenantName)}</span><span>Dossiê completo · ${sections.length} seções</span><span>${date}</span></div>
  </body></html>`;
}
