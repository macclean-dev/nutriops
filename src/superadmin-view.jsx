import React, { useEffect, useMemo, useState } from 'react';
import { readClients, writeClients } from './admin-storage';
import {
  PLANS, planLabel, mergeTenants, setClientPlan, setClientActive,
  appendAudit, readAudit,
} from './superadmin';

// Super Admin — área DENTRO do app (rail), pro admin global gerir todos os
// tenants: mudar plano, suspender/ativar, logar como (impersonate) + audit.
//
// ⚠️⚠️ SEGURANÇA — LEIA: este gate é DEFESA EM PROFUNDIDADE, NÃO uma barreira.
// isGlobalAdmin + a flag de 2FA são client-side e FORJÁVEIS (dá pra setar
// nutriops.session/sessionStorage no devtools e entrar). A proteção REAL —
// autorização server-side por role/AAL2 + RLS — é o épico docs/AUTH_RLS_PLAN.md.
// Enquanto RLS estiver OFF, a anon key lê qualquer tenant, então NÃO trate o
// Super Admin como fronteira de segurança. Client-side (MVP): plano propaga via
// pushTenant; suspensão é local. Seeds (swiss/backerei/dbk) = plano read-only.

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

// Mensagem amigável quando o projeto Supabase está com MFA/TOTP desabilitado
// (padrão em projeto novo) — evita mostrar erro cru do GoTrue.
function friendlyMfaError(msg) {
  if (/mfa|not enabled|disabled|unsupported|factor_type|otp/i.test(String(msg ?? ''))) {
    return 'MFA (TOTP) parece desabilitado no projeto Supabase. Habilite em Authentication → Providers → MFA e recarregue.';
  }
  return msg || 'Erro no 2FA';
}

