import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { podeValidarPlanilha } from './permissions';
import { FormsView } from './forms.jsx';
import { AuditView } from './reports-views.jsx';

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

// ─────────────────────────────────────────────────────────────────────────────
// Mesma brecha no "Validar período" da Auditoria (v1.9.255). Ali o portão era
// `isRT`, que já barrava Colaborador e Supervisor, mas deixava passar a conta
// de loja criada como Administrador. O "Corrigir" leitura entrou na mesma
// regra na v1.9.256 (casos no fim do arquivo).
// ─────────────────────────────────────────────────────────────────────────────

describe('Auditoria: "Validar período", renderizada de verdade', () => {
  const tenant = { id: 'swiss', name: 'Swiss' };
  const render = (session) => renderToStaticMarkup(
    <AuditView allTenants={[tenant]} records={[]} session={session} onRecordSaved={() => {}} activeTenant={tenant} />
  );

  beforeEach(() => { localStorage.clear(); });

  it('conta de loja com papel de Administrador não vê o botão', () => {
    expect(render(sessao('Administrador', { isStoreAccount: true }))).not.toContain('Validar período');
  });

  it('Supervisor (que tem a Auditoria no menu) não vê o botão', () => {
    expect(render(sessao('Supervisor'))).not.toContain('Validar período');
  });

  it('RT e Administrador da loja continuam vendo', () => {
    expect(render(sessao('Nutricionista RT'))).toContain('Validar período');
    expect(render(sessao('Administrador'))).toContain('Validar período');
  });

  it('saveValidation recusa sozinha, antes de empurrar qualquer assinatura', () => {
    const fonte = readFileSync(`${process.cwd()}/src/reports-views.jsx`, 'utf8');
    const ini = fonte.indexOf('const saveValidation = (note) => {');
    const b = fonte.slice(ini, fonte.indexOf('\n  };', ini));
    expect(b).toContain('if (!podeAssinar) return;');
    expect(b.indexOf('if (!podeAssinar) return;')).toBeLessThan(b.indexOf('pushRtValidation('));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "Corrigir" leitura de temperatura (v1.9.256). A correção grava corrected_by
// ao lado do motivo e do valor original: é assinatura, mesma regra.
// ─────────────────────────────────────────────────────────────────────────────

describe('Auditoria: "Corrigir" leitura, renderizada de verdade', () => {
  const tenant = { id: 'swiss', name: 'Swiss' };
  const leitura = {
    id: 'r1', tenantId: 'swiss', tenantName: 'Swiss', equipment: 'Freezer', equipmentInput: 'Freezer',
    value: 18, min: -22, max: -18, user: 'Maria', createdAt: new Date().toISOString(),
  };
  const render = (session) => renderToStaticMarkup(
    <AuditView allTenants={[tenant]} records={[leitura]} session={session} onRecordSaved={() => {}} activeTenant={tenant} />
  );

  beforeEach(() => { localStorage.clear(); });

  it('a leitura aparece na tabela (sem isto os casos abaixo não provariam nada)', () => {
    expect(render(sessao('Supervisor'))).toContain('Freezer');
  });

  it('conta de loja com papel de Administrador não vê o botão Corrigir', () => {
    expect(render(sessao('Administrador', { isStoreAccount: true }))).not.toContain('>Corrigir<');
  });

  it('Supervisor não vê o botão Corrigir', () => {
    expect(render(sessao('Supervisor'))).not.toContain('>Corrigir<');
  });

  it('RT e Administrador da loja continuam vendo', () => {
    expect(render(sessao('Nutricionista RT'))).toContain('>Corrigir<');
    expect(render(sessao('Administrador'))).toContain('>Corrigir<');
  });

  it('submitCorrection recusa sozinha, antes de gravar', () => {
    const fonte = readFileSync(`${process.cwd()}/src/reports-views.jsx`, 'utf8');
    const ini = fonte.indexOf('const submitCorrection = async (r) => {');
    const b = fonte.slice(ini, fonte.indexOf('\n  };', ini));
    expect(b).toContain('if (!podeAssinar) return;');
    expect(b.indexOf('if (!podeAssinar) return;')).toBeLessThan(b.indexOf('repository.update('));
  });
});
