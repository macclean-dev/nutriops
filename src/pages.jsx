import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tenants as defaultTenants } from './data';
import { readOnboardingTenants, writeOnboardingTenants } from './onboarding-storage';
import { readAdminAuth, writeAdminAuth, clearAdminAuth, readClients } from './admin-storage';
import { checkTrialStatus, TrialBanner, TrialExpiredScreen } from './trial';
import { trackUsage } from './repository';
import { employeeTrainingStatus } from './training-status';
import { readTurns } from './turns';
import { getTemperatureRepository, getSupabaseConfig, saveSupabaseConfig, isSupabaseEnabled, supabaseRepository, SUPABASE_SQL, getOfflineQueue, syncAllModules, migrateAllToSupabase, pushReceivingRecord, getSyncStatus, pushEquipmentItem, deleteEquipmentItem, syncEquipmentCatalog, getSupabaseAuthError, clearSupabaseAuthError, getStorageFull, clearStorageFull, shouldAutoConfigSupabase, countAllLocalRecords, shouldAutoBackfill, pushCorrectiveAction, syncCorrectiveActions, deleteCorrectiveAction } from './repository';
import { notificarSyncAplicado } from './lista-local';
// Central de Não-Conformidades (item 2 da revisão, 09/08) — puro, sem React;
// `extractNonConformities` (forms.jsx) e os readers de controles especiais
// (controls.jsx/extras.jsx) entram por IMPORT DINÂMICO dentro do próprio
// componente — são chunks pesados de UI que não devem entrar no bundle
// principal só por causa desta tela.
import { actionSourceKey, pendingTemperatureItems, pendingReceivingItems, pendingControlItems, pendingFormItems, excludeWithAction, CONTROL_TYPES } from './nonconformities';
import { getPermissions, canAccess, isGlobalAdmin } from './permissions';
import { useBrowserNotifications } from './notifications';
import { APP_VERSION, NutriMark, BrandLockup } from './brand';
import { getUnseenEntries } from './changelog';
import { resolveLimits as resolveLimitsFromCatalog, resolveTone, resolveRecordTone as resolveTemperatureTone, heuristicLimits, suggestLimits, dedupeCatalog, normalizeEquipmentName, getEquipmentEntry, suspectMissingMinus, parseTemperatura, daysUntil, contarValidadesEmAlerta } from './limits';
import { receivingSuggestedResult } from './verdict';
import { isPlaceholderCatalog } from './segments';

// ─── Lazy view loading ────────────────────────────────────────────────────
// Cada chunk só baixa quando o usuário navega pra view correspondente.
// Mantém as utilities (logSession, printTodayReport) com dynamic import
// inline nos call sites, pra não puxar o módulo inteiro no boot.
const lazyView = (importer, name) => lazy(() => importer().then(m => ({ default: m[name] })));

const OnboardingWizard     = lazyView(() => import('./onboarding'), 'OnboardingWizard');
const AdminPanel           = lazyView(() => import('./admin'),      'AdminPanel');
const AdminLogin           = lazyView(() => import('./admin'),      'AdminLogin');
const FormsView            = lazyView(() => import('./forms'),      'FormsView');
const TrainingView         = lazyView(() => import('./training'),   'TrainingView');
const ReportsView          = lazyView(() => import('./reports'),    'ReportsView');
const DossieView           = lazyView(() => import('./dossie-view'), 'DossieView');
const ReadinessView        = lazyView(() => import('./readiness-view'), 'ReadinessView');
const MaintenanceView      = lazyView(() => import('./maintenance'),'MaintenanceView');
const ValidityStockView    = lazyView(() => import('./validity'),   'ValidityStockView');
const POPsView             = lazyView(() => import('./controls'),   'POPsView');
const OilControlView       = lazyView(() => import('./controls'),   'OilControlView');
const ThawControlView      = lazyView(() => import('./controls'),   'ThawControlView');
const CoolingControlView   = lazyView(() => import('./controls'),   'CoolingControlView');
const ThermalControlView   = lazyView(() => import('./controls'),   'ThermalControlView');
const KioskApp             = lazyView(() => import('./kiosk'),      'KioskApp');
const KioskSetup           = lazyView(() => import('./kiosk'),      'KioskSetup');
const FormKioskApp         = lazyView(() => import('./kiosk'),      'FormKioskApp');
const RTPanelView          = lazyView(() => import('./extras'),     'RTPanelView');
const ProfileView          = lazyView(() => import('./extras'),     'ProfileView');
const GlobalSearch         = lazyView(() => import('./extras'),     'GlobalSearch');
const HandwashView         = lazyView(() => import('./extras'),     'HandwashView');
const MonthlyExportView    = lazyView(() => import('./extras'),     'MonthlyExportView');
const SessionHistoryView   = lazyView(() => import('./extras'),     'SessionHistoryView');
const OverviewV2           = lazyView(() => import('./overview-v2'), 'OverviewV2');
const SetupPinScreen       = lazyView(() => import('./setup-tenant'), 'SetupPinScreen');
const EquipmentDetailModal = lazyView(() => import('./equipment-detail'), 'EquipmentDetailModal');
const LoginScreen          = lazyView(() => import('./login'), 'LoginScreen');
const SettingsView         = lazyView(() => import('./settings'), 'SettingsView');
const SuperAdminView       = lazyView(() => import('./superadmin-view'), 'SuperAdminView');
const SuperAdminGate       = lazyView(() => import('./superadmin-view'), 'SuperAdminGate');
const DashboardView        = lazyView(() => import('./reports-views'), 'DashboardView');
const ChartsView           = lazyView(() => import('./reports-views'), 'ChartsView');
const AuditView            = lazyView(() => import('./reports-views'), 'AuditView');
const TurnsView            = lazyView(() => import('./team-views'), 'TurnsView');
const UsersView            = lazyView(() => import('./team-views'), 'UsersView');

// Re-export pra onboarding.jsx que ainda importa de './pages'
export { readCompanyProfile, saveCompanyProfile } from './settings';

// ─── helpers re-exported from maintenance ──────────────────────────────────
function addDays(iso, days) { const d = new Date(iso || new Date()); d.setDate(d.getDate() + days); return d.toISOString().slice(0,10); }

// Re-export APP_VERSION pra manter a API que extras.jsx já consome.
export { APP_VERSION };

// ─── Tenant resolution ─────────────────────────────────────────────────────
// Use onboarded tenants if available, otherwise fall back to built-in tenants
// Onboarding + seed, NÃO um ou outro. Era `readOnboardingTenants() ?? default`:
// bastava UM tenant salvo no device (link ?token=, onboarding, setup) pra as
// lojas embutidas sumirem inteiras. A Swiss perdia junto duas coisas que só
// existem no seed — `supabase` (as env do build) e `usersList` —, o que
// causava, no mesmo device: "Supabase não configurado" no login e o seletor
// "Quem está registrando?" abrindo VAZIO. Relatado no iPhone em 07/08.
// Onboarding tem precedência por id; o seed completa o resto.
export function mesclaTenants(salvos, seed) {
  if (!Array.isArray(salvos) || salvos.length === 0) return seed;
  const ids = new Set(salvos.map((t) => t.id));
  return [...salvos, ...seed.filter((t) => !ids.has(t.id))];
}
const tenants = mesclaTenants(readOnboardingTenants(), defaultTenants);
const IS_DEMO  = !readOnboardingTenants(); // true when using default data
export const APP_BUILD = '2026.05.19';

// Liga o Supabase a partir das env do build já no carregamento do módulo —
// assim o login por e-mail/senha (admin) aparece ANTES de logar, e os devices
// conectam no 1º boot sem depender de uma sessão prévia. Idempotente
// (shouldAutoConfigSupabase ignora se já configurado). maybeAutoConfigSupabase
// é function declaration (hoisted), então é seguro chamar aqui.
try { maybeAutoConfigSupabase(tenants[0]?.id, tenants); } catch {}

// ─── Temperatura utils ─────────────────────────────────────────────────────

// Wrapper que aceita o catálogo do tenant pra usar min/max cadastrado.
// Sem catálogo, cai na heurística pelo nome (compat com call sites antigos).
function resolveTemperatureLimits(label = '', catalog = null) {
  return resolveLimitsFromCatalog(label, catalog);
}
function formatCompactDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─── Storage helpers ───────────────────────────────────────────────────────

const catalogKey    = (id) => `nutriops.equipment.catalog.${id}`;
const usersKey      = (id) => `nutriops.users.${id}`;
const actionsKey    = (id) => `nutriops.corrective_actions.${id}`;
const SESSION_KEY   = 'nutriops.session';

const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const save = (key, val)      => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

// Alertas de turno + "dar ciência" foram pra ./turn-alerts (Fatia 1 da tela de
// Prontidão, 15/08): a nova view precisa calcular pendência de turno de TODAS
// as lojas visíveis, e ela é lazy — importar daqui seria circular.
import { computeTurnAlerts, dismissAlertId } from './turn-alerts';

const readEquipmentCatalog  = (t)  => dedupeCatalog(load(catalogKey(t.id),  t.equipmentCatalog ?? []));
const writeEquipmentCatalog = (id, v) => save(catalogKey(id), v);
const readUsers             = (t)  => load(usersKey(t.id),    t.usersList ?? []);
const writeUsers            = (id, v) => save(usersKey(id),   v);
const readActions           = (id) => load(actionsKey(id),    []);
const writeActions          = (id, v) => save(actionsKey(id), v);
const readSession           = ()   => load(SESSION_KEY, null);

// PIN overrides — extraídos pra ./pin (testáveis e reutilizáveis)
import { getEffectivePin, hasPinOverride, writePinOverride, isWeakPin } from './pin';
// Matching de nome de usuário — compartilhado com login.jsx (troca de empresa)
import { findUserByName } from './user-match';
// Operador atual — atribuição por pessoa dentro da sessão compartilhada da loja
import { needsOperator, applyOperatorToSession, isStoreAccountSession, readOperator } from './operator';
import { OperatorPicker, OperatorChip } from './operator-picker';
import { readKioskConfig, writeKioskConfig, resolveInitialKioskConfig } from './kiosk-config';

// ─── PDF generator ─────────────────────────────────────────────────────────

