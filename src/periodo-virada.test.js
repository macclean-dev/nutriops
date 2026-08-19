import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getPeriodKey, makePeriodKey, formatPeriodLabel } from './forms';

// ─────────────────────────────────────────────────────────────────────────────
// O periodKey era capturado quando a planilha ABRIA e nunca recalculado. Quem
// começa às 23:58 e confirma às 00:03 gravava na folha de ONTEM — e como o
// save faz upsert por (formId, periodKey), SOBRESCREVIA a folha de ontem que
// já estava preenchida. A DBK Produção vira a noite.
// Achado da auditoria (18/08).
// ─────────────────────────────────────────────────────────────────────────────

const as = (iso) => new Date(iso);

describe('a virada de fato muda a chave do período', () => {
  it('diária: 23:58 e 00:03 caem em dias diferentes', () => {
    const antes  = getPeriodKey('daily', as('2026-08-19T23:58:00'));
    const depois = getPeriodKey('daily', as('2026-08-20T00:03:00'));
    expect(antes).not.toBe(depois);
  });

  it('com setor, idem — a chave carrega o escopo', () => {
    const antes  = makePeriodKey('daily', as('2026-08-19T23:58:00'), 'Padaria');
    const depois = makePeriodKey('daily', as('2026-08-20T00:03:00'), 'Padaria');
    expect(antes).not.toBe(depois);
    expect(antes).toContain('Padaria');
  });

  it('mesmo dia não dispara nada', () => {
    expect(getPeriodKey('daily', as('2026-08-19T08:00:00')))
      .toBe(getPeriodKey('daily', as('2026-08-19T22:00:00')));
  });

  it('os dois períodos têm rótulo legível — é o que vai na pergunta', () => {
    const pk = getPeriodKey('daily', as('2026-08-19T23:58:00'));
    expect(formatPeriodLabel('daily', pk)).toBeTruthy();
    expect(formatPeriodLabel('daily', pk)).not.toBe(pk);
  });
});

describe('forms.jsx — o save reconfere o período', () => {
  const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

  it('recalcula na hora de gravar, não usa o congelado direto', () => {
    expect(fonte).toContain('const pkAgora = escopo');
    expect(fonte).toContain('getPeriodKey(template.frequency, new Date())');
  });

  it('pergunta em vez de trocar em silêncio — pode ser o turno que acabou', () => {
    expect(fonte).toContain('A data virou enquanto você preenchia');
  });

  it('o registro grava o período DECIDIDO, não o de abertura', () => {
    expect(fonte).toContain('periodKey: periodoFinal,');
    expect(fonte).toContain("prev.find((r) => r.formId===template.id && r.periodKey===periodoFinal)");
  });

  it('o escopo (setor) viaja junto — senão o recálculo acharia que sempre mudou', () => {
    expect(fonte).toContain('escopo: campoEscopo ? setorSel : null');
  });
});
