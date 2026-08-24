import { describe, it, expect } from 'vitest';
import { DOC_TYPES, LEAVE_TYPE_LABEL, currentLeave, teamAsoSummary, employeeAsoStatus, hojeISO, descreverAfastamento } from './compliance';

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

// ─── Data do afastamento (pedido da RT, 24/08) ───────────────────────────────

describe('hojeISO — default do campo de início', () => {
  it('usa o fuso de quem olha, não UTC', () => {
    // 24/08/2026 23:30 em Brasília (UTC-3) = 25/08 02:30 UTC. toISOString()
    // devolveria "2026-08-25" e o campo nasceria com a data de amanhã.
    const local2330 = new Date(2026, 7, 24, 23, 30).getTime();
    expect(hojeISO(local2330)).toBe('2026-08-24');
  });

  it('formata com zero à esquerda', () => {
    expect(hojeISO(new Date(2026, 0, 5, 10, 0).getTime())).toBe('2026-01-05');
  });
});

describe('descreverAfastamento — o texto que a RT lê na linha', () => {
  it('junta rótulo e data em pt-BR', () => {
    expect(descreverAfastamento('licenca_maternidade', '2026-08-24'))
      .toBe('Licença maternidade desde 24/08/2026');
  });

  it('sem data (registro da v1.9.222, antes do campo existir) mostra só o rótulo — não inventa data nem esconde o afastamento', () => {
    expect(descreverAfastamento('afastado', null)).toBe('Afastado(a)');
    expect(descreverAfastamento('afastado', '')).toBe('Afastado(a)');
  });

  it('data torta cai pro rótulo em vez de imprimir "Invalid Date"', () => {
    expect(descreverAfastamento('afastado', 'não é data')).toBe('Afastado(a)');
  });

  it('sem tipo, não há texto nenhum', () => {
    expect(descreverAfastamento(null, '2026-08-24')).toBeNull();
  });

  it('a data não escorrega um dia por causa de fuso — meio-dia, não meia-noite', () => {
    // `new Date('2026-08-24T00:00')` seria interpretado local, mas
    // `new Date('2026-08-24')` é UTC e vira 23/08 no Brasil. O T12:00 protege.
    expect(descreverAfastamento('afastado', '2026-08-24')).toContain('24/08/2026');
    expect(descreverAfastamento('afastado', '2026-01-01')).toContain('01/01/2026');
  });
});

describe('teamAsoSummary expõe a data pra tela', () => {
  const staff = [{ name: 'Amanda', role: 'Colaborador' }];

  it('devolve leaveStartedAt junto do leaveType', () => {
    const docs = [{ id:'l1', docType: DOC_TYPES.LEAVE, subject:'Amanda',
                    leaveType:'licenca_maternidade', startedAt:'2026-08-24',
                    updatedAt:'2026-08-24T10:00:00.000Z' }];
    const s = teamAsoSummary(staff, docs).situacoes[0];
    expect(s.leaveType).toBe('licenca_maternidade');
    expect(s.leaveStartedAt).toBe('2026-08-24');
  });

  it('doc antigo sem startedAt não quebra — vira null', () => {
    const docs = [{ id:'l1', docType: DOC_TYPES.LEAVE, subject:'Amanda',
                    leaveType:'afastado', updatedAt:'2026-08-20T10:00:00.000Z' }];
    const s = teamAsoSummary(staff, docs).situacoes[0];
    expect(s.leaveType).toBe('afastado');
    expect(s.leaveStartedAt).toBeNull();
  });
});