function generateAuditHTML(records, tenantName) {
  const date = new Date().toLocaleString('pt-BR'), title = tenantName ? `Auditoria — ${tenantName}` : 'Auditoria — NutriOPS';
  const tl = (r) => { const t = resolveTemperatureTone(r); return t === 'ok' ? 'Conforme' : t === 'warn' ? 'Desvio leve' : 'Fora da faixa'; };
  const rows = records.map((r) => `<tr><td>${formatCompactDateTime(r.createdAt)}</td><td>${r.tenantName ?? ''}</td><td>${r.equipmentInput || r.equipment || ''}</td><td><strong>${r.value}°C</strong></td><td>${r.min ?? '?'}–${r.max ?? '?'}°C</td><td>${r.user ?? ''}<br/><small>${r.role ?? ''}</small></td><td>${tl(r)}</td><td>${r.note || '—'}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${title}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1c2128;padding:24px}h1{font-size:18px;font-weight:800;margin-bottom:4px}.meta{color:#656d76;font-size:10px;margin-bottom:20px}table{width:100%;border-collapse:collapse}th{background:#f6f8fa;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #d0d7de;color:#656d76}td{padding:7px 8px;border-bottom:1px solid #eaeef2;vertical-align:top}tr:last-child td{border-bottom:none}small{font-size:9px;color:#656d76}strong{font-size:12px}@page{size:A4 landscape;margin:14mm}</style>
  </head><body><h1>${title}</h1><p class="meta">Gerado em ${date} · ${records.length} registros · RDC 216/2004 · NutriOPS</p>
  <table><thead><tr><th>Data/Hora</th><th>Empresa</th><th>Equipamento</th><th>Temp.</th><th>Faixa</th><th>Responsável</th><th>Status</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// VIEWS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Mobile Bottom Nav ─────────────────────────────────────────────────────

function BottomNav({ activeView, setActiveView, session, alertCount, actionCount }) {
  // `hoje` muda quando a aba volta a ficar visível — sem isso o badge
  // calculava uma vez por troca de tenant e congelava: quem deixava o app
  // aberto de um dia pro outro via a mesma contagem, mesmo com produto tendo
  // vencido enquanto isso. Achado da auditoria (18/08).
  const [hoje, setHoje] = useState(() => new Date().toDateString());
  useEffect(() => {
    const atualizar = () => { if (document.visibilityState === 'visible') setHoje(new Date().toDateString()); };
    document.addEventListener('visibilitychange', atualizar);
    window.addEventListener('focus', atualizar);
    return () => { document.removeEventListener('visibilitychange', atualizar); window.removeEventListener('focus', atualizar); };
  }, []);

  const validityAlertCount = useMemo(() => {
    try {
      const tenantId = session?.tenantId;
      if (!tenantId) return 0;
      const products = JSON.parse(localStorage.getItem(`nutriops.products.${tenantId}`) ?? '[]');
      return contarValidadesEmAlerta(products);
    } catch { return 0; }
  }, [session?.tenantId, hoje]);

  const items = [
    { key: 'overview',  iconId: 'overview',  label: 'Início',    badge: 0 },
    { key: 'forms',     iconId: 'forms',     label: 'BPF',       badge: 0 },
    { key: 'validity',  iconId: 'validity',  label: 'Validades', badge: validityAlertCount },
    { key: 'alerts',    iconId: 'alerts',    label: 'Alertas',   badge: alertCount },
    { key: 'dashboard', iconId: 'dashboard', label: 'Relatório', badge: 0 },
  ].filter(item => canAccess(session?.user?.role, item.key));

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        {items.slice(0, 5).map(item => (
          <button key={item.key} className={`bottom-nav-item ${activeView === item.key ? 'active' : ''}`}
            onClick={() => setActiveView(item.key)}>
            {item.badge > 0 && <span className="bottom-nav-badge">{item.badge}</span>}
            <span className="bnav-icon"><NavIcon id={item.iconId} size={22} /></span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ─── Mobile Drawer ─────────────────────────────────────────────────────────

function MobileDrawer({ open, onClose, activeView, setActiveView, session, activeTenant, allTenants, onTenantChange, onLogout, alertCount, actionCount, maintAlertCount = 0, switchableTenants = [], onRequestTenantSwitch, onChangeOperator }) {
  // `hoje` muda quando a aba volta a ficar visível — sem isso a contagem
  // travava no valor do primeiro cálculo até trocar de empresa.
  const [hoje, setHoje] = useState(() => new Date().toDateString());
  useEffect(() => {
    const atualizar = () => { if (document.visibilityState === 'visible') setHoje(new Date().toDateString()); };
    document.addEventListener('visibilitychange', atualizar);
    window.addEventListener('focus', atualizar);
    return () => { document.removeEventListener('visibilitychange', atualizar); window.removeEventListener('focus', atualizar); };
  }, []);
  const validityAlertCount = useMemo(() => {
    try {
      const products = JSON.parse(localStorage.getItem(`nutriops.products.${activeTenant?.id}`) ?? '[]');
      return contarValidadesEmAlerta(products);
    } catch { return 0; }
  }, [activeTenant?.id, hoje]);

  const SECTIONS = buildNavSections({ validityAlertCount, maintAlertCount, alertCount, actionCount, isGlobalAdmin: isGlobalAdmin(session) });
  const navigate = (key) => { setActiveView(key); onClose(); };

  if (!open) return null;
  return (
    <div className="mobile-drawer open">
      <div className="mobile-drawer-overlay" onClick={onClose} />
      <div className="mobile-drawer-panel">
        {/* Header */}
        <div style={{ padding:'18px 16px 14px', borderBottom:'1px solid var(--rail-border)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <BrandLockup size="sm" idPrefix="drw" />
            <span style={{ fontSize:10, color:'var(--rail-muted)', letterSpacing:'.12em', textTransform:'uppercase' }}>v{APP_VERSION}</span>
          </div>
          {switchableTenants.length > 1 ? (
            <select value={activeTenant.id} onChange={e => { const id = e.target.value; onClose(); onRequestTenantSwitch?.(id); }}
              style={{ width:'100%', background:'rgba(255,255,255,.05)', border:'1px solid var(--rail-border)', color:'var(--rail-text)', borderRadius:8, padding:'7px 10px', fontFamily:'var(--font)', fontSize:13 }}>
              {switchableTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : allTenants.length > 1 && (
            <select value={activeTenant.id} onChange={e => { onTenantChange(e.target.value); onClose(); }}
              style={{ width:'100%', background:'rgba(255,255,255,.05)', border:'1px solid var(--rail-border)', color:'var(--rail-text)', borderRadius:8, padding:'7px 10px', fontFamily:'var(--font)', fontSize:13 }}>
              {allTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>
        {/* Operador — só na conta de loja. Existia só no RailNav (desktop/tablet);
            no celular não tinha NENHUM jeito de trocar fora da abertura de turno
            (item 17 da revisão de produto). */}
        {isStoreAccountSession(session) && (
          <OperatorChip tenantId={activeTenant.id} onChange={() => { onClose(); onChangeOperator?.(); }} />
        )}
        {/* Nav items */}
        <div style={{ flex:1, overflowY:'auto', padding:'8px' }}>
          {SECTIONS.map((section, sIdx) => {
            const visibleItems = section.items.filter(([key]) => canAccess(session?.user?.role, key));
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label} style={{ marginTop: sIdx === 0 ? 0 : 10 }}>
                <div className="rail-section-label">{section.label}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:1, marginTop:2 }}>
                  {visibleItems.map(([key, iconId, label, badge]) => (
                    <button key={key} onClick={() => navigate(key)}
                      className={`rail-menu-item ${isItemActive(key, activeView) ? 'active' : ''}`}
                      style={{ display:'flex', alignItems:'center', gap:10, minHeight:40 }}>
                      <NavIcon id={iconId} />
                      <span style={{ flex:1 }}>{label}</span>
                      {badge && (
                        <span style={{
                          background: key==='actions' ? 'var(--amber)' : 'var(--red)',
                          color:'white', borderRadius:10, fontSize:10, fontWeight:700,
                          padding:'1px 6px', flexShrink:0, lineHeight:1.4,
                        }}>
                          {badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {/* Footer */}
        <div style={{ padding:'12px 16px', borderTop:'1px solid var(--rail-border)' }}>
          <div style={{ fontSize:12, color:'var(--rail-muted)', marginBottom:8 }}>{session?.user?.name} · {session?.user?.role}</div>
          <button onClick={() => { onLogout(); onClose(); }}
            style={{ width:'100%', padding:'9px', border:'1px solid rgba(255,255,255,.12)', borderRadius:8, background:'transparent', color:'var(--rail-muted)', fontFamily:'var(--font)', fontSize:13, cursor:'pointer' }}>
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

function ViewLoading() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'40vh', gap:12 }}>
      <span style={{ width:18, height:18, borderRadius:'50%', border:'2px solid var(--border)', borderTopColor:'var(--primary)', animation:'nutriops-spin .8s linear infinite', display:'inline-block' }} />
      <span style={{ fontSize:12, color:'var(--text-secondary)', letterSpacing:'.08em', textTransform:'uppercase' }}>Carregando…</span>
    </div>
  );
}

function NoPermission({ onBack }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'60vh', gap:16, padding:32 }}>
      <div style={{ fontSize:64 }}>🔒</div>
      <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:'-.03em' }}>Acesso não autorizado</h2>
      <p style={{ fontSize:14, color:'var(--text-secondary)', textAlign:'center', maxWidth:360 }}>
        Você não tem permissão para acessar esta seção. Fale com o administrador se precisar de acesso.
      </p>
      <button className="secondary-action" onClick={onBack}>← Voltar à visão geral</button>
    </div>
  );
}


// ─── Rail ──────────────────────────────────────────────────────────────────

// Brand primitives (NutriMark, BrandLockup, APP_VERSION) vêm de ./brand
// (compartilhado com admin.jsx, onboarding.jsx, trial.jsx, kiosk.jsx)

// ─── Dark mode toggle — usa SVG (sol/lua) em vez de emoji ─────────────────

function DarkModeToggle({ className = 'dark-mode-toggle', size = 16 }) {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  );
  const toggle = () => {
    const next = !isDark;
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('nutriops.dark.mode', String(next));
    setIsDark(next);
  };
  return (
    <button className={className} onClick={toggle}
      aria-label={isDark ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
      title={isDark ? 'Modo claro' : 'Modo escuro'}>
      <NavIcon id={isDark ? 'sun' : 'moon'} size={size} />
    </button>
  );
}

// ─── Nav Icons — SVG outline, 16×16, stroke 1.5 ──────────────────────────

function NavIcon({ id, size = 16 }) {
  // flexShrink vai em `style` (CSS), não como atributo do <svg> — senão o React
  // avisa "does not recognize the flexShrink prop on a DOM element".
  const s = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.75, strokeLinecap:'round', strokeLinejoin:'round', style:{ flexShrink:0 } };
  const icons = {
    search:      <svg {...s}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    sun:         <svg {...s}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>,
    moon:        <svg {...s}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
    overview:    <svg {...s}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    forms:       <svg {...s}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
    receiving:   <svg {...s}><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    validity:    <svg {...s}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
    handwash:    <svg {...s}><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3z"/><path d="M9 8c0 2.21-2.239 4-5 4v4a8 8 0 0 0 8-8z"/></svg>,
    oil:         <svg {...s}><path d="M8.5 8.5c2 2 2 5 0 7a5 5 0 1 1 0-7"/><path d="M8.5 8.5 12 5"/><path d="M12 5c1-2 4-2 4 0s-3 2-4 0"/></svg>,
    thaw:        <svg {...s}><line x1="12" y1="2" x2="12" y2="22"/><path d="m17 7-5-5-5 5"/><path d="m17 17-5 5-5-5"/><line x1="2" y1="12" x2="22" y2="12"/><path d="m7 7-5 5 5 5"/><path d="m17 7 5 5-5 5"/></svg>,
    cooling:     <svg {...s}><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>,
    thermal:     <svg {...s}><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 22 4-10 4 10"/></svg>,
    pops:        <svg {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    training:    <svg {...s}><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>,
    maintenance: <svg {...s}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
    dashboard:   <svg {...s}><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>,
    charts:      <svg {...s}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
    reports:     <svg {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>,
    monthly:     <svg {...s}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="17 14 11 14 11 20"/><polyline points="14 17 11 17"/></svg>,
    audit:       <svg {...s}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
    dossie:      <svg {...s}><path d="M8 2h6l4 4v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M4 8v12a2 2 0 0 0 2 2h10"/><polyline points="14 2 14 6 18 6"/></svg>,
    alerts:      <svg {...s}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    // Escudo com check: "a loja está protegida?" — não reusa o de auditoria
    // (lupa) nem o de alertas (sino), que já significam outra coisa no rail.
    readiness:   <svg {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 11.5 11.5 14 15 10"/></svg>,
    actions:     <svg {...s}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
    rtpanel:     <svg {...s}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="m16 11 2 2 4-4"/></svg>,
    turns:       <svg {...s}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    users:       <svg {...s}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    sessions:    <svg {...s}><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/></svg>,
    profile:     <svg {...s}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    settings:    <svg {...s}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    logout:      <svg {...s}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  };
  return icons[id] ?? <svg {...s}><circle cx="12" cy="12" r="4"/></svg>;
}

// Estrutura de nav + hubs vêm de ./nav (testáveis e puros)
import { CONTROLS_KEYS, REPORTS_KEYS, TEAM_KEYS, isItemActive, buildNavSections, resolveHubTab as resolveHubTabBase } from './nav';
// Wrapper que passa o localStorage do browser pro resolveHubTab puro
const resolveHubTab = (activeView, hubId, defaultSub, subIds) =>
  resolveHubTabBase(activeView, hubId, defaultSub, subIds, typeof localStorage !== 'undefined' ? localStorage : null);
export { CONTROLS_KEYS, REPORTS_KEYS, TEAM_KEYS, isItemActive };

function RailNav({ activeTenant, allTenants, activeView, setActiveView, onTenantChange, onStoreChange, activeStore, session, records, alertCount, actionCount, maintAlertCount = 0, onLogout, onSearch, onChangeOperator, switchableTenants = [], onRequestTenantSwitch }) {
  const perms = getPermissions(session?.user?.role);
  const canSwitch = perms.canSwitchTenant && switchableTenants.length > 1;
  const [accountOpen, setAccountOpen] = useState(false);

  // `hoje` muda quando a aba volta a ficar visível — sem isso a contagem
  // travava no valor do primeiro cálculo até trocar de empresa.
  const [hoje, setHoje] = useState(() => new Date().toDateString());
  useEffect(() => {
    const atualizar = () => { if (document.visibilityState === 'visible') setHoje(new Date().toDateString()); };
    document.addEventListener('visibilitychange', atualizar);
    window.addEventListener('focus', atualizar);
    return () => { document.removeEventListener('visibilitychange', atualizar); window.removeEventListener('focus', atualizar); };
  }, []);
  const validityAlertCount = useMemo(() => {
    try {
      const products = JSON.parse(localStorage.getItem(`nutriops.products.${activeTenant.id}`) ?? '[]');
      return contarValidadesEmAlerta(products);
    } catch { return 0; }
  }, [activeTenant.id, hoje]);

  const SECTIONS = buildNavSections({ validityAlertCount, maintAlertCount, alertCount, actionCount, isGlobalAdmin: isGlobalAdmin(session) });
  // Conta vai pro dropdown do avatar — rail mostra só Operação, Qualidade, Gestão
  const railSections = SECTIONS.filter(s => s.label !== 'Conta');

  // Fechar dropdown ao clicar fora ou apertar ESC
  useEffect(() => {
    if (!accountOpen) return;
    const onClick = (e) => { if (!e.target.closest('[data-account-menu]')) setAccountOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setAccountOpen(false); };
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey); };
  }, [accountOpen]);

  const initial = (session?.user?.name ?? '?').trim().charAt(0).toUpperCase();

  return (
    <aside className="super-rail">
      {/* Brand */}
      <div className="rail-brand" style={{ padding:'14px 16px 10px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <BrandLockup size="lg" idPrefix="sid" />
          <DarkModeToggle />
        </div>
        <button onClick={onSearch} style={{ width:'100%', padding:'7px 10px', background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.08)', borderRadius:8, color:'var(--rail-muted)', fontSize:12, cursor:'pointer', textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:'var(--font)' }}>
          <span style={{ display:'flex', alignItems:'center', gap:8 }}>
            <NavIcon id="search" />
            Buscar…
          </span>
          <kbd style={{ fontSize:10, opacity:.6 }}>⌘K</kbd>
        </button>
      </div>

      {/* Avatar + dropdown — substitui card Sessão + seção Conta */}
      <div data-account-menu style={{ position:'relative', padding:'8px 12px', borderBottom:'1px solid var(--rail-border)' }}>
        <button onClick={() => setAccountOpen(o => !o)} aria-haspopup="menu" aria-expanded={accountOpen}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'6px 8px', border:'1px solid transparent', borderRadius:8, background: accountOpen ? 'var(--rail-hover)' : 'transparent', cursor:'pointer', fontFamily:'var(--font)', transition:'background var(--t)' }}>
          <span style={{ width:28, height:28, borderRadius:'50%', background:activeTenant.brandColor, color:'#fff', display:'grid', placeItems:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>{initial}</span>
          <span style={{ flex:1, minWidth:0, textAlign:'left' }}>
            <strong style={{ display:'block', fontSize:12, fontWeight:600, color:'var(--rail-text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{session.user.name}</strong>
            <span style={{ display:'block', fontSize:10, color:'var(--rail-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{session.user.role} · {activeTenant.name}</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color:'var(--rail-muted)', flexShrink:0, transform: accountOpen ? 'rotate(180deg)' : 'none', transition:'transform var(--t)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {accountOpen && (
          <div role="menu" style={{ position:'absolute', top:'calc(100% - 2px)', left:12, right:12, background:'var(--rail-bg)', border:'1px solid var(--rail-border)', borderRadius:8, padding:4, zIndex:50, boxShadow:'0 8px 24px rgba(0,0,0,.32)' }}>
            {canSwitch && (
              <>
                <CompanySwitcher tenants={switchableTenants} activeTenant={activeTenant}
                  onRequestSwitch={(id) => { setAccountOpen(false); onRequestTenantSwitch?.(id); }} />
                <div style={{ height:1, background:'var(--rail-border)', margin:'4px 0' }} />
              </>
            )}
            <button className="rail-menu-item" role="menuitem" onClick={() => { setAccountOpen(false); setActiveView('profile'); }}
              style={{ display:'flex', alignItems:'center', gap:10, width:'100%' }}>
              <NavIcon id="profile" /><span>Meu perfil</span>
            </button>
            <button className="rail-menu-item" role="menuitem" onClick={() => { setAccountOpen(false); setActiveView('settings'); }}
              style={{ display:'flex', alignItems:'center', gap:10, width:'100%' }}>
              <NavIcon id="settings" /><span>Configurações</span>
            </button>
            <div style={{ height:1, background:'var(--rail-border)', margin:'4px 0' }} />
            <button className="rail-menu-item" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }}
              style={{ display:'flex', alignItems:'center', gap:10, width:'100%' }}>
              <NavIcon id="logout" /><span>Sair</span>
            </button>
          </div>
        )}
      </div>

      {/* Operador — só na conta de loja (aparelho compartilhado do balcão) */}
      {isStoreAccountSession(session) && (
        <OperatorChip tenantId={activeTenant.id} onChange={onChangeOperator} />
      )}

      {/* Multi-store selector */}
      {activeTenant.multiStore && activeTenant.stores?.length > 1 && (
        <div style={{ padding:'8px 12px 0' }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--rail-muted)', marginBottom:4 }}>Loja</div>
          {activeTenant.stores.map(store => {
            const isActive = (activeStore?.id ?? activeTenant.stores[0].id) === store.id;
            return (
              <button key={store.id} onClick={() => onStoreChange?.(store.id)}
                style={{ width:'100%', textAlign:'left', padding:'6px 10px', marginBottom:3, borderRadius:8, border:`1px solid ${isActive?activeTenant.brandColor:'transparent'}`, background:isActive?`${activeTenant.brandColor}22`:'transparent', color:isActive?activeTenant.brandColor:'var(--rail-muted)', fontSize:12, fontWeight:isActive?700:500, cursor:'pointer', fontFamily:'var(--font)', transition:'all .12s' }}>
                📍 {store.location}
              </button>
            );
          })}
        </div>
      )}

      {/* Flat nav — sem seção Conta */}
      <div className="rail-menu">
        <div className="rail-menu-list" style={{ padding:'8px 8px 4px' }}>
          {railSections.map((section, sIdx) => {
            const visibleItems = section.items.filter(([key]) => canAccess(session?.user?.role, key));
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label} style={{ marginTop: sIdx === 0 ? 0 : 8 }}>
                <div className="rail-section-label">{section.label}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:1, marginTop:2 }}>
                  {visibleItems.map(([key, iconId, label, badge]) => (
                    <button key={key}
                      className={`rail-menu-item ${isItemActive(key, activeView) ? 'active' : ''}`}
                      onClick={() => setActiveView(key)}
                      style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <NavIcon id={iconId} />
                      <span style={{ flex:1 }}>{label}</span>
                      {badge && (
                        <span style={{
                          background: key==='actions' ? 'var(--amber)' : 'var(--red)',
                          color:'white', borderRadius:10, fontSize:10, fontWeight:700,
                          padding:'1px 6px', flexShrink:0, lineHeight:1.4,
                        }}>
                          {badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer — só versão (Sair migrou pro avatar) */}
        <div style={{ marginTop:'auto', padding:'10px 12px 12px', fontSize:9, color:'var(--rail-muted)', textAlign:'center', letterSpacing:'.12em', textTransform:'uppercase', borderTop:'1px solid var(--rail-border)' }}>
          v{APP_VERSION} · Uniwares
        </div>
      </div>
    </aside>
  );
}

// ─── Company Cards ─────────────────────────────────────────────────────────

function CompanyCards({ allTenants, activeTenant, onTenantChange, records }) {
  return (
    <div className="company-grid">
      {allTenants.map((t) => {
        const tr = records.filter((r) => r.tenantId === t.id);
        const today = tr.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString());
        return (
          <article key={t.id} className={`company-card ${activeTenant.id === t.id ? 'active' : ''}`} style={{ borderTopColor: t.brandColor }} onClick={() => onTenantChange(t.id)}>
            <div className="company-top">
              <div><span className="eyebrow">{t.plan}</span><h2 style={{ color: t.brandColor }}>{t.name}</h2></div>
              <span className="badge subtle" style={{ background: t.brandSoft, color: t.brandColor, borderColor: 'transparent' }}>{t.segment}</span>
            </div>
            <p className="company-summary">{t.localityType} · {t.equipmentCatalog.length} equip. · {t.users} usuários</p>
            <div className="company-stats">
              <div className="company-stat"><span>Hoje</span><strong>{today.length}</strong></div>
              <div className="company-stat"><span>Conformidade</span><strong>{t.compliance}%</strong></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ─── Tenant Switch (relogin) ───────────────────────────────────────────────
// Trocar de empresa exige autenticar na empresa-alvo (decisão de produto):
// nome + PIN do usuário naquela empresa. Admin global confirma com o PIN mestre.
// Mantém o modelo de PIN por-tenant — ninguém opera numa empresa sem credencial lá.

function TenantSwitchModal({ targetTenant, currentSession, onSuccess, onClose }) {
  // Pré-preenche com o primeiro nome do usuário atual (atalho quando a mesma
  // pessoa tem conta nas duas empresas — caso comum da RT/Supervisora da rede).
  const suggestedName = String(currentSession?.user?.name ?? '').split(' ')[0].toLowerCase();
  const [nameInput, setNameInput] = useState(suggestedName);
  const [pin, setPin]   = useState('');
  const [error, setError] = useState('');
  const pinRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    setError('');
    const raw = nameInput.trim();
    if (!raw) { setError('Informe seu usuário.'); return; }
    const users = readUsers(targetTenant).filter(u => u.status !== 'Inativo');
    const user = findUserByName(users, raw);
    if (!user) { setError(`Usuário "${raw}" não encontrado em ${targetTenant.name}.`); return; }

    const effectivePin = getEffectivePin(targetTenant.id, user);
    if (pin !== effectivePin) { setError('PIN incorreto.'); pinRef.current?.select(); return; }

    onSuccess({
      tenantId: targetTenant.id,
      user: {
        id: `${targetTenant.id}-${user.name}`,
        name: user.name, role: user.role,
        location: user.location ?? '', storeId: user.storeId ?? null,
      },
    });
  };

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(20,20,19,.55)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:'24px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:'var(--surface)', borderRadius:'var(--r-xl)', width:'100%', maxWidth:380,
        boxShadow:'var(--shadow-lg)', overflow:'hidden',
      }}>
        <div style={{ height:4, background:targetTenant.brandColor }} />
        <div style={{ padding:'24px 26px 26px' }}>
          <span className="eyebrow" style={{ color:targetTenant.brandColor }}>Trocar de empresa</span>
          <h2 style={{ fontSize:21, fontWeight:700, letterSpacing:'-.03em', margin:'4px 0 6px', fontFamily:'var(--serif)' }}>
            Entrar na {targetTenant.name}
          </h2>
          <p className="muted" style={{ fontSize:13, marginBottom:18 }}>
            Autentique-se com seu usuário e PIN da {targetTenant.name}.
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <label>Usuário
              <input value={nameInput} autoFocus
                onChange={e => { setNameInput(e.target.value); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') pinRef.current?.focus(); }}
                placeholder="ex: fran" autoCapitalize="none" autoCorrect="off"
                style={{ fontFamily:'var(--mono)', fontSize:15 }} />
            </label>
            <label>PIN
              <input ref={pinRef} type="password" inputMode="numeric" maxLength={6}
                value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g,'')); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                placeholder="••••" autoComplete="off"
                style={{ letterSpacing:'0.3em', fontSize:20, textAlign:'center', fontFamily:'var(--mono)' }} />
            </label>
            {error && <div style={{ padding:'8px 12px', background:'var(--red-light)', border:'1px solid var(--red-border)', borderRadius:'var(--r)', color:'var(--red)', fontSize:13, fontWeight:600 }}>{error}</div>}
            <button className="primary-action" style={{ width:'100%', marginTop:2 }} onClick={submit}>Entrar na empresa</button>
            <button className="ghost-action" style={{ width:'100%' }} onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Seletor de empresa — abre lista de empresas comutáveis. Usado no dropdown do
// avatar (rail) e no drawer mobile. Clicar numa empresa diferente da atual
// dispara onRequestSwitch (que abre o TenantSwitchModal).
function CompanySwitcher({ tenants, activeTenant, onRequestSwitch }) {
  if (!tenants || tenants.length <= 1) return null;
  return (
    <div style={{ padding:'4px 4px 6px' }}>
      <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--rail-muted)', padding:'4px 8px 2px' }}>Empresa</div>
      {tenants.map(t => {
        const isActive = t.id === activeTenant.id;
        return (
          <button key={t.id} role="menuitem"
            onClick={() => { if (!isActive) onRequestSwitch(t.id); }}
            className="rail-menu-item"
            style={{ display:'flex', alignItems:'center', gap:10, width:'100%', cursor:isActive?'default':'pointer', opacity:isActive?1:.92 }}>
            <span style={{ width:18, height:18, borderRadius:5, background:t.brandColor, color:'#fff', display:'grid', placeItems:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>
              {t.name.charAt(0)}
            </span>
            <span style={{ flex:1, textAlign:'left', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</span>
            {isActive && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={activeTenant.brandColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Temperature Capture ───────────────────────────────────────────────────

function TemperatureCapture({ activeTenant, session, equipmentCatalog, onRecordSaved }) {
  const repository = useMemo(() => getTemperatureRepository(), []);
  const visibleChips = equipmentCatalog.slice(0, 5);

  const [activeEquipment,      setActiveEquipment]      = useState(visibleChips[0]?.label ?? '');
  const [value,                setValue]                = useState('');
  const [note,                 setNote]                 = useState('');
  const [equipmentLocation,    setEquipmentLocation]    = useState('');
  const [observationEquipment, setObservationEquipment] = useState('');
  const [observationInterval,  setObservationInterval]  = useState('60');
  const [savedByEquipment,     setSavedByEquipment]     = useState({});
  const [draftByEquipment,     setDraftByEquipment]     = useState({});
  const [submissionState,      setSubmissionState]      = useState('idle');
  const temperatureRef = useRef(null), noteRef = useRef(null);

  useEffect(() => {
    setActiveEquipment(equipmentCatalog[0]?.label ?? ''); setValue(''); setNote('');
    setEquipmentLocation(getEquipmentEntry(equipmentCatalog, equipmentCatalog[0]?.label)?.location ?? '');
    setSavedByEquipment({}); setDraftByEquipment({}); setObservationEquipment(''); setSubmissionState('idle');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  const activeEntry  = getEquipmentEntry(equipmentCatalog, activeEquipment);
  const limits       = resolveTemperatureLimits(activeEquipment, equipmentCatalog);
  // Vírgula decimal: o teclado numérico do celular em pt-BR entrega "3,4", e
  // Number('3,4') é NaN. O rascunho contava no botão, não era gravado, e era
  // apagado junto com o resto no fim — perda silenciosa. Achado nº10 da
  // auditoria (18/08).
  const numericValue = parseTemperatura(value);
  const hasValue     = value !== '' && !isNaN(numericValue);
  const inRange      = hasValue && numericValue >= limits.min && numericValue <= limits.max;
  const warnRange    = hasValue && !inRange && numericValue >= limits.min - 3 && numericValue <= limits.max + 3;
  const statusTone   = !hasValue ? 'neutral' : inRange ? 'ok' : warnRange ? 'warn' : 'danger';
  const alertLabel   = !hasValue ? 'Aguardando leitura' : inRange ? 'Dentro da faixa' : warnRange ? 'Desvio leve' : 'Fora da faixa';
  const currentTime  = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const flowComplete = Boolean(savedByEquipment[activeEquipment]);

  // FONTE ÚNICA do que seria gravado agora. Antes `pendingDrafts` e o `toSave`
  // do handleSaveAll usavam critérios DIFERENTES: o contador aceitava qualquer
  // `d.value` truthy, o laço exigia número válido e equipamento não-gravado.
  // O botão prometia N, o laço gravava menos, e a tela confirmava "✓ Registro
  // salvo" do mesmo jeito — inclusive com ZERO gravações. Achados nº10, 12 e
  // 14 da auditoria, que eram o mesmo defeito visto por três lentes.
  //
  // `mudouDepoisDeGravar`: equipamento já gravado com valor DIFERENTE agora é
  // gravável de novo. Antes, medir outra vez e corrigir não fazia nada — o ✓✓
  // continuava na tela sobre o número novo (achado nº12).
  const rascunhosGravaveis = useMemo(() => {
    const out = [];
    const jaGravado = (lbl, val) => {
      const s = savedByEquipment[lbl];
      return s ? parseTemperatura(s.temperature) === val : false;
    };
    if (hasValue && !jaGravado(activeEquipment, numericValue)) {
      out.push({ label: activeEquipment, val: numericValue, loc: equipmentLocation, nt: note });
    }
    for (const [label, draft] of Object.entries(draftByEquipment)) {
      if (label === activeEquipment) continue;
      const val = parseTemperatura(draft.value);
      if (draft.value && !isNaN(val) && !jaGravado(label, val)) {
        out.push({ label, val, loc: draft.location ?? '', nt: draft.note ?? '' });
      }
    }
    return out;
  }, [draftByEquipment, activeEquipment, hasValue, numericValue, savedByEquipment, equipmentLocation, note]);

  const pendingDrafts = rascunhosGravaveis.length;

  // Rascunho com número inválido (vírgula já é aceita, mas "12-" ou "--" não):
  // conta separado pra poder AVISAR em vez de sumir com ele.
  const rascunhosInvalidos = useMemo(() =>
    Object.entries(draftByEquipment)
      .filter(([lbl, d]) => lbl !== activeEquipment && d.value && isNaN(parseTemperatura(d.value)))
      .map(([lbl, d]) => `${lbl}: "${d.value}"`),
  [draftByEquipment, activeEquipment]);

  const persistDraft = useCallback((lbl, patch) => {
    setDraftByEquipment((prev) => ({ ...prev, [lbl]: { ...(prev[lbl] ?? {}), ...patch } }));
  }, []);

  const selectEquipment = useCallback((label) => {
    if (activeEquipment) persistDraft(activeEquipment, { value, note, location: equipmentLocation });
    setActiveEquipment(label);
    const draft = draftByEquipment[label];
    setValue(draft?.value ?? savedByEquipment[label]?.temperature ?? '');
    setNote(draft?.note ?? savedByEquipment[label]?.note ?? '');
    setEquipmentLocation(draft?.location ?? savedByEquipment[label]?.location ?? getEquipmentEntry(equipmentCatalog, label)?.location ?? '');
    setSubmissionState('idle');
    window.requestAnimationFrame(() => temperatureRef.current?.focus());
  }, [activeEquipment, value, note, equipmentLocation, draftByEquipment, savedByEquipment, equipmentCatalog, persistDraft]);

  const buildPayload = useCallback((label, val, loc, nt) => ({
    tenantId: activeTenant.id, tenantName: activeTenant.name, store: activeTenant.name,
    equipmentInput: label, equipmentKey: label, equipmentLocation: loc || null,
    user: session.user.name, role: session.user.role, equipment: label,
    measuredAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    controlMode: observationEquipment === label ? 'observation' : 'routine',
    observationInterval: observationEquipment === label ? Number(observationInterval) : null,
    value: Number(val), note: nt,
    min: resolveTemperatureLimits(label, equipmentCatalog).min,
    max: resolveTemperatureLimits(label, equipmentCatalog).max,
  }), [activeTenant, session, observationEquipment, observationInterval, equipmentCatalog]);

  const handleSaveAll = async () => {
    if (pendingDrafts === 0) return;
    // Rascunho com número que não dá pra ler ("12-", "--"). Antes ele contava
    // no botão, não entrava no laço, e era apagado junto com o resto — a
    // leitura sumia sem nada na tela. Agora a pessoa decide.
    if (rascunhosInvalidos.length) {
      const ok = window.confirm(
        `Estes valores não são números válidos e NÃO serão registrados:\n\n${rascunhosInvalidos.join('\n')}\n\n` +
        `Continuar gravando os outros? (Cancele para corrigir antes.)`
      );
      if (!ok) return;
    }
    const toSave = rascunhosGravaveis;
    // Guarda contra erro de digitação (ex.: freezer a -19°C lançado como 19°C):
    // valor bem fora da faixa cadastrada pede confirmação antes de gravar —
    // evita não-conformidade falsa por typo, sem bloquear um valor real ruim.
    const outOfRange = toSave.filter((item) => {
      const lim = resolveTemperatureLimits(item.label, equipmentCatalog);
      return resolveTone(item.val, lim.min, lim.max) === 'danger';
    });
    // RDC 216 espera a ação anotada quando o desvio é crítico (item 16 da
    // revisão) — bloqueia ANTES do confirm de digitação abaixo: primeiro
    // escreve o que vai fazer, só depois confirma que o número é real. Some
    // sozinho assim que a observação for preenchida (não é um modal, é o
    // próprio campo ficando em foco).
    // Sinal trocado (bug da CASA DOCE, 14/08): antes de qualquer outra coisa,
    // se um valor positivo só faz sentido negativo pra aquele equipamento,
    // corrige na hora em vez de gravar +18°C num freezer. Diferente do confirm
    // genérico que existia (dispensável no reflexo), aqui a correção é a ação.
    const sinalTrocado = toSave.filter((item) => {
      const lim = resolveTemperatureLimits(item.label, equipmentCatalog);
      return suspectMissingMinus(item.val, lim.min, lim.max);
    });
    if (sinalTrocado.length) {
      const detalhe = sinalTrocado.map((i) => `• ${i.label}: ${i.val}°C → −${i.val}°C`).join('\n');
      const corrigir = window.confirm(`Faltou o sinal de menos?\n\n${detalhe}\n\nEsses equipamentos só trabalham em temperatura negativa. Corrigir o sinal antes de registrar?`);
      if (corrigir) {
        for (const item of sinalTrocado) {
          if (item.label === activeEquipment) setValue(`-${item.val}`);
          persistDraft(item.label, { value: `-${item.val}` });
        }
        // Volta pra tela com os valores corrigidos, pra ela conferir — mas
        // NADA foi gravado ainda, e antes nada dizia isso: o botão continuava
        // no mesmo lugar e a pessoa podia sair achando que registrou (achado
        // nº11 da auditoria). O estado 'corrigido' aparece na mesma faixa que
        // já mostra "✓ Registro salvo".
        setSubmissionState('corrigido');
        return;
      }
    }
    const missingNote = outOfRange.filter((item) => !item.nt?.trim());
    if (missingNote.length) {
      const target = missingNote[0].label;
      if (target === activeEquipment) {
        // Já é o card aberto — foca direto, sem disputar frame com nada.
        noteRef.current?.focus();
      } else {
        // selectEquipment tem seu próprio foco adiado (vai pro campo de
        // temperatura do card que abre) — o nosso precisa vencer o dele,
        // por isso espera um frame a mais.
        selectEquipment(target);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => noteRef.current?.focus()));
      }
      return;
    }
    if (outOfRange.length) {
      const detail = outOfRange.map((item) => {
        const lim = resolveTemperatureLimits(item.label, equipmentCatalog);
        return `${item.label}: ${item.val}°C (esperado ${lim.min}° a ${lim.max}°)`;
      }).join('\n');
      const proceed = window.confirm(`Valor bem fora da faixa esperada:\n\n${detail}\n\nConfira se não é erro de digitação (ex.: sinal de negativo esquecido). Confirma o registro assim mesmo?`);
      if (!proceed) return;
    }
    setSubmissionState('saving');
    try {
      const newSaved = { ...savedByEquipment };
      for (const item of toSave) {
        const created = await repository.create(buildPayload(item.label, item.val, item.loc, item.nt));
        newSaved[item.label] = { equipment: item.label, temperature: String(item.val), note: item.nt, location: item.loc, createdAt: created?.createdAt ?? new Date().toISOString() };
      }
      setSavedByEquipment(newSaved); setDraftByEquipment({});
      setSubmissionState('saved'); onRecordSaved?.();
    } catch { setSubmissionState('error'); }
  };

  return (
    <article className="capture-card">
      <div className="card-head">
        <div><span className="eyebrow">Registro de temperatura</span><h2>{activeTenant.name}</h2></div>
        <span className={`badge ${statusTone}`}>{alertLabel}</span>
      </div>
      <div className="capture-topline">
        <div className="capture-meta"><span>Usuário</span><strong>{session.user.name}</strong></div>
        <div className="capture-meta"><span>Perfil</span><strong>{session.user.role}</strong></div>
        <div className="capture-meta"><span>Horário</span><strong>{currentTime}</strong></div>
      </div>
      <div className="capture-fields">
        <div className="chip-row">
          {visibleChips.map((item) => {
            const isSaved = Boolean(savedByEquipment[item.label]), isActive = activeEquipment === item.label;
            const hasDraft = isActive ? hasValue : Boolean(draftByEquipment[item.label]?.value);
            const chipClass = (isSaved || hasDraft) ? 'active' : isActive ? 'pending' : '';
            return (
              <button key={item.label} className={`quick-chip ${chipClass} ${observationEquipment === item.label ? 'observing' : ''}`} onClick={() => selectEquipment(item.label)}>
                <strong>{item.label}</strong>
                <span>{item.aliases?.[0] ?? 'padrão'}</span>
                {isSaved && <small className="quick-chip-check">✓✓</small>}
              </button>
            );
          })}
        </div>
        <div className="equipment-row compact">
          <label className="textarea-block field-box">
            <span className="field-head"><span>Equipamento</span>{flowComplete && <small className="field-check">✓✓</small>}</span>
            <input list={`eq-${activeTenant.id}`} value={activeEquipment} onChange={(e) => { const n = normalizeEquipmentName(e.target.value, equipmentCatalog); setActiveEquipment(n); setEquipmentLocation(getEquipmentEntry(equipmentCatalog, n)?.location ?? ''); }} placeholder="Equipamento" />
            <datalist id={`eq-${activeTenant.id}`}>{visibleChips.map((i) => <option key={i.label} value={i.label} />)}</datalist>
          </label>
          <label className="textarea-block field-box">
            <span className="field-head"><span>Localização</span></span>
            <input value={equipmentLocation || activeEntry?.location || ''} readOnly tabIndex={-1} placeholder="Definida no cadastro" />
          </label>
        </div>
        <div className="grid-2 temperature-entry-row">
          <div className="timestamp-card compact field-box">
            <span className="field-head"><span>Horário atual</span></span>
            <strong>{currentTime}</strong><small>Timestamp automático</small>
          </div>
          <label className="textarea-block field-box">
            <span className="field-head"><span>Temperatura (°C)</span>{flowComplete && <small className="field-check">✓✓</small>}</span>
            <div style={{ display:'flex', gap:8, alignItems:'stretch' }}>
              <input ref={temperatureRef} inputMode="decimal" value={value} style={{ flex:1, minWidth:0 }}
                onChange={(e) => { setValue(e.target.value); setSubmissionState('idle'); persistDraft(activeEquipment, { value: e.target.value }); }}
                placeholder={`${limits.min} a ${limits.max}`}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (hasValue) { const idx = visibleChips.findIndex((c) => c.label === activeEquipment); const next = visibleChips[idx + 1]; if (next) selectEquipment(next.label); else noteRef.current?.focus(); } else noteRef.current?.focus(); } }} />
              {/* O teclado numérico do celular/tablet não tem tecla de menos com
                  inputMode="decimal" — sem este botão, temperatura de congelados
                  é impossível de digitar (bug da CASA DOCE, 14/08). */}
              <button type="button" title="Trocar sinal (+/−)"
                onClick={() => { const novo = value.startsWith('-') ? value.slice(1) : (value.trim() ? `-${value.trim()}` : value); setValue(novo); setSubmissionState('idle'); persistDraft(activeEquipment, { value: novo }); }}
                style={{ width:52, borderRadius:'var(--r)', border:'1px solid var(--border)', background:'var(--surface-muted)', color:'var(--text)', fontSize:18, fontWeight:700, fontFamily:'var(--mono)', cursor:'pointer', flexShrink:0 }}>
                ±
              </button>
            </div>
          </label>
        </div>
        <div className="range-panel">
          <span>Faixa regular</span>
          <strong>{limits.min}°C a {limits.max}°C</strong>
          <div className={`range-status ${statusTone}`}>
            <span>{!hasValue ? '◌' : inRange ? '✓' : '!'}</span>
            <strong>{hasValue ? `${numericValue}°C` : 'Aguardando leitura'}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={`secondary-action${observationEquipment === activeEquipment ? ' observing' : ''}`} style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setObservationEquipment(observationEquipment === activeEquipment ? '' : activeEquipment)}>
            {observationEquipment === activeEquipment ? '● Em observação' : '○ Marcar observação'}
          </button>
          {observationEquipment === activeEquipment && (
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 0 }}>
              <span style={{ whiteSpace: 'nowrap' }}>Intervalo</span>
              <select value={observationInterval} onChange={(e) => setObservationInterval(e.target.value)} style={{ width: 'auto' }}>
                <option value="15">15 min</option><option value="30">30 min</option><option value="60">1h</option><option value="120">2h</option>
              </select>
            </label>
          )}
        </div>
        <label className="textarea-block field-box">
          <span className="field-head">
            <span>Observação</span>
            {statusTone === 'danger' && <small style={{ color: 'var(--red)', fontWeight: 700 }}>Obrigatório — fora da faixa</small>}
          </span>
          <textarea ref={noteRef} value={note} onChange={(e) => { setNote(e.target.value); setSubmissionState('idle'); persistDraft(activeEquipment, { note: e.target.value }); }}
            placeholder={statusTone === 'danger' ? 'Descreva a ação tomada.' : 'Opcional.'}
            style={{ minHeight: 54, ...(statusTone === 'danger' && !note.trim() ? { borderColor: 'var(--red-border)' } : {}) }} />
        </label>
        <div className="actions-row">
          <button className="secondary-action" onClick={() => { setValue(''); setNote(''); setSubmissionState('idle'); }}>Limpar</button>
          <button className={`primary-action${hasValue ? ' attention' : ''}`} onClick={handleSaveAll} disabled={pendingDrafts === 0 || submissionState === 'saving'}>
            {submissionState === 'saving' ? 'Salvando…' : pendingDrafts > 1 ? `Registrar ${pendingDrafts} temperaturas` : 'Registrar temperatura'}
          </button>
        </div>
        {submissionState === 'corrigido' && <div className="submission warn">Sinal corrigido — <strong>ainda não gravou</strong>. Confira os valores e toque em registrar de novo.</div>}
        {submissionState === 'saved' && <div className="submission ok">✓ Registro salvo com timestamp auditável.</div>}
        {submissionState === 'error' && <div className="submission danger">Erro ao salvar. Tente novamente.</div>}
      </div>
    </article>
  );
}

// ─── Recent History ────────────────────────────────────────────────────────

function RecentHistory({ activeTenant, records }) {
  const tr = records.filter((r) => r.tenantId === activeTenant.id).slice(0, 8);
  return (
    <article className="history-card">
      <div className="card-head compact-head"><div><span className="eyebrow">Auditoria</span><h2>Últimos registros</h2></div><span className="badge neutral">{tr.length}</span></div>
      <div className="history-list">
        {tr.length === 0 ? <p className="muted" style={{ padding: '16px' }}>Ainda não há registros.</p>
          : tr.map((r) => (
            <div className={`history-item tone-${resolveTemperatureTone(r)}`} key={r.id}>
              <div><strong>{r.equipmentInput || r.equipment}</strong><span>{r.measuredAt ?? 'Automático'}{r.equipmentLocation ? ` · ${r.equipmentLocation}` : ''}</span><span>{formatCompactDateTime(r.createdAt)}</span></div>
              <div className="history-side"><strong>{r.value}°C</strong><span>{r.controlMode === 'observation' ? 'obs.' : 'rotina'}</span></div>
            </div>
          ))}
      </div>
    </article>
  );
}

// ─── Overview ──────────────────────────────────────────────────────────────

function OverviewView({ activeTenant, allTenants, onTenantChange, session, equipmentCatalog, records, onRecordSaved, alerts, notifPermission, onRequestNotif, onLaunchKiosk, trialStatus, onTryV2 }) {
  // Training expiry alerts
  const trainingAlerts = useMemo(() => {
    try {
      const sessions  = JSON.parse(localStorage.getItem(`nutriops.training.sessions.${activeTenant.id}`) ?? '[]');
      const config    = JSON.parse(localStorage.getItem(`nutriops.training.config.${activeTenant.id}`) ?? '{"validityMonths":12}');
      const users     = JSON.parse(localStorage.getItem(`nutriops.users.${activeTenant.id}`) ?? 'null') ?? activeTenant.usersList ?? [];
      return users
        .filter(u => u.status !== 'Inativo')
        .map(u => {
          const r = employeeTrainingStatus(u.name, sessions, config.validityMonths ?? 12);
          return { name: u.name, role: u.role, status: r.status, daysAgo: r.daysAgo, lastTitle: r.session?.title };
        })
        .filter(u => u.status === 'warn' || u.status === 'expired' || u.status === 'never');
    } catch { return []; }
  }, [activeTenant.id]);

  return (
    <>
      {/* Trial / billing banners */}
      <TrialBanner status={trialStatus} />

      {/* Notification permission banner */}
      {notifPermission === 'default' && (
        <div className="alert-banner" style={{ background:'var(--blue-light)', borderColor:'var(--blue-border)', marginBottom:16 }}>
          <span style={{ color:'var(--blue-emphasis)' }}>🔔 Ativar lembretes de turno no navegador</span>
          <button className="primary-action" style={{ fontSize:12, padding:'6px 14px' }} onClick={onRequestNotif}>Ativar notificações</button>
        </div>
      )}
      {alerts.length > 0 && (
        <div className="alert-banner">
          <span>⚠ {alerts.length} pendência{alerts.length > 1 ? 's' : ''} no turno atual</span>
          <span>{alerts.map((a) => a.equipment).join(', ')}</span>
        </div>
      )}

      {/* Training expiry alert banner */}
      {trainingAlerts.length > 0 && (
        <div className="alert-banner" style={{ background:'var(--amber-light)', borderColor:'var(--amber-border)', marginBottom:16, flexWrap:'wrap', gap:8 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            <span style={{ fontWeight:700, color:'var(--amber)' }}>🎓 {trainingAlerts.length} colaborador{trainingAlerts.length!==1?'es':''} com capacitação vencida ou próxima do vencimento</span>
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
              {trainingAlerts.slice(0,3).map(u => u.name).join(', ')}{trainingAlerts.length > 3 ? ` e mais ${trainingAlerts.length-3}` : ''}
            </span>
          </div>
        </div>
      )}
      {onTryV2 && (
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
          padding:'10px 14px', marginBottom:14,
          background:'rgba(0,163,92,.08)', border:'1px solid rgba(0,163,92,.25)',
          borderRadius:'var(--r-lg)',
        }}>
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            <strong style={{ fontSize:13, color:'var(--text)' }}>Nova Visão Geral disponível</strong>
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
              Dashboard adaptado ao seu perfil com gráficos de temperatura por equipamento.
            </span>
          </div>
          <button onClick={onTryV2} style={{
            padding:'8px 16px', borderRadius:'var(--r)', border:'none',
            background:'var(--primary)', color:'white', fontSize:13, fontWeight:600,
            cursor:'pointer', fontFamily:'var(--font)', whiteSpace:'nowrap',
          }}>
            Experimentar →
          </button>
        </div>
      )}
      <CompanyCards allTenants={allTenants} activeTenant={activeTenant} onTenantChange={onTenantChange} records={records} />
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <button className="secondary-action" style={{ fontSize:12, background:'#0d1117', color:'white', borderColor:'transparent' }} onClick={onLaunchKiosk}>
          Modo quiosque
        </button>
        <button className="secondary-action" style={{ fontSize:12 }} onClick={async () => { const m = await import('./controls'); m.printTodayReport(activeTenant, records); }}>
          Imprimir registros de hoje
        </button>
      </div>
      <div className="workspace-grid">
        <TemperatureCapture key={activeTenant.id} activeTenant={activeTenant} session={session} equipmentCatalog={equipmentCatalog} onRecordSaved={onRecordSaved} />
        <RecentHistory activeTenant={activeTenant} records={records} />
      </div>
    </>
  );
}

// ─── Corrective Actions View ───────────────────────────────────────────────

const SOURCE_BADGE = { temperature: 'Temperatura', receiving: 'Recebimento', control: 'Controle', form: 'Planilha' };

// Pré-preenche a descrição com o que a origem já sabe — recebimento já tem o
// motivo digitado, controle já tem a ação/observação, planilha já tem a NC.
// Temperatura crítica também: item 16 da revisão passou a exigir observação
// na captura quando o desvio é fora da faixa (`note` chega preenchido); desvio
// leve segue sem texto (não existe "motivo" obrigatório pra um `warn`).
function defaultDescriptionFor(item) {
  if (!item) return '';
  if (item.source === 'receiving')   return item.raw?.motivoRejeicao ?? '';
  if (item.source === 'control')     return item.raw?.acao || item.raw?.obs || '';
  if (item.source === 'form')        return item.raw?.description ?? '';
  if (item.source === 'temperature') return item.raw?.note ?? '';
  return '';
}

// Ações salvas antes de 09/08 não têm `source` — exibidas como sempre foram
// (equipment/temperature). Não precisa migrar dado antigo pra continuar lendo.
function actionDisplay(a) {
  if (a.source) return { badge: SOURCE_BADGE[a.source] ?? a.source, label: a.sourceLabel, detail: a.sourceDetail };
  return { badge: 'Temperatura', label: a.equipment, detail: a.temperature != null ? `${a.temperature}°C` : '' };
}

function CorrectiveActionsView({ activeTenant, allTenants, onTenantChange, records }) {
  const [actions, setActions]         = useState(() => readActions(activeTenant.id));
  const [statusFilter, setStatusFilter] = useState('all');
  const [creating, setCreating]       = useState(null); // item pendente normalizado (ver nonconformities.js)
  const [editingId, setEditingId]     = useState(null);
  const [description, setDescription] = useState('');
  const [responsible, setResponsible] = useState('');
  const [deadline, setDeadline]       = useState('');
  const [resolution, setResolution]   = useState('');
  const [verTodosPendentes, setVerTodosPendentes] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  // Recebimento é lido direto (mesmo arquivo); controles especiais e
  // planilhas vêm de chunks pesados (controls.jsx/extras.jsx/forms.jsx) — só
  // carregados sob demanda, pra não engordar o bundle principal.
  const [otherPending, setOtherPending] = useState({ receiving: [], controls: [], forms: [] });

  useEffect(() => {
    setActions(readActions(activeTenant.id)); setCreating(null); setEditingId(null);
    let vivo = true;
    syncCorrectiveActions(activeTenant.id).then(() => { if (vivo) setActions(readActions(activeTenant.id)); });
    return () => { vivo = false; };
  }, [activeTenant.id]);
  useEffect(() => { writeActions(activeTenant.id, actions); }, [activeTenant.id, actions]);

  useEffect(() => {
    let vivo = true;
    setOtherPending((prev) => ({ ...prev, receiving: pendingReceivingItems(load(recStorageKey(activeTenant.id), [])) }));
    (async () => {
      const [controlsMod, extrasMod, formsMod] = await Promise.all([import('./controls'), import('./extras'), import('./forms')]);
      if (!vivo) return;
      const { readOil, readThaw, readCool, readThermal } = controlsMod;
      const { readHandwash } = extrasMod;
      const { readFormTemplates, readFormRecords, extractNonConformities } = formsMod;
      const controls = [
        ...pendingControlItems('oil', readOil(activeTenant.id)),
        ...pendingControlItems('thaw', readThaw(activeTenant.id)),
        ...pendingControlItems('cool', readCool(activeTenant.id)),
        ...pendingControlItems('thermal', readThermal(activeTenant.id)),
        ...pendingControlItems('handwash', readHandwash(activeTenant.id)),
      ];
      const forms = pendingFormItems(readFormTemplates(activeTenant), readFormRecords(activeTenant.id), extractNonConformities);
      if (vivo) setOtherPending((prev) => ({ ...prev, controls, forms }));
    })();
    return () => { vivo = false; };
  }, [activeTenant.id]);

  const users = readUsers(activeTenant);

  const temperaturePending = pendingTemperatureItems(records, activeTenant.id, resolveTemperatureTone);
  const pending = excludeWithAction(
    [...temperaturePending, ...otherPending.receiving, ...otherPending.controls, ...otherPending.forms],
    actions,
  ).sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0));

  const openCreate = (item) => {
    setCreating(item); setEditingId(null);
    setDescription(defaultDescriptionFor(item)); setResponsible(users[0]?.name ?? '');
    setDeadline(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    setResolution('');
  };

  const saveAction = () => {
    if (!description.trim() || !creating) return;
    const action = {
      id: crypto.randomUUID(), tenantId: activeTenant.id,
      source: creating.source, sourceId: creating.sourceId,
      sourceLabel: creating.sourceLabel, sourceDetail: creating.sourceDetail,
      description: description.trim(), responsible, deadline, status: 'aberta', resolution: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setActions((prev) => [action, ...prev]);
    pushCorrectiveAction(activeTenant.id, action);
    setCreating(null);
  };

  const advanceStatus = (id) => {
    let toPush = null;
    setActions((prev) => prev.map((a) => {
      if (a.id !== id) return a;
      const next = a.status === 'aberta' ? 'em_andamento' : a.status === 'em_andamento' ? 'resolvida' : 'resolvida';
      const updated = { ...a, status: next, updatedAt: new Date().toISOString(), closedAt: next === 'resolvida' ? new Date().toISOString() : a.closedAt, resolution: resolvingId === id ? resolution : a.resolution };
      toPush = updated;
      return updated;
    }));
    if (toPush) pushCorrectiveAction(activeTenant.id, toPush);
    setResolvingId(null); setResolution('');
  };

  const removeAction = async (id) => {
    if (!window.confirm('Remover esta ação?')) return;
    setActions((prev) => prev.filter((a) => a.id !== id));
    const r = await deleteCorrectiveAction(activeTenant.id, id);
    if (!r.ok) {
      // Offline/config off: intencional, não avisa (é o mesmo caso do
      // equipamento — ela vai reaparecer no sync e a pessoa pode remover de
      // novo quando estiver online). Falha DE VERDADE (erro do servidor com
      // internet presente) precisa ser dita — senão a ação volta sozinha e
      // parece que a remoção nunca aconteceu.
      if (r.reason !== 'offline_or_disabled') {
        window.alert('Não foi possível remover na nuvem agora. Ela pode reaparecer na próxima sincronização — tente remover de novo.');
      }
    }
  };

  const filtered = actions.filter((a) => statusFilter === 'all' || a.status === statusFilter);
  const open = actions.filter((a) => a.status !== 'resolvida').length;

  const statusLabel = { aberta: 'Aberta', em_andamento: 'Em andamento', resolvida: 'Resolvida' };
  const statusTone  = { aberta: 'danger', em_andamento: 'warn', resolvida: 'ok' };
  const nextLabel   = { aberta: 'Iniciar', em_andamento: 'Marcar resolvida', resolvida: 'Resolvida ✓' };

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Central de não-conformidades</span><h1>Não conformidades</h1><p className="muted">Temperatura fora da faixa, recebimento rejeitado, controle reprovado e NC de planilha — tudo num lugar, com ação corretiva.</p></div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width: 'auto' }}>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {open > 0 && <span className="badge warn">{open} em aberto</span>}
        </div>
      </div>

      {/* Itens sem ação corretiva ainda, de qualquer uma das 4 origens */}
      {pending.length > 0 && (
        <article className="management-card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div><span className="eyebrow">Aguardando ação</span><h2>Não conformidades sem ação corretiva</h2></div><span className="badge danger">{pending.length}</span></div>
          <div className="equipment-maintenance-list">
            {/* O badge acima mostra pending.length, mas a lista cortava em 15
                sem dizer isso — numa central de não-conformidades, esconder
                item sem avisar significa esconder o que ainda precisa de ação
                corretiva pela RDC 216. Achado da auditoria (18/08). */}
            {(verTodosPendentes ? pending : pending.slice(0, 15)).map((item) => (
              <div key={`${item.source}::${item.sourceId}`} className="equipment-maintenance-row">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge neutral" style={{ fontSize: 10 }}>{SOURCE_BADGE[item.source]}</span>
                    <strong>{item.sourceLabel}</strong>
                  </div>
                  {item.at && <span>{formatCompactDateTime(item.at)}</span>}
                  {item.sourceDetail && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.sourceDetail}</span>}
                </div>
                <button className="primary-action" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => openCreate(item)}>Abrir ação</button>
              </div>
            ))}
          </div>
          {!verTodosPendentes && pending.length > 15 && (
            <button className="ghost-action" style={{ margin: '8px 16px', fontSize: 12 }} onClick={() => setVerTodosPendentes(true)}>
              Ver os outros {pending.length - 15}
            </button>
          )}
        </article>
      )}

      {/* Create form */}
      {creating && (
        <article className="management-card" style={{ marginBottom: 16, borderColor: 'var(--blue-border)', background: 'var(--blue-light)' }}>
          <div className="card-head" style={{ background: 'transparent', borderBottomColor: 'var(--blue-border)' }}>
            <div><span className="eyebrow">Nova ação · {SOURCE_BADGE[creating.source]}</span><h2>{creating.sourceLabel}</h2></div>
            <button className="ghost-action" onClick={() => setCreating(null)}>✕ Cancelar</button>
          </div>
          <div className="capture-fields">
            <label>Descrição do desvio e ação a tomar<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva o que ocorreu e o que será feito…" style={{ minHeight: 72 }} /></label>
            <div className="grid-2">
              <label>Responsável
                <select value={responsible} onChange={(e) => setResponsible(e.target.value)}>
                  {users.map((u) => <option key={u.name} value={u.name}>{u.name} — {u.role}</option>)}
                </select>
              </label>
              <label>Prazo<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
            </div>
            <div className="actions-row">
              <button className="primary-action" onClick={saveAction}>Criar ação corretiva</button>
            </div>
          </div>
        </article>
      )}

      {/* Actions list */}
      <article className="management-card">
        <div className="card-head">
          <div><span className="eyebrow">Histórico</span><h2>Ações registradas</h2></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'aberta', 'em_andamento', 'resolvida'].map((s) => (
              <button key={s} className={`secondary-action`} style={{ fontSize: 11, padding: '4px 10px', background: statusFilter === s ? 'var(--text)' : '', color: statusFilter === s ? 'white' : '', border: statusFilter === s ? 'none' : '' }} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? 'Todas' : statusLabel[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="equipment-maintenance-list">
          {filtered.length === 0 ? <p className="muted" style={{ padding: '20px' }}>Nenhuma ação encontrada.</p>
            : filtered.map((a) => {
              const disp = actionDisplay(a);
              return (
              <div key={a.id} className="equipment-maintenance-row" style={{ flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, width: '100%' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className="badge neutral" style={{ fontSize: 10 }}>{disp.badge}</span>
                      <strong>{disp.label}</strong>
                      <span className={`badge ${statusTone[a.status]}`}>{statusLabel[a.status]}</span>
                      {disp.detail && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{disp.detail}</span>}
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{a.description}</p>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                      <span>Responsável: <strong>{a.responsible}</strong></span>
                      <span>Prazo: <strong>{a.deadline ? new Date(a.deadline).toLocaleDateString('pt-BR') : '—'}</strong></span>
                      <span>Aberta: {formatCompactDateTime(a.createdAt)}</span>
                      {a.closedAt && <span>Fechada: {formatCompactDateTime(a.closedAt)}</span>}
                    </div>
                    {a.resolution && <p style={{ fontSize: 12, color: 'var(--green)', marginTop: 4, fontStyle: 'italic' }}>✓ {a.resolution}</p>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                    {a.status !== 'resolvida' && (
                      <button className="primary-action" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => { if (a.status === 'em_andamento') { setResolvingId(a.id); setResolution(''); } else advanceStatus(a.id); }}>
                        {nextLabel[a.status]}
                      </button>
                    )}
                    <button className="ghost-action danger" style={{ fontSize: 11 }} onClick={() => removeAction(a.id)}>Remover</button>
                  </div>
                </div>
                {resolvingId === a.id && (
                  <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <label style={{ flex: 1 }}>Descreva a resolução<textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="O que foi feito para corrigir…" style={{ minHeight: 54 }} /></label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button className="primary-action" onClick={() => advanceStatus(a.id)}>Confirmar</button>
                      <button className="secondary-action" onClick={() => setResolvingId(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
        </div>
      </article>
    </section>
  );
}

// ─── Alerts View ───────────────────────────────────────────────────────────

function AlertsView({ activeTenant, allTenants, onTenantChange, records, onAlertsChanged }) {
  const [, setTick] = useState(0); // re-render local ao dar ciência
  const turns = readTurns(activeTenant), catalog = readEquipmentCatalog(activeTenant);
  const alerts = computeTurnAlerts(turns, records, catalog, activeTenant.id, activeTenant.implantacao === true);
  const giveAck = (id) => { dismissAlertId(activeTenant.id, id); setTick(t => t + 1); onAlertsChanged?.(); };
  const today = records.filter((r) => r.tenantId === activeTenant.id && new Date(r.createdAt).toDateString() === new Date().toDateString());
  const outOfRange = today.filter((r) => resolveTemperatureTone(r) !== 'ok');
  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Pendências e desvios</span><h1>Alertas</h1><p className="muted">Pendências por turno e registros fora da faixa.</p></div>
        <div className="page-actions"><select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width: 'auto' }}>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      <article className="management-card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div><span className="eyebrow">Pendências de turno</span><h2>Registros em aberto</h2></div>{alerts.length > 0 && <span className="badge danger">{alerts.length}</span>}</div>
        <div className="equipment-maintenance-list">
          {alerts.length === 0 ? <p className="muted" style={{ padding: '20px' }}>✓ Nenhuma pendência para o turno atual.</p>
            : alerts.map((a) => (
              <div key={a.id} className="equipment-maintenance-row">
                <div><strong>{a.equipment}</strong><span>Turno: {a.turn}</span><span>{a.message}</span></div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span className={`badge ${a.level}`}>{a.level === 'warn' ? 'Pendente' : 'Atrasado'}</span>
                  <button className="ghost-action" style={{ fontSize:11 }} title="Dar ciência — some hoje, reaparece amanhã se seguir pendente" onClick={() => giveAck(a.id)}>Dar ciência</button>
                </div>
              </div>
            ))}
        </div>
      </article>
      <article className="management-card">
        <div className="card-head"><div><span className="eyebrow">Hoje</span><h2>Temperaturas fora da faixa</h2></div>{outOfRange.length > 0 && <span className="badge warn">{outOfRange.length}</span>}</div>
        <div className="equipment-maintenance-list">
          {outOfRange.length === 0 ? <p className="muted" style={{ padding: '20px' }}>✓ Todos os registros de hoje estão dentro da faixa.</p>
            : outOfRange.map((r) => { const tone = resolveTemperatureTone(r); return (
              <div key={r.id} className="equipment-maintenance-row">
                <div><strong>{r.equipmentInput || r.equipment}</strong><span>{formatCompactDateTime(r.createdAt)} · {r.user}</span>{r.note && <span>{r.note}</span>}</div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <strong style={{ fontFamily: 'var(--mono)', fontSize: 16 }}>{r.value}°C</strong>
                  <span className={`badge ${tone}`}>{tone === 'warn' ? 'Desvio leve' : 'Fora da faixa'}</span>
                </div>
              </div>
            ); })}
        </div>
      </article>
    </section>
  );
}


// ─── Equipment View ────────────────────────────────────────────────────────

function EquipmentView({ activeTenant, allTenants, onTenantChange }) {
  const [catalog, setCatalog]               = useState(() => readEquipmentCatalog(activeTenant));
  const [labelInput, setLabelInput]         = useState('');
  const [aliasInput, setAliasInput]         = useState('');
  const [locationInput, setLocationInput]   = useState('');
  const [minInput, setMinInput]             = useState('');
  const [maxInput, setMaxInput]             = useState('');
  const [editingIndex, setEditingIndex]     = useState(null);
  const [search, setSearch]                 = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  // De QUAL loja é o `catalog` que está em memória agora. Sem essa marcação, a
  // troca de empresa corrompia o catálogo da loja de destino: o efeito de
  // escrita tem activeTenant.id nas deps, então ele rodava no render da troca
  // — quando o id JÁ é o novo mas o `catalog` do state AINDA é o da loja
  // anterior — e gravava o catálogo antigo por cima da nova. Foi assim que os
  // 44 equipamentos da CASA DOCE apagaram Swiss/Bäckerei/DBK (bug de 30/07).
  // Guardar em state (não em ref) é essencial: o valor lido pelo efeito precisa
  // ser o do render, senão a checagem passa e o bug volta.
  const [catalogTenant, setCatalogTenant] = useState(activeTenant.id);
  const resetForm = () => { setEditingIndex(null); setLabelInput(''); setAliasInput(''); setLocationInput(''); setMinInput(''); setMaxInput(''); };
  useEffect(() => {
    setCatalog(readEquipmentCatalog(activeTenant));
    setCatalogTenant(activeTenant.id);
    // Os setores são de outra loja agora — sem limpar, o filtro fica apontando
    // pra um setor inexistente e a lista aparece vazia "sem motivo".
    setLocationFilter('');
    setSearch('');
    resetForm();
  }, [activeTenant.id]);
  useEffect(() => {
    // Troca de loja em andamento (catalog ainda é da loja anterior) → não grava.
    if (catalogTenant !== activeTenant.id) return;
    writeEquipmentCatalog(activeTenant.id, catalog);
  }, [activeTenant.id, catalogTenant, catalog]);

  // Sugestão automática de faixa quando o usuário digita o nome (só preenche
  // se os campos estiverem vazios — não sobrescreve o que o user escolheu)
  const suggestRangeFromLabel = (label) => {
    if (minInput !== '' || maxInput !== '') return;
    const suggested = suggestLimits(label);
    setMinInput(String(suggested.min));
    setMaxInput(String(suggested.max));
  };

  const startEdit = (i) => {
    const item = catalog[i];
    setEditingIndex(i);
    setLabelInput(item.label);
    setAliasInput(item.aliases?.join(', ') ?? '');
    setLocationInput(item.location ?? '');
    setMinInput(item.minTemp != null ? String(item.minTemp) : '');
    setMaxInput(item.maxTemp != null ? String(item.maxTemp) : '');
  };
  const cancelEdit = () => resetForm();

  const saveItem = () => {
    const label = labelInput.trim(); if (!label) return;
    const aliases = aliasInput.split(',').map((s) => s.trim()).filter(Boolean);
    const location = locationInput.trim() || null;
    const minN = minInput === '' ? null : Number(minInput);
    const maxN = maxInput === '' ? null : Number(maxInput);
    if (minN != null && maxN != null && minN > maxN) {
      window.alert('Mínimo precisa ser menor ou igual ao máximo.');
      return;
    }
    // Nome repetido é PERDA DE DADO, não incômodo: a linha na nuvem é chaveada
    // por (tenant_id, label) — eqToRow não tem id —, então dois equipamentos
    // com o mesmo nome viram UMA linha, e o segundo apaga o primeiro (faixa,
    // setor e apelidos). O `dedupeCatalog` ainda some com um deles na tela.
    // Cenário natural na CASA DOCE: 44 equipamentos em 11 setores, "Freezer 1"
    // na Padaria e na Confeitaria. Achado da auditoria de 18/08.
    // Bloqueio, não confirmação: não existe forma de gravar os dois — deixar
    // seguir só escolheria em silêncio qual perder.
    const norm = (v) => String(v ?? '').trim().toLowerCase();
    const conflito = catalog.some((item, i) => i !== editingIndex && norm(item.label) === norm(label));
    if (conflito) {
      window.alert(
        `Já existe um equipamento chamado "${label}" nesta empresa.\n\n` +
        `Dois equipamentos não podem ter o mesmo nome — um sobrescreveria o outro na nuvem. ` +
        `Use um nome que os diferencie (ex.: "${label} — Padaria").`
      );
      return;
    }
    const next = { label, aliases, location, minTemp: minN, maxTemp: maxN };
    const anterior = editingIndex === null ? null : catalog[editingIndex];
    setCatalog((prev) => editingIndex === null
      ? [...prev, next]
      : prev.map((item, i) => i === editingIndex ? { ...item, ...next } : item));
    // Sync pro Supabase (no-op se desligado/offline; cai na fila)
    pushEquipmentItem(activeTenant.id, next).catch(() => {});
    // RENOMEAÇÃO deixa órfão (CASA DOCE, 18/08): a linha na nuvem é
    // identificada por (tenant_id, label) — eqToRow não tem id. Trocar o nome
    // faz upsert numa chave NOVA e a linha velha continua lá; no boot seguinte
    // o sync traz as duas e o equipamento aparece duplicado. Localmente o
    // `map` acima substitui certo, então nada denunciava — só reaparecia
    // depois, em outro aparelho, parecendo cadastro errado da equipe.
    // Apagar DEPOIS de subir a nova: se a ordem inverter e o push falhar,
    // o equipamento some da nuvem.
    if (anterior?.label && anterior.label !== label) {
      deleteEquipmentItem(activeTenant.id, anterior.label).catch(() => {});
    }
    cancelEdit();
  };

  const removeItem = async (i) => {
    const item = catalog[i];
    if (!item) return;
    if (!window.confirm(`Remover "${item.label}"?`)) return;
    setCatalog((prev) => prev.filter((_, idx) => idx !== i));
    if (editingIndex === i) cancelEdit();
    // deleteEquipmentItem NUNCA lança — devolve {ok:false, reason}. O
    // `.catch(() => {})` não pegava nada, e o {ok:false} que a função devolvia
    // era descartado: falha real (com internet, erro do servidor) não
    // avisava, e o equipamento voltava sozinho no próximo sync como se a
    // remoção nunca tivesse acontecido. Achado da auditoria (18/08).
    const r = await deleteEquipmentItem(activeTenant.id, item.label);
    if (!r.ok && r.reason !== 'offline_or_disabled') {
      window.alert(`Não foi possível remover "${item.label}" na nuvem agora. Ele pode reaparecer na próxima sincronização — tente remover de novo.`);
    }
  };

  // Setores existentes no catálogo — alimentam o filtro. Vem da própria
  // `location` de cada equipamento, sem cadastro novo.
  const sectors = useMemo(() => {
    const set = new Set(catalog.map((e) => e.location).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [catalog]);

  const filtered = catalog
    .filter((item) => {
      const q = search.toLowerCase();
      // Setor é comparação exata (vem da lista, não digitado) — `includes`
      // faria "Padaria" casar também com "Padaria 2".
      return (!q || item.label.toLowerCase().includes(q) || item.aliases?.some((a) => a.toLowerCase().includes(q)))
          && (!locationFilter || String(item.location ?? '') === locationFilter);
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));

  const fmtRange = (item) => {
    if (item.minTemp != null && item.maxTemp != null) return `${item.minTemp}° a ${item.maxTemp}°`;
    const h = heuristicLimits(item.label);
    return `${h.min}° a ${h.max}° (auto)`;
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Cadastro</span>
          <h1>Equipamentos</h1>
          <p className="muted">Equipamentos monitorados, suas faixas permitidas e onde ficam.</p>
        </div>
        <div className="page-actions"><span className="badge subtle">{activeTenant.name}</span></div>
      </div>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">{editingIndex === null ? 'Novo' : 'Editando'}</span>
              <h2>{editingIndex === null ? 'Cadastrar equipamento' : catalog[editingIndex]?.label ?? ''}</h2>
            </div>
            <span className="badge neutral">{catalog.length}</span>
          </div>
          <div className={`editing-banner ${editingIndex !== null ? 'active' : ''}`}>
            <span className="eyebrow">Modo edição</span>
            <strong>Editando: {catalog[editingIndex]?.label}</strong>
            <p>Altere os campos e clique em Salvar.</p>
          </div>
          <div className="capture-fields">
            <label>Empresa
              <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)}>
                {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>Nome padrão
              <input value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onBlur={(e) => suggestRangeFromLabel(e.target.value)}
                placeholder="Ex.: Freezer, Refrigerador, Vitrine" />
            </label>
            <label>Variações / apelidos
              <input value={aliasInput} onChange={(e) => setAliasInput(e.target.value)}
                placeholder="Ex.: freezer, câmara congelada" />
            </label>
            {/* Setor com sugestão dos já usados. Era texto livre: "Padaria",
                "padaria" e "Padaria " viravam TRÊS setores, quebrando o filtro
                e o agrupamento da captura. `datalist` sugere sem impedir criar
                um setor novo — a nutricionista precisa dos dois. */}
            <label>Setor / localização (opcional)
              <input value={locationInput} onChange={(e) => setLocationInput(e.target.value)}
                list="setores-cadastrados" placeholder="Ex.: Padaria, Confeitaria, Estoque Seco" />
              <datalist id="setores-cadastrados">
                {sectors.map((s) => <option key={s} value={s} />)}
              </datalist>
              {sectors.length > 0 && (
                <span style={{ fontSize:11, color:'var(--text-secondary)', marginTop:4, display:'block' }}>
                  {sectors.length} setor{sectors.length > 1 ? 'es' : ''} já cadastrado{sectors.length > 1 ? 's' : ''} — toque no campo pra escolher, ou digite um novo.
                </span>
              )}
            </label>
            <div className="grid-2">
              <label>Temp. mínima (°C)
                <input type="number" inputMode="decimal" step="0.1"
                  value={minInput} onChange={(e) => setMinInput(e.target.value)}
                  placeholder="Ex.: 0" />
              </label>
              <label>Temp. máxima (°C)
                <input type="number" inputMode="decimal" step="0.1"
                  value={maxInput} onChange={(e) => setMaxInput(e.target.value)}
                  placeholder="Ex.: 9" />
              </label>
            </div>
            <p className="muted" style={{ fontSize:11, margin:'-4px 0 0' }}>
              Sugestão automática quando você sai do campo Nome. Pode sobrescrever.
              Sem faixa cadastrada, o app usa fallback heurístico (freezer = -25 a -18, resto = 0 a 9).
            </p>
            <div className="actions-row">
              {editingIndex !== null && <button className="secondary-action" onClick={cancelEdit}>Cancelar</button>}
              <button className="primary-action" onClick={saveItem}>
                {editingIndex === null ? 'Adicionar' : 'Salvar alteração'}
              </button>
            </div>
          </div>
        </article>
        <article className="management-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Lista</span>
              <h2>Equipamentos cadastrados</h2>
            </div>
            <span className="badge neutral">{filtered.length}/{catalog.length}</span>
          </div>
          <div className="capture-fields equipment-filters">
            <label>Buscar<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou apelido" /></label>
            {sectors.length > 0 && (
              <label>Setor
                <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                  <option value="">Todos os setores ({catalog.length})</option>
                  {sectors.map((s) => (
                    <option key={s} value={s}>{s} ({catalog.filter((e) => e.location === s).length})</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="equipment-maintenance-list">
            {filtered.length === 0
              ? <p className="muted" style={{ padding: '16px 20px' }}>Nenhum equipamento encontrado.</p>
              : filtered.map((item) => {
                  const ri = catalog.indexOf(item);
                  return (
                    <div key={`${item.label}-${ri}`} className={`equipment-maintenance-row ${editingIndex === ri ? 'editing' : ''}`}>
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.aliases?.length ? item.aliases.join(' · ') : 'Sem apelidos'}</span>
                        <span>{item.location ?? 'Sem localização'} · <strong style={{ color:'var(--green)' }}>{fmtRange(item)}</strong></span>
                      </div>
                      <div className="equipment-row-actions">
                        <button className="ghost-action" onClick={() => startEdit(ri)}>Editar</button>
                        <button className="ghost-action danger" onClick={() => removeItem(ri)}>Remover</button>
                      </div>
                    </div>
                  );
                })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ─── Recebimento de Mercadorias ────────────────────────────────────────────

const recStorageKey = (id) => `nutriops.receiving.${id}`;
const recLoad = (id) => { try { const r = localStorage.getItem(recStorageKey(id)); return r ? JSON.parse(r) : []; } catch { return []; } };
const recSave = (id, v) => { try { localStorage.setItem(recStorageKey(id), JSON.stringify(v)); } catch {} };

const RECEIVING_CHECKS = [
  { id: 'embalagem',   label: 'Embalagem íntegra e limpa' },
  { id: 'rotulagem',   label: 'Rotulagem e validade legíveis' },
  { id: 'veiculo',     label: 'Veículo de transporte limpo e adequado' },
  { id: 'entregador',  label: 'Higiene pessoal do entregador' },
  { id: 'temperatura', label: 'Temperatura dentro do esperado' },
  { id: 'aparencia',   label: 'Aparência e odor adequados' },
];

function RecebimentoView({ activeTenant, allTenants, onTenantChange, session }) {
  const [items, setItems]           = useState(() => recLoad(activeTenant.id));
  const [fornecedor, setFornecedor] = useState('');
  const [nf, setNf]                 = useState('');
  const [produto, setProduto]       = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [validade, setValidade]     = useState('');
  const [temperatura, setTemperatura] = useState('');
  const [conservacao, setConservacao] = useState('');
  const [checks, setChecks]         = useState({});
  const [resultado, setResultado]   = useState('');
  const [resultadoTouched, setResultadoTouched] = useState(false);
  const [motivoRejeicao, setMotivoRejeicao] = useState('');
  const [obs, setObs]               = useState('');
  const [filter, setFilter]         = useState('all');
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);

  useEffect(() => { setItems(recLoad(activeTenant.id)); }, [activeTenant.id]);
  useEffect(() => { recSave(activeTenant.id, items); }, [activeTenant.id, items]);

  const sugestaoResultado = receivingSuggestedResult(checks, RECEIVING_CHECKS.map((c) => c.id));
  const motivoObrigatorio = resultado === 'rejeitado' || resultado === 'aceito_parcial';

  useEffect(() => {
    if (sugestaoResultado && !resultadoTouched) setResultado(sugestaoResultado);
  }, [sugestaoResultado, resultadoTouched]);

  const escolherResultado = (opt) => {
    setResultadoTouched(true);
    setResultado((prev) => (prev === opt ? '' : opt));
  };

  const handleSubmit = () => {
    if (!fornecedor.trim() || !produto.trim() || !resultado || (motivoObrigatorio && !motivoRejeicao.trim())) return;
    setSaving(true);
    const record = {
      id: crypto.randomUUID(),
      tenantId: activeTenant.id,
      fornecedor: fornecedor.trim(),
      nf: nf.trim(),
      produto: produto.trim(),
      quantidade: quantidade.trim(),
      validade: validade.trim(),
      temperatura: temperatura.trim(),
      conservacao,
      checks,
      resultado,
      motivoRejeicao: motivoObrigatorio ? motivoRejeicao.trim() : '',
      obs: obs.trim(),
      user: session?.user?.name ?? '—',
      role: session?.user?.role ?? '',
      createdAt: new Date().toISOString(),
    };
    setItems((prev) => [record, ...prev].slice(0, 300));
    pushReceivingRecord(activeTenant.id, record);
    // Reset form
    setFornecedor(''); setNf(''); setProduto(''); setQuantidade('');
    setValidade(''); setTemperatura(''); setConservacao(''); setChecks({}); setResultado(''); setResultadoTouched(false);
    setMotivoRejeicao(''); setObs('');
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const toggleCheck = (id) => setChecks((prev) => ({ ...prev, [id]: prev[id] === 'C' ? 'NC' : prev[id] === 'NC' ? '' : 'C' }));

  const filtered = filter === 'all' ? items : items.filter((r) => r.resultado === filter);

  const exportCSV = () => {
    const cols = ['createdAt','fornecedor','nf','produto','quantidade','validade','temperatura','conservacao','resultado','motivoRejeicao','obs','user'];
    const esc = (v) => `"${String(v??'').replaceAll('"','""')}"`;
    const csv = [cols.join(','), ...items.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href:url, download:`recebimento-${new Date().toISOString().slice(0,10)}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Controle de entrada</span>
          <h1>Recebimento de Mercadorias</h1>
          <p className="muted">Registro de inspeção na chegada: temperatura, condições, validade e resultado.</p>
        </div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width: 'auto' }}>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="secondary-action" onClick={exportCSV} style={{ fontSize: 12 }}>↓ CSV</button>
        </div>
      </div>

      <div className="management-grid">
        {/* Entry form */}
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Novo registro</span><h2>Registrar recebimento</h2></div></div>
          <div className="capture-fields">
            <div className="grid-2">
              <label>Fornecedor<input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Nome do fornecedor" /></label>
              <label>NF / Pedido<input value={nf} onChange={(e) => setNf(e.target.value)} placeholder="Número da nota fiscal" /></label>
            </div>
            <label>Produto / Descrição<input value={produto} onChange={(e) => setProduto(e.target.value)} placeholder="Descreva o produto recebido" /></label>
            <div className="grid-2">
              <label>Quantidade<input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="Ex.: 10 kg, 5 cx" /></label>
              <label>Data de validade<input value={validade} onChange={(e) => setValidade(e.target.value)} placeholder="DD/MM/AAAA" /></label>
            </div>
            <label>Temperatura na chegada (°C)
              <input value={temperatura} onChange={(e) => setTemperatura(e.target.value)} inputMode="decimal" placeholder="Se aplicável" />
            </label>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>
                Forma de conservação <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(informativo — não precisa medir por item, cada categoria já vai pra câmara com a temperatura fixa dela)</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['resfriado', 'congelado', 'ambiente'].map((opt) => {
                  const labels = { resfriado: 'Resfriado', congelado: 'Congelado', ambiente: 'Ambiente' };
                  const on = conservacao === opt;
                  return (
                    <button key={opt} onClick={() => setConservacao(on ? '' : opt)}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${on ? 'var(--primary)' : '#d0d7de'}`, background: on ? 'rgba(0,104,74,.1)' : 'white', color: on ? 'var(--primary)' : '#656d76', fontWeight: on ? 700 : 500, fontSize: 12, cursor: 'pointer', textAlign: 'center' }}>
                      {labels[opt]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Checks */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-secondary)', marginBottom: 10 }}>Verificações de conformidade</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {RECEIVING_CHECKS.map((c) => {
                  const val = checks[c.id] ?? '';
                  return (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {['C', 'NC'].map((opt) => {
                          const on = val === opt;
                          const [bg, color, border] = opt === 'C' ? ['#dafbe1','#1a7f37','#4ac26b'] : ['#ffebe9','#cf222e','#ff8182'];
                          return (
                            <button key={opt} onClick={() => toggleCheck(c.id)}
                              style={{ padding: '4px 12px', borderRadius: 6, border: `1.5px solid ${on ? border : '#d0d7de'}`, background: on ? bg : 'white', color: on ? color : '#656d76', fontWeight: on ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Result */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Resultado{!resultadoTouched && sugestaoResultado ? ' (sugerido pelos checks)' : ''}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['aceito', 'rejeitado', 'aceito_parcial'].map((opt) => {
                  const labels = { aceito: '✓ Aceito', rejeitado: '✗ Rejeitado', aceito_parcial: '~ Aceito parcial' };
                  const colors = { aceito: ['#dafbe1','#1a7f37','#4ac26b'], rejeitado: ['#ffebe9','#cf222e','#ff8182'], aceito_parcial: ['#fdf8e3','#9a6700','#e3aa14'] };
                  const [bg, color, border] = colors[opt];
                  const on = resultado === opt;
                  return (
                    <button key={opt} onClick={() => escolherResultado(opt)}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${on ? border : '#d0d7de'}`, background: on ? bg : 'white', color: on ? color : '#656d76', fontWeight: on ? 700 : 500, fontSize: 12, cursor: 'pointer', textAlign: 'center' }}>
                      {labels[opt]}
                    </button>
                  );
                })}
              </div>
            </div>

            {motivoObrigatorio && (
              <label>Motivo da {resultado === 'rejeitado' ? 'rejeição' : 'aceitação parcial'} (obrigatório)<textarea value={motivoRejeicao} onChange={(e) => setMotivoRejeicao(e.target.value)} placeholder="Descreva o que não conformou…" style={{ minHeight: 60 }} /></label>
            )}
            <label>Observações<textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observações adicionais…" style={{ minHeight: 54 }} /></label>

            <div className="actions-row">
              <button className={`primary-action${resultado ? ' attention' : ''}`} onClick={handleSubmit}
                disabled={!fornecedor.trim() || !produto.trim() || !resultado || (motivoObrigatorio && !motivoRejeicao.trim()) || saving}>
                {saving ? 'Salvando…' : 'Registrar recebimento'}
              </button>
            </div>
            {saved && <div className="submission ok">✓ Recebimento registrado com sucesso.</div>}
          </div>
        </article>

        {/* History */}
        <article className="management-card">
          <div className="card-head">
            <div><span className="eyebrow">Histórico</span><h2>Registros de recebimento</h2></div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['all','aceito','rejeitado','aceito_parcial'].map((f) => {
                const labels = { all: 'Todos', aceito: 'Aceitos', rejeitado: 'Rejeitados', aceito_parcial: 'Parcial' };
                return (
                  <button key={f} onClick={() => setFilter(f)}
                    style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, fontWeight: 600, background: filter === f ? 'var(--text)' : 'var(--surface)', color: filter === f ? 'white' : 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                    {labels[f]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="equipment-maintenance-list">
            {filtered.length === 0
              ? <p className="muted" style={{ padding: '20px' }}>Nenhum registro encontrado.</p>
              : filtered.map((r) => {
                const tone = r.resultado === 'aceito' ? 'ok' : r.resultado === 'rejeitado' ? 'danger' : 'warn';
                const label = { aceito: 'Aceito', rejeitado: 'Rejeitado', aceito_parcial: 'Aceito parcial' }[r.resultado] ?? r.resultado;
                return (
                  <div key={r.id} className="equipment-maintenance-row" style={{ borderLeft: `3px solid ${tone === 'ok' ? 'var(--green-border)' : tone === 'danger' ? 'var(--red-border)' : 'var(--amber-border)'}` }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong>{r.produto}</strong>
                        <span className={`badge ${tone}`}>{label}</span>
                      </div>
                      <span>{r.fornecedor}{r.nf ? ` · NF ${r.nf}` : ''}</span>
                      <span>{r.quantidade}{r.validade ? ` · Val. ${r.validade}` : ''}{r.temperatura ? ` · ${r.temperatura}°C` : ''}{r.conservacao ? ` · ${{resfriado:'Resfriado',congelado:'Congelado',ambiente:'Ambiente'}[r.conservacao] ?? r.conservacao}` : ''}</span>
                      {r.motivoRejeicao && <span style={{ color: 'var(--red)', fontSize: 11 }}>{r.resultado === 'aceito_parcial' ? 'Ressalva' : 'Rejeição'}: {r.motivoRejeicao}</span>}
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatCompactDateTime(r.createdAt)} · {r.user}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ─── Offline Indicator ─────────────────────────────────────────────────────

// Banner sticky no topo quando Supabase está desligado nesse dispositivo.
// Mostra que os dados ficam só locais — exatamente o cenário "loja sem sync".
// Esconde sozinho quando Supabase é habilitado.
// Conta registros não sincronizados em todos os módulos. Custo baixo porque
// só roda quando Supabase está off (banner visível) e cada chave é uma leitura.
function countLocalRecords(tenantId) {
  if (!tenantId) return 0;
  let total = 0;
  try {
    const temps = JSON.parse(localStorage.getItem('nutriops.temperature.records') ?? '[]');
    total += temps.filter(r => r.tenantId === tenantId).length;
  } catch {}
  const tenantKeys = [
    `nutriops.forms.records.${tenantId}`,
    `nutriops.receiving.${tenantId}`,
    `nutriops.products.${tenantId}`,
    `nutriops.stocklogs.${tenantId}`,
    `nutriops.oil.${tenantId}`, `nutriops.thaw.${tenantId}`,
    `nutriops.cool.${tenantId}`, `nutriops.thermal.${tenantId}`,
  ];
  for (const k of tenantKeys) {
    try { total += (JSON.parse(localStorage.getItem(k) ?? '[]') || []).length; } catch {}
  }
  return total;
}

// Banner pra quando Supabase retorna 401/403 — anon key inválida (rotacionada
// ou RLS bloqueando). Sem isso, os pushes caem na queue silenciosamente
// e o user nunca sabe que precisa reconectar.

// Armazenamento do aparelho cheio. Quando isso acontece, TODA gravação local
// falha (ver lw em repository.js) e cada tela segue confirmando sucesso — a
// pessoa registra o dia inteiro e nada é salvo. É a falha mais silenciosa que
// a auditoria de 18/08 encontrou (achado nº15), e a única que não tem
// auto-cura: só liberando espaço.
function StorageFullBanner() {
  const [full, setFull] = useState(() => getStorageFull());
  useEffect(() => {
    const t = setInterval(() => setFull(getStorageFull()), 10_000);
    return () => clearInterval(t);
  }, []);
  if (!full) return null;
  return (
    <div role="alert" style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
      padding:'10px 16px', marginBottom:16,
      background:'var(--red-light)', border:'1px solid var(--red-border)',
      borderRadius:'var(--r-lg)', flexWrap:'wrap',
    }}>
      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        <strong style={{ color:'var(--red)', fontSize:13 }}>
          ⚠ O armazenamento deste aparelho está cheio — registros podem NÃO estar sendo salvos
        </strong>
        <span style={{ color:'var(--text-secondary)', fontSize:12 }}>
          Última falha ao gravar em {new Date(full.at).toLocaleString('pt-BR')}. Feche abas, limpe o cache de
          outros sites, ou use outro aparelho — e confira se as últimas leituras aparecem no histórico.
        </span>
      </div>
      <button onClick={() => { clearStorageFull(); setFull(null); }}
        style={{ padding:'6px 10px', borderRadius:'var(--r)', border:'1px solid var(--red-border)', background:'transparent', color:'var(--red)', fontSize:12, fontWeight:500, cursor:'pointer', fontFamily:'var(--font)' }}>
        Dispensar
      </button>
    </div>
  );
}

function SupabaseAuthErrorBanner({ session, setActiveView }) {
  const [err, setErr] = useState(() => getSupabaseAuthError());
  useEffect(() => {
    // 10s, não 30s: o flag é apagado no primeiro sucesso (repository.js), então
    // esta é a latência entre "voltou a funcionar" e "o vermelho some". Com 30s
    // o aviso sobrevivia à própria causa e a pessoa via um erro que já passou.
    const t = setInterval(() => setErr(getSupabaseAuthError()), 10_000);
    return () => clearInterval(t);
  }, []);
  if (!err) return null;
  // Falha com o JWT do usuário = sessão expirando, que se cura sozinha no
  // próximo refresh. Só vira banner se INSISTIR (3 seguidas) — um soluço de
  // rede não pode pintar a tela de vermelho e mandar rotacionar uma chave
  // perfeitamente boa, que foi o que aconteceu na CASA DOCE em 15/08.
  const sessaoExpirando = err.kind === 'session';
  const semPermissao   = err.kind === 'rls';
  if (sessaoExpirando && (err.falhas ?? 1) < 3) return null;
  // Os outros pedem 2 seguidas. Uma falha isolada — rede oscilando no tablet,
  // token trocando de mãos — pintava a tela inteira de vermelho na hora, e
  // sumia sozinha depois. Alarme que se desmente sozinho vira chamado de
  // suporte e, pior, ensina a equipe a ignorar o vermelho.
  if ((err.falhas ?? 1) < 2) return null;
  const role = session?.user?.role;
  const canFix = role === 'Administrador' || role === 'Super-admin' || role === 'Nutricionista RT';
  return (
    <div role="alert" style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
      padding:'10px 16px', marginBottom:16,
      background:'var(--red-light)', border:'1px solid var(--red-border)',
      borderRadius:'var(--r-lg)', flexWrap:'wrap',
    }}>
      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        <strong style={{ color:'var(--red)', fontSize:13 }}>
          {sessaoExpirando
            ? `⚠ Sincronização falhando — sua sessão não está sendo renovada (HTTP ${err.status})`
            : semPermissao
              ? `⚠ Sincronização falhando — sem permissão para esta loja (${err.table ?? 'banco'})`
              : `⚠ Sincronização falhando — o servidor recusou o acesso (HTTP ${err.status})`}
        </strong>
        <span style={{ color:'var(--text-secondary)', fontSize:12 }}>
          {sessaoExpirando
            ? `Saia e entre de novo pra renovar o acesso. Nenhum registro se perde — tudo que não subiu fica na fila. Última falha em ${new Date(err.at).toLocaleString('pt-BR')}.`
            : semPermissao
              // Não é a chave. Mandar trocar a chave aqui é o conselho errado —
              // foi o que atrasou o diagnóstico em 16/08.
              ? `A chave está certa; o que falta é o vínculo do seu acesso com esta loja. Nenhum registro se perde — tudo que não subiu fica na fila. Última falha em ${new Date(err.at).toLocaleString('pt-BR')}.`
            : canFix
              ? 'Reconecte em Configurações ou confira a anon key. Nenhum registro se perde — tudo que não subiu fica na fila. Última falha em ' + new Date(err.at).toLocaleString('pt-BR') + '.'
              : 'Peça pro administrador conferir a conexão em Configurações. Nenhum registro se perde — tudo que não subiu fica na fila.'}
        </span>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        {canFix && !sessaoExpirando && !semPermissao && (
          <button onClick={() => setActiveView('settings')}
            style={{ padding:'6px 14px', borderRadius:'var(--r)', border:'1px solid var(--red-border)', background:'var(--red)', color:'white', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
            Reconectar
          </button>
        )}
        <button onClick={() => { clearSupabaseAuthError(); setErr(null); }}
          style={{ padding:'6px 10px', borderRadius:'var(--r)', border:'1px solid var(--red-border)', background:'transparent', color:'var(--red)', fontSize:12, fontWeight:500, cursor:'pointer', fontFamily:'var(--font)' }}>
          Dispensar
        </button>
      </div>
    </div>
  );
}

// Catálogo de equipamentos preso no provisório de fábrica (ver auto-cura no
// doSync). Sem este aviso o aparelho mostra genéricos que não existem na loja
// como se fossem os equipamentos dela — e dá pra registrar temperatura em cima
// deles. Linguagem de chão de loja: quem lê isso é o colaborador no tablet, não
// o dono. Um toque em "Tentar de novo" resolve; nada de console ou Configurações.
function CatalogStaleBanner({ onRetry, retrying }) {
  return (
    <div role="alert" style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
      padding:'10px 16px', marginBottom:16,
      background:'var(--amber-light)', border:'1px solid var(--amber-border)',
      borderRadius:'var(--r-lg)', flexWrap:'wrap',
    }}>
      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        <strong style={{ color:'var(--amber)', fontSize:13 }}>
          ⚠ Esta não é a lista de equipamentos da sua unidade
        </strong>
        <span style={{ color:'var(--text-secondary)', fontSize:12 }}>
          Não consegui trazer os equipamentos da loja — o que aparece na tela é uma
          lista de exemplo. Confira a internet e toque em “Tentar de novo”. Se continuar
          assim, avise o suporte antes de registrar temperatura.
        </span>
      </div>
      <button onClick={onRetry} disabled={retrying}
        style={{ padding:'6px 14px', borderRadius:'var(--r)', border:'1px solid var(--amber-border)', background:'var(--amber)', color:'white', fontSize:12, fontWeight:600, cursor: retrying ? 'default' : 'pointer', opacity: retrying ? .6 : 1, fontFamily:'var(--font)' }}>
        {retrying ? 'Tentando…' : 'Tentar de novo'}
      </button>
    </div>
  );
}

function LocalModeBanner({ session, activeTenant, setActiveView }) {
  const [enabled, setEnabled] = useState(() => isSupabaseEnabled());
  const [dismissedUntil, setDismissedUntil] = useState(() => {
    const v = localStorage.getItem('nutriops.local.banner.dismissed_until');
    return v ? Number(v) : 0;
  });
  const [localCount, setLocalCount] = useState(() => countLocalRecords(activeTenant?.id));

  // Re-check a cada minuto (caso o usuário tenha ativado em outra aba)
  useEffect(() => {
    const t = setInterval(() => {
      setEnabled(isSupabaseEnabled());
      setLocalCount(countLocalRecords(activeTenant?.id));
    }, 60_000);
    return () => clearInterval(t);
  }, [activeTenant?.id]);

  // Recompute quando o tenant trocar
  useEffect(() => { setLocalCount(countLocalRecords(activeTenant?.id)); }, [activeTenant?.id]);

  const isDismissed = dismissedUntil > Date.now();
  // Cloud-first / online por padrão: qualquer build de PROD é feito com o env
  // VITE_SB_URL → o app auto-conecta no boot (maybeAutoConfigSupabase). Nesse
  // caso NUNCA mostramos "Modo local — configure": online é o default e o
  // eventual estado local é transitório (o auto-backfill sobe sozinho). O banner
  // só sobra pro DEV local (build sem env). Erros reais de conexão (401/RLS) têm
  // o SupabaseAuthErrorBanner à parte.
  const buildEnvHasSupabase = Boolean(import.meta.env.VITE_SB_URL);
  const buildHasSupabase = Boolean(activeTenant?.supabase?.url);
  if (enabled || isDismissed || buildHasSupabase || buildEnvHasSupabase) return null;

  const role = session?.user?.role;
  const canConfigure = role === 'Administrador' || role === 'Super-admin' || role === 'Nutricionista RT';

  // Cor + tom escalam com volume de dados locais — alerta máximo quando a
  // perda potencial é grande.
  let tone = 'amber';
  if (localCount >= 100) tone = 'red';
  else if (localCount >= 20) tone = 'amber';
  // Dismiss curto (1h) — não pode ficar invisível um dia inteiro com risco crescente
  const dismiss = () => {
    const until = Date.now() + 60 * 60 * 1000; // 1h
    localStorage.setItem('nutriops.local.banner.dismissed_until', String(until));
    setDismissedUntil(until);
  };

  const tones = {
    amber: { bg:'var(--amber-light)', border:'var(--amber-border)', fg:'var(--amber)' },
    red:   { bg:'var(--red-light)',   border:'var(--red-border)',   fg:'var(--red)'   },
  };
  const c = tones[tone];

  const headline = tone === 'red'
    ? `⚠ ${localCount} registros só neste dispositivo — risco de perda`
    : localCount > 0
      ? `Modo local — ${localCount} registros aguardando sincronização`
      : 'Modo local — os dados ficam só neste dispositivo';

  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
      padding:'10px 16px', marginBottom:16,
      background:c.bg, border:`1px solid ${c.border}`,
      borderRadius:'var(--r-lg)', flexWrap:'wrap',
    }}>
      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        <strong style={{ color:c.fg, fontSize:13 }}>{headline}</strong>
        <span style={{ color:'var(--text-secondary)', fontSize:12 }}>
          {canConfigure
            ? 'Configure a sincronização em Configurações pra enviar pro Supabase e ver em outros dispositivos.'
            : 'Peça pro administrador habilitar a sincronização em Configurações.'}
        </span>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        {canConfigure && (
          <button onClick={() => setActiveView('settings')}
            style={{ padding:'6px 14px', borderRadius:'var(--r)', border:`1px solid ${c.border}`, background:c.fg, color:'white', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
            Configurar agora
          </button>
        )}
        <button onClick={dismiss}
          style={{ padding:'6px 10px', borderRadius:'var(--r)', border:`1px solid ${c.border}`, background:'transparent', color:c.fg, fontSize:12, fontWeight:500, cursor:'pointer', fontFamily:'var(--font)' }}>
          Dispensar 1h
        </button>
      </div>
    </div>
  );
}

function OfflineIndicator() {
  const [online, setOnline]     = useState(() => navigator.onLine);
  const [queueCount, setQCount] = useState(() => getOfflineQueue().length);
  const [syncing, setSyncing]   = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const syncStatus = getSyncStatus();

  useEffect(() => {
    const up   = () => { setOnline(true);  setQCount(getOfflineQueue().length); };
    const down = () => { setOnline(false); setQCount(getOfflineQueue().length); };
    window.addEventListener('online',  up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setQCount(getOfflineQueue().length), 10000);
    return () => clearInterval(t);
  }, []);

  const handleSync = async () => {
    if (!isSupabaseEnabled()) return;
    setSyncing(true); setSyncResult(null);
    try {
      const result = await supabaseRepository.syncQueue();
      setQCount(getOfflineQueue().length);
      setSyncResult(result);
      setTimeout(() => setSyncResult(null), 4000);
    } catch { /* */ }
    setSyncing(false);
  };

  if (online && queueCount === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 'var(--r-lg)',
      background: online ? 'var(--amber-light)' : 'var(--red-light)',
      border: `1px solid ${online ? 'var(--amber-border)' : 'var(--red-border)'}`,
      boxShadow: 'var(--shadow-lg)',
      fontSize: 13, fontFamily: 'var(--font)',
    }}>
      <span style={{ fontWeight: 600, color: online ? 'var(--amber)' : 'var(--red)' }}>
        {online ? `${queueCount} registro${queueCount > 1 ? 's' : ''} para sincronizar` : 'Sem conexão'}
      </span>
      {online && queueCount > 0 && isSupabaseEnabled() && (
        <button onClick={handleSync} disabled={syncing}
          style={{ padding: '4px 12px', borderRadius: 'var(--r)', border: 'none', background: 'var(--amber)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
          {syncing ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      )}
      {syncResult && (
        // `syncQueue` sempre devolveu {synced, failed, remaining} — a tela só
        // usava `synced` e mostrava em VERDE mesmo quando TUDO falhava ("0
        // sincronizado" em verde é indistinguível de sucesso). Quatro achados
        // da auditoria (18/08) apontavam pro mesmo trecho.
        <span style={{ fontSize: 11, fontWeight: 600, color: syncResult.failed > 0 ? 'var(--red)' : 'var(--green)' }}>
          {syncResult.synced > 0 && `${syncResult.synced} sincronizado${syncResult.synced > 1 ? 's' : ''}`}
          {syncResult.synced > 0 && syncResult.failed > 0 && ' · '}
          {syncResult.failed > 0 && `${syncResult.failed} falhou${syncResult.failed > 1 ? 'ram' : ''} — segue na fila`}
        </span>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// HUB VIEWS — agrupam sub-views relacionadas em tabs (Nexum-style flat nav)
// ═══════════════════════════════════════════════════════════════════════════

function HubTabs({ tabs, current, onChange, hubLabel }) {
  const currentTab = tabs.find(t => t.id === current);
  return (
    <div style={{ marginBottom:16 }}>
      {/* Breadcrumb — orienta "onde estou": Hub › Sub-view atual */}
      {hubLabel && (
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, fontSize:12 }}>
          <span style={{ color:'var(--text-secondary)', fontWeight:600 }}>{hubLabel}</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color:'var(--text-placeholder)', flexShrink:0 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span style={{ color:'var(--text)', fontWeight:700 }}>{currentTab?.label ?? ''}</span>
        </div>
      )}
      {/* Barra de tabs — só quando há 2+ sub-views; com 1 só, o breadcrumb basta */}
      {tabs.length > 1 && (
        <div style={{
          display:'flex', gap:4, padding:4,
          background:'var(--surface-muted)', border:'1px solid var(--border-subtle)',
          borderRadius:'var(--r-lg)', overflowX:'auto',
        }}>
          {tabs.map(t => {
            const isActive = current === t.id;
            return (
              <button key={t.id} onClick={() => onChange(t.id)}
                style={{
                  display:'flex', alignItems:'center', gap:7, padding:'7px 12px',
                  borderRadius:'var(--r)', border:'none', cursor:'pointer',
                  fontFamily:'var(--font)', fontSize:13,
                  fontWeight: isActive ? 600 : 500,
                  background: isActive ? 'var(--surface)' : 'transparent',
                  color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                  boxShadow: isActive ? '0 1px 3px rgba(20,20,19,.06)' : 'none',
                  transition:'all .15s',
                  whiteSpace:'nowrap',
                }}>
                <NavIcon id={t.iconId} />
                <span>{t.label}</span>
                {t.badge > 0 && (
                  <span style={{
                    background:'var(--red)', color:'white', borderRadius:10,
                    fontSize:10, fontWeight:700, padding:'1px 6px', lineHeight:1.4,
                  }}>{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ControlsHub({ activeView, setActiveView, session, ...rest }) {
  const TABS = [
    { id: 'handwash', iconId: 'handwash', label: 'Higiene das mãos',  Component: HandwashView },
    { id: 'oil',      iconId: 'oil',      label: 'Óleo de fritura',   Component: OilControlView },
    { id: 'thaw',     iconId: 'thaw',     label: 'Descongelamento',   Component: ThawControlView },
    { id: 'cooling',  iconId: 'cooling',  label: 'Resfriamento',      Component: CoolingControlView },
    { id: 'thermal',  iconId: 'thermal',  label: 'Tratamento térmico', Component: ThermalControlView },
  ];
  const visibleTabs = TABS.filter(t => canAccess(session?.user?.role, t.id));
  const subIds = visibleTabs.map(t => t.id);
  const current = resolveHubTab(activeView, 'controls', subIds[0] ?? 'handwash', subIds);
  const handleChange = (id) => {
    localStorage.setItem('nutriops.controls.lastTab', id);
    setActiveView(id);
  };
  const Active = visibleTabs.find(t => t.id === current)?.Component;
  if (!Active) return <NoPermission onBack={() => setActiveView('overview')} />;
  return (
    <>
      <HubTabs tabs={visibleTabs} current={current} onChange={handleChange} hubLabel="Controles especiais" />
      <Active session={session} {...rest} />
    </>
  );
}

function ReportsHub({ activeView, setActiveView, session, allTenants, records, ...rest }) {
  const TABS = [
    { id: 'dashboard', iconId: 'dashboard', label: 'Conformidade' },
    { id: 'charts',    iconId: 'charts',    label: 'Gráficos' },
    { id: 'reports',   iconId: 'reports',   label: 'Relatórios' },
    { id: 'monthly',   iconId: 'monthly',   label: 'Exportação mensal' },
    { id: 'audit',     iconId: 'audit',     label: 'Auditoria' },
    { id: 'dossie',    iconId: 'dossie',    label: 'Dossiê Fiscal' },
  ];
  const visibleTabs = TABS.filter(t => canAccess(session?.user?.role, t.id));
  const subIds = visibleTabs.map(t => t.id);
  const current = resolveHubTab(activeView, 'reportsHub', subIds[0] ?? 'dashboard', subIds);
  const handleChange = (id) => {
    localStorage.setItem('nutriops.reportsHub.lastTab', id);
    setActiveView(id);
  };
  const shared = { session, allTenants, records, ...rest };
  if (!visibleTabs.length) return <NoPermission onBack={() => setActiveView('overview')} />;
  return (
    <>
      <HubTabs tabs={visibleTabs} current={current} onChange={handleChange} hubLabel="Relatórios" />
      {current === 'dashboard' && <DashboardView {...shared} />}
      {current === 'charts'    && <ChartsView    {...shared} />}
      {current === 'reports'   && <ReportsView   allTenants={allTenants} records={records} />}
      {current === 'monthly'   && <MonthlyExportView allTenants={allTenants} records={records} session={session} />}
      {current === 'audit'     && <AuditView     allTenants={allTenants} records={records} session={session} onRecordSaved={rest.onRecordSaved} />}
      {current === 'dossie'    && <DossieView    allTenants={allTenants} records={records} />}
    </>
  );
}

function TeamHub({ activeView, setActiveView, session, records, ...rest }) {
  const TABS = [
    { id: 'users',    iconId: 'users',    label: 'Usuários' },
    { id: 'turns',    iconId: 'turns',    label: 'Turnos' },
    { id: 'sessions', iconId: 'sessions', label: 'Histórico de acessos' },
  ];
  const visibleTabs = TABS.filter(t => canAccess(session?.user?.role, t.id));
  const subIds = visibleTabs.map(t => t.id);
  const current = resolveHubTab(activeView, 'team', subIds[0] ?? 'users', subIds);
  const handleChange = (id) => {
    localStorage.setItem('nutriops.team.lastTab', id);
    setActiveView(id);
  };
  const shared = { session, records, ...rest };
  if (!visibleTabs.length) return <NoPermission onBack={() => setActiveView('overview')} />;
  return (
    <>
      <HubTabs tabs={visibleTabs} current={current} onChange={handleChange} hubLabel="Equipe" />
      {current === 'users'    && <UsersView {...shared} />}
      {current === 'turns'    && <TurnsView {...shared} />}
      {current === 'sessions' && <SessionHistoryView {...shared} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════

// Liga o Supabase a partir do tenant (env vars no bundle / onboarding) se ainda
// não estiver configurado. Roda no login E no boot — devices com sessão antiga
// (anterior ao bundle com env vars) ligam o sync ao abrir, sem re-logar. Foi o
// gap que deixou a Swiss em modo local com 91 registros parados. Idempotente:
// shouldAutoConfigSupabase devolve apply:false se já configurado/manual.
function maybeAutoConfigSupabase(tenantId, activeTenants) {
  try {
    const lista = activeTenants ?? [];
    // Tenta o tenant pedido e, se ele não trouxer credencial, QUALQUER outro
    // que traga. Antes olhava só um: se o primeiro da lista fosse um cliente da
    // nuvem (que não carrega `supabase`), o app ficava sem config mesmo tendo a
    // Swiss logo ali com as env do build — e o login por e-mail respondia
    // "Supabase não configurado".
    const tenant = lista.find(t => t.id === tenantId && t.supabase?.url && t.supabase?.anonKey)
                ?? lista.find(t => t.supabase?.url && t.supabase?.anonKey);
    if (!tenant) return false;
    const existing = JSON.parse(localStorage.getItem('nutriops.supabase.config') ?? 'null');
    const decision = shouldAutoConfigSupabase(existing, tenant.supabase);
    if (!decision.apply) return false;
    localStorage.setItem('nutriops.supabase.config', JSON.stringify({
      url: tenant.supabase.url, anonKey: tenant.supabase.anonKey,
      enabled: true, source: 'tenant', syncedAt: new Date().toISOString(),
    }));
    console.info(`[NutriOPS] Supabase auto-configurado pelo tenant ${tenant.id} (${decision.reason})`);
    return true;
  } catch (e) { console.warn('[NutriOPS] auto-config Supabase falhou:', e?.message); return false; }
}

// Funde a empresa vinda da nuvem (get_member_tenants) com a versão que o app já
// tinha em memória — normalmente a loja-seed de tenants-public.js/data.js.
//
// POR QUE: loja-seed (Swiss/Bäckerei/DBK) NÃO tem linha em public.tenants, então
// a RPC devolve os campos ricos vazios (`coalesce(...,'[]')`) e o nome cai pro
// id ('swiss'). Substituir o seed por isso apagava a lista de nomes da equipe —
// e o seletor "Quem está registrando?" abria SEM NOME NENHUM, travando a conta
// de loja na abertura do turno (relatado no teste da Swiss, 05/08). Levava junto
// o catálogo de equipamentos e o nome de exibição.
//
// Regra: o que a nuvem TEM manda (dado fresco); o que ela não tem, mantém do
// seed. Tenant de verdade da nuvem (CASA DOCE) não é afetado — lá tudo vem
// preenchido e vence normalmente.
export function mergeMemberTenant(cloud, seed) {
  if (!seed) return cloud;
  const cheio = (v) => Array.isArray(v) && v.length > 0;
  return {
    ...seed,
    ...cloud,
    // A RPC faz coalesce(t.name, m.tenant_id): sem linha em tenants o "nome" é o
    // próprio id. Aí "Swiss" viraria "swiss" no cabeçalho e no seletor.
    name:     cloud.name && cloud.name !== cloud.id ? cloud.name : seed.name,
    segment:  cloud.segment || seed.segment,
    usersList:        cheio(cloud.usersList)        ? cloud.usersList        : (seed.usersList ?? []),
    equipmentCatalog: cheio(cloud.equipmentCatalog) ? cloud.equipmentCatalog : (seed.equipmentCatalog ?? []),
    stores:           cheio(cloud.stores)           ? cloud.stores           : (seed.stores ?? []),
    multiStore: cloud.multiStore ?? seed.multiStore ?? false,
  };
}

// ─── Novidades da versão ─────────────────────────────────────────────────
// "O que mudou desde a última vez que você abriu" — pedido do dono (10/08),
// inspirado no Nexum. Conteúdo puro em changelog.js; aqui só a UI.
function ChangelogModal({ entries, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:400, padding:24 }}>
      <div className="management-card" style={{ width:'100%', maxWidth:480, maxHeight:'80vh', display:'flex', flexDirection:'column' }}>
        <div className="card-head">
          <div><span className="eyebrow">Novidades</span><h2>O que mudou no NutriOPS</h2></div>
        </div>
        <div style={{ overflowY:'auto', flex:1, minHeight:0, padding:'4px 20px' }}>
          {entries.map((e) => (
            <div key={e.version} style={{ padding:'12px 0', borderBottom:'1px solid var(--border-subtle)' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:6 }}>
                v{e.version} · {new Date(`${e.date}T12:00`).toLocaleDateString('pt-BR')}
              </div>
              <ul style={{ margin:0, paddingLeft:18, display:'flex', flexDirection:'column', gap:6 }}>
                {e.items.map((item, i) => <li key={i} style={{ fontSize:13, lineHeight:1.5 }}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="actions-row" style={{ padding:'12px 20px', borderTop:'1px solid var(--border-subtle)' }}>
          <button className="primary-action" onClick={onClose}>Entendi</button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const repository = useMemo(() => getTemperatureRepository(), []);
  const [session, setSession]         = useState(() => readSession());
  // `?? defaultTenants` só troca de fonte quando o storage é NULL — um device
  // que já tem qualquer tenant salvo localmente nunca ganha um cliente NOVO
  // adicionado ao seed (data.js) depois. `mesclaTenants` (usada na constante
  // `tenants` do módulo, linha 91) é a lógica certa: salvos + o que falta do
  // seed. `activeTenants` reimplementava errado a mesma coisa que já existia
  // certa 2400 linhas acima. Achado da auditoria (18/08).
  const [activeTenants, setActiveTenants] = useState(() => mesclaTenants(readOnboardingTenants(), defaultTenants));

  // Novidades da versão — só pra quem já usava o app antes (1º acesso não
  // mostra nada, só passa a acompanhar a partir daqui).
  //
  // Marca como visto ao FECHAR, não ao mostrar. A versão anterior gravava no
  // momento em que o modal aparecia, e isso batia de frente com o reload
  // automático do service worker: sw.js chama skipWaiting() no install →
  // clients.claim() dispara controllerchange → main.jsx recarrega a página
  // 100ms depois. Ou seja, logo depois de um deploy o modal abria, o
  // localStorage já era gravado, o reload vinha por cima e as novidades
  // sumiam PRA SEMPRE sem ninguém ter lido (relatado pelo dono em 15/08:
  // "aparece e some rapidamente sem que eu dê um clique").
  //
  // Reaparecer num reload acidental (o receio do comentário antigo) é o
  // problema menor: se não foi fechado, não foi lido.
  const [changelogEntries, setChangelogEntries] = useState([]);
  useEffect(() => {
    if (!session) return;
    const lastSeen = localStorage.getItem('nutriops.changelog.lastSeen');
    // 1º acesso: não despeja o histórico inteiro em quem acabou de chegar —
    // só crava o ponto de partida. Esta escrita PRECISA continuar aqui: sem
    // ela o lastSeen ficaria null pra sempre e o usuário novo nunca mais
    // veria novidade nenhuma (getUnseenEntries devolve [] pra null).
    if (!lastSeen) {
      try { localStorage.setItem('nutriops.changelog.lastSeen', APP_VERSION); } catch {}
      return;
    }
    const unseen = getUnseenEntries(lastSeen);
    if (unseen.length > 0) setChangelogEntries(unseen);
  }, [session]);

  const dismissChangelog = useCallback(() => {
    try { localStorage.setItem('nutriops.changelog.lastSeen', APP_VERSION); } catch {}
    setChangelogEntries([]);
  }, []);

  const handleLogin = useCallback((s, memberTenants) => {
    // Fase 3: login por e-mail de um membro traz as empresas dele (com metadata
    // completa da RPC get_member_tenants). Funde no activeTenants pra a loja
    // renderizar num device novo, mesmo sem ter entrado via link ?token=.
    // Membership tem precedência (dado fresco da nuvem) sobre o que já havia.
    if (Array.isArray(memberTenants) && memberTenants.length > 0) {
      const ids = new Set(memberTenants.map((t) => t.id));
      setActiveTenants((prev) => [
        ...memberTenants.map((c) => mergeMemberTenant(c, prev.find((p) => p.id === c.id))),
        ...prev.filter((t) => !ids.has(t.id)),
      ]);
    }
    setSession(s);
    // logSession é uma chamada one-shot — usa dynamic import pra não puxar
    // extras.jsx no boot (33KB+).
    import('./extras').then(m => m.logSession(s.tenantId, s.user)).catch(() => {});
    // Auto-config Supabase a partir do tenant (env vars / onboarding) — liga o
    // sync pra devices que não entraram via link ?token=.
    maybeAutoConfigSupabase(s.tenantId, activeTenants);
  }, [activeTenants]);
  const handleLogout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    // Limpa TUDO que tem credencial/estado sensível — senão, num tablet
    // compartilhado, o token do admin (na sessão de impersonação e na auth
    // session do Supabase) ficaria em texto claro após "Sair", e o 2FA do
    // Super Admin seria pulado pela próxima sessão na mesma aba.
    try { localStorage.removeItem('nutriops.impersonation.origin'); } catch {}
    try { sessionStorage.removeItem('nutriops.superadmin.mfa'); } catch {}
    import('./auth').then(m => m.signOut()).catch(() => {}); // limpa nutriops.auth.session + logout no Supabase
    setSession(null);
  }, []);

  // Guarda de FORMA da sessão (30/07): sessão Supabase sem NENHUM vínculo
  // (sem tenantId, sem memberTenants) e sem carimbo de admin da plataforma não
  // tem estado legítimo — é a sessão contaminada pré-v1.9.74 ainda gravada no
  // device, ou um login antigo que passou sem vínculo. Sem isto ela caía em
  // activeTenants[0] (Swiss) e lia dados reais de outro cliente via
  // device-token. Fail closed: desloga; o re-login refaz o vínculo ou barra
  // (login.jsx). PIN (sem accessToken) e impersonação não passam por aqui.
  useEffect(() => {
    if (!session?.accessToken) return;
    if (session.isPlatformAdmin === true) return;
    if (session.tenantId || session.memberTenants?.length > 0) return;
    handleLogout();
  }, [session, handleLogout]);

  // Show onboarding wizard for genuinely new users (no session, no onboarding data, not on demo)
  // Show onboarding only when accessed via token (new client link)
  // or when explicitly requested via ?onboarding=1
  const hasToken        = Boolean(localStorage.getItem('nutriops.access.token'));
  const wantsOnboarding = window.location.search.includes('onboarding=1');

  // Tenant criado via /admin (vem do Supabase com setupPinHash). Quando ainda
  // não tem usersList povoado, o cliente precisa passar pelo SetupPinScreen
  // antes de virar tenant operacional.
  const pendingSetupTenant = !session && hasToken
    ? (activeTenants ?? []).find(t => t.setupPinHash && (!t.usersList || t.usersList.length === 0))
    : null;

  const isNewUser = !session && !pendingSetupTenant && !readOnboardingTenants() && (hasToken || wantsOnboarding);

  const handleOnboardingComplete = (newTenants) => {
    setActiveTenants(newTenants);
    writeOnboardingTenants(newTenants);
  };

  const handleSetupComplete = (newSession, updatedTenant) => {
    setActiveTenants(prev => {
      const others = prev.filter(t => t.id !== updatedTenant.id);
      return [updatedTenant, ...others];
    });
    setSession(newSession);
  };

  const perms = getPermissions(session?.user?.role);
  // Isolamento: só o admin GLOBAL (sem tenantId) vê/carrega/troca TODAS as
  // empresas. Um usuário preso a um tenant (admin de cliente OU equipe de loja)
  // vê só a própria — senão um Administrador de cliente enxergava as lojas-seed
  // embutidas no build (vazamento cross-tenant client-side).
  const seesAllTenants = isGlobalAdmin(session);

  // activeTenants (state), não o `tenants` congelado do módulo — e o fallback
  // pra primeira loja só vale pra quem PODE ver todas (admin) ou sessão PIN
  // (sempre tem tenantId). A guarda de forma abaixo desloga sessão Supabase
  // sem vínculo antes de qualquer dado carregar.
  const [activeTenantId, setActiveTenantId] = useState(() => session?.tenantId ?? activeTenants[0]?.id ?? null);
  const [activeStoreId, setActiveStoreId]   = useState(() => session?.storeId ?? null);
  const [activeView, setActiveView]         = useState('overview');
  const [records, setRecords]               = useState([]);

  // Always derive activeTenant from tenants list.
  // activeTenants É dependência: quando a empresa do membro é hidratada no boot
  // (Fase 3), o memo precisa recalcular pra achar a loja recém-adicionada —
  // senão fica preso no fallback activeTenants[0] (aparecia "Swiss" pro dono da
  // CASA DOCE após reload).
  const activeTenant = useMemo(() => {
    const found = activeTenants.find((t) => t.id === activeTenantId);
    if (found) return found;
    const own = activeTenants.find((t) => t.id === session?.tenantId);
    if (own) return own;
    // Sessão presa a uma loja que (ainda) não está na lista — membro da nuvem
    // no boot, antes da hidratação chegar ou quando ela falha. NUNCA cair numa
    // loja-seed de outro cliente: era o resquício do vazamento de 30/07 — o
    // membro via a tela da Swiss e refreshRecords carregava os dados dela via
    // device-token. Stub mínimo da própria loja; os dados corretos já carregam
    // pelo JWT do membro (memberTokenFor casa por session.tenantId).
    if (session?.tenantId) {
      return {
        id: session.tenantId,
        name: session.user?.location || 'Sua empresa',
        segment: '', equipmentCatalog: [], stores: [],
      };
    }
    return activeTenants[0];
  }, [activeTenantId, session?.tenantId, session?.user?.location, activeTenants]);

  // Fase 3 — hidrata a empresa do membro no BOOT. A sessão (com tenantId da loja)
  // persiste no localStorage, mas activeTenants é reconstruído das lojas-seed a
  // cada boot, SEM a empresa do membro (ex.: CASA DOCE). Sem isto, após reload o
  // app não achava a loja e caía no fallback activeTenants[0] (aparecia "Swiss"
  // pro dono da CASA DOCE). Só dispara quando a loja da sessão não está na lista
  // — logins por PIN (tenant seed) já estão presentes, então não são afetados.
  useEffect(() => {
    if (!session?.tenantId) return;
    // A guarda checava SÓ session.tenantId (a unidade primária). Se ela é uma
    // loja-seed — sempre presente em activeTenants, mesmo antes de qualquer
    // hidratação — a guarda dava `true` no 1º boot e o efeito NUNCA rodava,
    // mesmo com a RT tendo uma SEGUNDA unidade (ex.: CASA DOCE) que não está
    // no seed. handleLogin (login fresco) hidrata as duas certo; um F5 na
    // mesma sessão persistida caía aqui e a segunda unidade sumia da lista de
    // empresas até logar de novo. Achado da auditoria (18/08).
    const necessarios = session.memberTenants?.length > 0
      ? session.memberTenants.map((m) => m.id)
      : [session.tenantId];
    if (necessarios.every((id) => activeTenants.some((t) => t.id === id))) return;
    let cancelled = false;
    import('./tenant-sync')
      .then((m) => m.fetchMemberTenants())
      .then((list) => {
        if (cancelled || !Array.isArray(list) || list.length === 0) return;
        const ids = new Set(list.map((t) => t.id));
        setActiveTenants((prev) => [
          ...list.map((c) => mergeMemberTenant(c, prev.find((p) => p.id === c.id))),
          ...prev.filter((t) => !ids.has(t.id)),
        ]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session?.tenantId, session?.memberTenants, activeTenants]);

  // Active store object
  const activeStore = useMemo(() => {
    if (!activeStoreId) return activeTenant.stores?.[0] ?? null;
    return activeTenant.stores?.find(s => s.id === activeStoreId) ?? activeTenant.stores?.[0] ?? null;
  }, [activeTenant, activeStoreId]);

  // Contador que força reler o catálogo do localStorage depois do sync.
  //
  // BUG (07/08, relatado no celular do colaborador da CASA DOCE): device novo
  // mostrava só 4 equipamentos — "Câmara Refrigerada, Câmara Congelada, Vitrine
  // Refrigerada, Balcão Refrigerado", todos em "Unidade principal". São os
  // DEFAULTS do segmento 'padaria' (segments.js), gravados no jsonb
  // equipment_catalog de public.tenants quando a loja nasceu no /admin. Os 44
  // reais vivem na TABELA equipment_catalog.
  //
  // No boot: localStorage vazio → cai no jsonb (4 velhos) → syncEquipmentCatalog
  // traz os 44 e grava no localStorage → mas o useMemo só dependia de
  // [activeTenant, activeStoreId], então a tela continuava nos 4 até um reload
  // manual. Quem já tinha o app aberto antes (o dono) via os 44 e não percebia.
  const [catalogVersion, setCatalogVersion] = useState(0);
  // Catálogo preso no provisório de fábrica + nuvem inacessível — ver a
  // auto-cura no doSync e o CatalogStaleBanner.
  const [catalogStale, setCatalogStale] = useState(false);
  const [catalogRetrying, setCatalogRetrying] = useState(false);

  // Equipment catalog — store-specific if multi-store
  const equipmentCatalog = useMemo(() => {
    const raw = (activeTenant.multiStore && activeStoreId && activeTenant.storeEquipment?.[activeStoreId])
      ? activeTenant.storeEquipment[activeStoreId]
      : readEquipmentCatalog(activeTenant);
    // Dedup por label — catálogo da nuvem às vezes vem com equipamento repetido
    // (recadastro/caixa diferente), o que dobrava os alertas de turno. Ver Swiss.
    return dedupeCatalog(raw);
    // catalogVersion: o sync escreve o catálogo no localStorage, fora do React.
    // Sem esta dep o useMemo nunca reavalia e o device fica preso no que tinha
    // no primeiro render — ver o bug do "só 4 equipamentos" abaixo.
  }, [activeTenant, activeStoreId, catalogVersion]);

  const visibleTenants = useMemo(() => {
    // activeTenants (state), NÃO o `tenants` do módulo: aquele é congelado no
    // load com as lojas-seed, então clientes da nuvem (CASA DOCE) ficavam de
    // fora da lista do admin global. Efeito colateral cruel: o <select> das
    // telas recebe value=activeTenant.id sem uma <option> correspondente, o
    // navegador exibe a PRIMEIRA opção ("Swiss") e a tela inteira parecia ser
    // da Swiss enquanto mostrava dados da CASA DOCE (falso "44 equipamentos
    // na Swiss", 30/07).
    if (seesAllTenants) return activeTenants;
    // Membro por e-mail (Fase 3): vê as empresas do próprio vínculo — resolve a
    // RT com 3 unidades e a supervisora com 2. Aditivo: sessão por PIN não tem
    // memberTenants, então cai no comportamento antigo.
    if (session?.memberTenants?.length > 0) {
      const ids = new Set(session.memberTenants.map((m) => m.id));
      const mine = activeTenants.filter((t) => ids.has(t.id));
      if (mine.length > 0) return mine;
    }
    const own = activeTenants.filter((t) => t.id === session?.tenantId);
    return own.length > 0 ? own : [activeTenant];
  }, [seesAllTenants, session?.tenantId, session?.memberTenants, activeTenant, activeTenants]);

  const handleTenantChange = useCallback((id) => {
    if (!seesAllTenants) return;
    setActiveTenantId(id);
    const t = activeTenants.find(x => x.id === id);
    setActiveStoreId(t?.stores?.[0]?.id ?? null);
  }, [seesAllTenants, activeTenants]);

  const handleStoreChange = useCallback((storeId) => {
    setActiveStoreId(storeId);
  }, []);

  // Retry de um toque do CatalogStaleBanner — sem console, sem Configurações.
  const retryCatalogSync = useCallback(async () => {
    if (!session?.tenantId) return;
    setCatalogRetrying(true);
    try {
      const eq = await syncEquipmentCatalog(session.tenantId);
      if (eq.ok && eq.count > 0) {
        setCatalogVersion((v) => v + 1);
        setCatalogStale(false);
      }
    } catch (e) {
      console.warn('[NutriOPS] retry do catálogo falhou:', e?.message ?? e);
    }
    setCatalogRetrying(false);
  }, [session?.tenantId]);

  // ─── Operador (conta de loja) ────────────────────────────────────────────
  // O nome escolhido entra em session.user.name — é assim que os 14 pontos que
  // carimbam registro passam a gravar a PESSOA em vez do nome genérico da loja,
  // sem precisar tocar em nenhum deles. O papel continua o da conta (permissão
  // é da conta, não de quem tocou no nome).
  const [operatorPickerOpen, setOperatorPickerOpen] = useState(false);
  const applyOperator = useCallback((nome) => {
    setOperatorPickerOpen(false);
    setSession((prev) => {
      const next = applyOperatorToSession(prev, nome);
      if (next !== prev) save(SESSION_KEY, next);
      return next;
    });
  }, []);

  // ─── Troca de empresa (relogin) ──────────────────────────────────────────
  // Empresas que o usuário pode COMUTAR (distinto de multiTenant, que é ver
  // dados agregados). Supervisor/RT/Admin podem trocar; Colaborador não.
  // activeTenants (state), não o `tenants` do módulo: a lista congelada não
  // tem os clientes da nuvem (CASA DOCE) — o switcher do avatar/drawer ficava
  // sem a loja e o <select> exibia "Swiss" por fallback (mesma classe do bug
  // corrigido na v1.9.72 em visibleTenants/refreshRecords).
  const switchableTenants = useMemo(
    () => (seesAllTenants ? activeTenants : []),
    [seesAllTenants, activeTenants]
  );
  const [switchTarget, setSwitchTarget] = useState(null);

  const requestTenantSwitch = useCallback((id) => {
    if (id === activeTenantId) return;
    // RT/Admin já têm acesso agregado autorizado → troca instantânea (sem atrito).
    // Supervisora (sem multiTenant) → relogin com PIN da empresa-alvo.
    if (seesAllTenants) { handleTenantChange(id); return; }
    const t = activeTenants.find(x => x.id === id);
    if (t) setSwitchTarget(t);
  }, [activeTenantId, seesAllTenants, handleTenantChange, activeTenants]);

  const handleSwitchSuccess = useCallback((newSession) => {
    setSwitchTarget(null);
    save(SESSION_KEY, newSession);
    setActiveTenantId(newSession.tenantId);
    setActiveStoreId(newSession.user?.storeId ?? null);
    setActiveView('overview');
    handleLogin(newSession); // setSession + logSession + auto-config Supabase
  }, [handleLogin]);

  // ─── Impersonation ("logar como") — Super Admin entra num tenant ──────────
  const IMPERSONATE_ORIGIN_KEY = 'nutriops.impersonation.origin';
  const handleImpersonate = useCallback((tenant) => {
    if (!isGlobalAdmin(session)) return;
    import('./superadmin').then(m => m.appendAudit({
      type: 'impersonate_start', tenantId: tenant.id, tenantName: tenant.name,
      actor: session?.user?.name ?? session?.user?.email ?? 'admin',
    })).catch(() => {});
    // Guarda a sessão original do admin global pra poder VOLTAR.
    save(IMPERSONATE_ORIGIN_KEY, session);
    const imp = {
      tenantId: tenant.id,
      _impersonating: true,
      _impersonatedName: tenant.name,
      user: {
        id: `${tenant.id}-superadmin`,
        name: session?.user?.name ?? 'Super Admin',
        role: 'Administrador',
        location: 'Impersonação (Super Admin)',
        storeId: null,
      },
    };
    save(SESSION_KEY, imp);
    setActiveTenantId(tenant.id);
    setActiveStoreId(null);
    setActiveView('overview');
    handleLogin(imp);
  }, [session, handleLogin]);

  const handleExitImpersonation = useCallback(() => {
    const origin = load(IMPERSONATE_ORIGIN_KEY, null);
    import('./superadmin').then(m => m.appendAudit({
      type: 'impersonate_end', tenantId: session?.tenantId, tenantName: session?._impersonatedName,
      actor: origin?.user?.name ?? 'admin',
    })).catch(() => {});
    try { localStorage.removeItem(IMPERSONATE_ORIGIN_KEY); } catch {}
    if (origin) {
      save(SESSION_KEY, origin);
      setActiveTenantId(origin.tenantId ?? activeTenants[0]?.id ?? null);
      setActiveStoreId(null);
      setActiveView('superadmin');
      handleLogin(origin);
    } else {
      handleLogout();
    }
  }, [session, handleLogin, handleLogout, activeTenants]);

  useEffect(() => {
    if (session?.tenantId && !seesAllTenants) {
      setActiveTenantId(session.tenantId);
      // Lock collaborator to their store
      if (session?.user?.storeId) setActiveStoreId(session.user.storeId);
    }
  }, [session?.tenantId, session?.user?.storeId, seesAllTenants]);

  const refreshRecords = useCallback(async () => {
    // Load records for all companies (RT/Admin) or just own company
    // Mesmo motivo do visibleTenants: com o `tenants` do módulo, o admin global
    // nunca carregava os registros de clientes da nuvem (CASA DOCE aparecia
    // sempre com 0 leituras).
    const tenantsToLoad = seesAllTenants ? activeTenants : [activeTenant];
    const all = await Promise.all(tenantsToLoad.map(async (t) => { const items = await repository.list({ tenantId: t.id, days: 90 }); return items.map((r) => ({ ...r, tenantName: r.tenantName ?? t.name })); }));
    setRecords(all.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }, [repository, seesAllTenants, activeTenant, activeTenants]);

  useEffect(() => { refreshRecords(); }, [refreshRecords]);

  // ─── Atualização automática entre aparelhos (17/08) ───────────────────────
  // Relato da CASA DOCE: "conectado em 2 tablets e 3 computadores; quando
  // registra no computador não atualiza nos tablets, só quando desconecta e
  // entra de novo". Estava certo — até aqui o app só buscava dados da nuvem em
  // DOIS momentos: no boot e no evento 'online'. Um tablet que fica na parede o
  // dia inteiro nunca mais consultava.
  //
  // Três gatilhos, todos baratos (uma requisição por loja visível):
  //   · a cada 2 min, mas SÓ com a aba visível — tablet em standby não gasta
  //     rede nem bateria à toa;
  //   · quando a aba volta a ficar visível (voltar do standby é o caso comum
  //     no tablet);
  //   · quando a janela recebe foco (o caso comum no computador).
  //
  // Vale também no Modo Quiosque: ele é um `return` antecipado DENTRO do App,
  // e hook não se importa com early return — este efeito continua rodando.
  useEffect(() => {
    const atualizar = () => { if (document.visibilityState === 'visible') refreshRecords(); };
    const t = setInterval(atualizar, 120000);
    document.addEventListener('visibilitychange', atualizar);
    window.addEventListener('focus', atualizar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', atualizar);
      window.removeEventListener('focus', atualizar);
    };
  }, [refreshRecords]);

  const turns       = readTurns(activeTenant);
  const [alertsTick, setAlertsTick] = useState(0); // bump ao dar ciência → recomputa badge/lista
  const alertCount  = useMemo(() => computeTurnAlerts(turns, records, equipmentCatalog, activeTenant.id, activeTenant.implantacao === true).length, [records, activeTenant.id, activeTenant.implantacao, equipmentCatalog, alertsTick]);
  const maintAlertCount = useMemo(() => {
    const equips = JSON.parse(localStorage.getItem(`nutriops.equip_assets.${activeTenant.id}`) ?? '[]');
    const logs   = JSON.parse(localStorage.getItem(`nutriops.maint_logs.${activeTenant.id}`) ?? '[]');
    return equips.reduce((count, eq) => {
      return count + (eq.maintenancePlans ?? []).filter(plan => {
        const last = logs.filter(l=>l.equipmentId===eq.id&&l.planId===plan.id).sort((a,b)=>new Date(b.executedAt)-new Date(a.executedAt))[0];
        const nextDue = last ? addDays(last.executedAt, plan.frequencyDays) : plan.nextDue;
        const days = Math.ceil((new Date(nextDue).getTime() - new Date().setHours(0,0,0,0)) / 86400000);
        return days <= 7;
      }).length;
    }, 0);
  }, [activeTenant.id]);
  const actionCount = useMemo(() => readActions(activeTenant.id).filter((a) => a.status !== 'resolvida').length, [records, activeTenant.id]);
  const { permission: notifPermission, request: requestNotif, notify: browserNotify } = useBrowserNotifications(turns, activeTenant.id);

  // Kiosk mode — restaura sozinho se o tablet recarregar (reload acidental,
  // atualização do service worker) enquanto estava em modo quiosque. Antes
  // `readKioskConfig` existia e nunca era chamada: qualquer reload devolvia o
  // tablet pro app normal, perdendo a seleção de equipamentos configurada.
  // Só restaura se o tenant bater — um config órfão de outra loja (ex.: a
  // conta trocou de empresa) não deve reabrir o quiosque errado.
  const [kioskConfig, setKioskConfig]   = useState(() => resolveInitialKioskConfig(readKioskConfig(), activeTenant.id));
  const [showKioskSetup, setShowKioskSetup] = useState(false);
  // Global search
  const [showSearch, setShowSearch]     = useState(false);
  // Mobile drawer
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Notify on out-of-range save
  const handleRecordSaved = useCallback(async () => {
    await refreshRecords();
  }, [refreshRecords]);

  // Log status do sync no boot — visibilidade pra debugar device cliente
  // direto do DevTools. Roda 1x por sessão.
  useEffect(() => {
    const cfg = getSupabaseConfig();
    const queue = getOfflineQueue();
    const status = getSyncStatus();
    console.info('[NutriOPS] boot — Supabase:',
      isSupabaseEnabled() ? `ON (${cfg.url})` : 'OFF (modo local)',
      '| queue:', queue.length,
      '| last sync:', status?.lastSync ?? 'nunca'
    );
    if (!isSupabaseEnabled() && queue.length === 0) {
      // Conta registros locais por módulo pra mostrar o que está em risco
      try {
        const temps = JSON.parse(localStorage.getItem('nutriops.temperature.records') ?? '[]').length;
        if (temps > 0) console.warn(`[NutriOPS] ⚠ ${temps} registros de temperatura só locais — habilite o Supabase em Configurações.`);
      } catch {}
    }
  }, []);

  // Auto-sync on login and when coming online
  useEffect(() => {
    if (!session) return;
    // Auto-config também no boot: device com sessão antiga (anterior ao bundle
    // com env vars) liga o Supabase ao abrir, sem precisar re-logar. Roda ANTES
    // do check abaixo pra que o sync prossiga já na primeira carga.
    maybeAutoConfigSupabase(session.tenantId, activeTenants);
    if (!isSupabaseEnabled()) {
      console.info('[NutriOPS] auto-sync skip — Supabase desativado neste dispositivo');
      return;
    }
    const doSync = async (trigger = 'boot') => {
      if (!navigator.onLine) { console.info(`[NutriOPS] auto-sync skip (${trigger}) — offline`); return; }
      // Health-check de write — se POST falha por RLS ou auth, o banner
      // vermelho aparece. Throttle pra 1x/dia (evita round trip + linha
      // __healthcheck__ extra em todo boot), MAS roda sempre que há fila
      // pendente, porque aí queremos saber se a escrita voltou a funcionar.
      if (trigger === 'boot') {
        const HC_KEY = 'nutriops.healthcheck.last';
        const lastHc = Number(localStorage.getItem(HC_KEY) || 0);
        const queueLen = getOfflineQueue().length;
        const stale = Date.now() - lastHc > 24 * 60 * 60 * 1000;
        if (stale || queueLen > 0) {
          const probe = await supabaseRepository.testWrite();
          try { localStorage.setItem(HC_KEY, String(Date.now())); } catch {}
          if (!probe.ok) {
            console.warn(`[NutriOPS] testWrite failed — ${probe.reason}`, probe);
          } else {
            console.info('[NutriOPS] testWrite ok — Supabase aceita escrita');
          }
        }
      }
      console.info(`[NutriOPS] auto-sync start (${trigger}) tenant=${session.tenantId}`);
      try {
        const result = await syncAllModules(session.tenantId);
        console.info(`[NutriOPS] auto-sync done (${trigger}) — ${result.synced}/${result.total} módulos`);
        // O sync gravou catálogo/equipe direto no localStorage. Sem este bump a
        // tela segue mostrando o que leu no primeiro render (o bug dos 4).
        setCatalogVersion((v) => v + 1);
        // Mesmo problema, outras telas: os 5 controles especiais e a higienização
        // das mãos leem a lista deles no mount e nunca mais. O bump acima só
        // alcança quem recebe `catalogVersion` por prop. Este evento alcança
        // qualquer tela aberta — elas se reinscrevem sozinhas (ver lista-local.js).
        notificarSyncAplicado({ tenantId: session.tenantId, trigger });

        // ── Auto-cura do catálogo de equipamentos ───────────────────────────
        // O bump acima só resolve quando o sync FUNCIONOU. Quando ele falha,
        // `syncEquipmentCatalog` devolve {ok:false} e escreve no console — e
        // num tablet ninguém lê console. O device fica exibindo o catálogo de
        // fábrica (genéricos em "Unidade principal") como se fosse o da loja.
        // Foi o que aconteceu na CASA DOCE em 10/08: 44 equipamentos em 11
        // setores na nuvem, 4 falsos num setor só na tela — lido como "o app
        // parou de agrupar". Aqui a gente olha o que a tela REALMENTE vai
        // mostrar; se for o provisório, tenta de novo e, persistindo, avisa em
        // português em vez de deixar o aparelho mentindo em silêncio.
        const tenantAtual = activeTenants.find((t) => t.id === session.tenantId);
        const naTela = dedupeCatalog(readEquipmentCatalog(tenantAtual ?? { id: session.tenantId }));
        if (naTela.length === 0 || isPlaceholderCatalog(naTela)) {
          const eq = await syncEquipmentCatalog(session.tenantId);
          if (eq.ok && eq.count > 0) {
            setCatalogVersion((v) => v + 1);
            setCatalogStale(false);
          } else if (isPlaceholderCatalog(naTela)) {
            // Chegamos aqui de dois jeitos, e o alerta vale pros dois:
            //  · {ok:false} — rede/credencial caiu;
            //  · {ok:true, count:0} — o PostgREST devolve LISTA VAZIA quando o
            //    RLS filtra tudo, não um erro. Ou seja: "não veio nada" não
            //    prova que a loja não tem equipamento.
            // Como a tela está no provisório de fábrica, nos dois casos a
            // pessoa vê equipamento que não existe na unidade dela — e pode
            // registrar temperatura em cima. Alertar é o certo.
            console.warn(`[NutriOPS] catálogo preso no provisório — ok=${eq.ok} count=${eq.count ?? 0} ${eq.reason ?? ''}`);
            setCatalogStale(true);
          }
          // Tela vazia + nuvem vazia → "nenhum equipamento" já diz a verdade
          // sozinho. Não alarma (é a loja nova que ainda não cadastrou nada).
        }

        // Auto-backfill (auto-cura sem admin): na 1ª conexão bem-sucedida do
        // device, empurra o histórico local que não passou pela fila (registros
        // antigos). Roda 1x por device — depois o push/fila normal cuida do dia
        // a dia. Idempotente (merge-duplicates). Assim NINGUÉM precisa logar
        // como admin nem ir até a máquina pra migrar.
        //
        // ⚠️ SÓ AS LOJAS QUE A SESSÃO ALCANÇA (16/08). Até aqui usava
        // `activeTenants` — TODAS as lojas do device (Swiss/Bäckerei/DBK/CASA
        // DOCE), sem filtrar por quem está logado. Uma sessão de loja única
        // (a CASA DOCE, por e-mail) tentava empurrar as OUTRAS três também;
        // RLS recusa (42501 — corretamente, é isolamento entre lojas
        // funcionando), o backfill nunca fecha com `failed === 0`, nunca marca
        // `done`, e repete a cada boot pra sempre. Sintoma em produção: POST
        // temperature_records 401 em loop no console da CASA DOCE (15/08).
        // `visibleTenants` já é a lista certa — a mesma que a tela de
        // Prontidão usa pra não vazar dado entre lojas.
        if (trigger === 'boot') {
          // v2 (Fatia 3, 15/08): POPs/capacitação/validações RT entraram no
          // migrate. O bump faz devices que já backfillaram na v1 rodarem UMA
          // vez de novo — é o que sobe o acervo antigo da RT sem ninguém
          // precisar apertar "migrar". Idempotente (merge-duplicates).
          // v3 (Fatia 2b): perfil do estabelecimento e documentos de
          // conformidade entraram no migrate.
          // v4 (16/08): escopo corrigido pra visibleTenants — bump necessário
          // pra devices presos no loop da v3 pararem de tentar as lojas alheias.
          const BACKFILL_KEY = 'nutriops.autobackfill.v4';
          const alreadyDone = localStorage.getItem(BACKFILL_KEY) === 'done';
          const localCount = countAllLocalRecords(visibleTenants);
          if (shouldAutoBackfill({ enabled: isSupabaseEnabled(), online: navigator.onLine, alreadyDone, localCount })) {
            console.info(`[NutriOPS] auto-backfill — ${localCount} registros locais, enviando…`);
            try {
              const mig = await migrateAllToSupabase(visibleTenants);
              if (mig.ok && mig.failed === 0) {
                localStorage.setItem(BACKFILL_KEY, 'done');
                console.info(`[NutriOPS] auto-backfill ok — ${mig.pushed} registros enviados`);
              } else {
                console.warn('[NutriOPS] auto-backfill incompleto — repete no próximo boot', mig);
              }
            } catch (e) {
              console.warn('[NutriOPS] auto-backfill falhou:', e?.message ?? e);
            }
          } else if (!alreadyDone && localCount === 0) {
            // Nada local pra subir → marca done pra não checar todo boot.
            localStorage.setItem(BACKFILL_KEY, 'done');
          }
        }
      } catch (e) {
        console.warn(`[NutriOPS] auto-sync failed (${trigger}):`, e?.message ?? e);
      }
    };
    doSync('boot');
    const onlineHandler = () => doSync('online-event');
    window.addEventListener('online', onlineHandler);
    return () => window.removeEventListener('online', onlineHandler);
  }, [session?.tenantId]);
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true); }
      if (e.key === 'Escape') setShowSearch(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Check if accessed via token and account is blocked
  const accessToken = localStorage.getItem('nutriops.access.token');
  if (accessToken) {
    const clients = readClients();
    const client  = clients.find(c => c.accessToken === accessToken);
    if (client && !client.active) {
      return (
        <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'var(--bg)', padding:24 }}>
          <div style={{ textAlign:'center', maxWidth:360 }}>
            <div style={{ fontSize:56, marginBottom:16 }}>🔒</div>
            <h2 style={{ fontSize:22, fontWeight:800, marginBottom:8 }}>Conta inativa</h2>
            <p style={{ color:'var(--text-secondary)', marginBottom:24 }}>Sua conta NutriOPS está temporariamente inativa. Entre em contato com o suporte.</p>
            <a href="mailto:suporte@nutriops.com.br" style={{ display:'inline-block', padding:'10px 24px', background:'var(--blue)', color:'white', borderRadius:8, textDecoration:'none', fontWeight:700 }}>
              Falar com suporte
            </a>
          </div>
        </div>
      );
    }
  }

  // Trial / access status check
  const trialStatus = useMemo(() => checkTrialStatus(), [session]);

  // Track usage on login
  useEffect(() => {
    if (session?.tenantId) trackUsage(session.tenantId, 'session');
  }, [session?.tenantId]);

  // Track view changes
  useEffect(() => {
    if (session?.tenantId && activeView) trackUsage(session.tenantId, activeView);
  }, [activeView, session?.tenantId]);

  if (pendingSetupTenant) return (
    <Suspense fallback={<ViewLoading />}>
      <SetupPinScreen tenant={pendingSetupTenant} onComplete={handleSetupComplete} />
    </Suspense>
  );

  if (isNewUser) return (
    <Suspense fallback={<ViewLoading />}>
      <OnboardingWizard onComplete={handleOnboardingComplete} onHaveAccount={() => {
        localStorage.removeItem('nutriops.access.token');
        window.location.href = '/';
      }} />
    </Suspense>
  );

  if (!session) return (
    <Suspense fallback={<ViewLoading />}>
      <LoginScreen onLogin={handleLogin} />
    </Suspense>
  );

  // Trial expired — show paywall
  if (!trialStatus.ok && trialStatus.reason === 'trial_expired') {
    return <TrialExpiredScreen client={trialStatus.client} />;
  }

  // Conta de LOJA sem operador escolhido (abertura de turno, ou o anterior
  // expirou): trava antes de qualquer registro. Sem isto, tudo sairia
  // carimbado no nome genérico da loja e a atribuição exigida pela RDC 216 se
  // perderia. `required` → não dá pra dispensar.
  if (needsOperator(session)) return (
    <OperatorPicker tenant={activeTenant} required
      onPick={(nome) => applyOperator(nome)} />
  );

  // Kiosk mode — full screen override
  if (kioskConfig) return (
    <Suspense fallback={<ViewLoading />}>
      <KioskApp config={kioskConfig} onExit={() => { writeKioskConfig(null); setKioskConfig(null); }} />
    </Suspense>
  );

  const sharedProps = { activeTenant, allTenants: visibleTenants, onTenantChange: handleTenantChange, activeStore };

  return (
    <div className="super-shell">
      {changelogEntries.length > 0 && (
        <ChangelogModal entries={changelogEntries} onClose={dismissChangelog} />
      )}
      {/* Troca voluntária de operador (pelo chip do rail) */}
      {operatorPickerOpen && (
        <OperatorPicker tenant={activeTenant}
          onPick={(nome) => applyOperator(nome)}
          onCancel={() => setOperatorPickerOpen(false)} />
      )}
      {showSearch && (
        <Suspense fallback={null}>
          <GlobalSearch
            records={records}
            allTenants={visibleTenants}
            activeTenant={activeTenant}
            session={session}
            onNavigate={setActiveView}
            onClose={() => setShowSearch(false)}
            onLogout={handleLogout}
            onLaunchKiosk={() => setShowKioskSetup(true)}
            onTenantChange={handleTenantChange}
            switchableTenants={switchableTenants}
            onRequestTenantSwitch={requestTenantSwitch}
          />
        </Suspense>
      )}
      {showKioskSetup && (
        <Suspense fallback={null}>
          <KioskSetup activeTenant={activeTenant} equipmentCatalog={equipmentCatalog} session={session}
            onLaunch={(cfg) => { setKioskConfig(cfg); setShowKioskSetup(false); }}
            onCancel={() => setShowKioskSetup(false)} />
        </Suspense>
      )}

      {/* Mobile header (visible on small screens only) */}
      <header className="mobile-header">
        <div className="mobile-header-brand">
          <BrandLockup size="sm" showSub={false} idPrefix="mob" />
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <DarkModeToggle className="mobile-menu-btn" size={20} />
          <button className="mobile-menu-btn" onClick={() => setShowSearch(true)} aria-label="Buscar">
            <NavIcon id="search" size={20} />
          </button>
          <button className="mobile-menu-btn" onClick={() => setMobileDrawerOpen(true)} aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        </div>
      </header>

      {switchTarget && (
        <TenantSwitchModal targetTenant={switchTarget} currentSession={session}
          onSuccess={handleSwitchSuccess} onClose={() => setSwitchTarget(null)} />
      )}

      {/* Mobile drawer */}
      <MobileDrawer open={mobileDrawerOpen} onClose={() => setMobileDrawerOpen(false)}
        activeView={activeView} setActiveView={setActiveView}
        session={session} activeTenant={activeTenant} allTenants={visibleTenants}
        onTenantChange={handleTenantChange} onLogout={handleLogout}
        switchableTenants={switchableTenants} onRequestTenantSwitch={requestTenantSwitch}
        onChangeOperator={() => setOperatorPickerOpen(true)}
        alertCount={alertCount} actionCount={actionCount} maintAlertCount={maintAlertCount} />

      {/* Desktop rail */}
      <RailNav {...sharedProps} activeView={activeView} setActiveView={setActiveView}
        session={session} records={records} alertCount={alertCount} actionCount={actionCount}
        maintAlertCount={maintAlertCount}
        onLogout={handleLogout} onSearch={() => setShowSearch(true)}
        onChangeOperator={() => setOperatorPickerOpen(true)}
        switchableTenants={switchableTenants} onRequestTenantSwitch={requestTenantSwitch}
        onStoreChange={handleStoreChange} activeStore={activeStore} />
      <main className="super-main">
        {session?._impersonating && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', padding:'10px 16px', marginBottom:12, borderRadius:'var(--r-lg)', background:'var(--rail-bg)', color:'var(--rail-text)' }}>
            <span style={{ fontSize:13 }}>
              <strong>⚠️ Modo impersonação</strong> · você está vendo <strong>{session._impersonatedName ?? activeTenant.name}</strong> como Super Admin
            </span>
            <button onClick={handleExitImpersonation} style={{ padding:'6px 14px', border:'1px solid rgba(255,255,255,.25)', borderRadius:8, background:'transparent', color:'var(--rail-text)', fontFamily:'var(--font)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              ← Voltar ao Super Admin
            </button>
          </div>
        )}
        <LocalModeBanner session={session} activeTenant={activeTenant} setActiveView={setActiveView} />
        <StorageFullBanner />
        <SupabaseAuthErrorBanner session={session} setActiveView={setActiveView} />
        {catalogStale && <CatalogStaleBanner onRetry={retryCatalogSync} retrying={catalogRetrying} />}
        {activeTenant.implantacao === true && (
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'10px 16px', marginBottom:12, borderRadius:'var(--r-lg)', background:'rgba(0,104,74,.08)', border:'1px solid rgba(0,104,74,.25)', fontSize:13, color:'var(--text)' }}>
            <span style={{ fontWeight:700, color:'var(--primary)', letterSpacing:'.04em' }}>EM IMPLANTAÇÃO</span>
            <span style={{ color:'var(--text-secondary)' }}>Fase de treinamento — os registros ficam marcados como treino e os alertas de pendência estão suspensos até o início oficial da operação.</span>
          </div>
        )}
        <Suspense fallback={<ViewLoading />}>
          {/* Wrapper de entrada: remonta a cada troca de view (key) e replaya
              o fade-up. overview-v2 fica de fora — tem coreografia própria. */}
          <div key={activeView} className={activeView === 'overview' ? undefined : 'dash-in'}>
          {/* v2 é o padrão: 'overview' (default + todos os redirects/logout/exit) renderiza
              a nova Visão Geral, que tem coreografia própria (fica fora do wrapper de fade-up).
              A v1 fica dormente em 'overview-v2' pra rollback. */}
          {activeView === 'overview'   && <OverviewV2 {...sharedProps} session={session} equipmentCatalog={equipmentCatalog} records={records} onRecordSaved={handleRecordSaved} onLaunchKiosk={() => setShowKioskSetup(true)} onNavigate={setActiveView} onBack={() => setActiveView('overview-v2')} />}
          {activeView === 'overview-v2' && <OverviewView {...sharedProps} session={session} equipmentCatalog={equipmentCatalog} records={records} onRecordSaved={handleRecordSaved} alerts={computeTurnAlerts(turns, records, equipmentCatalog, activeTenant.id, activeTenant.implantacao === true)} notifPermission={notifPermission} onRequestNotif={requestNotif} onLaunchKiosk={() => setShowKioskSetup(true)} trialStatus={trialStatus} onTryV2={() => setActiveView('overview')} />}
          {activeView === 'forms'      && <FormsView activeTenant={activeTenant} allTenants={visibleTenants} onTenantChange={handleTenantChange} session={session} />}
          {activeView === 'pops'       && <POPsView {...sharedProps} session={session} />}
          {activeView === 'training'   && <TrainingView activeTenant={activeTenant} allTenants={visibleTenants} onTenantChange={handleTenantChange} session={session} />}
          {activeView === 'receiving'  && <RecebimentoView {...sharedProps} session={session} />}
          {activeView === 'validity'   && <ValidityStockView {...sharedProps} session={session} />}

          {/* Hub: Controles especiais (handwash/oil/thaw/cooling/thermal) */}
          {CONTROLS_KEYS.includes(activeView) && (
            <ControlsHub activeView={activeView} setActiveView={setActiveView} {...sharedProps} session={session} />
          )}

          {/* Hub: Relatórios (dashboard/charts/reports/monthly/audit) */}
          {REPORTS_KEYS.includes(activeView) && (
            <ReportsHub activeView={activeView} setActiveView={setActiveView}
              allTenants={visibleTenants} records={records} session={session} onRecordSaved={handleRecordSaved} {...sharedProps} />
          )}

          {activeView === 'readiness'  && <ReadinessView allTenants={visibleTenants} records={records} session={session} onNavigate={setActiveView} />}
          {activeView === 'alerts'     && <AlertsView {...sharedProps} records={records} onAlertsChanged={() => setAlertsTick(t => t + 1)} />}
          {activeView === 'actions'    && <CorrectiveActionsView {...sharedProps} records={records} />}
          {activeView === 'rtpanel'    && <RTPanelView allTenants={visibleTenants} records={records} session={session} />}

          {/* Hub: Equipe (users/turns/sessions) */}
          {TEAM_KEYS.includes(activeView) && (
            <TeamHub activeView={activeView} setActiveView={setActiveView}
              session={session} records={records} {...sharedProps} />
          )}

          {activeView === 'equipment'   && <EquipmentView {...sharedProps} />}
          {activeView === 'profile'     && <ProfileView session={session} onLogout={handleLogout} />}
          {activeView === 'maintenance' && <MaintenanceView {...sharedProps} session={session} />}
          {activeView === 'settings'    && <SettingsView session={session} activeTenant={activeTenant} activeTenants={activeTenants} tenants={tenants} />}
          {/* Super Admin — só admin global (plataforma) */}
          {activeView === 'superadmin'  && (isGlobalAdmin(session)
            ? <SuperAdminGate session={session} onExit={() => setActiveView('overview')}>
                <SuperAdminView session={session} seedTenants={tenants} onImpersonate={handleImpersonate} onExit={() => setActiveView('overview')} />
              </SuperAdminGate>
            : <NoPermission onBack={() => setActiveView('overview')} />)}
          {/* Fallback for any route the user doesn't have access to */}
          {![
            'overview','overview-v2','forms','pops','training','receiving','validity',
            ...CONTROLS_KEYS, ...REPORTS_KEYS, ...TEAM_KEYS,
            'alerts','actions','readiness','rtpanel','equipment','profile','maintenance','settings','superadmin',
          ].includes(activeView) && <NoPermission onBack={() => setActiveView('overview')} />}
          </div>
        </Suspense>
      </main>
      <OfflineIndicator />
      <BottomNav activeView={activeView} setActiveView={setActiveView}
        session={session} alertCount={alertCount} actionCount={actionCount} />
    </div>
  );
}
