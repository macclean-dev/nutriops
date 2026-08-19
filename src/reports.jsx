import React, { useMemo, useState } from 'react';
import { Th, useOrdenacao } from './tabela-ordenavel';
import { readFormRecords, readFormTemplates, catMeta, formatPeriodLabel, getPeriodKey, freqLabel } from './forms';
import { readSessions } from './training';
import { resolveRecordTone as resolveTemperatureTone } from './limits';
import { employeeTrainingStatus } from './training-status';

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
}

function pct(n, total) { return total > 0 ? Math.round((n/total)*100) : 0; }

// ─── Temperature Report ────────────────────────────────────────────────────


// Colunas ordenáveis da tabela por equipamento. `tipo` explícito: 'numero' pra
// tudo que é medida — média/mín/máx vêm como string formatada ('-11.5') e
// comparadas como texto ficam fora de ordem — e 'data' pro último registro.
const COLS_EQUIP = {
  tenant:     { valor: (s) => s.tenant,     tipo: 'texto'  },
  equip:      { valor: (s) => s.equip,      tipo: 'texto'  },
  total:      { valor: (s) => s.total,      tipo: 'numero' },
  avg:        { valor: (s) => s.avg,        tipo: 'numero' },
  min:        { valor: (s) => s.min,        tipo: 'numero' },
  max:        { valor: (s) => s.max,        tipo: 'numero' },
  ok:         { valor: (s) => s.ok,         tipo: 'numero' },
  warn:       { valor: (s) => s.warn,       tipo: 'numero' },
  danger:     { valor: (s) => s.danger,     tipo: 'numero' },
  compliance: { valor: (s) => s.compliance, tipo: 'numero' },
  last:       { valor: (s) => s.last?.createdAt, tipo: 'data' },
};

