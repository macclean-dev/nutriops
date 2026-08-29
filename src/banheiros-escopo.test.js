import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scopeFieldOf, makePeriodKey, splitPeriodKey, viasPorEscopo, TEMPLATE_SEEDS } from './forms';

// ─────────────────────────────────────────────────────────────────────────────
// Relato da RT (28/08): "a planilha de limpeza/manutenção dos banheiros tem
// todos os setores, porém eu consigo marcar 1 banheiro por dia; quando vai
// selecionar outro que clica já está preenchido".
//
// Causa: o template tinha a lista "Qual banheiro" mas NÃO declarava `scopeBy`,
// então todos os banheiros dividiam uma única chave por dia. Não era só
// confusão visual — salvar o segundo SOBRESCREVIA o primeiro (o upsert é por
// formId+periodKey), e o banheiro já limpo sumia da folha.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

const BANHEIROS = {
  id: 'c61acf39-5ff8-404e-8fae-f9f68734f1b2', frequency: 'daily', scopeBy: 'cd-ban-local',
  sections: [{ id: 'cd-ban-cab', fields: [
    { id: 'cd-ban-local', label: 'Qual banheiro', type: 'select',
      options: ['Masculino — clientes', 'Feminino — clientes', 'Unissex 1º andar'] },
    { id: 'cd-ban-resp', label: 'Responsável pela limpeza', type: 'text' },
  ]}],
};

describe('o template declara o escopo', () => {
  it('o seed dos banheiros tem scopeBy apontando pra "Qual banheiro"', () => {
    expect(fonte).toContain("v:4, scopeBy:'cd-ban-local'");
  });

  it('a versão subiu junto — sem isso o seed novo não substitui o antigo', () => {
    // readFormTemplates só troca quando (s.v ?? 0) > (atual.v ?? 0)
    expect(fonte).not.toContain("category:'faxina', frequency:'daily', v:3,\n  title:'Controle de Higienização de Banheiros'");
  });

  it('scopeFieldOf acha o campo', () => {
    expect(scopeFieldOf(BANHEIROS)?.id).toBe('cd-ban-local');
  });

  it('cada banheiro ganha chave própria no mesmo dia', () => {
    const d = new Date(2026, 7, 28);
    const a = makePeriodKey('daily', d, 'Masculino — clientes');
    const b = makePeriodKey('daily', d, 'Feminino — clientes');
    expect(a).not.toBe(b);
    expect(splitPeriodKey(a).base).toBe(splitPeriodKey(b).base);   // mesmo dia
  });
});

describe('planilha custom também recebe o conserto — senão a loja que relatou é a única a não receber', () => {
  it('o ramo custom acrescenta scopeBy quando falta', () => {
    expect(fonte).toContain('if (s.scopeBy && !atual.scopeBy)');
  });

  it('mas continua NÃO sobrescrevendo o conteúdo editado pela RT', () => {
    // o `continue` tem que permanecer: só o ponteiro estrutural passa
    const bloco = fonte.slice(fonte.indexOf('if (atual.custom) {'), fonte.indexOf('if ((s.v ?? 0) > (atual.v ?? 0))'));
    expect(bloco).toContain('continue;');
    expect(bloco).not.toContain('...s,');   // nada do seed entra por aqui
  });
});

