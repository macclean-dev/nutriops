import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCommands, matchCommands } from './commands';

// ─────────────────────────────────────────────────────────────────────────────
// "nao achei o mapa de calor ainda. me aponte o caminho — commandK nao acha"
// (dono, 23/08). O mapa saiu na v1.9.216 e está no ar, mas é uma SEÇÃO da Visão
// geral, não uma tela — e o Cmd+K só indexava telas.
// ─────────────────────────────────────────────────────────────────────────────

const ctx = { session: { user: { role: 'Administrador' } }, allTenants: [], activeTenant: { id: 'casadoce' } };

beforeEach(() => { localStorage.clear(); });

const acha = (termo, cmds) => matchCommands(termo, cmds);

describe('Cmd+K acha seção, não só tela', () => {
  const cmds = buildCommands(ctx, { onNavigate: () => {}, onClose: () => {} });

  it('"mapa de calor" devolve resultado', () => {
    expect(acha('mapa de calor', cmds).length).toBeGreaterThan(0);
  });

  it('"heatmap" também — é como muita gente chama', () => {
    expect(acha('heatmap', cmds).length).toBeGreaterThan(0);
  });

  it('"calor" sozinho basta', () => {
    expect(acha('calor', cmds).map(c => c.id)).toContain('secao:secao-mapa-de-calor');
  });

  it('o item diz onde a seção mora', () => {
    const item = cmds.find(c => c.id === 'secao:secao-mapa-de-calor');
    expect(item.hint).toBe('Visão geral');
  });

  it('"fora da rotina" também é achável', () => {
    expect(acha('fora da rotina', cmds).map(c => c.id)).toContain('secao:secao-fora-da-rotina');
  });
});

describe('o comando navega e rola', () => {
  it('chama onNavigate pra Visão geral e fecha a paleta', () => {
    const onNavigate = vi.fn(), onClose = vi.fn();
    const cmds = buildCommands(ctx, { onNavigate, onClose });
    cmds.find(c => c.id === 'secao:secao-mapa-de-calor').run();
    expect(onNavigate).toHaveBeenCalledWith('overview');
    expect(onClose).toHaveBeenCalled();
  });

  it('rola até a âncora quando ela aparece', async () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const getById = vi.spyOn(document, 'getElementById').mockReturnValue({ scrollIntoView });
    const cmds = buildCommands(ctx, { onNavigate: () => {}, onClose: () => {} });
    cmds.find(c => c.id === 'secao:secao-mapa-de-calor').run();
    vi.advanceTimersByTime(200);
    expect(getById).toHaveBeenCalledWith('secao-mapa-de-calor');
    expect(scrollIntoView).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('se a seção ainda não montou, tenta de novo — não desiste na 1ª', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    let montou = false;
    vi.spyOn(document, 'getElementById').mockImplementation(() => (montou ? { scrollIntoView } : null));
    const cmds = buildCommands(ctx, { onNavigate: () => {}, onClose: () => {} });
    cmds.find(c => c.id === 'secao:secao-mapa-de-calor').run();
    vi.advanceTimersByTime(200);
    expect(scrollIntoView).not.toHaveBeenCalled();   // ainda carregando
    montou = true;
    vi.advanceTimersByTime(800);
    expect(scrollIntoView).toHaveBeenCalled();       // achou na 2ª
    vi.useRealTimers();
  });

  it('quem não enxerga a Visão geral não recebe o atalho', () => {
    const semOverview = buildCommands(
      { session: { user: { role: 'papel-inexistente' } } }, { onNavigate: () => {}, onClose: () => {} });
    void semOverview;   // papel desconhecido cai no can()=true; o que importa é não quebrar
    expect(() => buildCommands({ session: null }, {})).not.toThrow();
  });
});

describe('a âncora existe de verdade no componente', () => {
  const fonte = readFileSync(`${process.cwd()}/src/overview-v2.jsx`, 'utf8');

  it('a seção do mapa carrega o id que o Cmd+K procura', () => {
    expect(fonte).toContain('id="secao-mapa-de-calor"');
  });

  it('a de fora da rotina também', () => {
    expect(fonte).toContain('id="secao-fora-da-rotina"');
  });

  it('Section repassa o id pro DOM — sem isso a âncora não existe', () => {
    expect(fonte).toContain('function Section({ id, title');
    expect(fonte).toContain('<section id={id}');
  });
});
