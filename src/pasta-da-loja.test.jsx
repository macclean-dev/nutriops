// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canAccess, podeEditarCapacitacao, podeVerSaudeAso } from './permissions';
import { TrainingView } from './training';

// ─────────────────────────────────────────────────────────────────────────────
// Pasta da loja para a visita da vigilância (10/10). Pedido da RT da CASA DOCE
// (06/10): a vigilância cobra treinamento e documentos na visita, e quem está
// na loja quando ela não está precisa achar. RDC 216 4.11.1: POPs acessíveis
// a quem executa e à autoridade sanitária.
// ─────────────────────────────────────────────────────────────────────────────

const loja = { id: 'cd', name: 'CASA DOCE' };
const sessao = (role) => ({ user: { name: 'Fulana', role }, tenantId: 'cd' });
const tela = (role) => renderToStaticMarkup(
  <TrainingView activeTenant={loja} allTenants={[loja]} onTenantChange={() => {}} session={sessao(role)} />,
);

beforeEach(() => { localStorage.clear(); });

describe('quem abre o quê', () => {
  it('Colaborador abre os POPs (quem executa o procedimento)', () => {
    expect(canAccess('Colaborador', 'pops')).toBe(true);
    expect(canAccess('Colaborador', 'training')).toBe(false);
    expect(canAccess('Colaborador', 'dossie')).toBe(false);
  });

  it('Supervisor abre POPs, Capacitação e Dossiê Fiscal (quem fica na loja na visita)', () => {
    for (const v of ['pops', 'training', 'dossie']) expect(canAccess('Supervisor', v), v).toBe(true);
  });

  it('só RT e administrador registram treinamento e veem a Saúde (ASO)', () => {
    for (const role of ['Nutricionista RT', 'Administrador', 'Super-admin']) {
      expect(podeEditarCapacitacao(sessao(role))).toBe(true);
      expect(podeVerSaudeAso(sessao(role))).toBe(true);
    }
    for (const role of ['Supervisor', 'Colaborador', 'Papel inventado']) {
      expect(podeEditarCapacitacao(sessao(role))).toBe(false);
      expect(podeVerSaudeAso(sessao(role))).toBe(false);
    }
    expect(podeEditarCapacitacao(null)).toBe(false);
  });
});

describe('Capacitação em modo consulta', () => {
  it('Supervisor: vê sessões e situação da equipe, sem criar, sem configurar, sem ASO', () => {
    const html = tela('Supervisor');
    expect(html).toContain('Sessões de treinamento');
    expect(html).toContain('Situação da equipe');
    expect(html).toContain('Modo consulta');
    expect(html).not.toContain('+ Nova sessão');
    expect(html).not.toContain('+ Criar primeira sessão');
    expect(html).not.toContain('Saúde (ASO)');
    expect(html).not.toContain('>Configurações<');
  });

  it('RT: tudo como antes', () => {
    const html = tela('Nutricionista RT');
    expect(html).toContain('+ Nova sessão');
    expect(html).toContain('Saúde (ASO)');
    expect(html).toContain('>Configurações<');
    expect(html).not.toContain('Modo consulta');
  });

  it('atalho direto para a aba ASO (Cmd+K) não abre a aba para o Supervisor', () => {
    localStorage.setItem('nutriops.training.pendingTab', 'aso');
    expect(tela('Supervisor')).not.toContain('Controle de saúde (ASO) por colaborador');
    // controle: para a RT o mesmo atalho abre a aba
    localStorage.setItem('nutriops.training.pendingTab', 'aso');
    expect(tela('Nutricionista RT')).toContain('Controle de saúde (ASO) por colaborador');
  });
});