describe('viasPorEscopo — preencher três banheiros de uma vez', () => {
  const d = new Date(2026, 7, 28);
  const resp = { 'cd-ban-local': 'Masculino — clientes', 'cd-ban-resp': 'JOENICE', 'cd-ban-lg-feito': true };

  it('devolve uma via por escopo', () => {
    const vias = viasPorEscopo(BANHEIROS, ['Feminino — clientes', 'Unissex 1º andar'], resp, d);
    expect(vias).toHaveLength(2);
  });

  it('cada via tem sua própria chave de período', () => {
    const vias = viasPorEscopo(BANHEIROS, ['Feminino — clientes', 'Unissex 1º andar'], resp, d);
    expect(new Set(vias.map((v) => v.periodKey)).size).toBe(2);
  });

  it('o campo de escopo é reescrito em cada via — senão o PDF sai mentindo', () => {
    const vias = viasPorEscopo(BANHEIROS, ['Feminino — clientes'], resp, d);
    expect(vias[0].responses['cd-ban-local']).toBe('Feminino — clientes');
  });

  it('o resto das respostas é preservado, incluindo o responsável', () => {
    const vias = viasPorEscopo(BANHEIROS, ['Unissex 1º andar'], resp, d);
    expect(vias[0].responses['cd-ban-resp']).toBe('JOENICE');
    expect(vias[0].responses['cd-ban-lg-feito']).toBe(true);
  });

  it('não muta as respostas originais', () => {
    viasPorEscopo(BANHEIROS, ['Feminino — clientes'], resp, d);
    expect(resp['cd-ban-local']).toBe('Masculino — clientes');
  });

  it('escopo repetido não vira via duplicada', () => {
    const vias = viasPorEscopo(BANHEIROS, ['Feminino — clientes', 'Feminino — clientes'], resp, d);
    expect(vias).toHaveLength(1);
  });

  it('vazio, nulo e espaço em branco não viram via', () => {
    expect(viasPorEscopo(BANHEIROS, [], resp, d)).toEqual([]);
    expect(viasPorEscopo(BANHEIROS, null, resp, d)).toEqual([]);
    expect(viasPorEscopo(BANHEIROS, ['', '   ', null], resp, d)).toEqual([]);
  });

  it('planilha sem scopeBy não reescreve resposta nenhuma', () => {
    const semEscopo = { ...BANHEIROS, scopeBy: undefined };
    const vias = viasPorEscopo(semEscopo, ['Feminino — clientes'], resp, d);
    expect(vias[0].responses).toBe(resp);   // mesma referência: nada tocado
  });
});

describe('a tela liga as duas pontas', () => {
  it('FormFill recebe o campo de escopo e o escopo atual', () => {
    expect(fonte).toContain('campoEscopo={scopeFieldOf(filling.template)}');
    expect(fonte).toContain('escopoAtual={filling.escopo ?? \'\'}');
  });

  it('o bloco "Aplicar também a" existe e lista só as OUTRAS opções', () => {
    expect(fonte).toContain('Aplicar também a');
    expect(fonte).toContain('.filter((o) => o !== escopoAtual)');
  });

  it('avisa quando o escopo marcado já foi preenchido hoje — marcar sobrescreve', () => {
    expect(fonte).toContain('já preenchido hoje');
  });

  it('handleSave grava uma via por escopo, com o mesmo instante', () => {
    expect(fonte).toContain('escoposExtras = []');
    expect(fonte).toContain('viasPorEscopo(template, escoposExtras, responses, agora)');
    expect(fonte).toContain('const vias = [{ periodKey: periodoFinal, responses }, ...extras]');
  });

  it('id e push ficam FORA do atualizador de estado — senão 3 vias viram 6 registros', () => {
    // Achado no teste manual (28/08): com `uid()` e `pushFormRecord` dentro do
    // setRecords, o React chamava o atualizador duas vezes e cada chamada
    // cunhava ids novos. Com uma via só passava batido (a 2ª sobrescrevia a
    // 1ª); com três virou seis registros, todos empurrados pra nuvem.
    const ini = fonte.indexOf('const ups = vias.map((via) =>');
    const fim = fonte.indexOf('setRecords((prev) =>', ini);
    expect(ini).toBeGreaterThan(-1);
    const antesDoSetRecords = fonte.slice(ini, fim);
    expect(antesDoSetRecords).toContain('uid()');
    expect(antesDoSetRecords).toContain('pushFormRecord(activeTenant.id, up)');

    // e o atualizador vira fusão pura por id — rodar duas vezes dá o mesmo
    const upd = fonte.slice(fim, fonte.indexOf('}, [filling, activeTenant.id, session, records])'));
    expect(upd).not.toContain('uid()');
    expect(upd).not.toContain('pushFormRecord');
    expect(upd).toContain('new Map(prev.map((r) => [r.id, r]))');
  });

  it('`records` está nas deps — o `ex` é procurado fora do atualizador agora', () => {
    expect(fonte).toContain('}, [filling, activeTenant.id, session, records]);');
  });

  it('cada via é empurrada pra nuvem, não só a principal', () => {
    expect(fonte).toContain('for (const up of ups) pushFormRecord(activeTenant.id, up);');
  });
});
