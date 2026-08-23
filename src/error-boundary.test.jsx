// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  pareceChunkSumido, podeRecarregarSozinho, marcarRecarregado, limparMarcaDeRecarga,
  AppErrorBoundary,
} from './error-boundary';

// ─────────────────────────────────────────────────────────────────────────────
// "fiz o logoff e a tela ficou branca. Nenhuma msg, nada." O app não tinha
// NENHUM error boundary — um chunk lazy (LoginScreen) que sumiu do servidor
// depois de um deploy (4 hoje) derrubava a árvore inteira em silêncio.
// ─────────────────────────────────────────────────────────────────────────────

describe('pareceChunkSumido — reconhece só o sintoma de arquivo que sumiu', () => {
  it('reconhece a mensagem real do Chrome/Vite pra import() que falha', () => {
    expect(pareceChunkSumido(new Error('Failed to fetch dynamically imported module: https://x/login-abc.js'))).toBe(true);
  });

  it('reconhece a variante do Firefox', () => {
    expect(pareceChunkSumido(new Error('error loading dynamically imported module'))).toBe(true);
  });

  it('reconhece "Loading chunk X failed" (webpack, caso o build mude um dia)', () => {
    expect(pareceChunkSumido(new Error('Loading chunk 4 failed'))).toBe(true);
  });

  it('ignora caixa', () => {
    expect(pareceChunkSumido(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'))).toBe(true);
  });

  it('NÃO reconhece um erro de lógica comum — esse tem que aparecer na tela, não sumir num reload', () => {
    expect(pareceChunkSumido(new Error('Cannot read properties of undefined (reading \'label\')'))).toBe(false);
    expect(pareceChunkSumido(new TypeError('x is not a function'))).toBe(false);
  });

  it('aguenta erro sem mensagem, ou nem erro nenhum', () => {
    expect(pareceChunkSumido(new Error())).toBe(false);
    expect(pareceChunkSumido(null)).toBe(false);
    expect(pareceChunkSumido(undefined)).toBe(false);
  });
});

describe('a marca de reload — 1 tentativa automática por aba, não um loop', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('pode recarregar por padrão', () => {
    expect(podeRecarregarSozinho()).toBe(true);
  });

  it('depois de marcar, não pode mais — é o que impede o loop infinito sem internet', () => {
    marcarRecarregado();
    expect(podeRecarregarSozinho()).toBe(false);
  });

  it('limpar a marca libera de novo — pro PRÓXIMO deploy, dias depois', () => {
    marcarRecarregado();
    limparMarcaDeRecarga();
    expect(podeRecarregarSozinho()).toBe(true);
  });
});

describe('AppErrorBoundary — recarrega sozinho quando é chunk sumido', () => {
  let container, root, reloadSpy;

  beforeEach(() => {
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: reloadSpy }, writable: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function Bomba({ erro }) { throw erro; }

  it('erro comum renderiza normal quando não há problema', () => {
    act(() => root.render(<AppErrorBoundary><div>ok</div></AppErrorBoundary>));
    expect(container.textContent).toContain('ok');
  });

  it('chunk sumido dispara reload automático — a pessoa não vê nada quebrado', () => {
    act(() => root.render(<AppErrorBoundary><Bomba erro={new Error('Failed to fetch dynamically imported module')} /></AppErrorBoundary>));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('a 2ª vez, na mesma aba, NÃO recarrega de novo — mostra a tela em vez de repetir o loop', () => {
    marcarRecarregado();
    act(() => root.render(<AppErrorBoundary><Bomba erro={new Error('Failed to fetch dynamically imported module')} /></AppErrorBoundary>));
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Atualizando');
  });

  it('erro que NÃO é de chunk mostra a tela amigável, sem recarregar sozinho', () => {
    act(() => root.render(<AppErrorBoundary><Bomba erro={new Error('x.map is not a function')} /></AppErrorBoundary>));
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Algo deu errado');
    expect(container.textContent).toContain('Recarregar');
  });

  it('a tela nunca fica em branco — sempre tem texto visível pra pessoa ler', () => {
    act(() => root.render(<AppErrorBoundary><Bomba erro={new Error('qualquer coisa')} /></AppErrorBoundary>));
    expect(container.textContent.trim().length).toBeGreaterThan(0);
  });

  it('promete que o dado não se perdeu — é a dúvida real de quem vê a tela travar', () => {
    act(() => root.render(<AppErrorBoundary><Bomba erro={new Error('erro qualquer')} /></AppErrorBoundary>));
    expect(container.textContent).toContain('Nenhum registro se perde');
  });
});
