import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getEquipmentEntry, recordBelongsTo } from './limits';

// ─────────────────────────────────────────────────────────────────────────────
// Achado em PRODUÇÃO (21/08), pela RT da CASA DOCE: "hoje na ilha de sobremesa,
// encomendas e gelateria o preenchimento das temperaturas foi realizado e não
// constou aqui".
//
// A investigação separou a queixa em duas coisas. Gelateria estava mesmo sem
// leitura (3 dias) — falha de rotina, não do app. Mas o Refeitório revelou o
// defeito: o catálogo tinha "Banho-maria (Refeitório) — BM.1" com "NUNCA"
// medido, enquanto existia leitura de 78° gravada no MESMO dia sob o nome
// "Banho-maria — BM.1".
//
// CAUSA: renomear equipamento no app não mexe nas leituras já gravadas — elas
// guardam o nome ANTIGO em equipment_key/equipment_input, e nem devem ser
// reescritas (é evidência sanitária, RDC 216). Só que:
//   1. `saveItem` (pages.jsx) não guardava o nome velho como apelido; e
//   2. as telas casavam leitura↔equipamento por NOME EXATO, sem olhar apelido.
// Juntos: no instante do rename o histórico inteiro sumia do card.
//
// O empurrão veio da própria tela: o bloqueio de nome duplicado sugere "use um
// nome que os diferencie (ex.: 'X — Padaria')". Quem seguiu o conselho zerou o
// equipamento. Foi assim que nasceram "Banho-maria (Refeitório) — BM.1" e
// "Bancada refrigerada  (Padaria)— R.1".
// ─────────────────────────────────────────────────────────────────────────────

const limits   = readFileSync(`${process.cwd()}/src/limits.js`, 'utf8');
const pages    = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const overview = readFileSync(`${process.cwd()}/src/overview-v2.jsx`, 'utf8');
const reports  = readFileSync(`${process.cwd()}/src/reports-views.jsx`, 'utf8');

// O caso real do Refeitório, depois do apelido ser preenchido.
const BM = { label: 'Banho-maria (Refeitório) — BM.1', aliases: ['Banho-maria — BM.1', 'BM.1'], location: 'Refeitório' };
const leituraAntiga = { equipmentInput: 'Banho-maria — BM.1', equipmentKey: 'Banho-maria — BM.1', value: 78 };
const leituraNova   = { equipmentInput: 'Banho-maria (Refeitório) — BM.1', equipmentKey: 'Banho-maria (Refeitório) — BM.1', value: 80 };

describe('o caso do Banho-maria — leitura gravada com o nome antigo', () => {
  it('a leitura antiga volta a pertencer ao equipamento renomeado', () => {
    expect(recordBelongsTo([BM], leituraAntiga, BM)).toBe(true);
  });

  it('a leitura nova continua pertencendo', () => {
    expect(recordBelongsTo([BM], leituraNova, BM)).toBe(true);
  });

  it('leitura de outro equipamento não é sequestrada', () => {
    const outro = { equipmentInput: 'Geladeira — R.12', equipmentKey: 'Geladeira — R.12' };
    expect(recordBelongsTo([BM], outro, BM)).toBe(false);
  });

  it('equipamento sem nome nunca casa com nada', () => {
    expect(recordBelongsTo([BM], leituraAntiga, { label: '' })).toBe(false);
    expect(recordBelongsTo([BM], leituraAntiga, {})).toBe(false);
  });

  it('leitura sem nome nenhum não casa', () => {
    expect(recordBelongsTo([BM], {}, BM)).toBe(false);
    expect(recordBelongsTo([BM], { equipmentInput: '   ' }, BM)).toBe(false);
  });
});

