import React, { useState } from 'react';
import { BrandLockup, APP_VERSION } from './brand';

// Login por PIN APOSENTADO em 09/08. As quatro lojas (Swiss, Bäckerei, DBK e
// CASA DOCE) entram com a conta de e-mail; quem registrou é identificado pela
// tela "Quem está registrando?" (src/operator.js), não mais por credencial
// individual. Foi isso que matou a dor de rotatividade: entra/sai gente sem
// criar nem revogar acesso.
//
// Saiu junto: handlePinLogin, a tela "Defina seu PIN" do primeiro acesso e o
// seletor de empresa (o e-mail já diz qual é a loja). O maquinário do PIN
// segue em src/pin.js e os PINs de fábrica em data.js — inertes, mas mantidos
// por ora pra que voltar atrás seja reverter um commit, não restaurar dado.
// Podem sair na próxima limpeza, junto com o device-token.
const SESSION_KEY = 'nutriops.session';
const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

export function LoginScreen({ onLogin }) {
  const [mode, setMode]         = useState('email');   // 'email' | 'reset'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleEmailLogin = async () => {
    setError(''); setLoading(true);
    try {
      const { signIn, scopeSessionToMembership, clearAuthSession } = await import('./auth');
      const s = await signIn({ email, password });
      // Fase 3: se o usuário pertence a empresas (tenant_members), escopa a sessão
      // pra elas e passa a metadata pro app hidratar.
      const { fetchMemberTenants } = await import('./tenant-sync');
      const memberTenants = await fetchMemberTenants();
      // Falha FECHADA (30/07): uma conta que não é admin da plataforma só entra
      // com vínculo estabelecido. Antes, RPC falhando (null) ou conta sem vínculo
      // eram tratados como "admin global" e o app caía na primeira loja-seed
      // (Swiss) — lendo dados reais de OUTRO cliente via device-token.
      if (s.isPlatformAdmin !== true && !s.tenantId) {
        if (memberTenants === null) {
          clearAuthSession();
          throw new Error('Não foi possível carregar suas empresas agora. Tente de novo em alguns segundos.');
        }
        if (memberTenants.length === 0) {
          clearAuthSession();
          throw new Error('Sua conta ainda não está vinculada a nenhuma empresa. Peça ao administrador para vincular seu acesso.');
        }
      }
      const finalSession = scopeSessionToMembership(s, memberTenants ?? []);
      save(SESSION_KEY, finalSession);
      onLogin(finalSession, memberTenants ?? []);
    }
    catch (e) { setError(e.message); }
    setLoading(false);
  };

  const handleReset = async () => {
    if (!email.trim()) { setError('Informe seu e-mail.'); return; }
    setLoading(true); setError('');
    try {
      const { resetPassword } = await import('./auth');
      await resetPassword(email);
      setResetSent(true);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="login-card dash-in">
        <div style={{ marginBottom:28 }}>
          <BrandLockup size="lg" theme="light" idPrefix="login" showSub={false} />
        </div>

        {resetSent ? (
          <div>
            <div style={{ padding:'14px', background:'var(--green-light)', border:'1px solid var(--green-border)', borderRadius:'var(--r)', marginBottom:16 }}>
              <strong style={{ display:'block', color:'var(--green)', marginBottom:4 }}>E-mail enviado</strong>
              <span style={{ fontSize:13, color:'var(--green)' }}>Verifique sua caixa de entrada.</span>
            </div>
            <button className="secondary-action" style={{ width:'100%' }} onClick={() => { setResetSent(false); setMode('email'); }}>← Voltar ao login</button>
          </div>
        ) : mode === 'reset' ? (
          <div>
            <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Recuperar senha</h1>
            <p className="muted" style={{ marginBottom:20 }}>Enviaremos um link para redefinir sua senha.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" autoFocus onKeyDown={e=>{ if(e.key==='Enter') handleReset(); }} /></label>
              {error && <div style={{ padding:'8px 12px', background:'var(--red-light)', border:'1px solid var(--red-border)', borderRadius:'var(--r)', color:'var(--red)', fontSize:13, fontWeight:600 }}>{error}</div>}
              <button className="primary-action" onClick={handleReset} disabled={loading}>{loading ? 'Enviando…' : 'Enviar link'}</button>
              <button className="ghost-action" onClick={() => setMode('email')}>← Voltar</button>
            </div>
          </div>
        ) : mode === 'email' ? (
          <div>
            <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Entrar</h1>
            <p className="muted" style={{ marginBottom:20 }}>Acesse com e-mail e senha.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <label>E-mail<input type="email" value={email} onChange={e=>{ setEmail(e.target.value); setError(''); }} placeholder="seu@email.com" autoFocus /></label>
              <label>Senha<input type="password" value={password} onChange={e=>{ setPassword(e.target.value); setError(''); }} placeholder="••••••••" onKeyDown={e=>{ if(e.key==='Enter') handleEmailLogin(); }} /></label>
              {error && <div style={{ padding:'8px 12px', background:'var(--red-light)', border:'1px solid var(--red-border)', borderRadius:'var(--r)', color:'var(--red)', fontSize:13, fontWeight:600 }}>{error}</div>}
              <button className="primary-action attention" onClick={handleEmailLogin} disabled={loading||!email||!password}>{loading ? 'Entrando…' : 'Entrar'}</button>
              <button className="ghost-action" style={{ fontSize:12 }} onClick={() => setMode('reset')}>Esqueci minha senha</button>
            </div>
          </div>
        ) : null}

        <p style={{ marginTop:10, fontSize:10, color:'var(--text-secondary)', textAlign:'center' }}>
          Conformidade sanitária digital · RDC 216/2004<br/>
          <span style={{ color:'var(--text-placeholder)' }}>v{APP_VERSION}</span>
        </p>
      </div>
    </div>
  );
}
