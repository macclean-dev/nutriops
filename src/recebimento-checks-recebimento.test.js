import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { receivingSuggestedResult } from './verdict';

// Pedido da nutricionista (22/09), testando a tela ao vivo no FABRIZZIO PKS:
// "Pode tirar essa parte de 'data de validade' por favor. Como são vários
// produtos então tem datas diferentes. O campo hora pode permanecer. No
// teclado de temperatura não aparece o símbolo de grau '°' Exemplo '10°C'.
// Em verificação de conformidades acrescenta: Todos os produtos foram
// entregues devidamente etiquetados, contendo data de manipulação e
// validade? (C) e (NC)"

const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const corpoRecebimento = pages.slice(pages.indexOf('function RecebimentoView('), pages.indexOf('// ─── Offline Indicator'));

describe('"Data de validade" saiu, "Hora" ficou', () => {
  it('sem input de Data de validade em lugar nenhum do formulário', () => {
    expect(corpoRecebimento).not.toMatch(/Data de validade<input/);
  });

  it('Hora continua exatamente como estava', () => {
    expect(corpoRecebimento).toContain('<label>Hora<input type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></label>');
  });

  it('validade não é mais gravada no registro novo nem faz parte do reset do formulário', () => {
    const ini = corpoRecebimento.indexOf('const record = {');
    const fim = corpoRecebimento.indexOf('};', ini);
    expect(corpoRecebimento.slice(ini, fim)).not.toContain('validade:');
    expect(corpoRecebimento).not.toContain('setValidade(');
  });

  it('CSV e histórico continuam mostrando validade de registro ANTIGO (não apaga evidência já registrada)', () => {
    expect(corpoRecebimento).toContain("'validade'");
    expect(corpoRecebimento).toContain("r.validade ? `Val. ${r.validade}` : null");
  });
});

describe('novo check: etiquetagem (data de manipulação e validade no rótulo)', () => {
  const bloco = pages.slice(pages.indexOf('const RECEIVING_CHECKS = ['), pages.indexOf('];', pages.indexOf('const RECEIVING_CHECKS = [')));

  it('foi ACRESCENTADO - os 3 anteriores continuam, não foram substituídos', () => {
    expect(bloco).toContain("id: 'embalagem'");
    expect(bloco).toContain("id: 'rotulagem'");
    expect(bloco).toContain("id: 'aparencia'");
    expect(bloco).toContain("id: 'etiquetagem'");
  });

  it('o texto do check é o que ela pediu, em substância (etiquetado + data de manipulação + validade)', () => {
    const linha = bloco.split('\n').find((l) => l.includes("id: 'etiquetagem'"));
    expect(linha.toLowerCase()).toContain('etiquetado');
    expect(linha.toLowerCase()).toContain('manipulação');
    expect(linha.toLowerCase()).toContain('validade');
  });

  it('entra na sugestão automática de resultado, junto com os outros 3 (aceito só quando TODOS são C)', () => {
    const ids = ['embalagem', 'rotulagem', 'aparencia', 'etiquetagem'];
    expect(receivingSuggestedResult(
      { embalagem: 'C', rotulagem: 'C', aparencia: 'C', etiquetagem: 'C' }, ids
    )).toBe('aceito');
    // 3 de 4 conformes já não fecha mais "aceito" - o 4º check pesa igual aos outros
    expect(receivingSuggestedResult(
      { embalagem: 'C', rotulagem: 'C', aparencia: 'C', etiquetagem: 'NC' }, ids
    )).toBe('aceito_parcial');
  });
});

describe('temperatura mostra "°C" mesmo com o teclado numérico do celular aberto', () => {
  const ini = corpoRecebimento.indexOf('Temperatura na chegada');
  const fim = corpoRecebimento.indexOf('</label>', ini);
  const bloco = corpoRecebimento.slice(ini, fim);

  it('o input continua puramente numérico (inputMode decimal) - a queixa não era sobre o TIPO de teclado', () => {
    expect(bloco).toContain('inputMode="decimal"');
  });

  it('"°C" aparece como sufixo fixo DENTRO do campo, não só no texto do rótulo acima', () => {
    // Sufixo sobreposto (position:absolute) por cima do input, não uma
    // legenda separada que some quando o teclado cobre a tela.
    expect(bloco).toMatch(/position:\s*'relative'/);
    expect(bloco).toMatch(/position:\s*'absolute'/);
    expect(bloco).toContain('>°C<');
  });

  it('o sufixo não intercepta clique/toque (pointerEvents none) - não pode atrapalhar quem for tocar no campo', () => {
    expect(bloco).toContain("pointerEvents: 'none'");
  });
});