describe('apelido repetido entre setores não pode dobrar evidência', () => {
  // A CASA DOCE tem MESMO isso hoje: "R.2" é apelido na Padaria e na
  // Confeitaria; "R.12" no Refeitório e no Setor Salgados.
  const padaria     = { label: 'Refrigerado — R.2',            aliases: ['R.2'], location: 'Padaria' };
  const confeitaria = { label: 'Refrigerador vertical — R.2',  aliases: ['R.2'], location: 'Confeitaria' };
  const catalogo    = [padaria, confeitaria];

  it('leitura com o nome COMPLETO vai só pro dono certo', () => {
    const r = { equipmentInput: 'Refrigerador vertical — R.2', equipmentKey: 'Refrigerador vertical — R.2' };
    expect(recordBelongsTo(catalogo, r, confeitaria)).toBe(true);
    expect(recordBelongsTo(catalogo, r, padaria)).toBe(false);
  });

  it('leitura pelo apelido ambíguo cai em UM só, nunca nos dois', () => {
    // Não é o ideal (o apelido é ambíguo no dado), mas aparecer nos DOIS cards
    // seria pior: contaria a mesma medição duas vezes num relatório de
    // fiscalização. A resolução é determinística — o primeiro do catálogo.
    const r = { equipmentInput: 'R.2', equipmentKey: 'R.2' };
    const donos = catalogo.filter((eq) => recordBelongsTo(catalogo, r, eq));
    expect(donos).toHaveLength(1);
    expect(donos[0]).toBe(padaria);
  });

  it('nome EXATO vence apelido de outro equipamento', () => {
    // Se a Padaria vier ANTES e tiver 'Refrigerador vertical — R.2' como
    // apelido, o casamento exato da Confeitaria tem que ganhar mesmo assim.
    const padariaGulosa = { label: 'Refrigerado — R.2', aliases: ['R.2', 'Refrigerador vertical — R.2'] };
    const cat = [padariaGulosa, confeitaria];
    expect(getEquipmentEntry(cat, 'Refrigerador vertical — R.2')).toBe(confeitaria);
  });
});

describe('getEquipmentEntry — duas passadas', () => {
  it('acha por nome, por apelido, e ignora caixa e espaço', () => {
    expect(getEquipmentEntry([BM], 'banho-maria (refeitório) — bm.1')).toBe(BM);
    expect(getEquipmentEntry([BM], '  BM.1  ')).toBe(BM);
    expect(getEquipmentEntry([BM], 'Freezer')).toBeNull();
  });

  it('não estoura com catálogo/entrada esquisitos', () => {
    expect(getEquipmentEntry([], 'x')).toBeNull();
    expect(getEquipmentEntry(undefined, 'x')).toBeNull();
    expect(getEquipmentEntry([BM], '')).toBeNull();
    expect(getEquipmentEntry([BM], null)).toBeNull();
    expect(getEquipmentEntry([{ label: 'Sem apelidos' }, null], 'x')).toBeNull();
  });

  it('a versão de UMA passada não pode voltar', () => {
    expect(limits).toContain('const porNome = (catalog ?? []).find(');
    expect(limits).not.toContain('catalog.find((item) => item.label.toLowerCase() === lower || item.aliases?.some(');
  });
});

describe('renomear no app guarda o nome antigo como apelido', () => {
  it('saveItem monta os apelidos incluindo o label anterior', () => {
    expect(pages).toContain('const aliasesFinais = anterior?.label && norm(anterior.label) !== norm(label)');
    expect(pages).toContain('? [...aliases, anterior.label]');
    // Âncora só na parte que este teste protege — os apelidos. A linha ganhou
    // `usoIntermitente` na v1.9.233 e voltaria a quebrar a cada campo novo.
    expect(pages).toContain('const next = { label, aliases: aliasesFinais,');
  });

  it('não duplica se a pessoa já tinha digitado o nome antigo à mão', () => {
    expect(pages).toContain('&& !aliases.some((a) => norm(a) === norm(anterior.label))');
  });

  it('anterior é lido ANTES de montar o next (senão o apelido não entra)', () => {
    const ini = pages.indexOf('const saveItem = async () => {');
    const corpo = pages.slice(ini, pages.indexOf('const removeItem', ini));
    expect(corpo.indexOf('const anterior =')).toBeLessThan(corpo.indexOf('const aliasesFinais ='));
    expect(corpo.indexOf('const aliasesFinais =')).toBeLessThan(corpo.indexOf('const next = {'));
  });
});

