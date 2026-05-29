import React, { lazy, Suspense, useState, useMemo, useEffect } from 'react';
import { getTemperatureRepository } from './repository';
import { resolveLimits as resolveLimitsFromCatalog } from './limits';

const EquipmentDetailModal = lazy(() => import('./equipment-detail').then(m => ({ default: m.EquipmentDetailModal })));

const catalogKey = (id) => `nutriops.equipment.catalog.${id}`;
const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const readEquipmentCatalog = (t) => load(catalogKey(t.id), t.equipmentCatalog ?? []);

function resolveTemperatureTone(record) {
  const v = Number(record?.value), mn = Number(record?.min), mx = Number(record?.max);
  if (isNaN(v) || isNaN(mn) || isNaN(mx)) return 'neutral';
  if (v >= mn && v <= mx) return 'ok';
  if (v >= mn - 3 && v <= mx + 3) return 'warn';
  return 'danger';
}

function formatCompactDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function generateAuditHTML(records, tenantName) {
  const date = new Date().toLocaleString('pt-BR'), title = tenantName ? `Auditoria — ${tenantName}` : 'Auditoria — NutriOPS';
  const tl = (r) => { const t = resolveTemperatureTone(r); return t === 'ok' ? 'Conforme' : t === 'warn' ? 'Desvio leve' : 'Fora da faixa'; };
  const rows = records.map((r) => `<tr><td>${formatCompactDateTime(r.createdAt)}</td><td>${r.tenantName ?? ''}</td><td>${r.equipmentInput || r.equipment || ''}</td><td><strong>${r.value}°C</strong></td><td>${r.min ?? '?'}–${r.max ?? '?'}°C</td><td>${r.user ?? ''}<br/><small>${r.role ?? ''}</small></td><td>${tl(r)}</td><td>${r.note || '—'}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${title}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1c2128;padding:24px}h1{font-size:18px;font-weight:800;margin-bottom:4px}.meta{color:#656d76;font-size:10px;margin-bottom:20px}table{width:100%;border-collapse:collapse}th{background:#f6f8fa;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #d0d7de;color:#656d76}td{padding:7px 8px;border-bottom:1px solid #eaeef2;vertical-align:top}tr:last-child td{border-bottom:none}small{font-size:9px;color:#656d76}strong{font-size:12px}@page{size:A4 landscape;margin:14mm}</style>
  </head><body><h1>${title}</h1><p class="meta">Gerado em ${date} · ${records.length} registros · RDC 216/2004 · NutriOPS</p>
  <table><thead><tr><th>Data/Hora</th><th>Empresa</th><th>Equipamento</th><th>Temp.</th><th>Faixa</th><th>Responsável</th><th>Status</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function TempLineChart({ records, equipment, height = 180 }) {
  const [hover, setHover] = useState(null); // índice do ponto sob o mouse
  const data = useMemo(() => records
    .filter((r) => (r.equipment || r.equipmentInput) === equipment && !isNaN(Number(r.value)))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-30), [records, equipment]);
  // Limpa o hover ao trocar de equipamento pra não mostrar ponto stale
  useEffect(() => { setHover(null); }, [equipment]);

  if (data.length < 2) return (
    <div style={{ height, display: 'grid', placeItems: 'center', background: 'var(--surface-muted)', borderRadius: 'var(--r)', border: '1px solid var(--border-subtle)' }}>
      <p className="muted" style={{ fontSize: 12 }}>Mín. 2 registros para exibir o gráfico.</p>
    </div>
  );

  const limits = resolveLimitsFromCatalog(equipment, null);
  const values = data.map((r) => Number(r.value));
  const allY   = [...values, limits.min - 3, limits.max + 3];
  const minY   = Math.min(...allY), maxY = Math.max(...allY), rangeY = maxY - minY || 1;
  const W = 560, H = height;
  const pad = { top: 20, right: 16, bottom: 30, left: 38 };
  const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
  const sx = (i) => (i / (data.length - 1)) * cW;
  const sy = (v) => cH - ((v - minY) / rangeY) * cH;
  const pts = data.map((r, i) => ({ x: sx(i), y: sy(Number(r.value)), r }));
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${cH} L0,${cH} Z`;
  const bandTop = sy(limits.max), bandBot = sy(limits.min);
  const xLabels = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
      <g transform={`translate(${pad.left},${pad.top})`}>
        <rect x={0} y={bandTop} width={cW} height={Math.max(0, bandBot - bandTop)} fill="rgba(26,127,55,.07)" rx={2} />
        <line x1={0} y1={bandTop} x2={cW} y2={bandTop} stroke="#4ac26b" strokeDasharray="4 3" strokeWidth={1} opacity={.7} />
        <line x1={0} y1={bandBot} x2={cW} y2={bandBot} stroke="#4ac26b" strokeDasharray="4 3" strokeWidth={1} opacity={.7} />
        <text x={cW + 4} y={bandTop} fontSize={9} fill="#1a7f37" dominantBaseline="middle">máx {limits.max}°</text>
        <text x={cW + 4} y={bandBot} fontSize={9} fill="#1a7f37" dominantBaseline="middle">mín {limits.min}°</text>
        <path d={areaPath} fill="#1d4e89" fillOpacity={.06} />
        <path d={linePath} fill="none" stroke="#1d4e89" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => {
          const tone = resolveTemperatureTone(p.r);
          const color = tone === 'ok' ? '#1a7f37' : tone === 'warn' ? '#9a6700' : '#cf222e';
          const active = hover === i;
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={active ? 5.5 : 3.5} fill={color} stroke="white" strokeWidth={1.5} style={{ transition: 'r .1s ease' }} />
              {/* Área de captura invisível maior — facilita o hover num ponto de 3.5px */}
              <circle cx={p.x} cy={p.y} r={14} fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))} />
            </g>
          );
        })}
        {[limits.min, (limits.min + limits.max) / 2, limits.max].map((v) => (
          <g key={v}>
            <line x1={0} y1={sy(v)} x2={-5} y2={sy(v)} stroke="#d0d7de" strokeWidth={1} />
            <text x={-9} y={sy(v)} dominantBaseline="middle" textAnchor="end" fontSize={9} fill="#656d76" fontFamily="monospace">{v}°</text>
          </g>
        ))}
        <line x1={0} y1={0} x2={0} y2={cH} stroke="#d0d7de" strokeWidth={1} />
        <line x1={0} y1={cH} x2={cW} y2={cH} stroke="#d0d7de" strokeWidth={1} />
        {xLabels.map((i) => (
          <text key={i} x={sx(i)} y={cH + 14} textAnchor="middle" fontSize={9} fill="#656d76">
            {new Date(data[i].createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </text>
        ))}
        {/* Tooltip do ponto sob o mouse — renderizado por último pra ficar por cima */}
        {hover != null && hover < pts.length && (() => {
          const p = pts[hover];
          const bw = 86, bh = 32;
          const bx = Math.max(0, Math.min(cW - bw, p.x - bw / 2));   // clamp horizontal
          const above = p.y - bh - 12 >= 0;
          const by = above ? p.y - bh - 12 : p.y + 12;               // abaixo se não couber em cima
          const fmt = new Date(p.r.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={bx} y={by} width={bw} height={bh} rx={6} fill="#1c1b19" opacity={0.96} />
              <text x={bx + bw / 2} y={by + 14} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff" fontFamily="var(--mono, monospace)">{p.r.value}°C</text>
              <text x={bx + bw / 2} y={by + 26} textAnchor="middle" fontSize={8} fill="#b8b1a6">{fmt}</text>
            </g>
          );
        })()}
      </g>
    </svg>
  );
}

