// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperatorPicker } from './operator-picker';

const TENANT = { id: 'casadoce', name: 'CASA DOCE' };

const comEquipe = (nomes) => localStorage.setItem(
  'nutriops.users.casadoce',
  JSON.stringify(nomes.map((name) => ({ name, role: 'Colaborador', status: 'Ativo' }))));

const render = () => renderToStaticMarkup(
  <OperatorPicker tenant={TENANT} onPick={() => {}} onCancel={() => {}} />);

beforeEach(() => { localStorage.clear(); });

// renderToStaticMarkup não roda efeito nem digitação, então o estado `manual`
// nasce vazio e a sugestão não aparece no HTML. O comportamento vive travado
// em nome-parecido.test.js (motor, 21 testes); aqui trava a LIGAÇÃO — que a
// tela de fato consulta o motor e não aceita a grafia nova em silêncio.
describe('a tela consulta o motor', () => {
  const fonte = require('node:fs').readFileSync(`${process.cwd()}/src/operator-picker.jsx`, 'utf8');

  it('importa e chama nomeParecido com a equipe da loja', () => {
    expect(fonte).toContain("import { nomeParecido } from './nome-parecido'");
    expect(fonte).toContain('nomeParecido(staff, manual)');
  });

  it('pergunta antes de aceitar a grafia nova', () => {
    expect(fonte).toContain('Você quis dizer');
    expect(fonte).toContain('Sim, sou eu');
  });

  it('o botão principal escolhe a SUGESTÃO, não o texto digitado', () => {
    expect(fonte).toContain('onClick={() => escolher(sugestao)}>Sim, sou eu');
  });

  it('insistir no nome digitado continua possível — homônimo de verdade existe', () => {
    expect(fonte).toContain('Não, meu nome é {manual.trim()}');
  });

  it('mas deixou de ser o caminho de menor resistência — vira ghost-action', () => {
    // O recorte precisa do ternário DESTE bloco: existe um `) : (` antes no
    // arquivo, e sem o fromIndex o slice sai vazio e o teste passa à toa.
    const ini = fonte.indexOf('sugestao ? (');
    const bloco = fonte.slice(ini, fonte.indexOf(') : (', ini));
    expect(bloco.length).toBeGreaterThan(100);
    expect(bloco).toContain('className="primary-action"');   // = "Sim, sou eu"
    expect(bloco).toContain('className="ghost-action"');     // = insistir
    expect(bloco.indexOf('primary-action')).toBeLessThan(bloco.indexOf('ghost-action'));
  });

  it('Enter escolhe a sugestão quando existe', () => {
    expect(fonte).toContain('escolher(sugestao ?? manual.trim())');
  });

  it('sem sugestão, o fluxo antigo continua intacto — a saída manual não pode sumir', () => {
    expect(fonte).toContain('Continuar como {manual.trim()');
  });
});

describe('a saída manual continua existindo (não pode virar tela sem saída)', () => {
  it('equipe vazia ainda oferece digitar o nome', () => {
    const html = render();
    expect(html).toContain('ainda não foi cadastrada');
    expect(html).toContain('Seu nome completo');
  });

  it('com equipe cadastrada, os nomes aparecem pra tocar', () => {
    comEquipe(['LAYZA CRISTINA PEREIRA LUSTOSA', 'DANIELA FERREIRA DOS SANTOS']);
    const html = render();
    expect(html).toContain('LAYZA CRISTINA PEREIRA LUSTOSA');
    expect(html).toContain('DANIELA FERREIRA DOS SANTOS');
    expect(html).not.toContain('Você quis dizer');   // nada digitado ainda
  });
});
