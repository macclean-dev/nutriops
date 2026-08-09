import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_OPEN_RULES, readOpenRules, writeOpenRules, readRulesUpdatedAt,
  resolveOpenRule, computeOpenedUntil, fmtRule, buildLabelTrace, parseLabelTrace,
} from './validity-rules';
import { generateLabel, daysUntil } from './validity';

// Etiquetas de abertura (Fase 1, 09/08) — regra por categoria configurada uma
// vez + botão "Abrir" que carimba hora e calcula o prazo. Estes testes guardam
// o motor de cálculo e o conteúdo da etiqueta.

beforeEach(() => localStorage.clear());

describe('regras de validade pós-abertura', () => {
  it('sem nada salvo, valem os padrões de fábrica', () => {
    const r = readOpenRules('t1');
    expect(r.carnes).toEqual({ amount: 48, unit: 'h' });
    expect(r.secos).toEqual({ amount: 30, unit: 'd' });
  });

  it('regra salva sobrescreve o padrão; inválida cai no padrão', () => {
    writeOpenRules('t1', { laticinios: { amount: 7, unit: 'd' }, carnes: { amount: 0, unit: 'x' } });
    const r = readOpenRules('t1');
    expect(r.laticinios).toEqual({ amount: 7, unit: 'd' });
    expect(r.carnes).toEqual(DEFAULT_OPEN_RULES.carnes); // inválida → fábrica
  });

  it('exceção do produto (daysAfterOpen) vence a regra da categoria', () => {
    const rules = readOpenRules('t1');
    const comExcecao = resolveOpenRule({ category: 'laticinios', daysAfterOpen: 2 }, rules);
    expect(comExcecao).toEqual({ amount: 2, unit: 'd', source: 'produto' });
    const semExcecao = resolveOpenRule({ category: 'laticinios', daysAfterOpen: null }, rules);
    expect(semExcecao.amount).toBe(5);
    expect(semExcecao.source).toBe('categoria');
  });

  it('categoria desconhecida cai em "outros"', () => {
    const r = resolveOpenRule({ category: 'inexistente' }, readOpenRules('t1'));
    expect(r.amount).toBe(DEFAULT_OPEN_RULES.outros.amount);
  });
});

describe('computeOpenedUntil', () => {
  it('horas: carne aberta às 12h de 09/08 com 48h vence às 12h de 11/08', () => {
    const { until, clamped } = computeOpenedUntil('2026-08-09T12:00:00.000Z', { amount: 48, unit: 'h' }, '2026-12-01');
    expect(until).toBe('2026-08-11T12:00:00.000Z');
    expect(clamped).toBe(false);
  });

  it('dias: açúcar aberto com 30 dias', () => {
    const { until } = computeOpenedUntil('2026-08-09T12:00:00.000Z', { amount: 30, unit: 'd' }, null);
    expect(until).toBe('2026-09-08T12:00:00.000Z');
  });

  it('NUNCA passa da validade original de fábrica (clamp)', () => {
    const { until, clamped } = computeOpenedUntil('2026-08-09T12:00:00.000Z', { amount: 30, unit: 'd' }, '2026-08-15');
    expect(clamped).toBe(true);
    expect(new Date(until) <= new Date('2026-08-15T23:59:59')).toBe(true);
  });

  it('abertura inválida devolve null sem explodir', () => {
    expect(computeOpenedUntil('lixo', { amount: 1, unit: 'd' }, null).until).toBeNull();
  });
});

