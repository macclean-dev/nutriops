import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemoverClienteModal } from './superadmin-view.jsx';

// Os três estados do modal SÃO a segurança da tela. String matching no fonte
// trava a decisão, mas não prova que a condição certa liga o botão certo —
// aqui o componente é renderizado de verdade nos três casos.

const alvo = { id: 'x1', name: 'Loja Teste' };
const render = (estado) => renderToStaticMarkup(
  <RemoverClienteModal estado={estado} onConfirmar={()=>{}} onFechar={()=>{}} />
);

describe('RemoverClienteModal — o botão perigoso só aparece quando deve', () => {
  it('CONTANDO: nenhum botão de apagar', () => {
    const html = render({ tenant: alvo, contagem: null, carregando: true, erro: '', apagando: false });
    expect(html).toContain('Consultando os registros');
    expect(html).not.toContain('Remover Loja Teste');
  });

  it('NÃO DEU PRA CONTAR: recusa, e não oferece apagar', () => {
    // null ≠ zero. Este é o caso que, tratado errado, apagaria empresa cheia.
    const html = render({ tenant: alvo, contagem: null, carregando: false, erro: '', apagando: false });
    expect(html).toMatch(/não removo nada/);
    expect(html).not.toContain('Remover Loja Teste');
  });

  it('COM REGISTRO: recusa, lista as tabelas e manda suspender', () => {
    const html = render({
      tenant: alvo, carregando: false, erro: '', apagando: false,
      contagem: { total: 437, porTabela: { temperature_records: 400, form_records: 37 } },
    });
    expect(html).toContain('437 registros e não pode ser removida');
    expect(html).toContain('temperature_records: 400');
    expect(html).toContain('form_records: 37');
    expect(html).toContain('Suspender');
    expect(html).not.toContain('Remover Loja Teste');
  });

  it('VAZIA: aí sim libera, avisando que não tem volta', () => {
    const html = render({
      tenant: alvo, carregando: false, erro: '', apagando: false,
      contagem: { total: 0, porTabela: {} },
    });
    expect(html).toContain('Remover Loja Teste');
    expect(html).toMatch(/Não tem volta/);
  });

  it('APAGANDO: botões travados, sem duplo clique', () => {
    const html = render({
      tenant: alvo, carregando: false, erro: '', apagando: true,
      contagem: { total: 0, porTabela: {} },
    });
    expect(html).toContain('Removendo…');
    expect(html).toContain('disabled');
  });

  it('ERRO do servidor aparece na tela', () => {
    const html = render({
      tenant: alvo, carregando: false, apagando: false,
      erro: 'A empresa "Loja Teste" tem 3 registro(s) e NÃO pode ser removida',
      contagem: { total: 0, porTabela: {} },
    });
    expect(html).toContain('NÃO pode ser removida');
  });
});
