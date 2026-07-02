export const ROLES = ['Colaborador', 'Supervisor', 'Nutricionista RT', 'Administrador', 'Super-admin'];

// Hubs agrupam sub-views (Nexum-style flat nav). Cada hub é um meta-route.
// O usuário precisa de acesso ao hub para abrir o agrupador, e o hub filtra
// internamente as sub-tabs pelo mesmo canAccess.
const ALL_VIEWS = [
  'overview','overview-v2','forms','pops','training','receiving','validity',
  // Hub: controles especiais
  'controls', 'handwash','oil','thaw','cooling','thermal',
  // Hub: relatórios
  'reportsHub', 'dashboard','charts','reports','monthly','audit',
  'alerts','actions','rtpanel',
  // Hub: equipe
  'team', 'users','turns','sessions',
  'equipment','maintenance','profile','settings',
  // Plataforma (só admin global — o rail ainda filtra por isGlobalAdmin)
  'superadmin',
];

export const PERMISSIONS = {
  'Colaborador': {
    nav: ['overview','overview-v2','forms','receiving','validity','controls','handwash','oil','thaw','cooling','thermal','profile'],
    multiTenant: false, canSwitchTenant: false, canExport: false, canValidate: false, canManageUsers: false, canManageConfig: false, canSeeReports: false,
  },
  'Supervisor': {
    nav: ['overview','overview-v2','forms','receiving','validity','controls','handwash','oil','thaw','cooling','thermal','alerts','reportsHub','audit','equipment','maintenance','profile'],
    // multiTenant=false: vê só a própria empresa nos relatórios. canSwitchTenant=true:
    // pode TROCAR de empresa via relogin (PIN da empresa-alvo). São coisas distintas.
    multiTenant: false, canSwitchTenant: true, canExport: true, canValidate: false, canManageUsers: false, canManageConfig: false, canSeeReports: true,
  },
  'Nutricionista RT': {
    nav: ['overview','overview-v2','forms','pops','training','receiving','validity','controls','handwash','oil','thaw','cooling','thermal','reportsHub','dashboard','charts','reports','monthly','audit','alerts','actions','rtpanel','team','users','sessions','equipment','maintenance','profile'],
    multiTenant: true, canSwitchTenant: true, canExport: true, canValidate: true, canManageUsers: false, canManageConfig: false, canSeeReports: true,
  },
  'Administrador': {
    nav: ALL_VIEWS,
    multiTenant: true, canSwitchTenant: true, canExport: true, canValidate: true, canManageUsers: true, canManageConfig: true, canSeeReports: true,
  },
  'Super-admin': {
    nav: ALL_VIEWS,
    multiTenant: true, canSwitchTenant: true, canExport: true, canValidate: true, canManageUsers: true, canManageConfig: true, canSeeReports: true,
  },
};

export function getPermissions(role) { return PERMISSIONS[role] ?? PERMISSIONS['Colaborador']; }
export function canAccess(role, view) { const p = getPermissions(role); return p.nav.includes(view); }

// Admin GLOBAL da NutriOPS (não um admin de um tenant): loga via Supabase Auth
// com tenantId nulo. Só ele vê a área "Super Admin" (plataforma). Um
// Administrador amarrado a um tenant (tenantId setado) NÃO é global.
export function isGlobalAdmin(session) {
  return !session?.tenantId && ['Administrador', 'Super-admin'].includes(session?.user?.role);
}
