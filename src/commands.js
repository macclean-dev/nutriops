// Catálogo de comandos do Cmd+K. Pura — recebe context e callbacks,
// devolve lista de { id, label, hint, kind, group, run }.
//
// Filtragem é feita por matchCommands(query, commands) também aqui.

import { canAccess } from './permissions';

const RECENT_KEY = 'nutriops.cmdk.recent';
const RECENT_MAX = 6;

export function readRecentCommandIds() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function pushRecentCommandId(id) {
  try {
    const cur = readRecentCommandIds();
    const next = [id, ...cur.filter(x => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

// Builder único — chamado pelo CommandPalette com o contexto que ele tem.
// `callbacks` = { onNavigate, onLogout, onLaunchKiosk, onClose, onTenantChange }
// `ctx` = { session, allTenants, activeTenant }
export function buildCommands(ctx, callbacks) {
  const role = ctx?.session?.user?.role;
  const can = (view) => role ? canAccess(role, view) : true;
  const cmds = [];

  // ─── Navegação ────────────────────────────────────────────────────────────
  const navItems = [
    { view: 'overview',    label: 'Ir pra Visão Geral',          keywords: 'home dashboard inicio' },
    { view: 'overview-v2', label: 'Ir pra Visão Geral v2',       keywords: 'home dashboard novo beta' },
    { view: 'forms',       label: 'Ir pras Planilhas BPF',       keywords: 'planilhas bpf forms checklist' },
    { view: 'receiving',   label: 'Ir pro Recebimento',          keywords: 'recebimento entrada nf' },
    { view: 'validity',    label: 'Ir pras Validades',           keywords: 'validade estoque produtos vencimento' },
    { view: 'handwash',    label: 'Ir pra Higiene das mãos',     keywords: 'higiene mao mãos handwash' },
    { view: 'oil',         label: 'Ir pro Controle de óleo',     keywords: 'oleo fritura controle' },
    { view: 'thaw',        label: 'Ir pro Descongelamento',      keywords: 'descongelamento thaw' },
    { view: 'cooling',     label: 'Ir pro Resfriamento',         keywords: 'resfriamento cooling' },
    { view: 'thermal',     label: 'Ir pro Controle térmico',     keywords: 'termico thermal cozimento' },
    { view: 'pops',        label: 'Ir pros POPs',                keywords: 'pop procedimento sop' },
    { view: 'training',    label: 'Ir pra Capacitação',          keywords: 'capacitacao treinamento training' },
    { view: 'maintenance', label: 'Ir pra Manutenção',           keywords: 'manutencao maintenance equipamento' },
    { view: 'alerts',      label: 'Ir pros Alertas',             keywords: 'alertas pendencias' },
    { view: 'actions',     label: 'Ir pras Ações corretivas',    keywords: 'acoes corretivas correcao' },
    { view: 'rt',          label: 'Ir pro Painel RT',            keywords: 'rt nutricionista painel' },
    { view: 'dashboard',   label: 'Ir pra Conformidade',         keywords: 'conformidade dashboard relatorio' },
    { view: 'charts',      label: 'Ir pros Gráficos',            keywords: 'graficos charts visualizar' },
    { view: 'reports',     label: 'Ir pros Relatórios',          keywords: 'relatorios reports' },
    { view: 'monthly',     label: 'Ir pra Exportação mensal',    keywords: 'exportacao mensal pdf' },
    { view: 'audit',       label: 'Ir pra Auditoria',            keywords: 'auditoria audit historico' },
    { view: 'users',       label: 'Ir pra Equipe',               keywords: 'equipe usuarios users team' },
    { view: 'turns',       label: 'Ir pros Turnos',              keywords: 'turnos escala' },
    { view: 'sessions',    label: 'Ir pro Histórico de sessões', keywords: 'sessoes login historico' },
    { view: 'profile',     label: 'Ir pro Meu perfil',           keywords: 'perfil conta meu' },
    { view: 'settings',    label: 'Ir pras Configurações',       keywords: 'configuracoes settings' },
  ];

  for (const it of navItems) {
    if (!can(it.view)) continue;
    cmds.push({
      id: `nav:${it.view}`,
      label: it.label,
      hint: 'Navegação',
      keywords: it.keywords,
      group: 'navigation',
      run: () => { callbacks.onNavigate?.(it.view); callbacks.onClose?.(); },
    });
  }

  // ─── Ações ────────────────────────────────────────────────────────────────
  if (callbacks.onLaunchKiosk) {
    cmds.push({
      id: 'action:kiosk',
      label: 'Abrir modo Quiosque',
      hint: 'Ação',
      keywords: 'kiosk quiosque balcao tablet',
      group: 'action',
      run: () => { callbacks.onLaunchKiosk(); callbacks.onClose?.(); },
    });
  }

  // Trocar tenant (só pra perfis multi-tenant)
  if (role && (role === 'Nutricionista RT' || role === 'Administrador' || role === 'Super-admin') && ctx.allTenants?.length > 1) {
    for (const t of ctx.allTenants) {
      if (t.id === ctx.activeTenant?.id) continue;
      cmds.push({
        id: `tenant:${t.id}`,
        label: `Mudar pra ${t.name}`,
        hint: 'Trocar empresa',
        keywords: `${t.name} ${t.segment ?? ''} tenant empresa`,
        group: 'action',
        run: () => { callbacks.onTenantChange?.(t.id); callbacks.onClose?.(); },
      });
    }
  }

  if (callbacks.onLogout) {
    cmds.push({
      id: 'action:logout',
      label: 'Sair da conta',
      hint: 'Ação',
      keywords: 'sair logout exit',
      group: 'action',
      run: () => { callbacks.onLogout(); callbacks.onClose?.(); },
    });
  }

  return cmds;
}

// Normaliza string pra match sem acento, case-insensitive
function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Match: returns subset matching `query`, com score básico (label > keywords).
// Sem query, retorna todos.
export function matchCommands(query, commands) {
  const q = norm(query).trim();
  if (!q) return commands;
  return commands
    .map(c => {
      const labelN = norm(c.label);
      const keywN  = norm(c.keywords ?? '');
      let score = 0;
      if (labelN.includes(q)) score = labelN.startsWith(q) ? 3 : 2;
      else if (keywN.includes(q)) score = 1;
      return { c, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.c);
}
