import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pendingReceivingItems } from './nonconformities';

// Resposta da nutricionista (22/09) sobre o Recebimento simplificado de
// 21/09: "Pode adicionar mais de uma aba 'Produto' por favor. Ou uma com
// espaço grande que dê pra escrever todos os itens que chegaram. Geralmente
// é em média 10 itens."
//
// Preencher a planilha inteira (validade, hora, temperatura, 3 checks,
// resultado) 10 vezes pra UMA entrega só era o oposto do que a simplificação
// de 21/09 tinha acabado de resolver. Produto virou textarea - um item por
// linha, dentro de UM registro só. Resultado/checks/temperatura continuam
// valendo pra entrega inteira; se um item específico tiver problema, ela
// descreve no Motivo (campo que já existe e já é obrigatório em
// rejeitado/aceito parcial).

const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const corpoRecebimento = pages.slice(pages.indexOf('function RecebimentoView('), pages.indexOf('// ─── Offline Indicator'));

describe('Produto vira lista de itens', () => {
  it('é textarea, não input de uma linha', () => {
    expect(corpoRecebimento).toContain('<label>Produtos<textarea value={produto} onChange={(e) => setProduto(e.target.value)}');
    expect(corpoRecebimento).not.toContain('<label>Produto<input value={produto}');
  });

  it('tem espaço vertical de verdade - não é uma textarea de 1 linha disfarçada', () => {
    const ini = corpoRecebimento.indexOf('<label>Produtos<textarea');
    const fim = corpoRecebimento.indexOf('</label>', ini);
    const bloco = corpoRecebimento.slice(ini, fim);
    const altura = bloco.match(/minHeight:\s*(\d+)/);
    expect(altura, 'sem minHeight declarado').toBeTruthy();
    expect(Number(altura[1])).toBeGreaterThanOrEqual(100);
  });

  it('o placeholder orienta "um por linha" - a pessoa precisa saber COMO separar os itens', () => {
    const ini = corpoRecebimento.indexOf('<label>Produtos<textarea');
    const fim = corpoRecebimento.indexOf('</label>', ini);
    expect(corpoRecebimento.slice(ini, fim).toLowerCase()).toContain('por linha');
  });
});

describe('o resto do registro continua sendo UM por entrega (não por item)', () => {
  // A nutricionista só pediu pra listar os PRODUTOS - não pediu (e não faria
  // sentido pra "média de 10 itens") repetir hora/temperatura/checks/
  // resultado por item. Continua 1 resultado, 1 temperatura, pra entrega
  // toda; item com problema específico vai no Motivo (texto livre).
  it('handleSubmit grava 1 registro, não 1 por linha de produto', () => {
    const ini = corpoRecebimento.indexOf('const record = {');
    const fim = corpoRecebimento.indexOf('};', ini);
    const bloco = corpoRecebimento.slice(ini, fim);
    expect(bloco).toContain('produto: produto.trim()');
    // um resultado, uma temperatura, um checks - nenhum .map/.split sobre
    // produto tentando gerar vários registros
    expect(corpoRecebimento).not.toMatch(/produto\.split/);
  });

  it('continua exigindo só produto (a lista inteira) e resultado pra habilitar o botão', () => {
    expect(corpoRecebimento).toContain("disabled={!produto.trim() || !resultado || (motivoObrigatorio && !motivoRejeicao.trim()) || saving}");
  });
});

describe('lista de itens não estoura a tela em nenhum lugar que mostra o registro', () => {
  it('histórico da própria tela: quebra linha (pre-line) e o badge não desce junto com o texto (flex-start)', () => {
    const ini = corpoRecebimento.indexOf("filtered.map((r) => {");
    const fim = corpoRecebimento.indexOf('})}', ini);
    const bloco = corpoRecebimento.slice(ini, fim);
    expect(bloco).toContain("<strong style={{ whiteSpace: 'pre-line' }}>{r.produto}</strong>");
    expect(bloco).toContain("alignItems: 'flex-start'");
  });

  it('dossiê fiscal (PDF): a célula de produto também quebra linha', () => {
    const dossier = readFileSync(`${process.cwd()}/src/dossier.js`, 'utf8');
    expect(dossier).toContain('<td style="white-space:pre-line">${esc(r.produto)}</td>');
  });

  it('Central de Não-Conformidades: o TÍTULO do card mostra só o 1º item, não os 10', () => {
    const out = pendingReceivingItems([{
      id: 'r1', resultado: 'rejeitado', motivoRejeicao: 'Item 3 com embalagem violada',
      produto: 'Queijo minas\nPresunto\nLeite integral\nOvos\nManteiga',
      createdAt: 'x',
    }]);
    expect(out[0].sourceLabel).toBe('Recebimento - Queijo minas +4 itens');
    // sourceDetail continua com a lista inteira (é a área de detalhe, tem
    // espaço) - e com o motivo quando ele existe.
    expect(out[0].sourceDetail).toBe('Motivo: Item 3 com embalagem violada');
  });

  it('sem motivo, o detalhe cai pra lista completa de produtos (não só o 1º)', () => {
    const out = pendingReceivingItems([{
      id: 'r2', resultado: 'rejeitado', produto: 'Queijo minas\nPresunto', createdAt: 'x',
    }]);
    expect(out[0].sourceDetail).toBe('Queijo minas\nPresunto');
  });

  it('item único (sem quebra de linha) não ganha o "+N itens" à toa', () => {
    const out = pendingReceivingItems([{ id: 'r3', resultado: 'rejeitado', produto: 'Queijo minas', createdAt: 'x' }]);
    expect(out[0].sourceLabel).toBe('Recebimento - Queijo minas');
  });

  it('linha em branco no meio da lista não vira item fantasma no título', () => {
    const out = pendingReceivingItems([{
      id: 'r4', resultado: 'rejeitado', produto: 'Queijo minas\n\n\nPresunto', createdAt: 'x',
    }]);
    expect(out[0].sourceLabel).toBe('Recebimento - Queijo minas +1 item');
  });

  it('o detalhe do card (sourceDetail) também quebra linha na tela - não vira um parágrafo só', () => {
    // Este trecho é de outra função (Central de NC), não de RecebimentoView -
    // busca na fonte inteira, não em corpoRecebimento.
    const trecho = pages.slice(pages.indexOf('item.sourceDetail &&'), pages.indexOf('item.sourceDetail &&') + 200);
    expect(trecho).toContain("whiteSpace: 'pre-line'");
  });
});
