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

import { alvaraStatus, latestManualBp, manualBpStatus, teamAsoSummary, descreverAfastamento, COMPLIANCE_DEFAULTS } from './compliance';
import { ultimoComprovante, EH_DEDETIZACAO, EH_RESERVATORIO, READINESS_DEFAULTS } from './readiness';
import { popAprovado, descreverAprovacao } from './pop-aprovacao';

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
  // "Hora" é o campo novo do formulário simplificado (21/09); "Recebido por"
  // vem do carimbo "Feito agora" (22/09, recebido.sig) - "Fornecedor" fica só
  // pro registro ANTIGO, que ainda tem esse dado; em registro novo a célula
  // vem vazia (esc(undefined) → ''), o que é esperado, não um erro.
  const rows = (receivingRecords ?? []).map((r) => `<tr>
    <td>${esc(r.hora)}</td>
    <td>${esc(r.recebido?.sig)}</td>
    <td>${esc([r.fornecedor, r.nf ? `NF ${r.nf}` : ''].filter(Boolean).join(' · '))}</td>
    <td style="white-space:pre-line">${esc(r.produto)}</td>
    <td>${esc(r.temperaturas?.length ? r.temperatura : (r.temperatura ? `${r.temperatura} °C` : ''))}</td>
    <td>${fmtDateTime(r.createdAt)}</td>
    <td style="color:${r.resultado === 'aceito' ? '#00a35c' : r.resultado === 'rejeitado' ? '#c0392b' : '#8a4e00'};font-weight:700">${RECEIVING_RESULT_LABEL[r.resultado] ?? r.resultado ?? '—'}</td>
    <td>${esc(r.motivoRejeicao || '—')}</td>
  </tr>`).join('');

  return {
    title: 'Recebimento de Mercadorias',
    // Temperatura entrou em 06/10 (RDC 216 4.7.3, conferida na recepção); NF
    // junto do fornecedor desde que a matriz da CASA DOCE voltou a registrar.
    headers: ['Hora', 'Recebido por', 'Fornecedor / NF', 'Produto', 'Temperatura', 'Data', 'Resultado', 'Motivo / ressalva'],
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
    <td style="color:${popAprovado(p) ? '#00a35c' : '#b26b00'};font-weight:700">${esc(descreverAprovacao(p))}</td>
  </tr>`).join('');

  const aprovados = (pops ?? []).filter(popAprovado).length;
  return {
    title: `Procedimentos Operacionais Padrão (${(pops ?? []).length} documentados, ${aprovados} aprovados)`,
    headers: ['POP', 'Categoria', 'Frequência', 'Responsável', 'Aprovação (RDC 216 4.11.2)'],
    rowsHtml: rows,
    emptyMessage: 'Nenhum POP cadastrado ainda.',
  };
}

// ─── Documentos e situação legal (candidata 3 da pesquisa de 03/10) ────────
//
// O fiscal pede documento ANTES de registro: alvará, responsável técnico,
// Manual de Boas Práticas (RDC 216 4.11.1: "disponível à autoridade
// sanitária, quando requerido"), comprovante de dedetização e do reservatório.
// O app já sabia tudo isso (é o que a Prontidão lê nos checks A5, A6, B1, B2
// e B4), mas o Dossiê não levava nada. Aqui é SÓ apresentação: as réguas são
// as mesmas funções da Prontidão (compliance.js, readiness.js), pra os dois
// nunca discordarem sobre o que está vencido.
//
// `unknown` é primeira classe, igual na Prontidão: "não registrado" é dito
// com essas palavras, nunca vira linha em branco nem "ok".

const TONE_COLOR = { ok: '#00a35c', warn: '#b26b00', fail: '#c0392b', unknown: '#5c6c7a' };

function linhaDoc(documento, tone, situacao, detalhe) {
  return `<tr>
    <td>${esc(documento)}</td>
    <td style="color:${TONE_COLOR[tone] ?? TONE_COLOR.unknown};font-weight:700">${esc(situacao)}</td>
    <td>${esc(detalhe)}</td>
  </tr>`;
}

const fmtDia = (iso) => {
  const s = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T12:00`).toLocaleDateString('pt-BR');
};
const diasEntre = (iso, now) => Math.floor((now - new Date(iso).getTime()) / 86400000);

