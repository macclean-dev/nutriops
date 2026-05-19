// ─── Permission system ─────────────────────────────────────────────────────
// Define what each role can see and do in NutriOPS.

export const ROLES = ['Funcionário', 'Supervisor', 'Nutricionista RT', 'Administrador', 'Super-admin'];

const ALL_VIEWS = ['overview','dashboard','charts','forms','training','receiving','audit','alerts','actions','turns','users','equipment','settings'];

export const PERMISSIONS = {
  'Funcionário': {
    nav: ['overview', 'forms', 'receiving'],
    multiTenant: false,
    canExport: false,
    canValidate: false,
    canManageUsers: false,
    canManageConfig: false,
    canSeeReports: false,
  },
  'Supervisor': {
    nav: ['overview', 'forms', 'receiving', 'alerts', 'audit'],
    multiTenant: false,
    canExport: true,
    canValidate: false,
    canManageUsers: false,
    canManageConfig: false,
    canSeeReports: true,
  },
  'Nutricionista RT': {
    nav: ['overview', 'dashboard', 'charts', 'forms', 'training', 'receiving', 'audit', 'alerts', 'actions', 'users', 'reports'],
    multiTenant: true,
    canExport: true,
    canValidate: true,
    canManageUsers: false,
    canManageConfig: false,
    canSeeReports: true,
  },
  'Administrador': {
    nav: ALL_VIEWS.concat(['reports']),
    multiTenant: true,
    canExport: true,
    canValidate: true,
    canManageUsers: true,
    canManageConfig: true,
    canSeeReports: true,
  },
  'Super-admin': {
    nav: ALL_VIEWS.concat(['reports']),
    multiTenant: true,
    canExport: true,
    canValidate: true,
    canManageUsers: true,
    canManageConfig: true,
    canSeeReports: true,
  },
};

export function getPermissions(role) {
  return PERMISSIONS[role] ?? PERMISSIONS['Funcionário'];
}

export function canAccess(role, view) {
  const p = getPermissions(role);
  return p.nav === 'all' || p.nav.includes(view);
}
