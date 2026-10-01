import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Relato da nutricionista (01/10), depois de eu ter dito que o botão
// "Editar" já existe na Higienização de Hortifrutícolas: "Não consegui
// achar a opção na planilha... para remover os outros setores".
//
// O botão existe (isRT && isTemplateEditable(tpl) já cobre esse template,
// que tem o campo Setor como type:'select') - a causa é visual, não
// funcional. Com setor ainda não escolhido, a fileira de baixo do card tem
// até 4 botões: Histórico, Editar, 📱 Tablet, "Escolha o setor" (ou ↓ PDF
// quando concluída). Nenhum dos dois contêineres flex tinha flexWrap - num
// celular eles não cabem numa linha só e não quebram pra linha de baixo:
// ficam espremidos ou saem da tela, e o Editar é o mais fácil de sumir por
// vir no meio do grupo.

const forms = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

describe('a fileira de botões do card de planilha quebra linha em tela estreita', () => {
  // Âncora única: é o único lugar do arquivo onde "Editar" e "📱 Tablet"
  // aparecem na mesma fileira de botões de um card de planilha.
  const ini = forms.indexOf("onClick={() => setHistId(histId===tpl.id?null:tpl.id)}");
  const linhaIni = forms.lastIndexOf('<div', ini);
  const fim = forms.indexOf('📱 Tablet', ini);
  const bloco = forms.slice(linhaIni, fim + 50);

  it('é de fato a fileira certa - Histórico, Editar e Tablet convivem aqui', () => {
    expect(bloco).toContain('Histórico');
    expect(bloco).toContain("setEditingTpl(tpl)}>Editar<");
    expect(bloco).toContain('📱 Tablet');
  });

  it('o contêiner externo (Histórico à esquerda, resto à direita) quebra linha', () => {
    const ini2 = bloco.indexOf("justifyContent:'space-between'");
    const linha = bloco.slice(bloco.lastIndexOf('{{', ini2), bloco.indexOf('}}', ini2));
    expect(linha).toContain("flexWrap:'wrap'");
  });

  it('o grupo da direita (Editar, PDF, Tablet, Preencher) também quebra linha', () => {
    // segundo "display:'flex'" do bloco é o grupo da direita
    const primeiro = bloco.indexOf("display:'flex'");
    const segundo = bloco.indexOf("display:'flex'", primeiro + 1);
    const linha = bloco.slice(bloco.lastIndexOf('{{', segundo), bloco.indexOf('}}', segundo));
    expect(linha).toContain("flexWrap:'wrap'");
  });
});
