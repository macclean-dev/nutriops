import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientModal } from './admin.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// O resto da suíte deste fluxo checa o CÓDIGO-FONTE (string matching), que é
// bom pra travar decisão mas cego pra JSX quebrado: um `}` no lugar errado ou
// um bloco condicional mal fechado passa batido e só aparece na tela do dono.
// Aqui o componente é RENDERIZADO de verdade.
// ─────────────────────────────────────────────────────────────────────────────

describe('ClientModal renderiza', () => {
  it('cadastro NOVO oferece dono e RT no mesmo formulário', () => {
    const html = renderToStaticMarkup(<ClientModal client={null} onSave={()=>{}} onClose={()=>{}} />);
    expect(html).toContain('E-mail de contato');
    expect(html).toContain('E-mail da nutricionista RT (opcional)');
    expect(html).toContain('Criar cliente');
  });

  it('EDIÇÃO esconde o campo da RT — editar não recria conta', () => {
    const html = renderToStaticMarkup(
      <ClientModal client={{ id:'x', name:'Loja X', email:'a@b.com', plan:'trial', segment:'padaria' }}
        onSave={()=>{}} onClose={()=>{}} />
    );
    expect(html).not.toContain('E-mail da nutricionista RT');
    expect(html).toContain('Salvar alterações');
  });

  it('EDIÇÃO diz ONDE gerenciar acesso — esconder sem dizer virava beco sem saída', () => {
    // Caso real (21/08): empresa cadastrada, criação de conta falhou, o dono
    // abriu "Editar" procurando o campo da RT e não achou nada — nem o campo,
    // nem o caminho. Não duplicamos a funcionalidade aqui (gerenciar acesso é
    // trabalho de Equipe → Usuários); o que faltava era dizer isso.
    const html = renderToStaticMarkup(
      <ClientModal client={{ id:'x', name:'Loja X', email:'a@b.com', plan:'trial', segment:'padaria' }}
        onSave={()=>{}} onClose={()=>{}} />
    );
    expect(html).toContain('Acesso do cliente');
    expect(html).toContain('Equipe → Usuários');
    expect(html).toContain('Vincular conta existente');
    expect(html).toContain('Entrar como');
  });

  it('o cadastro NOVO não mostra esse aviso — lá o campo existe de verdade', () => {
    const html = renderToStaticMarkup(<ClientModal client={null} onSave={()=>{}} onClose={()=>{}} />);
    expect(html).not.toContain('Acesso do cliente');
  });

  it('o campo da RT explica que conta existente é vinculada, não duplicada', () => {
    const html = renderToStaticMarkup(<ClientModal client={null} onSave={()=>{}} onClose={()=>{}} />);
    expect(html).toMatch(/vinculada, não duplicada/);
  });
});
