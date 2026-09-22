import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Pedido 22/09 (junto com a planilha de Exposição): "5 campos em branco já
// com o símbolo '°C' de graus" — o campo number genérico de forms.jsx nunca
// mostrou unidade dentro do input (só no LABEL, como "Tempo de imersão
// (min)"). `unit` é um atributo opcional novo no field: quando presente,
// aparece como sufixo fixo sobreposto ao input (mesma técnica já usada no
// Recebimento de Mercadorias, 22/09, pro mesmo motivo: o teclado numérico do
// celular cobre o rótulo, "10" sozinho perde o contexto de que é °C).

const forms = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
// campoPreenchido() (bem mais acima no arquivo) também compara field.type
// com 'checkbox' — busca o fim do trecho A PARTIR do início, não do 0.
const inicioNumber = forms.indexOf("{field.type==='number'");
const bloco = forms.slice(inicioNumber, forms.indexOf("field.type==='checkbox'", inicioNumber));

describe('field.unit — sufixo de unidade dentro do campo number', () => {
  it('quando field.unit existe, sobrepõe o sufixo (position absolute) ao input', () => {
    expect(bloco).toContain('field.unit ?');
    expect(bloco).toMatch(/position:\s*'relative'/);
    expect(bloco).toMatch(/position:\s*'absolute'/);
    expect(bloco).toContain('{field.unit}');
  });

  it('sem field.unit, continua o input simples de sempre — não regride nenhum template existente', () => {
    // O ramo `:` do ternário é o input original, sem wrapper nem sufixo.
    const ternario = bloco.slice(bloco.indexOf('field.unit ?'));
    expect(ternario).toContain(') : (');
    expect(ternario).toContain('placeholder="0" style={{ width:120,');
  });

  it('o input ganha padding à direita quando tem sufixo, pra dígito não ficar embaixo do "°C"', () => {
    const comSufixo = bloco.slice(bloco.indexOf('field.unit ?'), bloco.indexOf(') : ('));
    expect(comSufixo).toContain('padding:\'7px 34px 7px 10px\'');
  });

  it('o sufixo não intercepta toque (pointerEvents none)', () => {
    expect(bloco).toContain("pointerEvents:'none'");
  });
});
