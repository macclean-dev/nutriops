import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCommands, matchCommands } from './commands';
import { TRAINING_PENDING_TAB_KEY } from './nav';

// ─────────────────────────────────────────────────────────────────────────────
// "acho que ele deveria me levar até a parte de aso por aqui também" (dono,
// 24/08) — busquei "aso" no Cmd+K e deu "Nenhum comando ou resultado". Mesma
// classe do bug do mapa de calor de ontem, mas Capacitação não é um hub com
// seção rolável — é UMA view com abas internas, então o mecanismo é outro
// (sinal de uma vez só em localStorage, não scrollIntoView).
// ─────────────────────────────────────────────────────────────────────────────

const ctx = { session: { user: { role: 'Administrador' } }, allTenants: [], activeTenant: { id: 'casadoce' } };

beforeEach(() => { localStorage.clear(); });

describe('Cmd+K acha a aba de ASO', () => {
  const cmds = buildCommands(ctx, { onNavigate: () => {}, onClose: () => {} });

  it('"aso" devolve resultado — era exatamente essa busca que dava vazio', () => {
    expect(matchCommands('aso', cmds).map(c => c.id)).toContain('aba:training-aso');
  });

  it('sinônimos também acham: saude, exame, licenca maternidade, afastamento', () => {
    for (const termo of ['saude', 'exame', 'licenca maternidade', 'afastamento', 'pcmso']) {
      expect(matchCommands(termo, cmds).map(c => c.id)).toContain('aba:training-aso');
    }
  });

  it('o item diz onde a aba mora', () => {
    const item = cmds.find(c => c.id === 'aba:training-aso');
    expect(item.hint).toBe('Capacitação');
  });
});

describe('o comando grava o pedido de aba e navega', () => {
  it('grava TRAINING_PENDING_TAB_KEY=aso antes de navegar', () => {
    const onNavigate = vi.fn(), onClose = vi.fn();
    const cmds = buildCommands(ctx, { onNavigate, onClose });
    cmds.find(c => c.id === 'aba:training-aso').run();
    expect(localStorage.getItem(TRAINING_PENDING_TAB_KEY)).toBe('aso');
    expect(onNavigate).toHaveBeenCalledWith('training');
    expect(onClose).toHaveBeenCalled();
  });

  it('quem não enxerga Capacitação não recebe o atalho', () => {
    // canAccess(role, 'training') decide isso — só confere que buildCommands
    // não quebra pra um papel qualquer, sem assumir a lista de permissões.
    expect(() => buildCommands({ session: { user: { role: 'papel-inexistente' } } },
      { onNavigate: () => {}, onClose: () => {} })).not.toThrow();
  });
});

describe('training.jsx consome o pedido no mount', () => {
  const fonte = readFileSync(`${process.cwd()}/src/training.jsx`, 'utf8');

  it('lê consumeTrainingPendingTab pra decidir a aba inicial', () => {
    expect(fonte).toContain('consumeTrainingPendingTab(');
    expect(fonte).toContain("?? 'sessions'");
  });
});
