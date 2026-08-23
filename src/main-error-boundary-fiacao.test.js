import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// O motor (error-boundary.jsx) só protege se estiver LIGADO na raiz de
// verdade. Sem isto seria fácil o boundary existir no repo e nunca envolver
// nada — exatamente o estado em que o app viveu até hoje (nenhum error
// boundary em lugar nenhum).
// ─────────────────────────────────────────────────────────────────────────────

const main = readFileSync(`${process.cwd()}/src/main.jsx`, 'utf8');

describe('o boundary está ligado na raiz', () => {
  it('importa o AppErrorBoundary', () => {
    expect(main).toContain("import { AppErrorBoundary } from './error-boundary';");
  });

  it('envolve o <Root /> — não só existe solto no arquivo', () => {
    expect(main).toMatch(/<AppErrorBoundary>\s*<Root\s*\/>\s*<\/AppErrorBoundary>/);
  });

  it('o createRoot().render() é o que contém o boundary', () => {
    const chamada = main.slice(main.indexOf('ReactDOM.createRoot'));
    expect(chamada).toContain('AppErrorBoundary');
  });
});
