import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dedupeCatalog } from './limits';

// ─────────────────────────────────────────────────────────────────────────────
// CASA DOCE, 18/08: "o Banho-maria BM.1 do refeitório já está aparecendo
// duplicado, mais cedo estava normal."
//
// A linha do equipamento na nuvem é identificada por (tenant_id, label) —
// eqToRow não tem id. Renomear "Banho-maria — BM.1" pra "Banho-maria
// (Refeitório) — BM.1" faz upsert numa chave NOVA e deixa a velha órfã.
// Localmente o editor substitui certo, então nada denuncia na hora: a cópia
// velha volta no sync seguinte, em qualquer aparelho.
//
// É a mesma causa da pendência antiga do CLAUDE.md ("limpar a linha duplicada
// no equipment_catalog da Swiss"), que nunca tinha sido diagnosticada.
// ─────────────────────────────────────────────────────────────────────────────

const bm = (label) => ({ label, aliases: ['BM.1'], location: 'Refeitório', minTemp: 60, maxTemp: 85 });

describe('dedupeCatalog — sobrevive à renomeação', () => {
  it('o caso real: mesmo equipamento com dois nomes vira UM', () => {
    const out = dedupeCatalog([bm('Banho-maria — BM.1'), bm('Banho-maria (Refeitório) — BM.1')]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('Banho-maria — BM.1');   // fica o primeiro (o mais antigo)
  });

  it('dedupe por label igual continua funcionando (o comportamento antigo)', () => {
    const out = dedupeCatalog([
      { label: 'ADEGA DE VINHOS', aliases: [] },
      { label: 'adega de vinhos', aliases: [] },
    ]);
    expect(out).toHaveLength(1);
  });

  it('mesmo alias mas OUTRO local NÃO é o mesmo equipamento', () => {
    const out = dedupeCatalog([
      { label: 'Banho-maria — BM.1', aliases: ['BM.1'], location: 'Refeitório', minTemp: 60, maxTemp: 85 },
      { label: 'Banho-maria — BM.1 Bistrô', aliases: ['BM.1'], location: 'Bistrô', minTemp: 60, maxTemp: 85 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('mesmo alias e local mas FAIXA diferente NÃO colapsa', () => {
    const out = dedupeCatalog([
      { label: 'Freezer — F.1', aliases: ['F.1'], location: 'Confeitaria', minTemp: -18, maxTemp: -12 },
      { label: 'Freezer F.1 novo', aliases: ['F.1'], location: 'Confeitaria', minTemp: -22, maxTemp: -18 },
    ]);
    expect(out).toHaveLength(2);   // faixa diferente = decisão técnica, não duplicata
  });

  it('equipamento SEM alias nunca colapsa por identidade', () => {
    const out = dedupeCatalog([
      { label: 'Bancada A', aliases: [], location: 'Padaria', minTemp: 0, maxTemp: 5 },
      { label: 'Bancada B', aliases: [], location: 'Padaria', minTemp: 0, maxTemp: 5 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('ordem dos aliases não importa', () => {
    const out = dedupeCatalog([
      { label: 'X', aliases: ['BM.1', 'banho'], location: 'Refeitório', minTemp: 60, maxTemp: 85 },
      { label: 'Y', aliases: ['banho', 'BM.1'], location: 'Refeitório', minTemp: 60, maxTemp: 85 },
    ]);
    expect(out).toHaveLength(1);
  });

  it('lista vazia ou lixo não quebra', () => {
    expect(dedupeCatalog([])).toEqual([]);
    expect(dedupeCatalog(null)).toEqual([]);
  });
});

describe('pages.jsx — renomear apaga a linha antiga na nuvem', () => {
  const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  it('saveItem guarda o registro anterior antes de sobrescrever o estado', () => {
    expect(fonte).toContain('const anterior = editingIndex === null ? null : catalog[editingIndex];');
  });

  it('apaga o label antigo quando o nome mudou', () => {
    expect(fonte).toContain("if (anterior?.label && anterior.label !== label) {");
    expect(fonte).toContain('deleteEquipmentItem(activeTenant.id, anterior.label)');
  });

  it('a exclusão vem DEPOIS do push — inverter perderia o equipamento se o push falhar', () => {
    const i = fonte.indexOf('pushEquipmentItem(activeTenant.id, next)');
    const j = fonte.indexOf('deleteEquipmentItem(activeTenant.id, anterior.label)');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });
});
