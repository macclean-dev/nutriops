import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { podeValidarPlanilha } from './permissions';
import { FormsView } from './forms.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Achado da pesquisa de 03/10: a aba "Validação RT" de Planilhas BPF não tinha
// portão nenhum. Qualquer perfil com acesso a Planilhas, inclusive Colaborador,
// via a aba, a contagem de pendentes e o botão "Validar" - ou seja, quem
// preenche a planilha conseguia assinar a própria planilha como se fosse a RT.
// O carimbo grava nome, papel e hora, e é ele que vale na fiscalização.
//
// `canValidate` existia em permissions.js desde sempre e ninguém lia.
// ─────────────────────────────────────────────────────────────────────────────

const sessao = (role, extra = {}) => ({ user: { name: 'Fulana', role }, tenantId: 'swiss', ...extra });

describe('podeValidarPlanilha: quem pode assinar', () => {
  it('RT, Administrador e Super-admin assinam', () => {
    expect(podeValidarPlanilha(sessao('Nutricionista RT'))).toBe(true);
    expect(podeValidarPlanilha(sessao('Administrador'))).toBe(true);
    expect(podeValidarPlanilha(sessao('Super-admin'))).toBe(true);
  });

  it('Colaborador e Supervisor não assinam (canValidate=false nos dois)', () => {
    expect(podeValidarPlanilha(sessao('Colaborador'))).toBe(false);
    expect(podeValidarPlanilha(sessao('Supervisor'))).toBe(false);
  });

  it('conta de loja não assina nem com papel de Administrador: é tablet compartilhado, o nome no carimbo seria só o operador escolhido', () => {
    expect(podeValidarPlanilha(sessao('Administrador', { isStoreAccount: true }))).toBe(false);
    expect(podeValidarPlanilha(sessao('Nutricionista RT', { isStoreAccount: true }))).toBe(false);
  });

  it('falha FECHADO: sem sessão, sem usuário ou papel desconhecido', () => {
    expect(podeValidarPlanilha(null)).toBe(false);
    expect(podeValidarPlanilha({})).toBe(false);
    expect(podeValidarPlanilha(sessao(undefined))).toBe(false);
    expect(podeValidarPlanilha(sessao('Dono'))).toBe(false);
  });
});

describe('a tela de Planilhas BPF, renderizada de verdade', () => {
  const tenant = { id: 'swiss', name: 'Swiss' };
  const render = (session) => renderToStaticMarkup(
    <FormsView activeTenant={tenant} allTenants={[tenant]} onTenantChange={() => {}} session={session} />
  );

  beforeEach(() => { localStorage.clear(); });

  it('Colaborador não vê a aba Validação RT', () => {
    expect(render(sessao('Colaborador'))).not.toContain('Validação RT');
  });

  it('Supervisor não vê a aba Validação RT', () => {
    expect(render(sessao('Supervisor'))).not.toContain('Validação RT');
  });

  it('conta de loja com papel de Administrador não vê a aba', () => {
    expect(render(sessao('Administrador', { isStoreAccount: true }))).not.toContain('Validação RT');
  });

  it('RT continua vendo a aba (o conserto não pode tirar dela)', () => {
    expect(render(sessao('Nutricionista RT'))).toContain('Validação RT');
  });

  it('Administrador da loja continua vendo a aba', () => {
    expect(render(sessao('Administrador'))).toContain('Validação RT');
  });
});

describe('os gravadores recusam sozinhos, não só a aba', () => {
  // Esconder a aba tira o caminho da tela; a assinatura não pode depender de
  // ninguém achar outra porta pra chamar o handler.
  const forms = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
  const bloco = (inicio) => {
    const ini = forms.indexOf(inicio);
    return forms.slice(ini, forms.indexOf('}, [', ini));
  };

  it('handleValidate sai antes de gravar quando não pode validar', () => {
    const b = bloco('const handleValidate = useCallback(');
    expect(b).toContain('if (!podeValidar) return;');
    expect(b.indexOf('if (!podeValidar) return;')).toBeLessThan(b.indexOf('pushFormRecord('));
  });

  it('handleValidateAll sai antes de gravar quando não pode validar', () => {
    const b = bloco('const handleValidateAll = useCallback(');
    expect(b).toContain('if (!podeValidar) return;');
    expect(b.indexOf('if (!podeValidar) return;')).toBeLessThan(b.indexOf('pushFormRecord('));
  });

  it('o painel só monta com permissão, mesmo que o estado da aba diga "validation"', () => {
    expect(forms).toContain("{tab==='validation' && podeValidar && (");
  });
});
