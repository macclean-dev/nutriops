import React, { useEffect, useMemo, useState } from 'react';
import { getAllUsageStats, saveSupabaseConfig, isSupabaseEnabled } from './repository';
import { isGlobalAdmin } from './permissions';
import { BrandLockup, APP_VERSION } from './brand';
import { readClients, writeClients, readAdminAuth, writeAdminAuth, clearAdminAuth } from './admin-storage';
import { sendWelcomeEmail, sendAccessGrantedEmail } from './email';
import { tenantsBase } from './tenants-public';
import { resolveLimits as resolveLimitsCat, resolveTone as resolveToneCat } from './limits';
import { hashPin, generateSetupPin, generateInitialPassword } from './crypto';
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
  { id:'loja',       label:'Loja',       color:'#00684a', days:null, price:149,  maxUsers:15, description:'1 unidade — R$149/mês' },
  { id:'rede',       label:'Rede',       color:'#00a35c', days:null, price:349,  maxUsers:999,description:'Até 3 unidades — R$349/mês' },
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

// Senha do painel admin. Em produção SERIA injetada via Vercel env var
// VITE_ADMIN_PASSWORD — mas em 30/05 a env não chegava no build do Vercel
// (SB_* funcionam, essa não; investigação inconclusiva). Hoje cai no
// fallback abaixo. Item PARQUEADO de propósito: a senha aqui é extraível
// do bundle de qualquer forma — o fix real é o épico de Auth (role de
// admin validada no servidor). Ver docs/AUTH_RLS_PLAN.md.
const ENV_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;
const FALLBACK_PASSWORD = 'nutriops@admin2026';
const ADMIN_PASSWORD = ENV_PASSWORD || FALLBACK_PASSWORD;
if (!ENV_PASSWORD && import.meta.env.PROD) {
  console.warn('[NutriOPS] VITE_ADMIN_PASSWORD ausente no build — /admin usando fallback público. Configure a env var no Vercel (Production).');
}

// Build de PROD (com env do Supabase) → login real via Supabase Auth, só admin
// global entra (fecha o backdoor da VITE_ADMIN_PASSWORD). Build sem env (dev
// local) → fallback de senha, pra não travar o desenvolvimento.
const BUILD_HAS_SUPABASE = Boolean(import.meta.env.VITE_SB_URL && import.meta.env.VITE_SB_ANON_KEY);

export function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pw, setPw]       = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  const handle = async () => {
    setError('');
    if (BUILD_HAS_SUPABASE) {
      setBusy(true);
      try {
        // O /admin pode ser aberto num browser que nunca usou o app →
        // getSupabaseConfig vazio. Semeia a config do env de build antes do login.
        if (!isSupabaseEnabled()) {
          saveSupabaseConfig({
            url: import.meta.env.VITE_SB_URL, anonKey: import.meta.env.VITE_SB_ANON_KEY,
            enabled: true, source: 'tenant', syncedAt: new Date().toISOString(),
          });
        }
        const auth = await import('./auth');
        const session = await auth.signIn({ email: email.trim(), password: pw });
        // Só o admin GLOBAL (sem tenantId) entra no painel — não um admin de loja.
        if (!isGlobalAdmin(session)) {
          await auth.signOut();
          setError('Esta conta não tem permissão de admin global.');
          setBusy(false);
          return;
        }
        writeAdminAuth({ loggedIn: true, at: new Date().toISOString(), email: session?.user?.email ?? null });
        onLogin();
      } catch (e) {
        setError(e?.message ?? 'Falha no login.');
      }
      setBusy(false);
      return;
    }
    // DEV (sem Supabase no build) — fallback de senha
    if (pw === ADMIN_PASSWORD) {
      writeAdminAuth({ loggedIn: true, at: new Date().toISOString() });
      onLogin();
    } else {
      setError('Senha incorreta.');
    }
  };

  const inputStyle = { background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.1)', borderRadius:8, color:'#f4f7f6', padding:'9px 12px', fontFamily:'inherit', fontSize:14, outline:'none' };

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#00543b', padding:24 }}>
      <div style={{ width:'100%', maxWidth:380, background:'#04303f', border:'1px solid rgba(255,255,255,.07)', borderRadius:16, padding:'36px 40px' }}>
        <div style={{ marginBottom:28 }}>
          <BrandLockup size="lg" idPrefix="admlogin" showSub={false} />
          <div style={{ fontSize:9, color:'rgba(255,255,255,.28)', letterSpacing:'.18em', textTransform:'uppercase', marginTop:8 }}>
            Painel admin · v{APP_VERSION}
          </div>
        </div>
        <h2 style={{ fontSize:20, fontWeight:700, color:'#f4f7f6', marginBottom:6, fontFamily:'var(--serif)' }}>Painel administrativo</h2>
        <p style={{ fontSize:13, color:'#a8b3bc', marginBottom:24 }}>
          {BUILD_HAS_SUPABASE ? 'Entre com a conta de administrador global (e-mail e senha).' : 'Acesso restrito à equipe NutriOPS.'}
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {BUILD_HAS_SUPABASE && (
            <label style={{ fontSize:12, fontWeight:600, color:'#a8b3bc', display:'flex', flexDirection:'column', gap:5 }}>
              E-mail
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') handle(); }} placeholder="admin@nutriops" autoFocus
                style={inputStyle} />
            </label>
          )}
          <label style={{ fontSize:12, fontWeight:600, color:'#a8b3bc', display:'flex', flexDirection:'column', gap:5 }}>
            {BUILD_HAS_SUPABASE ? 'Senha' : 'Senha de acesso'}
            <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') handle(); }}
              placeholder="••••••••"
              style={inputStyle} />
          </label>
          {error && <div style={{ color:'#e85d52', fontSize:13 }}>{error}</div>}
          <button onClick={handle} disabled={busy} style={{ padding:'10px', background:'var(--primary,#00684a)', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor: busy?'wait':'pointer', opacity: busy?0.7:1, fontFamily:'inherit' }}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CLIENT FORM MODAL ─────────────────────────────────────────────────────

