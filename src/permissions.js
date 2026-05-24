export const ROLES = ['Colaborador', 'Supervisor', 'Nutricionista RT', 'Administrador', 'Super-admin'];

const ALL_VIEWS = ['overview','dashboard','charts','forms','pops','training','receiving','validity','handwash','oil','thaw','cooling','thermal','audit','reports','monthly','alerts','actions','rtpanel','turns','users','sessions','equipment','maintenance','profile','settings'];

export const PERMISSIONS = {
  'Colaborador': {
    nav: ['overview', 'forms', 'receiving', 'validity', 'handwash', 'oil', 'thaw', 'cooling', 'thermal', 'profile'],
    multiTenant: false, canExport: false, canValidate: false, canManageUsers: false, canManageConfig: false, canSeeReports: false,
  },
  'Supervisor': {
    nav: ['overview', 'forms', 'receiving', 'validity', 'handwash', 'oil', 'thaw', 'cooling', 'thermal', 'alerts', 'audit', 'profile'],
    multiTenant: false, canExport: true, canValidate: false, canManageUsers: false, canManageConfig: false, canSeeReports: true,
  },
  'Nutricionista RT': {
    nav: ['overview', 'dashboard', 'charts', 'forms', 'pops', 'training', 'receiving', 'validity', 'handwash', 'oil', 'thaw', 'cooling', 'thermal', 'audit', 'alerts', 'actions', 'rtpanel', 'users', 'reports', 'monthly', 'profile'],
    multiTenant: true, canExport: true, canValidate: true, canManageUsers: false, canManageConfig: false, canSeeReports: true,
  },
  'Administrador': {
    nav: ALL_VIEWS,
    multiTenant: true, canExport: true, canValidate: true, canManageUsers: true, canManageConfig: true, canSeeReports: true,
  },
  'Super-admin': {
    nav: ALL_VIEWS,
    multiTenant: true, canExport: true, canValidate: true, canManageUsers: true, canManageConfig: true, canSeeReports: true,
  },
};

export function getPermissions(role) { return PERMISSIONS[role] ?? PERMISSIONS['Colaborador']; }
export function canAccess(role, view) { const p = getPermissions(role); return p.nav.includes(view); }
