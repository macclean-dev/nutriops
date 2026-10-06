import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TIPOS_TEMPERATURA, LINHAS_INICIAIS, avaliarLinha, faltouSinal, linhasPreenchidas,
  temIncompleta, temFora, resumoTemperaturas,
} from './recebimento-temperaturas';
import { recebimentoCompleto } from './modulos-da-loja';
import { sectionReceiving } from './dossier';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido da RT da CASA DOCE (06/10). Na matriz: fornecedor e NF de volta e
// temperatura por tipo de produto, com as faixas que ela ditou (congelados
// ≤ -12 °C; pescados resfriados 2 a 3 °C; carnes resfriadas 4 a 7 °C; demais
// refrigerados 4 a 10 °C), "no mínimo 6 campos". No PKS e no Terraço fica
// como está: "todos os produtos que eles recebem já são prontos/manipulados".
// ─────────────────────────────────────────────────────────────────────────────

describe('em qual loja', () => {
  it('CASA DOCE matriz: sim', () => {
    expect(recebimentoCompleto({ id: 'bf245c3b-2f9', name: 'CASA DOCE' })).toBe(true);
  });
  it('PKS e Terraço: não, mesmo com "CASA DOCE" no nome', () => {
    expect(recebimentoCompleto({ id: 'x1', name: 'FABRIZZIO PKS' })).toBe(false);
    expect(recebimentoCompleto({ id: 'x2', name: 'CASA DOCE — Terraço' })).toBe(false);
  });
  it('Swiss, Bäckerei e DBK: não (o pedido foi só da CASA DOCE)', () => {
    for (const t of [{ id: 'swiss', name: 'Swiss' }, { id: 'backerei', name: 'Bäckerei' }, { id: 'dbk-producao', name: 'DBK Produção' }]) {
      expect(recebimentoCompleto(t)).toBe(false);
    }
  });
});

describe('as faixas que a RT ditou', () => {
  const tipo = (id) => TIPOS_TEMPERATURA.find((t) => t.id === id);
  it('quatro tipos, com a referência escrita do jeito dela', () => {
    expect(TIPOS_TEMPERATURA.map((t) => t.id)).toEqual(['congelado', 'pescado', 'carne', 'refrigerado']);
    expect(tipo('congelado').referencia).toContain('-12 °C');
    expect(tipo('pescado').referencia).toBe('entre 2 °C e 3 °C');
    expect(tipo('carne').referencia).toBe('entre 4 °C e 7 °C');
    expect(tipo('refrigerado').referencia).toBe('entre 4 °C e 10 °C');
  });
  it('começa com no mínimo 6 linhas', () => {
    expect(LINHAS_INICIAIS).toBeGreaterThanOrEqual(6);
  });
});

describe('avaliarLinha', () => {
  it('congelado: -12 ok, -10 fora', () => {
    expect(avaliarLinha({ tipo: 'congelado', valor: '-12' })).toBe('ok');
    expect(avaliarLinha({ tipo: 'congelado', valor: '-10' })).toBe('fora');
  });
  it('carne resfriada: 7 ok, 7,5 (vírgula do celular) fora', () => {
    expect(avaliarLinha({ tipo: 'carne', valor: '7' })).toBe('ok');
    expect(avaliarLinha({ tipo: 'carne', valor: '7,5' })).toBe('fora');
  });
  it('mais frio que o mínimo da faixa NÃO é desvio (pescado no gelo a 1 °C)', () => {
    expect(avaliarLinha({ tipo: 'pescado', valor: '1' })).toBe('ok');
  });
  it('linha vazia é ignorada; meio preenchida é "incompleta"', () => {
    expect(avaliarLinha({ tipo: '', valor: '' })).toBe('vazia');
    expect(avaliarLinha({ tipo: 'carne', valor: '' })).toBe('incompleta');
    expect(avaliarLinha({ tipo: '', valor: '5' })).toBe('incompleta');
  });
  it('congelado positivo sugere o sinal que faltou (teclado sem tecla de menos)', () => {
    expect(faltouSinal({ tipo: 'congelado', valor: '18' })).toBe(true);
    expect(faltouSinal({ tipo: 'congelado', valor: '-18' })).toBe(false);
    expect(faltouSinal({ tipo: 'carne', valor: '5' })).toBe(false);
  });
});

