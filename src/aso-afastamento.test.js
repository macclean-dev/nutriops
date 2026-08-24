import { describe, it, expect } from 'vitest';
import { DOC_TYPES, LEAVE_TYPE_LABEL, currentLeave, teamAsoSummary, employeeAsoStatus } from './compliance';

// ─────────────────────────────────────────────────────────────────────────────
// "tem como adicionar 'afastado(a)' e licença 'maternidade'?" (dono, 23/08),
// na tela de Controle de saúde (ASO). Não é resultado de exame — é a situação
// da pessoa. Fica como doc_type próprio (LEAVE), lido do mesmo array de docs
// que o ASO já usa, sem mexer no `resultado` do exame nem no `status`
// Ativo/Inativo/Pendente que Equipe → Usuários já usa pra login/PIN.
// ─────────────────────────────────────────────────────────────────────────────

const docLeave = (subject, leaveType, updatedAt = '2026-08-23T10:00:00.000Z') => ({
  id: `l-${subject}-${updatedAt}`, docType: DOC_TYPES.LEAVE, subject, leaveType, updatedAt,
});

const docAso = (subject, validUntil, resultado = 'apto') => ({
  id: `a-${subject}`, docType: DOC_TYPES.ASO, subject, issuedAt: '2026-01-01',
  validUntil, resultado,
});

describe('currentLeave', () => {
  it('sem doc nenhum, não está afastada', () => {
    expect(currentLeave('Amanda', [])).toBeNull();
  });

  it('com doc de afastamento, devolve o tipo certo', () => {
    const docs = [docLeave('Amanda', 'licenca_maternidade')];
    expect(currentLeave('Amanda', docs)?.leaveType).toBe('licenca_maternidade');
  });

  it('ignora doc de outro colaborador', () => {
    const docs = [docLeave('Amanda', 'afastado')];
    expect(currentLeave('Bruna', docs)).toBeNull();
  });

  it('ignora doc de outro tipo (ASO não é afastamento)', () => {
    const docs = [docAso('Amanda', '2027-01-01')];
    expect(currentLeave('Amanda', docs)).toBeNull();
  });

  it('duas linhas por falta de unique constraint — pega a mais recente por updatedAt', () => {
    const docs = [
      docLeave('Amanda', 'afastado', '2026-08-01T09:00:00.000Z'),
      docLeave('Amanda', 'licenca_maternidade', '2026-08-20T09:00:00.000Z'),
    ];
    expect(currentLeave('Amanda', docs)?.leaveType).toBe('licenca_maternidade');
  });

  it('"voltou ao trabalho" é modelado como AUSÊNCIA do doc, não um 3º valor', () => {
    // A tela apaga o doc quando a pessoa volta (ver AsoPanel) — não escreve
    // leaveType:null. currentLeave trata null/undefined do mesmo jeito:
    // nunca "está afastada".
    const docs = [{ ...docLeave('Amanda', null) }];
    expect(currentLeave('Amanda', docs)).toBeNull();
  });
});

describe('teamAsoSummary — quem está afastada não pode virar alarme falso', () => {
  const staff = [{ name: 'Amanda', role: 'Colaborador' }, { name: 'Bruna', role: 'Colaborador' }];

  it('ASO vencido de quem está afastada NÃO entra na contagem "Vencido"', () => {
    const docs = [docAso('Amanda', '2020-01-01'), docLeave('Amanda', 'licenca_maternidade')];
    const r = teamAsoSummary(staff, docs);
    expect(r.expired).toBe(0);       // Amanda venceria, mas está afastada — não conta
    expect(r.never).toBe(1);         // só a Bruna, sem ASO nenhum
    expect(r.leave).toBe(1);
  });

  it('o status REAL do ASO continua disponível na linha da pessoa — não é apagado, só não conta no topo', () => {
    const docs = [docAso('Amanda', '2020-01-01'), docLeave('Amanda', 'licenca_maternidade')];
    const r = teamAsoSummary(staff, docs);
    const amanda = r.situacoes.find((s) => s.name === 'Amanda');
    expect(amanda.status).toBe('expired');       // continua honesto
    expect(amanda.leaveType).toBe('licenca_maternidade');
  });

  it('sem afastamento nenhum, o comportamento de antes continua idêntico', () => {
    const docs = [docAso('Amanda', '2020-01-01')];
    const r = teamAsoSummary(staff, docs);
    expect(r.expired).toBe(1);
    expect(r.leave).toBe(0);
    expect(r.situacoes.every((s) => s.leaveType === null)).toBe(true);
  });

  it('as duas variantes (afastado e licença maternidade) contam igual no total "leave"', () => {
    const staff3 = [...staff, { name: 'Carla', role: 'Colaborador' }];
    const docs = [docLeave('Amanda', 'afastado'), docLeave('Bruna', 'licenca_maternidade')];
    const r = teamAsoSummary(staff3, docs);
    expect(r.leave).toBe(2);
  });

  it('employeeAsoStatus nunca vê os docs de afastamento — filtra por docType', () => {
    // Trava que a mistura no MESMO array `docs` não vaza pro cálculo de ASO.
    const docs = [docLeave('Amanda', 'afastado')];
    expect(employeeAsoStatus('Amanda', docs).status).toBe('never');
  });
});

describe('LEAVE_TYPE_LABEL', () => {
  it('tem as duas opções pedidas, com o texto exato', () => {
    expect(LEAVE_TYPE_LABEL.afastado).toBe('Afastado(a)');
    expect(LEAVE_TYPE_LABEL.licenca_maternidade).toBe('Licença maternidade');
  });
});
