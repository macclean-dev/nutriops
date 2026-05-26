// Storage helpers do painel admin — extraídos pra um arquivo leve, pra que
// main.jsx e trial.jsx possam ler `nutriops.admin.clients` sem puxar todo o
// admin.jsx (que tem o painel pesado).

const CLIENTS_KEY = 'nutriops.admin.clients';
const ADMIN_KEY   = 'nutriops.admin.auth';

const ls = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const lw = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function readClients()    { return ls(CLIENTS_KEY, []); }
export function writeClients(v)  { lw(CLIENTS_KEY, v); }
export function readAdminAuth()  { return ls(ADMIN_KEY, null); }
export function writeAdminAuth(v){ lw(ADMIN_KEY, v); }
export function clearAdminAuth() { try { localStorage.removeItem(ADMIN_KEY); } catch {} }