describe('as telas casam por apelido — não sobrou casamento exato', () => {
  it('grade de 7 dias do card (Visão geral)', () => {
    expect(overview).toContain('recordBelongsTo(catalogoDoTenant, r, eq) &&');
    expect(overview).not.toContain('(r.equipmentInput === eq.label || r.equipmentKey === eq.label)');
  });

  it('histórico do drill-down (Visão geral)', () => {
    expect(overview).toContain('recordBelongsTo(readEquipmentCatalog(drill.tenant), r, drill.equipment))');
    expect(overview).not.toContain('r.equipmentInput === drill.equipment.label');
  });

  it('os 3 pontos de relatório (estatística, drill, última leitura)', () => {
    expect(reports).toContain('const er = tr.filter((r) => recordBelongsTo(catalog, r, eq));');
    expect(reports).toContain('.filter(r => recordBelongsTo(catalog, r, drillEq))');
    expect(reports).toContain('const last = tenantRecords.find((r) => recordBelongsTo(catalog, r, eq));');
    expect(reports).not.toContain("(r.equipment || r.equipmentInput) === eq.label");
    expect(reports).not.toContain("(r.equipment || r.equipmentInput || r.equipmentKey) === drillEq.label");
  });

  it('o drill do relatório reagrupa quando o catálogo muda', () => {
    expect(reports).toContain('}, [tenantRecords, drillEq, catalog]);');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7º ponto do mesmo defeito, achado depois (21/08): os ALERTAS de turno.
// Aqui o sinal era invertido — em vez de esconder leitura que existe, ele
// INVENTAVA pendência pra equipamento que foi medido. E no lugar mais
// barulhento: o badge do menu e a tela de Alertas.
//
// A overview-v2 já contornava normalizando os records antes de chamar; o
// pages.jsx (badge + tela) passava os records CRUS. Agora a função resolve
// sozinha e os dois caminhos acertam.
// ─────────────────────────────────────────────────────────────────────────────
describe('alertas de turno — renomear não pode inventar pendência', () => {
  const catalog = [{ label: 'Freezer 01', aliases: ['Freezer'], location: 'Cozinha' }];
  const turns   = [{ id: 'tarde', name: 'Tarde', start: '12:00', end: '17:59' }];
  const agora   = new Date('2026-08-19T14:00:00');

  it('leitura com o nome ANTIGO conta como feita, mesmo sem normalizar antes', async () => {
    const { computeTurnAlertsPure } = await import('./turn-alerts');
    const crus = [{ tenantId: 't1', equipmentInput: 'Freezer', createdAt: '2026-08-19T13:00:00' }];
    expect(computeTurnAlertsPure(turns, crus, catalog, 't1', false, agora)).toEqual([]);
  });

  it('sem leitura nenhuma o alerta continua nascendo — o fix não cega o alarme', async () => {
    const { computeTurnAlertsPure } = await import('./turn-alerts');
    const alertas = computeTurnAlertsPure(turns, [], catalog, 't1', false, agora);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].equipment).toBe('Freezer 01');
    expect(alertas[0].level).toBe('warn');
  });

  it('leitura de OUTRO equipamento não silencia o alerta', async () => {
    const { computeTurnAlertsPure } = await import('./turn-alerts');
    const outro = [{ tenantId: 't1', equipmentInput: 'Geladeira', createdAt: '2026-08-19T13:00:00' }];
    expect(computeTurnAlertsPure(turns, outro, catalog, 't1', false, agora)).toHaveLength(1);
  });
});