// Monta o otpauth:// a partir do secret com o issuer "NutriOPS.uniwares.net" —
// assim a conta aparece com nome CLARO no autenticador (a uri crua do GoTrue usa
// o host do Supabase como identificação, some no meio de outras entradas). Usa os
// defaults do GoTrue (SHA1/6/30), os mesmos da chave manual que já funcionou.
const OTP_ISSUER = 'NutriOPS.uniwares.net';
function buildOtpauthUri(secret, account) {
  const acct = account || 'admin';
  const p = new URLSearchParams({ secret, issuer: OTP_ISSUER, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(OTP_ISSUER)}:${encodeURIComponent(acct)}?${p.toString()}`;
}

export function SuperAdminGate({ session, onExit, children }) {
  // Flag por-usuário (não um '1' global): outro admin/relogin re-dispara o 2FA.
  const flagVal = session?.user?.id ?? session?.user?.email ?? '1';
  const already = (() => { try { return sessionStorage.getItem(MFA_FLAG) === flagVal; } catch { return false; } })();
  const [phase, setPhase]   = useState(already ? 'ok' : 'loading'); // loading|enroll|challenge|ok|error
  const [factorId, setFactorId] = useState(null);
  const [qr, setQr]         = useState(null);   // svg string ou data-uri (do Supabase)
  const [uri, setUri]       = useState(null);   // otpauth:// — fonte de verdade p/ gerar QR nítido
  const [qrPng, setQrPng]   = useState(null);   // QR gerado no cliente a partir da uri (data-URL PNG)
  const [secret, setSecret] = useState(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode]     = useState('');
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [mfaOff, setMfaOff] = useState(false); // MFA desabilitado no projeto → não faz loop no "tentar de novo"

  // Gera o QR nós mesmos a partir do otpauth URI: bitmap nítido, preto/branco
  // puro e quiet-zone garantida. O SVG cru do Supabase (via REST) vem a ~99px
  // sem viewBox e borra no upscale, o que o Google Authenticator não lê. O
  // secret/uri nunca saem do browser (geração 100% local).
  useEffect(() => {
    // Preferimos NOSSA uri (issuer "NutriOPS.uniwares.net", nome claro no app);
    // só caímos na uri crua do GoTrue se, por algum motivo, não vier o secret.
    const otpauth = (secret ? buildOtpauthUri(secret, session?.user?.email) : null) || uri;
    if (!otpauth) return;
    let cancelled = false;
    (async () => {
      try {
        const QR = (await import('qrcode')).default;
        const url = await QR.toDataURL(otpauth, { width: 440, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
        if (!cancelled) setQrPng(url);
      } catch { /* cai no fallback do SVG cru / chave manual */ }
    })();
    return () => { cancelled = true; };
  }, [uri, secret, session]);

  const groupSecret = (s) => String(s).replace(/(.{4})/g, '$1 ').trim();
  const crispSvg    = (s) => String(s).replace('<svg', '<svg shape-rendering="crispEdges"');
  const copyKey = async () => {
    try { await navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  // Token sempre fresco (refresh se expirou) — evita lockout por 401.
  const freshToken = async () => {
    const auth = await import('./auth');
    const t = await auth.getValidAccessToken();
    if (!t) throw new Error('Sessão sem token do Supabase Auth. Entre como administrador com e-mail e senha e tente de novo.');
    return t;
  };

  useEffect(() => {
    if (phase !== 'loading') return;
    let cancelled = false;
    (async () => {
      try {
        const auth = await import('./auth');
        const token = await freshToken();
        const factors = await auth.mfaListFactors(token);
        const verified = factors.find(f => f.factor_type === 'totp' && f.status === 'verified');
        if (cancelled) return;
        if (verified) { setFactorId(verified.id); setPhase('challenge'); return; }
        // Sem fator verificado → limpa qualquer 'unverified' órfão (senão o
        // friendly_name 'Super Admin' colide no re-enroll) e cria um novo.
        const stale = factors.find(f => f.factor_type === 'totp' && f.status !== 'verified');
        if (stale) await auth.mfaUnenroll(token, stale.id);
        const enrolled = await auth.mfaEnroll(token, 'Super Admin');
        if (cancelled) return;
        setFactorId(enrolled.id);
        setQr(enrolled?.totp?.qr_code ?? null);
        setUri(enrolled?.totp?.uri ?? null);
        setSecret(enrolled?.totp?.secret ?? null);
        setPhase('enroll');
      } catch (e) {
        if (cancelled) return;
        const raw = e?.message ?? 'Erro ao iniciar 2FA';
        const off = /mfa|not enabled|disabled|unsupported|factor_type|otp/i.test(raw);
        setMfaOff(off);
        setError(friendlyMfaError(raw));
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [phase, flagVal]);

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const auth = await import('./auth');
      const token = await freshToken();
      const ch = await auth.mfaChallenge(token, factorId);
      await auth.mfaVerify(token, factorId, ch.id, code.trim());
      try { sessionStorage.setItem(MFA_FLAG, flagVal); } catch {}
      setPhase('ok');
    } catch (e) {
      const raw = String(e?.message ?? '');
      const invalid = /invalid.*totp|totp.*invalid|c[óo]digo inv[áa]lido|invalid code/i.test(raw);
      setError(invalid
        ? 'Código inválido. Verifique: (1) use a conta que você ACABOU de adicionar — apague entradas antigas de "NutriOPS"/"Super Admin" no app; (2) sincronize o relógio (Google Authenticator → ⋮ → Configurações → Correção de horário → Sincronizar agora); (3) digite um código novo antes de expirar.'
        : (raw || 'Código inválido'));
      setCode('');
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
              {/* Se o MFA está desabilitado no projeto, "tentar de novo" só
                  repetiria o mesmo erro — some o botão nesse caso. */}
              {!mfaOff && <button className="secondary-action" onClick={() => { setError(''); setPhase('loading'); }}>Tentar de novo</button>}
              {onExit && <button className="ghost-action" onClick={onExit}>Sair</button>}
            </div>
          </>
        )}

        {phase === 'enroll' && (
          <>
            <p className="muted" style={{ marginBottom:14 }}>Configure o 2FA uma vez: escaneie o QR no seu app autenticador (Google/Microsoft Authenticator, 1Password…) e digite o código gerado.</p>
            {/* QR gerado no cliente a partir do otpauth URI (nítido, quiet-zone,
                preto/branco puro) — resolve o "Google Authenticator não lê".
                Fallbacks em cascata: PNG gerado → SVG cru do Supabase (com
                crispEdges) → só a chave manual. Fundo branco PURO (#fff), não a
                var de canvas, pra não contaminar a quiet-zone. */}
            <style>{`.sa-qr img{width:220px;height:220px;display:block}.sa-qr svg{width:220px;height:220px;display:block;shape-rendering:crispEdges}`}</style>
            <div className="sa-qr" style={{ background:'#ffffff', borderRadius:'var(--r)', padding:16, marginBottom:12, display:'flex', justifyContent:'center' }}>
              {qrPng
                ? <img src={qrPng} alt="QR 2FA" width={220} height={220} />
                : qr
                  ? (String(qr).startsWith('data:')
                      ? <img src={qr} alt="QR 2FA" />
                      : <span dangerouslySetInnerHTML={{ __html: crispSvg(qr) }} />)
                  : <span className="muted">QR indisponível</span>}
            </div>
            {secret && (
              <div style={{ textAlign:'center', marginBottom:12 }}>
                <p style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:6 }}>Se a câmera não ler, adicione uma conta manual (nome: <strong>NutriOPS</strong> · tipo TOTP/baseada em tempo) e cole a chave:</p>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, flexWrap:'wrap' }}>
                  <strong style={{ fontFamily:'var(--mono)', fontSize:13, letterSpacing:'.06em' }}>{groupSecret(secret)}</strong>
                  <button className="ghost-action" style={{ fontSize:11, padding:'3px 10px' }} onClick={copyKey}>{copied ? 'Copiado ✓' : 'Copiar chave'}</button>
                </div>
              </div>
            )}
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
  const [search, setSearch]   = useState('');

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
    setMsg({ tone: tenant.active?'warn':'ok', text:`${tenant.name} ${tenant.active?'suspenso':'reativado'} (aplica via ?token= neste projeto; enforcement server-side entra com o Auth+RLS).` });
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

      {/* Tenants — tabela (estilo Nexum) */}
      <article className="management-card" style={{ marginBottom:16 }}>
        <div className="card-head">
          <div><span className="eyebrow">Tenants</span><h2>{tenants.length} empresas cadastradas</h2></div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome…"
            style={{ width:220, maxWidth:'40vw', fontSize:13, padding:'6px 10px' }} />
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ textAlign:'left', color:'var(--text-secondary)', fontSize:11, textTransform:'uppercase', letterSpacing:'.06em' }}>
                <th style={{ padding:'8px 12px' }}>Tenant</th>
                <th style={{ padding:'8px 12px' }}>Plano</th>
                <th style={{ padding:'8px 12px' }}>Status</th>
                <th style={{ padding:'8px 12px' }}>Criado</th>
                <th style={{ padding:'8px 12px', textAlign:'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tenants.filter(t => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase())).map(t => (
                <tr key={t.id} style={{ borderTop:'1px solid var(--border-subtle)', background: t.active ? 'transparent' : 'var(--red-light)' }}>
                  <td style={{ padding:'10px 12px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <strong>{t.name}</strong>
                      {t.source==='seed' && <span className="badge neutral" style={{ fontSize:9 }} title="Tenant interno (seed) — plano read-only">interno</span>}
                    </div>
                    <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{t.segment || '—'} · {t.id}</span>
                  </td>
                  <td style={{ padding:'10px 12px' }}>
                    {t.source==='client'
                      ? <select value={t.plan} onChange={e => changePlan(t, e.target.value)} style={{ width:'auto', fontSize:12, padding:'3px 6px' }}>
                          {PLANS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                      : <span className={`badge ${planTone(t)}`} style={{ fontSize:11 }}>{planLabel(t.plan)}</span>}
                  </td>
                  <td style={{ padding:'10px 12px' }}>
                    <span className={`badge ${t.active?'ok':'neutral'}`} style={{ fontSize:10 }}>{t.active?'Ativo':'Suspenso'}</span>
                  </td>
                  <td style={{ padding:'10px 12px', color:'var(--text-secondary)', fontFamily:'var(--mono)', fontSize:12 }}>
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td style={{ padding:'10px 12px' }}>
                    <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                      <button className="secondary-action" style={{ fontSize:11, padding:'4px 10px' }} onClick={() => onImpersonate?.(t)}>Entrar como</button>
                      <button className="ghost-action" style={{ fontSize:11, padding:'4px 10px' }} onClick={() => toggleActive(t)}>{t.active ? 'Suspender' : 'Reativar'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
