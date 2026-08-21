import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido da RT da CASA DOCE (21/08): "fui em relatório para ver o horário das
// leituras mas percebi que não mostra o horário das temperaturas".
//
// A coluna "Último registro" do relatório de temperatura usava `formatDate`,
// que é `toLocaleDateString` — só o dia. Quando a RT desconfia que faltou a
// leitura de um turno, "21/08" não responde nada; "21/08/26 08:12" responde.
//
// Escopo deliberadamente estreito: SÓ a coluna de temperatura. As outras duas
// datas do arquivo (último preenchimento de planilha BPF, última capacitação)
// são eventos de dia — hora ali é ruído.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/reports.jsx`, 'utf8');

describe('relatório de temperatura — a coluna diz a hora', () => {
  it('existe um formatador com hora, separado do de dia', () => {
    expect(fonte).toContain('function formatDateTime(iso) {');
    expect(fonte).toMatch(/hour: '2-digit', minute: '2-digit',/);
    // o de dia continua existindo — não foi substituído
    expect(fonte).toContain('function formatDate(iso) {');
    expect(fonte).toContain("return new Date(iso).toLocaleDateString('pt-BR');");
  });

  it('"Último registro" usa o formatador com hora', () => {
    expect(fonte).toContain("{s.last ? formatDateTime(s.last.createdAt) : '—'}");
    // a versão sem hora nessa célula é o que não pode voltar
    expect(fonte).not.toContain("{s.last ? formatDate(s.last.createdAt) : '—'}");
  });

  it('a data completa não quebra em duas linhas na tabela', () => {
    const linha = fonte.split('\n').find((l) => l.includes('formatDateTime(s.last.createdAt)'));
    expect(linha).toContain("whiteSpace:'nowrap'");
  });

  it('usa createdAt, não measuredAt', () => {
    // measured_at é TEXT e guarda só "HH:MM" digitado no aparelho (schema em
    // repository.js) — não dá pra derivar o dia dela.
    const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(repo).toContain('measured_at text,');
    expect(fonte).toContain('formatDateTime(s.last.createdAt)');
    expect(fonte).not.toContain('formatDateTime(s.last.measuredAt)');
  });

  it('a ordenação da coluna continua por data de verdade', () => {
    // Se virasse texto, "01/09" ordenaria antes de "21/08".
    expect(fonte).toContain("last:       { valor: (s) => s.last?.createdAt, tipo: 'data' },");
  });
});

describe('as outras datas do relatório continuam só com o dia', () => {
  it('último preenchimento de planilha BPF', () => {
    expect(fonte).toContain("{r.lastDate ? `${formatDate(r.lastDate)} — ${r.lastTitle}` : '—'}");
  });

  it('última capacitação, inclusive no PDF fiscal', () => {
    expect(fonte).toContain('${s.lastDate ? formatDate(s.lastDate) : \'—\'}');
  });
});
