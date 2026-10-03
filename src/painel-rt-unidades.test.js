import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unirLeituras, readTenantTemperatures } from './temperaturas-por-loja';

// ─────────────────────────────────────────────────────────────────────────────
// Defeito achado na pesquisa de 03/10: o Painel RT calculava "desvios hoje" e
// "conformidade 30 dias" com a prop `records`, que pra quem não é admin global
// só traz a loja ATIVA. A RT da CASA DOCE (matriz, PKS e Terraço) via as duas
// unidades que não estavam selecionadas sem desvio e sem conformidade, como se
// não tivessem leitura nenhuma. A Prontidão já tinha corrigido isso com uma
// busca por loja; a busca saiu de lá pra temperaturas-por-loja.js e agora as
// duas telas usam a mesma.
// ─────────────────────────────────────────────────────────────────────────────

const leitura = (id, tenantId) => ({ id, tenantId, value: 3, createdAt: '2026-10-03T10:00:00Z' });

describe('unirLeituras', () => {
  it('nuvem + fila offline, sem duplicar o que já subiu', () => {
    const nuvem = [leitura('a', 'pks'), leitura('b', 'pks')];
    const prop = [leitura('b', 'pks'), leitura('c', 'pks')];   // 'c' ainda está na fila
    expect(unirLeituras(nuvem, prop).map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('readTenantTemperatures', () => {
  const props = [leitura('m1', 'matriz'), leitura('p0', 'pks')];

  it('busca a loja pedida no repositório, mesmo ela não sendo a ativa', async () => {
    const pedidos = [];
    const repo = { list: async (q) => { pedidos.push(q); return [leitura('p1', 'pks'), leitura('p2', 'pks')]; } };
    const rs = await readTenantTemperatures({ id: 'pks' }, props, repo);
    expect(pedidos).toEqual([{ tenantId: 'pks', days: 90 }]);
    expect(rs.map((r) => r.id).sort()).toEqual(['p0', 'p1', 'p2']);
    expect(rs.every((r) => r.tenantId === 'pks')).toBe(true);
  });

  it('rede caiu: devolve o que a prop tinha DESTA loja, não a de outra', async () => {
    const repo = { list: async () => { throw new Error('offline'); } };
    const rs = await readTenantTemperatures({ id: 'pks' }, props, repo);
    expect(rs.map((r) => r.id)).toEqual(['p0']);
  });
});

describe('as duas telas usam a mesma busca', () => {
  const extras = readFileSync(`${process.cwd()}/src/extras.jsx`, 'utf8');
  const painel = extras.slice(extras.indexOf('export function RTPanelView('), extras.indexOf('const totalPending'));

  it('o Painel RT busca as leituras por unidade', () => {
    expect(painel).toContain('readTenantTemperatures(t, records)');
  });

  it('o Painel RT não filtra mais a prop crua por loja pra calcular desvios e conformidade', () => {
    expect(painel).not.toContain('records.filter(r => r.tenantId === tenant.id && new Date(r.createdAt).toDateString()');
    expect(painel).not.toContain('records.filter(r => r.tenantId === tenant.id && now -');
    expect(painel).toContain('const todayRecords = tenantRecords.filter(');
    expect(painel).toContain('const monthRecs = tenantRecords.filter(');
  });

  it('o resumo da semana também recebe as leituras da unidade', () => {
    expect(painel).toContain('records: tenantRecords');
  });

  it('a busca depende das ids das lojas, não do array (array novo a cada render refaria a busca sem parar)', () => {
    expect(painel).toContain('}, [idsDasLojas, records]);');
  });

  it('a Prontidão importa a mesma função, em vez de ter cópia própria', () => {
    const prontidao = readFileSync(`${process.cwd()}/src/readiness-view.jsx`, 'utf8');
    expect(prontidao).toContain("import { readTenantTemperatures } from './temperaturas-por-loja';");
    expect(prontidao).not.toContain('async function readTenantTemperatures(');
  });
});