describe('writeOpenRules / readRulesUpdatedAt (carimbo pra sync com a nuvem)', () => {
  it('sem carimbo salvo, readRulesUpdatedAt devolve null', () => {
    expect(readRulesUpdatedAt('t1')).toBeNull();
  });

  it('writeOpenRules estampa um updatedAt sozinha quando não recebe um', () => {
    writeOpenRules('t1', { outros: { amount: 5, unit: 'd' } });
    const carimbo = readRulesUpdatedAt('t1');
    expect(carimbo).toBeTruthy();
    expect(new Date(carimbo).toString()).not.toBe('Invalid Date');
  });

  it('writeOpenRules aceita um updatedAt explícito (usado pelo sync remoto)', () => {
    writeOpenRules('t1', { outros: { amount: 5, unit: 'd' } }, '2026-01-01T00:00:00.000Z');
    expect(readRulesUpdatedAt('t1')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('daysUntil (off-by-one corrigido)', () => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  it('hoje = 0, amanhã = 1, ontem = -1 (a versão antiga somava 1 em tudo)', () => {
    const hoje = new Date(); const amanha = new Date(Date.now() + 86400000); const ontem = new Date(Date.now() - 86400000);
    expect(daysUntil(iso(hoje))).toBe(0);
    expect(daysUntil(iso(amanha))).toBe(1);
    expect(daysUntil(iso(ontem))).toBe(-1);
    expect(daysUntil(null)).toBeNull();
  });
});

describe('buildLabelTrace / parseLabelTrace (o texto dentro do QR)', () => {
  // Bug real pego ao construir o leitor: openedAt é ISO e TEM ':' dentro
  // ("...T13:26:42.029Z"). Um split(':') ingênuo cortaria o carimbo de hora.
  it('round-trip com openedAt (o caso que quebraria um split ingênuo)', () => {
    const trace = buildLabelTrace('swiss', 'a1b2c3', '2026-08-09T13:26:42.029Z');
    expect(trace).toBe('nutriops:swiss:a1b2c3:2026-08-09T13:26:42.029Z');
    expect(parseLabelTrace(trace)).toEqual({
      tenantId: 'swiss', productId: 'a1b2c3', openedAt: '2026-08-09T13:26:42.029Z',
    });
  });

  it('produto ainda não aberto: openedAt vira null, não string vazia', () => {
    const trace = buildLabelTrace('swiss', 'a1b2c3', null);
    expect(trace).toBe('nutriops:swiss:a1b2c3:');
    expect(parseLabelTrace(trace)).toEqual({ tenantId: 'swiss', productId: 'a1b2c3', openedAt: null });
  });

  it('tenantId de cloud tenant (UUID) também sobrevive ao round-trip', () => {
    const trace = buildLabelTrace('bf245c3b-2f9a-4e11-8b3c-1234567890ab', 'prod-1', '2026-01-01T00:00:00.000Z');
    expect(parseLabelTrace(trace).tenantId).toBe('bf245c3b-2f9a-4e11-8b3c-1234567890ab');
  });

  it('texto que não é do NutriOPS → null (não quebra, não finge sucesso)', () => {
    expect(parseLabelTrace('https://suflex.com.br/etiqueta/123')).toBeNull();
    expect(parseLabelTrace('qualquer coisa')).toBeNull();
    expect(parseLabelTrace('')).toBeNull();
  });

  it('entrada não-string não quebra', () => {
    expect(parseLabelTrace(null)).toBeNull();
    expect(parseLabelTrace(undefined)).toBeNull();
    expect(parseLabelTrace(42)).toBeNull();
  });

  it('espaço em volta (câmera às vezes captura com \\n) é tolerado', () => {
    expect(parseLabelTrace('  nutriops:swiss:p1:  \n')).toEqual({ tenantId: 'swiss', productId: 'p1', openedAt: null });
  });
});

describe('fmtRule', () => {
  it('formata horas e dias', () => {
    expect(fmtRule({ amount: 48, unit: 'h' })).toBe('48 h');
    expect(fmtRule({ amount: 1, unit: 'd' })).toBe('1 dia');
    expect(fmtRule({ amount: 5, unit: 'd' })).toBe('5 dias');
  });
});

describe('generateLabel (etiqueta 60×60)', () => {
  const tenant = { id: 'swiss', name: 'Swiss' };
  const session = { user: { name: 'Fran' } };

  it('produto aberto: etiqueta traz manipulação com HORA, validade pós-abertura e responsável', () => {
    const html = generateLabel({
      name: 'Patinho moído', conservation: 'Refrigerado', expiryDate: '2026-12-01',
      openedAt: '2026-08-09T15:30:00.000Z', openedUntil: '2026-08-11T15:30:00.000Z', openedBy: 'Ana Paula',
    }, tenant, session);
    expect(html).toContain('MANIPULAÇÃO');
    expect(html).toContain('VALIDADE');
    expect(html).toContain('Ana Paula');          // quem abriu, não quem imprimiu
    expect(html).toMatch(/\d{2}\/\d{2}\/\d{2},? \d{2}:\d{2}/); // data COM hora
    expect(html).toContain('@page{size:60mm 60mm');
  });

  it('produto fechado: sem manipulação, validade é a original', () => {
    const html = generateLabel({ name: 'Açúcar', expiryDate: '2026-12-01' }, tenant, session);
    expect(html).not.toContain('MANIPULAÇÃO');
    expect(html).toContain('VALIDADE');
    expect(html).toContain('Fran'); // cai no usuário da sessão
  });

  it('QR e perfil da empresa entram quando fornecidos', () => {
    const html = generateLabel({ name: 'Açúcar' }, tenant, session, {
      qrDataUrl: 'data:image/png;base64,abc',
      profile: { razaoSocial: 'Swiss Ltda', cnpj: '00.000.000/0001-00', endereco: 'Rua X, 1' },
    });
    expect(html).toContain('data:image/png;base64,abc');
    expect(html).toContain('Swiss Ltda');
    expect(html).toContain('CNPJ 00.000.000/0001-00');
  });
});
