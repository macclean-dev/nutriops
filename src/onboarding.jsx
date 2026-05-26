import React, { useState } from 'react';
import { saveCompanyProfile } from './pages';
import { sendWelcomeEmail, sendAdminNotification } from './email';
import { BrandLockup } from './brand';
import { readOnboardingTenants, writeOnboardingTenants, clearOnboardingTenants } from './onboarding-storage';

// Re-export pra manter API antiga (pages.jsx ainda importa daqui).
// Imports leves devem usar ./onboarding-storage diretamente pra evitar puxar
// o wizard inteiro no boot.
export { readOnboardingTenants, writeOnboardingTenants };
export const clearOnboarding = clearOnboardingTenants;

function uid() { return crypto.randomUUID().slice(0, 8); }

// ─── Segment options ───────────────────────────────────────────────────────

const SEGMENTS = [
  { id: 'padaria',      label: 'Padaria',                icon: '🍞' },
  { id: 'confeitaria',  label: 'Confeitaria',            icon: '🎂' },
  { id: 'restaurante',  label: 'Restaurante',            icon: '🍽️' },
  { id: 'lanchonete',   label: 'Lanchonete / Fast food', icon: '🍔' },
  { id: 'cafeteria',    label: 'Cafeteria',              icon: '☕' },
  { id: 'producao',     label: 'Produção de alimentos',  icon: '🏭' },
  { id: 'catering',     label: 'Catering / Eventos',     icon: '🥗' },
  { id: 'outro',        label: 'Outro',                  icon: '📋' },
];

const DEFAULT_EQUIPMENT = {
  padaria:     ['Câmara Refrigerada', 'Câmara Congelada', 'Vitrine Refrigerada', 'Balcão Refrigerado'],
  confeitaria: ['Freezer', 'Refrigerador', 'Vitrine Refrigerada', 'Cervejeiro'],
  restaurante: ['Câmara Fria', 'Freezer', 'Refrigerador de Saladas', 'Balcão Refrigerado'],
  lanchonete:  ['Freezer', 'Refrigerador', 'Balcão Refrigerado', 'Estufa Quente'],
  cafeteria:   ['Refrigerador', 'Vitrine Refrigerada', 'Freezer'],
  producao:    ['Câmara Refrigerada', 'Câmara Congelada', 'Refrigerador', 'Freezer'],
  catering:    ['Câmara Fria', 'Freezer', 'Refrigerador', 'Caixa Térmica'],
  outro:       ['Refrigerador', 'Freezer'],
};

const BRAND_COLORS = [
  '#cc785c','#2d6e4a','#b91c1c','#d4a017','#7c3aed','#0891b2','#be185d','#ea580c',
];

// ─── Step indicators ───────────────────────────────────────────────────────

