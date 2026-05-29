import React, { useEffect, useMemo, useState } from 'react';
import { getAllUsageStats } from './repository';
import { BrandLockup, APP_VERSION } from './brand';
import { readClients, writeClients, readAdminAuth, writeAdminAuth, clearAdminAuth } from './admin-storage';
import { sendWelcomeEmail, sendAccessGrantedEmail } from './email';
import { tenantsBase } from './tenants-public';
import { resolveLimits as resolveLimitsCat, resolveTone as resolveToneCat } from './limits';
import { hashPin, generateSetupPin } from './crypto';
import { pushTenant, isTenantSyncEnabled } from './tenant-sync';
import { SEGMENTS, DEFAULT_EQUIPMENT, DEFAULT_MODULES, buildEquipmentCatalog, segmentLabel, segmentLocalityType } from './segments';

// Re-export storage helpers pra preservar a API que pages.jsx/trial.jsx
// consumiam (com import from './admin'). Os imports leves agora podem ser
// feitos direto de ./admin-storage pra evitar puxar o painel inteiro.
export { readClients, writeClients, readAdminAuth, writeAdminAuth, clearAdminAuth };

function uid() { return crypto.randomUUID().slice(0, 12); }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return '—'; } }
function fmtDT(iso)   { try { return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch { return '—'; } }
function daysLeft(iso) { if (!iso) return null; return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000); }

// ─── Plans ─────────────────────────────────────────────────────────────────

const PLANS = [
  { id:'trial',      label:'Trial',      color:'#8a4e00', days:14,  price:0,    maxUsers:5,  description:'14 dias gratuitos' },
  { id:'loja',       label:'Loja',       color:'#cc785c', days:null, price:149,  maxUsers:15, description:'1 unidade — R$149/mês' },
  { id:'rede',       label:'Rede',       color:'#2d6e4a', days:null, price:349,  maxUsers:999,description:'Até 3 unidades — R$349/mês' },
  { id:'enterprise', label:'Enterprise', color:'#7c3aed', days:null, price:null, maxUsers:999,description:'Sob consulta' },
];

// ─── Status helpers ────────────────────────────────────────────────────────

function clientStatus(client) {
  if (!client.active) return { label:'Inativo',   tone:'neutral' };
  if (client.plan === 'trial') {
    const d = daysLeft(client.trialEndsAt);
    if (d === null || d < 0) return { label:'Trial expirado', tone:'danger' };
    if (d <= 3)               return { label:`Trial — ${d}d`,  tone:'warn'   };
    return                           { label:`Trial — ${d}d`,  tone:'ok'     };
  }
  if (client.billingStatus === 'overdue') return { label:'Pagamento atrasado', tone:'danger' };
  return { label: PLANS.find(p=>p.id===client.plan)?.label ?? client.plan, tone:'ok' };
}

// ─── ADMIN LOGIN ───────────────────────────────────────────────────────────

// Senha do painel admin. Em produção é injetada via Vercel env var
// VITE_ADMIN_PASSWORD. Em dev cai no fallback abaixo (e loga aviso).
const ENV_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;
const FALLBACK_PASSWORD = 'nutriops@admin2026';
const ADMIN_PASSWORD = ENV_PASSWORD || FALLBACK_PASSWORD;
if (!ENV_PASSWORD && import.meta.env.PROD) {
  console.warn('[NutriOPS] VITE_ADMIN_PASSWORD não setada no ambiente de produção. Usando fallback inseguro.');
}

