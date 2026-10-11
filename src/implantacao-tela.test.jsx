// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NovaPlanilhaModal } from './implantacao-modals';

// A tela da Nova planilha de verdade: digita, adiciona tarefa e cria.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

const digitar = (el, valor) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  setter.call(el, valor);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};
const botao = (texto) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === texto);

describe('Nova planilha na tela', () => {
  it('cria com nome, aba, setor e tarefas; sem tarefa, avisa em vez de criar', async () => {
    const onCriar = vi.fn();
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<NovaPlanilhaModal abas={[['faxina', 'Faxina'], ['higienizacao', 'Higienização']]} setores={['Padaria']} onCriar={onCriar} onClose={() => {}} />); });

    const [nome] = container.querySelectorAll('input');
    await act(async () => { digitar(nome, 'Câmara fria'); });
    await act(async () => { botao('Criar planilha').click(); });
    expect(onCriar).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Inclua pelo menos uma tarefa.');

    const aba = container.querySelector('select');
    await act(async () => { digitar(aba, 'higienizacao'); });
    const setor = container.querySelector('input[list="nova-planilha-setores"]');
    await act(async () => { digitar(setor, 'Confeitaria'); });
    const tarefa = container.querySelector('input[aria-label="Nova tarefa"]');
    await act(async () => { digitar(tarefa, 'Paredes'); });
    await act(async () => { botao('Adicionar').click(); });
    await act(async () => { botao('Criar planilha').click(); });

    expect(onCriar).toHaveBeenCalledWith(expect.objectContaining({
      titulo: 'Câmara fria', aba: 'higienizacao', setor: 'Confeitaria', tarefas: [{ nome: 'Paredes', per: 'weekly' }],
    }));
  });
});
