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
    const ini = fonte.indexOf('const startEdit = (i) => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const cancelEdit', ini));
    // Só linhas de código: os comentários citam scrollIntoView de propósito,
    // documentando POR QUE ele não serve aqui.
    const principal = corpo.slice(0, corpo.indexOf('} catch'))
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(principal).not.toContain('scrollIntoView');
  });

  it('startEdit rola até ele — no caminho principal, não só no fallback', () => {
    const ini = fonte.indexOf('const startEdit = (i) => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const cancelEdit', ini));
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
    expect(corpo.indexOf('setNameInput(u.name)')).toBeLessThan(corpo.indexOf('window.scrollTo({'));
  });

  it('salto instantâneo, não animado — smooth foi verificado e simplesmente não rolava', () => {
    const ini = fonte.indexOf('const startEdit = (i) => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const cancelEdit', ini));
    expect(corpo).toContain("behavior: 'auto'");
    expect(corpo).not.toContain("behavior: 'smooth'");
  });

  it('navegador sem matchMedia não quebra a edição — o try/catch cai no scroll simples', () => {
    const ini = fonte.indexOf('const startEdit = (i) => {');
    const corpo = fonte.slice(ini, fonte.indexOf('const cancelEdit', ini));
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