export function DashboardView({ allTenants, records, activeTenant, onTenantChange }) {
  const now = Date.now();
  const [period, setPeriod] = useState(30);
  const [drill, setDrill] = useState(null);

  const drillHistory = useMemo(() => {
    if (!drill) return [];
    const norm = s => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const target = norm(drill.equipment.label);
    return records
      .filter(r => r.tenantId === drill.tenant.id)
      .filter(r => {
        const cands = [r.equipment, r.equipmentInput, r.equipmentKey].filter(Boolean);
        return cands.some(c => norm(c) === target);
      })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }, [records, drill]);

  const stats = useMemo(() => allTenants.map((tenant) => {
    const tr = records.filter((r) => r.tenantId === tenant.id && now - new Date(r.createdAt).getTime() <= period * 86400000);
    const ok = tr.filter((r) => resolveTemperatureTone(r) === 'ok').length;
    const warn = tr.filter((r) => resolveTemperatureTone(r) === 'warn').length;
    const danger = tr.filter((r) => resolveTemperatureTone(r) === 'danger').length;
    const total = tr.length, compliance = total > 0 ? Math.round((ok / total) * 100) : 0;
    const today = tr.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString()).length;
    const catalog = readEquipmentCatalog(tenant);
    const equipStats = catalog.map((eq) => {
      const er = tr.filter((r) => (r.equipment || r.equipmentInput) === eq.label);
      const eOk = er.filter((r) => resolveTemperatureTone(r) === 'ok').length;
      return { label: eq.label, total: er.length, ok: eOk, pct: er.length > 0 ? Math.round((eOk / er.length) * 100) : null };
    });
    const last7 = records.filter((r) => r.tenantId === tenant.id && now - new Date(r.createdAt).getTime() <= 7 * 86400000);
    const trend = last7.length > 0 ? Math.round((last7.filter(r=>resolveTemperatureTone(r)==='ok').length / last7.length) * 100) : null;

    let trainingAlertCount = 0;
    try {
      const sessions = JSON.parse(localStorage.getItem(`nutriops.training.sessions.${tenant.id}`) ?? '[]');
      const config   = JSON.parse(localStorage.getItem(`nutriops.training.config.${tenant.id}`) ?? '{"validityMonths":12}');
      const users    = JSON.parse(localStorage.getItem(`nutriops.users.${tenant.id}`) ?? 'null') ?? tenant.usersList ?? [];
      const limitDays = (config.validityMonths ?? 12) * 30;
      trainingAlertCount = users.filter(u => {
        const done = sessions.filter(s => s.status==='closed' && s.participants?.some(p=>p.name===u.name&&p.confirmed)).sort((a,b)=>new Date(b.date)-new Date(a.date));
        const last = done[0];
        if (!last) return true;
        const daysAgo = Math.floor((now - new Date(last.date).getTime()) / 86400000);
        return daysAgo >= limitDays * 0.85;
      }).length;
    } catch { /**/ }

    const storeStats = tenant.multiStore && tenant.stores?.length > 1 ? tenant.stores.map(store => {
      const sr = tr.filter(r => r.storeId === store.id || r.storeName === store.name);
      const sOk = sr.filter(r => resolveTemperatureTone(r) === 'ok').length;
      return { store, total: sr.length, compliance: sr.length > 0 ? Math.round((sOk/sr.length)*100) : null };
    }) : [];

    return { tenant, total, ok, warn, danger, compliance, today, equipStats, trend, trainingAlertCount, storeStats };
  }), [allTenants, records, now, period]);

  const consolidated = useMemo(() => stats.reduce((acc, s) => ({
    total: acc.total + s.total, ok: acc.ok + s.ok,
    warn: acc.warn + s.warn, danger: acc.danger + s.danger, today: acc.today + s.today,
  }), { total:0, ok:0, warn:0, danger:0, today:0 }), [stats]);
  const globalCompliance = consolidated.total > 0 ? Math.round((consolidated.ok / consolidated.total) * 100) : 0;

  const printDashboard = () => {
    const date = new Date().toLocaleString('pt-BR');
    const rows = stats.map(s => `<tr>
      <td><strong>${s.tenant.name}</strong></td>
      <td style="font-family:monospace;font-weight:700;color:${s.compliance>=90?'#1a7f37':s.compliance>=70?'#9a6700':'#cf222e'}">${s.compliance}%</td>
      <td>${s.total}</td><td style="color:#1a7f37">${s.ok}</td>
      <td style="color:#9a6700">${s.warn}</td><td style="color:#cf222e">${s.danger}</td>
      <td>${s.today}</td><td>${s.trend !== null ? `${s.trend}%` : '—'}</td>
    </tr>`).join('');
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Dashboard Executivo — NutriOPS</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1c2128;padding:24px}
    h1{font-size:18px;font-weight:800;margin-bottom:4px}.meta{color:#656d76;font-size:9px;margin-bottom:16px}
    .kpi-row{display:flex;gap:16px;margin-bottom:20px}.kpi{flex:1;padding:12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px}
    .kpi span{font-size:9px;color:#656d76;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px}
    .kpi strong{font-size:22px;font-weight:800;font-family:monospace}
    table{width:100%;border-collapse:collapse}th{background:#f6f8fa;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #d0d7de;color:#656d76}
    td{padding:7px 8px;border-bottom:1px solid #eaeef2}
    .footer{margin-top:16px;padding-top:10px;border-top:1px solid #d0d7de;font-size:8px;color:#9198a1;display:flex;justify-content:space-between}
    @page{size:A4;margin:14mm}</style></head><body>
    <h1>Dashboard Executivo — NutriOPS</h1>
    <p class="meta">Período: últimos ${period} dias · Gerado em ${date} · RDC 216/2004</p>
    <div class="kpi-row">
      <div class="kpi"><span>Conformidade global</span><strong style="color:${globalCompliance>=90?'#1a7f37':globalCompliance>=70?'#9a6700':'#cf222e'}">${globalCompliance}%</strong></div>
      <div class="kpi"><span>Total de registros</span><strong>${consolidated.total}</strong></div>
      <div class="kpi"><span>Conformes</span><strong style="color:#1a7f37">${consolidated.ok}</strong></div>
      <div class="kpi"><span>Desvios</span><strong style="color:#9a6700">${consolidated.warn}</strong></div>
      <div class="kpi"><span>Críticos</span><strong style="color:#cf222e">${consolidated.danger}</strong></div>
      <div class="kpi"><span>Registros hoje</span><strong>${consolidated.today}</strong></div>
    </div>
    <table><thead><tr><th>Empresa</th><th>Conformidade</th><th>Registros</th><th>Conformes</th><th>Desvios</th><th>Críticos</th><th>Hoje</th><th>Tendência 7d</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer"><span>NutriOPS · Conformidade Sanitária Digital</span><span>${date}</span></div>
    </body></html>`);
    win.document.close(); setTimeout(() => win.print(), 400);
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Visão executiva</span>
          <h1>Conformidade</h1>
          <p className="muted">Consolidado de todas as empresas e equipamentos.</p>
        </div>
        <div className="page-actions">
          <select value={period} onChange={e=>setPeriod(Number(e.target.value))} style={{ width:'auto' }}>
            <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option>
          </select>
          <button className="secondary-action" style={{ fontSize:12 }} onClick={printDashboard}>↓ PDF executivo</button>
        </div>
      </div>

      {allTenants.length > 1 && (
        <div className="audit-stats" style={{ marginBottom:20 }}>
          <div className="audit-stat" style={{ borderTop:`3px solid ${globalCompliance>=90?'var(--green)':globalCompliance>=70?'var(--amber)':'var(--red)'}` }}>
            <span>Conformidade global</span>
            <strong style={{ color: globalCompliance>=90?'var(--green)':globalCompliance>=70?'var(--amber)':'var(--red)' }}>{globalCompliance}%</strong>
          </div>
          <div className="audit-stat"><span>Total registros</span><strong>{consolidated.total}</strong></div>
          <div className="audit-stat ok"><span>Conformes</span><strong>{consolidated.ok}</strong></div>
          <div className="audit-stat warn"><span>Desvios</span><strong>{consolidated.warn}</strong></div>
          <div className="audit-stat danger"><span>Críticos</span><strong>{consolidated.danger}</strong></div>
          <div className="audit-stat"><span>Hoje (todas)</span><strong>{consolidated.today}</strong></div>
        </div>
      )}

      <div className="dashboard-grid">
        {stats.map(({ tenant, total, ok, warn, danger, compliance, today, equipStats, trend, trainingAlertCount, storeStats }) => (
          <article key={tenant.id} className={`dash-card ${activeTenant.id === tenant.id ? 'active' : ''}`}
            style={{ borderTopColor: tenant.brandColor }} onClick={() => onTenantChange(tenant.id)}>
            <div className="dash-card-head">
              <div>
                <span className="eyebrow">{tenant.segment}</span>
                <h2 style={{ color: tenant.brandColor }}>{tenant.name}</h2>
                {trainingAlertCount > 0 && (
                  <div style={{ marginTop:4 }}>
                    <span className="badge warn" style={{ fontSize:10 }}>🎓 {trainingAlertCount} capacitação{trainingAlertCount!==1?'ões':''} vencendo</span>
                  </div>
                )}
              </div>
              <div className="dash-compliance">
                <strong style={{ color: compliance>=90?'var(--green)':compliance>=70?'var(--amber)':'var(--red)' }}>{compliance}%</strong>
                <span>conformidade</span>
                {trend !== null && (
                  <span style={{ fontSize:10, color: trend >= compliance ? 'var(--green)' : 'var(--red)', display:'block' }}>
                    {trend >= compliance ? '↑' : '↓'} {trend}% (7d)
                  </span>
                )}
              </div>
            </div>
            <div className="compliance-bar-wrap"><div className="compliance-bar">
              {total > 0 && <><div className="cb-ok" style={{ width:`${(ok/total)*100}%` }} /><div className="cb-warn" style={{ width:`${(warn/total)*100}%` }} /><div className="cb-danger" style={{ width:`${(danger/total)*100}%` }} /></>}
            </div></div>
            <div className="dash-stats">
              <div className="dash-stat"><span>Registros</span><strong>{total}</strong></div>
              <div className="dash-stat ok"><span>Conformes</span><strong>{ok}</strong></div>
              <div className="dash-stat warn"><span>Desvios</span><strong>{warn}</strong></div>
              <div className="dash-stat danger"><span>Críticos</span><strong>{danger}</strong></div>
              <div className="dash-stat"><span>Hoje</span><strong>{today}</strong></div>
            </div>
            {equipStats.length > 0 && (
              <div className="equip-breakdown">
                {equipStats.map((eq) => (
                  <button key={eq.label} className="equip-bar-row"
                    onClick={(e) => {
                      e.stopPropagation();
                      const equipment = readEquipmentCatalog(tenant).find(x => x.label === eq.label) ?? { label: eq.label };
                      setDrill({ tenant, equipment });
                    }}
                    title="Abrir histórico do equipamento"
                    style={{ background:'none', border:'none', cursor:'pointer', textAlign:'left', width:'100%', padding:0, fontFamily:'inherit', color:'inherit' }}>
                    <span>{eq.label}</span>
                    <div className="equip-bar-track"><div className="equip-bar-fill" style={{ width:`${eq.pct??0}%`, background: eq.pct===null?'var(--border)':eq.pct>=90?'var(--green)':eq.pct>=70?'var(--amber)':'var(--red)' }} /></div>
                    <strong>{eq.pct !== null ? `${eq.pct}%` : '—'}</strong>
                  </button>
                ))}
              </div>
            )}
            {storeStats.length > 0 && (
              <div style={{ padding:'8px 16px 4px', borderTop:'1px solid var(--border-subtle)' }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', marginBottom:6 }}>Por loja</div>
                {storeStats.map(({ store, total, compliance }) => (
                  <div key={store.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 0', fontSize:12 }}>
                    <span style={{ color:'var(--text-secondary)' }}>📍 {store.location}</span>
                    <span style={{ fontWeight:700, fontFamily:'var(--mono)', fontSize:13, color: compliance===null?'var(--text-secondary)':compliance>=90?'var(--green)':compliance>=70?'var(--amber)':'var(--red)' }}>
                      {compliance !== null ? `${compliance}%` : `${total} reg.`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      {drill && (
        <Suspense fallback={null}>
          <EquipmentDetailModal
            equipment={drill.equipment}
            history={drillHistory}
            onClose={() => setDrill(null)}
          />
        </Suspense>
      )}
    </section>
  );
}

export function ChartsView({ activeTenant, allTenants, onTenantChange, records }) {
  const catalog = readEquipmentCatalog(activeTenant);
  const [selectedEquipment, setSelectedEquipment] = useState(catalog[0]?.label ?? '');
  const [periodDays, setPeriodDays] = useState('30');
  const [drillEq, setDrillEq] = useState(null);

  useEffect(() => { setSelectedEquipment(readEquipmentCatalog(activeTenant)[0]?.label ?? ''); }, [activeTenant.id]);

  const tenantRecords = useMemo(() => {
    const cutoff = Date.now() - Number(periodDays) * 86400000;
    return records.filter((r) => r.tenantId === activeTenant.id && new Date(r.createdAt).getTime() >= cutoff);
  }, [records, activeTenant.id, periodDays]);

  const drillHistory = useMemo(() => {
    if (!drillEq) return [];
    return tenantRecords
      .filter(r => (r.equipment || r.equipmentInput || r.equipmentKey) === drillEq.label)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }, [tenantRecords, drillEq]);

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Tendência e histórico</span><h1>Gráficos</h1><p className="muted">Evolução das temperaturas por equipamento.</p></div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width: 'auto' }}>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} style={{ width: 'auto' }}>
            <option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option>
          </select>
        </div>
      </div>

      <div className="chip-row" style={{ marginBottom: 16 }}>
        {catalog.map((eq) => (
          <button key={eq.label} className={`quick-chip ${selectedEquipment === eq.label ? 'active' : ''}`} onClick={() => setSelectedEquipment(eq.label)}>
            <strong>{eq.label}</strong>
            <span>{tenantRecords.filter((r) => (r.equipment || r.equipmentInput) === eq.label).length} registros</span>
          </button>
        ))}
      </div>

      {selectedEquipment && (
        <div className="chart-card">
          <div className="card-head">
            <div><span className="eyebrow">Temperatura ao longo do tempo</span><h2>{selectedEquipment} · {activeTenant.name}</h2></div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />Conforme</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block' }} />Desvio</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />Crítico</span>
              <button onClick={() => setDrillEq(catalog.find(eq => eq.label === selectedEquipment) ?? { label: selectedEquipment })}
                style={{ marginLeft:6, padding:'5px 12px', borderRadius:'var(--r)', border:'1px solid var(--primary)', background:'transparent', color:'var(--primary)', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                Detalhes completos →
              </button>
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <TempLineChart records={tenantRecords} equipment={selectedEquipment} height={200} />
          </div>
        </div>
      )}

      <div className="dashboard-grid" style={{ marginTop: 16 }}>
        {catalog.map((eq) => {
          const er = tenantRecords.filter((r) => (r.equipment || r.equipmentInput) === eq.label);
          const eOk = er.filter((r) => resolveTemperatureTone(r) === 'ok').length;
          const eWarn = er.filter((r) => resolveTemperatureTone(r) === 'warn').length;
          const eDanger = er.filter((r) => resolveTemperatureTone(r) === 'danger').length;
          const pct = er.length > 0 ? Math.round((eOk / er.length) * 100) : null;
          const last = er[0];
          return (
            <article key={eq.label} className={`dash-card ${selectedEquipment === eq.label ? 'active' : ''}`} style={{ borderTopColor: pct === null ? 'var(--border)' : pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)', cursor: 'pointer' }} onClick={() => setDrillEq(eq)} title="Abrir histórico completo">
              <div className="dash-card-head">
                <div><span className="eyebrow">Equipamento</span><h2>{eq.label}</h2></div>
                <div className="dash-compliance">
                  <strong style={{ color: pct === null ? 'var(--text-secondary)' : pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)' }}>{pct !== null ? `${pct}%` : '—'}</strong>
                  <span>conformidade</span>
                </div>
              </div>
              <div className="dash-stats">
                <div className="dash-stat"><span>Total</span><strong>{er.length}</strong></div>
                <div className="dash-stat ok"><span>OK</span><strong>{eOk}</strong></div>
                <div className="dash-stat warn"><span>Desvio</span><strong>{eWarn}</strong></div>
                <div className="dash-stat danger"><span>Crítico</span><strong>{eDanger}</strong></div>
              </div>
              {last && <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>Último: <strong style={{ fontFamily: 'var(--mono)' }}>{last.value}°C</strong> · {formatCompactDateTime(last.createdAt)}</p>}
              <p style={{ fontSize:10, color:'var(--primary)', marginTop:6, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase' }}>
                Click pra abrir histórico completo →
              </p>
            </article>
          );
        })}
      </div>

      {drillEq && (
        <Suspense fallback={null}>
          <EquipmentDetailModal
            equipment={drillEq}
            history={drillHistory}
            onClose={() => setDrillEq(null)}
          />
        </Suspense>
      )}
    </section>
  );
}

export function AuditView({ allTenants, records, session }) {
  const repository = useMemo(() => getTemperatureRepository(), []);
  const [tenantFilter, setTenantFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('30');
  const [statusFilter, setStatusFilter] = useState('all');
  const [equipFilter,  setEquipFilter]  = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [rtValidations, setRtValidations] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nutriops.rt.validations') ?? '[]'); } catch { return []; }
  });
  const [signingPeriod, setSigningPeriod] = useState(false);
  const [rtNote, setRtNote] = useState('');
  const [drillEq, setDrillEq] = useState(null);

  const isRT = ['Nutricionista RT','Administrador','Super-admin'].includes(session?.user?.role);

  const saveValidation = (note) => {
    const v = { id: crypto.randomUUID(), by: session.user.name, role: session.user.role, at: new Date().toISOString(), periodFilter, tenantFilter, recordCount: filtered.length, note: note.trim() };
    const updated = [v, ...rtValidations];
    setRtValidations(updated);
    localStorage.setItem('nutriops.rt.validations', JSON.stringify(updated.slice(0, 50)));
    setSigningPeriod(false); setRtNote('');
  };

  const filtered = useMemo(() => {
    const now = Date.now(), days = Number(periodFilter);
    return records.filter((r) => {
      if (tenantFilter !== 'all' && r.tenantId !== tenantFilter) return false;
      if (days > 0 && now - new Date(r.createdAt).getTime() > days * 86400000) return false;
      if (statusFilter !== 'all' && resolveTemperatureTone(r) !== statusFilter) return false;
      if (equipFilter && !String(r.equipmentInput || r.equipment || '').toLowerCase().includes(equipFilter.toLowerCase())) return false;
      if (searchFilter && ![r.tenantName, r.equipment, r.equipmentInput, r.user, r.note].join(' ').toLowerCase().includes(searchFilter.toLowerCase())) return false;
      return true;
    });
  }, [records, tenantFilter, periodFilter, statusFilter, equipFilter, searchFilter]);

  const stats = useMemo(() => ({ total: filtered.length, ok: filtered.filter((r) => resolveTemperatureTone(r) === 'ok').length, warn: filtered.filter((r) => resolveTemperatureTone(r) === 'warn').length, danger: filtered.filter((r) => resolveTemperatureTone(r) === 'danger').length }), [filtered]);

  const drillHistory = useMemo(() => {
    if (!drillEq) return [];
    const norm = s => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const target = norm(drillEq.equipment.label);
    return records
      .filter(r => r.tenantId === drillEq.tenantId)
      .filter(r => {
        const cands = [r.equipment, r.equipmentInput, r.equipmentKey].filter(Boolean);
        return cands.some(c => norm(c) === target);
      })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }, [records, drillEq]);

  const exportCSV = async () => {
    const csv = await repository.exportCsv(filtered);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `nutriops-${new Date().toISOString().slice(0,10)}.csv` }).click();
    URL.revokeObjectURL(url);
  };
  const exportPDF = () => {
    const name = tenantFilter === 'all' ? null : allTenants.find((t) => t.id === tenantFilter)?.name;
    const win = window.open('', '_blank');
    win.document.write(generateAuditHTML(filtered, name)); win.document.close();
    setTimeout(() => win.print(), 400);
  };
  const tl = { ok: 'Conforme', warn: 'Desvio leve', danger: 'Fora da faixa', neutral: '—' };

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Conformidade · RDC 216/2004</span><h1>Auditoria</h1><p className="muted">Histórico completo com filtros. Exportação pronta para fiscalização.</p></div>
        <div className="page-actions">
          {isRT && (
            <button className="secondary-action" style={{ fontSize:12 }} onClick={() => setSigningPeriod(!signingPeriod)}>
              ✍️ {signingPeriod ? 'Cancelar' : 'Validar período'}
            </button>
          )}
          <button className="secondary-action" onClick={exportCSV}>↓ CSV</button>
          <button className="secondary-action" onClick={exportPDF}>↓ PDF</button>
        </div>
      </div>

      {signingPeriod && isRT && (
        <article className="management-card" style={{ borderColor:'var(--blue-border)', background:'var(--blue-light)', marginBottom:16 }}>
          <div className="card-head" style={{ background:'transparent', borderBottomColor:'var(--blue-border)' }}>
            <div><span className="eyebrow" style={{ color:'var(--blue)' }}>Assinatura RT</span><h2>Validar {filtered.length} registros do período selecionado</h2></div>
          </div>
          <div className="capture-fields">
            <p style={{ fontSize:13, color:'var(--text)' }}>Confirme que os registros do período selecionado foram revisados. Sua assinatura ficará registrada com timestamp.</p>
            <label>Observação (opcional)<textarea value={rtNote} onChange={(e)=>setRtNote(e.target.value)} placeholder="Observações sobre o período revisado…" style={{ minHeight:54 }} /></label>
            <div className="actions-row">
              <button className="secondary-action" onClick={()=>setSigningPeriod(false)}>Cancelar</button>
              <button className="primary-action attention" onClick={()=>saveValidation(rtNote)} disabled={filtered.length===0}>
                ✓ Assinar e validar período
              </button>
            </div>
          </div>
        </article>
      )}

      {rtValidations.length > 0 && (
        <div style={{ marginBottom:16, display:'flex', gap:8, flexWrap:'wrap' }}>
          {rtValidations.slice(0,3).map(v => (
            <div key={v.id} style={{ padding:'6px 12px', background:'var(--green-light)', border:'1px solid var(--green-border)', borderRadius:8, fontSize:12 }}>
              <span style={{ color:'var(--green)', fontWeight:700 }}>✓ Validado por {v.by}</span>
              <span style={{ color:'var(--text-secondary)', marginLeft:8 }}>{new Date(v.at).toLocaleDateString('pt-BR')} · {v.recordCount} registros</span>
            </div>
          ))}
        </div>
      )}
      <div className="audit-stats">
        <div className="audit-stat"><span>Registros</span><strong>{stats.total}</strong></div>
        <div className="audit-stat ok"><span>Conformes</span><strong>{stats.ok}</strong></div>
        <div className="audit-stat warn"><span>Desvio leve</span><strong>{stats.warn}</strong></div>
        <div className="audit-stat danger"><span>Fora da faixa</span><strong>{stats.danger}</strong></div>
        <div className="audit-stat"><span>Conformidade</span><strong>{stats.total > 0 ? Math.round((stats.ok / stats.total) * 100) : 0}%</strong></div>
      </div>
      <div className="audit-filters">
        <label>Empresa<select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}><option value="all">Todas</option>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Período<select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}><option value="1">Hoje</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="0">Todos</option></select></label>
        <label>Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos</option><option value="ok">Conforme</option><option value="warn">Desvio leve</option><option value="danger">Fora da faixa</option></select></label>
        <label>Equipamento<input value={equipFilter} onChange={(e) => setEquipFilter(e.target.value)} placeholder="Ex.: Freezer…" /></label>
        <label>Busca livre<input value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="Usuário, nota…" /></label>
      </div>
      <div className="audit-table-wrap">
        {filtered.length === 0 ? <p className="muted" style={{ padding: '32px 20px' }}>Nenhum registro encontrado.</p>
          : <table className="table"><thead><tr><th>Data / Hora</th><th>Empresa</th><th>Equipamento <small style={{ color:'var(--primary)', fontWeight:600, letterSpacing:'.04em', textTransform:'uppercase', fontSize:9 }}>click→</small></th><th>Temp.</th><th>Faixa</th><th>Responsável</th><th>Status</th><th>Observação</th></tr></thead>
            <tbody>{filtered.map((r) => { const tone = resolveTemperatureTone(r); return (
              <tr key={r.id} className={`audit-row-${tone}`}>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap' }}>{formatCompactDateTime(r.createdAt)}</td>
                <td>{r.tenantName}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => setDrillEq({ equipment: { label: r.equipmentInput || r.equipment }, tenantId: r.tenantId })}
                    title="Abrir histórico completo deste equipamento"
                    style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontFamily:'inherit', fontSize:'inherit', color:'inherit', textAlign:'left', display:'block' }}
                  >
                    <strong style={{ borderBottom:'1px dashed var(--text-secondary)' }}>{r.equipmentInput || r.equipment}</strong>
                  </button>
                  {r.equipmentLocation && <small style={{ color: 'var(--text-secondary)', display:'block', marginTop:2 }}>{r.equipmentLocation}</small>}
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16 }}>{r.value}°C</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{r.min ?? '?'}–{r.max ?? '?'}°C</td>
                <td>{r.user}{r.role && <><br /><small style={{ color: 'var(--text-secondary)' }}>{r.role}</small></>}</td>
                <td><span className={`badge ${tone}`}>{tl[tone]}</span></td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{r.note || '—'}</td>
              </tr>
            ); })}</tbody></table>}
      </div>

      {drillEq && (
        <Suspense fallback={null}>
          <EquipmentDetailModal
            equipment={drillEq.equipment}
            history={drillHistory}
            onClose={() => setDrillEq(null)}
          />
        </Suspense>
      )}
    </section>
  );
}
