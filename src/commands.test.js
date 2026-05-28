import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCommands, matchCommands,
  readRecentCommandIds, pushRecentCommandId,
} from './commands';

const ctx = {
  session: { user: { role: 'Administrador' } },
  allTenants: [{ id: 'swiss', name: 'Swiss', segment: 'Confeitaria' }],
  activeTenant: { id: 'swiss' },
};

const callbacks = {
  onNavigate: () => {}, onClose: () => {},
  onLogout: () => {}, onLaunchKiosk: () => {},
  onTenantChange: () => {},
};

describe('commands', () => {
  describe('buildCommands', () => {
    it('inclui navegação pras views permitidas pelo role', () => {
      const cmds = buildCommands(ctx, callbacks);
      const navs = cmds.filter(c => c.group === 'navigation');
      expect(navs.length).toBeGreaterThan(5);
      expect(navs.some(c => c.id === 'nav:overview')).toBe(true);
      expect(navs.some(c => c.id === 'nav:audit')).toBe(true);
    });

    it('inclui ação logout e kiosk quando callbacks existem', () => {
      const cmds = buildCommands(ctx, callbacks);
      expect(cmds.some(c => c.id === 'action:logout')).toBe(true);
      expect(cmds.some(c => c.id === 'action:kiosk')).toBe(true);
    });

    it('NÃO inclui logout se callback não foi passado', () => {
      const cmds = buildCommands(ctx, { ...callbacks, onLogout: undefined });
      expect(cmds.some(c => c.id === 'action:logout')).toBe(false);
    });

    it('inclui troca de tenant pra roles multi-tenant', () => {
      const multi = {
        ...ctx,
        allTenants: [
          { id: 'swiss', name: 'Swiss' },
          { id: 'backerei', name: 'Bäckerei' },
        ],
      };
      const cmds = buildCommands(multi, callbacks);
      expect(cmds.some(c => c.id === 'tenant:backerei')).toBe(true);
      // O ativo não aparece como opção
      expect(cmds.some(c => c.id === 'tenant:swiss')).toBe(false);
    });

    it('NÃO inclui troca de tenant pra Colaborador', () => {
      const collab = {
        ...ctx,
        session: { user: { role: 'Colaborador' } },
        allTenants: [
          { id: 'swiss', name: 'Swiss' },
          { id: 'backerei', name: 'Bäckerei' },
        ],
      };
      const cmds = buildCommands(collab, callbacks);
      expect(cmds.some(c => c.id === 'tenant:backerei')).toBe(false);
    });

    it('run() do comando dispara o callback correto', () => {
      let navigated = null;
      const cmds = buildCommands(ctx, { ...callbacks, onNavigate: (v) => { navigated = v; } });
      const audit = cmds.find(c => c.id === 'nav:audit');
      audit.run();
      expect(navigated).toBe('audit');
    });
  });

  describe('matchCommands', () => {
    const sample = [
      { id: 'a', label: 'Ir pros Relatórios', keywords: 'relatorios reports' },
      { id: 'b', label: 'Ir pra Conformidade', keywords: 'conformidade dashboard' },
      { id: 'c', label: 'Abrir Quiosque', keywords: 'kiosk balcao' },
    ];

    it('sem query devolve tudo', () => {
      expect(matchCommands('', sample)).toHaveLength(3);
    });

    it('matcheia label com normalização (case + acento)', () => {
      const r = matchCommands('relatorios', sample);
      expect(r.map(x => x.id)).toEqual(['a']);
    });

    it('matcheia keywords', () => {
      const r = matchCommands('balcao', sample);
      expect(r.map(x => x.id)).toEqual(['c']);
    });

    it('label que começa com query rankeia primeiro', () => {
      // "Abrir" começa com "a"; "Ir" não
      const r = matchCommands('abrir', sample);
      expect(r[0].id).toBe('c');
    });

    it('substring match em label vence keywords', () => {
      // 'dashboard' não tá em nenhum label — só keywords
      const r = matchCommands('dashboard', sample);
      expect(r).toHaveLength(1);
      expect(r[0].id).toBe('b');
    });
  });

  describe('recent commands storage', () => {
    beforeEach(() => { localStorage.clear(); });

    it('lê vazio sem nada salvo', () => {
      expect(readRecentCommandIds()).toEqual([]);
    });

    it('pushRecent adiciona no topo e dedupa', () => {
      pushRecentCommandId('a');
      pushRecentCommandId('b');
      pushRecentCommandId('a'); // dedupe → a vira topo
      expect(readRecentCommandIds()).toEqual(['a', 'b']);
    });

    it('mantém no máximo 6', () => {
      for (let i = 0; i < 10; i++) pushRecentCommandId(`c${i}`);
      const list = readRecentCommandIds();
      expect(list).toHaveLength(6);
      expect(list[0]).toBe('c9');
    });
  });
});
