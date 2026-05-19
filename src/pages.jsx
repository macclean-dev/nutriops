import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tenants, globalAdmin } from './data';
import { getTemperatureRepository, getSupabaseConfig, saveSupabaseConfig, isSupabaseEnabled, supabaseRepository, SUPABASE_SQL, getOfflineQueue } from './repository';
import { FormsView } from './forms';
import { TrainingView } from './training';
import { ReportsView } from './reports';
import { getPermissions, canAccess } from './permissions';

// ─── Temperatura utils ─────────────────────────────────────────────────────

function resolveTemperatureLimits(label = '') {
  const l = label.toLowerCase();
  if (l.includes('freezer') || l.includes('congel') || l.includes('congelada')) return { min: -25, max: -18 };
  return { min: 0, max: 9 };
}
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

// ─── Storage helpers ───────────────────────────────────────────────────────

const catalogKey    = (id) => `nutriops.equipment.catalog.${id}`;
const turnsKey      = (id) => `nutriops.turns.${id}`;
const usersKey      = (id) => `nutriops.users.${id}`;
const actionsKey    = (id) => `nutriops.corrective_actions.${id}`;
const SESSION_KEY   = 'nutriops.session';

const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const save = (key, val)      => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

const DEFAULT_TURNS = [
  { id: 'manha', name: 'Manhã',  start: '06:00', end: '11:59' },
  { id: 'tarde', name: 'Tarde',  start: '12:00', end: '17:59' },
  { id: 'noite', name: 'Noite',  start: '18:00', end: '23:59' },
];

const readEquipmentCatalog  = (t)  => load(catalogKey(t.id),  t.equipmentCatalog ?? []);
const writeEquipmentCatalog = (id, v) => save(catalogKey(id), v);
const readTurns             = (t)  => load(turnsKey(t.id),    DEFAULT_TURNS);
const writeTurns            = (id, v) => save(turnsKey(id),   v);
const readUsers             = (t)  => load(usersKey(t.id),    t.usersList ?? []);
const writeUsers            = (id, v) => save(usersKey(id),   v);
const readActions           = (id) => load(actionsKey(id),    []);
const writeActions          = (id, v) => save(actionsKey(id), v);
const readSession           = ()   => load(SESSION_KEY, null);

// ─── Equipment utils ───────────────────────────────────────────────────────

function normalizeEquipmentName(input, catalog = []) {
  const raw = String(input ?? '').trim(), lower = raw.toLowerCase();
  for (const item of catalog) {
    if (item.label.toLowerCase() === lower) return item.label;
    if (item.aliases?.some((a) => a.toLowerCase() === lower)) return item.label;
  }
  return raw || 'Equipamento sem nome';
}
function getEquipmentEntry(catalog = [], label = '') {
  const lower = String(label ?? '').toLowerCase();
  return catalog.find((item) => item.label.toLowerCase() === lower || item.aliases?.some((a) => a.toLowerCase() === lower)) ?? null;
}

// ─── Alert computation ─────────────────────────────────────────────────────

function computeTurnAlerts(turns, records, equipCatalog, tenantId) {
  if (!turns?.length || !equipCatalog?.length) return [];
  const now = new Date(), todayStr = now.toDateString(), nowMin = now.getHours() * 60 + now.getMinutes();
  const alerts = [];
  for (const turn of turns) {
    const [sh, sm] = turn.start.split(':').map(Number), [eh, em] = turn.end.split(':').map(Number);
    const startMin = sh * 60 + sm, endMin = eh * 60 + em;
    const isActive = nowMin >= startMin && nowMin <= endMin, isPast = nowMin > endMin;
    if (!isActive && !isPast) continue;
    for (const eq of equipCatalog) {
      const hasRecord = records.some((r) => {
        if (r.tenantId !== tenantId) return false;
        if ((r.equipment || r.equipmentInput) !== eq.label) return false;
        const rd = new Date(r.createdAt); if (rd.toDateString() !== todayStr) return false;
        const rMin = rd.getHours() * 60 + rd.getMinutes();
        return rMin >= startMin && rMin <= endMin;
      });
      if (!hasRecord) alerts.push({ id: `${turn.id}-${eq.label}`, turn: turn.name, equipment: eq.label, level: isActive ? 'warn' : 'danger', message: isActive ? `Pendente no turno ${turn.name}` : `Sem registro no turno ${turn.name} (encerrado)` });
    }
  }
  return alerts;
}

// ─── PDF generator ─────────────────────────────────────────────────────────

