import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { podeAprovarPop, popAprovado, aprovarPop, editarPop, descreverAprovacao, versaoDoPop } from './pop-aprovacao';
import { computeReadiness, REQUIRED_POPS } from './readiness';
import { sectionPOPs } from './dossier';
import { POPsView } from './controls.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Candidata 1 da pesquisa de 03/10. RDC 216 4.11.2: POP "aprovado, datado e
// assinado pelo responsável do estabelecimento". Até a v1.9.265: assinatura em
// branco no PDF, sem edição, e a Prontidão contava qualquer POP cadastrado.
// Quem aprova (decisão do dono, 03/10): RT ou dono.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-03T12:00:00').getTime();
const sessao = (role, extra = {}) => ({ user: { name: 'Ana Paula', role }, tenantId: 'swiss', ...extra });
const pop = (over = {}) => ({ id: 'p1', title: 'Higienização de equipamentos', category: 'limpeza', steps: ['Lavar', 'Sanitizar'], frequency: 'Diário', createdBy: 'Ana Paula', createdAt: '2026-09-01T10:00:00Z', ...over });

describe('quem aprova: RT ou dono', () => {
  it('RT e Administrador da loja aprovam', () => {
    expect(podeAprovarPop(sessao('Nutricionista RT'))).toBe(true);
    expect(podeAprovarPop(sessao('Administrador'))).toBe(true);
  });
  it('Colaborador, Supervisor e conta de loja não', () => {
    expect(podeAprovarPop(sessao('Colaborador'))).toBe(false);
    expect(podeAprovarPop(sessao('Supervisor'))).toBe(false);
    expect(podeAprovarPop(sessao('Administrador', { isStoreAccount: true }))).toBe(false);
  });
});

describe('aprovar e editar', () => {
  it('POP antigo, sem versão: é a versão 1 e não está aprovado', () => {
    expect(versaoDoPop(pop())).toBe(1);
    expect(popAprovado(pop())).toBe(false);
  });

  it('aprovar carimba nome, perfil, data e versão', () => {
    const a = aprovarPop(pop(), sessao('Nutricionista RT'), NOW);
    expect(a.approval).toEqual({ by: 'Ana Paula', role: 'Nutricionista RT', at: new Date(NOW).toISOString(), version: 1 });
    expect(popAprovado(a)).toBe(true);
    expect(descreverAprovacao(a)).toBe('Versão 1 · aprovado por Ana Paula (Nutricionista RT) em 03/10/2026');
  });

  it('editar o texto gera a versão 2, derruba a aprovação e guarda a v1 aprovada no histórico', () => {
    const v1 = aprovarPop(pop(), sessao('Nutricionista RT'), NOW);
    const v2 = editarPop(v1, { steps: ['Lavar', 'Enxaguar', 'Sanitizar'] }, sessao('Administrador'), NOW + 1000);
    expect(versaoDoPop(v2)).toBe(2);
    expect(popAprovado(v2)).toBe(false);
    expect(v2.steps).toEqual(['Lavar', 'Enxaguar', 'Sanitizar']);
    expect(v2.history[0].version).toBe(1);
    expect(v2.history[0].steps).toEqual(['Lavar', 'Sanitizar']);
    expect(v2.history[0].approval.by).toBe('Ana Paula');
    expect(descreverAprovacao(v2)).toBe('Versão 2 · aguardando aprovação');
  });

  it('salvar sem mudar nada não derruba uma aprovação válida', () => {
    const v1 = aprovarPop(pop(), sessao('Nutricionista RT'), NOW);
    const mesmo = editarPop(v1, { title: v1.title, steps: [...v1.steps] }, sessao('Administrador'), NOW);
    expect(mesmo).toBe(v1);
    expect(popAprovado(mesmo)).toBe(true);
  });

  it('aprovação de versão ANTERIOR não vale pra versão atual', () => {
    expect(popAprovado(pop({ version: 2, approval: { by: 'X', at: '2026-01-01', version: 1 } }))).toBe(false);
  });
});

describe('Prontidão: B3 conta só POP aprovado', () => {
  const loja = (pops) => ({
    tenant: { id: 'swiss' }, now: NOW, pendingNc: [], products: [], turnAlerts: [], catalog: [], temperatureRecords: [],
    staff: [], trainingSessions: [], formTemplates: [], formRecords: [], pendingForms: [], pops,
    companyProfile: {}, complianceDocs: [], controlsByType: {}, sync: {}, localOnly: {}, actions: [], maintenance: [],
  });
  const b3 = (pops) => computeReadiness(loja(pops)).groups.flatMap((g) => g.checks).find((c) => c.id === 'b3-pops');
  const os4 = (aprovados) => REQUIRED_POPS.map((r, i) => {
    const p = pop({ id: `p${i}`, title: r.label, category: r.categories[0] ?? 'outros' });
    return aprovados ? aprovarPop(p, sessao('Nutricionista RT'), NOW) : p;
  });

  it('os 4 cadastrados e aprovados: ok', () => {
    expect(b3(os4(true)).status).toBe('ok');
  });

  it('os 4 cadastrados sem aprovação: aviso dizendo que falta SÓ aprovar', () => {
    const c = b3(os4(false));
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('aguardando aprovação');
    expect(c.detail).not.toContain('Não encontrei POP');
  });

  it('nenhum POP: aviso de que não existe', () => {
    expect(b3([]).detail).toContain('Não encontrei POP');
  });
});

describe('PDF do POP e Dossiê', () => {
  it('o Dossiê mostra a aprovação de cada POP e quantos estão aprovados', () => {
    const s = sectionPOPs([aprovarPop(pop(), sessao('Nutricionista RT'), NOW), pop({ id: 'p2', title: 'Pragas' })]);
    expect(s.title).toContain('2 documentados, 1 aprovados');
    expect(s.rowsHtml).toContain('aprovado por Ana Paula');
    expect(s.rowsHtml).toContain('aguardando aprovação');
  });

  it('o PDF do POP sai com a aprovação, não com a linha em branco de antes', () => {
    const fonte = readFileSync(`${process.cwd()}/src/controls.jsx`, 'utf8');
    expect(fonte).not.toContain('Nutricionista RT / Data: _______________');
    expect(fonte).toContain('${descreverAprovacao(pop)}');
  });
});

describe('a tela de POPs, renderizada de verdade', () => {
  const tenant = { id: 'swiss', name: 'Swiss' };
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('nutriops.pops.swiss', JSON.stringify([
      aprovarPop(pop(), sessao('Nutricionista RT'), NOW),
      pop({ id: 'p2', title: 'Controle de pragas', category: 'pragas' }),
    ]));
  });
  const render = (session) => renderToStaticMarkup(<POPsView activeTenant={tenant} allTenants={[tenant]} onTenantChange={() => {}} session={session} />);

  it('cada POP mostra se está aprovado', () => {
    const html = render(sessao('Nutricionista RT'));
    expect(html).toContain('>Aprovado<');
    expect(html).toContain('>Aguardando aprovação<');
  });
});