// Mesma régua do checkComprovante (readiness.js): data = createdAt do
// lançamento, prazo em meses de 30 dias, aviso nos últimos 30.
function linhaComprovante(documento, formTemplates, formRecords, ehDoTipo, meses, now) {
  const { temPlanilha, ultimo } = ultimoComprovante(formTemplates, formRecords, ehDoTipo);
  if (!temPlanilha) return linhaDoc(documento, 'unknown', 'Sem planilha', 'Esta loja não tem a planilha deste controle cadastrada.');
  if (!ultimo) return linhaDoc(documento, 'unknown', 'Nenhum comprovante', 'A planilha existe, mas nenhum comprovante foi entregue.');
  const dias = diasEntre(ultimo.createdAt, now);
  const restam = meses * 30 - dias;
  const quando = `Último comprovante lançado em ${fmtDate(ultimo.createdAt)} (prazo de ${meses} meses).`;
  if (restam < 0) return linhaDoc(documento, 'fail', 'Vencido', quando);
  if (restam <= READINESS_DEFAULTS.dedetizacaoAvisoDias) return linhaDoc(documento, 'warn', `Vence em ${restam} dia(s)`, quando);
  return linhaDoc(documento, 'ok', 'Em dia', quando);
}

export function sectionDocuments({ companyProfile, complianceDocs, formTemplates, formRecords, now = Date.now() }) {
  const p = companyProfile ?? {};
  const rows = [];

  const alvara = alvaraStatus(p, now);
  const validadeAlvara = fmtDia(p.alvaraValidade);
  if (!alvara.numero) {
    rows.push(linhaDoc('Alvará sanitário', 'fail', 'Não informado', 'Número e validade não preenchidos em Configurações.'));
  } else {
    const detalhe = `Nº ${alvara.numero}${validadeAlvara ? ` · válido até ${validadeAlvara}` : ''}`;
    if (alvara.dias === null) rows.push(linhaDoc('Alvará sanitário', 'warn', 'Sem validade informada', detalhe));
    else if (alvara.dias < 0) rows.push(linhaDoc('Alvará sanitário', 'fail', `Vencido há ${-alvara.dias} dia(s)`, detalhe));
    else if (alvara.status === 'warn') rows.push(linhaDoc('Alvará sanitário', 'warn', `Vence em ${alvara.dias} dia(s)`, detalhe));
    else rows.push(linhaDoc('Alvará sanitário', 'ok', 'Válido', detalhe));
  }

  const rtNome = String(p.rtNome ?? '').trim();
  const rtCrn = String(p.rtCrn ?? '').trim();
  rows.push(rtNome && rtCrn
    ? linhaDoc('Responsável técnico', 'ok', 'Informado', `${rtNome} · CRN ${rtCrn}`)
    : linhaDoc('Responsável técnico', 'fail', 'Incompleto', `${rtNome || 'Nome não informado'} · ${rtCrn ? `CRN ${rtCrn}` : 'CRN não informado'}`));

  const manual = latestManualBp(complianceDocs);
  const manualSt = manualBpStatus(manual, now);
  if (manualSt.status === 'never') {
    rows.push(linhaDoc('Manual de Boas Práticas', 'fail', 'Não registrado', 'Nenhuma versão do Manual registrada em Configurações.'));
  } else {
    const partes = [
      manual.versao ? `Versão ${manual.versao}` : null,
      fmtDia(manual.issuedAt) ? `de ${fmtDia(manual.issuedAt)}` : null,
      manual.autor ? `elaborado por ${manual.autor}` : null,
    ].filter(Boolean).join(', ');
    rows.push(manualSt.status === 'warn'
      ? linhaDoc('Manual de Boas Práticas', 'warn', `Revisão há ${manualSt.mesesDesde} meses`, partes)
      : linhaDoc('Manual de Boas Práticas', 'ok', 'Registrado', partes));
  }

  const mesesDedetizacao = Number(p.dedetizacaoMeses) > 0 ? Number(p.dedetizacaoMeses) : READINESS_DEFAULTS.dedetizacaoMeses;
  rows.push(linhaComprovante('Dedetização (empresa especializada)', formTemplates, formRecords, EH_DEDETIZACAO, mesesDedetizacao, now));
  rows.push(linhaComprovante('Higienização do reservatório de água', formTemplates, formRecords, EH_RESERVATORIO, READINESS_DEFAULTS.reservatorioMeses, now));

  return {
    title: 'Documentos e Situação Legal',
    headers: ['Documento', 'Situação', 'Detalhe'],
    rowsHtml: rows.join(''),
    emptyMessage: '',
  };
}

