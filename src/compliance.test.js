import { describe, it, expect } from 'vitest';
import {
  DOC_TYPES, COMPLIANCE_DEFAULTS, MANUAL_REVISAO_MESES,
  diasAteVencer, validadeEfetiva, employeeAsoStatus, teamAsoSummary,
  manualBpStatus, alvaraStatus,
} from './compliance';

// Fatia 2b: os 3 DESCOBERTOS que sobravam da auditoria RDC — ASO (§3.4),
// Manual de BP (§3.18) e a validade do alvará (§3.21). Exigências que o
// fiscal pede e que o app não tinha onde anotar.

const NOW = new Date('2026-08-15T14:00:00').getTime();
const aso = (subject, over = {}) => ({
  id: `a-${subject}`, docType: DOC_TYPES.ASO, subject,
  issuedAt: '2026-01-10', resultado: 'apto', ...over,
});

describe('diasAteVencer', () => {
  it('conta meia-noite contra meia-noite — "vence hoje" é 0, não -1', () => {
    expect(diasAteVencer('2026-08-15', NOW)).toBe(0);
    expect(diasAteVencer('2026-08-20', NOW)).toBe(5);
    expect(diasAteVencer('2026-08-10', NOW)).toBe(-5);
  });

  it('aceita ISO completo (o que vem da nuvem) e não só YYYY-MM-DD', () => {
    expect(diasAteVencer('2026-08-20T00:00:00.000Z', NOW)).toBe(5);
  });

  it('sem data devolve null, NÃO zero — é ausência de dado', () => {
    expect(diasAteVencer(null, NOW)).toBeNull();
    expect(diasAteVencer('', NOW)).toBeNull();
    expect(diasAteVencer('data inválida', NOW)).toBeNull();
  });
});

describe('validadeEfetiva', () => {
  it('validade explícita do exame vence a régua — quem manda é o médico', () => {
    expect(validadeEfetiva({ issuedAt: '2026-01-10', validUntil: '2026-04-10' }, 12)).toBe('2026-04-10');
  });

  it('sem validade, deriva de emissão + a régua da loja', () => {
    expect(validadeEfetiva({ issuedAt: '2026-01-10' }, 12)).toBe('2027-01-10');
    expect(validadeEfetiva({ issuedAt: '2026-01-10' }, 6)).toBe('2026-07-10');
  });

  it('sem emissão não há o que derivar — null, não hoje', () => {
    expect(validadeEfetiva({}, 12)).toBeNull();
    expect(validadeEfetiva(null, 12)).toBeNull();
  });
});

describe('employeeAsoStatus', () => {
  it('sem nenhum ASO ⇒ never (ausência de documento, não documento em ordem)', () => {
    expect(employeeAsoStatus('Ana', [], 12, NOW)).toMatchObject({ status: 'never', doc: null });
  });

  it('exame recente ⇒ ok', () => {
    expect(employeeAsoStatus('Ana', [aso('Ana')], 12, NOW).status).toBe('ok');
  });

  it('vencido ⇒ expired, com quantos dias faz', () => {
    const r = employeeAsoStatus('Ana', [aso('Ana', { validUntil: '2026-07-01' })], 12, NOW);
    expect(r.status).toBe('expired');
    expect(r.diasRestantes).toBe(-45);
  });

  it('vencendo dentro de 30 dias ⇒ warn', () => {
    expect(employeeAsoStatus('Ana', [aso('Ana', { validUntil: '2026-09-01' })], 12, NOW).status).toBe('warn');
  });

  it('ASO de OUTRO colaborador não vale pra este', () => {
    expect(employeeAsoStatus('Ana', [aso('Bruno')], 12, NOW).status).toBe('never');
  });

  it('com vários exames, vale o de validade mais distante (a renovação)', () => {
    const docs = [aso('Ana', { id: 'velho', validUntil: '2026-03-01' }), aso('Ana', { id: 'novo', validUntil: '2027-03-01' })];
    const r = employeeAsoStatus('Ana', docs, 12, NOW);
    expect(r.status).toBe('ok');
    expect(r.doc.id).toBe('novo');
  });

  it('documento de outro tipo (Manual de BP) não conta como ASO', () => {
    const manual = { id: 'm', docType: DOC_TYPES.MANUAL_BP, subject: 'Ana', issuedAt: '2026-08-01' };
    expect(employeeAsoStatus('Ana', [manual], 12, NOW).status).toBe('never');
  });
});

describe('teamAsoSummary', () => {
  const equipe = [
    { name: 'Ana', role: 'Colaborador', status: 'Ativo' },
    { name: 'Bruno', role: 'Colaborador', status: 'Pendente' },
    { name: 'Antigo', role: 'Colaborador', status: 'Inativo' },
  ];

  it('conta só quem opera — "Pendente" entra, "Inativo" não', () => {
    const r = teamAsoSummary(equipe, [aso('Ana')], 12, NOW);
    expect(r.total).toBe(2);
    expect(r.ok).toBe(1);
    expect(r.never).toBe(1);   // Bruno
    expect(r.situacoes.some((s) => s.name === 'Antigo')).toBe(false);
  });

  it('equipe vazia não quebra', () => {
    expect(teamAsoSummary([], [], 12, NOW)).toMatchObject({ total: 0, ok: 0, never: 0 });
    expect(teamAsoSummary(undefined, undefined, 12, NOW).total).toBe(0);
  });
});

describe('manualBpStatus', () => {
  it('sem registro ⇒ never', () => {
    expect(manualBpStatus(null, NOW).status).toBe('never');
    expect(manualBpStatus({ versao: '3ª' }, NOW).status).toBe('never');  // sem data não atesta nada
  });

  it('versão recente ⇒ ok', () => {
    expect(manualBpStatus({ issuedAt: '2026-01-10' }, NOW).status).toBe('ok');
  });

  it(`versão de mais de ${MANUAL_REVISAO_MESES} meses ⇒ warn (revisar)`, () => {
    expect(manualBpStatus({ issuedAt: '2022-01-10' }, NOW).status).toBe('warn');
  });
});

describe('alvaraStatus', () => {
  it('sem número ⇒ fail', () => {
    expect(alvaraStatus({}, NOW).status).toBe('fail');
    expect(alvaraStatus({ alvara: '   ' }, NOW).status).toBe('fail');
  });

  // Comportamento herdado da Fatia 1: número sem validade valia "ok com
  // ressalva". Agora que existe o campo, vira warn — é um convite a preencher.
  it('número sem validade ⇒ warn, não ok', () => {
    const r = alvaraStatus({ alvara: '123/2026' }, NOW);
    expect(r.status).toBe('warn');
    expect(r.dias).toBeNull();
  });

  it('validade futura ⇒ ok', () => {
    expect(alvaraStatus({ alvara: '123', alvaraValidade: '2027-01-01' }, NOW).status).toBe('ok');
  });

  it('vencendo em até 30 dias ⇒ warn', () => {
    expect(alvaraStatus({ alvara: '123', alvaraValidade: '2026-09-01' }, NOW).status).toBe('warn');
  });

  it('vencido ⇒ fail (operar com alvará vencido é interdição)', () => {
    const r = alvaraStatus({ alvara: '123', alvaraValidade: '2026-07-01' }, NOW);
    expect(r.status).toBe('fail');
    expect(r.dias).toBe(-45);
  });
});

describe('COMPLIANCE_DEFAULTS', () => {
  it('a régua do ASO é 12 meses — SUPOSIÇÃO do PCMSO/NR-7, não texto da RDC', () => {
    expect(COMPLIANCE_DEFAULTS.asoValidadeMeses).toBe(12);
  });
});
