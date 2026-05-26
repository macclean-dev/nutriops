import React, { lazy, Suspense, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './pages';
// Admin é lazy — só baixa quando o usuário acessa /admin
const AdminPanel = lazy(() => import('./admin').then(m => ({ default: m.AdminPanel })));
const AdminLogin = lazy(() => import('./admin').then(m => ({ default: m.AdminLogin })));
// Utilities pequenas vêm de admin-storage (não puxa o painel pesado)
import { readAdminAuth, clearAdminAuth, readClients } from './admin-storage';
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

function handleAccessToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  if (!token) return;

  // Find client with this token in admin panel data
  const clients = readClients();
  const client  = clients.find(c => c.accessToken === token);

  if (!client) return;
  if (!client.active) {
    alert('Esta conta está inativa. Entre em contato com o suporte NutriOPS.');
    return;
  }

  // Store token so app knows who this is
  localStorage.setItem('nutriops.access.token', token);
  localStorage.setItem('nutriops.access.clientId', client.id);
  localStorage.setItem('nutriops.access.clientName', client.name);

  // Auto-configurar Supabase se o cliente tem config no record do admin.
  // Isso elimina "modo local por device" — qualquer aparelho que abrir o
  // link já entra com sync ligado.
  if (client.supabase?.url && client.supabase?.anonKey) {
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

  useEffect(() => { handleAccessToken(); }, []);

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

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><Root /></React.StrictMode>
);