function StepBar({ step, total }) {
  return (
    <div style={{ display:'flex', gap:6, marginBottom:28 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{ flex:1, height:4, borderRadius:2, background: i <= step ? 'var(--blue)' : 'var(--border)', transition:'background .3s' }} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING WIZARD
// ═══════════════════════════════════════════════════════════════════════════

export function OnboardingWizard({ onComplete, onHaveAccount }) {
  // Pre-fill company name from access token if available
  const tokenClientName = localStorage.getItem('nutriops.access.clientName') ?? '';

  const [step, setStep] = useState(0);
  const [companyName, setCompanyName]   = useState(tokenClientName);
  const [segment, setSegment]           = useState('');
  const [brandColor, setBrandColor]     = useState(BRAND_COLORS[0]);

  // Company profile (legal data)
  const [razaoSocial, setRazaoSocial]   = useState('');
  const [cnpj, setCnpj]                 = useState('');
  const [endereco, setEndereco]         = useState('');
  const [telefone, setTelefone]         = useState('');

  // RT info
  const [rtNome, setRtNome]             = useState('');
  const [rtCrn, setRtCrn]              = useState('');

  // Equipment
  const [equipments, setEquipments]     = useState([]);
  const [customEquip, setCustomEquip]   = useState('');

  // Admin user
  const [adminName, setAdminName]       = useState('');
  const [adminEmail, setAdminEmail]     = useState('');
  const [adminPin, setAdminPin]         = useState('');
  const [adminPin2, setAdminPin2]       = useState('');
  const [pinError, setPinError]         = useState('');

  const TOTAL_STEPS = 5;

  // When segment changes, pre-fill equipment list
  const handleSegment = (seg) => {
    setSegment(seg);
    setEquipments(DEFAULT_EQUIPMENT[seg] ?? []);
  };

  const toggleEquip = (label) => {
    setEquipments(prev => prev.includes(label) ? prev.filter(e => e !== label) : [...prev, label]);
  };

  const addCustomEquip = () => {
    const t = customEquip.trim();
    if (t && !equipments.includes(t)) { setEquipments(prev => [...prev, t]); }
    setCustomEquip('');
  };

  const handleFinish = () => {
    if (adminPin !== adminPin2) { setPinError('Os PINs não coincidem.'); return; }
    if (adminPin.length < 4)    { setPinError('PIN deve ter pelo menos 4 dígitos.'); return; }
    setPinError('');

    const tenantId = `tenant-${uid()}`;

    // Build tenant object
    const newTenant = {
      id: tenantId,
      name: companyName.trim(),
      segment: SEGMENTS.find(s => s.id === segment)?.label ?? segment,
      plan: 'Pro',
      brandColor,
      brandSoft: `${brandColor}22`,
      localityType: segment === 'producao' ? 'Produção' : 'Loja',
      multiStore: false,
      stores: [{ id: `${tenantId}-main`, name: `${companyName.trim()} — Principal`, location: 'Principal' }],
      equipmentCatalog: equipments.map(label => ({
        label,
        aliases: [label.toLowerCase()],
        location: 'Unidade principal',
      })),
      usersList: [
        {
          name: adminName.trim(),
          role: 'Administrador',
          status: 'Ativo',
          location: companyName.trim(),
          storeId: `${tenantId}-main`,
          pin: adminPin,
        },
      ],
      modules: ['Temperatura', 'Higiene Pessoal', 'Vetores e Pragas', 'Faxina'],
      audit: [], forms: [], alertsList: [],
    };

    // Save company profile
    saveCompanyProfile(tenantId, {
      razaoSocial: razaoSocial.trim() || companyName.trim(),
      cnpj: cnpj.trim(),
      endereco: endereco.trim(),
      telefone: telefone.trim(),
      rtNome: rtNome.trim(),
      rtCrn: rtCrn.trim(),
      atividade: SEGMENTS.find(s => s.id === segment)?.label ?? segment,
    });

    // Persist tenant list
    writeOnboardingTenants([newTenant]);

    const email = adminEmail.trim();

    // Send emails (non-blocking)
    const accessUrl = `https://nutriops.uniwares.net?token=${newTenant.id}`;
    sendWelcomeEmail({
      companyName:  companyName.trim(),
      contactEmail: email,
      accessUrl,
      plan: 'Trial — 14 dias',
    }).catch(() => {});

    sendAdminNotification({
      companyName:  companyName.trim(),
      contactEmail: email,
      plan: 'Trial',
      accessToken:  newTenant.id,
    }).catch(() => {});

    onComplete([newTenant]);
  };

  const canNext = [
    companyName.trim().length >= 2 && segment,
    true, // legal data optional
    equipments.length > 0,
    rtNome.trim().length >= 2,
    adminName.trim().length >= 2 && adminPin.length >= 4 && adminEmail.includes('@'),
  ][step];

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'var(--bg)', padding:24 }}>
      <div style={{ width:'100%', maxWidth:520, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:20, padding:'36px 40px', boxShadow:'0 8px 32px rgba(0,0,0,.1)' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:28 }}>
          <BrandLockup size="sm" theme="light" idPrefix="onb" showSub={false} />
          <span style={{ fontSize:12, color:'var(--text-secondary)', letterSpacing:'.06em', textTransform:'uppercase' }}>Passo {step+1} de {TOTAL_STEPS}</span>
        </div>

        <StepBar step={step} total={TOTAL_STEPS} />

        {/* ── Step 0: Company basics ── */}
        {step === 0 && (
          <div>
            <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Bem-vindo ao NutriOPS!</h2>
            <p style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:24 }}>Vamos configurar sua empresa em poucos passos.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                Nome do estabelecimento
                <input value={companyName} onChange={e=>setCompanyName(e.target.value)}
                  placeholder="Ex.: Padaria Bella, Restaurante do João" autoFocus />
              </label>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--text-secondary)', marginBottom:8 }}>Tipo de estabelecimento</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {SEGMENTS.map(s => (
                    <button key={s.id} onClick={() => handleSegment(s.id)}
                      style={{ padding:'10px 12px', borderRadius:10, border:`1.5px solid ${segment===s.id?'var(--blue-border)':'var(--border)'}`, background:segment===s.id?'var(--blue-light)':'white', cursor:'pointer', textAlign:'left', fontFamily:'var(--font)', display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:18 }}>{s.icon}</span>
                      <span style={{ fontSize:13, fontWeight:segment===s.id?700:500, color:segment===s.id?'var(--blue)':'var(--text)' }}>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--text-secondary)', marginBottom:8 }}>Cor da marca</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {BRAND_COLORS.map(c => (
                    <button key={c} onClick={() => setBrandColor(c)}
                      style={{ width:32, height:32, borderRadius:8, background:c, border:`3px solid ${brandColor===c?'var(--text)':'transparent'}`, cursor:'pointer', transition:'transform .1s', transform:brandColor===c?'scale(1.15)':'scale(1)' }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 1: Legal data ── */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Dados do estabelecimento</h2>
            <p style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:24 }}>Estes dados aparecem em todos os PDFs gerados. Exigidos pela RDC 216/2004. <strong>Pode pular e preencher depois.</strong></p>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                Razão social
                <input value={razaoSocial} onChange={e=>setRazaoSocial(e.target.value)} placeholder={companyName} />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                CNPJ
                <input value={cnpj} onChange={e=>setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                Endereço completo
                <input value={endereco} onChange={e=>setEndereco(e.target.value)} placeholder="Rua, nº, Bairro, Cidade - UF" />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                Telefone
                <input value={telefone} onChange={e=>setTelefone(e.target.value)} placeholder="(00) 9xxxx-xxxx" />
              </label>
            </div>
          </div>
        )}

        {/* ── Step 2: Equipment ── */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Equipamentos</h2>
            <p style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:20 }}>Selecione os equipamentos que precisam de controle de temperatura na sua unidade.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
              {(DEFAULT_EQUIPMENT[segment] ?? DEFAULT_EQUIPMENT.outro).map(eq => {
                const sel = equipments.includes(eq);
                return (
                  <div key={eq} onClick={() => toggleEquip(eq)}
                    style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderRadius:10, border:`1.5px solid ${sel?'var(--blue-border)':'var(--border)'}`, background:sel?'var(--blue-light)':'white', cursor:'pointer' }}>
                    <span style={{ fontSize:14, fontWeight:sel?700:500, color:sel?'var(--blue)':'var(--text)' }}>{eq}</span>
                    <span style={{ width:20, height:20, borderRadius:4, border:`2px solid ${sel?'var(--blue)':'var(--border)'}`, background:sel?'var(--blue)':'white', display:'grid', placeItems:'center', flexShrink:0 }}>
                      {sel && <span style={{ color:'white', fontSize:11, fontWeight:800 }}>✓</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input value={customEquip} onChange={e=>setCustomEquip(e.target.value)} placeholder="Adicionar equipamento personalizado…"
                onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();addCustomEquip();}}}
                style={{ flex:1 }} />
              <button onClick={addCustomEquip} style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'var(--font)', whiteSpace:'nowrap' }}>+ Adicionar</button>
            </div>
            {equipments.filter(e => !(DEFAULT_EQUIPMENT[segment]??[]).includes(e)).map(eq => (
              <div key={eq} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', marginTop:8, borderRadius:10, border:'1.5px solid var(--green-border)', background:'var(--green-light)' }}>
                <span style={{ fontSize:14, fontWeight:600, color:'var(--green)' }}>{eq}</span>
                <button onClick={() => setEquipments(prev=>prev.filter(e=>e!==eq))} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--red)', fontSize:16 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* ── Step 3: RT info ── */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Responsável Técnico</h2>
            <p style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:24 }}>A nutricionista RT que assina os documentos e valida as planilhas.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                Nome completo da RT
                <input value={rtNome} onChange={e=>setRtNome(e.target.value)} placeholder="Ex.: Dra. Maria Silva" autoFocus />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                CRN (Conselho Regional de Nutricionistas)
                <input value={rtCrn} onChange={e=>setRtCrn(e.target.value)} placeholder="Ex.: CRN-1 12345" />
              </label>
              <div style={{ padding:'12px 14px', background:'var(--blue-light)', border:'1px solid var(--blue-border)', borderRadius:10, fontSize:13, color:'var(--blue)' }}>
                ℹ️ Esses dados aparecem em todos os certificados, planilhas e relatórios para fiscalização.
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Admin user ── */}
        {step === 4 && (
          <div>
            <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.04em', marginBottom:6 }}>Criar conta de administrador</h2>
            <p style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:24 }}>O administrador gerencia usuários, equipamentos e configurações.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                Seu nome
                <input value={adminName} onChange={e=>setAdminName(e.target.value)} placeholder="Nome completo" autoFocus />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                Seu e-mail
                <input type="email" value={adminEmail} onChange={e=>setAdminEmail(e.target.value)} placeholder="seu@email.com.br" />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                PIN de acesso (4-6 dígitos)
                <input type="password" inputMode="numeric" maxLength={6} value={adminPin}
                  onChange={e=>setAdminPin(e.target.value.replace(/\D/g,''))}
                  placeholder="••••" style={{ letterSpacing:'0.3em', textAlign:'center', fontFamily:'var(--mono)', fontSize:20 }} />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>
                Confirmar PIN
                <input type="password" inputMode="numeric" maxLength={6} value={adminPin2}
                  onChange={e=>{ setAdminPin2(e.target.value.replace(/\D/g,'')); setPinError(''); }}
                  placeholder="••••" style={{ letterSpacing:'0.3em', textAlign:'center', fontFamily:'var(--mono)', fontSize:20 }}
                  onKeyDown={e=>{ if(e.key==='Enter'&&canNext) handleFinish(); }} />
              </label>
              {pinError && <div style={{ padding:'8px 12px', background:'var(--red-light)', border:'1px solid var(--red-border)', borderRadius:8, color:'var(--red)', fontSize:13, fontWeight:600 }}>{pinError}</div>}
              <div style={{ padding:'12px 14px', background:'var(--green-light)', border:'1px solid var(--green-border)', borderRadius:10, fontSize:13, color:'var(--green)' }}>
                🎉 Quase lá! Você receberá um e-mail de boas-vindas com seu link de acesso.
              </div>
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        <div style={{ display:'flex', gap:10, marginTop:28 }}>
          {step > 0 && (
            <button onClick={() => setStep(s=>s-1)}
              style={{ padding:'10px 18px', borderRadius:10, border:'1px solid var(--border)', background:'white', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'var(--font)' }}>
              ← Voltar
            </button>
          )}
          {step === 1 && (
            <button onClick={() => setStep(s=>s+1)}
              style={{ padding:'10px 18px', borderRadius:10, border:'1px solid var(--border)', background:'white', cursor:'pointer', fontSize:14, fontWeight:500, fontFamily:'var(--font)', color:'var(--text-secondary)' }}>
              Pular
            </button>
          )}
          <button onClick={() => step < TOTAL_STEPS-1 ? setStep(s=>s+1) : handleFinish()}
            disabled={!canNext}
            style={{ flex:1, padding:'11px', borderRadius:10, border:'none', background:canNext?'var(--blue)':'var(--border)', color:'white', fontSize:15, fontWeight:700, cursor:canNext?'pointer':'not-allowed', fontFamily:'var(--font)', transition:'background .15s' }}>
            {step < TOTAL_STEPS-1 ? 'Continuar →' : '🚀 Criar minha conta'}
          </button>
        </div>

        {onHaveAccount && (
          <div style={{ marginTop:16, textAlign:'center' }}>
            <button onClick={onHaveAccount}
              style={{ background:'none', border:'none', fontSize:12, color:'var(--text-secondary)', cursor:'pointer', textDecoration:'underline', fontFamily:'var(--font)' }}>
              Já tenho uma conta → Fazer login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