export function ClientModal({ client, onSave, onClose }) {
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
  // Credenciais de e-mail do cliente novo (21/08) — ver criarContaDoCliente.
  const [novaConta, setNovaConta] = useState(null);
  // E-mail da nutricionista RT (21/08). O cadastro criava conta só pro DONO, e
  // a RT — que é figura obrigatória da RDC 216 e existe em toda loja — ficava
  // de fora, exigindo um segundo passo manual em Equipe → Usuários pra cada
  // cliente novo. Opcional de propósito: nem toda loja contrata a RT junto com
  // a abertura, e travar o cadastro por isso seria pior.
  const [rtEmail, setRtEmail] = useState('');
  const [regenerate, setRegenerate]     = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [pushError, setPushError]       = useState('');
  // Salvar sem PIN novo e sem falha de push fechava na hora — pixel a pixel
  // igual a apertar Cancelar/✕. Quando o campo editado não muda coluna
  // nenhuma da tabela (telefone, CNPJ, responsável, observações,
  // faturamento), não sobrava NENHUM sinal de que gravou (achado da
  // auditoria de 18/08, T2). Mostra "✓ Salvo" um instante — busy continua
  // true, então os botões ficam travados — e só então fecha sozinho.
  const [savedFlash, setSavedFlash]     = useState(false);
  // id/accessToken viram estado (gerados 1x por montagem do modal), não mais
  // recalculados a cada handleSave: se o push falhar (sessão expirada,
  // Supabase fora do ar) e o admin clicar "Criar cliente" de novo NO MESMO
  // modal — que fica aberto de propósito quando pushFailed, ver abaixo —, o
  // retry reusa o MESMO id/token em vez de cunhar outro uid(). Sem isso a 2ª
  // tentativa bem-sucedida nascia como tenant IRMÃO (id/token/PIN novos), não
  // substituía a 1ª, e o registro fantasma (só local, nunca chegou na nuvem)
  // ficava pra sempre na tabela sem nenhuma marca de qual era o real (achado
  // da auditoria de 19/08, alta — "Repetir Criar cliente depois de push falho
  // gera OUTRO id + OUTRO token + OUTRO PIN").
  const [id]           = useState(() => client?.id ?? uid());
  const [accessToken]  = useState(() => client?.accessToken ?? `nt_${uid()}${uid()}`);

  const trialEndsAt  = plan === 'trial' && !editing
    ? new Date(Date.now() + 14 * 86400000).toISOString()
    : client?.trialEndsAt;

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) return;
    setBusy(true);
    setPushError('');

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
      brandColor: client?.brandColor ?? '#00684a',
      brandSoft:  client?.brandSoft  ?? 'rgba(0,163,92,.10)',
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
    let pushFailed = false;
    if (isTenantSyncEnabled()) {
      const result = await pushTenant(tenantPayload);
      if (!result.ok) {
        pushFailed = true;
        setPushError(result.reason === 'no-session'
          ? 'Sua sessão de administrador expirou. O cliente foi salvo só neste dispositivo e NÃO subiu pro servidor — entre de novo e use "Editar (regerar PIN)" pra concluir o cadastro.'
          : `Cliente não subiu pro servidor (${result.reason}). Ficou salvo só neste dispositivo — use "Editar (regerar PIN)" pra tentar de novo.`);
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
      // Acompanha o REGISTRO (não só o estado local do modal): a próxima
      // sessão que abrir o AccessTokenModal pra este cliente — mesmo depois
      // de fechar/recarregar — precisa saber que o último push falhou (achado
      // da auditoria de 19/08, alta — "o registro não guarda que o push
      // falhou"). false quando o push deu certo OU quando o sync está
      // desligado neste build (modo local por device, estado normal — não é
      // falha pra avisar).
      pushFailed,
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

    // ── Conta de e-mail do cliente ────────────────────────────────────────
    // ISTO É O QUE FALTAVA (21/08). Até aqui o cadastro só gerava um setup PIN,
    // e o cliente entrava pelo SetupPinScreen — que cria sessão LOCAL, sem
    // accessToken. Sem token, `sbHeaders` (repository.js) manda a chave
    // ANÔNIMA, e o RLS recusa tudo com 42501: o cliente nascia sem sincronizar
    // NADA, em silêncio, e só descobriria quando fosse buscar a evidência pro
    // fiscal. O PIN é modelo aposentado desde a v1.9.99 — o cadastro tinha
    // ficado pra trás.
    //
    // Agora usa o MESMO caminho que já funciona no convite de colaborador
    // (Equipe → Usuários): a Edge Function cria a conta no Supabase Auth e
    // vincula em `tenant_members`. Se o e-mail já existe (dono de outra
    // unidade, RT que cobre várias), cai pro vínculo — sem criar conta
    // duplicada, que dividiria os registros da pessoa entre dois logins.
    // A RT entra junto quando informada — ela é figura obrigatória da RDC 216 e
    // sem isso cada cliente novo exigia um segundo passo manual. Sequencial e
    // não Promise.all: as duas chamadas batem na MESMA Edge Function e podem
    // tocar a mesma conta (dono e RT com o mesmo e-mail, que acontece em loja
    // pequena) — em paralelo isso vira corrida no upsert de tenant_members.
    let contas = [];
    if (isNew && !pushFailed) {
      const dono = await criarContaDoCliente({ tenantId: id, email: email.trim(), nome: contact.trim() || name.trim(), papel: 'tenant_admin' });
      contas.push({ ...dono, rotulo: 'Dono da loja' });
      const rt = rtEmail.trim();
      // Mesmo e-mail nos dois campos: não chama de novo. A segunda chamada
      // rebaixaria o dono pra 'Nutricionista RT' (o upsert faz
      // `do update set role`), tirando dele o poder de administrar a própria
      // loja — sem nenhum aviso.
      if (rt && rt.toLowerCase() !== email.trim().toLowerCase()) {
        const contaRt = await criarContaDoCliente({ tenantId: id, email: rt, nome: 'Nutricionista RT', papel: 'Nutricionista RT' });
        contas.push({ ...contaRt, rotulo: 'Nutricionista RT' });
      }
    }
    const conta = contas.length ? { ok: contas.every(c => c.ok), contas } : null;

    if (pushFailed) {
      // NÃO entrega link+PIN de um cliente que não chegou na nuvem: o cliente
      // abriria o ?token= e receberia "not-found". Mantém o modal aberto com o
      // erro à vista pro admin corrigir a sessão e regerar o PIN.
      setBusy(false);
      setRegenerate(false);
    } else if (conta?.ok) {
      // Conta criada/vinculada: o cliente entra por e-mail e senha, e o PIN
      // vira irrelevante. Mostra as credenciais uma vez só.
      setBusy(false);
      setNovaConta(conta);
      setRegenerate(false);
    } else if (setupPinPlain) {
      // A conta NÃO pôde ser criada (Edge Function fora do ar, e-mail
      // recusado, sessão de admin expirada). O cliente já existe local e na
      // nuvem, então cai pro PIN como plano B — mas o admin precisa saber que
      // o acesso por e-mail ficou faltando, senão manda só o link e o cliente
      // entra num modo que não sincroniza. Silenciar aqui recriaria em uma
      // linha o bug que este commit existe pra matar.
      if (conta && !conta.ok) {
        const falhas = (conta.contas ?? []).filter(c => !c.ok).map(c => `${c.rotulo}: ${c.erro}`).join(' · ');
        setPushError(`O cliente foi criado, mas não consegui criar a(s) conta(s) de e-mail (${falhas}). `
          + `Ele vai entrar pelo PIN abaixo, que é o modo antigo e NÃO sincroniza com a nuvem. `
          + `Abra "Editar" e salve de novo pra tentar criar a conta, ou crie por Equipe → Usuários dentro da empresa.`);
      }
      // Não fecha o modal — admin precisa copiar o PIN antes
      setBusy(false);
      setGeneratedPin(setupPinPlain);
      setRegenerate(false);
    } else {
      // Ver comentário do savedFlash acima: fecha com atraso, não na hora,
      // pra deixar visível que Salvar != Cancelar.
      setSavedFlash(true);
      setTimeout(() => onClose(), 900);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:24 }}>
      <div style={{ position:'relative', background:'white', borderRadius:16, padding:28, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ fontSize:18, fontWeight:800 }}>{editing ? 'Editar cliente' : 'Novo cliente'}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#5c6c7a' }}>✕</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
              Nome do estabelecimento *
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Padaria Bella" style={inputStyle} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
              CNPJ
              <input value={cnpj} onChange={e=>setCnpj(e.target.value)} placeholder="00.000.000/0000-00" style={inputStyle} />
            </label>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
              E-mail de contato *
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="contato@empresa.com" style={inputStyle} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
              Telefone / WhatsApp
              <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(00) 9xxxx-xxxx" style={inputStyle} />
            </label>
          </div>
          {!editing && (
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
              E-mail da nutricionista RT (opcional)
              <input type="email" value={rtEmail} onChange={e=>setRtEmail(e.target.value)} placeholder="nutricionista@empresa.com" style={inputStyle} />
              <span style={{ fontSize:11, fontWeight:400, color:'#5c6c7a' }}>
                Cria o acesso dela junto com o do dono. Se ela já atende outra loja no NutriOPS,
                usa o mesmo e-mail — a conta é vinculada, não duplicada, e ela troca de empresa dentro do app.
                Pode deixar em branco e cadastrar depois em Equipe → Usuários.
              </span>
            </label>
          )}
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
            Responsável pelo contrato
            <input value={contact} onChange={e=>setContact(e.target.value)} placeholder="Nome do responsável" style={inputStyle} />
          </label>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
            Segmento {!editing && '(define equipamentos seed)'}
            <select value={segment} onChange={e=>setSegment(e.target.value)} style={inputStyle}>
              {SEGMENTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'#5c6c7a', marginBottom:8 }}>Plano</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {PLANS.map(p => (
                <button key={p.id} onClick={() => setPlan(p.id)}
                  style={{ padding:'10px 12px', borderRadius:8, border:`1.5px solid ${plan===p.id?p.color:'#c1ccd6'}`, background:plan===p.id?`${p.color}15`:'white', cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:plan===p.id?p.color:'#001e2b' }}>{p.label}</div>
                  <div style={{ fontSize:11, color:'#5c6c7a' }}>{p.description}</div>
                </button>
              ))}
            </div>
          </div>
          {plan !== 'trial' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
                Dia de vencimento
                <select value={billingDay} onChange={e=>setBillingDay(e.target.value)} style={inputStyle}>
                  {[1,5,10,15,20,25].map(d=><option key={d} value={d}>Dia {d}</option>)}
                </select>
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
                Status do pagamento
                <select value={billingStatus} onChange={e=>setBillingStatus(e.target.value)} style={inputStyle}>
                  <option value="ok">Em dia</option>
                  <option value="overdue">Atrasado</option>
                  <option value="pending">Pendente</option>
                </select>
              </label>
            </div>
          )}
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
            Observações internas
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notas sobre o cliente, histórico, etc." style={{ ...inputStyle, minHeight:64, resize:'vertical' }} />
          </label>
          <label style={{ display:'flex', flexDirection:'row', alignItems:'center', gap:10, cursor:'pointer', fontSize:13, fontWeight:600 }}>
            <input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} style={{ width:16, height:16, accentColor:'#00684a' }} />
            Acesso ativo
          </label>

          {/* PIN de configuração — só editing (no novo o PIN é gerado no Save) */}
          {editing && (
            <div style={{ padding:'10px 14px', background:'#f9fbfa', border:'1px solid #e1e5e8', borderRadius:8 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'#5c6c7a', marginBottom:6 }}>
                PIN de configuração
              </div>
              {client?.setupPinHash ? (
                <p style={{ fontSize:12, color:'#5c6c7a', margin:'0 0 8px', lineHeight:1.5 }}>
                  {client?.setupPinGeneratedAt
                    ? <>Último gerado em <strong>{fmtDT(client.setupPinGeneratedAt)}</strong>. </>
                    : null}
                  Regenere se o cliente esqueceu o PIN ou se quiser invalidar o anterior.
                </p>
              ) : (
                <p style={{ fontSize:12, color:'#5c6c7a', margin:'0 0 8px', lineHeight:1.5 }}>
                  Cliente ainda não tem PIN de configuração. Gere um agora pra ele conseguir entrar.
                </p>
              )}
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, color:'#00684a' }}>
                <input type="checkbox" checked={regenerate} onChange={e=>setRegenerate(e.target.checked)} style={{ accentColor:'#00684a' }} />
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
          <div style={{ borderTop:'1px solid #e1e5e8', paddingTop:14, marginTop:4 }}>
            <button type="button" onClick={() => setShowSync(s => !s)}
              style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:600, color:'#5c6c7a', display:'flex', alignItems:'center', gap:6, padding:0, letterSpacing:'.06em', textTransform:'uppercase' }}>
              <span style={{ transition:'transform .15s', transform: showSync ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
              Servidor dedicado (Enterprise — avançado)
            </button>
            {showSync && (
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:10, padding:'12px 14px', background:'#f9fbfa', border:'1px solid #e1e5e8', borderRadius:8 }}>
                <p style={{ fontSize:11, color:'#5c6c7a', margin:0, lineHeight:1.5 }}>
                  <strong>Use só pra clientes Enterprise que pediram banco isolado.</strong><br/>
                  Por padrão, todos os clientes usam o Supabase compartilhado do NutriOPS
                  (já configurado via env vars no Vercel — funciona automaticamente).
                  Preencha aqui só se esse cliente vai ter o próprio Supabase project.
                </p>
                <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
                  Supabase URL
                  <input value={sbUrl} onChange={e=>setSbUrl(e.target.value)}
                    placeholder="https://xxxxx.supabase.co" style={inputStyle} />
                </label>
                <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'#5c6c7a' }}>
                  Supabase anon key
                  <input value={sbKey} onChange={e=>setSbKey(e.target.value)} type="password"
                    placeholder="eyJhbGciOi..." style={inputStyle} />
                </label>
                <p style={{ fontSize:11, color:'#5c6c7a', margin:0 }}>
                  Encontre em: Supabase → Project Settings → API.
                </p>
              </div>
            )}
          </div>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          <button onClick={onClose} disabled={busy} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid #c1ccd6', background:'white', cursor:busy?'wait':'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit', opacity:busy?0.6:1 }}>Cancelar</button>
          <button onClick={handleSave} disabled={!name.trim()||!email.trim()||busy}
            style={{ flex:2, padding:'10px', borderRadius:8, border:'none', background:((name.trim()&&email.trim()&&!busy)||savedFlash)?'#00684a':'#c1ccd6', color:'white', cursor:(name.trim()&&email.trim()&&!busy)?'pointer':'not-allowed', fontSize:14, fontWeight:700, fontFamily:'inherit' }}>
            {savedFlash ? '✓ Salvo' : busy ? 'Salvando…' : (editing ? 'Salvar alterações' : 'Criar cliente')}
          </button>
        </div>

        {/* Overlay de credenciais — bloqueia fechar até o admin copiar.
            Conta criada vence o PIN: o cliente entra por e-mail/senha e nunca
            precisa do ?token=. O PIN só aparece quando a conta NÃO pôde ser
            criada (plano B), com o motivo à vista. */}
        {novaConta && (
          <CredenciaisReveal conta={novaConta} onAck={() => { setNovaConta(null); onClose(); }} />
        )}
        {!novaConta && generatedPin && (
          <SetupPinReveal pin={generatedPin} onAck={() => { setGeneratedPin(null); onClose(); }} />
        )}
      </div>
    </div>
  );
}