function TemperatureReport({ allTenants, records, periodDays, tenantFilter }) {
  const filtered = useMemo(() => {
    const cutoff = Date.now() - periodDays * 86400000;
    return records.filter((r) => {
      if (tenantFilter !== 'all' && r.tenantId !== tenantFilter) return false;
      return new Date(r.createdAt).getTime() >= cutoff;
    });
  }, [records, periodDays, tenantFilter]);

  // Per-equipment stats
  const equipStats = useMemo(() => {
    const map = new Map();
    for (const r of filtered) {
      const key = `${r.tenantId}::${r.equipment || r.equipmentInput}`;
      if (!map.has(key)) map.set(key, { tenant: r.tenantName, equip: r.equipment || r.equipmentInput, records: [] });
      map.get(key).records.push(r);
    }
    return [...map.values()].map(({ tenant, equip, records: recs }) => {
      const vals = recs.map((r) => Number(r.value)).filter((v) => !isNaN(v));
      const ok = recs.filter((r) => resolveTemperatureTone(r) === 'ok').length;
      const warn = recs.filter((r) => resolveTemperatureTone(r) === 'warn').length;
      const danger = recs.filter((r) => resolveTemperatureTone(r) === 'danger').length;
      return {
        tenant, equip, total: recs.length, ok, warn, danger,
        compliance: pct(ok, recs.length),
        avg: vals.length ? (vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(1) : '—',
        min: vals.length ? Math.min(...vals).toFixed(1) : '—',
        max: vals.length ? Math.max(...vals).toFixed(1) : '—',
        last: recs.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt))[0],
      };
    }).sort((a,b) => a.tenant.localeCompare(b.tenant,'pt-BR'));
  }, [filtered]);

  const { ordem, aoClicar, ordenar } = useOrdenacao();
  const linhasEquip = ordenar(equipStats, COLS_EQUIP);

  const totals = { total: filtered.length, ok: filtered.filter(r=>resolveTemperatureTone(r)==='ok').length, warn: filtered.filter(r=>resolveTemperatureTone(r)==='warn').length, danger: filtered.filter(r=>resolveTemperatureTone(r)==='danger').length };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Summary cards */}
      <div className="audit-stats">
        <div className="audit-stat"><span>Registros</span><strong>{totals.total}</strong></div>
        <div className="audit-stat ok"><span>Conformes</span><strong>{totals.ok}</strong></div>
        <div className="audit-stat warn"><span>Desvio leve</span><strong>{totals.warn}</strong></div>
        <div className="audit-stat danger"><span>Fora da faixa</span><strong>{totals.danger}</strong></div>
        <div className="audit-stat"><span>Conformidade geral</span><strong>{pct(totals.ok, totals.total)}%</strong></div>
      </div>

      {/* Per-equipment table */}
      <div className="audit-table-wrap">
        <table className="table">
          <thead><tr>
            <Th id="tenant" ordem={ordem} onClick={aoClicar}>Empresa</Th>
            <Th id="equip"  ordem={ordem} onClick={aoClicar}>Equipamento</Th>
            <Th id="total"  ordem={ordem} onClick={aoClicar} num>Registros</Th>
            <Th id="avg"    ordem={ordem} onClick={aoClicar} num>Média</Th>
            <Th id="min"    ordem={ordem} onClick={aoClicar} num>Mín.</Th>
            <Th id="max"    ordem={ordem} onClick={aoClicar} num>Máx.</Th>
            <Th id="ok"     ordem={ordem} onClick={aoClicar} num>Conformes</Th>
            <Th id="warn"   ordem={ordem} onClick={aoClicar} num>Desvios</Th>
            <Th id="danger" ordem={ordem} onClick={aoClicar} num>Críticos</Th>
            <Th id="compliance" ordem={ordem} onClick={aoClicar} num>Conformidade</Th>
            <Th id="last"   ordem={ordem} onClick={aoClicar}>Último registro</Th>
          </tr></thead>
          <tbody>
            {linhasEquip.map((s, i) => (
              <tr key={i}>
                <td>{s.tenant}</td>
                <td><strong>{s.equip}</strong></td>
                <td style={{ fontFamily:'var(--mono)', fontWeight:700 }}>{s.total}</td>
                <td style={{ fontFamily:'var(--mono)' }}>{s.avg}°C</td>
                <td style={{ fontFamily:'var(--mono)' }}>{s.min}°C</td>
                <td style={{ fontFamily:'var(--mono)' }}>{s.max}°C</td>
                <td><span style={{ color:'var(--green)', fontWeight:700 }}>{s.ok}</span></td>
                <td><span style={{ color:'var(--amber)', fontWeight:700 }}>{s.warn}</span></td>
                <td><span style={{ color:'var(--red)', fontWeight:700 }}>{s.danger}</span></td>
                <td>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:60, height:6, background:'var(--border-subtle)', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${s.compliance}%`, background: s.compliance>=90?'var(--green)':s.compliance>=70?'var(--amber)':'var(--red)', borderRadius:3 }} />
                    </div>
                    <strong style={{ fontFamily:'var(--mono)', color: s.compliance>=90?'var(--green)':s.compliance>=70?'var(--amber)':'var(--red)' }}>{s.compliance}%</strong>
                  </div>
                </td>
                <td style={{ fontSize:11, color:'var(--text-secondary)' }}>{s.last ? formatDate(s.last.createdAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── BPF Forms Report ──────────────────────────────────────────────────────


// As 3 colunas de período são o histórico daquela planilha, não um valor
// comparável entre linhas — não entram como ordenáveis.
const COLS_BPF = {
  tenant:    { valor: (s) => s.tenant,    tipo: 'texto'  },
  title:     { valor: (s) => s.title,     tipo: 'texto'  },
  category:  { valor: (s) => s.meta?.label ?? s.category, tipo: 'texto' },
  frequency: { valor: (s) => s.frequency, tipo: 'texto'  },
  total:     { valor: (s) => s.total,     tipo: 'numero' },
  validated: { valor: (s) => s.validated, tipo: 'numero' },
};

function BPFReport({ allTenants, tenantFilter }) {
  const stats = useMemo(() => {
    const result = [];
    const tenants = tenantFilter === 'all' ? allTenants : allTenants.filter(t => t.id === tenantFilter);
    for (const tenant of tenants) {
      const templates = readFormTemplates(tenant);
      const records   = readFormRecords(tenant.id);
      for (const tpl of templates) {
        const tplRecords = records.filter(r => r.formId === tpl.id);
        const submitted  = tplRecords.filter(r => r.status === 'submitted').length;
        const validated  = tplRecords.filter(r => r.validation).length;
        const meta       = catMeta(tpl.category);
        // Last 3 periods
        const now = new Date();
        const periods = [];
        for (let i = 0; i < 3; i++) {
          const d = new Date(now.getTime() - i * (tpl.frequency==='daily'?86400000:tpl.frequency==='weekly'?7*86400000:tpl.frequency==='biweekly'?15*86400000:30*86400000));
          const pk = getPeriodKey(tpl.frequency, d);
          const rec = tplRecords.find(r => r.periodKey === pk);
          periods.push({ key: pk, label: formatPeriodLabel(tpl.frequency, pk), status: rec?.status ?? 'missing', validated: Boolean(rec?.validation) });
        }
        result.push({ tenant: tenant.name, title: tpl.title, category: tpl.category, frequency: tpl.frequency, total: tplRecords.length, submitted, validated, meta, periods });
      }
    }
    return result;
  }, [allTenants, tenantFilter]);

  const { ordem: ordemBpf, aoClicar: clicarBpf, ordenar: ordenarBpf } = useOrdenacao();
  const linhasBpf = ordenarBpf(stats, COLS_BPF);

  return (
    <div className="audit-table-wrap">
      <table className="table">
        <thead><tr>
          <Th id="tenant"    ordem={ordemBpf} onClick={clicarBpf}>Empresa</Th>
          <Th id="title"     ordem={ordemBpf} onClick={clicarBpf}>Planilha</Th>
          <Th id="category"  ordem={ordemBpf} onClick={clicarBpf}>Categoria</Th>
          <Th id="frequency" ordem={ordemBpf} onClick={clicarBpf}>Frequência</Th>
          <th>Período atual</th><th>Período anterior</th><th>2 períodos atrás</th>
          <Th id="total"     ordem={ordemBpf} onClick={clicarBpf} num>Total preenchimentos</Th>
          <Th id="validated" ordem={ordemBpf} onClick={clicarBpf} num>Validados RT</Th>
        </tr></thead>
        <tbody>
          {linhasBpf.map((s, i) => (
            <tr key={i}>
              <td>{s.tenant}</td>
              <td><strong>{s.title}</strong></td>
              <td><span className="badge subtle" style={{ background:s.meta.bg, color:s.meta.color, borderColor:'transparent' }}>{s.meta.label}</span></td>
              <td>{freqLabel(s.frequency)}</td>
              {s.periods.map((p) => (
                <td key={p.key}>
                  <div style={{ fontSize:11 }}>
                    <div style={{ fontWeight:600, marginBottom:2, fontSize:10, color:'var(--text-secondary)' }}>{p.label}</div>
                    <span className={`badge ${p.status==='submitted'?'ok':p.status==='draft'?'warn':'danger'}`} style={{ fontSize:10 }}>
                      {p.status==='submitted'?'✓ Concluído':p.status==='draft'?'Rascunho':'Pendente'}
                    </span>
                    {p.validated && <span style={{ display:'block', fontSize:9, color:'var(--green)', marginTop:2 }}>RT ✓</span>}
                  </div>
                </td>
              ))}
              <td style={{ fontFamily:'var(--mono)', fontWeight:700 }}>{s.total}</td>
              <td style={{ fontFamily:'var(--mono)', fontWeight:700, color:'var(--green)' }}>{s.validated}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Training Report ───────────────────────────────────────────────────────


const COLS_TREINO = {
  tenant:        { valor: (r) => r.tenant,        tipo: 'texto'  },
  name:          { valor: (r) => r.name,          tipo: 'texto'  },
  role:          { valor: (r) => r.role,          tipo: 'texto'  },
  lastDate:      { valor: (r) => r.lastDate,      tipo: 'data'   },
  daysAgo:       { valor: (r) => r.daysAgo,       tipo: 'numero' },
  totalSessions: { valor: (r) => r.totalSessions, tipo: 'numero' },
  status:        { valor: (r) => r.status,        tipo: 'texto'  },
};

function TrainingReport({ allTenants, tenantFilter }) {
  const data = useMemo(() => {
    const tenants = tenantFilter === 'all' ? allTenants : allTenants.filter(t => t.id === tenantFilter);
    const rows = [];
    for (const tenant of tenants) {
      const sessions = readSessions(tenant.id);
      const closedSessions = sessions.filter(s => s.status === 'closed');
      const users = JSON.parse(localStorage.getItem(`nutriops.users.${tenant.id}`) ?? 'null') ?? tenant.usersList ?? [];
      const config = JSON.parse(localStorage.getItem(`nutriops.training.config.${tenant.id}`) ?? '{"validityMonths":12}');
      for (const user of users) {
        const r = employeeTrainingStatus(user.name, sessions, config.validityMonths ?? 12);
        const totalSessions = closedSessions.filter(s => s.participants.some(p => p.name === user.name && p.confirmed)).length;
        rows.push({ tenant: tenant.name, name: user.name, role: user.role, lastDate: r.session?.date ?? null, lastTitle: r.session?.title ?? null, daysAgo: r.daysAgo, status: r.status, totalSessions });
      }
    }
    return rows;
  }, [allTenants, tenantFilter]);

  const { ordem: ordemTr, aoClicar: clicarTr, ordenar: ordenarTr } = useOrdenacao();
  const linhasTr = ordenarTr(data, COLS_TREINO);

  const stLabel = { ok:'Em dia', warn:'Renovar em breve', expired:'Vencido', never:'Nunca capacitado' };
  const stTone  = { ok:'ok', warn:'warn', expired:'danger', never:'danger' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div className="audit-stats">
        {['ok','warn','expired','never'].map(s => (
          <div key={s} className={`audit-stat ${s==='ok'?'ok':s==='warn'?'warn':'danger'}`}>
            <span>{stLabel[s]}</span>
            <strong>{data.filter(r=>r.status===s).length}</strong>
          </div>
        ))}
      </div>
      <div className="audit-table-wrap">
        <table className="table">
          <thead><tr>
            <Th id="tenant"        ordem={ordemTr} onClick={clicarTr}>Empresa</Th>
            <Th id="name"          ordem={ordemTr} onClick={clicarTr}>Colaborador</Th>
            <Th id="role"          ordem={ordemTr} onClick={clicarTr}>Perfil</Th>
            <Th id="lastDate"      ordem={ordemTr} onClick={clicarTr}>Último treinamento</Th>
            <Th id="daysAgo"       ordem={ordemTr} onClick={clicarTr} num>Há quantos dias</Th>
            <Th id="totalSessions" ordem={ordemTr} onClick={clicarTr} num>Total de sessões</Th>
            <Th id="status"        ordem={ordemTr} onClick={clicarTr}>Situação</Th></tr></thead>
          <tbody>
            {linhasTr.map((r,i) => (
              <tr key={i}>
                <td>{r.tenant}</td>
                <td><strong>{r.name}</strong></td>
                <td>{r.role}</td>
                <td>{r.lastDate ? `${formatDate(r.lastDate)} — ${r.lastTitle}` : '—'}</td>
                <td style={{ fontFamily:'var(--mono)' }}>{r.daysAgo !== null ? `${r.daysAgo}d` : '—'}</td>
                <td style={{ fontFamily:'var(--mono)', fontWeight:700 }}>{r.totalSessions}</td>
                <td><span className={`badge ${stTone[r.status]}`}>{stLabel[r.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── PDF: Relatório Fiscal Consolidado ─────────────────────────────────────
// Cálculo e renderização exportados (não só usados aqui) pra o Dossiê
// completo (item 10 da revisão, dossier.js) reaproveitar a mesma fonte de
// verdade em vez de recalcular — mesma lição do item 7 (régua única).

export function computeTempStats(records, tenantId, periodDays) {
  const cutoff = Date.now() - periodDays * 86400000;
  const tenantRecords = records.filter(r => r.tenantId === tenantId && new Date(r.createdAt).getTime() >= cutoff);
  const equipMap = new Map();
  for (const r of tenantRecords) {
    const k = r.equipment || r.equipmentInput;
    if (!equipMap.has(k)) equipMap.set(k, []);
    equipMap.get(k).push(r);
  }
  return [...equipMap.entries()].map(([equip, recs]) => {
    const vals = recs.map(r => Number(r.value)).filter(v => !isNaN(v));
    const ok = recs.filter(r => resolveTemperatureTone(r) === 'ok').length;
    return {
      equip, total: recs.length, ok,
      warn: recs.filter(r => resolveTemperatureTone(r) === 'warn').length,
      danger: recs.filter(r => resolveTemperatureTone(r) === 'danger').length,
      compliance: pct(ok, recs.length),
      avg: vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '—',
    };
  });
}

export function computeBpfStats(tenant) {
  const templates = readFormTemplates(tenant);
  const formRecords = readFormRecords(tenant.id);
  return templates.map(tpl => {
    const tplRecs = formRecords.filter(r => r.formId === tpl.id);
    const pk = getPeriodKey(tpl.frequency);
    const current = tplRecs.find(r => r.periodKey === pk);
    const validated = tplRecs.filter(r => r.validation).length;
    return { title: tpl.title, frequency: tpl.frequency, periods: [{ status: current?.status ?? 'missing' }], validated };
  });
}

export function computeTrainingStats(tenant) {
  const sessions = readSessions(tenant.id);
  const users = JSON.parse(localStorage.getItem(`nutriops.users.${tenant.id}`) ?? 'null') ?? tenant.usersList ?? [];
  const trainingConfig = JSON.parse(localStorage.getItem(`nutriops.training.config.${tenant.id}`) ?? '{"validityMonths":12}');
  return users.map(user => {
    const r = employeeTrainingStatus(user.name, sessions, trainingConfig.validityMonths ?? 12);
    return { name: user.name, role: user.role, lastDate: r.session?.date ?? null, status: r.status };
  });
}

export function renderTempRows(tempStats) {
  return tempStats.map(s => `<tr>
    <td>${s.equip}</td><td>${s.total}</td>
    <td style="color:${s.compliance>=90?'#00a35c':s.compliance>=70?'#8a4e00':'#c0392b'};font-weight:700">${s.compliance}%</td>
    <td>${s.avg}°C</td><td>${s.ok}</td><td>${s.warn}</td><td>${s.danger}</td>
  </tr>`).join('');
}

export function renderBpfRows(bpfStats) {
  return bpfStats.map(s => `<tr>
    <td>${s.title}</td><td>${freqLabel(s.frequency)}</td>
    <td style="color:${s.periods[0]?.status==='submitted'?'#00a35c':'#c0392b'};font-weight:700">
      ${s.periods[0]?.status==='submitted'?'✓ Concluído':'Pendente'}
    </td>
    <td>${s.validated ? '<span style="color:#00a35c">✓ Validado</span>' : '—'}</td>
  </tr>`).join('');
}

export function renderTrainRows(trainingStats) {
  return trainingStats.map(s => `<tr>
    <td>${s.name}</td><td>${s.role}</td>
    <td>${s.lastDate ? formatDate(s.lastDate) : '—'}</td>
    <td style="color:${s.status==='ok'?'#00a35c':s.status==='warn'?'#8a4e00':'#c0392b'};font-weight:700">
      ${s.status==='ok'?'Em dia':s.status==='warn'?'Renovar em breve':s.status==='never'?'Nunca capacitado':'Vencido'}
    </td>
  </tr>`).join('');
}

function generateFiscalPDF({ tenant, periodLabel, tempStats, bpfStats, trainingStats }) {
  const date = new Date().toLocaleString('pt-BR');
  const tempRows = renderTempRows(tempStats);
  const bpfRows = renderBpfRows(bpfStats);
  const trainRows = renderTrainRows(trainingStats);

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>Relatório Fiscal — ${tenant}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:10px;color:#001e2b;padding:20px}
    h1{font-size:16px;font-weight:800;margin-bottom:4px}
    h2{font-size:12px;font-weight:700;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #c1ccd6;color:#00684a}
    .meta{color:#5c6c7a;font-size:9px;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #c1ccd6}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}
    th{background:#f9fbfa;padding:5px 8px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #c1ccd6;color:#5c6c7a}
    td{padding:6px 8px;border-bottom:1px solid #eaeef2;font-size:9px}
    tr:last-child td{border-bottom:none}
    .footer{margin-top:16px;padding-top:10px;border-top:1px solid #c1ccd6;display:flex;justify-content:space-between;font-size:8px;color:#9198a1}
    @page{size:A4;margin:12mm}
  </style></head><body>
  <h1>Relatório Fiscal de Conformidade Sanitária</h1>
  <div class="meta">
    <strong>${tenant}</strong> · Período: ${periodLabel} · Gerado em ${date} · RDC 216/2004 · NutriOPS
  </div>
  <h2>1. Controle de Temperatura</h2>
  <table><thead><tr><th>Equipamento</th><th>Registros</th><th>Conformidade</th><th>Temp. Média</th><th>Conformes</th><th>Desvios</th><th>Críticos</th></tr></thead>
  <tbody>${tempRows||'<tr><td colspan="7">Sem registros no período</td></tr>'}</tbody></table>
  <h2>2. Planilhas de Controle BPF</h2>
  <table><thead><tr><th>Planilha</th><th>Frequência</th><th>Período atual</th><th>Validação RT</th></tr></thead>
  <tbody>${bpfRows||'<tr><td colspan="4">Sem planilhas cadastradas</td></tr>'}</tbody></table>
  <h2>3. Capacitação de Colaboradors</h2>
  <table><thead><tr><th>Colaborador</th><th>Perfil</th><th>Último treinamento</th><th>Situação</th></tr></thead>
  <tbody>${trainRows||'<tr><td colspan="4">Sem dados de capacitação</td></tr>'}</tbody></table>
  <div class="footer">
    <span>NutriOPS · Conformidade Sanitária Digital</span>
    <span>RDC 216/2004 · MBPF</span>
    <span>${date}</span>
  </div>
  </body></html>`;
}

// ─── Main Reports View ─────────────────────────────────────────────────────

export function ReportsView({ allTenants, records }) {
  const [tab,          setTab]          = useState('temperature');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [periodDays,   setPeriodDays]   = useState(30);

  const periodLabel = { 7:'Últimos 7 dias', 30:'Últimos 30 dias', 90:'Últimos 90 dias' }[periodDays] ?? `${periodDays} dias`;

  const exportFiscal = () => {
    const tenants = tenantFilter === 'all' ? allTenants : allTenants.filter(t => t.id === tenantFilter);

    for (const tenant of tenants) {
      const tempStats = computeTempStats(records, tenant.id, periodDays);
      const bpfStats = computeBpfStats(tenant);
      const trainingStats = computeTrainingStats(tenant);

      const win = window.open('', '_blank');
      win.document.write(generateFiscalPDF({ tenant: tenant.name, periodLabel, tempStats, bpfStats, trainingStats }));
      win.document.close();
      setTimeout(() => win.print(), 400);
    }
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Análise e exportação</span>
          <h1>Relatórios</h1>
          <p className="muted">Indicadores consolidados para gestão e fiscalização sanitária.</p>
        </div>
        <div className="page-actions">
          <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} style={{ width:'auto' }}>
            <option value="all">Todas as empresas</option>
            {allTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} style={{ width:'auto' }}>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <button className="primary-action" style={{ fontSize:12 }} onClick={exportFiscal}>↓ Relatório fiscal PDF</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:20 }}>
        {[
          ['temperature', 'Temperatura'],
          ['bpf',         'Planilhas BPF'],
          ['training',    'Capacitação'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding:'7px 16px', borderRadius:8, border:'1px solid var(--border)', background:tab===key?'var(--text)':'var(--surface)', color:tab===key?'white':'var(--text)', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'temperature' && <TemperatureReport allTenants={allTenants} records={records} periodDays={periodDays} tenantFilter={tenantFilter} />}
      {tab === 'bpf'         && <BPFReport allTenants={allTenants} tenantFilter={tenantFilter} />}
      {tab === 'training'    && <TrainingReport allTenants={allTenants} tenantFilter={tenantFilter} />}
    </section>
  );
}