function generateAuditHTML(records, tenantName) {
  const date = new Date().toLocaleString('pt-BR'), title = tenantName ? `Auditoria — ${tenantName}` : 'Auditoria — NutriOPS';
  const tl = (r) => { const t = resolveTemperatureTone(r); return t === 'ok' ? 'Conforme' : t === 'warn' ? 'Desvio leve' : 'Fora da faixa'; };
  const rows = records.map((r) => `<tr><td>${formatCompactDateTime(r.createdAt)}</td><td>${r.tenantName ?? ''}</td><td>${r.equipmentInput || r.equipment || ''}</td><td><strong>${r.value}°C</strong></td><td>${r.min ?? '?'}–${r.max ?? '?'}°C</td><td>${r.user ?? ''}<br/><small>${r.role ?? ''}</small></td><td>${tl(r)}</td><td>${r.note || '—'}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${title}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1c2128;padding:24px}h1{font-size:18px;font-weight:800;margin-bottom:4px}.meta{color:#656d76;font-size:10px;margin-bottom:20px}table{width:100%;border-collapse:collapse}th{background:#f6f8fa;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #d0d7de;color:#656d76}td{padding:7px 8px;border-bottom:1px solid #eaeef2;vertical-align:top}tr:last-child td{border-bottom:none}small{font-size:9px;color:#656d76}strong{font-size:12px}@page{size:A4 landscape;margin:14mm}</style>
  </head><body><h1>${title}</h1><p class="meta">Gerado em ${date} · ${records.length} registros · RDC 216/2004 · NutriOPS</p>
  <table><thead><tr><th>Data/Hora</th><th>Empresa</th><th>Equipamento</th><th>Temp.</th><th>Faixa</th><th>Responsável</th><th>Status</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SVG CHART COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function TempLineChart({ records, equipment, height = 180 }) {
  const data = useMemo(() => records
    .filter((r) => (r.equipment || r.equipmentInput) === equipment && !isNaN(Number(r.value)))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-30), [records, equipment]);

  if (data.length < 2) return (
    <div style={{ height, display: 'grid', placeItems: 'center', background: 'var(--surface-muted)', borderRadius: 'var(--r)', border: '1px solid var(--border-subtle)' }}>
      <p className="muted" style={{ fontSize: 12 }}>Mín. 2 registros para exibir o gráfico.</p>
    </div>
  );

  const limits = resolveTemperatureLimits(equipment);
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
        <path d={areaPath} fill="#0969da" fillOpacity={.06} />
        <path d={linePath} fill="none" stroke="#0969da" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => {
          const tone = resolveTemperatureTone(p.r);
          const color = tone === 'ok' ? '#1a7f37' : tone === 'warn' ? '#9a6700' : '#cf222e';
          return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={color} stroke="white" strokeWidth={1.5} />;
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
      </g>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VIEWS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Login ─────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [tenantId,  setTenantId]  = useState(tenants[0].id);
  const [userName,  setUserName]  = useState('');
  const [pin,       setPin]       = useState('');
  const [error,     setError]     = useState('');
  const [useGlobal, setUseGlobal] = useState(false);
  const pinRef = useRef(null);

  const selectedTenant = tenants.find((t) => t.id === tenantId) ?? tenants[0];
  const users = readUsers(selectedTenant).filter((u) => u.status !== 'Inativo');

  useEffect(() => { setUserName(users[0]?.name ?? ''); setPin(''); setError(''); }, [tenantId, useGlobal]);
  useEffect(() => { setPin(''); setError(''); }, [userName]);

  const handleLogin = () => {
    setError('');
    if (useGlobal) {
      if (pin !== (globalAdmin.pin ?? '9999')) { setError('PIN incorreto.'); return; }
      // Global admin starts on first tenant
      const session = { tenantId: tenants[0].id, user: { ...globalAdmin } };
      save(SESSION_KEY, session); onLogin(session); return;
    }
    const user = users.find((u) => u.name === userName);
    if (!user) { setError('Usuário não encontrado.'); return; }
    const expectedPin = user.pin ?? '0000';
    if (pin !== expectedPin) { setError('PIN incorreto.'); pinRef.current?.select(); return; }
    const session = { tenantId, user: { id:`${tenantId}-${user.name}`, name:user.name, role:user.role, location:user.location??'' } };
    save(SESSION_KEY, session); onLogin(session);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-lockup" style={{ marginBottom:28 }}>
          <span className="brand-mark" style={{ width:36, height:36, fontSize:16, borderRadius:10 }}>N</span>
          <span style={{ fontSize:22, fontWeight:800, letterSpacing:'-.05em', color:'var(--text)' }}>NutriOPS</span>
        </div>
        <h1 style={{ fontSize:24, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Entrar</h1>
        <p className="muted" style={{ marginBottom:24 }}>Selecione empresa, usuário e informe o PIN.</p>

        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {!useGlobal ? (
            <>
              <label>Empresa<select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>Usuário<select value={userName} onChange={(e) => setUserName(e.target.value)}>{users.map((u) => <option key={u.name} value={u.name}>{u.name} — {u.role}</option>)}</select></label>
            </>
          ) : (
            <div style={{ padding:'12px 14px', background:'var(--blue-light)', border:'1px solid var(--blue-border)', borderRadius:'var(--r)', fontSize:13 }}>
              <strong>Administrador global</strong> — acesso a todas as empresas
            </div>
          )}
          <label>PIN
            <input ref={pinRef} type="password" inputMode="numeric" maxLength={6}
              value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g,'')); setError(''); }}
              placeholder="••••" autoComplete="off"
              onKeyDown={(e) => { if (e.key==='Enter') handleLogin(); }}
              style={{ letterSpacing:'0.3em', fontSize:22, textAlign:'center', fontFamily:'var(--mono)' }} />
          </label>
          {error && <div style={{ padding:'8px 12px', background:'var(--red-light)', border:'1px solid var(--red-border)', borderRadius:'var(--r)', color:'var(--red)', fontSize:13, fontWeight:600 }}>{error}</div>}
          <button className="primary-action" style={{ marginTop:4 }} onClick={handleLogin}>Entrar</button>
        </div>

        <div style={{ marginTop:18, paddingTop:14, borderTop:'1px solid var(--border-subtle)', textAlign:'center' }}>
          <button onClick={() => { setUseGlobal(!useGlobal); setPin(''); setError(''); }}
            style={{ background:'none', border:'none', fontSize:11, color:'var(--text-secondary)', cursor:'pointer', textDecoration:'underline' }}>
            {useGlobal ? 'Entrar como funcionário da unidade' : 'Entrar como administrador global'}
          </button>
        </div>
        <p style={{ marginTop:10, fontSize:10, color:'var(--text-secondary)', textAlign:'center', lineHeight:1.6 }}>
          Conformidade sanitária digital · RDC 216/2004
        </p>
      </div>
    </div>
  );
}

// ─── Rail ──────────────────────────────────────────────────────────────────

function RailNav({ activeTenant, allTenants, activeView, setActiveView, onTenantChange, session, records, alertCount, actionCount, onLogout }) {
  const perms = getPermissions(session?.user?.role);
  const navItems = [
    ['overview',   'Visão geral',       null],
    ['dashboard',  'Conformidade',       null],
    ['charts',     'Gráficos',           null],
    ['forms',      'Planilhas BPF',      null],
    ['training',   'Capacitação',        null],
    ['receiving',  'Recebimento',        null],
    ['reports',    'Relatórios',         null],
    ['audit',      'Auditoria',          null],
    ['alerts',     'Alertas',            alertCount > 0 ? alertCount : null],
    ['actions',    'Ações corretivas',   actionCount > 0 ? actionCount : null],
    ['turns',      'Turnos',             null],
    ['users',      'Usuários',           null],
    ['equipment',  'Equipamentos',       null],
    ['settings',   'Configurações',      null],
  ].filter(([key]) => canAccess(session?.user?.role, key));
  return (
    <aside className="super-rail">
      <div className="rail-brand">
        <div className="brand-lockup"><span className="brand-mark">N</span><span className="brand-wordmark">NutriOPS</span></div>
      </div>
      <div className="rail-section">
        <p className="rail-section-label">Empresas</p>
        <div className="rail-list">
          {(perms.multiTenant ? allTenants : allTenants.filter(t => t.id === session?.tenantId || activeTenant.id === t.id)).map((t) => (
            <button key={t.id} className={`rail-company ${activeTenant.id === t.id ? 'active' : ''}`} style={{ borderLeftColor: t.brandColor }}
              onClick={() => perms.multiTenant ? onTenantChange(t.id) : null}
              disabled={!perms.multiTenant}>
              <strong>{t.name}</strong>
              <span style={{ color: t.brandColor }}>{t.segment} · {records.filter((r) => r.tenantId === t.id).length} reg.</span>
            </button>
          ))}
        </div>
      </div>
      <div className="rail-card">
        <span className="eyebrow">Sessão</span>
        <strong>{session.user.name}</strong>
        <span style={{ fontSize: 11, color: 'var(--rail-muted)', display: 'block', marginTop: 2 }}>{session.user.role}</span>
      </div>
      <div className="rail-menu">
        <div className="rail-menu-list">
          {navItems.map(([key, label, count]) => (
            <button key={key} className={`rail-menu-item ${activeView === key ? 'active' : ''}`} onClick={() => setActiveView(key)}>
              {label}
              {count !== null && <span style={{ marginLeft:'auto', background: key==='actions'?'var(--amber)':'var(--red)', color:'white', borderRadius:10, fontSize:10, fontWeight:800, padding:'1px 6px' }}>{count}</span>}
            </button>
          ))}
        </div>
        <button className="rail-menu-item" style={{ marginTop:'auto', color:'var(--rail-muted)', borderTop:'1px solid var(--rail-border)', borderRadius:0 }} onClick={onLogout}>Sair</button>
      </div>
    </aside>
  );
}

// ─── Company Cards ─────────────────────────────────────────────────────────

function CompanyCards({ allTenants, activeTenant, onTenantChange, records }) {
  return (
    <div className="company-grid">
      {allTenants.map((t) => {
        const tr = records.filter((r) => r.tenantId === t.id);
        const today = tr.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString());
        return (
          <article key={t.id} className={`company-card ${activeTenant.id === t.id ? 'active' : ''}`} style={{ borderTopColor: t.brandColor }} onClick={() => onTenantChange(t.id)}>
            <div className="company-top">
              <div><span className="eyebrow">{t.plan}</span><h2 style={{ color: t.brandColor }}>{t.name}</h2></div>
              <span className="badge subtle" style={{ background: t.brandSoft, color: t.brandColor, borderColor: 'transparent' }}>{t.segment}</span>
            </div>
            <p className="company-summary">{t.localityType} · {t.equipmentCatalog.length} equip. · {t.users} usuários</p>
            <div className="company-stats">
              <div className="company-stat"><span>Hoje</span><strong>{today.length}</strong></div>
              <div className="company-stat"><span>Conformidade</span><strong>{t.compliance}%</strong></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ─── Temperature Capture ───────────────────────────────────────────────────

function TemperatureCapture({ activeTenant, session, equipmentCatalog, onRecordSaved }) {
  const repository = useMemo(() => getTemperatureRepository(), []);
  const visibleChips = equipmentCatalog.slice(0, 5);

  const [activeEquipment,      setActiveEquipment]      = useState(visibleChips[0]?.label ?? '');
  const [value,                setValue]                = useState('');
  const [note,                 setNote]                 = useState('');
  const [equipmentLocation,    setEquipmentLocation]    = useState('');
  const [observationEquipment, setObservationEquipment] = useState('');
  const [observationInterval,  setObservationInterval]  = useState('60');
  const [savedByEquipment,     setSavedByEquipment]     = useState({});
  const [draftByEquipment,     setDraftByEquipment]     = useState({});
  const [submissionState,      setSubmissionState]      = useState('idle');
  const temperatureRef = useRef(null), noteRef = useRef(null);

  useEffect(() => {
    setActiveEquipment(equipmentCatalog[0]?.label ?? ''); setValue(''); setNote('');
    setEquipmentLocation(getEquipmentEntry(equipmentCatalog, equipmentCatalog[0]?.label)?.location ?? '');
    setSavedByEquipment({}); setDraftByEquipment({}); setObservationEquipment(''); setSubmissionState('idle');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  const activeEntry  = getEquipmentEntry(equipmentCatalog, activeEquipment);
  const limits       = resolveTemperatureLimits(activeEquipment);
  const numericValue = Number(value);
  const hasValue     = value !== '' && !isNaN(numericValue);
  const inRange      = hasValue && numericValue >= limits.min && numericValue <= limits.max;
  const warnRange    = hasValue && !inRange && numericValue >= limits.min - 3 && numericValue <= limits.max + 3;
  const statusTone   = !hasValue ? 'neutral' : inRange ? 'ok' : warnRange ? 'warn' : 'danger';
  const alertLabel   = !hasValue ? 'Aguardando leitura' : inRange ? 'Dentro da faixa' : warnRange ? 'Desvio leve' : 'Fora da faixa';
  const currentTime  = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const flowComplete = Boolean(savedByEquipment[activeEquipment]);

  const pendingDrafts = useMemo(() => {
    const others = Object.entries(draftByEquipment).filter(([lbl, d]) => lbl !== activeEquipment && d.value).length;
    return others + (hasValue && !savedByEquipment[activeEquipment] ? 1 : 0);
  }, [draftByEquipment, activeEquipment, hasValue, savedByEquipment]);

  const persistDraft = useCallback((lbl, patch) => {
    setDraftByEquipment((prev) => ({ ...prev, [lbl]: { ...(prev[lbl] ?? {}), ...patch } }));
  }, []);

  const selectEquipment = useCallback((label) => {
    if (activeEquipment) persistDraft(activeEquipment, { value, note, location: equipmentLocation });
    setActiveEquipment(label);
    const draft = draftByEquipment[label];
    setValue(draft?.value ?? savedByEquipment[label]?.temperature ?? '');
    setNote(draft?.note ?? savedByEquipment[label]?.note ?? '');
    setEquipmentLocation(draft?.location ?? savedByEquipment[label]?.location ?? getEquipmentEntry(equipmentCatalog, label)?.location ?? '');
    setSubmissionState('idle');
    window.requestAnimationFrame(() => temperatureRef.current?.focus());
  }, [activeEquipment, value, note, equipmentLocation, draftByEquipment, savedByEquipment, equipmentCatalog, persistDraft]);

  const buildPayload = useCallback((label, val, loc, nt) => ({
    tenantId: activeTenant.id, tenantName: activeTenant.name, store: activeTenant.name,
    equipmentInput: label, equipmentKey: label, equipmentLocation: loc || null,
    user: session.user.name, role: session.user.role, equipment: label,
    measuredAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    controlMode: observationEquipment === label ? 'observation' : 'routine',
    observationInterval: observationEquipment === label ? Number(observationInterval) : null,
    value: Number(val), note: nt, min: resolveTemperatureLimits(label).min, max: resolveTemperatureLimits(label).max,
  }), [activeTenant, session, observationEquipment, observationInterval]);

  const handleSaveAll = async () => {
    if (pendingDrafts === 0) return;
    setSubmissionState('saving');
    try {
      const toSave = [];
      if (hasValue && !savedByEquipment[activeEquipment]) toSave.push({ label: activeEquipment, val: numericValue, loc: equipmentLocation, nt: note });
      for (const [label, draft] of Object.entries(draftByEquipment)) {
        if (label === activeEquipment) continue;
        const val = Number(draft.value || '');
        if (!isNaN(val) && draft.value && !savedByEquipment[label]) toSave.push({ label, val, loc: draft.location ?? '', nt: draft.note ?? '' });
      }
      const newSaved = { ...savedByEquipment };
      for (const item of toSave) {
        const created = await repository.create(buildPayload(item.label, item.val, item.loc, item.nt));
        newSaved[item.label] = { equipment: item.label, temperature: String(item.val), note: item.nt, location: item.loc, createdAt: created?.createdAt ?? new Date().toISOString() };
      }
      setSavedByEquipment(newSaved); setDraftByEquipment({});
      setSubmissionState('saved'); onRecordSaved?.();
    } catch { setSubmissionState('error'); }
  };

  return (
    <article className="capture-card">
      <div className="card-head">
        <div><span className="eyebrow">Registro de temperatura</span><h2>{activeTenant.name}</h2></div>
        <span className={`badge ${statusTone}`}>{alertLabel}</span>
      </div>
      <div className="capture-topline">
        <div className="capture-meta"><span>Usuário</span><strong>{session.user.name}</strong></div>
        <div className="capture-meta"><span>Perfil</span><strong>{session.user.role}</strong></div>
        <div className="capture-meta"><span>Horário</span><strong>{currentTime}</strong></div>
      </div>
      <div className="capture-fields">
        <div className="chip-row">
          {visibleChips.map((item) => {
            const isSaved = Boolean(savedByEquipment[item.label]), isActive = activeEquipment === item.label;
            const hasDraft = isActive ? hasValue : Boolean(draftByEquipment[item.label]?.value);
            const chipClass = (isSaved || hasDraft) ? 'active' : isActive ? 'pending' : '';
            return (
              <button key={item.label} className={`quick-chip ${chipClass} ${observationEquipment === item.label ? 'observing' : ''}`} onClick={() => selectEquipment(item.label)}>
                <strong>{item.label}</strong>
                <span>{item.aliases?.[0] ?? 'padrão'}</span>
                {isSaved && <small className="quick-chip-check">✓✓</small>}
              </button>
            );
          })}
        </div>
        <div className="equipment-row compact">
          <label className="textarea-block field-box">
            <span className="field-head"><span>Equipamento</span>{flowComplete && <small className="field-check">✓✓</small>}</span>
            <input list={`eq-${activeTenant.id}`} value={activeEquipment} onChange={(e) => { const n = normalizeEquipmentName(e.target.value, equipmentCatalog); setActiveEquipment(n); setEquipmentLocation(getEquipmentEntry(equipmentCatalog, n)?.location ?? ''); }} placeholder="Equipamento" />
            <datalist id={`eq-${activeTenant.id}`}>{visibleChips.map((i) => <option key={i.label} value={i.label} />)}</datalist>
          </label>
          <label className="textarea-block field-box">
            <span className="field-head"><span>Localização</span></span>
            <input value={equipmentLocation || activeEntry?.location || ''} readOnly tabIndex={-1} placeholder="Definida no cadastro" />
          </label>
        </div>
        <div className="grid-2 temperature-entry-row">
          <div className="timestamp-card compact field-box">
            <span className="field-head"><span>Horário atual</span></span>
            <strong>{currentTime}</strong><small>Timestamp automático</small>
          </div>
          <label className="textarea-block field-box">
            <span className="field-head"><span>Temperatura (°C)</span>{flowComplete && <small className="field-check">✓✓</small>}</span>
            <input ref={temperatureRef} inputMode="decimal" value={value}
              onChange={(e) => { setValue(e.target.value); setSubmissionState('idle'); persistDraft(activeEquipment, { value: e.target.value }); }}
              placeholder={`${limits.min} a ${limits.max}`}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (hasValue) { const idx = visibleChips.findIndex((c) => c.label === activeEquipment); const next = visibleChips[idx + 1]; if (next) selectEquipment(next.label); else noteRef.current?.focus(); } else noteRef.current?.focus(); } }} />
          </label>
        </div>
        <div className="range-panel">
          <span>Faixa regular</span>
          <strong>{limits.min}°C a {limits.max}°C</strong>
          <div className={`range-status ${statusTone}`}>
            <span>{!hasValue ? '◌' : inRange ? '✓' : '!'}</span>
            <strong>{hasValue ? `${numericValue}°C` : 'Aguardando leitura'}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={`secondary-action${observationEquipment === activeEquipment ? ' observing' : ''}`} style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setObservationEquipment(observationEquipment === activeEquipment ? '' : activeEquipment)}>
            {observationEquipment === activeEquipment ? '● Em observação' : '○ Marcar observação'}
          </button>
          {observationEquipment === activeEquipment && (
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 0 }}>
              <span style={{ whiteSpace: 'nowrap' }}>Intervalo</span>
              <select value={observationInterval} onChange={(e) => setObservationInterval(e.target.value)} style={{ width: 'auto' }}>
                <option value="15">15 min</option><option value="30">30 min</option><option value="60">1h</option><option value="120">2h</option>
              </select>
            </label>
          )}
        </div>
        <label className="textarea-block field-box">
          <span className="field-head"><span>Observação</span></span>
          <textarea ref={noteRef} value={note} onChange={(e) => { setNote(e.target.value); setSubmissionState('idle'); persistDraft(activeEquipment, { note: e.target.value }); }} placeholder="Opcional." style={{ minHeight: 54 }} />
        </label>
        <div className="actions-row">
          <button className="secondary-action" onClick={() => { setValue(''); setNote(''); setSubmissionState('idle'); }}>Limpar</button>
          <button className={`primary-action${hasValue ? ' attention' : ''}`} onClick={handleSaveAll} disabled={pendingDrafts === 0 || submissionState === 'saving'}>
            {submissionState === 'saving' ? 'Salvando…' : pendingDrafts > 1 ? `Registrar ${pendingDrafts} temperaturas` : 'Registrar temperatura'}
          </button>
        </div>
        {submissionState === 'saved' && <div className="submission ok">✓ Registro salvo com timestamp auditável.</div>}
        {submissionState === 'error' && <div className="submission danger">Erro ao salvar. Tente novamente.</div>}
      </div>
    </article>
  );
}

// ─── Recent History ────────────────────────────────────────────────────────

function RecentHistory({ activeTenant, records }) {
  const tr = records.filter((r) => r.tenantId === activeTenant.id).slice(0, 8);
  return (
    <article className="history-card">
      <div className="card-head compact-head"><div><span className="eyebrow">Auditoria</span><h2>Últimos registros</h2></div><span className="badge neutral">{tr.length}</span></div>
      <div className="history-list">
        {tr.length === 0 ? <p className="muted" style={{ padding: '16px' }}>Ainda não há registros.</p>
          : tr.map((r) => (
            <div className={`history-item tone-${resolveTemperatureTone(r)}`} key={r.id}>
              <div><strong>{r.equipmentInput || r.equipment}</strong><span>{r.measuredAt ?? 'Automático'}{r.equipmentLocation ? ` · ${r.equipmentLocation}` : ''}</span><span>{formatCompactDateTime(r.createdAt)}</span></div>
              <div className="history-side"><strong>{r.value}°C</strong><span>{r.controlMode === 'observation' ? 'obs.' : 'rotina'}</span></div>
            </div>
          ))}
      </div>
    </article>
  );
}

// ─── Overview ──────────────────────────────────────────────────────────────

function OverviewView({ activeTenant, allTenants, onTenantChange, session, equipmentCatalog, records, onRecordSaved, alerts }) {
  return (
    <>
      {alerts.length > 0 && (
        <div className="alert-banner">
          <span>⚠ {alerts.length} pendência{alerts.length > 1 ? 's' : ''} no turno atual</span>
          <span>{alerts.map((a) => a.equipment).join(', ')}</span>
        </div>
      )}
      <CompanyCards allTenants={allTenants} activeTenant={activeTenant} onTenantChange={onTenantChange} records={records} />
      <div className="workspace-grid">
        <TemperatureCapture key={activeTenant.id} activeTenant={activeTenant} session={session} equipmentCatalog={equipmentCatalog} onRecordSaved={onRecordSaved} />
        <RecentHistory activeTenant={activeTenant} records={records} />
      </div>
    </>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

function DashboardView({ allTenants, records, activeTenant, onTenantChange }) {
  const now = Date.now();
  const stats = useMemo(() => allTenants.map((tenant) => {
    const tr = records.filter((r) => r.tenantId === tenant.id && now - new Date(r.createdAt).getTime() <= 30 * 86400000);
    const ok = tr.filter((r) => resolveTemperatureTone(r) === 'ok').length, warn = tr.filter((r) => resolveTemperatureTone(r) === 'warn').length, danger = tr.filter((r) => resolveTemperatureTone(r) === 'danger').length;
    const total = tr.length, compliance = total > 0 ? Math.round((ok / total) * 100) : 0;
    const today = tr.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString()).length;
    const catalog = readEquipmentCatalog(tenant);
    const equipStats = catalog.map((eq) => {
      const er = tr.filter((r) => (r.equipment || r.equipmentInput) === eq.label);
      const eOk = er.filter((r) => resolveTemperatureTone(r) === 'ok').length;
      return { label: eq.label, total: er.length, ok: eOk, pct: er.length > 0 ? Math.round((eOk / er.length) * 100) : null };
    });
    return { tenant, total, ok, warn, danger, compliance, today, equipStats };
  }), [allTenants, records, now]);

  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Últimos 30 dias</span><h1>Conformidade</h1><p className="muted">Visão consolidada por empresa e equipamento.</p></div></div>
      <div className="dashboard-grid">
        {stats.map(({ tenant, total, ok, warn, danger, compliance, today, equipStats }) => (
          <article key={tenant.id} className={`dash-card ${activeTenant.id === tenant.id ? 'active' : ''}`} style={{ borderTopColor: tenant.brandColor }} onClick={() => onTenantChange(tenant.id)}>
            <div className="dash-card-head">
              <div><span className="eyebrow">{tenant.plan}</span><h2 style={{ color: tenant.brandColor }}>{tenant.name}</h2></div>
              <div className="dash-compliance">
                <strong style={{ color: compliance >= 90 ? 'var(--green)' : compliance >= 70 ? 'var(--amber)' : 'var(--red)' }}>{compliance}%</strong>
                <span>conformidade</span>
              </div>
            </div>
            <div className="compliance-bar-wrap"><div className="compliance-bar">
              {total > 0 && <><div className="cb-ok" style={{ width: `${(ok/total)*100}%` }} /><div className="cb-warn" style={{ width: `${(warn/total)*100}%` }} /><div className="cb-danger" style={{ width: `${(danger/total)*100}%` }} /></>}
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
                  <div key={eq.label} className="equip-bar-row">
                    <span>{eq.label}</span>
                    <div className="equip-bar-track"><div className="equip-bar-fill" style={{ width: `${eq.pct ?? 0}%`, background: eq.pct === null ? 'var(--border)' : eq.pct >= 90 ? 'var(--green)' : eq.pct >= 70 ? 'var(--amber)' : 'var(--red)' }} /></div>
                    <strong>{eq.pct !== null ? `${eq.pct}%` : '—'}</strong>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

// ─── Charts View ───────────────────────────────────────────────────────────

function ChartsView({ activeTenant, allTenants, onTenantChange, records }) {
  const catalog = readEquipmentCatalog(activeTenant);
  const [selectedEquipment, setSelectedEquipment] = useState(catalog[0]?.label ?? '');
  const [periodDays, setPeriodDays] = useState('30');

  useEffect(() => { setSelectedEquipment(readEquipmentCatalog(activeTenant)[0]?.label ?? ''); }, [activeTenant.id]);

  const tenantRecords = useMemo(() => {
    const cutoff = Date.now() - Number(periodDays) * 86400000;
    return records.filter((r) => r.tenantId === activeTenant.id && new Date(r.createdAt).getTime() >= cutoff);
  }, [records, activeTenant.id, periodDays]);

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

      {/* Equipment selector */}
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {catalog.map((eq) => (
          <button key={eq.label} className={`quick-chip ${selectedEquipment === eq.label ? 'active' : ''}`} onClick={() => setSelectedEquipment(eq.label)}>
            <strong>{eq.label}</strong>
            <span>{tenantRecords.filter((r) => (r.equipment || r.equipmentInput) === eq.label).length} registros</span>
          </button>
        ))}
      </div>

      {/* Main chart */}
      {selectedEquipment && (
        <div className="chart-card">
          <div className="card-head">
            <div><span className="eyebrow">Temperatura ao longo do tempo</span><h2>{selectedEquipment} · {activeTenant.name}</h2></div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />Conforme</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block' }} />Desvio</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />Crítico</span>
            </div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <TempLineChart records={tenantRecords} equipment={selectedEquipment} height={200} />
          </div>
        </div>
      )}

      {/* Stats per equipment */}
      <div className="dashboard-grid" style={{ marginTop: 16 }}>
        {catalog.map((eq) => {
          const er = tenantRecords.filter((r) => (r.equipment || r.equipmentInput) === eq.label);
          const eOk = er.filter((r) => resolveTemperatureTone(r) === 'ok').length;
          const eWarn = er.filter((r) => resolveTemperatureTone(r) === 'warn').length;
          const eDanger = er.filter((r) => resolveTemperatureTone(r) === 'danger').length;
          const pct = er.length > 0 ? Math.round((eOk / er.length) * 100) : null;
          const last = er[0];
          return (
            <article key={eq.label} className={`dash-card ${selectedEquipment === eq.label ? 'active' : ''}`} style={{ borderTopColor: pct === null ? 'var(--border)' : pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)', cursor: 'pointer' }} onClick={() => setSelectedEquipment(eq.label)}>
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
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ─── Audit View ────────────────────────────────────────────────────────────

function AuditView({ allTenants, records, session }) {
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

  const exportCSV = async () => {
    const csv = await repository.exportCsv(filtered);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
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

      {/* RT Validation Panel */}
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

      {/* Recent RT validations */}
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
          : <table className="table"><thead><tr><th>Data / Hora</th><th>Empresa</th><th>Equipamento</th><th>Temp.</th><th>Faixa</th><th>Responsável</th><th>Status</th><th>Observação</th></tr></thead>
            <tbody>{filtered.map((r) => { const tone = resolveTemperatureTone(r); return (
              <tr key={r.id} className={`audit-row-${tone}`}>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap' }}>{formatCompactDateTime(r.createdAt)}</td>
                <td>{r.tenantName}</td>
                <td><strong>{r.equipmentInput || r.equipment}</strong>{r.equipmentLocation && <><br /><small style={{ color: 'var(--text-secondary)' }}>{r.equipmentLocation}</small></>}</td>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16 }}>{r.value}°C</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{r.min ?? '?'}–{r.max ?? '?'}°C</td>
                <td>{r.user}{r.role && <><br /><small style={{ color: 'var(--text-secondary)' }}>{r.role}</small></>}</td>
                <td><span className={`badge ${tone}`}>{tl[tone]}</span></td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{r.note || '—'}</td>
              </tr>
            ); })}</tbody></table>}
      </div>
    </section>
  );
}

// ─── Corrective Actions View ───────────────────────────────────────────────

function CorrectiveActionsView({ activeTenant, allTenants, onTenantChange, records }) {
  const [actions, setActions]         = useState(() => readActions(activeTenant.id));
  const [statusFilter, setStatusFilter] = useState('all');
  const [creating, setCreating]       = useState(null); // out-of-range record
  const [editingId, setEditingId]     = useState(null);
  const [description, setDescription] = useState('');
  const [responsible, setResponsible] = useState('');
  const [deadline, setDeadline]       = useState('');
  const [resolution, setResolution]   = useState('');
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => { setActions(readActions(activeTenant.id)); setCreating(null); setEditingId(null); }, [activeTenant.id]);
  useEffect(() => { writeActions(activeTenant.id, actions); }, [activeTenant.id, actions]);

  const users = readUsers(activeTenant);

  const outOfRange = records.filter((r) => r.tenantId === activeTenant.id && resolveTemperatureTone(r) !== 'ok' && resolveTemperatureTone(r) !== 'neutral' && !actions.some((a) => a.recordId === r.id));

  const openCreate = (record) => {
    setCreating(record); setEditingId(null);
    setDescription(''); setResponsible(users[0]?.name ?? '');
    setDeadline(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    setResolution('');
  };

  const saveAction = () => {
    if (!description.trim() || !creating) return;
    const action = {
      id: crypto.randomUUID(), tenantId: activeTenant.id, recordId: creating.id,
      equipment: creating.equipment || creating.equipmentInput, temperature: creating.value,
      deviation: resolveTemperatureTone(creating), description: description.trim(),
      responsible, deadline, status: 'aberta', resolution: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setActions((prev) => [action, ...prev]); setCreating(null);
  };

  const advanceStatus = (id) => {
    setActions((prev) => prev.map((a) => {
      if (a.id !== id) return a;
      const next = a.status === 'aberta' ? 'em_andamento' : a.status === 'em_andamento' ? 'resolvida' : 'resolvida';
      return { ...a, status: next, updatedAt: new Date().toISOString(), closedAt: next === 'resolvida' ? new Date().toISOString() : a.closedAt, resolution: resolvingId === id ? resolution : a.resolution };
    }));
    setResolvingId(null); setResolution('');
  };

  const removeAction = (id) => { if (!window.confirm('Remover esta ação?')) return; setActions((prev) => prev.filter((a) => a.id !== id)); };

  const filtered = actions.filter((a) => statusFilter === 'all' || a.status === statusFilter);
  const open = actions.filter((a) => a.status !== 'resolvida').length;

  const statusLabel = { aberta: 'Aberta', em_andamento: 'Em andamento', resolvida: 'Resolvida' };
  const statusTone  = { aberta: 'danger', em_andamento: 'warn', resolvida: 'ok' };
  const nextLabel   = { aberta: 'Iniciar', em_andamento: 'Marcar resolvida', resolvida: 'Resolvida ✓' };

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Gestão de desvios</span><h1>Ações corretivas</h1><p className="muted">Registre e acompanhe correções para temperaturas fora da faixa.</p></div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width: 'auto' }}>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {open > 0 && <span className="badge warn">{open} em aberto</span>}
        </div>
      </div>

      {/* Out-of-range records needing action */}
      {outOfRange.length > 0 && (
        <article className="management-card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div><span className="eyebrow">Aguardando ação</span><h2>Desvios sem ação corretiva</h2></div><span className="badge danger">{outOfRange.length}</span></div>
          <div className="equipment-maintenance-list">
            {outOfRange.slice(0, 10).map((r) => {
              const tone = resolveTemperatureTone(r);
              return (
                <div key={r.id} className="equipment-maintenance-row">
                  <div>
                    <strong>{r.equipmentInput || r.equipment}</strong>
                    <span>{formatCompactDateTime(r.createdAt)} · {r.user}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: tone === 'danger' ? 'var(--red)' : 'var(--amber)' }}>{r.value}°C <small style={{ fontFamily: 'var(--font)', fontWeight: 400, color: 'var(--text-secondary)' }}>· faixa: {r.min}–{r.max}°C</small></span>
                  </div>
                  <button className="primary-action" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => openCreate(r)}>Abrir ação</button>
                </div>
              );
            })}
          </div>
        </article>
      )}

      {/* Create form */}
      {creating && (
        <article className="management-card" style={{ marginBottom: 16, borderColor: 'var(--blue-border)', background: 'var(--blue-light)' }}>
          <div className="card-head" style={{ background: 'transparent', borderBottomColor: 'var(--blue-border)' }}>
            <div><span className="eyebrow">Nova ação</span><h2>{creating.equipment || creating.equipmentInput} · {creating.value}°C</h2></div>
            <button className="ghost-action" onClick={() => setCreating(null)}>✕ Cancelar</button>
          </div>
          <div className="capture-fields">
            <label>Descrição do desvio e ação a tomar<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva o que ocorreu e o que será feito…" style={{ minHeight: 72 }} /></label>
            <div className="grid-2">
              <label>Responsável
                <select value={responsible} onChange={(e) => setResponsible(e.target.value)}>
                  {users.map((u) => <option key={u.name} value={u.name}>{u.name} — {u.role}</option>)}
                </select>
              </label>
              <label>Prazo<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
            </div>
            <div className="actions-row">
              <button className="primary-action" onClick={saveAction}>Criar ação corretiva</button>
            </div>
          </div>
        </article>
      )}

      {/* Actions list */}
      <article className="management-card">
        <div className="card-head">
          <div><span className="eyebrow">Histórico</span><h2>Ações registradas</h2></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'aberta', 'em_andamento', 'resolvida'].map((s) => (
              <button key={s} className={`secondary-action`} style={{ fontSize: 11, padding: '4px 10px', background: statusFilter === s ? 'var(--text)' : '', color: statusFilter === s ? 'white' : '', border: statusFilter === s ? 'none' : '' }} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? 'Todas' : statusLabel[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="equipment-maintenance-list">
          {filtered.length === 0 ? <p className="muted" style={{ padding: '20px' }}>Nenhuma ação encontrada.</p>
            : filtered.map((a) => (
              <div key={a.id} className="equipment-maintenance-row" style={{ flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, width: '100%' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <strong>{a.equipment}</strong>
                      <span className={`badge ${statusTone[a.status]}`}>{statusLabel[a.status]}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: a.deviation === 'danger' ? 'var(--red)' : 'var(--amber)' }}>{a.temperature}°C</span>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{a.description}</p>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                      <span>Responsável: <strong>{a.responsible}</strong></span>
                      <span>Prazo: <strong>{a.deadline ? new Date(a.deadline).toLocaleDateString('pt-BR') : '—'}</strong></span>
                      <span>Aberta: {formatCompactDateTime(a.createdAt)}</span>
                      {a.closedAt && <span>Fechada: {formatCompactDateTime(a.closedAt)}</span>}
                    </div>
                    {a.resolution && <p style={{ fontSize: 12, color: 'var(--green)', marginTop: 4, fontStyle: 'italic' }}>✓ {a.resolution}</p>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                    {a.status !== 'resolvida' && (
                      <button className="primary-action" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => { if (a.status === 'em_andamento') { setResolvingId(a.id); setResolution(''); } else advanceStatus(a.id); }}>
                        {nextLabel[a.status]}
                      </button>
                    )}
                    <button className="ghost-action danger" style={{ fontSize: 11 }} onClick={() => removeAction(a.id)}>Remover</button>
                  </div>
                </div>
                {resolvingId === a.id && (
                  <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <label style={{ flex: 1 }}>Descreva a resolução<textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="O que foi feito para corrigir…" style={{ minHeight: 54 }} /></label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button className="primary-action" onClick={() => advanceStatus(a.id)}>Confirmar</button>
                      <button className="secondary-action" onClick={() => setResolvingId(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      </article>
    </section>
  );
}

// ─── Alerts View ───────────────────────────────────────────────────────────

function AlertsView({ activeTenant, allTenants, onTenantChange, records }) {
  const turns = readTurns(activeTenant), catalog = readEquipmentCatalog(activeTenant);
  const alerts = computeTurnAlerts(turns, records, catalog, activeTenant.id);
  const today = records.filter((r) => r.tenantId === activeTenant.id && new Date(r.createdAt).toDateString() === new Date().toDateString());
  const outOfRange = today.filter((r) => resolveTemperatureTone(r) !== 'ok');
  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Pendências e desvios</span><h1>Alertas</h1><p className="muted">Pendências por turno e registros fora da faixa.</p></div>
        <div className="page-actions"><select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width: 'auto' }}>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      <article className="management-card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div><span className="eyebrow">Pendências de turno</span><h2>Registros em aberto</h2></div>{alerts.length > 0 && <span className="badge danger">{alerts.length}</span>}</div>
        <div className="equipment-maintenance-list">
          {alerts.length === 0 ? <p className="muted" style={{ padding: '20px' }}>✓ Nenhuma pendência para o turno atual.</p>
            : alerts.map((a) => (
              <div key={a.id} className="equipment-maintenance-row">
                <div><strong>{a.equipment}</strong><span>Turno: {a.turn}</span><span>{a.message}</span></div>
                <span className={`badge ${a.level}`}>{a.level === 'warn' ? 'Pendente' : 'Atrasado'}</span>
              </div>
            ))}
        </div>
      </article>
      <article className="management-card">
        <div className="card-head"><div><span className="eyebrow">Hoje</span><h2>Temperaturas fora da faixa</h2></div>{outOfRange.length > 0 && <span className="badge warn">{outOfRange.length}</span>}</div>
        <div className="equipment-maintenance-list">
          {outOfRange.length === 0 ? <p className="muted" style={{ padding: '20px' }}>✓ Todos os registros de hoje estão dentro da faixa.</p>
            : outOfRange.map((r) => { const tone = resolveTemperatureTone(r); return (
              <div key={r.id} className="equipment-maintenance-row">
                <div><strong>{r.equipmentInput || r.equipment}</strong><span>{formatCompactDateTime(r.createdAt)} · {r.user}</span>{r.note && <span>{r.note}</span>}</div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <strong style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>{r.value}°C</strong>
                  <span className={`badge ${tone}`}>{tone === 'warn' ? 'Desvio leve' : 'Fora da faixa'}</span>
                </div>
              </div>
            ); })}
        </div>
      </article>
    </section>
  );
}

// ─── Turns View ────────────────────────────────────────────────────────────

function TurnsView({ activeTenant, allTenants, onTenantChange, records }) {
  const [turns, setTurns]           = useState(() => readTurns(activeTenant));
  const [editingId, setEditingId]   = useState(null);
  const [nameInput, setNameInput]   = useState('');
  const [startInput, setStartInput] = useState('06:00');
  const [endInput, setEndInput]     = useState('12:00');
  useEffect(() => { setTurns(readTurns(activeTenant)); setEditingId(null); }, [activeTenant.id]);
  useEffect(() => { writeTurns(activeTenant.id, turns); }, [activeTenant.id, turns]);

  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes(), catalog = readEquipmentCatalog(activeTenant);
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const isActive = (turn) => nowMin >= toMin(turn.start) && nowMin <= toMin(turn.end);
  const turnRecs = (turn) => {
    const sm = toMin(turn.start), em = toMin(turn.end), tStr = now.toDateString();
    return records.filter((r) => { if (r.tenantId !== activeTenant.id) return false; const rd = new Date(r.createdAt); if (rd.toDateString() !== tStr) return false; const rm = rd.getHours() * 60 + rd.getMinutes(); return rm >= sm && rm <= em; });
  };
  const startEdit = (turn) => { setEditingId(turn.id); setNameInput(turn.name); setStartInput(turn.start); setEndInput(turn.end); };
  const cancelEdit = () => { setEditingId(null); setNameInput(''); setStartInput('06:00'); setEndInput('12:00'); };
  const saveTurn = () => {
    if (!nameInput.trim()) return;
    const entry = { name: nameInput.trim(), start: startInput, end: endInput };
    setTurns((prev) => editingId ? prev.map((t) => t.id === editingId ? { ...t, ...entry } : t) : [...prev, { id: crypto.randomUUID(), ...entry }]);
    cancelEdit();
  };
  const removeTurn = (id) => { if (!window.confirm('Remover este turno?')) return; setTurns((prev) => prev.filter((t) => t.id !== id)); };
  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Operação</span><h1>Turnos</h1><p className="muted">Configure as janelas de registro. Alertas são gerados com base nos turnos ativos.</p></div><div className="page-actions"><span className="badge subtle">{activeTenant.name}</span></div></div>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">{editingId ? 'Editando' : 'Novo turno'}</span><h2>{editingId ? turns.find((t) => t.id === editingId)?.name ?? '' : 'Cadastrar turno'}</h2></div></div>
          <div className="capture-fields">
            <label>Empresa<select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)}>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Nome do turno<input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Ex.: Manhã, Tarde, Noite" /></label>
            <div className="grid-2">
              <label>Início<input type="time" value={startInput} onChange={(e) => setStartInput(e.target.value)} /></label>
              <label>Fim<input type="time" value={endInput} onChange={(e) => setEndInput(e.target.value)} /></label>
            </div>
            <div className="actions-row">
              {editingId && <button className="secondary-action" onClick={cancelEdit}>Cancelar</button>}
              <button className="primary-action" onClick={saveTurn}>{editingId ? 'Salvar' : 'Adicionar turno'}</button>
            </div>
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Hoje</span><h2>Status dos turnos</h2></div><span className="badge neutral">{turns.length} turnos</span></div>
          <div className="equipment-maintenance-list">
            {turns.map((turn) => { const active = isActive(turn), recs = turnRecs(turn), pct = catalog.length > 0 ? Math.round((Math.min(recs.length, catalog.length) / catalog.length) * 100) : 0; return (
              <div key={turn.id} className={`equipment-maintenance-row ${editingId === turn.id ? 'editing' : ''}`}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong>{turn.name}</strong>{active && <span className="badge ok">Ativo agora</span>}</div>
                  <span>{turn.start} – {turn.end}</span>
                  <span>{recs.length} registro{recs.length !== 1 ? 's' : ''} hoje · {pct}% coberto</span>
                </div>
                <div className="equipment-row-actions">
                  <button className="ghost-action" onClick={() => startEdit(turn)}>Editar</button>
                  <button className="ghost-action danger" onClick={() => removeTurn(turn.id)}>Remover</button>
                </div>
              </div>
            ); })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ─── Users View ────────────────────────────────────────────────────────────

function UsersView({ activeTenant, allTenants, onTenantChange }) {
  const [users, setUsers]                 = useState(() => readUsers(activeTenant));
  const [nameInput, setNameInput]         = useState('');
  const [roleInput, setRoleInput]         = useState('Funcionário');
  const [locationInput, setLocationInput] = useState('');
  const [statusInput, setStatusInput]     = useState('Ativo');
  const [editingIndex, setEditingIndex]   = useState(null);
  const [search, setSearch]               = useState('');
  const [roleFilter, setRoleFilter]       = useState('Todos');
  const [pinInput, setPinInput] = useState('0000');
  const roles = ['Funcionário', 'Supervisor', 'Nutricionista RT', 'Administrador'];
  useEffect(() => { setUsers(readUsers(activeTenant)); setEditingIndex(null); setNameInput(''); setRoleInput('Funcionário'); setLocationInput(''); setStatusInput('Ativo'); setPinInput('0000'); }, [activeTenant.id]);
  useEffect(() => { writeUsers(activeTenant.id, users); }, [activeTenant.id, users]);
  const startEdit = (i) => { const u = users[i]; setEditingIndex(i); setNameInput(u.name); setRoleInput(u.role); setLocationInput(u.location ?? ''); setStatusInput(u.status ?? 'Ativo'); setPinInput(u.pin ?? '0000'); };
  const cancelEdit = () => { setEditingIndex(null); setNameInput(''); setRoleInput('Funcionário'); setLocationInput(''); setStatusInput('Ativo'); setPinInput('0000'); };
  const saveUser = () => {
    if (!nameInput.trim()) return;
    const user = { name: nameInput.trim(), role: roleInput, location: locationInput.trim(), status: statusInput, pin: pinInput || '0000' };
    setUsers((prev) => editingIndex === null ? [...prev, user] : prev.map((u, i) => i === editingIndex ? user : u));
    cancelEdit();
  };
  const removeUser = (i) => { if (!window.confirm(`Remover "${users[i]?.name}"?`)) return; setUsers((prev) => prev.filter((_, idx) => idx !== i)); if (editingIndex === i) cancelEdit(); };
  const filtered = users.filter((u) => { const q = search.toLowerCase(); return (!q || u.name.toLowerCase().includes(q) || (u.location ?? '').toLowerCase().includes(q)) && (roleFilter === 'Todos' || u.role === roleFilter); }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Cadastro</span><h1>Usuários</h1><p className="muted">Gerencie os usuários por empresa. Aparecem no login e na trilha de auditoria.</p></div><div className="page-actions"><span className="badge subtle">{activeTenant.name}</span></div></div>
      <div className="audit-stats" style={{ marginBottom: 16 }}>{roles.map((r) => (<div key={r} className="audit-stat"><span>{r}</span><strong>{users.filter((u) => u.role === r).length}</strong></div>))}</div>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">{editingIndex === null ? 'Novo' : 'Editando'}</span><h2>{editingIndex === null ? 'Cadastrar usuário' : users[editingIndex]?.name}</h2></div><span className="badge neutral">{users.length}</span></div>
          <div className="capture-fields">
            <label>Empresa<select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)}>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Nome completo<input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Nome do usuário" /></label>
            <label>Perfil<select value={roleInput} onChange={(e) => setRoleInput(e.target.value)}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label>Localização / unidade<input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder="Ex.: Loja 1, Produção" /></label>
            <label>Status<select value={statusInput} onChange={(e) => setStatusInput(e.target.value)}><option value="Ativo">Ativo</option><option value="Inativo">Inativo</option><option value="Pendente">Pendente</option></select></label>
            <label>PIN de acesso (4–6 dígitos)
              <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="0000" inputMode="numeric" style={{ letterSpacing:'0.2em', fontFamily:'var(--mono)' }} />
            </label>
            <div className="actions-row">
              {editingIndex !== null && <button className="secondary-action" onClick={cancelEdit}>Cancelar</button>}
              <button className="primary-action" onClick={saveUser}>{editingIndex === null ? 'Adicionar' : 'Salvar alteração'}</button>
            </div>
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Lista</span><h2>Usuários cadastrados</h2></div><span className="badge neutral">{filtered.length}/{users.length}</span></div>
          <div className="capture-fields equipment-filters">
            <label>Buscar<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou localização" /></label>
            <label>Perfil<select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>{['Todos', ...roles].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          </div>
          <div className="equipment-maintenance-list">
            {filtered.length === 0 ? <p className="muted" style={{ padding: '16px 20px' }}>Nenhum usuário encontrado.</p>
              : filtered.map((u) => { const ri = users.indexOf(u); return (
                <div key={`${u.name}-${ri}`} className={`equipment-maintenance-row user-row ${editingIndex === ri ? 'editing' : ''}`}>
                  <div><strong>{u.name}</strong><span>{u.role} · {u.location || 'Sem localização'}</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${u.status === 'Ativo' ? 'ok' : u.status === 'Pendente' ? 'warn' : 'neutral'}`}>{u.status}</span>
                    <div className="equipment-row-actions"><button className="ghost-action" onClick={() => startEdit(ri)}>Editar</button><button className="ghost-action danger" onClick={() => removeUser(ri)}>Remover</button></div>
                  </div>
                </div>
              ); })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ─── Equipment View ────────────────────────────────────────────────────────