// Credenciais do cliente novo, mostradas UMA vez (a senha não persiste em
// lugar nenhum — só o hash, no Supabase Auth). Substitui o SetupPinReveal no
// caminho feliz.
function CredenciaisReveal({ conta, onAck }) {
  const [copiado, setCopiado] = useState(false);
  const [falhou, setFalhou]   = useState(false);
  const contas = conta?.contas ?? [];

  // Um bloco por pessoa. Conta VINCULADA não ganha senha: quem já usava o
  // NutriOPS continua com a dela, e imprimir "senha inicial" ali faria o admin
  // mandar uma senha que não existe.
  const linha = (c) => c.senha
    ? `${c.rotulo}\n  E-mail: ${c.email}\n  Senha inicial: ${c.senha}`
    : `${c.rotulo}\n  E-mail: ${c.email}\n  Senha: a que ela já usa hoje`;
  const texto = [`NutriOPS — acesso`, `Site: https://nutriops.uniwares.net`, '', ...contas.map(linha)].join('\n');

  // Mesma guarda do SetupPinReveal: sem Clipboard API (contexto inseguro,
  // webview antiga) ou write rejeitado, o catch vazio comeria o erro e o admin
  // mandaria pro cliente o conteúdo ANTIGO do clipboard. Os dados grandes
  // acima são o fallback manual — a falha só precisa ficar visível.
  const copiar = () => {
    if (!navigator.clipboard?.writeText) { setFalhou(true); setTimeout(() => setFalhou(false), 4000); return; }
    navigator.clipboard.writeText(texto)
      .then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); })
      .catch(() => { setFalhou(true); setTimeout(() => setFalhou(false), 4000); });
  };

  const temSenha = contas.some((c) => c.senha);
  return (
    <div style={{ position:'absolute', inset:0, background:'rgba(20,20,19,.85)', borderRadius:16, display:'flex', alignItems:'center', justifyContent:'center', padding:24, overflowY:'auto' }}>
      <div style={{ background:'white', borderRadius:14, padding:'28px 32px', maxWidth:440, width:'100%', boxShadow:'0 12px 40px rgba(0,0,0,.4)' }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'#5c6c7a', marginBottom:8, textAlign:'center' }}>
          Acesso do cliente
        </div>
        <h3 style={{ fontFamily:'var(--serif, serif)', fontSize:20, fontWeight:400, margin:'0 0 4px', color:'#001e2b', letterSpacing:'-.02em', textAlign:'center' }}>
          {temSenha ? 'Copie agora — a senha não será mostrada de novo' : 'Contas vinculadas'}
        </h3>

        {contas.map((c) => (
          <div key={c.rotulo} style={{ margin:'14px 0', padding:'14px 16px', background:'#f9fbfa', border:'1px dashed #c1ccd6', borderRadius:10 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:'#00684a', marginBottom:6 }}>
              {c.rotulo}{c.vinculada ? ' · já tinha conta' : ''}
            </div>
            <div style={{ fontSize:11, color:'#5c6c7a', fontWeight:600 }}>E-mail</div>
            <div style={{ fontFamily:'monospace', fontSize:13, color:'#001e2b', wordBreak:'break-all', marginBottom:8 }}>{c.email}</div>
            <div style={{ fontSize:11, color:'#5c6c7a', fontWeight:600 }}>Senha inicial</div>
            <div style={{ fontFamily:'monospace', fontSize: c.senha ? 20 : 13, fontWeight: c.senha ? 700 : 400, color: c.senha ? '#00684a' : '#5c6c7a', letterSpacing: c.senha ? '.08em' : 0 }}>
              {c.senha ?? 'a que ela já usa hoje'}
            </div>
          </div>
        ))}

        <p style={{ fontSize:12, color:'#5c6c7a', lineHeight:1.5, margin:'0 0 18px' }}>
          {temSenha
            ? <>Mande as senhas por <strong>canal separado</strong> do e-mail (WhatsApp, SMS ou ligação). Cada um entra com o próprio e-mail e pode trocar a senha depois em Configurações.</>
            : 'Quem já tinha conta entra com o mesmo login de sempre e troca de empresa dentro do app — não crie uma segunda conta pra mesma pessoa.'}
        </p>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={copiar} style={{ flex:1, padding:'10px', borderRadius:8, border:`1px solid ${falhou?'#c0392b':'#00684a'}`, background:'white', color:falhou?'#c0392b':'#00684a', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            {copiado ? '✓ Copiado' : falhou ? '✕ Falha — copie manualmente' : 'Copiar acesso'}
          </button>
          <button onClick={onAck} style={{ flex:1, padding:'10px', borderRadius:8, border:'none', background:'#00684a', color:'white', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            Já copiei
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Conta de e-mail do cliente novo ───────────────────────────────────────
// Cria a conta do dono da loja no Supabase Auth e vincula em `tenant_members`,
// pelo MESMO caminho do convite de colaborador (Equipe → Usuários) — Edge
// Function `invite-collaborator`, que guarda a service_role no servidor.
//
// NUNCA lança: o cliente já está salvo local e na nuvem quando isto roda, e
// derrubar o cadastro inteiro porque a criação de conta falhou seria pior que
// o problema. Devolve `{ ok:false, erro }` e o modal cai pro PIN como plano B,
// mostrando o motivo — o admin conserta pelo Editar depois.
async function criarContaDoCliente({ tenantId, email, nome, papel = 'tenant_admin' }) {
  const senha = generateInitialPassword();
  try {
    const { inviteCollaborator } = await import('./auth');
    await inviteCollaborator({ email, name: nome, role: papel, tenantId, password: senha });
    return { ok: true, email, senha, vinculada: false };
  } catch (e) {
    // 409 da Edge Function: "Já existe uma conta com esse e-mail." Acontece de
    // verdade — dono que já tem outra unidade, RT que cobre várias lojas. Aí o
    // certo é VINCULAR a conta existente, nunca criar uma segunda: duas contas
    // pra mesma pessoa dividem os registros dela na trilha de auditoria.
    const jaExiste = /já existe|already|exist|registered/i.test(String(e?.message ?? ''));
    if (!jaExiste) return { ok: false, erro: e?.message ?? 'erro ao criar conta' };
    try {
      const { linkExistingMember } = await import('./tenant-sync');
      await linkExistingMember({ tenantId, email, role: papel });
      return { ok: true, email, senha: null, vinculada: true };
    } catch (e2) {
      return { ok: false, erro: e2?.message ?? 'erro ao vincular conta existente' };
    }
  }
}

function SetupPinReveal({ pin, onAck }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // Mesmo defeito do "Copiar SQL" (settings.jsx, achado da auditoria de
  // 18/08, T3): sem Clipboard API (contexto inseguro, webview antiga) ou
  // write rejeitado (permissão negada) o catch vazio comia o erro — o botão
  // continuava "Copiar PIN" sem nenhum aviso, e este é o ÚNICO momento em que
  // o PIN existe em claro (só o hash persiste depois de fechar). O PIN grande
  // acima do botão continua sendo o fallback manual — a falha só precisa
  // ficar visível pra avisar que é ELE que precisa ser copiado à mão.
  const handleCopy = () => {
    if (!navigator.clipboard?.writeText) {
      setCopyFailed(true); setTimeout(() => setCopyFailed(false), 4000);
      return;
    }
    navigator.clipboard.writeText(pin)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => { setCopyFailed(true); setTimeout(() => setCopyFailed(false), 4000); });
  };
  return (
    <div style={{ position:'absolute', inset:0, background:'rgba(20,20,19,.85)', borderRadius:16, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'white', borderRadius:14, padding:'28px 32px', maxWidth:360, width:'100%', textAlign:'center', boxShadow:'0 12px 40px rgba(0,0,0,.4)' }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'#5c6c7a', marginBottom:8 }}>
          PIN de configuração
        </div>
        <h3 style={{ fontFamily:'var(--serif, serif)', fontSize:20, fontWeight:400, margin:'0 0 10px', color:'#001e2b', letterSpacing:'-.02em' }}>
          Copie agora — não será mostrado de novo
        </h3>
        <div style={{
          margin:'18px 0',
          padding:'16px 0',
          fontFamily:'monospace',
          fontSize:48,
          letterSpacing:'.3em',
          fontWeight:700,
          color:'#00684a',
          background:'#f9fbfa',
          border:'1px dashed #c1ccd6',
          borderRadius:10,
        }}>
          {pin}
        </div>
        <p style={{ fontSize:12, color:'#5c6c7a', lineHeight:1.5, margin:'0 0 18px' }}>
          Envie esse PIN ao cliente por <strong>canal separado</strong> do link de acesso
          (WhatsApp, SMS ou ligação — nunca pelo mesmo e-mail).
          Ele expira após o 1º uso e bloqueia após 3 tentativas erradas.
        </p>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={handleCopy} style={{ flex:1, padding:'10px', borderRadius:8, border:`1px solid ${copyFailed?'#c0392b':'#00684a'}`, background:'white', color:copyFailed?'#c0392b':'#00684a', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            {copied ? '✓ Copiado' : copyFailed ? '✕ Falha — copie manualmente' : 'Copiar PIN'}
          </button>
          <button onClick={onAck} style={{ flex:1, padding:'10px', borderRadius:8, border:'none', background:'#00684a', color:'white', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            Já copiei
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding:'8px 10px', borderRadius:8, border:'1px solid #c1ccd6', fontSize:14, fontFamily:'inherit', outline:'none', background:'white', width:'100%' };

// ─── ACCESS TOKEN MODAL ────────────────────────────────────────────────────

export function AccessTokenModal({ client, onClose, onClientUpdate }) {
  // { field: 'url'|'token'|null, status: 'copied'|'failed'|null } — antes era
  // um único `copied` boolean compartilhado pelos dois botões ("Copiar link"
  // e "Só token"): clicar em "Só token" acendia "Copiado" no botão VIZINHO
  // (o rótulo de "Só token" era string fixa, nunca refletia estado nenhum),
  // então quem clicava nele via o feedback errado acender e concluía ter
  // copiado o que não copiou. E `copy` não tinha try/catch nem checagem da
  // Clipboard API: falha (documento sem foco, permissão negada, contexto
  // inseguro) virava unhandled rejection muda — nenhum dos dois rótulos
  // mudava, e quem colava em seguida mandava o conteúdo ANTIGO do
  // clipboard pro cliente (achados baixa 19/08, T2+T3). Campo próprio por
  // botão + guarda de falha, mesmo padrão que o SetupPinReveal já usa.
  const [copyState, setCopyState] = useState({ field: null, status: null });
  const [emailState, setEmailState] = useState('idle'); // idle | sending | sent | error
  const [emailMsg, setEmailMsg] = useState('');
  const url = `https://nutriops.uniwares.net?token=${client.accessToken}`;
  // Guarda compartilhada por /admin E Super Admin (este modal é reusado pelos
  // dois — superadmin-view.jsx importa direto daqui). Se o ClientModal.
  // handleSave que criou/editou este cliente teve o push pro Supabase
  // recusado (sessão de admin expirada, Supabase fora do ar), o registro
  // nunca chegou na tabela `tenants`: o link ?token= devolveria "not-found" e
  // o PIN mostrado aqui nunca existiu de verdade no servidor. Sem essa
  // checagem os dois callers mostravam "PIN de configuração ativo" e
  // liberavam o envio como se estivesse tudo certo (achados da auditoria de
  // 19/08, alta — superadmin-view.jsx entrega link+PIN de cliente que não
  // subiu, e admin.jsx não guardava que o push tinha falhado).
  const notSynced = client.pushFailed === true;

  const copy = (text, field) => {
    if (!navigator.clipboard?.writeText) {
      setCopyState({ field, status: 'failed' });
      setTimeout(() => setCopyState({ field: null, status: null }), 4000);
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopyState({ field, status: 'copied' });
        setTimeout(() => setCopyState({ field: null, status: null }), 2000);
      })
      .catch(() => {
        setCopyState({ field, status: 'failed' });
        setTimeout(() => setCopyState({ field: null, status: null }), 4000);
      });
  };

  const handleSendEmail = async () => {
    if (notSynced) {
      setEmailState('error');
      setEmailMsg('Não dá pra enviar: este cadastro não chegou no servidor (push falhou). Edite o cliente com a sessão de admin ativa pra tentar de novo antes de enviar o link.');
      return;
    }
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
        <p style={{ fontSize:13, color:'#5c6c7a', marginBottom:16 }}>
          Esse link abre o NutriOPS já configurado pra conta desse cliente.
          {client.welcomeEmailSentAt && (
            <> Último envio: <strong>{new Date(client.welcomeEmailSentAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</strong>.</>
          )}
        </p>
        <div style={{ background:'#f9fbfa', border:'1px solid #c1ccd6', borderRadius:8, padding:'12px 14px', fontFamily:'monospace', fontSize:12, wordBreak:'break-all', marginBottom:12, color:'#001e2b' }}>
          {url}
        </div>

        {/* Status do setup PIN */}
        <div style={{
          padding:'10px 14px', marginBottom:16, borderRadius:8,
          background: notSynced ? '#fdecea' : client.setupPinHash ? '#e3fcef' : '#fdf6e8',
          border: `1px solid ${notSynced ? '#c0392b33' : client.setupPinHash ? '#00a35c33' : '#8a4e0033'}`,
          fontSize:12, color: notSynced ? '#c0392b' : client.setupPinHash ? '#00a35c' : '#8a4e00',
        }}>
          {notSynced ? (
            <>
              <strong>Não sincronizado com o servidor.</strong> O último salvamento deste cliente
              não chegou na nuvem (sessão de admin expirada ou Supabase fora do ar) — o link abaixo
              ainda não funciona em outro dispositivo, e o PIN gerado nunca existiu de verdade no
              servidor. Edite o cliente com a sessão de admin ativa pra tentar salvar de novo antes
              de enviar.
            </>
          ) : client.setupPinHash ? (
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
            background: emailState === 'sent' ? '#e3fcef' : emailState === 'error' ? '#fdecea' : '#fdf6e8',
            color:     emailState === 'sent' ? '#00a35c' : emailState === 'error' ? '#c0392b' : '#8a4e00',
            border: `1px solid ${emailState === 'sent' ? '#00a35c' : emailState === 'error' ? '#c0392b' : '#8a4e00'}33`,
          }}>
            {emailMsg}
          </div>
        )}

        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={handleSendEmail} disabled={emailState==='sending' || notSynced}
            title={notSynced ? 'Bloqueado: este cadastro não chegou no servidor ainda.' : undefined}
            style={{ flex:'2 1 200px', padding:'10px', borderRadius:8, border:'none',
              background: notSynced ? '#c1ccd6' : emailState==='sending' ? '#a8b3bc' : '#00684a',
              color:'white', cursor: notSynced ? 'not-allowed' : emailState==='sending' ? 'wait' : 'pointer',
              fontSize:14, fontWeight:600, fontFamily:'inherit' }}>
            {emailState==='sending' ? 'Enviando...' :
             client.welcomeEmailSentAt ? `Reenviar link pro e-mail` : `Enviar link por e-mail`}
          </button>
          <button onClick={() => copy(url, 'url')}
            style={{ flex:'1 1 120px', padding:'10px', borderRadius:8,
              border:`1px solid ${copyState.field==='url' && copyState.status==='failed' ? '#c0392b' : '#c1ccd6'}`,
              background:'white', color: copyState.field==='url' && copyState.status==='failed' ? '#c0392b' : undefined,
              cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
            {copyState.field==='url' && copyState.status==='copied' ? 'Copiado'
              : copyState.field==='url' && copyState.status==='failed' ? 'Falha — copie manualmente'
              : 'Copiar link'}
          </button>
          <button onClick={() => copy(client.accessToken, 'token')}
            style={{ flex:'1 1 100px', padding:'10px', borderRadius:8,
              border:`1px solid ${copyState.field==='token' && copyState.status==='failed' ? '#c0392b' : '#c1ccd6'}`,
              background:'white', color: copyState.field==='token' && copyState.status==='failed' ? '#c0392b' : undefined,
              cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
            {copyState.field==='token' && copyState.status==='copied' ? 'Copiado'
              : copyState.field==='token' && copyState.status==='failed' ? 'Falha — copie manualmente'
              : 'Só token'}
          </button>
          <button onClick={onClose}
            style={{ flex:'0 0 auto', padding:'10px 14px', borderRadius:8, border:'1px solid #c1ccd6',
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

// HealthView cross-tenant sob RLS: o admin NÃO tem bypass nas policies, então lê
// os registros recentes de todos os tenants por um RPC security-definer (gated
// por app_metadata.role='admin'), usando o JWT do admin logado. Fallback pro
// fetch direto (anon) enquanto o RPC não existe / RLS off — rollout sem quebra.
async function fetchAdminRecentTemps(sinceIso) {
  try {
    const { getValidAccessToken } = await import('./auth');
    const token = await getValidAccessToken();
    if (token) {
      const res = await fetch(`${SB_URL.replace(/\/$/, '')}/rest/v1/rpc/admin_recent_temperature_records`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_since: sinceIso }),
      });
      if (res.status !== 404) { // 404 = RPC ainda não criado → cai no fallback
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`);
        return res.json();
      }
    }
  } catch (e) {
    console.debug('[admin] RPC health indisponível, tentando fetch direto:', e?.message ?? e);
  }
  // Fallback: fetch direto (anon) — só funciona com RLS off
  return fetchSupabase('temperature_records', `created_at=gte.${sinceIso}&order=created_at.desc&limit=5000`);
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
      background:'white', border:'1px solid #c1ccd6', borderRadius:12,
      padding:'18px 22px', marginBottom:16,
      borderLeft:`4px solid ${dangerCount > 0 ? '#c0392b' : '#8a4e00'}`,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:12 }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'#5c6c7a' }}>
            Atenção operacional
          </div>
          <h3 style={{ fontFamily:'Times-Roman, serif', fontSize:22, fontWeight:400, margin:'2px 0 0', letterSpacing:'-.02em', color:'#001e2b' }}>
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
                <div style={{ fontSize:13, fontWeight:600, color:'#001e2b' }}>{a.label}</div>
                {a.hint && (
                  <div style={{ fontSize:11, color:'#5c6c7a', marginTop:2 }}>{a.hint}</div>
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
    ok:'#00a35c', warn:'#8a4e00', danger:'#c0392b', neutral:'#a8b3bc',
  })[t];

  const syncTone = metrics.recordsLast7d > 0 ? 'ok' : metrics.lastActivity ? 'warn' : 'neutral';
  const conformityTone = metrics.conformity == null ? 'neutral'
    : metrics.conformity >= 90 ? 'ok'
    : metrics.conformity >= 70 ? 'warn' : 'danger';

  return (
    <div style={{
      background:'white', border:'1px solid #c1ccd6',
      borderRadius:12, padding:'20px 22px',
      borderTop:`3px solid ${tenant.brandColor || '#00684a'}`,
      display:'flex', flexDirection:'column', gap:12,
    }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'#5c6c7a' }}>
            {tenant.segment || 'unidade'}
          </div>
          <h3 style={{ fontFamily:'Times-Roman, serif', fontSize:22, fontWeight:400, margin:'2px 0 0', color:'#001e2b', letterSpacing:'-.02em' }}>
            {tenant.name}
          </h3>
          {client && (
            <div style={{ fontSize:11, color:'#5c6c7a', marginTop:4 }}>
              {client.plan} · {client.email}
            </div>
          )}
        </div>
        <span style={{
          padding:'4px 10px', borderRadius:20, fontSize:10, fontWeight:600,
          letterSpacing:'.08em', textTransform:'uppercase',
          background: syncTone === 'ok' ? '#e3fcef' : syncTone === 'warn' ? '#fdf6e8' : '#f4f7f6',
          color: toneColor(syncTone),
        }}>
          {syncTone === 'ok' ? 'Ativo' : syncTone === 'warn' ? 'Inativo' : 'Sem dados'}
        </span>
      </div>

      {/* Grid de métricas */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginTop:4 }}>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#5c6c7a' }}>
            Última atividade
          </div>
          <div style={{ fontSize:14, fontWeight:600, color: toneColor(syncTone), marginTop:2 }}>
            {fmtRelative(metrics.lastActivity)}
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#5c6c7a' }}>
            Registros 7d
          </div>
          <div style={{ fontSize:18, fontWeight:600, fontFamily:'Courier-Bold, monospace', color:'#001e2b', marginTop:2 }}>
            {metrics.recordsLast7d}
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#5c6c7a' }}>
            Conformidade
          </div>
          <div style={{ fontSize:18, fontWeight:600, fontFamily:'Courier-Bold, monospace', color: toneColor(conformityTone), marginTop:2 }}>
            {metrics.conformity != null ? `${metrics.conformity}%` : '—'}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, paddingTop:10, borderTop:'1px solid #e1e5e8' }}>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#5c6c7a' }}>
            Usuários ativos
          </div>
          <div style={{ fontSize:14, fontWeight:600, color:'#001e2b', marginTop:2 }}>
            {metrics.activeUsers7d} {metrics.activeUsers7d === 1 ? 'pessoa' : 'pessoas'}
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#5c6c7a' }}>
            Equipamentos
          </div>
          <div style={{ fontSize:14, fontWeight:600, color:'#001e2b', marginTop:2 }}>
            {tenant.equipmentCatalog?.length || 0} cadastrados
          </div>
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#5c6c7a' }}>
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
function HistoryChart({ days, color = '#00684a', maxOverride = null }) {
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

// Chave de dia em horário LOCAL — ver comentário do bucketByDay abaixo.
function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Agrega registros do tenant em buckets diários nos últimos N dias.
// Devolve array [{ date: 'YYYY-MM-DD', count: n }] ordenado cronologicamente.
// Chaveia por data LOCAL, não UTC. created_at vem do Supabase (timestamptz)
// serializado em UTC; a versão antiga fatiava a string ISO direto
// (r.created_at.slice(0,10)), que é sempre data UTC. No Brasil (UTC-3), todo
// registro feito a partir de ~21h local já cai no dia UTC SEGUINTE: pro
// último bucket ("hoje", que é sempre a data local de quem está olhando o
// gráfico) essa chave de amanhã não existe no Map — o registro sumia sem
// nenhum sinal; pros dias do MEIO da janela a chave existe, só que é a
// ERRADA, deslocando o registro um dia pra frente (achado baixa 19/08, T6:
// Bäckerei registrando 22h30, pico da noite não aparecia no dia certo). Ler
// com `new Date(...)` e extrair ano/mês/dia LOCAIS (em vez de fatiar a
// string, que é sempre UTC) alinha bucket e registro na mesma régua.
export function bucketByDay(records, days = 30) {
  const buckets = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Inicializa buckets vazios pra todos os dias do range
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(localDateKey(d), 0);
  }

  for (const r of records) {
    if (!r.created_at) continue;
    const d = new Date(r.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const day = localDateKey(d);
    if (buckets.has(day)) {
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

  const color = tenant.brandColor ?? '#00684a';
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
              <h2 style={{ fontFamily:'Times-Roman, serif', fontSize:22, fontWeight:400, margin:0, letterSpacing:'-.02em', color:'#001e2b' }}>{tenant.name}</h2>
              <div style={{ fontSize:11, color:'#5c6c7a', letterSpacing:'.04em', textTransform:'uppercase' }}>Uso diário · últimos 30 dias</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#5c6c7a', lineHeight:1 }}>✕</button>
        </div>

        {/* Stats agregadas */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10, marginBottom:20 }}>
          {[
            { label:'Total 30d', value:total },
            { label:'Média/dia ativo', value:avg },
            { label:'Dias sem registro', value:zeroDays },
            { label:'Pico', value:busiest?.count ?? 0, sub: busiest && busiest.count > 0 ? fmtDay(busiest.date) : null },
          ].map(s => (
            <div key={s.label} style={{ background:'#f9fbfa', border:'1px solid #eef1f3', borderRadius:10, padding:'10px 12px' }}>
              <div style={{ fontSize:20, fontWeight:600, fontFamily:'monospace', color:'#001e2b', lineHeight:1.1 }}>{s.value}</div>
              <div style={{ fontSize:9, color:'#5c6c7a', letterSpacing:'.08em', textTransform:'uppercase', marginTop:2 }}>{s.label}</div>
              {s.sub && <div style={{ fontSize:10, color:'#a8b3bc', marginTop:1 }}>{s.sub}</div>}
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
                  background: d.count > 0 ? color : '#eef1f3',
                  borderRadius:'3px 3px 0 0', opacity: d.count > 0 ? 1 : .6,
                  transition:'opacity .12s',
                }} />
              </div>
            );
          })}
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'#a8b3bc', letterSpacing:'.04em', marginBottom:20 }}>
          <span>{fmtDay(days[0]?.date)}</span>
          <span>{fmtDay(days[Math.floor(days.length/2)]?.date)}</span>
          <span>hoje</span>
        </div>

        {/* Últimos 7 dias em lista */}
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.10em', textTransform:'uppercase', color:'#5c6c7a', marginBottom:8 }}>Últimos 7 dias</div>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          {recent.map(d => {
            const pct = max > 0 ? (d.count / max) * 100 : 0;
            return (
              <div key={d.date} style={{ display:'grid', gridTemplateColumns:'70px 1fr 36px', alignItems:'center', gap:10, padding:'3px 0' }}>
                <span style={{ fontSize:11, color:'#5c6c7a' }}>{fmtDay(d.date)} <span style={{ color:'#a8b3bc' }}>{weekday(d.date)}</span></span>
                <div style={{ background:'#f4f7f6', borderRadius:4, height:8, overflow:'hidden' }}>
                  <div style={{ width:`${pct}%`, height:'100%', background:color, opacity: d.count>0?1:0, borderRadius:4 }} />
                </div>
                <span style={{ fontSize:12, fontWeight:600, fontFamily:'monospace', color: d.count>0?'#001e2b':'#a8b3bc', textAlign:'right' }}>{d.count}</span>
              </div>
            );
          })}
        </div>

        {metrics && metrics.conformity != null && (
          <div style={{ marginTop:18, paddingTop:14, borderTop:'1px solid #f4f7f6', fontSize:12, color:'#5c6c7a' }}>
            Conformidade recente (7d): <strong style={{ color:'#001e2b' }}>{metrics.conformity}%</strong>
            {' · '}{metrics.activeUsers7d} usuário(s) ativo(s)
            {metrics.nonCompliant > 0 && <> · <span style={{ color:'#c0392b' }}>{metrics.nonCompliant} fora da faixa</span></>}
          </div>
        )}
      </div>
    </div>
  );
}

// Aggregate metrics per tenant a partir dos registros brutos (fetch de 30d).
// recordsLast7d/activeUsers7d/conformity ficam escopados a 7d de propósito —
// é "saúde RECENTE" (comentário original). MAS lastActivity precisa do
// histórico COMPLETO dos 30d buscados: antes ele vinha de dentro do mesmo
// agregado filtrado a 7d, então só existia pra tenant com registro nos
// últimos 7 dias — ou seja, "dias desde a última atividade" nunca podia
// passar de 6~7 na prática. computeTenantAlerts faz `if (!m) continue` e
// calcula a escalada (5d=warn / 10d=danger) a partir de m.lastActivity: com
// lastActivity preso a 7d, a chave do tenant (e o lastActivity junto)
// desaparecia no 8º dia sem registro — ANTES do alerta ter a chance de
// escalar — e o tier "danger" (10d+) ficava estruturalmente inalcançável:
// pra qualquer tenant chegar a 10 dias parado, ele já tinha perdido a
// própria entrada dois dias antes (achado baixa 19/08, T6).
export function buildTenantMetrics(records) {
  const sevenDaysAgoMs = Date.now() - 7 * 86400000;
  const recent = {};          // agregação 7d — igual a antes, pras métricas "recentes"
  const lastActivityByTenant = {}; // MAX de created_at em toda a janela buscada (30d)

  for (const r of records) {
    const tid = r.tenant_id;
    if (!tid) continue;
    if (!lastActivityByTenant[tid] || new Date(r.created_at) > new Date(lastActivityByTenant[tid])) {
      lastActivityByTenant[tid] = r.created_at;
    }
    if (new Date(r.created_at).getTime() < sevenDaysAgoMs) continue;
    if (!recent[tid]) recent[tid] = { records: [], users: new Set() };
    recent[tid].records.push(r);
    if (r.user_name) recent[tid].users.add(r.user_name);
  }

  const final = {};
  const allTenantIds = new Set([...Object.keys(recent), ...Object.keys(lastActivityByTenant)]);
  for (const tid of allTenantIds) {
    const { records: recs = [], users = new Set() } = recent[tid] ?? {};
    const ok = recs.filter(r => {
      const min = r.min_value != null ? r.min_value : resolveLimits(r.equipment_input).min;
      const max = r.max_value != null ? r.max_value : resolveLimits(r.equipment_input).max;
      return resolveTone(r.value, min, max) === 'ok';
    }).length;
    const nonCompliant = recs.filter(r => {
      const min = r.min_value != null ? r.min_value : resolveLimits(r.equipment_input).min;
      const max = r.max_value != null ? r.max_value : resolveLimits(r.equipment_input).max;
      return resolveTone(r.value, min, max) === 'danger';
    }).length;
    final[tid] = {
      recordsLast7d: recs.length,
      activeUsers7d: users.size,
      lastActivity: lastActivityByTenant[tid] ?? null,
      conformity: recs.length > 0 ? Math.round((ok / recs.length) * 100) : null,
      nonCompliant,
    };
  }
  return final;
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
        const data = await fetchAdminRecentTemps(thirtyDaysAgo);
        if (!cancelled) setRecords(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshAt]);

  // Aggregate metrics per tenant — ver comentário de buildTenantMetrics acima.
  const metricsByTenant = useMemo(() => buildTenantMetrics(records), [records]);

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

  // Tenants pra renderizar aqui: os 3 seeds (tenants-public.js) + qualquer
  // cliente criado via "+ Novo cliente" (id de uid(), fora de tenantsBase) que
  // ainda não seja um deles. metricsByTenant/historyByTenant já cobrem TODOS
  // os tenants — a RPC admin_recent_temperature_records devolve registro de
  // qualquer um —, mas os 3 pontos abaixo (alertas, tendência 30d, cards)
  // iteravam só tenantsBase: um cliente novo (ex.: CASA DOCE) podia ficar 30
  // dias sem registrar sem que nenhum alerta de inatividade disparasse e sem
  // aparecer na tendência/cards — só o contador do rodapé (que já usa
  // historyByTenant) o citava, sem dizer qual sumiu (achado da auditoria de
  // 19/08, alta). Mesmo fuzzy-match de nome que findClientForTenant já usa
  // pra anexar dado comercial aos seeds — evita duplicar Swiss/Bäckerei/DBK
  // caso também tenham registro comercial no /admin com id diferente do seed.
  const healthTenants = useMemo(() => {
    const seedNames = tenantsBase.map(t => (t.name ?? '').toLowerCase()).filter(Boolean);
    const matchesSeed = (name) => {
      const n = (name ?? '').toLowerCase();
      return Boolean(n) && seedNames.some(sn => sn.includes(n) || n.includes(sn));
    };
    const clientTenants = (clients ?? [])
      .filter(c => c.id && !matchesSeed(c.name))
      .map(c => ({
        id: c.id,
        name: c.name,
        segment: c.segment,
        brandColor: c.brandColor,
        equipmentCatalog: c.equipmentCatalog,
      }));
    return [...tenantsBase, ...clientTenants];
  }, [clients]);

  // Alertas operacionais — combina métricas do Supabase com config dos clientes
  const alerts = useMemo(
    () => computeTenantAlerts(metricsByTenant, healthTenants, clients),
    [metricsByTenant, healthTenants, clients],
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
          <h2 style={{ fontFamily:'Times-Roman, serif', fontSize:26, fontWeight:400, margin:0, letterSpacing:'-.02em', color:'#001e2b' }}>
            Saúde dos tenants
          </h2>
          <p style={{ fontSize:13, color:'#5c6c7a', margin:'4px 0 0' }}>
            Métricas (7d) e tendência (30d) agregadas direto do Supabase. Atualizado {loading ? '...' : 'agora'}.
          </p>
        </div>
        <button onClick={() => setRefreshAt(t => t+1)} disabled={loading}
          style={{ padding:'8px 14px', borderRadius:8, border:'1px solid #c1ccd6', background:'white', cursor: loading ? 'wait' : 'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit' }}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      <AlertsCard alerts={alerts} onAction={handleAlertAction} />

      {/* Tendência 30 dias — sparkline por tenant pra detectar queda de uso cedo */}
      {Object.keys(historyByTenant).length > 0 && (
        <div style={{
          background:'white', border:'1px solid #c1ccd6', borderRadius:12,
          padding:'18px 22px', marginBottom:16,
        }}>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'#5c6c7a' }}>
              Tendência operacional
            </div>
            <h3 style={{ fontFamily:'Times-Roman, serif', fontSize:22, fontWeight:400, margin:'2px 0 0', letterSpacing:'-.02em', color:'#001e2b' }}>
              Volume de registros — últimos 30 dias
            </h3>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {healthTenants.map(t => {
              const days = historyByTenant[t.id] ?? bucketByDay([], 30);
              const total = days.reduce((sum, d) => sum + d.count, 0);
              const half = Math.floor(days.length / 2);
              const firstHalf  = days.slice(0, half).reduce((s, d) => s + d.count, 0);
              const secondHalf = days.slice(half).reduce((s, d) => s + d.count, 0);
              const delta = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : null;
              const deltaColor = delta == null ? '#a8b3bc'
                : delta >= 10 ? '#00a35c'
                : delta <= -25 ? '#c0392b'
                : delta <= -10 ? '#8a4e00'
                : '#5c6c7a';

              return (
                <button key={t.id}
                  onClick={() => setDrill({ tenant: t, days, metrics: metricsByTenant[t.id] })}
                  title={`Ver uso diário de ${t.name}`}
                  style={{
                    display:'grid', gridTemplateColumns:'minmax(160px, 1.2fr) auto 90px 70px',
                    alignItems:'center', gap:16, width:'100%', textAlign:'left',
                    padding:'8px 6px', margin:'0 -6px', border:'none', background:'none',
                    borderBottom:'1px solid #f4f7f6', cursor:'pointer', borderRadius:6,
                    fontFamily:'inherit', transition:'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9fbfa'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                    <span style={{
                      flexShrink:0, width:8, height:8, borderRadius:'50%',
                      background: t.brandColor ?? '#00684a',
                    }} />
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'#001e2b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {t.name}
                      </div>
                      <div style={{ fontSize:10, color:'#5c6c7a', letterSpacing:'.04em', textTransform:'uppercase' }}>
                        {t.segment ?? 'unidade'}
                      </div>
                    </div>
                  </div>
                  <HistoryChart days={days} color={t.brandColor ?? '#00684a'} />
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:18, fontWeight:600, fontFamily:'monospace', color:'#001e2b', lineHeight:1.1 }}>
                      {total}
                    </div>
                    <div style={{ fontSize:9, color:'#5c6c7a', letterSpacing:'.10em', textTransform:'uppercase' }}>
                      registros
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:13, fontWeight:700, color: deltaColor, lineHeight:1.1 }}>
                      {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`}
                    </div>
                    <div style={{ fontSize:9, color:'#5c6c7a', letterSpacing:'.10em', textTransform:'uppercase' }}>
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
        {healthTenants.map(t => {
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
      <div style={{ marginTop:20, padding:'12px 16px', background:'#f4f7f6', borderRadius:10, fontSize:12, color:'#5c6c7a' }}>
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

// Coluna "Uso" da tabela de clientes — lê getAllUsageStats(), que é
// localStorage NESTE navegador (trackUsage grava no device onde a SESSÃO DA
// LOJA rodou — normalmente o tablet da cozinha, não onde o admin abre o
// painel). Como o /admin roda num browser que nunca teve aquela sessão, a
// chave quase sempre está vazia — e o rótulo antigo era "Sem uso", uma
// afirmação sobre O CLIENTE quando o fato é só "sem dado NESTE navegador".
// A aba Saúde (Supabase, cross-device) é quem tem o dado de verdade — por
// isso já mostra a mesma loja como "Ativo" enquanto aqui dizia "Sem uso"
// (achado da auditoria de 18/08, T6). Pura pra testar sem montar a tabela.
export function describeLocalUsage(u) {
  if (!u) {
    return {
      empty: true,
      label: 'Sem dado local',
      hint: 'Não é o cliente sem uso — é este navegador sem registro dele. Veja a aba "Saúde dos tenants" pro uso real (cross-device).',
    };
  }
  const lastSeen = u.lastSeen ? new Date(u.lastSeen) : null;
  const daysAgo = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 86400000) : null;
  const active7d = Object.keys(u.actions || {}).filter(d => (Date.now() - new Date(d).getTime()) / 86400000 <= 7).length;
  return {
    empty: false,
    label: daysAgo === 0 ? '🟢 Hoje' : daysAgo === 1 ? '🟡 Ontem' : daysAgo != null ? `⚫ ${daysAgo}d atrás` : '—',
    color: daysAgo === 0 ? '#00a35c' : daysAgo != null && daysAgo <= 3 ? '#8a4e00' : '#5c6c7a',
    sub: `${active7d}d ativo nos últ. 7d (neste navegador)`,
    hint: 'Medido só neste navegador. Pro uso real do cliente (todos os devices), veja a aba "Saúde dos tenants".',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════

// Lápides de clientes ocultados no painel. Não é exclusão — ver deleteClient.
const OCULTOS_KEY = 'nutriops.admin.clientes.ocultos';
function lerOcultos() {
  try { const r = localStorage.getItem(OCULTOS_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
function ocultarCliente(id) {
  try {
    const atual = lerOcultos();
    if (!atual.includes(id)) localStorage.setItem(OCULTOS_KEY, JSON.stringify([...atual, id]));
  } catch {}
}

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
  // true quando a hidratação da lista de clientes a partir da nuvem FALHOU
  // (sessão expirada, RPC ausente, rede fora) — distinto de "consultei e a
  // nuvem confirmou zero clientes". Sem isso a tabela caía pro cache local (ou
  // pro estado vazio) em silêncio, e "Nenhum cliente cadastrado ainda" virava
  // uma afirmação sobre a PLATAFORMA quando o que houve foi uma LEITURA que
  // falhou — o caminho de escrita do mesmo painel já avisa direitinho
  // ("Sua sessão de administrador expirou...", pushError acima), só o de
  // leitura ficava mudo (achados da auditoria de 18/08, T7 e T6).
  const [cloudSyncError, setCloudSyncError] = useState(false);
  const usageStats = useMemo(() => getAllUsageStats(), []);

  useEffect(() => { writeClients(clients); }, [clients]);

  // Hidrata a lista da fonte da verdade (Supabase) no load — clientes criados
  // noutro device passam a aparecer aqui. Dev-safe: sem token/RPC → mantém local.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchAllTenantsFromCloud, mergeCloudTenants } = await import('./tenant-sync');
        const cloud = await fetchAllTenantsFromCloud();
        if (cancelled) return;
        if (cloud === null) { setCloudSyncError(true); return; } // falha real — não é "zero clientes"
        setCloudSyncError(false);
        if (!cloud.length) return;
        // Filtra os ocultados ANTES do merge — senão eles voltam por serem
        // "novos" pro merge (não estão na lista local justamente porque foram
        // removidos).
        const ocultos = lerOcultos();
        setClients(prev => mergeCloudTenants(prev, cloud.filter(r => !ocultos.includes(r.id))));
      } catch {
        if (!cancelled) setCloudSyncError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveClient = (client) => {
    setClients(prev => prev.find(c=>c.id===client.id)
      ? prev.map(c=>c.id===client.id?client:c)
      : [...prev, client]);
  };

  // Remover era SÓ local: a linha na tabela `tenants` continuava, e o merge do
  // próximo boot (`mergeCloudTenants`) trazia o cliente de volta — reativado e
  // sem os campos comerciais, que só existem localmente. O modal ainda afirmava
  // "não pode ser desfeita". Achado da auditoria de 18/08.
  //
  // Apagar de verdade na nuvem NÃO é possível hoje e nem seria certo aqui: a
  // tabela `tenants` está deny-all com RLS e só expõe RPCs de leitura/upsert,
  // e os dados do cliente vivem em 20 tabelas por tenant_id. Uma exclusão real
  // é migração + RPC nova, e é decisão do dono, não efeito colateral de um 🗑.
  //
  // Então o botão passa a fazer o que dá pra fazer com honestidade: esconder
  // do painel, de forma que PERSISTA. A lápide sobrevive ao merge.
  const deleteClient = (id) => {
    setClients(prev => prev.filter(c=>c.id!==id));
    ocultarCliente(id);
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
    <div style={{ minHeight:'100vh', background:'var(--bg,#f9fbfa)', fontFamily:'var(--font,"Instrument Sans",system-ui,sans-serif)' }}>
      {/* Header */}
      <div style={{ background:'#00543b', padding:'0 24px', borderBottom:'1px solid rgba(255,255,255,.10)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', height:64 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <BrandLockup size="sm" idPrefix="admhdr" showSub={false} />
            <span style={{ padding:'2px 10px', background:'rgba(0,237,100,.14)', border:'1px solid rgba(0,237,100,.35)', borderRadius:20, fontSize:10, fontWeight:600, color:'#00ed64', letterSpacing:'.12em', textTransform:'uppercase' }}>Admin</span>
          </div>
          <button onClick={onExit} style={{ background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.1)', color:'#a8b3bc', borderRadius:8, padding:'6px 14px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
            Sair do painel
          </button>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:'0 auto', padding:'28px 24px' }}>

        {/* Tabs */}
        <div style={{
          display:'flex', gap:4, padding:4, marginBottom:20,
          background:'#f4f7f6', border:'1px solid #e1e5e8',
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
                  color: isActive ? '#00684a' : '#5c6c7a',
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
        {cloudSyncError && (
          <div style={{ padding:'12px 16px', background:'#fdecea', border:'1px solid #c0392b', borderRadius:10, color:'#c0392b', fontSize:13, marginBottom:16 }}>
            <strong>Não deu pra confirmar a lista de clientes na nuvem.</strong> A tabela abaixo pode
            estar mostrando só o cache deste dispositivo — pode faltar cliente cadastrado em outro
            device, ou sobrar um que foi editado lá. Verifique sua sessão de administrador (pode ter
            expirado) e recarregue a página.
          </div>
        )}
        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:24 }}>
          {[
            { label:'Total de clientes', value:kpis.total,     color:'#001e2b' },
            { label:'Clientes ativos',   value:kpis.active,    color:'#00a35c' },
            { label:'MRR',               value:`R$${kpis.mrr}`, color:'#00684a' },
            { label:'Pagamentos atrasados', value:kpis.overdue, color:kpis.overdue>0?'#c0392b':'#001e2b' },
            { label:'Em trial',          value:kpis.trials,    color:'#8a4e00' },
          ].map(k => (
            <div key={k.label} style={{ background:'white', border:'1px solid #c1ccd6', borderRadius:12, padding:'14px 16px' }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#5c6c7a', marginBottom:4 }}>{k.label}</div>
              <div style={{ fontSize:24, fontWeight:700, letterSpacing:'-.04em', fontFamily:'monospace', color:k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome, e-mail ou CNPJ…"
            style={{ flex:1, minWidth:200, padding:'8px 12px', borderRadius:8, border:'1px solid #c1ccd6', fontSize:14, fontFamily:'inherit', outline:'none', background:'white' }} />
          <select value={filter} onChange={e=>setFilter(e.target.value)}
            style={{ padding:'8px 12px', borderRadius:8, border:'1px solid #c1ccd6', fontSize:14, fontFamily:'inherit', background:'white', cursor:'pointer' }}>
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
            <option value="trial">Em trial</option>
            <option value="overdue">Pagamento atrasado</option>
          </select>
          <button onClick={() => setModal('new')}
            style={{ padding:'8px 18px', background:'#00684a', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
            + Novo cliente
          </button>
        </div>

        {/* Client table */}
        <div style={{ background:'white', border:'1px solid #c1ccd6', borderRadius:12, overflow:'hidden' }}>
          {filtered.length === 0 ? (
            <div style={{ padding:'40px 24px', textAlign:'center', color:'#5c6c7a' }}>
              {clients.length === 0
                ? (cloudSyncError
                    ? 'Não foi possível confirmar a lista de clientes agora — não é o mesmo que "nenhum cadastrado". Veja o aviso acima.'
                    : 'Nenhum cliente cadastrado ainda.')
                : 'Nenhum cliente encontrado.'}
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
              <thead>
                <tr style={{ background:'#f9fbfa', borderBottom:'1px solid #c1ccd6' }}>
                  {['Cliente','Plano','Status','Faturamento','Uso',''].map(h => (
                    <th key={h}
                      title={h === 'Uso' ? 'Medido só neste navegador — não é telemetria do cliente. Veja a aba "Saúde dos tenants" pro uso real.' : undefined}
                      style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#5c6c7a', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(client => {
                  const st      = clientStatus(client);
                  const plan    = PLANS.find(p=>p.id===client.plan);
                  const toneColor = { ok:'#00a35c', warn:'#8a4e00', danger:'#c0392b', neutral:'#5c6c7a' }[st.tone];
                  const toneBg    = { ok:'#dafbe1', warn:'#fdf8e3', danger:'#ffebe9', neutral:'#f9fbfa'  }[st.tone];
                  return (
                    <tr key={client.id} style={{ borderBottom:'1px solid #eaeef2' }}>
                      <td style={{ padding:'12px 16px' }}>
                        <div style={{ fontWeight:700 }}>{client.name}</div>
                        <div style={{ fontSize:12, color:'#5c6c7a' }}>{client.email}</div>
                        {client.contact && <div style={{ fontSize:11, color:'#9198a1' }}>{client.contact}</div>}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:700, background:`${plan?.color}18`, color:plan?.color }}>
                          {plan?.label ?? client.plan}
                        </span>
                        {plan?.price && <div style={{ fontSize:11, color:'#5c6c7a', marginTop:3 }}>R${plan.price}/mês</div>}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:700, background:toneBg, color:toneColor }}>
                          {st.label}
                        </span>
                        {!client.active && <div style={{ fontSize:11, color:'#c0392b', marginTop:3 }}>Acesso bloqueado</div>}
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:12, color:'#5c6c7a' }}>
                        {client.plan === 'trial'
                          ? `Trial até ${fmtDate(client.trialEndsAt)}`
                          : client.billingStatus === 'ok'
                            ? `Vence dia ${client.billingDay}`
                            : <span style={{ color:'#c0392b', fontWeight:600 }}>Pagamento {client.billingStatus==='overdue'?'atrasado':'pendente'}</span>}
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:12, color:'#5c6c7a' }}>
                        {(() => {
                          const info = describeLocalUsage(usageStats[client.id]);
                          if (info.empty) return <span style={{ color:'#9198a1' }} title={info.hint}>{info.label}</span>;
                          return (
                            <div title={info.hint}>
                              <div style={{ fontWeight:600, color: info.color }}>{info.label}</div>
                              <div style={{ fontSize:11, color:'#9198a1' }}>{info.sub}</div>
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                          <button onClick={() => setTokenModal(client)}
                            style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #c1ccd6', background:'white', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit' }}>
                            🔗 Link
                          </button>
                          <button onClick={() => setModal(client)}
                            style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #c1ccd6', background:'white', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit' }}>
                            Editar
                          </button>
                          <button onClick={() => toggleActive(client.id)}
                            style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${client.active?'#ff8182':'#4ac26b'}`, background:client.active?'#ffebe9':'#dafbe1', cursor:'pointer', fontSize:12, fontWeight:600, color:client.active?'#c0392b':'#00a35c', fontFamily:'inherit' }}>
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
          NutriOPS Admin · {clients.length} cliente{clients.length!==1?'s':''} cadastrado{clients.length!==1?'s':''}
          {cloudSyncError ? ' (pode estar desatualizado — falha ao confirmar com a nuvem)' : ''}
          {' '}· Última atualização: {new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
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
            <h3 style={{ fontSize:16, fontWeight:800, marginBottom:8 }}>Ocultar cliente do painel?</h3>
            <p style={{ fontSize:14, color:'#5c6c7a', marginBottom:20 }}>
              Ele sai desta lista e não volta. <strong>Os dados dele não são apagados</strong> e o
              acesso continua funcionando — para cortar o acesso, use “Desativar”.
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid #c1ccd6', background:'white', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit' }}>Cancelar</button>
              <button onClick={() => deleteClient(confirmDelete)} style={{ flex:1, padding:'10px', borderRadius:8, border:'none', background:'#c0392b', color:'white', cursor:'pointer', fontSize:14, fontWeight:700, fontFamily:'inherit' }}>Ocultar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
