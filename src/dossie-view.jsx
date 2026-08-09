// ─────────────────────────────────────────────────────────────────────────────
// Dossiê de fiscalização em 1 clique — item 10 da revisão de produto (09/08).
// A UI só orquestra: lê os dados (imports dinâmicos dos chunks pesados, pra
// não engordar o bundle da aba "Relatórios" com forms/controls/maintenance/
// validity o tempo todo) e entrega pro dossier.js montar o HTML.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { resolveRecordTone as resolveTemperatureTone } from './limits';
import { computeTempStats, computeBpfStats, computeTrainingStats, renderTempRows, renderBpfRows, renderTrainRows } from './reports';

const readActions = (id) => { try { const r = localStorage.getItem(`nutriops.corrective_actions.${id}`); return r ? JSON.parse(r) : []; } catch { return []; } };
const readReceiving = (id) => { try { const r = localStorage.getItem(`nutriops.receiving.${id}`); return r ? JSON.parse(r) : []; } catch { return []; } };

async function generateTenantDossier({ tenant, records, periodDays, periodLabel }) {
  const [
    { readFormTemplates, readFormRecords, extractNonConformities },
    { readOil, readThaw, readCool, readThermal, readPOPs },
    { readHandwash },
    { readEquipments, readCatalog, readMaintenanceLogs },
    { readProducts },
    { readCompanyProfile },
    nc,
    dossier,
  ] = await Promise.all([
    import('./forms'), import('./controls'), import('./extras'), import('./maintenance'),
    import('./validity'), import('./settings'), import('./nonconformities'), import('./dossier'),
  ]);

  const periodStart = Date.now() - periodDays * 86400000;
  const templates = readFormTemplates(tenant);
  const formRecords = readFormRecords(tenant.id);
  const receiving = readReceiving(tenant.id);
  const controlsByType = {
    oil: readOil(tenant.id), thaw: readThaw(tenant.id), cool: readCool(tenant.id),
    thermal: readThermal(tenant.id), handwash: readHandwash(tenant.id),
  };
  const actions = readActions(tenant.id);

  const ncItems = dossier.filterByPeriod([
    ...nc.pendingTemperatureItems(records, tenant.id, resolveTemperatureTone),
    ...nc.pendingReceivingItems(receiving),
    ...Object.keys(nc.CONTROL_TYPES).flatMap((type) => nc.pendingControlItems(type, controlsByType[type])),
    ...nc.pendingFormItems(templates, formRecords, extractNonConformities),
  ], periodStart, 'at');

  const mergedEquipments = dossier.mergeEquipmentsWithCatalog(readEquipments(tenant.id), readCatalog(tenant));
  const periodControls = Object.fromEntries(Object.entries(controlsByType).map(([type, recs]) => [type, dossier.filterByPeriod(recs, periodStart)]));

  const sections = [
    { title: 'Controle de Temperatura', headers: ['Equipamento', 'Registros', 'Conformidade', 'Temp. Média', 'Conformes', 'Desvios', 'Críticos'], rowsHtml: renderTempRows(computeTempStats(records, tenant.id, periodDays)), emptyMessage: 'Sem registros no período' },
    { title: 'Planilhas de Controle BPF', headers: ['Planilha', 'Frequência', 'Período atual', 'Validação RT'], rowsHtml: renderBpfRows(computeBpfStats(tenant)), emptyMessage: 'Sem planilhas cadastradas' },
    { title: 'Capacitação de Colaboradores', headers: ['Colaborador', 'Perfil', 'Último treinamento', 'Situação'], rowsHtml: renderTrainRows(computeTrainingStats(tenant)), emptyMessage: 'Sem dados de capacitação' },
    dossier.sectionNonConformities(ncItems, actions, nc.actionSourceKey),
    dossier.sectionSpecialControls(periodControls, nc.CONTROL_TYPES),
    dossier.sectionReceiving(dossier.filterByPeriod(receiving, periodStart)),
    dossier.sectionValidity(readProducts(tenant.id)),
    dossier.sectionMaintenance(mergedEquipments, dossier.filterByPeriod(readMaintenanceLogs(tenant.id), periodStart, 'executedAt')),
    dossier.sectionPOPs(readPOPs(tenant.id)),
  ];

  return dossier.buildDossierHtml({ tenantName: tenant.name, periodLabel, companyProfile: readCompanyProfile(tenant.id), sections, generatedAt: Date.now() });
}

export function DossieView({ allTenants, records }) {
  const [tenantFilter, setTenantFilter] = useState('all');
  const [periodDays, setPeriodDays] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  const periodLabel = { 7: 'Últimos 7 dias', 30: 'Últimos 30 dias', 90: 'Últimos 90 dias' }[periodDays] ?? `${periodDays} dias`;

  const handleGenerate = async () => {
    const tenants = tenantFilter === 'all' ? allTenants : allTenants.filter((t) => t.id === tenantFilter);
    setGenerating(true);
    setResult(null);
    try {
      for (const tenant of tenants) {
        const html = await generateTenantDossier({ tenant, records, periodDays, periodLabel });
        const win = window.open('', '_blank');
        if (!win) continue;
        win.document.write(html);
        win.document.close();
        setTimeout(() => win.print(), 400);
      }
      setResult({ ok: true, count: tenants.length });
    } catch (err) {
      setResult({ ok: false, message: err?.message ?? 'Erro ao gerar o dossiê.' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Fiscalização</span>
          <h1>Dossiê Completo</h1>
          <p className="muted">Um PDF só com temperatura, BPF, capacitação, não conformidades, controles especiais, recebimento, validades, manutenção e POPs — pronto pra apresentar quando a vigilância chegar.</p>
        </div>
        <div className="page-actions">
          <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">Todas as empresas</option>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} style={{ width: 'auto' }}>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <button className="primary-action" style={{ fontSize: 12 }} onClick={handleGenerate} disabled={generating}>
            {generating ? 'Gerando…' : '↓ Gerar dossiê completo'}
          </button>
        </div>
      </div>

      <div className="management-card" style={{ padding: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-secondary)', marginBottom: 10 }}>Seções incluídas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['Temperatura', 'Planilhas BPF', 'Capacitação', 'Não conformidades', 'Controles especiais', 'Recebimento', 'Validades', 'Manutenção', 'POPs'].map((s) => (
            <span key={s} className="badge neutral">{s}</span>
          ))}
        </div>
        {result?.ok && <div className="submission ok" style={{ marginTop: 16 }}>✓ Dossiê gerado para {result.count} {result.count === 1 ? 'empresa' : 'empresas'} — {periodLabel.toLowerCase()}.</div>}
        {result && !result.ok && <div className="submission danger" style={{ marginTop: 16 }}>✕ {result.message}</div>}
      </div>
    </section>
  );
}