export function AdminLogin({ onLogin }) {
  const [pw, setPw]     = useState('');
  const [error, setError] = useState('');

  const handle = () => {
    if (pw === ADMIN_PASSWORD) {
      const auth = { loggedIn:true, at:new Date().toISOString() };
      writeAdminAuth(auth);
      onLogin();
    } else {
      setError('Senha incorreta.');
    }
  };

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#181715', padding:24 }}>
      <div style={{ width:'100%', maxWidth:380, background:'#211f1c', border:'1px solid rgba(255,255,255,.07)', borderRadius:16, padding:'36px 40px' }}>
        <div style={{ marginBottom:28 }}>
          <BrandLockup size="lg" idPrefix="admlogin" showSub={false} />
          <div style={{ fontSize:9, color:'rgba(255,255,255,.28)', letterSpacing:'.18em', textTransform:'uppercase', marginTop:8 }}>
            Painel admin · v{APP_VERSION}
          </div>
        </div>
        <h2 style={{ fontSize:20, fontWeight:700, color:'#f0ece4', marginBottom:6, fontFamily:'var(--serif)' }}>Painel administrativo</h2>
        <p style={{ fontSize:13, color:'#9b9590', marginBottom:24 }}>Acesso restrito à equipe NutriOPS.</p>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <label style={{ fontSize:12, fontWeight:600, color:'#9b9590', display:'flex', flexDirection:'column', gap:5 }}>
            Senha de acesso
            <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') handle(); }}
              placeholder="••••••••"
              style={{ background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.1)', borderRadius:8, color:'#f0ece4', padding:'9px 12px', fontFamily:'inherit', fontSize:14, outline:'none' }} />
          </label>
          {error && <div style={{ color:'#e85d52', fontSize:13 }}>{error}</div>}
          <button onClick={handle} style={{ padding:'10px', background:'var(--primary,#cc785c)', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            Entrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CLIENT FORM MODAL ─────────────────────────────────────────────────────

function ClientModal({ client, onSave, onClose }) {
  const editing = Boolean(client?.id);
  const [name, setName]           = useState(client?.name ?? '');
  const [email, setEmail]         = useState(client?.email ?? '');
  const [phone, setPhone]         = useState(client?.phone ?? '');
  const [plan, setPlan]           = useState(client?.plan ?? 'trial');
  const [segment, setSegment]     = useState(client?.segment ?? 'padaria');
  const [active, setActive]       = useState(client?.active ?? true);
  const [cnpj, setCnpj]           = useState(client?.cnpj ?? '');
  const [contact, setContact]     = useState(client?.contact ?? '');
  const [notes, setNotes]         = useState(client?.notes ?? '');
  const [billingDay, setBillingDay] = useState(client?.billingDay ?? 5);
  const [billingStatus, setBillingStatus] = useState(client?.billingStatus ?? 'ok');
  // Sincronização opcional — quando preenchida, qualquer device que abrir o
  // link do cliente já entra com Supabase ligado (sem precisar configurar
  // em cada aparelho).
  const [sbUrl, setSbUrl]         = useState(client?.supabase?.url ?? '');
  const [sbKey, setSbKey]         = useState(client?.supabase?.anonKey ?? '');
  const [showSync, setShowSync]   = useState(Boolean(client?.supabase?.url));
  // Setup PIN — visível só quando admin acabou de gerar (não persiste em plain
  // após o modal fechar pra evitar exposição no painel).
  const [generatedPin, setGeneratedPin] = useState(null);
  const [regenerate, setRegenerate]     = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [pushError, setPushError]       = useState('');

  const trialEndsAt  = plan === 'trial' && !editing
    ? new Date(Date.now() + 14 * 86400000).toISOString()
    : client?.trialEndsAt;

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) return;
    setBusy(true);
    setPushError('');

    const id            = client?.id ?? uid();
    const accessToken   = client?.accessToken ?? `nt_${uid()}${uid()}`;
    const isNew         = !editing;
    const needsNewPin   = isNew || regenerate;

    // Gera setup PIN só pra clientes novos ou quando admin pediu regeneração.
    // Hash com PBKDF2 (~100ms) — admin não precisa esperar muito.
    let setupPinPlain   = null;
    let setupPinHash    = client?.setupPinHash ?? null;
    if (needsNewPin) {
      setupPinPlain = generateSetupPin(4);
      try {
        setupPinHash = await hashPin(setupPinPlain, id);
      } catch (e) {
        setPushError(`Falha ao gerar PIN: ${e.message}`);
        setBusy(false);
        return;
      }
    }

    const tenantPayload = {
      id,
      accessToken,
      name: name.trim(),
      segment: segmentLabel(segment),
      plan,
      brandColor: client?.brandColor ?? '#cc785c',
      brandSoft:  client?.brandSoft  ?? 'rgba(204,120,92,.10)',
      equipmentCatalog: client?.equipmentCatalog
        ?? buildEquipmentCatalog(DEFAULT_EQUIPMENT[segment] ?? DEFAULT_EQUIPMENT.outro),
      modules: client?.modules ?? DEFAULT_MODULES,
      stores: client?.stores ?? [{
        id: `${id}-main`,
        name: `${name.trim()} — Principal`,
        location: 'Principal',
      }],
      setupPinHash: needsNewPin ? setupPinHash : undefined,
      adminEmail: email.trim(),
      adminName:  contact.trim() || null,
      trialEndsAt,
    };

    // Push pro Supabase (opcional — se sync ligado).
    // Se falhar não bloqueamos a criação local — o cliente pode tentar logar
    // de outro device e o admin é notificado.
    if (isTenantSyncEnabled()) {
      const result = await pushTenant(tenantPayload);
      if (!result.ok) {
        setPushError(`Tenant não foi salvo no servidor (${result.reason}). Cliente pode não conseguir entrar de outros dispositivos.`);
        // Continua salvando local — admin pode regenerar depois.
      }
    }

    onSave({
      id,
      name: name.trim(), email: email.trim(), phone: phone.trim(),
      plan, segment, active, cnpj: cnpj.trim(), contact: contact.trim(),
      notes: notes.trim(), billingDay: Number(billingDay),
      billingStatus, trialEndsAt,
      createdAt: client?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessToken,
      setupPinHash,
      setupPinGeneratedAt: needsNewPin ? new Date().toISOString() : client?.setupPinGeneratedAt,
      brandColor: tenantPayload.brandColor,
      brandSoft:  tenantPayload.brandSoft,
      equipmentCatalog: tenantPayload.equipmentCatalog,
      modules: tenantPayload.modules,
      stores: tenantPayload.stores,
      // Supabase dedicado — opcional pra Enterprise
      supabase: sbUrl.trim() && sbKey.trim()
        ? { url: sbUrl.trim(), anonKey: sbKey.trim() }
        : null,
    });

    setBusy(false);
    if (setupPinPlain) {
      // Não fecha o modal — admin precisa copiar o PIN antes
      setGeneratedPin(setupPinPlain);
      setRegenerate(false);
    } else {
      onClose();
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:24 }}>
      <div style={{ position:'relative', background:'white', borderRadius:16, padding:28, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ fontSize:18, fontWeight:800 }}>{editing ? 'Editar cliente' : 'Novo cliente'}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#6b6760' }}>✕</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
              Nome do estabelecimento *
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Padaria Bella" style={inputStyle} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
              CNPJ
              <input value={cnpj} onChange={e=>setCnpj(e.target.value)} placeholder="00.000.000/0000-00" style={inputStyle} />
            </label>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
              E-mail de contato *
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="contato@empresa.com" style={inputStyle} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
              Telefone / WhatsApp
              <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(00) 9xxxx-xxxx" style={inputStyle} />
            </label>
          </div>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
            Responsável pelo contrato
            <input value={contact} onChange={e=>setContact(e.target.value)} placeholder="Nome do responsável" style={inputStyle} />
          </label>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
            Segmento {!editing && '(define equipamentos seed)'}
            <select value={segment} onChange={e=>setSegment(e.target.value)} style={inputStyle}>
              {SEGMENTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'#6b6760', marginBottom:8 }}>Plano</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {PLANS.map(p => (
                <button key={p.id} onClick={() => setPlan(p.id)}
                  style={{ padding:'10px 12px', borderRadius:8, border:`1.5px solid ${plan===p.id?p.color:'#d9d1c4'}`, background:plan===p.id?`${p.color}15`:'white', cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:plan===p.id?p.color:'#141413' }}>{p.label}</div>
                  <div style={{ fontSize:11, color:'#6b6760' }}>{p.description}</div>
                </button>
              ))}
            </div>
          </div>
          {plan !== 'trial' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
                Dia de vencimento
                <select value={billingDay} onChange={e=>setBillingDay(e.target.value)} style={inputStyle}>
                  {[1,5,10,15,20,25].map(d=><option key={d} value={d}>Dia {d}</option>)}
                </select>
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
                Status do pagamento
                <select value={billingStatus} onChange={e=>setBillingStatus(e.target.value)} style={inputStyle}>
                  <option value="ok">Em dia</option>
                  <option value="overdue">Atrasado</option>
                  <option value="pending">Pendente</option>
                </select>
              </label>
            </div>
          )}
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
            Observações internas
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notas sobre o cliente, histórico, etc." style={{ ...inputStyle, minHeight:64, resize:'vertical' }} />
          </label>
          <label style={{ display:'flex', flexDirection:'row', alignItems:'center', gap:10, cursor:'pointer', fontSize:13, fontWeight:600 }}>
            <input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} style={{ width:16, height:16, accentColor:'#cc785c' }} />
            Acesso ativo
          </label>

          {/* PIN de configuração — só editing (no novo o PIN é gerado no Save) */}
          {editing && (
            <div style={{ padding:'10px 14px', background:'#faf9f5', border:'1px solid #e5ddd0', borderRadius:8 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'#6b6760', marginBottom:6 }}>
                PIN de configuração
              </div>
              {client?.setupPinHash ? (
                <p style={{ fontSize:12, color:'#6b6760', margin:'0 0 8px', lineHeight:1.5 }}>
                  {client?.setupPinGeneratedAt
                    ? <>Último gerado em <strong>{fmtDT(client.setupPinGeneratedAt)}</strong>. </>
                    : null}
                  Regenere se o cliente esqueceu o PIN ou se quiser invalidar o anterior.
                </p>
              ) : (
                <p style={{ fontSize:12, color:'#6b6760', margin:'0 0 8px', lineHeight:1.5 }}>
                  Cliente ainda não tem PIN de configuração. Gere um agora pra ele conseguir entrar.
                </p>
              )}
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, color:'#cc785c' }}>
                <input type="checkbox" checked={regenerate} onChange={e=>setRegenerate(e.target.checked)} style={{ accentColor:'#cc785c' }} />
                Gerar novo PIN de configuração ao salvar
              </label>
            </div>
          )}

          {pushError && (
            <div style={{ padding:'10px 14px', background:'#fdf6e8', border:'1px solid #8a4e0033', borderRadius:8, fontSize:12, color:'#8a4e00' }}>
              <strong>Atenção:</strong> {pushError}
            </div>
          )}

          {/* Sincronização opcional */}
          <div style={{ borderTop:'1px solid #e5ddd0', paddingTop:14, marginTop:4 }}>
            <button type="button" onClick={() => setShowSync(s => !s)}
              style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:600, color:'#6b6760', display:'flex', alignItems:'center', gap:6, padding:0, letterSpacing:'.06em', textTransform:'uppercase' }}>
              <span style={{ transition:'transform .15s', transform: showSync ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
              Servidor dedicado (Enterprise — avançado)
            </button>
            {showSync && (
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:10, padding:'12px 14px', background:'#faf9f5', border:'1px solid #e5ddd0', borderRadius:8 }}>
                <p style={{ fontSize:11, color:'#6b6760', margin:0, lineHeight:1.5 }}>
                  <strong>Use só pra clientes Enterprise que pediram banco isolado.</strong><br/>
                  Por padrão, todos os clientes usam o Supabase compartilhado do NutriOPS
                  (já configurado via env vars no Vercel — funciona automaticamente).
                  Preencha aqui só se esse cliente vai ter o próprio Supabase project.
                </p>
                <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
                  Supabase URL
                  <input value={sbUrl} onChange={e=>setSbUrl(e.target.value)}
                    placeholder="https://xxxxx.supabase.co" style={inputStyle} />
                </label>
                <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#6b6760' }}>
                  Supabase anon key
                  <input value={sbKey} onChange={e=>setSbKey(e.target.value)} type="password"
                    placeholder="eyJhbGciOi..." style={inputStyle} />
                </label>
                <p style={{ fontSize:11, color:'#6b6760', margin:0 }}>
                  Encontre em: Supabase → Project Settings → API.
                </p>
              </div>
            )}
          </div>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          <button onClick={onClose} disabled={busy} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid #d9d1c4', background:'white', cursor:busy?'wait':'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit', opacity:busy?0.6:1 }}>Cancelar</button>
          <button onClick={handleSave} disabled={!name.trim()||!email.trim()||busy}
            style={{ flex:2, padding:'10px', borderRadius:8, border:'none', background:(name.trim()&&email.trim()&&!busy)?'#cc785c':'#d9d1c4', color:'white', cursor:(name.trim()&&email.trim()&&!busy)?'pointer':'not-allowed', fontSize:14, fontWeight:700, fontFamily:'inherit' }}>
            {busy ? 'Salvando…' : (editing ? 'Salvar alterações' : 'Criar cliente')}
          </button>
        </div>

        {/* Overlay PIN gerado — bloqueia fechar até admin copiar */}
        {generatedPin && (
          <SetupPinReveal pin={generatedPin} onAck={() => { setGeneratedPin(null); onClose(); }} />
        )}
      </div>
    </div>
  );
}

