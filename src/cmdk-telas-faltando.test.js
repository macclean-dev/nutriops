import { describe, it, expect } from 'vitest';
import { buildCommands, matchCommands } from './commands';

// ─────────────────────────────────────────────────────────────────────────────
// Pesquisa de 03/10: o item "Painel RT" do Cmd+K apontava pra view 'rt', que
// não existe (a real é 'rtpanel'), então nunca aparecia pra ninguém. E três
// telas do menu não eram achadas pela busca: Prontidão, Dossiê Fiscal e
// Equipamentos. "Não achei a tela" é dor registrada pelo menos 8 vezes no
// histórico do projeto.
// ─────────────────────────────────────────────────────────────────────────────

const ctx = (role) => ({ session: { user: { role } }, activeTenant: { id: 'swiss', name: 'Swiss' }, allTenants: [] });
const ids = (role) => buildCommands(ctx(role), { onNavigate: () => {} }).map((c) => c.id);

describe('Painel RT volta a aparecer', () => {
  it('pra RT e Administrador', () => {
    expect(ids('Nutricionista RT')).toContain('nav:rtpanel');
    expect(ids('Administrador')).toContain('nav:rtpanel');
  });

  it('não pra Colaborador nem Supervisor (não está no nav deles)', () => {
    expect(ids('Colaborador')).not.toContain('nav:rtpanel');
    expect(ids('Supervisor')).not.toContain('nav:rtpanel');
  });

  it('a view fantasma "rt" não existe mais', () => {
    expect(ids('Administrador')).not.toContain('nav:rt');
  });
});

describe('telas que a busca não achava', () => {
  const cmds = buildCommands(ctx('Nutricionista RT'), { onNavigate: () => {} });
  const acha = (q) => matchCommands(q, cmds).map((c) => c.id);

  it('Prontidão, por nome e por "fiscalização"', () => {
    expect(acha('prontidão')).toContain('nav:readiness');
    expect(acha('fiscalizacao')).toContain('nav:readiness');
  });

  it('Dossiê Fiscal, por nome e por "documentos"', () => {
    expect(acha('dossie')).toContain('nav:dossie');
    expect(acha('documentos')).toContain('nav:dossie');
  });

  it('Equipamentos, por nome e por "freezer"', () => {
    expect(acha('equipamentos')).toContain('nav:equipment');
    expect(acha('freezer')).toContain('nav:equipment');
  });

  it('cada perfil só vê o que o menu dele tem (Colaborador não tem Prontidão nem Dossiê)', () => {
    expect(ids('Colaborador')).not.toContain('nav:readiness');
    expect(ids('Colaborador')).not.toContain('nav:dossie');
    expect(ids('Supervisor')).toContain('nav:readiness');
  });

  it('Super Admin continua fora da busca (só o menu sabe quem é admin da plataforma)', () => {
    expect(ids('Administrador')).not.toContain('nav:superadmin');
  });
});
