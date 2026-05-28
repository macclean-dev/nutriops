import React, { lazy, Suspense, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './pages';
// Admin é lazy — só baixa quando o usuário acessa /admin
const AdminPanel = lazy(() => import('./admin').then(m => ({ default: m.AdminPanel })));
const AdminLogin = lazy(() => import('./admin').then(m => ({ default: m.AdminLogin })));
// Utilities pequenas vêm de admin-storage (não puxa o painel pesado)
import { readAdminAuth, clearAdminAuth, readClients } from './admin-storage';
import { readOnboardingTenants, writeOnboardingTenants } from './onboarding-storage';
import { fetchTenantByToken, isTenantSyncEnabled } from './tenant-sync';
import './styles.css';

// Register service worker
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => { setInterval(() => reg.update(), 30 * 60 * 1000); })
      .catch(err => console.warn('[NutriOPS] SW failed:', err));
  });
}

// ─── Token handler ────────────────────────────────────────────────────────

// Converte um cliente do painel admin no shape de tenant operacional usado
// pelo App. Roda no caminho local (admin abriu o link no próprio device) e
// preserva o que o admin já preencheu (segmento, brand, equipamentos).
function buildTenantFromClient(client) {
  if (!client) return null;
  return {
    id: client.id,
    accessToken: client.accessToken,
    name: client.name,
    segment: client.segment,
    plan: client.plan,
    brandColor: client.brandColor ?? '#cc785c',
    brandSoft:  client.brandSoft  ?? 'rgba(204,120,92,.10)',
    equipmentCatalog: client.equipmentCatalog ?? [],
    modules: client.modules ?? [],
    stores: client.stores ?? [],
    setupPinHash: client.setupPinHash ?? null,
    setupPinUsedAt: client.setupPinUsedAt ?? null,
    multiStore: false,
    audit: [], forms: [], alertsList: [],
  };
}

async function handleAccessToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  if (!token) return;

  // Caminho 1 — admin abriu o link no próprio device (tem o cliente no local)
  const clients = readClients();
  const client  = clients.find(c => c.accessToken === token);

  // Caminho 2 — cliente abriu em outro device. Busca no Supabase.
  let remoteTenant = null;
  if (!client && isTenantSyncEnabled()) {
    console.info('[NutriOPS] token não encontrado no localStorage; consultando Supabase…');
    const result = await fetchTenantByToken(token);
    if (result.ok) {
      remoteTenant = result.tenant;
      console.info(`[NutriOPS] tenant ${remoteTenant.id} (${remoteTenant.name}) carregado do Supabase`);
    } else {
      console.warn('[NutriOPS] tenant não encontrado:', result.reason);
    }
  }

  if (!client && !remoteTenant) {
    // Token inválido ou Supabase off. Não bloqueamos a app — só não popula
    // nada. O App() detecta a falta de tenant e mostra erro adequado.
    return;
  }

  if (client && !client.active) {
    alert('Esta conta está inativa. Entre em contato com o suporte NutriOPS.');
    return;
  }

  // Token + identidade básica no localStorage pro App() reconhecer o contexto
  localStorage.setItem('nutriops.access.token', token);
  localStorage.setItem('nutriops.access.clientId',   (client?.id   ?? remoteTenant?.id)   ?? '');
  localStorage.setItem('nutriops.access.clientName', (client?.name ?? remoteTenant?.name) ?? '');

  // Hidrata tenant operacional no localStorage. Pages.jsx lê
  // `nutriops.onboarding.tenants` no boot — populando aqui, o cliente já entra
  // com o tenant pré-configurado pelo admin (sem precisar do wizard).
  // Cloud (remoteTenant) tem prioridade sobre local — assim mudanças do admin
  // se propagam quando o cliente reabre o link.
  const tenantToHydrate = remoteTenant ?? (client ? buildTenantFromClient(client) : null);
  if (tenantToHydrate?.setupPinHash) {
    const existing = readOnboardingTenants() ?? [];
    const others = existing.filter(t => t.id !== tenantToHydrate.id);
    writeOnboardingTenants([tenantToHydrate, ...others]);
  }

  // Auto-configurar Supabase dedicado se o cliente tem config (Enterprise)
  if (client?.supabase?.url && client?.supabase?.anonKey) {
    const existing = JSON.parse(localStorage.getItem('nutriops.supabase.config') ?? 'null');
    const tenantConfig = {
      url: client.supabase.url,
      anonKey: client.supabase.anonKey,
      enabled: true,
      source: 'tenant',
      syncedAt: new Date().toISOString(),
    };
    if (!existing || existing.url !== tenantConfig.url || existing.anonKey !== tenantConfig.anonKey) {
      localStorage.setItem('nutriops.supabase.config', JSON.stringify(tenantConfig));
      console.info('[NutriOPS] Supabase auto-configurado a partir do token do cliente');
    }
  }

  // Clean URL without reload
  window.history.replaceState({}, '', '/');
}

// ─── Dark mode ────────────────────────────────────────────────────────────

const DARK_KEY = 'nutriops.dark.mode';
function initDarkMode() {
  const saved = localStorage.getItem(DARK_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved !== null ? saved === 'true' : prefersDark;
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
}
initDarkMode();

// ─── Root ─────────────────────────────────────────────────────────────────

function Root() {
  const isAdmin = window.location.pathname === '/admin' || window.location.hash === '#admin';
  const [adminAuthed, setAdminAuthed] = useState(() => Boolean(readAdminAuth()?.loggedIn));
  // Token resolution pode envolver fetch ao Supabase — bloqueia a renderização
  // do App até concluir (ou falhar) pra evitar flash de OnboardingWizard
  // antes do tenant chegar.
  const hasToken = new URLSearchParams(window.location.search).has('token');
  const [tokenResolved, setTokenResolved] = useState(!hasToken);

  useEffect(() => {
    if (!hasToken) return;
    handleAccessToken().finally(() => setTokenResolved(true));
  }, [hasToken]);

  if (isAdmin) {
    const adminFallback = (
      <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#181715', color:'#9b9590', fontFamily:'system-ui, sans-serif' }}>
        Carregando painel admin…
      </div>
    );
    if (!adminAuthed) return (
      <Suspense fallback={adminFallback}>
        <AdminLogin onLogin={() => setAdminAuthed(true)} />
      </Suspense>
    );
    return (
      <Suspense fallback={adminFallback}>
        <AdminPanel onExit={() => { clearAdminAuth(); setAdminAuthed(false); window.location.href = '/'; }} />
      </Suspense>
    );
  }

  if (!tokenResolved) {
    return (
      <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#faf9f5', color:'#6b6760', fontFamily:'system-ui, sans-serif', fontSize:14 }}>
        Carregando seu acesso…
      </div>
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><Root /></React.StrictMode>
);