function EquipmentView({ activeTenant, allTenants, onTenantChange }) {
  const [catalog, setCatalog]               = useState(() => readEquipmentCatalog(activeTenant));
  const [labelInput, setLabelInput]         = useState('');
  const [aliasInput, setAliasInput]         = useState('');
  const [locationInput, setLocationInput]   = useState('');
  const [editingIndex, setEditingIndex]     = useState(null);
  const [search, setSearch]                 = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  useEffect(() => { setCatalog(readEquipmentCatalog(activeTenant)); setEditingIndex(null); setLabelInput(''); setAliasInput(''); setLocationInput(''); }, [activeTenant.id]);
  useEffect(() => { writeEquipmentCatalog(activeTenant.id, catalog); }, [activeTenant.id, catalog]);
  const startEdit = (i) => { const item = catalog[i]; setEditingIndex(i); setLabelInput(item.label); setAliasInput(item.aliases?.join(', ') ?? ''); setLocationInput(item.location ?? ''); };
  const cancelEdit = () => { setEditingIndex(null); setLabelInput(''); setAliasInput(''); setLocationInput(''); };
  const saveItem = () => {
    const label = labelInput.trim(); if (!label) return;
    const aliases = aliasInput.split(',').map((s) => s.trim()).filter(Boolean), location = locationInput.trim() || null;
    setCatalog((prev) => editingIndex === null ? [...prev, { label, aliases, location }] : prev.map((item, i) => i === editingIndex ? { ...item, label, aliases, location } : item));
    cancelEdit();
  };
  const removeItem = (i) => { if (!window.confirm(`Remover "${catalog[i]?.label}"?`)) return; setCatalog((prev) => prev.filter((_, idx) => idx !== i)); if (editingIndex === i) cancelEdit(); };
  const filtered = catalog.filter((item) => { const q = search.toLowerCase(), lf = locationFilter.toLowerCase(); return (!q || item.label.toLowerCase().includes(q) || item.aliases?.some((a) => a.toLowerCase().includes(q))) && (!lf || String(item.location ?? '').toLowerCase().includes(lf)); }).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Cadastro</span><h1>Equipamentos</h1><p className="muted">Nomes e apelidos usados no autocomplete do registro de temperatura.</p></div><div className="page-actions"><span className="badge subtle">{activeTenant.name}</span></div></div>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">{editingIndex === null ? 'Novo' : 'Editando'}</span><h2>{editingIndex === null ? 'Cadastrar equipamento' : catalog[editingIndex]?.label ?? ''}</h2></div><span className="badge neutral">{catalog.length}</span></div>
          <div className={`editing-banner ${editingIndex !== null ? 'active' : ''}`}><span className="eyebrow">Modo edição</span><strong>Editando: {catalog[editingIndex]?.label}</strong><p>Altere os campos e clique em Salvar.</p></div>
          <div className="capture-fields">
            <label>Empresa<select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)}>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Nome padrão<input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} placeholder="Ex.: Freezer, Refrigerador" /></label>
            <label>Variações / apelidos<input value={aliasInput} onChange={(e) => setAliasInput(e.target.value)} placeholder="Ex.: freezer, câmara congelada" /></label>
            <label>Localização (opcional)<input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder="Ex.: cozinha, estoque" /></label>
            <div className="actions-row">
              {editingIndex !== null && <button className="secondary-action" onClick={cancelEdit}>Cancelar</button>}
              <button className="primary-action" onClick={saveItem}>{editingIndex === null ? 'Adicionar' : 'Salvar alteração'}</button>
            </div>
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Lista</span><h2>Equipamentos cadastrados</h2></div><span className="badge neutral">{filtered.length}/{catalog.length}</span></div>
          <div className="capture-fields equipment-filters">
            <label>Buscar<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou apelido" /></label>
            <label>Localização<input value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} placeholder="Filtrar por local" /></label>
          </div>
          <div className="equipment-maintenance-list">
            {filtered.length === 0 ? <p className="muted" style={{ padding: '16px 20px' }}>Nenhum equipamento encontrado.</p>
              : filtered.map((item) => { const ri = catalog.indexOf(item); return (
                <div key={`${item.label}-${ri}`} className={`equipment-maintenance-row ${editingIndex === ri ? 'editing' : ''}`}>
                  <div><strong>{item.label}</strong><span>{item.aliases?.length ? item.aliases.join(' · ') : 'Sem apelidos'}</span><span>{item.location ?? 'Sem localização'}</span></div>
                  <div className="equipment-row-actions"><button className="ghost-action" onClick={() => startEdit(ri)}>Editar</button><button className="ghost-action danger" onClick={() => removeItem(ri)}>Remover</button></div>
                </div>
              ); })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ─── Recebimento de Mercadorias ────────────────────────────────────────────

const recStorageKey = (id) => `nutriops.receiving.${id}`;
const recLoad = (id) => { try { const r = localStorage.getItem(recStorageKey(id)); return r ? JSON.parse(r) : []; } catch { return []; } };
const recSave = (id, v) => { try { localStorage.setItem(recStorageKey(id), JSON.stringify(v)); } catch {} };

const RECEIVING_CHECKS = [
  { id: 'embalagem',   label: 'Embalagem íntegra e limpa' },
  { id: 'rotulagem',   label: 'Rotulagem e validade legíveis' },
  { id: 'veiculo',     label: 'Veículo de transporte limpo e adequado' },
  { id: 'entregador',  label: 'Higiene pessoal do entregador' },
  { id: 'temperatura', label: 'Temperatura dentro do esperado' },
  { id: 'aparencia',   label: 'Aparência e odor adequados' },
];

function RecebimentoView({ activeTenant, allTenants, onTenantChange, session }) {
  const [items, setItems]           = useState(() => recLoad(activeTenant.id));
  const [fornecedor, setFornecedor] = useState('');
  const [nf, setNf]                 = useState('');
  const [produto, setProduto]       = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [validade, setValidade]     = useState('');
  const [temperatura, setTemperatura] = useState('');
  const [checks, setChecks]         = useState({});
  const [resultado, setResultado]   = useState('');
  const [motivoRejeicao, setMotivoRejeicao] = useState('');
  const [obs, setObs]               = useState('');
  const [filter, setFilter]         = useState('all');
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);

  useEffect(() => { setItems(recLoad(activeTenant.id)); }, [activeTenant.id]);
  useEffect(() => { recSave(activeTenant.id, items); }, [activeTenant.id, items]);

  const allChecksOk = RECEIVING_CHECKS.every((c) => checks[c.id] === 'C');

  const handleSubmit = () => {
    if (!fornecedor.trim() || !produto.trim() || !resultado) return;
    setSaving(true);
    const record = {
      id: crypto.randomUUID(),
      tenantId: activeTenant.id,
      fornecedor: fornecedor.trim(),
      nf: nf.trim(),
      produto: produto.trim(),
      quantidade: quantidade.trim(),
      validade: validade.trim(),
      temperatura: temperatura.trim(),
      checks,
      resultado,
      motivoRejeicao: resultado === 'rejeitado' ? motivoRejeicao.trim() : '',
      obs: obs.trim(),
      user: session?.user?.name ?? '—',
      role: session?.user?.role ?? '',
      createdAt: new Date().toISOString(),
    };
    setItems((prev) => [record, ...prev].slice(0, 300));
    // Reset form
    setFornecedor(''); setNf(''); setProduto(''); setQuantidade('');
    setValidade(''); setTemperatura(''); setChecks({}); setResultado('');
    setMotivoRejeicao(''); setObs('');
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const toggleCheck = (id) => setChecks((prev) => ({ ...prev, [id]: prev[id] === 'C' ? 'NC' : prev[id] === 'NC' ? '' : 'C' }));

  const filtered = filter === 'all' ? items : items.filter((r) => r.resultado === filter);

  const exportCSV = () => {
    const cols = ['createdAt','fornecedor','nf','produto','quantidade','validade','temperatura','resultado','motivoRejeicao','obs','user'];
    const esc = (v) => `"${String(v??'').replaceAll('"','""')}"`;
    const csv = [cols.join(','), ...items.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href:url, download:`recebimento-${new Date().toISOString().slice(0,10)}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Controle de entrada</span>
          <h1>Recebimento de Mercadorias</h1>
          <p className="muted">Registro de inspeção na chegada: temperatura, condições, validade e resultado.</p>
        </div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width: 'auto' }}>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="secondary-action" onClick={exportCSV} style={{ fontSize: 12 }}>↓ CSV</button>
        </div>
      </div>

      <div className="management-grid">
        {/* Entry form */}
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Novo registro</span><h2>Registrar recebimento</h2></div></div>
          <div className="capture-fields">
            <div className="grid-2">
              <label>Fornecedor<input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Nome do fornecedor" /></label>
              <label>NF / Pedido<input value={nf} onChange={(e) => setNf(e.target.value)} placeholder="Número da nota fiscal" /></label>
            </div>
            <label>Produto / Descrição<input value={produto} onChange={(e) => setProduto(e.target.value)} placeholder="Descreva o produto recebido" /></label>
            <div className="grid-2">
              <label>Quantidade<input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="Ex.: 10 kg, 5 cx" /></label>
              <label>Data de validade<input value={validade} onChange={(e) => setValidade(e.target.value)} placeholder="DD/MM/AAAA" /></label>
            </div>
            <label>Temperatura na chegada (°C)
              <input value={temperatura} onChange={(e) => setTemperatura(e.target.value)} inputMode="decimal" placeholder="Se aplicável" />
            </label>

            {/* Checks */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-secondary)', marginBottom: 10 }}>Verificações de conformidade</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {RECEIVING_CHECKS.map((c) => {
                  const val = checks[c.id] ?? '';
                  return (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {['C', 'NC'].map((opt) => {
                          const on = val === opt;
                          const [bg, color, border] = opt === 'C' ? ['#dafbe1','#1a7f37','#4ac26b'] : ['#ffebe9','#cf222e','#ff8182'];
                          return (
                            <button key={opt} onClick={() => toggleCheck(c.id)}
                              style={{ padding: '4px 12px', borderRadius: 6, border: `1.5px solid ${on ? border : '#d0d7de'}`, background: on ? bg : 'white', color: on ? color : '#656d76', fontWeight: on ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Result */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Resultado</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['aceito', 'rejeitado', 'aceito_parcial'].map((opt) => {
                  const labels = { aceito: '✓ Aceito', rejeitado: '✗ Rejeitado', aceito_parcial: '~ Aceito parcial' };
                  const colors = { aceito: ['#dafbe1','#1a7f37','#4ac26b'], rejeitado: ['#ffebe9','#cf222e','#ff8182'], aceito_parcial: ['#fdf8e3','#9a6700','#e3aa14'] };
                  const [bg, color, border] = colors[opt];
                  const on = resultado === opt;
                  return (
                    <button key={opt} onClick={() => setResultado(on ? '' : opt)}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${on ? border : '#d0d7de'}`, background: on ? bg : 'white', color: on ? color : '#656d76', fontWeight: on ? 700 : 500, fontSize: 12, cursor: 'pointer', textAlign: 'center' }}>
                      {labels[opt]}
                    </button>
                  );
                })}
              </div>
            </div>

            {resultado === 'rejeitado' && (
              <label>Motivo da rejeição<textarea value={motivoRejeicao} onChange={(e) => setMotivoRejeicao(e.target.value)} placeholder="Descreva o motivo da rejeição…" style={{ minHeight: 60 }} /></label>
            )}
            <label>Observações<textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observações adicionais…" style={{ minHeight: 54 }} /></label>

            <div className="actions-row">
              <button className={`primary-action${resultado ? ' attention' : ''}`} onClick={handleSubmit}
                disabled={!fornecedor.trim() || !produto.trim() || !resultado || saving}>
                {saving ? 'Salvando…' : 'Registrar recebimento'}
              </button>
            </div>
            {saved && <div className="submission ok">✓ Recebimento registrado com sucesso.</div>}
          </div>
        </article>

        {/* History */}
        <article className="management-card">
          <div className="card-head">
            <div><span className="eyebrow">Histórico</span><h2>Registros de recebimento</h2></div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['all','aceito','rejeitado','aceito_parcial'].map((f) => {
                const labels = { all: 'Todos', aceito: 'Aceitos', rejeitado: 'Rejeitados', aceito_parcial: 'Parcial' };
                return (
                  <button key={f} onClick={() => setFilter(f)}
                    style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, fontWeight: 600, background: filter === f ? 'var(--text)' : 'var(--surface)', color: filter === f ? 'white' : 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                    {labels[f]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="equipment-maintenance-list">
            {filtered.length === 0
              ? <p className="muted" style={{ padding: '20px' }}>Nenhum registro encontrado.</p>
              : filtered.map((r) => {
                const tone = r.resultado === 'aceito' ? 'ok' : r.resultado === 'rejeitado' ? 'danger' : 'warn';
                const label = { aceito: 'Aceito', rejeitado: 'Rejeitado', aceito_parcial: 'Aceito parcial' }[r.resultado] ?? r.resultado;
                return (
                  <div key={r.id} className="equipment-maintenance-row" style={{ borderLeft: `3px solid ${tone === 'ok' ? 'var(--green-border)' : tone === 'danger' ? 'var(--red-border)' : 'var(--amber-border)'}` }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong>{r.produto}</strong>
                        <span className={`badge ${tone}`}>{label}</span>
                      </div>
                      <span>{r.fornecedor}{r.nf ? ` · NF ${r.nf}` : ''}</span>
                      <span>{r.quantidade}{r.validade ? ` · Val. ${r.validade}` : ''}{r.temperatura ? ` · ${r.temperatura}°C` : ''}</span>
                      {r.motivoRejeicao && <span style={{ color: 'var(--red)', fontSize: 11 }}>Rejeição: {r.motivoRejeicao}</span>}
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatCompactDateTime(r.createdAt)} · {r.user}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ─── Offline Indicator ─────────────────────────────────────────────────────

function OfflineIndicator() {
  const [online, setOnline]     = useState(() => navigator.onLine);
  const [queueCount, setQCount] = useState(() => getOfflineQueue().length);
  const [syncing, setSyncing]   = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    const up   = () => { setOnline(true);  setQCount(getOfflineQueue().length); };
    const down = () => { setOnline(false); setQCount(getOfflineQueue().length); };
    window.addEventListener('online',  up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  // Refresh queue count every 10s
  useEffect(() => {
    const t = setInterval(() => setQCount(getOfflineQueue().length), 10000);
    return () => clearInterval(t);
  }, []);

  const handleSync = async () => {
    if (!isSupabaseEnabled()) return;
    setSyncing(true); setSyncResult(null);
    try {
      const result = await supabaseRepository.syncQueue();
      setQCount(getOfflineQueue().length);
      setSyncResult(result);
      setTimeout(() => setSyncResult(null), 4000);
    } catch { /* */ }
    setSyncing(false);
  };

  if (online && queueCount === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 10,
      background: online ? '#fdf8e3' : '#ffebe9',
      border: `1px solid ${online ? '#e3aa14' : '#ff8182'}`,
      boxShadow: '0 4px 16px rgba(0,0,0,.12)',
      fontSize: 13, fontFamily: 'var(--font)',
    }}>
      <span style={{ fontWeight: 700, color: online ? '#9a6700' : '#cf222e' }}>
        {online ? `⚡ ${queueCount} registro${queueCount > 1 ? 's' : ''} para sincronizar` : '📡 Sem conexão'}
      </span>
      {online && queueCount > 0 && isSupabaseEnabled() && (
        <button onClick={handleSync} disabled={syncing}
          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #e3aa14', background: '#9a6700', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>
          {syncing ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      )}
      {syncResult && (
        <span style={{ fontSize: 11, color: '#065f46' }}>✓ {syncResult.synced} sincronizado{syncResult.synced > 1 ? 's' : ''}</span>
      )}
    </div>
  );
}

// ─── Settings View ─────────────────────────────────────────────────────────

function SettingsView({ session }) {
  const cfg = getSupabaseConfig();
  const [url,     setUrl]     = useState(cfg.url ?? '');
  const [anonKey, setAnonKey] = useState(cfg.anonKey ?? '');
  const [enabled, setEnabled] = useState(cfg.enabled ?? false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [copied,  setCopied]  = useState(false);
  const [migrating, setMigrating]     = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);
  // PIN change
  const [currentPin, setCurrentPin] = useState('');
  const [newPin,     setNewPin]     = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMsg,     setPinMsg]     = useState(null);

  const handleSave = () => {
    saveSupabaseConfig({ url: url.trim(), anonKey: anonKey.trim(), enabled });
    window.location.reload();
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    saveSupabaseConfig({ url: url.trim(), anonKey: anonKey.trim(), enabled: true });
    const result = await supabaseRepository.testConnection();
    setTestResult(result); setTesting(false);
  };

  const testMessage = () => {
    if (!testResult) return null;
    if (testResult.ok) return { tone:'ok', text:'✓ Conexão estabelecida! Tabela encontrada.' };
    if (testResult.reason==='table_missing') return { tone:'warn', text:'⚠ Supabase conectado, mas a tabela não existe. Copie e execute o SQL abaixo.' };
    if (testResult.reason==='auth_error')    return { tone:'danger', text:'✕ Chave inválida. Verifique o Anon Key.' };
    if (testResult.reason==='network_error') return { tone:'danger', text:'✕ Não foi possível conectar. Verifique a URL.' };
    return { tone:'danger', text:`✕ Erro (${testResult.reason}).` };
  };
  const msg = testMessage();
  const tableMissing = testResult?.reason === 'table_missing';

  const copySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  // ── Migrate localStorage → Supabase ──
  const handleMigrate = async () => {
    if (!isSupabaseEnabled()) { setMigrateResult({ tone:'warn', text:'Habilite o Supabase primeiro.' }); return; }
    const raw = localStorage.getItem('nutriops.temperature.records');
    const records = raw ? JSON.parse(raw) : [];
    if (records.length === 0) { setMigrateResult({ tone:'warn', text:'Nenhum registro encontrado no localStorage.' }); return; }
    setMigrating(true); setMigrateResult(null);
    let ok = 0, fail = 0;
    for (const r of records) {
      try { await supabaseRepository.create(r); ok++; } catch { fail++; }
    }
    setMigrating(false);
    setMigrateResult({ tone: fail===0?'ok':'warn', text:`${ok} registro${ok!==1?'s':''} migrado${ok!==1?'s':''}${fail>0?` · ${fail} falha(s)`:''}. ✓` });
  };

  // ── Change own PIN ──
  const handleChangePin = () => {
    setPinMsg(null);
    if (!session?.user) return;
    if (newPin.length < 4) { setPinMsg({ tone:'danger', text:'PIN deve ter no mínimo 4 dígitos.' }); return; }
    if (newPin !== confirmPin) { setPinMsg({ tone:'danger', text:'Os PINs não coincidem.' }); return; }
    // Find user in their tenant's storage
    const tenantId = session.tenantId;
    const usersKey = `nutriops.users.${tenantId}`;
    const users = JSON.parse(localStorage.getItem(usersKey) ?? 'null') ??
      (tenants.find(t=>t.id===tenantId)?.usersList ?? []);
    const expectedPin = (users.find(u=>u.name===session.user.name)?.pin ?? '0000');
    if (currentPin !== expectedPin) { setPinMsg({ tone:'danger', text:'PIN atual incorreto.' }); return; }
    const updated = users.map(u => u.name===session.user.name ? { ...u, pin: newPin } : u);
    localStorage.setItem(usersKey, JSON.stringify(updated));
    setCurrentPin(''); setNewPin(''); setConfirmPin('');
    setPinMsg({ tone:'ok', text:'✓ PIN alterado com sucesso!' });
  };

  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Infraestrutura</span><h1>Configurações</h1><p className="muted">Supabase, migração de dados e segurança de acesso.</p></div></div>

      <div className="management-grid">
        {/* Supabase */}
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Backend</span><h2>Supabase</h2></div>
            <span className={`badge ${isSupabaseEnabled()?'ok':'neutral'}`}>{isSupabaseEnabled()?'Conectado':'Modo local'}</span>
          </div>
          <div className="capture-fields">
            <label>Project URL<input value={url} onChange={(e)=>setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></label>
            <label>Anon Key<textarea value={anonKey} onChange={(e)=>setAnonKey(e.target.value)} placeholder="eyJ…" style={{ minHeight:72, fontFamily:'var(--mono)', fontSize:12 }} /></label>
            <label style={{ flexDirection:'row', alignItems:'center', gap:10, cursor:'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={(e)=>setEnabled(e.target.checked)} />
              <span style={{ color:'var(--text)', fontWeight:600 }}>Usar Supabase como banco de dados</span>
            </label>
            <div className="actions-row">
              <button className="secondary-action" onClick={handleTest} disabled={testing||!url||!anonKey}>{testing?'Testando…':'Testar conexão'}</button>
              <button className="primary-action" onClick={handleSave}>Salvar configurações</button>
            </div>
            {msg && <div className={`submission ${msg.tone}`}>{msg.text}</div>}
          </div>
        </article>

        {/* SQL */}
        <article className="management-card" style={tableMissing?{borderColor:'var(--amber-border)',boxShadow:'0 0 0 3px rgba(154,103,0,.1)'}:{}}>
          <div className="card-head">
            <div><span className="eyebrow">SQL</span><h2>Schema do banco de dados</h2>
              {tableMissing && <p style={{ fontSize:12, color:'var(--amber)', fontWeight:600, marginTop:4 }}>👆 Execute este SQL no Supabase</p>}
            </div>
            <button className="secondary-action" style={{ fontSize:12 }} onClick={copySql}>{copied?'✓ Copiado!':'Copiar SQL'}</button>
          </div>
          <div style={{ padding:'12px 16px' }}>
            <p className="muted" style={{ marginBottom:12 }}>Cole no Supabase → SQL Editor → New query → Run.</p>
            <pre style={{ fontFamily:'var(--mono)', fontSize:11, background:'var(--rail-bg)', color:'#e6edf3', padding:16, borderRadius:'var(--r)', overflow:'auto', lineHeight:1.6, maxHeight:280 }}>{SUPABASE_SQL}</pre>
          </div>
        </article>
      </div>

      {/* Migration */}
      <article className="management-card" style={{ marginTop:16 }}>
        <div className="card-head">
          <div><span className="eyebrow">Migração</span><h2>Transferir dados locais para o Supabase</h2></div>
          <span className="badge neutral">{(() => { try { return JSON.parse(localStorage.getItem('nutriops.temperature.records')||'[]').length; } catch { return 0; } })()} registros locais</span>
        </div>
        <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column', gap:12 }}>
          <p className="muted">Envia todos os registros de temperatura do localStorage para o Supabase. Só funciona com o Supabase habilitado. Registros existentes no Supabase podem ser duplicados — execute apenas uma vez.</p>
          <div className="actions-row">
            <button className="primary-action" onClick={handleMigrate} disabled={migrating||!isSupabaseEnabled()}>
              {migrating ? '⏳ Migrando…' : '↑ Migrar registros locais para Supabase'}
            </button>
          </div>
          {migrateResult && <div className={`submission ${migrateResult.tone}`}>{migrateResult.text}</div>}
        </div>
      </article>

      {/* Change PIN */}
      <article className="management-card" style={{ marginTop:16 }}>
        <div className="card-head"><div><span className="eyebrow">Segurança</span><h2>Alterar meu PIN</h2></div>
          <span className="badge neutral">{session?.user?.name}</span>
        </div>
        <div className="capture-fields" style={{ maxWidth:360 }}>
          <label>PIN atual
            <input type="password" inputMode="numeric" maxLength={6} value={currentPin} onChange={(e)=>setCurrentPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }} />
          </label>
          <label>Novo PIN (4–6 dígitos)
            <input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={(e)=>setNewPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }} />
          </label>
          <label>Confirmar novo PIN
            <input type="password" inputMode="numeric" maxLength={6} value={confirmPin} onChange={(e)=>setConfirmPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }}
              onKeyDown={(e)=>{ if(e.key==='Enter') handleChangePin(); }} />
          </label>
          <button className="primary-action" onClick={handleChangePin} disabled={!currentPin||!newPin||!confirmPin}>Alterar PIN</button>
          {pinMsg && <div className={`submission ${pinMsg.tone}`}>{pinMsg.text}</div>}
        </div>
      </article>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════

export function App() {
  const repository = useMemo(() => getTemperatureRepository(), []);
  const [session, setSession]   = useState(() => readSession());
  const handleLogin  = useCallback((s) => setSession(s), []);
  const handleLogout = useCallback(() => { localStorage.removeItem(SESSION_KEY); setSession(null); }, []);

  const [activeTenantId, setActiveTenantId] = useState(() => session?.tenantId ?? tenants[0].id);
  const [activeView, setActiveView]         = useState('overview');
  const [records, setRecords]               = useState([]);
  const [equipmentCatalog, setEquipmentCatalog] = useState(() => readEquipmentCatalog(tenants.find((t) => t.id === (session?.tenantId ?? tenants[0].id)) ?? tenants[0]));

  const perms        = getPermissions(session?.user?.role);
  const activeTenant = useMemo(() => tenants.find((t) => t.id === activeTenantId) ?? tenants[0], [activeTenantId]);

  // Non-multiTenant users only see their own company
  const visibleTenants = useMemo(() =>
    perms.multiTenant ? tenants : tenants.filter((t) => t.id === session?.tenantId),
  [perms.multiTenant, session?.tenantId]);

  // Non-multiTenant users are locked to their company
  const handleTenantChange = useCallback((id) => {
    if (!perms.multiTenant) return;
    setActiveTenantId(id);
    setEquipmentCatalog(readEquipmentCatalog(tenants.find((x) => x.id === id) ?? tenants[0]));
  }, [perms.multiTenant]);

  const refreshRecords = useCallback(async () => {
    // Load records for all companies (RT/Admin) or just own company
    const tenantsToLoad = perms.multiTenant ? tenants : [activeTenant];
    const all = await Promise.all(tenantsToLoad.map(async (t) => { const items = await repository.list({ tenantId: t.id, days: 90 }); return items.map((r) => ({ ...r, tenantName: r.tenantName ?? t.name })); }));
    setRecords(all.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }, [repository, perms.multiTenant, activeTenant]);

  useEffect(() => { refreshRecords(); }, [refreshRecords]);

  const turns      = readTurns(activeTenant);
  const alertCount = useMemo(() => computeTurnAlerts(turns, records, equipmentCatalog, activeTenant.id).length, [records, activeTenant.id, equipmentCatalog]);
  const actionCount = useMemo(() => readActions(activeTenant.id).filter((a) => a.status !== 'resolvida').length, [records, activeTenant.id]);

  if (!session) return <LoginScreen onLogin={handleLogin} />;

  const sharedProps = { activeTenant, allTenants: visibleTenants, onTenantChange: handleTenantChange };

  return (
    <div className="super-shell">
      <RailNav {...sharedProps} activeView={activeView} setActiveView={setActiveView}
        session={session} records={records} alertCount={alertCount} actionCount={actionCount} onLogout={handleLogout} />
      <main className="super-main">
        {activeView === 'overview'   && <OverviewView {...sharedProps} session={session} equipmentCatalog={equipmentCatalog} records={records} onRecordSaved={refreshRecords} alerts={computeTurnAlerts(turns, records, equipmentCatalog, activeTenant.id)} />}
        {activeView === 'reports'    && <ReportsView allTenants={visibleTenants} records={records} />}
        {activeView === 'forms'      && <FormsView activeTenant={activeTenant} allTenants={visibleTenants} onTenantChange={handleTenantChange} session={session} />}
        {activeView === 'training'   && <TrainingView activeTenant={activeTenant} allTenants={visibleTenants} onTenantChange={handleTenantChange} session={session} />}
        {activeView === 'receiving'  && <RecebimentoView {...sharedProps} session={session} />}
        {activeView === 'dashboard'  && <DashboardView {...sharedProps} records={records} />}
        {activeView === 'charts'     && <ChartsView {...sharedProps} records={records} />}
        {activeView === 'audit'      && <AuditView allTenants={visibleTenants} records={records} session={session} />}
        {activeView === 'alerts'     && <AlertsView {...sharedProps} records={records} />}
        {activeView === 'actions'    && <CorrectiveActionsView {...sharedProps} records={records} />}
        {activeView === 'turns'      && <TurnsView {...sharedProps} records={records} />}
        {activeView === 'users'      && <UsersView {...sharedProps} />}
        {activeView === 'equipment'  && <EquipmentView {...sharedProps} />}
        {activeView === 'settings'   && <SettingsView session={session} />}
      </main>
      <OfflineIndicator />
    </div>
  );
}
