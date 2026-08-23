import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { segmentIdFromLabel, segmentLabel, SEGMENTS } from './segments';

// ─────────────────────────────────────────────────────────────────────────────
// "eu escolho o segmento Confeitaria e ele continua deixando padaria" (dono,
// 23/08). Causa: `tenant.segment` guarda o LABEL ("Confeitaria"); o <select>
// do ClientModal trabalha com ids ('confeitaria'). Comparando label com id,
// nunca batia, e o navegador caía na 1ª opção da lista — sempre "Padaria",
// não importa o segmento real do cliente.
// ─────────────────────────────────────────────────────────────────────────────

describe('segmentIdFromLabel — a ponte que faltava', () => {
  it('resolve o label exato pro id certo', () => {
    expect(segmentIdFromLabel('Confeitaria')).toBe('confeitaria');
    expect(segmentIdFromLabel('Padaria')).toBe('padaria');
  });

  it('é o motivo do bug: SEM a ponte, "Confeitaria" nunca bate com nenhum id', () => {
    expect(SEGMENTS.some(s => s.id === 'Confeitaria')).toBe(false);
  });

  it('resolve o próprio id também — idempotente', () => {
    expect(segmentIdFromLabel('confeitaria')).toBe('confeitaria');
  });

  it('cobre a forma curta do seed antigo — DBK Produção salva "Produção", label completo é "Produção de alimentos"', () => {
    expect(segmentIdFromLabel('Produção')).toBe('producao');
  });

  it('ignora caixa', () => {
    expect(segmentIdFromLabel('PADARIA')).toBe('padaria');
    expect(segmentIdFromLabel('confeitaria')).toBe('confeitaria');
  });

  it('texto desconhecido não vira Padaria por acidente — devolve null', () => {
    expect(segmentIdFromLabel('Alguma coisa que não existe')).toBeNull();
  });

  it('vazio/nulo devolve null, nunca um id default escondido', () => {
    expect(segmentIdFromLabel('')).toBeNull();
    expect(segmentIdFromLabel(null)).toBeNull();
    expect(segmentIdFromLabel(undefined)).toBeNull();
  });

  it('os 3 segmentos reais em produção resolvem certo', () => {
    // Swiss, Bäckerei, DBK Produção — src/tenants-public.js
    expect(segmentIdFromLabel('Confeitaria')).toBe('confeitaria');  // Swiss
    expect(segmentIdFromLabel('Padaria')).toBe('padaria');          // Bäckerei
    expect(segmentIdFromLabel('Produção')).toBe('producao');        // DBK
  });
});

describe('segmentLabel aplicado em cima de um label já pronto é inofensivo', () => {
  it('devolve o mesmo texto de volta — é o que sustenta a autocura das telas de exibição', () => {
    expect(segmentLabel('Confeitaria')).toBe('Confeitaria');
    expect(segmentLabel('Produção')).toBe('Produção');   // não existe id 'Produção' → cai no fallback ?? id
  });

  it('id cru vira o label bonito — autocura de registro salvo com o bug antigo', () => {
    expect(segmentLabel('confeitaria')).toBe('Confeitaria');
  });
});

describe('a mudança no admin.jsx — travada na fonte', () => {
  const fonte = readFileSync(`${process.cwd()}/src/admin.jsx`, 'utf8');

  it('o estado inicial do select passa pela ponte', () => {
    expect(fonte).toContain('segmentIdFromLabel(client?.segment) ?? \'padaria\'');
  });

  it('o salvamento LOCAL grava o label, não o id cru — mesmo formato que a nuvem já usa', () => {
    expect(fonte).toContain('segment: segmentLabel(segment), active');
    expect(fonte).not.toMatch(/plan, segment, active/);
  });

  it('as duas telas de listagem exibem via segmentLabel — autocura registro antigo', () => {
    expect(fonte).toContain('{segmentLabel(tenant.segment) || \'unidade\'}');
    expect(fonte).toContain('{segmentLabel(t.segment) ?? \'unidade\'}');
  });
});