function SetupPinReveal({ pin, onAck }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <div style={{ position:'absolute', inset:0, background:'rgba(20,20,19,.85)', borderRadius:16, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'white', borderRadius:14, padding:'28px 32px', maxWidth:360, width:'100%', textAlign:'center', boxShadow:'0 12px 40px rgba(0,0,0,.4)' }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'#6b6760', marginBottom:8 }}>
          PIN de configuração
        </div>
        <h3 style={{ fontFamily:'var(--serif, serif)', fontSize:20, fontWeight:400, margin:'0 0 10px', color:'#141413', letterSpacing:'-.02em' }}>
          Copie agora — não será mostrado de novo
        </h3>
        <div style={{
          margin:'18px 0',
          padding:'16px 0',
          fontFamily:'monospace',
          fontSize:48,
          letterSpacing:'.3em',
          fontWeight:700,
          color:'#cc785c',
          background:'#faf9f5',
          border:'1px dashed #d9d1c4',
          borderRadius:10,
        }}>
          {pin}
        </div>
        <p style={{ fontSize:12, color:'#6b6760', lineHeight:1.5, margin:'0 0 18px' }}>
          Envie esse PIN ao cliente por <strong>canal separado</strong> do link de acesso
          (WhatsApp, SMS ou ligação — nunca pelo mesmo e-mail).
          Ele expira após o 1º uso e bloqueia após 3 tentativas erradas.
        </p>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={handleCopy} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid #cc785c', background:'white', color:'#cc785c', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            {copied ? '✓ Copiado' : 'Copiar PIN'}
          </button>
          <button onClick={onAck} style={{ flex:1, padding:'10px', borderRadius:8, border:'none', background:'#141413', color:'white', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            Já copiei
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding:'8px 10px', borderRadius:8, border:'1px solid #d9d1c4', fontSize:14, fontFamily:'inherit', outline:'none', background:'white', width:'100%' };

// ─── ACCESS TOKEN MODAL ────────────────────────────────────────────────────

function AccessTokenModal({ client, onClose, onClientUpdate }) {
  const [copied, setCopied] = useState(false);
  const [emailState, setEmailState] = useState('idle'); // idle | sending | sent | error
  const [emailMsg, setEmailMsg] = useState('');
  const url = `https://nutriops.uniwares.net?token=${client.accessToken}`;

  const copy = async (text) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendEmail = async () => {
    if (!client.email) {
      setEmailState('error');
      setEmailMsg('Cliente sem e-mail cadastrado.');
      return;
    }
    setEmailState('sending'); setEmailMsg('');
    try {
      const fn = client.welcomeEmailSentAt ? sendAccessGrantedEmail : sendWelcomeEmail;
      await fn({
        companyName: client.name,
        contactEmail: client.email,
        accessUrl: url,
        plan: client.plan,
      });
      setEmailState('sent');
      setEmailMsg(`Enviado pra ${client.email}`);
      // Atualiza timestamp no client
      const updated = { ...client, welcomeEmailSentAt: new Date().toISOString() };
      onClientUpdate?.(updated);
      setTimeout(() => { setEmailState('idle'); setEmailMsg(''); }, 4000);
    } catch (e) {
      setEmailState('error');
      setEmailMsg(`Falhou: ${e.message ?? 'erro desconhecido'}`);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:24 }}>
      <div style={{ background:'white', borderRadius:16, padding:28, width:'100%', maxWidth:520, boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <h2 style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>Link de acesso — {client.name}</h2>
        <p style={{ fontSize:13, color:'#6b6760', marginBottom:16 }}>
          Esse link abre o NutriOPS já configurado pra conta desse cliente.
          {client.welcomeEmailSentAt && (
            <> Último envio: <strong>{new Date(client.welcomeEmailSentAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</strong>.</>
          )}
        </p>
        <div style={{ background:'#faf9f5', border:'1px solid #d9d1c4', borderRadius:8, padding:'12px 14px', fontFamily:'monospace', fontSize:12, wordBreak:'break-all', marginBottom:12, color:'#141413' }}>
          {url}
        </div>

        {/* Status do setup PIN */}
        <div style={{
          padding:'10px 14px', marginBottom:16, borderRadius:8,
          background: client.setupPinHash ? '#eaf5ef' : '#fdf6e8',
          border: `1px solid ${client.setupPinHash ? '#2d6e4a33' : '#8a4e0033'}`,
          fontSize:12, color: client.setupPinHash ? '#2d6e4a' : '#8a4e00',
        }}>
          {client.setupPinHash ? (
            <>
              <strong>PIN de configuração ativo.</strong> Lembre de enviar o PIN ao cliente por
              canal separado do link (WhatsApp/SMS). Se ele esqueceu, edite o cliente e marque
              "Gerar novo PIN".
            </>
          ) : (
            <>
              <strong>Sem PIN de configuração.</strong> Edite o cliente e marque "Gerar novo PIN"
              pra liberar o 1º acesso.
            </>
          )}
        </div>

        {/* Feedback do envio */}
        {emailState !== 'idle' && emailMsg && (
          <div style={{
            padding:'8px 12px', borderRadius:8, marginBottom:12, fontSize:12, fontWeight:600,
            background: emailState === 'sent' ? '#eaf5ef' : emailState === 'error' ? '#fdecea' : '#fdf6e8',
            color:     emailState === 'sent' ? '#2d6e4a' : emailState === 'error' ? '#c0392b' : '#8a4e00',
            border: `1px solid ${emailState === 'sent' ? '#2d6e4a' : emailState === 'error' ? '#c0392b' : '#8a4e00'}33`,
          }}>
            {emailMsg}
          </div>
        )}

        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={handleSendEmail} disabled={emailState==='sending'}
            style={{ flex:'2 1 200px', padding:'10px', borderRadius:8, border:'none',
              background: emailState==='sending' ? '#9b9590' : '#cc785c',
              color:'white', cursor: emailState==='sending' ? 'wait' : 'pointer',
              fontSize:14, fontWeight:600, fontFamily:'inherit' }}>
            {emailState==='sending' ? 'Enviando...' :
             client.welcomeEmailSentAt ? `Reenviar link pro e-mail` : `Enviar link por e-mail`}
          </button>
          <button onClick={() => copy(url)}
            style={{ flex:'1 1 120px', padding:'10px', borderRadius:8, border:'1px solid #d9d1c4',
              background:'white', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
            {copied ? 'Copiado' : 'Copiar link'}
          </button>
          <button onClick={() => copy(client.accessToken)}
            style={{ flex:'1 1 100px', padding:'10px', borderRadius:8, border:'1px solid #d9d1c4',
              background:'white', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
            Só token
          </button>
          <button onClick={onClose}
            style={{ flex:'0 0 auto', padding:'10px 14px', borderRadius:8, border:'1px solid #d9d1c4',
              background:'white', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH VIEW — saúde operacional dos tenants
// ═══════════════════════════════════════════════════════════════════════════

// resolveTone e resolveLimits vêm de ./limits. Aqui usamos snake_case porque
// records vêm direto do Supabase REST (min_value, max_value).
const resolveTone   = resolveToneCat;
function resolveLimits(label, ctx = null) {
  return resolveLimitsCat(label, ctx);
}
function fmtRelative(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

const SB_URL = import.meta.env.VITE_SB_URL || '';
const SB_KEY = import.meta.env.VITE_SB_ANON_KEY || '';

async function fetchSupabase(table, query = '') {
  if (!SB_URL || !SB_KEY) throw new Error('Supabase não configurado (VITE_SB_URL / VITE_SB_ANON_KEY ausentes)');
  const res = await fetch(`${SB_URL.replace(/\/$/, '')}/rest/v1/${table}${query ? '?' + query : ''}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

// ─── Alertas operacionais ──────────────────────────────────────────────────

const SEVERITY_RANK = { danger: 0, warn: 1, info: 2 };

// Match permissivo cliente↔tenant (mesmo critério do HealthView).
function findClientForTenant(tenant, clients) {
  const tName = tenant.name?.toLowerCase() ?? '';
  return clients.find(c => {
    const cName = c.name?.toLowerCase() ?? '';
    return cName.includes(tName) || tName.includes(cName);
  });
}

// Pura — sem useState/useMemo. Recebe métricas (do Supabase) + clientes
// (do localStorage) e devolve a lista de alertas a mostrar.
export function computeTenantAlerts(metricsByTenant, tenants, clients) {
  const out = [];
  const seen = new Set();

  // Alertas por tenant (inatividade + conformidade)
  for (const t of tenants) {
    const m = metricsByTenant[t.id] ?? null;
    const client = findClientForTenant(t, clients);
    if (!m) continue;

    if (m.lastActivity) {
      const days = Math.floor((Date.now() - new Date(m.lastActivity).getTime()) / 86400000);
      if (days >= 10) {
        out.push({
          id: `inactive-${t.id}`,
          kind: 'inactive', severity: 'danger',
          tenant: t, client,
          label: `${t.name} sem registros há ${days} dias`,
          hint: 'Risco real de cliente parar de usar. Ligar pro contato.',
          action: client?.email ? { kind: 'email', target: client.email } : null,
        });
        seen.add(t.id);
      } else if (days >= 5) {
        out.push({
          id: `inactive-${t.id}`,
          kind: 'inactive', severity: 'warn',
          tenant: t, client,
          label: `${t.name} sem registros há ${days} dias`,
          hint: 'Vale um check-in com o supervisor.',
          action: client?.email ? { kind: 'email', target: client.email } : null,
        });
        seen.add(t.id);
      }
    }

    if (m.conformity != null && m.conformity < 70 && !seen.has(t.id)) {
      const isDanger = m.conformity < 50;
      out.push({
        id: `conf-${t.id}`,
        kind: 'compliance',
        severity: isDanger ? 'danger' : 'warn',
        tenant: t, client,
        label: `${t.name} com ${m.conformity}% de conformidade (últ. 7d)`,
        hint: isDanger
          ? 'Muito fora da faixa. Vale alertar a RT.'
          : 'Conformidade baixa — observar tendência.',
        action: null,
      });
    }
  }

  // Alertas por cliente (trial + pagamento)
  for (const c of clients) {
    if (!c.active) continue;

    if (c.plan === 'trial' && c.trialEndsAt) {
      const days = Math.ceil((new Date(c.trialEndsAt).getTime() - Date.now()) / 86400000);
      if (days < 0) {
        out.push({
          id: `trial-exp-${c.id}`,
          kind: 'trial-expired', severity: 'danger',
          client: c,
          label: `Trial de ${c.name} expirou há ${Math.abs(days)}d`,
          hint: 'Cliente está com acesso bloqueado. Converta ou avise.',
          action: { kind: 'edit-client', target: c.id },
        });
      } else if (days <= 3) {
        out.push({
          id: `trial-warn-${c.id}`,
          kind: 'trial-warning', severity: 'warn',
          client: c,
          label: `Trial de ${c.name} expira em ${days}d`,
          hint: 'Hora de propor o plano pago.',
          action: { kind: 'edit-client', target: c.id },
        });
      }
    }

    if (c.billingStatus === 'overdue') {
      out.push({
        id: `overdue-${c.id}`,
        kind: 'overdue', severity: 'danger',
        client: c,
        label: `${c.name} com pagamento atrasado`,
        hint: 'Regularize antes que o acesso seja cortado.',
        action: { kind: 'edit-client', target: c.id },
      });
    }
  }

  // Ordena: danger primeiro, depois warn; dentro do mesmo nível mantém ordem
  return out.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
}

function AlertsCard({ alerts, onAction }) {
  if (!alerts.length) return null;
  const dangerCount = alerts.filter(a => a.severity === 'danger').length;
  const warnCount   = alerts.filter(a => a.severity === 'warn').length;

  return (
    <div style={{
      background:'white', border:'1px solid #d9d1c4', borderRadius:12,
      padding:'18px 22px', marginBottom:16,
      borderLeft:`4px solid ${dangerCount > 0 ? '#c0392b' : '#8a4e00'}`,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:12 }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'#6b6760' }}>
            Atenção operacional
          </div>
          <h3 style={{ fontFamily:'Times-Roman, serif', fontSize:22, fontWeight:400, margin:'2px 0 0', letterSpacing:'-.02em', color:'#141413' }}>
            {alerts.length} alerta{alerts.length === 1 ? '' : 's'} {dangerCount > 0 && `· ${dangerCount} crítico${dangerCount === 1 ? '' : 's'}`}{warnCount > 0 && ` · ${warnCount} aviso${warnCount === 1 ? '' : 's'}`}
          </h3>
        </div>
      </div>

      <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:8 }}>
        {alerts.map(a => {
          const color = a.severity === 'danger' ? '#c0392b' : '#8a4e00';
          const bg    = a.severity === 'danger' ? '#fdecea' : '#fdf6e8';
          return (
            <li key={a.id} style={{
              display:'flex', alignItems:'flex-start', gap:12,
              padding:'10px 14px', background:bg, borderRadius:8,
              borderLeft:`3px solid ${color}`,
            }}>
              <span style={{
                flexShrink:0, marginTop:2,
                width:8, height:8, borderRadius:'50%', background:color,
              }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#141413' }}>{a.label}</div>
                {a.hint && (
                  <div style={{ fontSize:11, color:'#6b6760', marginTop:2 }}>{a.hint}</div>
                )}
              </div>
              {a.action && (
                <button
                  onClick={() => onAction?.(a)}
                  style={{
                    flexShrink:0, padding:'5px 10px', borderRadius:6,
                    border:`1px solid ${color}55`, background:'white',
                    color, cursor:'pointer', fontSize:11, fontWeight:700,
                    fontFamily:'inherit', whiteSpace:'nowrap',
                    letterSpacing:'.04em', textTransform:'uppercase',
                  }}
                  title={a.action.kind === 'email' ? `Enviar e-mail pra ${a.action.target}` : 'Abrir cliente'}
                >
                  {a.action.kind === 'email' ? 'E-mail' :
                   a.action.kind === 'edit-client' ? 'Abrir' :
                   'Ação'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TenantHealthCard({ tenant, metrics, client }) {
  const toneColor = (t) => ({
    ok:'#2d6e4a', warn:'#8a4e00', danger:'#c0392b', neutral:'#9b9590',
  })[t];

  const syncTone = metrics.recordsLast7d > 0 ? 'ok' : metrics.lastActivity ? 'warn' : 'neutral';
  const conformityTone = metrics.conformity == null ? 'neutral'
    : metrics.conformity >= 90 ? 'ok'
    : metrics.conformity >= 70 ? 'warn' : 'danger';

  return (
    <div style={{
      background:'white', border:'1px solid #d9d1c4',
      borderRadius:12, padding:'20px 22px',
      borderTop:`3px solid ${tenant.brandColor || '#cc785c'}`,
      display:'flex', flexDirection:'column', gap:12,
    }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'#6b6760' }}>
            {tenant.segment || 'unidade'}
          </div>
          <h3 style={{ fontFamily:'Times-Roman, serif', fontSize:22, fontWeight:400, margin:'2px 0 0', color:'#141413', letterSpacing:'-.02em' }}>
            {tenant.name}
          </h3>
          {client && (
            <div style={{ fontSize:11, color:'#6b6760', marginTop:4 }}>
              {client.plan} · {client.email}
            </div>
          )}
        </div>
        <span style={{
          padding:'4px 10px', borderRadius:20, fontSize:10, fontWeight:600,
          letterSpacing:'.08em', textTransform:'uppercase',
          background: syncTone === 'ok' ? '#eaf5ef' : syncTone === 'warn' ? '#fdf6e8' : '#f0ece4',
          color: toneColor(syncTone),
        }}>
          {syncTone === 'ok' ? 'Ativo' : syncTone === 'warn' ? 'Inativo' : 'Sem dados'}
        </span>
      </div>

      {/* Grid de métricas */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginTop:4 }}>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#6b6760' }}>
            Última atividade
          </div>
          <div style={{ fontSize:14, fontWeight:600, color: toneColor(syncTone), marginTop:2 }}>
            {fmtRelative(metrics.lastActivity)}
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#6b6760' }}>
            Registros 7d
          </div>
          <div style={{ fontSize:18, fontWeight:600, fontFamily:'Courier-Bold, monospace', color:'#141413', marginTop:2 }}>
            {metrics.recordsLast7d}
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#6b6760' }}>
            Conformidade
          </div>
          <div style={{ fontSize:18, fontWeight:600, fontFamily:'Courier-Bold, monospace', color: toneColor(conformityTone), marginTop:2 }}>
            {metrics.conformity != null ? `${metrics.conformity}%` : '—'}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, paddingTop:10, borderTop:'1px solid #e5ddd0' }}>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#6b6760' }}>
            Usuários ativos
          </div>
          <div style={{ fontSize:14, fontWeight:600, color:'#141413', marginTop:2 }}>
            {metrics.activeUsers7d} {metrics.activeUsers7d === 1 ? 'pessoa' : 'pessoas'}
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#6b6760' }}>
            Equipamentos
          </div>
          <div style={{ fontSize:14, fontWeight:600, color:'#141413', marginTop:2 }}>
            {tenant.equipmentCatalog?.length || 0} cadastrados
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#6b6760' }}>
            Não-conformes
          </div>
          <div style={{ fontSize:14, fontWeight:600, color: metrics.nonCompliant > 0 ? toneColor('danger') : toneColor('neutral'), marginTop:2 }}>
            {metrics.nonCompliant}
          </div>
        </div>
      </div>
    </div>
  );
}

// Mini-sparkline 30 dias — width fixo, height 28px, sem libs
function HistoryChart({ days, color = '#cc785c', maxOverride = null }) {
  if (!days?.length) return null;
  const max = maxOverride ?? Math.max(1, ...days.map(d => d.count));
  const W = 240, H = 28, PAD = 2;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const dx = days.length > 1 ? innerW / (days.length - 1) : 0;

  // Path da linha
  const pts = days.map((d, i) => ({
    x: PAD + i * dx,
    y: PAD + innerH - (d.count / max) * innerH,
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${pts[pts.length-1].x.toFixed(1)} ${H-PAD} L ${pts[0].x.toFixed(1)} ${H-PAD} Z`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display:'block' }}>
      <path d={areaPath} fill={color} fillOpacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Agrega registros do tenant em buckets diários nos últimos N dias.
// Devolve array [{ date: 'YYYY-MM-DD', count: n }] ordenado cronologicamente.
export function bucketByDay(records, days = 30) {
  const buckets = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Inicializa buckets vazios pra todos os dias do range
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const r of records) {
    const day = r.created_at?.slice(0, 10);
    if (day && buckets.has(day)) {
      buckets.set(day, buckets.get(day) + 1);
    }
  }

  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

// Drill-down de uso diário — abre ao clicar numa linha da tendência.
// Mostra barras por dia (30d), stats agregadas e os últimos dias em lista.
// Reusa o array `days` já computado pelo bucketByDay (zero fetch extra).
function UsageDrilldownModal({ tenant, days, metrics, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = tenant.brandColor ?? '#cc785c';
  const total = days.reduce((s, d) => s + d.count, 0);
  const max = Math.max(1, ...days.map(d => d.count));
  const activeDays = days.filter(d => d.count > 0).length;
  const avg = activeDays > 0 ? (total / activeDays).toFixed(1) : '0';
  const busiest = days.reduce((best, d) => d.count > (best?.count ?? -1) ? d : best, null);
  const zeroDays = days.length - activeDays;

  const fmtDay = (iso) => {
    try { return new Date(iso + 'T12:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }); }
    catch { return iso; }
  };
  const weekday = (iso) => {
    try { return new Date(iso + 'T12:00').toLocaleDateString('pt-BR', { weekday:'short' }).replace('.',''); }
    catch { return ''; }
  };
  const recent = [...days].slice(-7).reverse();

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:24 }}>
      <div onClick={e => e.stopPropagation()} style={{ position:'relative', background:'white', borderRadius:16, padding:28, width:'100%', maxWidth:620, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:10, height:10, borderRadius:'50%', background:color, flexShrink:0 }} />
            <div>
              <h2 style={{ fontFamily:'Times-Roman, serif', fontSize:22, fontWeight:400, margin:0, letterSpacing:'-.02em', color:'#141413' }}>{tenant.name}</h2>
              <div style={{ fontSize:11, color:'#6b6760', letterSpacing:'.04em', textTransform:'uppercase' }}>Uso diário · últimos 30 dias</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#6b6760', lineHeight:1 }}>✕</button>
        </div>

        {/* Stats agregadas */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10, marginBottom:20 }}>
          {[
            { label:'Total 30d', value:total },
            { label:'Média/dia ativo', value:avg },
            { label:'Dias sem registro', value:zeroDays },
            { label:'Pico', value:busiest?.count ?? 0, sub: busiest && busiest.count > 0 ? fmtDay(busiest.date) : null },
          ].map(s => (
            <div key={s.label} style={{ background:'#faf9f5', border:'1px solid #ece7dd', borderRadius:10, padding:'10px 12px' }}>
              <div style={{ fontSize:20, fontWeight:600, fontFamily:'monospace', color:'#141413', lineHeight:1.1 }}>{s.value}</div>
              <div style={{ fontSize:9, color:'#6b6760', letterSpacing:'.08em', textTransform:'uppercase', marginTop:2 }}>{s.label}</div>
              {s.sub && <div style={{ fontSize:10, color:'#9b9590', marginTop:1 }}>{s.sub}</div>}
            </div>
          ))}
        </div>

        {/* Bar chart diário */}
        <div style={{ display:'flex', alignItems:'flex-end', gap:2, height:120, padding:'0 2px', marginBottom:6 }}>
          {days.map((d) => {
            const h = max > 0 ? Math.round((d.count / max) * 100) : 0;
            return (
              <div key={d.date} title={`${fmtDay(d.date)} (${weekday(d.date)}): ${d.count} registro${d.count!==1?'s':''}`}
                style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end', height:'100%', cursor:'default' }}>
                <div style={{
                  height:`${h}%`, minHeight: d.count > 0 ? 3 : 1,
                  background: d.count > 0 ? color : '#ece7dd',
                  borderRadius:'3px 3px 0 0', opacity: d.count > 0 ? 1 : .6,
                  transition:'opacity .12s',
                }} />
              </div>
            );
          })}
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'#9b9590', letterSpacing:'.04em', marginBottom:20 }}>
          <span>{fmtDay(days[0]?.date)}</span>
          <span>{fmtDay(days[Math.floor(days.length/2)]?.date)}</span>
          <span>hoje</span>
        </div>

        {/* Últimos 7 dias em lista */}
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#6b6760', marginBottom:8 }}>Últimos 7 dias</div>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          {recent.map(d => {
            const pct = max > 0 ? (d.count / max) * 100 : 0;
            return (
              <div key={d.date} style={{ display:'grid', gridTemplateColumns:'70px 1fr 36px', alignItems:'center', gap:10, padding:'3px 0' }}>
                <span style={{ fontSize:11, color:'#6b6760' }}>{fmtDay(d.date)} <span style={{ color:'#b8b1a6' }}>{weekday(d.date)}</span></span>
                <div style={{ background:'#f0ece4', borderRadius:4, height:8, overflow:'hidden' }}>
                  <div style={{ width:`${pct}%`, height:'100%', background:color, opacity: d.count>0?1:0, borderRadius:4 }} />
                </div>
                <span style={{ fontSize:12, fontWeight:600, fontFamily:'monospace', color: d.count>0?'#141413':'#b8b1a6', textAlign:'right' }}>{d.count}</span>
              </div>
            );
          })}
        </div>

        {metrics && metrics.conformity != null && (
          <div style={{ marginTop:18, paddingTop:14, borderTop:'1px solid #f0ece4', fontSize:12, color:'#6b6760' }}>
            Conformidade recente (7d): <strong style={{ color:'#141413' }}>{metrics.conformity}%</strong>
            {' · '}{metrics.activeUsers7d} usuário(s) ativo(s)
            {metrics.nonCompliant > 0 && <> · <span style={{ color:'#c0392b' }}>{metrics.nonCompliant} fora da faixa</span></>}
          </div>
        )}
      </div>
    </div>
  );
}

function HealthView({ clients, onAlertsChange, onEditClient }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [records, setRecords] = useState([]);
  const [refreshAt, setRefreshAt] = useState(0);
  const [drill, setDrill]     = useState(null); // { tenant, days, metrics }

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        // Pull últimos 30 dias pra alimentar tanto métricas 7d quanto sparkline 30d.
        // Limit 5000 cobre 3 tenants com até ~50 leituras/dia.
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const data = await fetchSupabase('temperature_records',
          `created_at=gte.${thirtyDaysAgo}&order=created_at.desc&limit=5000`);
        if (!cancelled) setRecords(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshAt]);

  // Aggregate metrics per tenant — métricas usam só os últimos 7d pra continuar
  // sendo "saúde recente"; sparkline usa os 30d completos.
  const metricsByTenant = useMemo(() => {
    const sevenDaysAgoMs = Date.now() - 7 * 86400000;
    const out = {};
    for (const r of records) {
      if (new Date(r.created_at).getTime() < sevenDaysAgoMs) continue;
      const tid = r.tenant_id;
      if (!out[tid]) out[tid] = { records: [], users: new Set() };
      out[tid].records.push(r);
      if (r.user_name) out[tid].users.add(r.user_name);
    }
    const final = {};
    for (const [tid, { records, users }] of Object.entries(out)) {
      const lastActivity = records[0]?.created_at;
      const ok = records.filter(r => {
        const min = r.min_value != null ? r.min_value : resolveLimits(r.equipment_input).min;
        const max = r.max_value != null ? r.max_value : resolveLimits(r.equipment_input).max;
        return resolveTone(r.value, min, max) === 'ok';
      }).length;
      const nonCompliant = records.filter(r => {
        const min = r.min_value != null ? r.min_value : resolveLimits(r.equipment_input).min;
        const max = r.max_value != null ? r.max_value : resolveLimits(r.equipment_input).max;
        return resolveTone(r.value, min, max) === 'danger';
      }).length;
      final[tid] = {
        recordsLast7d: records.length,
        activeUsers7d: users.size,
        lastActivity,
        conformity: records.length > 0 ? Math.round((ok / records.length) * 100) : null,
        nonCompliant,
      };
    }
    return final;
  }, [records]);

  // Histórico 30d por tenant — sparkline cumulativa por dia
  const historyByTenant = useMemo(() => {
    const byTenant = {};
    for (const r of records) {
      const tid = r.tenant_id;
      if (!byTenant[tid]) byTenant[tid] = [];
      byTenant[tid].push(r);
    }
    const out = {};
    for (const [tid, recs] of Object.entries(byTenant)) {
      out[tid] = bucketByDay(recs, 30);
    }
    return out;
  }, [records]);

  const defaultMetrics = { recordsLast7d:0, activeUsers7d:0, lastActivity:null, conformity:null, nonCompliant:0 };

  // Alertas operacionais — combina métricas do Supabase com config dos clientes
  const alerts = useMemo(
    () => computeTenantAlerts(metricsByTenant, tenantsBase, clients),
    [metricsByTenant, clients],
  );

  // Notifica parent (AdminPanel) pra mostrar badge no tab
  useEffect(() => { onAlertsChange?.(alerts); }, [alerts, onAlertsChange]);

  const handleAlertAction = (alert) => {
    if (alert.action?.kind === 'email' && alert.action.target) {
      const subject = encodeURIComponent(`NutriOPS — sobre ${alert.tenant?.name ?? alert.client?.name}`);
      const body = encodeURIComponent(`Oi! ${alert.label}.\n\n${alert.hint ?? ''}`);
      window.location.href = `mailto:${alert.action.target}?subject=${subject}&body=${body}`;
    } else if (alert.action?.kind === 'edit-client' && alert.client) {
      onEditClient?.(alert.client);
    }
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:16 }}>
        <div>
          <h2 style={{ fontFamily:'Times-Roman, serif', fontSize:26, fontWeight:400, margin:0, letterSpacing:'-.02em', color:'#141413' }}>
            Saúde dos tenants
          </h2>
          <p style={{ fontSize:13, color:'#6b6760', margin:'4px 0 0' }}>
            Métricas (7d) e tendência (30d) agregadas direto do Supabase. Atualizado {loading ? '...' : 'agora'}.
          </p>
        </div>
        <button onClick={() => setRefreshAt(t => t+1)} disabled={loading}
          style={{ padding:'8px 14px', borderRadius:8, border:'1px solid #d9d1c4', background:'white', cursor: loading ? 'wait' : 'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit' }}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      <AlertsCard alerts={alerts} onAction={handleAlertAction} />

      {/* Tendência 30 dias — sparkline por tenant pra detectar queda de uso cedo */}
      {Object.keys(historyByTenant).length > 0 && (
        <div style={{
          background:'white', border:'1px solid #d9d1c4', borderRadius:12,
          padding:'18px 22px', marginBottom:16,
        }}>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'#6b6760' }}>
              Tendência operacional
            </div>
            <h3 style={{ fontFamily:'Times-Roman, serif', fontSize:22, fontWeight:400, margin:'2px 0 0', letterSpacing:'-.02em', color:'#141413' }}>
              Volume de registros — últimos 30 dias
            </h3>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {tenantsBase.map(t => {
              const days = historyByTenant[t.id] ?? bucketByDay([], 30);
              const total = days.reduce((sum, d) => sum + d.count, 0);
              const half = Math.floor(days.length / 2);
              const firstHalf  = days.slice(0, half).reduce((s, d) => s + d.count, 0);
              const secondHalf = days.slice(half).reduce((s, d) => s + d.count, 0);
              const delta = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : null;
              const deltaColor = delta == null ? '#9b9590'
                : delta >= 10 ? '#2d6e4a'
                : delta <= -25 ? '#c0392b'
                : delta <= -10 ? '#8a4e00'
                : '#6b6760';

              return (
                <button key={t.id}
                  onClick={() => setDrill({ tenant: t, days, metrics: metricsByTenant[t.id] })}
                  title={`Ver uso diário de ${t.name}`}
                  style={{
                    display:'grid', gridTemplateColumns:'minmax(160px, 1.2fr) auto 90px 70px',
                    alignItems:'center', gap:16, width:'100%', textAlign:'left',
                    padding:'8px 6px', margin:'0 -6px', border:'none', background:'none',
                    borderBottom:'1px solid #f0ece4', cursor:'pointer', borderRadius:6,
                    fontFamily:'inherit', transition:'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#faf9f5'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                    <span style={{
                      flexShrink:0, width:8, height:8, borderRadius:'50%',
                      background: t.brandColor ?? '#cc785c',
                    }} />
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'#141413', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {t.name}
                      </div>
                      <div style={{ fontSize:10, color:'#6b6760', letterSpacing:'.04em', textTransform:'uppercase' }}>
                        {t.segment ?? 'unidade'}
                      </div>
                    </div>
                  </div>
                  <HistoryChart days={days} color={t.brandColor ?? '#cc785c'} />
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:18, fontWeight:600, fontFamily:'monospace', color:'#141413', lineHeight:1.1 }}>
                      {total}
                    </div>
                    <div style={{ fontSize:9, color:'#6b6760', letterSpacing:'.10em', textTransform:'uppercase' }}>
                      registros
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:13, fontWeight:700, color: deltaColor, lineHeight:1.1 }}>
                      {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`}
                    </div>
                    <div style={{ fontSize:9, color:'#6b6760', letterSpacing:'.10em', textTransform:'uppercase' }}>
                      15d vs 15d
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding:'12px 16px', background:'#fdecea', border:'1px solid #c0392b', borderRadius:10, color:'#c0392b', fontSize:13, marginBottom:16 }}>
          <strong>Não foi possível carregar:</strong> {error}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(380px, 1fr))', gap:14 }}>
        {tenantsBase.map(t => {
          const matchingClient = clients.find(c =>
            c.name?.toLowerCase().includes(t.name.toLowerCase()) ||
            t.name.toLowerCase().includes(c.name?.toLowerCase() ?? '')
          );
          return (
            <TenantHealthCard
              key={t.id}
              tenant={t}
              metrics={metricsByTenant[t.id] ?? defaultMetrics}
              client={matchingClient}
            />
          );
        })}
      </div>

      {/* Footer summary */}
      <div style={{ marginTop:20, padding:'12px 16px', background:'#f0ece4', borderRadius:10, fontSize:12, color:'#6b6760' }}>
        Total agregado: <strong>{records.length}</strong> leituras nos últimos 30 dias
        em <strong>{Object.keys(historyByTenant).length}</strong> tenant(s) com atividade.
        Janela limitada a 5000 registros mais recentes.
      </div>

      {drill && (
        <UsageDrilldownModal
          tenant={drill.tenant}
          days={drill.days}
          metrics={drill.metrics}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════

export function AdminPanel({ onExit }) {
  const [clients, setClients]         = useState(() => readClients());
  const [modal, setModal]             = useState(null);
  const [tokenModal, setTokenModal]   = useState(null);
  const [search, setSearch]           = useState('');
  const [filter, setFilter]           = useState('all');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [tab, setTab]                 = useState('clients'); // 'clients' | 'health'
  // Alertas elevados de HealthView pra que o tab Saúde mostre badge mesmo
  // quando o admin tá no tab Clientes. HealthView atualiza via onAlertsChange.
  const [healthAlerts, setHealthAlerts] = useState([]);
  const usageStats = useMemo(() => getAllUsageStats(), []);

  useEffect(() => { writeClients(clients); }, [clients]);

  const saveClient = (client) => {
    setClients(prev => prev.find(c=>c.id===client.id)
      ? prev.map(c=>c.id===client.id?client:c)
      : [...prev, client]);
  };

  const deleteClient = (id) => {
    setClients(prev => prev.filter(c=>c.id!==id));
    setConfirmDelete(null);
  };

  const toggleActive = (id) => {
    setClients(prev => prev.map(c => c.id===id ? { ...c, active:!c.active, updatedAt:new Date().toISOString() } : c));
  };

  const filtered = clients.filter(c => {
    if (filter === 'active'  && !c.active) return false;
    if (filter === 'inactive' && c.active) return false;
    if (filter === 'trial'   && c.plan !== 'trial') return false;
    if (filter === 'overdue' && c.billingStatus !== 'overdue') return false;
    if (search) { const q = search.toLowerCase(); return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.cnpj?.includes(q); }
    return true;
  });

  // KPIs
  const kpis = useMemo(() => {
    const active  = clients.filter(c=>c.active);
    const mrr     = active.filter(c=>c.plan!=='trial').reduce((a,c)=>a+(PLANS.find(p=>p.id===c.plan)?.price??0),0);
    const overdue = clients.filter(c=>c.billingStatus==='overdue').length;
    const trials  = clients.filter(c=>c.plan==='trial'&&c.active).length;
    return { total:clients.length, active:active.length, mrr, overdue, trials };
  }, [clients]);

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg,#faf9f5)', fontFamily:'var(--font,"Instrument Sans",system-ui,sans-serif)' }}>
      {/* Header */}
      <div style={{ background:'#181715', padding:'0 24px', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', height:64 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <BrandLockup size="sm" idPrefix="admhdr" showSub={false} />
            <span style={{ padding:'2px 10px', background:'rgba(204,120,92,.18)', border:'1px solid rgba(204,120,92,.4)', borderRadius:20, fontSize:10, fontWeight:600, color:'#e8946f', letterSpacing:'.12em', textTransform:'uppercase' }}>Admin</span>
          </div>
          <button onClick={onExit} style={{ background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.1)', color:'#9b9590', borderRadius:8, padding:'6px 14px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
            Sair do painel
          </button>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:'0 auto', padding:'28px 24px' }}>

        {/* Tabs */}
        <div style={{
          display:'flex', gap:4, padding:4, marginBottom:20,
          background:'#f0ece4', border:'1px solid #e5ddd0',
          borderRadius:10, width:'fit-content',
        }}>
          {[['clients','Clientes'],['health','Saúde dos tenants']].map(([key, label]) => {
            const isActive = tab === key;
            const badgeCount = key === 'health' ? healthAlerts.length : 0;
            const badgeHasDanger = key === 'health' && healthAlerts.some(a => a.severity === 'danger');
            return (
              <button key={key} onClick={() => setTab(key)}
                style={{
                  padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer',
                  fontFamily:'inherit', fontSize:13,
                  fontWeight: isActive ? 600 : 500,
                  background: isActive ? 'white' : 'transparent',
                  color: isActive ? '#cc785c' : '#6b6760',
                  boxShadow: isActive ? '0 1px 3px rgba(20,20,19,.06)' : 'none',
                  transition:'all .15s',
                  display:'flex', alignItems:'center', gap:8,
                }}>
                {label}
                {badgeCount > 0 && (
                  <span style={{
                    minWidth:18, padding:'1px 6px', borderRadius:10,
                    fontSize:10, fontWeight:700, lineHeight:1.4,
                    background: badgeHasDanger ? '#c0392b' : '#8a4e00',
                    color: 'white',
                  }}>
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* HealthView sempre montado — fica oculto quando não é o tab ativo
            pra que o fetch + cálculo de alerts mantenham o badge da tab
            sempre atualizado, mesmo se o admin nunca visitar "Saúde". */}
        <div style={{ display: tab === 'health' ? 'block' : 'none' }}>
          <HealthView
            clients={clients}
            onAlertsChange={setHealthAlerts}
            onEditClient={(client) => { setTab('clients'); setModal(client); }}
          />
        </div>

        {tab === 'clients' && <>
        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:24 }}>
          {[
            { label:'Total de clientes', value:kpis.total,     color:'#141413' },
            { label:'Clientes ativos',   value:kpis.active,    color:'#2d6e4a' },
            { label:'MRR',               value:`R$${kpis.mrr}`, color:'#cc785c' },
            { label:'Pagamentos atrasados', value:kpis.overdue, color:kpis.overdue>0?'#c0392b':'#141413' },
            { label:'Em trial',          value:kpis.trials,    color:'#8a4e00' },
          ].map(k => (
            <div key={k.label} style={{ background:'white', border:'1px solid #d9d1c4', borderRadius:12, padding:'14px 16px' }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#6b6760', marginBottom:4 }}>{k.label}</div>
              <div style={{ fontSize:24, fontWeight:700, letterSpacing:'-.04em', fontFamily:'monospace', color:k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome, e-mail ou CNPJ…"
            style={{ flex:1, minWidth:200, padding:'8px 12px', borderRadius:8, border:'1px solid #d9d1c4', fontSize:14, fontFamily:'inherit', outline:'none', background:'white' }} />
          <select value={filter} onChange={e=>setFilter(e.target.value)}
            style={{ padding:'8px 12px', borderRadius:8, border:'1px solid #d9d1c4', fontSize:14, fontFamily:'inherit', background:'white', cursor:'pointer' }}>
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
            <option value="trial">Em trial</option>
            <option value="overdue">Pagamento atrasado</option>
          </select>
          <button onClick={() => setModal('new')}
            style={{ padding:'8px 18px', background:'#cc785c', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
            + Novo cliente
          </button>
        </div>

        {/* Client table */}
        <div style={{ background:'white', border:'1px solid #d9d1c4', borderRadius:12, overflow:'hidden' }}>
          {filtered.length === 0 ? (
            <div style={{ padding:'40px 24px', textAlign:'center', color:'#6b6760' }}>
              {clients.length === 0 ? 'Nenhum cliente cadastrado ainda.' : 'Nenhum cliente encontrado.'}
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
              <thead>
                <tr style={{ background:'#faf9f5', borderBottom:'1px solid #d9d1c4' }}>
                  {['Cliente','Plano','Status','Faturamento','Uso',''].map(h => (
                    <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#6b6760', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(client => {
                  const st      = clientStatus(client);
                  const plan    = PLANS.find(p=>p.id===client.plan);
                  const toneColor = { ok:'#2d6e4a', warn:'#8a4e00', danger:'#c0392b', neutral:'#6b6760' }[st.tone];
                  const toneBg    = { ok:'#dafbe1', warn:'#fdf8e3', danger:'#ffebe9', neutral:'#faf9f5'  }[st.tone];
                  return (
                    <tr key={client.id} style={{ borderBottom:'1px solid #eaeef2' }}>
                      <td style={{ padding:'12px 16px' }}>
                        <div style={{ fontWeight:700 }}>{client.name}</div>
                        <div style={{ fontSize:12, color:'#6b6760' }}>{client.email}</div>
                        {client.contact && <div style={{ fontSize:11, color:'#9198a1' }}>{client.contact}</div>}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:700, background:`${plan?.color}18`, color:plan?.color }}>
                          {plan?.label ?? client.plan}
                        </span>
                        {plan?.price && <div style={{ fontSize:11, color:'#6b6760', marginTop:3 }}>R${plan.price}/mês</div>}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:700, background:toneBg, color:toneColor }}>
                          {st.label}
                        </span>
                        {!client.active && <div style={{ fontSize:11, color:'#c0392b', marginTop:3 }}>Acesso bloqueado</div>}
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:12, color:'#6b6760' }}>
                        {client.plan === 'trial'
                          ? `Trial até ${fmtDate(client.trialEndsAt)}`
                          : client.billingStatus === 'ok'
                            ? `Vence dia ${client.billingDay}`
                            : <span style={{ color:'#c0392b', fontWeight:600 }}>Pagamento {client.billingStatus==='overdue'?'atrasado':'pendente'}</span>}
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:12, color:'#6b6760' }}>
                        {(() => {
                          const u = usageStats[client.id];
                          if (!u) return <span style={{ color:'#9198a1' }}>Sem uso</span>;
                          const lastSeen = u.lastSeen ? new Date(u.lastSeen) : null;
                          const daysAgo = lastSeen ? Math.floor((Date.now()-lastSeen.getTime())/86400000) : null;
                          const active7d = Object.keys(u.actions||{}).filter(d => {
                            return (Date.now()-new Date(d).getTime())/86400000 <= 7;
                          }).length;
                          return (
                            <div>
                              <div style={{ fontWeight:600, color: daysAgo===0?'#2d6e4a':daysAgo<=3?'#8a4e00':'#6b6760' }}>
                                {daysAgo === 0 ? '🟢 Hoje' : daysAgo === 1 ? '🟡 Ontem' : daysAgo !== null ? `⚫ ${daysAgo}d atrás` : '—'}
                              </div>
                              <div style={{ fontSize:11, color:'#9198a1' }}>{active7d}d ativo nos últ. 7d</div>
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                          <button onClick={() => setTokenModal(client)}
                            style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #d9d1c4', background:'white', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit' }}>
                            🔗 Link
                          </button>
                          <button onClick={() => setModal(client)}
                            style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #d9d1c4', background:'white', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit' }}>
                            Editar
                          </button>
                          <button onClick={() => toggleActive(client.id)}
                            style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${client.active?'#ff8182':'#4ac26b'}`, background:client.active?'#ffebe9':'#dafbe1', cursor:'pointer', fontSize:12, fontWeight:600, color:client.active?'#c0392b':'#2d6e4a', fontFamily:'inherit' }}>
                            {client.active ? 'Bloquear' : 'Ativar'}
                          </button>
                          <button onClick={() => setConfirmDelete(client.id)}
                            style={{ padding:'5px 8px', borderRadius:6, border:'none', background:'transparent', cursor:'pointer', fontSize:14, color:'#9198a1' }}>
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Notes */}
        <p style={{ marginTop:12, fontSize:12, color:'#9198a1', textAlign:'center' }}>
          NutriOPS Admin · {clients.length} cliente{clients.length!==1?'s':''} cadastrado{clients.length!==1?'s':''} · Última atualização: {new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
        </p>
        </>}
      </div>

      {/* Modals */}
      {(modal === 'new' || (modal && modal.id)) && (
        <ClientModal client={modal==='new'?null:modal} onSave={saveClient} onClose={() => setModal(null)} />
      )}
      {tokenModal && (
        <AccessTokenModal
          client={tokenModal}
          onClose={() => setTokenModal(null)}
          onClientUpdate={(updated) => {
            saveClient(updated);
            setTokenModal(updated); // mantém modal aberto com timestamp atualizado
          }}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:24 }}>
          <div style={{ background:'white', borderRadius:14, padding:28, maxWidth:360, width:'100%' }}>
            <h3 style={{ fontSize:16, fontWeight:800, marginBottom:8 }}>Remover cliente?</h3>
            <p style={{ fontSize:14, color:'#6b6760', marginBottom:20 }}>Esta ação não pode ser desfeita. O cliente perderá acesso ao sistema.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid #d9d1c4', background:'white', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit' }}>Cancelar</button>
              <button onClick={() => deleteClient(confirmDelete)} style={{ flex:1, padding:'10px', borderRadius:8, border:'none', background:'#c0392b', color:'white', cursor:'pointer', fontSize:14, fontWeight:700, fontFamily:'inherit' }}>Remover</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
