// Estrutura de navegação compartilhada por RailNav, MobileDrawer e tests.
// Pura — sem imports de React/DOM, fácil de testar.

// Hubs agregam sub-views numa rota só (Nexum-style flat nav).
export const CONTROLS_KEYS = ['controls', 'handwash', 'oil', 'thaw', 'cooling', 'thermal'];
export const REPORTS_KEYS  = ['reportsHub', 'dashboard', 'charts', 'reports', 'monthly', 'audit'];
export const TEAM_KEYS     = ['team', 'users', 'turns', 'sessions'];

// Destaca o item-pai do hub quando uma sub-view dele está aberta.
export function isItemActive(itemKey, activeView) {
  if (itemKey === activeView) return true;
  if (itemKey === 'controls'   && CONTROLS_KEYS.includes(activeView)) return true;
  if (itemKey === 'reportsHub' && REPORTS_KEYS.includes(activeView))  return true;
  if (itemKey === 'team'       && TEAM_KEYS.includes(activeView))     return true;
  return false;
}

// Items: [key, iconId, label, badge?]
export function buildNavSections({
  validityAlertCount = 0, maintAlertCount = 0,
  alertCount = 0, actionCount = 0,
} = {}) {
  return [
    {
      label: 'Operação',
      items: [
        ['overview',  'overview',  'Visão geral'],
        ['forms',     'forms',     'Planilhas BPF'],
        ['receiving', 'receiving', 'Recebimento'],
        ['validity',  'validity',  'Validades', validityAlertCount || null],
        ['controls',  'thermal',   'Controles especiais'],
      ],
    },
    {
      label: 'Qualidade',
      items: [
        ['pops',        'pops',        'POPs'],
        ['training',    'training',    'Capacitação'],
        ['equipment',   'thermal',     'Equipamentos'],
        ['maintenance', 'maintenance', 'Manutenção', maintAlertCount || null],
      ],
    },
    {
      label: 'Gestão',
      items: [
        ['alerts',     'alerts',    'Alertas',          alertCount  || null],
        ['actions',    'actions',   'Ações corretivas', actionCount || null],
        ['rtpanel',    'rtpanel',   'Painel RT'],
        ['reportsHub', 'dashboard', 'Relatórios'],
        ['team',       'users',     'Equipe'],
      ],
    },
    {
      label: 'Conta',
      items: [
        ['profile',  'profile',  'Meu perfil'],
        ['settings', 'settings', 'Configurações'],
      ],
    },
  ];
}

// Resolve qual sub-view mostrar dado um activeView que pode ser o hub ou
// uma sub-view individual. Persistência fica por conta do call site.
export function resolveHubTab(activeView, hubId, defaultSub, subIds, storage) {
  if (activeView === hubId) {
    const persisted = storage?.getItem?.(`nutriops.${hubId}.lastTab`);
    if (persisted && subIds.includes(persisted)) return persisted;
    return defaultSub;
  }
  if (subIds.includes(activeView)) return activeView;
  return defaultSub;
}