describe('o que vai pro registro', () => {
  const linhas = [
    { tipo: 'congelado', valor: '-15' }, { tipo: 'carne', valor: '9' },
    { tipo: '', valor: '' }, { tipo: '', valor: '' }, { tipo: '', valor: '' }, { tipo: '', valor: '' },
  ];
  it('só as linhas preenchidas, já avaliadas', () => {
    expect(linhasPreenchidas(linhas)).toEqual([
      { tipo: 'congelado', valor: '-15', situacao: 'ok' },
      { tipo: 'carne', valor: '9', situacao: 'fora' },
    ]);
    expect(temFora(linhas)).toBe(true);
    expect(temIncompleta(linhas)).toBe(false);
  });
  it('resumo legível pro histórico, CSV e Dossiê', () => {
    expect(resumoTemperaturas(linhas)).toBe('Congelado -15 °C; Carne resfriada 9 °C (fora)');
  });
});

describe('nuvem e tela', () => {
  const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
  const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
  const tela = pages.slice(pages.indexOf('function RecebimentoView('), pages.indexOf('// ─── Offline Indicator'));

  it('a coluna nova só vai quando o registro tem temperatura por tipo (as outras lojas não dependem do SQL)', () => {
    expect(repo).toContain('...(Array.isArray(r.temperaturas) && r.temperaturas.length > 0 ? { temperaturas: r.temperaturas } : {}),');
  });

  it('o SQL prova o projeto, acrescenta a coluna e confere', () => {
    const sql = readFileSync(`${process.cwd()}/docs/receiving-temperaturas.sql`, 'utf8');
    expect(sql).toContain('select current_database()');
    expect(sql).toContain('add column if not exists temperaturas jsonb');
    expect(sql).not.toMatch(/drop policy|create policy/i);
  });

  it('temperatura fora sugere "Aceito parcial"; aceitar assim mesmo exige justificativa', () => {
    expect(tela).toContain("const sugestaoResultado = tempFora ? 'aceito_parcial' : sugestaoChecks;");
    expect(tela).toContain("(tempFora && resultado === 'aceito')");
  });

  it('linha meio preenchida trava o registro', () => {
    expect(tela).toContain('|| tempIncompleta || saving}');
  });

  it('cada linha tem o botão ± (congelado é negativo)', () => {
    expect(tela).toContain('onClick={() => trocarSinalLinha(i)}');
  });
});

describe('Dossiê', () => {
  it('mostra fornecedor com NF e a temperatura', () => {
    const s = sectionReceiving([{ hora: '08:40', fornecedor: 'Frigorífico X', nf: '4521', produto: 'Carne', temperatura: 'Carne resfriada 5 °C', temperaturas: [{ tipo: 'carne', valor: '5', situacao: 'ok' }], resultado: 'aceito', createdAt: '2026-10-06T10:00:00Z' }]);
    expect(s.headers).toContain('Temperatura');
    expect(s.rowsHtml).toContain('Frigorífico X · NF 4521');
    expect(s.rowsHtml).toContain('Carne resfriada 5 °C');
    expect(s.rowsHtml).not.toContain('°C °C');
  });
  it('registro antigo, com temperatura só em número, ganha a unidade', () => {
    const s = sectionReceiving([{ hora: '08:40', produto: 'Queijo', temperatura: '4.2', resultado: 'aceito', createdAt: '2026-09-21T10:00:00Z' }]);
    expect(s.rowsHtml).toContain('4.2 °C');
  });
});
