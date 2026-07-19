import React, { useEffect, useMemo, useRef, useState } from 'react';
import { readFormRecords, readFormTemplates, catMeta, formatPeriodLabel, getPeriodKey, freqLabel } from './forms';
import { readSessions } from './training';
import { APP_VERSION } from './pages';
import { buildCommands, matchCommands, readRecentCommandIds, pushRecentCommandId } from './commands';
import CountUp from './count-up';

// ─── Storage ───────────────────────────────────────────────────────────────

const sk  = (k, id) => `nutriops.${k}.${id}`;
const sl  = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const ss  = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const readHandwash  = (id) => sl(sk('handwash', id), []);
export const writeHandwash = (id, v) => ss(sk('handwash', id), v);
export const readSessions2 = (id) => sl(sk('sessions', id), []);
export const writeSessions2 = (id, v) => ss(sk('sessions', id), v.slice(0, 100));

function uid() { return crypto.randomUUID(); }
function fmtDT(iso) { try { return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch { return iso; } }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; } }

// ─── Session logger ────────────────────────────────────────────────────────

export function logSession(tenantId, user) {
  const sessions = readSessions2(tenantId);
  const entry = {
    id: uid(), user: user.name, role: user.role,
    loginAt: new Date().toISOString(),
    device: navigator.userAgent.slice(0, 80),
  };
  writeSessions2(tenantId, [entry, ...sessions]);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PAINEL DA RT
// ═══════════════════════════════════════════════════════════════════════════

export function RTPanelView({ allTenants, records, session }) {
  const now = Date.now();

  const data = useMemo(() => allTenants.map(tenant => {
    const templates = readFormTemplates(tenant);
    const formRecs  = readFormRecords(tenant.id);
    const trainSess = readSessions(tenant.id);
    const users     = sl(`nutriops.users.${tenant.id}`, tenant.usersList ?? []);
    const config    = sl(`nutriops.training.config.${tenant.id}`, { validityMonths: 12 });
    const validity  = config.validityMonths * 30 * 86400000;

    // Forms pending RT validation
    const pendingForms = formRecs.filter(r => r.status === 'submitted' && !r.validation);

    // Training expiring within 30 days
    const expiringTraining = users.filter(u => {
      const completed = trainSess
        .filter(s => s.status === 'closed' && s.participants?.some(p => p.name === u.name && p.confirmed))
        .sort((a,b) => new Date(b.date) - new Date(a.date));
      if (!completed.length) return true;
      const daysAgo = Math.floor((now - new Date(completed[0].date).getTime()) / 86400000);
      return daysAgo >= validity * 0.85 / 86400000;
    });

    // Temperature out of range today
    const todayRecords = records.filter(r => r.tenantId === tenant.id && new Date(r.createdAt).toDateString() === new Date().toDateString());
    const outOfRange = todayRecords.filter(r => {
      const v = Number(r.value), mn = Number(r.min), mx = Number(r.max);
      return !isNaN(v) && !isNaN(mn) && !isNaN(mx) && (v < mn || v > mx);
    });

    // Compliance this month
    const monthRecs = records.filter(r => r.tenantId === tenant.id && now - new Date(r.createdAt).getTime() <= 30 * 86400000);
    const ok = monthRecs.filter(r => { const v=Number(r.value),mn=Number(r.min),mx=Number(r.max); return !isNaN(v)&&!isNaN(mn)&&!isNaN(mx)&&v>=mn&&v<=mx; }).length;
    const compliance = monthRecs.length > 0 ? Math.round((ok / monthRecs.length) * 100) : null;

    return { tenant, pendingForms, expiringTraining, outOfRange, compliance, monthRecs: monthRecs.length };
  }), [allTenants, records, now]);

  const totalPending = data.reduce((a, d) => a + d.pendingForms.length, 0);
  const totalExpiring = data.reduce((a, d) => a + d.expiringTraining.length, 0);
  const totalOutOfRange = data.reduce((a, d) => a + d.outOfRange.length, 0);

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Nutricionista RT</span>
          <h1>Painel da RT</h1>
          <p className="muted">Visão consolidada de pendências, validações e conformidade em todas as empresas.</p>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:13, fontWeight:700 }}>{session?.user?.name}</div>
          <div style={{ fontSize:11, color:'var(--text-secondary)' }}>Nutricionista RT</div>
        </div>
      </div>

      {/* Global KPIs */}
      <div className="audit-stats dash-stagger" style={{ marginBottom:20 }}>
        <div className={`audit-stat ${totalPending > 0 ? 'warn' : 'ok'}`}>
          <span>Planilhas p/ validar</span><strong style={{ fontVariantNumeric:'tabular-nums' }}><CountUp text={String(totalPending)} /></strong>
        </div>
        <div className={`audit-stat ${totalExpiring > 0 ? 'warn' : 'ok'}`}>
          <span>Treinamentos vencendo</span><strong style={{ fontVariantNumeric:'tabular-nums' }}><CountUp text={String(totalExpiring)} /></strong>
        </div>
        <div className={`audit-stat ${totalOutOfRange > 0 ? 'danger' : 'ok'}`}>
          <span>Desvios hoje</span><strong style={{ fontVariantNumeric:'tabular-nums' }}><CountUp text={String(totalOutOfRange)} /></strong>
        </div>
        <div className="audit-stat ok">
          <span>Empresas monitoradas</span><strong style={{ fontVariantNumeric:'tabular-nums' }}><CountUp text={String(allTenants.length)} /></strong>
        </div>
      </div>

      {/* Per company */}
      <div className="dash-stagger" style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {data.map(({ tenant, pendingForms, expiringTraining, outOfRange, compliance, monthRecs }) => (
          <article key={tenant.id} className="management-card" style={{ borderLeft:`4px solid ${tenant.brandColor}` }}>
            <div className="card-head">
              <div>
                <h2 style={{ color: tenant.brandColor }}>{tenant.name}</h2>
                <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{tenant.segment} · {monthRecs} registros (30d) · Conformidade: <strong style={{ color: compliance===null?'var(--text-secondary)':compliance>=90?'var(--green)':compliance>=70?'var(--amber)':'var(--red)' }}>{compliance !== null ? `${compliance}%` : '—'}</strong></span>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {pendingForms.length > 0  && <span className="badge warn">{pendingForms.length} planilha{pendingForms.length!==1?'s':''} p/ validar</span>}
                {expiringTraining.length > 0 && <span className="badge warn">{expiringTraining.length} treinamento{expiringTraining.length!==1?'s':''} vencendo</span>}
                {outOfRange.length > 0    && <span className="badge danger">{outOfRange.length} desvio{outOfRange.length!==1?'s':''} hoje</span>}
                {pendingForms.length===0 && expiringTraining.length===0 && outOfRange.length===0 && <span className="badge ok">✓ Em dia</span>}
              </div>
            </div>
            {(pendingForms.length > 0 || outOfRange.length > 0 || expiringTraining.length > 0) && (
              <div style={{ padding:'10px 20px 12px', display:'flex', flexDirection:'column', gap:6 }}>
                {pendingForms.slice(0,3).map(f => (
                  <div key={f.id} style={{ fontSize:12, display:'flex', gap:8, alignItems:'center' }}>
                    <span className="badge warn" style={{ fontSize:10 }}>Planilha</span>
                    <span>{f.formTitle} · {formatPeriodLabel(f.frequency, f.periodKey)} · {f.user}</span>
                  </div>
                ))}
                {outOfRange.slice(0,3).map(r => (
                  <div key={r.id} style={{ fontSize:12, display:'flex', gap:8, alignItems:'center' }}>
                    <span className="badge danger" style={{ fontSize:10 }}>Desvio</span>
                    <span>{r.equipmentInput||r.equipment} · <strong style={{ fontFamily:'var(--mono)' }}>{r.value}°C</strong> · {r.user}</span>
                  </div>
                ))}
                {expiringTraining.slice(0,3).map(u => (
                  <div key={u.name} style={{ fontSize:12, display:'flex', gap:8, alignItems:'center' }}>
                    <span className="badge warn" style={{ fontSize:10 }}>Treinamento</span>
                    <span>{u.name} · {u.role}</span>
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

// ═══════════════════════════════════════════════════════════════════════════
// 2. PERFIL DO USUÁRIO
// ═══════════════════════════════════════════════════════════════════════════

export function ProfileView({ session, onLogout }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin,     setNewPin]     = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMsg,     setPinMsg]     = useState(null);
  const [showPin,    setShowPin]    = useState(false);

  const sessionHistory = readSessions2(session?.tenantId).filter(s => s.user === session?.user?.name).slice(0, 8);

  const handleChangePin = () => {
    setPinMsg(null);
    if (newPin.length < 4) { setPinMsg({ tone:'danger', text:'PIN deve ter no mínimo 4 dígitos.' }); return; }
    if (newPin !== confirmPin) { setPinMsg({ tone:'danger', text:'Os PINs não coincidem.' }); return; }
    const usersKey = `nutriops.users.${session.tenantId}`;
    const tenants  = JSON.parse(localStorage.getItem('nutriops.data.tenants') ?? 'null');
    const users    = JSON.parse(localStorage.getItem(usersKey) ?? 'null') ?? [];
    const expected = users.find(u => u.name === session.user.name)?.pin ?? '0000';
    if (currentPin !== expected) { setPinMsg({ tone:'danger', text:'PIN atual incorreto.' }); return; }
    const updated = users.map(u => u.name === session.user.name ? { ...u, pin: newPin } : u);
    localStorage.setItem(usersKey, JSON.stringify(updated));
    setCurrentPin(''); setNewPin(''); setConfirmPin('');
    setPinMsg({ tone:'ok', text:'✓ PIN alterado com sucesso!' });
  };

  const pinStyle = { letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' };

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Conta</span><h1>Meu perfil</h1></div>
        <button className="ghost-action danger" onClick={onLogout}>Sair da conta</button>
      </div>

      <div className="management-grid">
        {/* Profile info */}
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Dados</span><h2>Informações da conta</h2></div></div>
          <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:16, padding:'16px', background:'var(--surface-muted)', borderRadius:'var(--r)', border:'1px solid var(--border-subtle)' }}>
              <div style={{ width:56, height:56, borderRadius:'50%', background:'var(--primary,#00684a)', display:'grid', placeItems:'center', fontSize:22, fontWeight:800, color:'white', flexShrink:0 }}>
                {session?.user?.name?.charAt(0) ?? '?'}
              </div>
              <div>
                <div style={{ fontSize:18, fontWeight:800, letterSpacing:'-.03em' }}>{session?.user?.name}</div>
                <div style={{ fontSize:13, color:'var(--text-secondary)', marginTop:2 }}>{session?.user?.role}</div>
                {session?.user?.location && <div style={{ fontSize:12, color:'var(--text-secondary)' }}>📍 {session.user.location}</div>}
              </div>
            </div>
            <div className="kpi"><span>NutriOPS</span><strong>v{APP_VERSION}</strong></div>
            <div className="kpi"><span>Sessão iniciada</span><strong>{fmtDT(new Date().toISOString())}</strong></div>
          </div>
        </article>

        {/* Change PIN */}
        <article className="management-card">
          <div className="card-head">
            <div><span className="eyebrow">Segurança</span><h2>Alterar PIN</h2></div>
            <button className="ghost-action" style={{ fontSize:11 }} onClick={() => setShowPin(!showPin)}>
              {showPin ? 'Ocultar' : 'Mostrar'} campos
            </button>
          </div>
          {showPin && (
            <div className="capture-fields">
              <label>PIN atual<input type="password" inputMode="numeric" maxLength={6} value={currentPin} onChange={e=>setCurrentPin(e.target.value.replace(/\D/g,''))} placeholder="••••" style={pinStyle} /></label>
              <label>Novo PIN<input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,''))} placeholder="••••" style={pinStyle} /></label>
              <label>Confirmar novo PIN<input type="password" inputMode="numeric" maxLength={6} value={confirmPin} onChange={e=>setConfirmPin(e.target.value.replace(/\D/g,''))} placeholder="••••" onKeyDown={e=>{ if(e.key==='Enter') handleChangePin(); }} style={pinStyle} /></label>
              <button className="primary-action" onClick={handleChangePin} disabled={!currentPin||!newPin||!confirmPin}>Alterar PIN</button>
              {pinMsg && <div className={`submission ${pinMsg.tone}`}>{pinMsg.text}</div>}
            </div>
          )}
        </article>
      </div>

      {/* Session history */}
      {sessionHistory.length > 0 && (
        <article className="management-card" style={{ marginTop:16 }}>
          <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Meus últimos acessos</h2></div></div>
          <div className="equipment-maintenance-list">
            {sessionHistory.map(s => (
              <div key={s.id} className="equipment-maintenance-row">
                <div>
                  <strong>{fmtDT(s.loginAt)}</strong>
                  <span style={{ fontSize:11, color:'var(--text-secondary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:300 }}>{s.device}</span>
                </div>
                <span className="badge ok" style={{ fontSize:10 }}>Login</span>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. BUSCA GLOBAL
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// GlobalSearch == Command Palette (Cmd+K)
// Linear-style: comandos como héroi, busca em registros como modo secundário.
//
// Resultados ordenados em grupos:
//   1. Recentes (top 3 do histórico)
//   2. Navegação / Ações (filtrado por query)
//   3. Resultados de busca (registros, templates, planilhas)
//
// Keyboard: ↑↓ navega, Enter executa, ESC fecha
// ─────────────────────────────────────────────────────────────────────────────

export function GlobalSearch({
  records, allTenants, activeTenant, session,
  onNavigate, onClose, onLogout, onLaunchKiosk, onTenantChange,
  switchableTenants, onRequestTenantSwitch,
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setCursor(0); }, [query]);

  // Catálogo de comandos disponíveis pra esse usuário
  const commands = useMemo(
    () => buildCommands(
      { session, allTenants, activeTenant, switchableTenants },
      { onNavigate, onClose, onLogout, onLaunchKiosk, onTenantChange, onRequestTenantSwitch },
    ),
    [session, allTenants, activeTenant, switchableTenants, onNavigate, onClose, onLogout, onLaunchKiosk, onTenantChange, onRequestTenantSwitch],
  );

  // Recentes — só relevante sem query
  const recentItems = useMemo(() => {
    if (query.trim()) return [];
    const ids = readRecentCommandIds();
    return ids.map(id => commands.find(c => c.id === id)).filter(Boolean).slice(0, 3);
  }, [commands, query]);

  // Comandos filtrados (ou todos se query vazia, excluindo recentes)
  const filteredCommands = useMemo(() => {
    const matched = matchCommands(query, commands);
    if (!query.trim()) {
      const recentIds = new Set(recentItems.map(r => r.id));
      return matched.filter(c => !recentIds.has(c.id));
    }
    return matched;
  }, [query, commands, recentItems]);

  // Busca de registros (modo busca) — só com query >= 2 chars
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];

    records.forEach(r => {
      const blob = [r.equipmentInput, r.equipment, r.tenantName, r.user, r.note, String(r.value)].join(' ').toLowerCase();
      if (blob.includes(q)) {
        out.push({
          id: `rec:${r.id}`,
          kind: 'record',
          label: `${r.equipmentInput || r.equipment} — ${r.value}°C`,
          hint: `${r.tenantName} · ${fmtDT(r.createdAt)} · ${r.user}`,
          run: () => { onNavigate('audit'); onClose(); },
        });
      }
    });

    allTenants.forEach(tenant => {
      const templates = readFormTemplates(tenant);
      const formRecs  = readFormRecords(tenant.id);
      templates.forEach(t => {
        if (t.title.toLowerCase().includes(q)) {
          out.push({
            id: `tpl:${tenant.id}:${t.id}`,
            kind: 'template',
            label: t.title,
            hint: `${tenant.name} · ${freqLabel(t.frequency)}`,
            run: () => { onNavigate('forms'); onClose(); },
          });
        }
      });
      formRecs.forEach(r => {
        if (r.formTitle?.toLowerCase().includes(q)) {
          out.push({
            id: `fr:${r.id}`,
            kind: 'form-record',
            label: r.formTitle,
            hint: `${r.tenantName} · ${formatPeriodLabel(r.frequency, r.periodKey)} · ${r.user}`,
            run: () => { onNavigate('forms'); onClose(); },
          });
        }
      });
    });

    return out.slice(0, 10);
  }, [query, records, allTenants, onNavigate, onClose]);

  // Lista achatada pro keyboard nav (recentes + comandos + busca)
  const flatItems = useMemo(
    () => [...recentItems, ...filteredCommands, ...searchResults],
    [recentItems, filteredCommands, searchResults],
  );

  const runItem = (item) => {
    if (!item) return;
    pushRecentCommandId(item.id);
    item.run();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, Math.max(flatItems.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(flatItems[cursor]);
    }
  };

  // Auto-scroll item ativo
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let runningIdx = 0;
  const renderItem = (item, sectionLabel) => {
    const idx = runningIdx++;
    const active = idx === cursor;
    return (
      <div
        key={item.id}
        data-cmd-idx={idx}
        onClick={() => runItem(item)}
        onMouseEnter={() => setCursor(idx)}
        style={{
          display:'flex', alignItems:'center', gap:12,
          padding:'10px 16px', cursor:'pointer',
          background: active ? 'var(--surface-muted, #f4f7f6)' : 'transparent',
          borderLeft: active ? '2px solid var(--primary, #00684a)' : '2px solid transparent',
        }}
      >
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:500, color:'var(--text, #001e2b)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {item.label}
          </div>
          {item.hint && (
            <div style={{ fontSize:11, color:'var(--text-secondary, #5c6c7a)', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {item.hint}
            </div>
          )}
        </div>
        {active && (
          <kbd style={{ flexShrink:0, padding:'2px 6px', fontSize:10, color:'var(--text-secondary, #5c6c7a)', border:'1px solid var(--border, #c1ccd6)', borderRadius:4, fontFamily:'monospace' }}>↵</kbd>
        )}
      </div>
    );
  };

  const SectionHeader = ({ children }) => (
    <div style={{
      padding:'10px 16px 4px', fontSize:10, fontWeight:700,
      letterSpacing:'.12em', textTransform:'uppercase',
      color:'var(--text-secondary, #5c6c7a)',
    }}>{children}</div>
  );

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(20,20,19,.55)', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'80px 24px 24px' }}
      onClick={onClose}
    >
      <div
        style={{ background:'var(--surface, white)', border:'1px solid var(--border, #c1ccd6)', borderRadius:14, width:'100%', maxWidth:600, boxShadow:'0 24px 64px rgba(20,20,19,.25)', overflow:'hidden', display:'flex', flexDirection:'column', maxHeight:'70vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', borderBottom:'1px solid var(--border-subtle, #e1e5e8)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color:'var(--text-secondary, #5c6c7a)' }}>
            <circle cx="11" cy="11" r="7"/><path d="m21 21-3.5-3.5"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Comando ou busca…  ex: ir relatórios, novo, freezer"
            style={{ flex:1, border:'none', outline:'none', fontSize:15, fontFamily:'inherit', background:'transparent', color:'var(--text, #001e2b)' }}
          />
          <kbd style={{ padding:'2px 8px', borderRadius:6, border:'1px solid var(--border, #c1ccd6)', fontSize:10, color:'var(--text-secondary, #5c6c7a)', background:'var(--surface-muted, #f4f7f6)', fontFamily:'monospace' }}>ESC</kbd>
        </div>

        {/* Lista */}
        <div ref={listRef} style={{ flex:1, overflowY:'auto', padding:'4px 0' }}>
          {recentItems.length > 0 && (
            <>
              <SectionHeader>Recentes</SectionHeader>
              {recentItems.map(c => renderItem(c, 'Recentes'))}
            </>
          )}

          {filteredCommands.length > 0 && (() => {
            // Agrupa por `group`
            const groups = { navigation: [], action: [] };
            for (const c of filteredCommands) (groups[c.group] ?? groups.navigation).push(c);
            return (
              <>
                {groups.navigation.length > 0 && (
                  <>
                    <SectionHeader>Navegação</SectionHeader>
                    {groups.navigation.map(c => renderItem(c, 'Navegação'))}
                  </>
                )}
                {groups.action.length > 0 && (
                  <>
                    <SectionHeader>Ações</SectionHeader>
                    {groups.action.map(c => renderItem(c, 'Ações'))}
                  </>
                )}
              </>
            );
          })()}

          {searchResults.length > 0 && (
            <>
              <SectionHeader>Resultados de busca</SectionHeader>
              {searchResults.map(c => renderItem(c, 'Resultados'))}
            </>
          )}

          {flatItems.length === 0 && (
            <p style={{ padding:'24px 16px', color:'var(--text-secondary, #5c6c7a)', fontSize:13, textAlign:'center' }}>
              {query.trim()
                ? <>Nenhum comando ou resultado para "<strong>{query}</strong>"</>
                : 'Sem comandos disponíveis.'}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:12,
          padding:'10px 16px', borderTop:'1px solid var(--border-subtle, #e1e5e8)',
          fontSize:11, color:'var(--text-secondary, #5c6c7a)', background:'var(--surface-muted, #f9fbfa)',
        }}>
          <div style={{ display:'flex', gap:16, alignItems:'center' }}>
            <span><kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> navega</span>
            <span><kbd style={kbdStyle}>↵</kbd> executa</span>
            <span><kbd style={kbdStyle}>ESC</kbd> fecha</span>
          </div>
          <div style={{ fontFamily:'monospace', letterSpacing:'.02em' }}>
            {flatItems.length > 0 && `${cursor + 1} / ${flatItems.length}`}
          </div>
        </div>
      </div>
    </div>
  );
}

const kbdStyle = {
  padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border, #c1ccd6)',
  background: 'var(--surface, white)', fontFamily: 'monospace', fontSize: 10,
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTROLE DE HIGIENIZAÇÃO DAS MÃOS
// ═══════════════════════════════════════════════════════════════════════════

export function HandwashView({ activeTenant, allTenants, onTenantChange, session }) {
  const [records, setRecords] = useState(() => readHandwash(activeTenant.id));
  const [operator, setOperator] = useState(session?.user?.name ?? '');
  const [moment, setMoment]   = useState('');
  const [technique, setTechnique] = useState('');
  const [result, setResult]   = useState('');
  const [obs, setObs]         = useState('');
  const [saved, setSaved]     = useState(false);

  const MOMENTS = ['Início das atividades', 'Após usar o banheiro', 'Troca de atividade', 'Antes de colocar luvas', 'Após manipular alimento cru', 'Após tossir/espirrar', 'Após manipular lixo'];
  const STEPS   = ['Molhar as mãos', 'Aplicar sabonete', 'Esfregar por 20s', 'Enxaguar bem', 'Secar com papel toalha', 'Aplicar álcool 70%'];

  useEffect(() => { setRecords(readHandwash(activeTenant.id)); }, [activeTenant.id]);
  useEffect(() => { writeHandwash(activeTenant.id, records); }, [activeTenant.id, records]);

  const handleSave = () => {
    if (!operator.trim() || !moment || !result) return;
    setRecords(prev => [{ id:uid(), tenantId:activeTenant.id, operator:operator.trim(), moment, technique, result, obs:obs.trim(), user:session?.user?.name, createdAt:new Date().toISOString() }, ...prev].slice(0,300));
    setMoment(''); setTechnique(''); setResult(''); setObs('');
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  };

  const todayRecords = records.filter(r => new Date(r.createdAt).toDateString() === new Date().toDateString());
  const conformeHoje = todayRecords.filter(r => r.result === 'conforme').length;

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Higiene pessoal</span><h1>Higienização das Mãos</h1><p className="muted">Registro de verificação da lavagem correta. RDC 216/2004.</p></div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      <div className="audit-stats" style={{ marginBottom:16 }}>
        <div className="audit-stat"><span>Registros hoje</span><strong>{todayRecords.length}</strong></div>
        <div className="audit-stat ok"><span>Conformes hoje</span><strong>{conformeHoje}</strong></div>
        <div className="audit-stat danger"><span>Não conformes</span><strong>{todayRecords.length - conformeHoje}</strong></div>
        <div className="audit-stat"><span>Total geral</span><strong>{records.length}</strong></div>
      </div>

      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Novo registro</span><h2>Verificação de higienização</h2></div></div>
          <div className="capture-fields">
            <label>Colaborador<input value={operator} onChange={e=>setOperator(e.target.value)} placeholder="Nome do colaborador verificado" /></label>
            <label>Momento da higienização
              <select value={moment} onChange={e=>setMoment(e.target.value)}>
                <option value="">Selecione o momento…</option>
                {MOMENTS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginBottom:8 }}>Etapas verificadas</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                {STEPS.map((step, i) => {
                  const checked = technique.includes(String(i));
                  return (
                    <div key={i} onClick={() => {
                      const steps = technique ? technique.split(',').filter(Boolean) : [];
                      const idx = String(i);
                      setTechnique(steps.includes(idx) ? steps.filter(s=>s!==idx).join(',') : [...steps, idx].join(','));
                    }} style={{ display:'flex', gap:8, alignItems:'center', padding:'8px 10px', borderRadius:8, border:`1.5px solid ${checked?'var(--green-border)':'var(--border)'}`, background:checked?'var(--green-light)':'var(--surface)', cursor:'pointer' }}>
                      <span style={{ width:16, height:16, borderRadius:3, border:`2px solid ${checked?'var(--green)':'var(--border)'}`, background:checked?'var(--green)':'white', display:'grid', placeItems:'center', flexShrink:0 }}>
                        {checked && <span style={{ color:'white', fontSize:10, fontWeight:800 }}>✓</span>}
                      </span>
                      <span style={{ fontSize:12 }}>{step}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginBottom:8 }}>Resultado</div>
              <div style={{ display:'flex', gap:8 }}>
                {[['conforme','✓ Conforme'],['nao_conforme','✗ Não conforme']].map(([val,lbl]) => {
                  const on = result===val;
                  const [bg,color,border] = val==='conforme'?['#dafbe1','#00a35c','#4ac26b']:['#ffebe9','#c0392b','#ff8182'];
                  return <button key={val} onClick={()=>setResult(on?'':val)} style={{ flex:1, padding:'10px', borderRadius:8, border:`1.5px solid ${on?border:'#c1ccd6'}`, background:on?bg:'white', color:on?color:'#5c6c7a', fontWeight:on?700:500, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>{lbl}</button>;
                })}
              </div>
            </div>
            {result === 'nao_conforme' && <label>Observação / ação tomada<textarea value={obs} onChange={e=>setObs(e.target.value)} placeholder="Descreva a orientação dada ao colaborador…" style={{ minHeight:54 }} /></label>}
            <div className="actions-row">
              <button className={`primary-action${result?' attention':''}`} onClick={handleSave} disabled={!operator.trim()||!moment||!result}>Registrar</button>
            </div>
            {saved && <div className="submission ok">✓ Registro salvo.</div>}
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Registros de hoje</h2></div><span className="badge neutral">{todayRecords.length}</span></div>
          <div className="equipment-maintenance-list">
            {todayRecords.length === 0 ? <p className="muted" style={{ padding:'20px' }}>Nenhum registro hoje.</p>
              : todayRecords.map(r => (
                <div key={r.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid ${r.result==='conforme'?'var(--green-border)':'var(--red-border)'}` }}>
                  <div><strong>{r.operator}</strong><span>{r.moment}</span><span style={{ fontSize:11, color:'var(--text-secondary)' }}>{fmtDT(r.createdAt)} · verificado por {r.user}</span></div>
                  <span className={`badge ${r.result==='conforme'?'ok':'danger'}`}>{r.result==='conforme'?'Conforme':'Não conforme'}</span>
                </div>
              ))}
          </div>
        </article>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. EXPORTAÇÃO MENSAL
// ═══════════════════════════════════════════════════════════════════════════

export function MonthlyExportView({ allTenants, records, session }) {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  });
  const [tenantFilter, setTenantFilter] = useState('all');
  const [generating, setGenerating]     = useState(false);

  const months = useMemo(() => {
    const result = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
      result.push({ key, label });
    }
    return result;
  }, []);

  const [year, month] = selectedMonth.split('-').map(Number);
  const monthStart = new Date(year, month-1, 1).getTime();
  const monthEnd   = new Date(year, month, 0, 23, 59, 59).getTime();

  const monthRecords = records.filter(r => {
    const t = new Date(r.createdAt).getTime();
    if (t < monthStart || t > monthEnd) return false;
    if (tenantFilter !== 'all' && r.tenantId !== tenantFilter) return false;
    return true;
  });

  const tenants = tenantFilter === 'all' ? allTenants : allTenants.filter(t => t.id === tenantFilter);

  const generatePDF = () => {
    setGenerating(true);
    const monthLabel = months.find(m => m.key === selectedMonth)?.label ?? selectedMonth;
    const date = new Date().toLocaleString('pt-BR');

    const tempRows = monthRecords.map(r => `<tr>
      <td>${new Date(r.createdAt).toLocaleDateString('pt-BR')}</td>
      <td>${new Date(r.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td>
      <td>${r.tenantName||'—'}</td>
      <td><strong>${r.equipmentInput||r.equipment||'—'}</strong></td>
      <td style="font-family:monospace;font-weight:700">${r.value}°C</td>
      <td>${r.min??'?'}–${r.max??'?'}°C</td>
      <td style="color:${(()=>{const v=Number(r.value),mn=Number(r.min),mx=Number(r.max);return v>=mn&&v<=mx?'#00a35c':v>=mn-3&&v<=mx+3?'#8a4e00':'#c0392b';})()};font-weight:700">${(()=>{const v=Number(r.value),mn=Number(r.min),mx=Number(r.max);return v>=mn&&v<=mx?'Conforme':v>=mn-3&&v<=mx+3?'Desvio':'Fora da faixa';})()}</td>
      <td>${r.user||'—'}</td>
      <td>${r.note||'—'}</td>
    </tr>`).join('');

    // BPF summary
    const bpfRows = tenants.map(tenant => {
      const templates = readFormTemplates(tenant);
      const formRecs  = readFormRecords(tenant.id);
      return templates.map(tpl => {
        const tplRecs = formRecs.filter(r => r.formId === tpl.id && r.periodKey >= selectedMonth.replace('-','') && r.status === 'submitted');
        const validated = tplRecs.filter(r => r.validation).length;
        return `<tr><td>${tenant.name}</td><td>${tpl.title}</td><td>${freqLabel(tpl.frequency)}</td><td>${tplRecs.length}</td><td>${validated}</td></tr>`;
      }).join('');
    }).join('');

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>Relatório Mensal — ${monthLabel}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#001e2b;padding:20px}
    h1{font-size:16px;font-weight:800;margin-bottom:4px}h2{font-size:12px;font-weight:700;margin:16px 0 6px;color:#00684a;padding-bottom:4px;border-bottom:1px solid #c1ccd6}
    .meta{color:#5c6c7a;font-size:9px;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #c1ccd6}
    .kpi-row{display:flex;gap:12px;margin-bottom:16px}.kpi{flex:1;padding:10px;background:#f9fbfa;border:1px solid #c1ccd6;border-radius:6px}
    .kpi span{font-size:8px;color:#5c6c7a;text-transform:uppercase;display:block;margin-bottom:3px}.kpi strong{font-size:18px;font-weight:800;font-family:monospace}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#f9fbfa;padding:5px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #c1ccd6;color:#5c6c7a}
    td{padding:5px 6px;border-bottom:1px solid #eaeef2;font-size:9px}
    .sig{display:flex;gap:40px;margin-top:32px}.sig-line{flex:1;border-top:1px solid #374151;padding-top:4px;font-size:9px;color:#5c6c7a;text-align:center}
    .footer{margin-top:16px;padding-top:8px;border-top:1px solid #c1ccd6;font-size:8px;color:#9198a1;display:flex;justify-content:space-between}
    @page{size:A4;margin:12mm}</style></head><body>
    <h1>Relatório Mensal de Conformidade Sanitária</h1>
    <div class="meta">${tenantFilter === 'all' ? 'Todas as empresas' : allTenants.find(t=>t.id===tenantFilter)?.name} · ${monthLabel} · Gerado por ${session?.user?.name||'—'} em ${date} · RDC 216/2004</div>
    <div class="kpi-row">
      <div class="kpi"><span>Total de registros</span><strong>${monthRecords.length}</strong></div>
      <div class="kpi"><span>Conformes</span><strong style="color:#00a35c">${monthRecords.filter(r=>{const v=Number(r.value),mn=Number(r.min),mx=Number(r.max);return v>=mn&&v<=mx;}).length}</strong></div>
      <div class="kpi"><span>Desvios</span><strong style="color:#8a4e00">${monthRecords.filter(r=>{const v=Number(r.value),mn=Number(r.min),mx=Number(r.max);return v>=mn-3&&v<mn||v>mx&&v<=mx+3;}).length}</strong></div>
      <div class="kpi"><span>Críticos</span><strong style="color:#c0392b">${monthRecords.filter(r=>{const v=Number(r.value),mn=Number(r.min),mx=Number(r.max);return v<mn-3||v>mx+3;}).length}</strong></div>
      <div class="kpi"><span>Conformidade</span><strong>${monthRecords.length>0?Math.round((monthRecords.filter(r=>{const v=Number(r.value),mn=Number(r.min),mx=Number(r.max);return v>=mn&&v<=mx;}).length/monthRecords.length)*100):0}%</strong></div>
    </div>
    <h2>1. Registros de Temperatura</h2>
    ${monthRecords.length===0?'<p style="color:#5c6c7a">Nenhum registro no período.</p>':`<table><thead><tr><th>Data</th><th>Hora</th><th>Empresa</th><th>Equipamento</th><th>Temp.</th><th>Faixa</th><th>Status</th><th>Responsável</th><th>Obs.</th></tr></thead><tbody>${tempRows}</tbody></table>`}
    <h2>2. Planilhas de Controle BPF</h2>
    <table><thead><tr><th>Empresa</th><th>Planilha</th><th>Frequência</th><th>Preenchimentos</th><th>Validados RT</th></tr></thead><tbody>${bpfRows||'<tr><td colspan="5">Sem dados.</td></tr>'}</tbody></table>
    <div class="sig">
      <div class="sig-line">Responsável pela operação · Data: ___/___/______</div>
      <div class="sig-line">Nutricionista RT · CRN: ____________ · Data: ___/___/______</div>
    </div>
    <div class="footer"><span>NutriOPS v${APP_VERSION} · RDC 216/2004</span><span>Gerado em ${date}</span></div>
    </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); setGenerating(false); }, 400);
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Relatório</span><h1>Exportação Mensal</h1><p className="muted">Relatório completo do mês para arquivo e fiscalização.</p></div>
      </div>
      <article className="management-card">
        <div className="capture-fields" style={{ maxWidth:500 }}>
          <div className="grid-2">
            <label>Mês de referência
              <select value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}>
                {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label>Empresa
              <select value={tenantFilter} onChange={e=>setTenantFilter(e.target.value)}>
                <option value="all">Todas as empresas</option>
                {allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>
          <div className="audit-stats" style={{ margin:'4px 0' }}>
            <div className="audit-stat"><span>Registros no período</span><strong>{monthRecords.length}</strong></div>
            <div className="audit-stat ok"><span>Conformes</span><strong>{monthRecords.filter(r=>{const v=Number(r.value),mn=Number(r.min),mx=Number(r.max);return v>=mn&&v<=mx;}).length}</strong></div>
          </div>
          <button className="primary-action attention" onClick={generatePDF} disabled={generating} style={{ fontSize:14, padding:'10px' }}>
            {generating ? '⏳ Gerando PDF…' : '↓ Gerar relatório mensal PDF'}
          </button>
          <p className="muted" style={{ fontSize:11 }}>O relatório inclui: registros de temperatura, planilhas BPF, resumo de conformidade e campos de assinatura para o RT e responsável pela operação.</p>
        </div>
      </article>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. HISTÓRICO DE SESSÕES (Admin)
// ═══════════════════════════════════════════════════════════════════════════

export function SessionHistoryView({ activeTenant, allTenants, onTenantChange }) {
  const sessions = readSessions2(activeTenant.id);

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Segurança</span><h1>Histórico de Acessos</h1><p className="muted">Registro de logins por empresa.</p></div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <article className="management-card">
        <div className="card-head"><div><span className="eyebrow">Acessos</span><h2>{activeTenant.name}</h2></div><span className="badge neutral">{sessions.length}</span></div>
        <div className="equipment-maintenance-list">
          {sessions.length === 0 ? <p className="muted" style={{ padding:'20px' }}>Nenhum acesso registrado ainda.</p>
            : sessions.map(s => (
              <div key={s.id} className="equipment-maintenance-row">
                <div>
                  <strong>{s.user}</strong>
                  <span>{s.role}</span>
                  <span style={{ fontSize:11, color:'var(--text-secondary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:400 }}>{s.device}</span>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:12, fontWeight:600 }}>{fmtDT(s.loginAt)}</div>
                  <span className="badge ok" style={{ fontSize:10 }}>Login</span>
                </div>
              </div>
            ))}
        </div>
      </article>
    </section>
  );
}
