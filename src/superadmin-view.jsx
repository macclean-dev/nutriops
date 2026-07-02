import React, { useMemo, useState } from 'react';
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
