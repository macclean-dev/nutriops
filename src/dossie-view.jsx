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

async function generateTenantDossier({ tenant, records, periodDays, periodLabel, session }) {
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

  // As 8 seções acima (tudo menos Temperatura, que vem de `records` — esse
  // sim cruza o repository e cobre todas as lojas) leem SÓ o localStorage
  // DESTE aparelho, por tenant. O único jeito desse cache existir é o
  // auto-sync do boot, syncAllModules(session.tenantId) — um tenant só, e
  // `null` na sessão de admin global. Gerando pra uma empresa diferente da
  // sessão ativa (RT/Admin com várias lojas visíveis, "Todas as empresas" ou
  // trocando no seletor), nada aqui garante que este aparelho já sincronizou
  // aquela loja: as seções saem vazias e caem no emptyMessage ("Nenhuma não
  // conformidade — parabéns.", "Sem dados de capacitação"...) como se
  // estivesse tudo conforme, sem avisar que é só ausência de dado LOCAL.
  // Não dá pra saber com certeza se falta dado (exigiria sincronizar cada
  // módulo de cada tenant visível antes de gerar — mudança de arquitetura,
  // fora do escopo deste conserto); o que dá pra fazer sem mexer em como os
  // dados são buscados é avisar sempre que o alvo não é a própria empresa da
  // sessão, que é exatamente quando o risco existe. Achado da auditoria
  // (19/08).
  const deviceMismatch = tenant.id !== session?.tenantId;
  return dossier.buildDossierHtml({ tenantName: tenant.name, periodLabel, companyProfile: readCompanyProfile(tenant.id), sections, generatedAt: Date.now(), deviceMismatch });
}

// Resultado a mostrar pra tela dado quantas empresas foram PEDIDAS vs quantas
// janelas de fato ABRIRAM. Extraído pra função pura (sem window.open, sem
// I/O) porque `count: tenants.length` mentia quando o bloqueador de pop-up
// barrava uma janela no meio do loop — com "Todas as empresas" a ativação do
// clique se esgota na 1ª janela, `if (!win) continue` pulava as seguintes em
// silêncio, e a tela ainda assim dizia "✓ Dossiê gerado para 4 empresas" com
// só 1 aberta. Achado da auditoria de 18/08 (T6).
export function summarizeDossieRun(requested, opened) {
  if (opened >= requested) return { ok: true, count: opened };
  const message = requested === 1
    ? 'O navegador bloqueou a janela de impressão. Libere pop-ups para este site e gere de novo.'
    : `O navegador bloqueou ${requested - opened} de ${requested} janelas de impressão (abriu só ${opened}). Libere pop-ups para este site e gere de novo, ou selecione uma empresa por vez.`;
  return { ok: false, message };
}

export function DossieView({ allTenants, records, session }) {
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
      let opened = 0;
      for (const tenant of tenants) {
        const html = await generateTenantDossier({ tenant, records, periodDays, periodLabel, session });
        const win = window.open('', '_blank');
        if (!win) continue; // bloqueado pelo navegador — não conta como gerado
        win.document.write(html);
        win.document.close();
        setTimeout(() => win.print(), 400);
        opened++;
      }
      setResult(summarizeDossieRun(tenants.length, opened));
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
