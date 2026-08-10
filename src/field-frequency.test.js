import { describe, it, expect } from 'vitest';
import { isFieldDue, dueFields } from './field-frequency';

describe('isFieldDue', () => {
  it('sem frequência própria, sempre devido (comportamento de sempre)', () => {
    expect(isFieldDue({ label: 'Bancada' }, 'weekly', new Date('2026-08-09'))).toBe(true);
  });

  it('frequência própria igual à da planilha, sempre devido', () => {
    expect(isFieldDue({ frequency: 'weekly' }, 'weekly', new Date('2026-08-09'))).toBe(true);
  });

  it('tarefa diária numa planilha semanal (mais curta que a planilha) sempre devida', () => {
    expect(isFieldDue({ frequency: 'daily' }, 'weekly', new Date('2026-08-09'))).toBe(true);
  });

  it('tarefa mensal numa planilha semanal só é devida na semana que cruza o início do mês', () => {
    // 2026-08-01 é sábado; a semana que contém o dia 1 do mês é a "devida".
    const semanaDoInicioDoMes = new Date('2026-08-03T12:00:00'); // segunda da mesma semana do dia 1
    const semanaSeguinte = new Date('2026-08-10T12:00:00');
    expect(isFieldDue({ frequency: 'monthly' }, 'weekly', semanaDoInicioDoMes)).toBe(true);
    expect(isFieldDue({ frequency: 'monthly' }, 'weekly', semanaSeguinte)).toBe(false);
  });

  it('tarefa anual numa planilha semanal só é devida na semana que cruza o início do ano', () => {
    const semanaDoAnoNovo = new Date('2026-01-02T12:00:00');
    const outraSemana = new Date('2026-06-15T12:00:00');
    expect(isFieldDue({ frequency: 'annual' }, 'weekly', semanaDoAnoNovo)).toBe(true);
    expect(isFieldDue({ frequency: 'annual' }, 'weekly', outraSemana)).toBe(false);
  });

  it('tarefa trimestral numa planilha semanal só é devida na semana que cruza o início do trimestre', () => {
    const semanaDoInicioQ3 = new Date('2026-07-06T12:00:00'); // início de julho = início do Q3
    const semanaNoMeioDoTrimestre = new Date('2026-08-10T12:00:00');
    expect(isFieldDue({ frequency: 'quarterly' }, 'weekly', semanaDoInicioQ3)).toBe(true);
    expect(isFieldDue({ frequency: 'quarterly' }, 'weekly', semanaNoMeioDoTrimestre)).toBe(false);
  });
});

describe('dueFields', () => {
  it('filtra só os campos devidos, preservando os sem frequência própria', () => {
    const fields = [
      { id: 'a', label: 'Bancada' },
      { id: 'b', label: 'Paredes (trimestral)', frequency: 'quarterly' },
    ];
    const meioDoTrimestre = new Date('2026-08-10T12:00:00');
    const result = dueFields(fields, 'weekly', meioDoTrimestre);
    expect(result.map((f) => f.id)).toEqual(['a']);
  });

  it('lista vazia/undefined não quebra', () => {
    expect(dueFields(undefined, 'weekly')).toEqual([]);
    expect(dueFields([], 'weekly')).toEqual([]);
  });
});