// ─── Controle de saúde dos manipuladores (RDC 216 4.6.1) ──────────────────
//
// Uma linha por colaborador ativo: é assim que o fiscal confere ASO. Quem
// tem "Só opera aqui" fica fora (o ASO é do empregador, ver teamAsoSummary).
// O resultado do exame sai em coluna própria, separado da validade, e desde a
// v1.9.259 um ASO "Inapto" também tem situação "Inapto" (employeeAsoStatus).

const ASO_RESULTADO = { apto: 'Apto', apto_restricao: 'Apto com restrição', inapto: 'Inapto' };
const ASO_SITUACAO = {
  ok: ['ok', 'Em dia'], warn: ['warn', null], expired: ['fail', 'Vencido'], never: ['fail', 'Sem exame registrado'],
  inapto: ['fail', 'Inapto'],
};

export function sectionAso({ staff, complianceDocs, asoMeses = COMPLIANCE_DEFAULTS.asoValidadeMeses, now = Date.now() }) {
  const resumo = teamAsoSummary(staff, complianceDocs, asoMeses, now);
  const rows = resumo.situacoes.map((s) => {
    const afastamento = s.leaveType ? descreverAfastamento(s.leaveType, s.leaveStartedAt) : null;
    const [tone, rotulo] = ASO_SITUACAO[s.status] ?? ['unknown', '-'];
    const situacao = s.status === 'warn' ? `Vence em ${s.diasRestantes} dia(s)` : rotulo;
    const resultado = s.doc ? (ASO_RESULTADO[s.doc.resultado] ?? '-') : '-';
    return `<tr>
      <td>${esc(s.name)}</td>
      <td>${esc(s.role || '-')}</td>
      <td>${s.doc ? esc(fmtDia(s.doc._validade) ?? '-') : '-'}</td>
      <td style="${resultado === 'Inapto' ? 'color:#c0392b;font-weight:700' : ''}">${esc(resultado)}</td>
      <td style="color:${TONE_COLOR[tone]};font-weight:700">${esc(situacao)}${afastamento ? `<br><span style="color:#5c6c7a;font-weight:400">${esc(afastamento)}</span>` : ''}</td>
    </tr>`;
  }).join('');

  return {
    // Afastados não entram em nenhuma contagem (teamAsoSummary), então saem
    // também do total: "3 de 5" com 1 de licença leria como 2 irregulares.
    title: `Controle de Saúde dos Manipuladores (ASO): ${resumo.ok} de ${resumo.total - resumo.leave} em dia`
      + (resumo.leave > 0 ? `, ${resumo.leave} afastado(s)` : ''),
    headers: ['Colaborador', 'Função', 'Válido até', 'Resultado', 'Situação'],
    rowsHtml: rows,
    emptyMessage: 'Nenhum colaborador ativo cadastrado nesta loja.',
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
