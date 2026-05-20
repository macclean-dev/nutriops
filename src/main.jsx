import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './pages';
import { AdminPanel, AdminLogin, readAdminAuth, clearAdminAuth, readClients } from './admin';
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
    if (!adminAuthed) return <AdminLogin onLogin={() => setAdminAuthed(true)} />;
    return <AdminPanel onExit={() => { clearAdminAuth(); setAdminAuthed(false); window.location.href = '/'; }} />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><Root /></React.StrictMode>
);
