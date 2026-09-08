import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Regressão do "coloco todas as informações e no momento de salvar não salva"
// (Terraço, 08/09). A v1.9.233 fez a tela de Equipamentos AVISAR as outras
// telas depois de gravar — só que ela mesma escuta esse aviso: gravava →
// avisava → se ouvia → relia o localStorage (array novo) → gravava de novo...
// O React derrubava com "Maximum update depth exceeded" e DESCARTAVA a
// gravação. O equipamento sumia sem mensagem nenhuma.
//
// Duas travas seguram isso, e este teste exige as duas:
//   1. o efeito de gravação só grava/avisa quando o catálogo mudou de verdade;
//   2. o listener ignora o aviso que a própria tela emitiu.
// Uma sozinha já quebraria o laço, mas a 1 é a estrutural (vale pra qualquer
// emissor futuro) e a 2 evita a tela relida embaixo da mão de quem cadastra.

const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

// Recorta o corpo do EquipmentView pra não casar com trecho de outra tela.
function corpoDoEquipmentView() {
  const i = fonte.indexOf('function EquipmentView(');
  expect(i, 'EquipmentView sumiu de pages.jsx').toBeGreaterThan(-1);
  const j = fonte.indexOf('\nfunction ', i + 10);
  return fonte.slice(i, j === -1 ? fonte.length : j);
}

describe('catálogo de equipamentos não entra em laço ao salvar', () => {
  const corpo = corpoDoEquipmentView();

  it('grava e avisa só quando o catálogo mudou de verdade', () => {
    // A comparação tem que acontecer ANTES do writeEquipmentCatalog: é ela
    // que impede a segunda volta do laço.
    const comparacao = corpo.indexOf('ultimoGravado.current === ');
    const gravacao = corpo.indexOf('writeEquipmentCatalog(activeTenant.id, catalog)');
    expect(comparacao, 'sem trava de "mudou de verdade" antes de gravar').toBeGreaterThan(-1);
    expect(gravacao).toBeGreaterThan(comparacao);

    // E tem que SAIR quando não mudou — comparar sem return não trava nada.
    const trecho = corpo.slice(comparacao, gravacao);
    expect(trecho).toMatch(/return;/);
  });

  it('o listener de sync ignora o aviso que a própria tela emitiu', () => {
    const listener = corpo.indexOf('window.addEventListener(SYNC_EVENT');
    expect(listener).toBeGreaterThan(-1);
    const bloco = corpo.slice(corpo.lastIndexOf('useEffect(() => {', listener), listener);
    expect(bloco, 'listener volta a reagir ao próprio aviso').toContain("=== 'edicao-equipamento'");
    expect(bloco).toMatch(/return;/);
  });

  it('o aviso continua saindo quando houve edição de verdade', () => {
    // A correção não pode ter matado o que a v1.9.233 entregou: a Visão geral
    // relê o catálogo por causa deste aviso.
    expect(corpo).toContain("notificarSyncAplicado({ tenantId: activeTenant.id, trigger: 'edicao-equipamento' })");
  });
});
