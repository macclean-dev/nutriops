import React, { useEffect, useMemo, useState } from 'react';
import { readClients, writeClients } from './admin-storage';
import {
  PLANS, planLabel, mergeTenants, setClientPlan, setClientActive,
  appendAudit, readAudit,
} from './superadmin';

// Super Admin — área DENTRO do app (rail), pro admin global gerir todos os
// tenants: mudar plano, suspender/ativar, logar como (impersonate) + audit.
// ⚠️ Client-side (MVP): plano propaga via pushTenant; suspensão é local até o
// épico Auth+RLS. Seeds (swiss/backerei/dbk) são internos — plano read-only.

function fmtDT(iso) {
  try { return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch { return '—'; }
}

const AUDIT_LABELS = {
  plan_change: 'Mudou plano', suspend: 'Suspendeu', activate: 'Ativou',
  impersonate_start: 'Logou como', impersonate_end: 'Saiu do tenant',
  access: 'Acessou Super Admin',
};

// ─── Gate 2FA (TOTP) — protege a entrada no Super Admin ─────────────────────
// Roda uma vez por sessão do navegador (sessionStorage). Se não houver fator
// TOTP ainda, faz o enroll (mostra QR); se houver, pede o código do app.
const MFA_FLAG = 'nutriops.superadmin.mfa';

export function SuperAdminGate({ session, onExit, children }) {
  const already = (() => { try { return sessionStorage.getItem(MFA_FLAG) === '1'; } catch { return false; } })();
  const [phase, setPhase]   = useState(already ? 'ok' : 'loading'); // loading|enroll|challenge|ok|error
  const [factorId, setFactorId] = useState(null);
  const [qr, setQr]         = useState(null);   // svg string ou data-uri
  const [secret, setSecret] = useState(null);
  const [code, setCode]     = useState('');
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);

  const token = session?.accessToken;

  useEffect(() => {
    if (phase !== 'loading') return;
    let cancelled = false;
    (async () => {
      try {
        if (!token) throw new Error('Sessão sem token do Supabase Auth. Entre como administrador com e-mail e senha e tente de novo.');
        const auth = await import('./auth');
        const factors = await auth.mfaListFactors(token);
        const verified = factors.find(f => f.factor_type === 'totp' && f.status === 'verified');
        if (cancelled) return;
        if (verified) { setFactorId(verified.id); setPhase('challenge'); return; }
        // Sem fator verificado → enroll. (Se sobrou um unverified, o Supabase
        // permite reusar; aqui criamos um novo por simplicidade.)
        const enrolled = await auth.mfaEnroll(token, 'Super Admin');
        if (cancelled) return;
        setFactorId(enrolled.id);
        setQr(enrolled?.totp?.qr_code ?? null);
        setSecret(enrolled?.totp?.secret ?? null);
        setPhase('enroll');
      } catch (e) {
        if (!cancelled) { setError(e?.message ?? 'Erro ao iniciar 2FA'); setPhase('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [phase, token]);

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const auth = await import('./auth');
      const ch = await auth.mfaChallenge(token, factorId);
      await auth.mfaVerify(token, factorId, ch.id, code.trim());
      try { sessionStorage.setItem(MFA_FLAG, '1'); } catch {}
      setPhase('ok');
    } catch (e) {
      setError(e?.message ?? 'Código inválido');
    }
    setBusy(false);
  };

  if (phase === 'ok') return children;

  return (
    <section className="management-page">
      <div style={{ maxWidth:420, margin:'40px auto', background:'var(--surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--r-xl)', padding:'28px 26px', boxShadow:'var(--shadow-lg)' }}>
        <span className="eyebrow" style={{ color:'var(--primary)' }}>Verificação em 2 fatores</span>
        <h1 style={{ fontSize:22, fontWeight:700, letterSpacing:'-.03em', margin:'4px 0 6px', fontFamily:'var(--serif)' }}>Acesso Super Admin</h1>

        {phase === 'loading' && <p className="muted">Verificando 2FA…</p>}

        {phase === 'error' && (
          <>
            <div className="submission danger" style={{ marginTop:12 }}>{error}</div>
            <div style={{ display:'flex', gap:8, marginTop:16 }}>
              <button className="secondary-action" onClick={() => { setError(''); setPhase('loading'); }}>Tentar de novo</button>
              {onExit && <button className="ghost-action" onClick={onExit}>Sair</button>}
            </div>
          </>
        )}

        {phase === 'enroll' && (
          <>
            <p className="muted" style={{ marginBottom:14 }}>Configure o 2FA uma vez: escaneie o QR no seu app autenticador (Google/Microsoft Authenticator, 1Password…) e digite o código gerado.</p>
            <div style={{ display:'grid', placeItems:'center', background:'#fff', borderRadius:'var(--r)', padding:12, marginBottom:12 }}>
              {qr
                ? (String(qr).startsWith('data:')
                    ? <img src={qr} alt="QR 2FA" style={{ width:180, height:180 }} />
                    : <span style={{ width:180, height:180, display:'block' }} dangerouslySetInnerHTML={{ __html: qr }} />)
                : <span className="muted">QR indisponível</span>}
            </div>
            {secret && <p style={{ fontSize:11, color:'var(--text-secondary)', textAlign:'center', marginBottom:12 }}>Ou digite a chave manual: <strong style={{ fontFamily:'var(--mono)' }}>{secret}</strong></p>}
          </>
        )}

        {phase === 'challenge' && (
          <p className="muted" style={{ marginBottom:14 }}>Digite o código de 6 dígitos do seu app autenticador.</p>
        )}

        {(phase === 'enroll' || phase === 'challenge') && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <input value={code} onChange={e => { setCode(e.target.value.replace(/\D/g,'').slice(0,6)); setError(''); }}
              inputMode="numeric" maxLength={6} placeholder="000000" autoFocus
              onKeyDown={e => { if (e.key==='Enter' && code.length===6) submit(); }}
              style={{ letterSpacing:'0.4em', fontSize:24, textAlign:'center', fontFamily:'var(--mono)' }} />
            {error && <div className="submission danger">{error}</div>}
            <button className="primary-action" style={{ width:'100%' }} disabled={busy || code.length !== 6} onClick={submit}>
              {busy ? 'Verificando…' : 'Verificar e entrar'}
            </button>
            {onExit && <button className="ghost-action" style={{ width:'100%' }} onClick={onExit}>Cancelar</button>}
          </div>
        )}
      </div>
    </section>
  );
}

export function SuperAdminView({ session, seedTenants = [], onImpersonate, onExit }) {
  const [clients, setClients] = useState(() => readClients());
  const [audit, setAudit]     = useState(() => readAudit());
  const [msg, setMsg]         = useState(null);

  const actor = session?.user?.name ?? session?.user?.email ?? 'admin';
  const tenants = useMemo(() => mergeTenants(clients, seedTenants), [clients, seedTenants]);

  const kpis = useMemo(() => ({
    total: tenants.length,
    ativos: tenants.filter(t => t.active).length,
    suspensos: tenants.filter(t => !t.active).length,
    trials: tenants.filter(t => t.plan === 'trial').length,
  }), [tenants]);

  const logAction = (entry) => {
    const next = appendAudit({ ...entry, actor });
    setAudit(next);
  };

  const persistClients = (next) => {
    setClients(next);
    writeClients(next);
  };

  const bestEffortPush = async (tenantId) => {
    // Propaga plano pro Supabase (metadata). Best-effort — não bloqueia a UI.
    try {
      const c = readClients().find(x => x.id === tenantId);
      if (!c) return;
      const { pushTenant } = await import('./tenant-sync');
      await pushTenant(c);
    } catch {}
  };

  const changePlan = (tenant, planId) => {
    if (tenant.source !== 'client') return; // seeds: plano read-only
    if (planId === tenant.plan) return;
    persistClients(setClientPlan(clients, tenant.id, planId));
    logAction({ type:'plan_change', tenantId: tenant.id, tenantName: tenant.name, detail: `${planLabel(tenant.plan)} → ${planLabel(planId)}` });
    bestEffortPush(tenant.id);
    setMsg({ tone:'ok', text:`Plano de ${tenant.name} → ${planLabel(planId)}.` });
  };

  const toggleActive = (tenant) => {
    if (tenant.source !== 'client') { setMsg({ tone:'warn', text:'Tenant interno (seed) — suspensão só vale pra clientes do /admin.' }); return; }
    const next = setClientActive(clients, tenant.id, !tenant.active);
    persistClients(next);
    logAction({ type: tenant.active ? 'suspend' : 'activate', tenantId: tenant.id, tenantName: tenant.name });
    setMsg({ tone: tenant.active?'warn':'ok', text:`${tenant.name} ${tenant.active?'suspenso':'reativado'}.` });
  };

  const planTone = (t) => t.plan === 'trial' ? 'warn' : t.active ? 'ok' : 'neutral';

  return (
    <section className="management-page">
      <div style={{ padding:'12px 16px', marginBottom:16, borderRadius:'var(--r-lg)', background:'var(--rail-bg)', color:'var(--rail-text)', display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:16 }}>⚠️</span>
        <strong style={{ fontSize:13 }}>Modo Super Admin</strong>
        <span style={{ fontSize:12, opacity:.8 }}>· você está acessando dados de toda a plataforma</span>
      </div>

      <div className="page-header">
        <div>
          <span className="eyebrow">Plataforma</span>
          <h1>Super Admin</h1>
          <p className="muted">Visão consolidada dos tenants — planos, suspensão e "logar como".</p>
        </div>
        {onExit && <div className="page-actions"><button className="ghost-action" onClick={onExit}>← Sair</button></div>}
      </div>

      {/* KPIs */}
      <div className="audit-stats" style={{ marginBottom:16 }}>
        <div className="audit-stat"><span>Tenants totais</span><strong>{kpis.total}</strong></div>
        <div className="audit-stat"><span>Ativos</span><strong>{kpis.ativos}</strong></div>
        <div className={`audit-stat ${kpis.suspensos>0?'warn':''}`}><span>Suspensos</span><strong>{kpis.suspensos}</strong></div>
        <div className="audit-stat"><span>Em trial</span><strong>{kpis.trials}</strong></div>
      </div>

      {msg && <div className={`submission ${msg.tone}`} style={{ marginBottom:12 }}>{msg.text}</div>}

      {/* Tenants */}
      <article className="management-card" style={{ marginBottom:16 }}>
        <div className="card-head"><div><span className="eyebrow">Tenants</span><h2>Empresas cadastradas</h2></div><span className="badge neutral">{tenants.length}</span></div>
        <div className="equipment-maintenance-list">
          {tenants.length === 0
            ? <p className="muted" style={{ padding:'20px' }}>Nenhum tenant.</p>
            : tenants.map(t => (
              <div key={t.id} className="equipment-maintenance-row" style={{ alignItems:'center' }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <strong>{t.name}</strong>
                    <span className={`badge ${t.active?'ok':'neutral'}`} style={{ fontSize:10 }}>{t.active?'Ativo':'Suspenso'}</span>
                    {t.source==='seed' && <span className="badge neutral" style={{ fontSize:10 }} title="Tenant interno (seed) — plano read-only">interno</span>}
                  </div>
                  <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{t.segment || '—'} · {t.id}</span>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
                  {t.source==='client' ? (
                    <select value={t.plan} onChange={e => changePlan(t, e.target.value)} style={{ width:'auto', fontSize:12, padding:'4px 8px' }}>
                      {PLANS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  ) : (
                    <span className={`badge ${planTone(t)}`} style={{ fontSize:11 }}>{planLabel(t.plan)}</span>
                  )}
                  <button className="ghost-action" style={{ fontSize:11 }} onClick={() => toggleActive(t)}>
                    {t.active ? 'Suspender' : 'Ativar'}
                  </button>
                  <button className="secondary-action" style={{ fontSize:11 }} onClick={() => onImpersonate?.(t)}>
                    Logar como
                  </button>
                </div>
              </div>
            ))}
        </div>
      </article>

      {/* Audit log */}
      <article className="management-card">
        <div className="card-head"><div><span className="eyebrow">Audit log</span><h2>Últimas ações</h2></div><span className="badge neutral">{audit.length}</span></div>
        <div className="equipment-maintenance-list">
          {audit.length === 0
            ? <p className="muted" style={{ padding:'20px' }}>Nenhuma ação registrada ainda.</p>
            : audit.slice(0, 30).map((a, i) => (
              <div key={a.at + i} className="equipment-maintenance-row">
                <div>
                  <strong style={{ color: a.type==='suspend'?'var(--red)':a.type==='plan_change'?'var(--primary)':'var(--text)' }}>
                    {AUDIT_LABELS[a.type] ?? a.type}
                  </strong>
                  <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
                    {a.tenantName ?? a.tenantId ?? ''}{a.detail ? ` · ${a.detail}` : ''}
                  </span>
                  <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{a.actor}</span>
                </div>
                <span style={{ fontSize:11, color:'var(--text-secondary)', fontFamily:'var(--mono)' }}>{fmtDT(a.at)}</span>
              </div>
            ))}
        </div>
      </article>
    </section>
  );
}
