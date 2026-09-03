import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// "Quando rolo e edito uma pessoa que está no final da lista de equipe, parece
// que nada acontece, mas é porque eu tenho que rolar tudo pra cima para ver a
// tela" (dono, 28/08).
//
// O formulário fica ACIMA da lista. Numa equipe de ~100 pessoas (CASA DOCE),
// clicar "Editar" na última linha preenche um formulário fora da tela — o
// botão parece quebrado.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');

describe('editar rola a tela até o formulário', () => {
  it('o card do formulário tem ref', () => {
    expect(fonte).toContain('<article className="management-card" ref={formRef}>');
  });

  it('NÃO usa scrollIntoView no caminho principal — ele erra a conta com o overflow do .super-main', () => {
    const ini = fonte.indexOf('const irParaOFormulario = () => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const startEdit', ini));
    // Só linhas de código: os comentários citam scrollIntoView de propósito,
    // documentando POR QUE ele não serve aqui.
    const principal = corpo.slice(0, corpo.indexOf('} catch'))
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(principal).not.toContain('scrollIntoView');
  });

  it('startEdit rola até ele — no caminho principal, não só no fallback', () => {
    const ini = fonte.indexOf('const irParaOFormulario = () => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const startEdit', ini));
    // Asserção específica de propósito: a primeira versão deste teste só
    // procurava a string "scrollIntoView" e passava mesmo com a chamada
    // principal removida, porque o `catch` tem outra. Pego na prova de
    // reversão.
    expect(corpo).toContain('const y = alvo.getBoundingClientRect().top + window.scrollY - 12;');
    expect(corpo).toContain("window.scrollTo({ top: Math.max(0, y), behavior: 'auto' })");
  });

  it('rola DEPOIS de preencher os campos — senão rolaria pra um form ainda vazio', () => {
    const ini = fonte.indexOf('const startEdit = (i) => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const cancelEdit', ini));
    expect(corpo.indexOf('setNameInput(u.name)')).toBeLessThan(corpo.indexOf('irParaOFormulario()'));
  });

  it('salto instantâneo, não animado — smooth foi verificado e simplesmente não rolava', () => {
    const ini = fonte.indexOf('const irParaOFormulario = () => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const startEdit', ini));
    expect(corpo).toContain("behavior: 'auto'");
    expect(corpo).not.toContain("behavior: 'smooth'");
  });

  it('navegador que não aceite window.scrollTo não quebra a edição — cai no fallback', () => {
    const ini = fonte.indexOf('const irParaOFormulario = () => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const startEdit', ini));
    expect(corpo).toContain('} catch { formRef.current?.scrollIntoView?.(); }');
  });

  it('useRef está importado', () => {
    expect(fonte).toContain("import React, { useState, useEffect, useRef } from 'react';");
  });
});

describe('a linha editada continua destacada — o outro sinal de "algo aconteceu"', () => {
  it('a classe editing é aplicada na linha certa', () => {
    expect(fonte).toContain("${editingIndex === ri ? 'editing' : ''}");
  });

  it('e o CSS dessa classe existe de verdade', () => {
    const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    expect(css).toContain('.equipment-maintenance-row.editing');
  });
});

describe('trocar de empresa no meio de uma edição explica o que houve', () => {
  it('registra QUEM estava sendo editado antes de limpar', () => {
    expect(fonte).toContain("const perdida = editingIndex !== null ? (users[editingIndex]?.name ?? null) : null;");
  });

  it('e leva a tela até o aviso — ele nasce fora da tela se a pessoa estava no fim da lista', () => {
    expect(fonte).toContain('if (perdida) irParaOFormulario();');
  });

  it('o aviso aponta a ferramenta certa em vez de só informar a perda', () => {
    expect(fonte).toContain('use o botão "Mover" na linha dela');
  });

  it('mas só quando existe outra empresa pra onde mover', () => {
    expect(fonte).toContain('outrasUnidades.length > 0');
  });

  it('e explica POR QUE foi limpo — senão parece defeito', () => {
    expect(fonte).toContain('gravaria essa pessoa na empresa errada');
  });

  it('começar outra edição limpa o aviso', () => {
    const ini = fonte.indexOf('const startEdit = (i) => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const cancelEdit', ini));
    expect(corpo).toContain('setEdicaoDescartada(null)');
  });
});
