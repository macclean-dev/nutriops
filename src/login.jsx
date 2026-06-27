import React, { useState, useRef } from 'react';
import { globalAdmin } from './data';
import { isSupabaseEnabled } from './repository';
import { BrandLockup, APP_VERSION } from './brand';
import { getEffectivePin, hasPinOverride, writePinOverride, isWeakPin } from './pin';
import { findUserByName } from './user-match';

const SESSION_KEY = 'nutriops.session';
const usersKey = (id) => `nutriops.users.${id}`;
const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };
const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const readUsers = (t) => load(usersKey(t.id), t.usersList ?? []);

export function LoginScreen({ onLogin, activeTenants }) {
  const useSupabase = isSupabaseEnabled();
  const [mode, setMode]         = useState('pin');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [tenantId, setTenantId] = useState(activeTenants[0]?.id ?? '');
  const [nameInput, setNameInput] = useState('');
  const [pin, setPin]           = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [pinResetCtx, setPinResetCtx] = useState(null);
  const [newPin, setNewPin]       = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const nameRef = useRef(null);
  const pinRef  = useRef(null);
  const selectedTenant = activeTenants.find(t => t.id === tenantId) ?? activeTenants[0];

  const handleEmailLogin = async () => {
    setError(''); setLoading(true);
    try {
      const { signIn } = await import('./auth');
      const s = await signIn({ email, password });
      save(SESSION_KEY, s); onLogin(s);
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

  const handlePinLogin = () => {
    setError('');
    const isAdmin = tenantId === '__admin__';

    if (isAdmin) {
      if (pin !== (globalAdmin.pin ?? '9999')) { setError('PIN incorreto.'); return; }
      const s = { tenantId: activeTenants[0]?.id, user: { ...globalAdmin } };
      save(SESSION_KEY, s); onLogin(s); return;
    }

    const raw = nameInput.trim().toLowerCase();
    if (!raw) { setError('Informe seu usuário.'); nameRef.current?.focus(); return; }

    let username = raw;
    let tenantHint = null;

    if (raw.includes('@')) {
      const parts = raw.split('@');
      username    = parts[0].trim();
      tenantHint  = parts[1].trim();
    }

    const TENANT_ALIASES = {
      'swiss':    'swiss',
      'backerei': 'backerei',
      'bakerei':  'backerei',
      'bakery':   'backerei',
      'dbk':      'dbk-producao',
      'dbkprod':  'dbk-producao',
      'producao': 'dbk-producao',
    };

    // Remove acento/trema do hint antes de resolver: "bäckerei" -> "backerei",
    // senão @Bäckerei (como o cliente digita o nome da marca) não encontra o
    // tenant cujo id é "backerei".
    const normHint = tenantHint
      ? tenantHint.normalize('NFD').replace(/[̀-ͯ]/g, '')
      : null;
    const resolvedHint = normHint ? (TENANT_ALIASES[normHint] ?? normHint) : null;
    const tenantsToSearch = resolvedHint
      ? activeTenants.filter(t => t.id === resolvedHint || t.id.includes(resolvedHint))
      : activeTenants.filter(t => t.id === tenantId);

    if (tenantHint && tenantsToSearch.length === 0) {
      setError(`Empresa "@${tenantHint}" não encontrada.`);
      return;
    }

    let foundUser = null;
    let foundTenantId = null;

    for (const tenant of tenantsToSearch) {
      const users = readUsers(tenant).filter(u => u.status !== 'Inativo');
      const user = findUserByName(users, username);
      if (user) { foundUser = user; foundTenantId = tenant.id; break; }
    }

    if (!foundUser) {
      setError(`Usuário "${raw}" não encontrado.`);
      nameRef.current?.select();
      return;
    }

    const effectivePin = getEffectivePin(foundTenantId, foundUser);
    if (pin !== effectivePin) {
      setError('PIN incorreto.');
      pinRef.current?.select();
      return;
    }

    const s = {
      tenantId: foundTenantId,
      user: {
        id: `${foundTenantId}-${foundUser.name}`,
        name: foundUser.name, role: foundUser.role,
        location: foundUser.location ?? '', storeId: foundUser.storeId ?? null,
      },
    };

    if (!hasPinOverride(foundTenantId, foundUser.name)) {
      setPinResetCtx({ session: s, foundTenantId, foundUser });
      setError('');
      setNewPin(''); setConfirmPin('');
      return;
    }

    save(SESSION_KEY, s); onLogin(s);
  };

  const handleSetPin = () => {
    setError('');
    if (!/^\d{4,6}$/.test(newPin)) { setError('PIN deve ter 4 a 6 dígitos.'); return; }
    if (newPin === confirmPin) {
      if (isWeakPin(newPin)) {
        setError('PIN muito fácil. Escolha outra combinação.'); return;
      }
      writePinOverride(pinResetCtx.foundTenantId, pinResetCtx.foundUser.name, newPin);
      save(SESSION_KEY, pinResetCtx.session);
      onLogin(pinResetCtx.session);
    } else {
      setError('PINs não conferem.');
    }
  };

  const isAdmin = tenantId === '__admin__';

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ marginBottom:28 }}>
          <BrandLockup size="lg" theme="light" idPrefix="login" showSub={false} />
        </div>

        {pinResetCtx ? (
          <div>
            <span className="eyebrow" style={{ color:'var(--primary)' }}>Primeiro acesso</span>
            <h1 style={{ fontSize:22, fontWeight:700, letterSpacing:'-.04em', marginBottom:6, fontFamily:'var(--serif)' }}>Defina seu PIN</h1>
            <p className="muted" style={{ marginBottom:20 }}>
              Olá, <strong style={{ color:'var(--text)' }}>{pinResetCtx.foundUser.name}</strong>. Crie um PIN pessoal de 4 a 6 dígitos. Esse PIN substitui o de fábrica e fica salvo neste dispositivo.
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <label>
                Novo PIN
                <input type="password" inputMode="numeric" maxLength={6} autoFocus
                  value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g,''))}
                  placeholder="••••" />
              </label>
              <label>
                Confirmar PIN
                <input type="password" inputMode="numeric" maxLength={6}
                  value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g,''))}
                  onKeyDown={e => { if (e.key === 'Enter') handleSetPin(); }}
                  placeholder="••••" />
              </label>
              {error && <div style={{ padding:'8px 12px', background:'var(--red-light)', border:'1px solid var(--red-border)', borderRadius:'var(--r)', color:'var(--red)', fontSize:13, fontWeight:600 }}>{error}</div>}
              <button className="primary-action" style={{ width:'100%' }} onClick={handleSetPin}>Salvar PIN e entrar</button>
              <button className="ghost-action" style={{ width:'100%' }} onClick={() => { setPinResetCtx(null); setError(''); }}>Cancelar</button>
            </div>
          </div>
        ) : resetSent ? (
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
            <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid var(--border-subtle)', textAlign:'center', display:'flex', flexDirection:'column', gap:8 }}>
              <button onClick={() => setMode('pin')} style={{ background:'none', border:'none', fontSize:11, color:'var(--text-secondary)', cursor:'pointer', textDecoration:'underline' }}>Entrar com nome + PIN</button>
              {/* TEMPORÁRIO (Parte 4 remove): acesso de emergência via PIN admin
                  enquanto validamos o login por e-mail. Some quando o 9999 sair. */}
              <button onClick={() => { setMode('pin'); setTenantId('__admin__'); setPin(''); setError(''); }}
                style={{ background:'none', border:'none', fontSize:10, color:'var(--text-placeholder)', cursor:'pointer', textDecoration:'underline' }}>
                Acesso de emergência (PIN admin)
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Entrar</h1>
            <p className="muted" style={{ marginBottom:20 }}>
              {isAdmin ? 'Administrador global.' : 'Digite seu usuário e PIN.'}
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {!isAdmin && (
                <label>Usuário
                  <input ref={nameRef} value={nameInput}
                    onChange={e=>{ setNameInput(e.target.value); setError(''); }}
                    placeholder="ex: fran@backerei"
                    onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();pinRef.current?.focus();} }}
                    autoComplete="username" autoCapitalize="none" autoCorrect="off"
                    style={{ fontFamily:'var(--mono)', fontSize:15 }} />
                  <span style={{ fontSize:11, color:'var(--text-secondary)', marginTop:4, display:'block' }}>
                    formato: <strong>nome@empresa</strong> — ex: sila@backerei, mateus@dbk, anapaula@swiss
                  </span>
                </label>
              )}
              {isAdmin && (
                <div style={{ padding:'12px 14px', background:'var(--blue-light)', border:'1px solid var(--blue-border)', borderRadius:'var(--r)', fontSize:13 }}>
                  <strong>Administrador global</strong> — acesso a todas as empresas
                </div>
              )}
              <label>PIN
                <input ref={pinRef} type="password" inputMode="numeric" maxLength={6}
                  value={pin} onChange={e=>{ setPin(e.target.value.replace(/\D/g,'')); setError(''); }}
                  placeholder="••••" autoComplete="current-password"
                  onKeyDown={e=>{ if(e.key==='Enter') handlePinLogin(); }}
                  style={{ letterSpacing:'0.3em', fontSize:22, textAlign:'center', fontFamily:'var(--mono)' }} />
              </label>
              {error && <div style={{ padding:'8px 12px', background:'var(--red-light)', border:'1px solid var(--red-border)', borderRadius:'var(--r)', color:'var(--red)', fontSize:13, fontWeight:600 }}>{error}</div>}
              <button className="primary-action" style={{ marginTop:4 }} onClick={handlePinLogin}>Entrar</button>
            </div>
            <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid var(--border-subtle)', display:'flex', flexDirection:'column', gap:10 }}>
              {isAdmin ? (
                <button onClick={() => { setTenantId(activeTenants[0]?.id ?? ''); setPin(''); setError(''); }}
                  style={{ background:'none', border:'none', fontSize:11, color:'var(--text-secondary)', cursor:'pointer', textDecoration:'underline', textAlign:'center' }}>
                  ← Voltar ao login da unidade
                </button>
              ) : (
                <button className="ghost-action" style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}
                  onClick={() => { setMode('email'); setPin(''); setError(''); setNameInput(''); }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
                    <path d="M12 2 3 6v6c0 5 4 8 9 10 5-2 9-5 9-10V6z" />
                  </svg>
                  Entrar como administrador
                </button>
              )}
            </div>
          </div>
        )}

        <p style={{ marginTop:10, fontSize:10, color:'var(--text-secondary)', textAlign:'center' }}>
          Conformidade sanitária digital · RDC 216/2004<br/>
          <span style={{ color:'var(--text-placeholder)' }}>v{APP_VERSION}</span>
        </p>
      </div>
    </div>
  );
}
