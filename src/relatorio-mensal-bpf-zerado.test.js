import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getPeriodKey } from './forms';

// Relato da nutricionista da CASA DOCE (30/09), vídeo mostrando o Relatório
// Mensal de Conformidade Sanitária impresso: "todos os registros de
// temperatura aparecem certo, já as planilhas de controle BPF aparecem
// 'preenchimento 0' 'validados RT 0'" - em TODAS as linhas da tabela, pra
// TODAS as planilhas. Ao mesmo tempo a Visão geral mostrava 992 registros e
// 99% de conformidade, e a Validação RT mostrava fila normal: não é perda de
// dado, é a CONTAGEM deste PDF que vinha zerada.
//
// CAUSA: a linha comparava STRING periodKey (que sempre tem hífen - diária
// "2026-09-15", semanal "2026-W38", quinzenal "2026-09-A", mensal "2026-09",
// semestral "2026-S2") contra o mês selecionado SEM hífen ("202609"). Em
// ordem lexicográfica o caractere '-' (código 45) vem ANTES de qualquer
// dígito (48-57) - então toda periodKey perdia a comparação ">=", sempre,
// pra qualquer mês. Mesma causa pra todas as frequências, nenhuma exceção.

describe('a comparação antiga zerava literalmente TUDO, pra qualquer periodKey', () => {
  const selectedMonth = '2026-09';
  const mesSemHifen = selectedMonth.replace('-', '');

  it('o mês vira "202609" (só tira o PRIMEIRO hífen, mas "2026-09" só tinha um mesmo)', () => {
    expect(mesSemHifen).toBe('202609');
  });

  it('NENHUMA periodKey real passa nessa comparação, em nenhuma frequência', () => {
    const hoje = new Date('2026-09-15T10:00:00');
    const periodKeys = {
      daily: getPeriodKey('daily', hoje),
      weekly: getPeriodKey('weekly', hoje),
      biweekly: getPeriodKey('biweekly', hoje),
      monthly: getPeriodKey('monthly', hoje),
      semiannual: getPeriodKey('semiannual', hoje),
    };
    for (const [freq, pk] of Object.entries(periodKeys)) {
      expect(pk, freq).toMatch(/-/);            // toda periodKey real tem hífen
      expect(pk >= mesSemHifen, `${freq}: "${pk}" >= "${mesSemHifen}"`).toBe(false);
    }
  });
});

describe('o conserto: mesmo critério que a seção de Temperatura já usa (createdAt entre monthStart/monthEnd)', () => {
  const fonte = readFileSync(`${process.cwd()}/src/extras.jsx`, 'utf8');
  const ini = fonte.indexOf('// BPF summary');
  const fim = fonte.indexOf('}).join', fonte.indexOf('bpfRows = tenants.map'));
  const bloco = fonte.slice(ini, fim);

  it('não compara mais periodKey (string) contra o mês com hífen removido', () => {
    // Descarta linhas de comentário (o comentário acima cita a linha antiga,
    // entre crases, só pra explicar a causa) e olha só o código de verdade.
    const codigo = bloco.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(codigo).not.toMatch(/r\.periodKey\s*>=\s*selectedMonth/);
  });

  it('usa createdAt e a janela monthStart/monthEnd, igual a seção de Temperatura', () => {
    expect(bloco).toContain('new Date(r.createdAt).getTime()');
    expect(bloco).toMatch(/>=\s*monthStart/);
    expect(bloco).toMatch(/<=\s*monthEnd/);
  });

  it('continua exigindo status submitted (rascunho não conta como "preenchimento")', () => {
    expect(bloco).toContain("r.status !== 'submitted'");
  });

  it('a lógica corrigida, aplicada aos mesmos periodKeys de cima, agora CONTA os registros do mês certo', () => {
    // Reproduz a comparação nova com dados de verdade: um registro criado em
    // setembro tem que contar pro relatório de setembro, em QUALQUER
    // frequência de planilha.
    const [year, month] = ['2026', '09'].map(Number);
    const monthStart = new Date(year, month - 1, 1).getTime();
    const monthEnd   = new Date(year, month, 0, 23, 59, 59).getTime();

    const registrosDeSetembro = [
      { createdAt: '2026-09-01T08:00:00', status: 'submitted' }, // 1º dia do mês
      { createdAt: '2026-09-15T14:00:00', status: 'submitted' },
      { createdAt: '2026-09-30T23:59:00', status: 'submitted' }, // último instante do mês
    ];
    const registrosDeOutroMes = [
      { createdAt: '2026-08-31T23:59:59', status: 'submitted' }, // véspera
      { createdAt: '2026-10-01T00:00:01', status: 'submitted' }, // dia seguinte
    ];
    const rascunhoDeSetembro = { createdAt: '2026-09-10T10:00:00', status: 'draft' };

    const contaComoNovoFiltro = (r) => {
      if (r.status !== 'submitted') return false;
      const at = new Date(r.createdAt).getTime();
      return at >= monthStart && at <= monthEnd;
    };

    expect(registrosDeSetembro.every(contaComoNovoFiltro)).toBe(true);
    expect(registrosDeOutroMes.some(contaComoNovoFiltro)).toBe(false);
    expect(contaComoNovoFiltro(rascunhoDeSetembro)).toBe(false);
  });
});
