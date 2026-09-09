import { describe, it, expect } from 'vitest';
import { completionPct } from './forms';

// Relato da RT (09/09), nas 3 lojas: "A planilha de controle de dedetização,
// quando vou colocar os campos de preenchimento, ela não está saindo de 0% e
// nem deixa salvar."
//
// Causa: completionPct ignora `text` e `photo` de propósito — observação e
// foto são acessórias numa planilha de tarefas. Só que a de Dedetização é
// FEITA só disso (empresa, data, serviço, produto, certificado, comprovante,
// observações). Sem nenhum campo contável, `total` ficava 0 e a função
// devolvia 0% por mais que a pessoa preenchesse.
//
// O "nem deixa salvar" é consequência: "Confirmar preenchimento" com pct < 100
// abre "A planilha está 0% preenchida. Confirmar mesmo assim?" — quem lê 0%
// depois de preencher tudo cancela, e nada é gravado.

const dedetizacao = {
  frequency: 'monthly',
  sections: [{ id: 'sec', title: 'Registro do serviço', fields: [
    { id: 'emp',  label: 'Empresa executora',   type: 'text' },
    { id: 'data', label: 'Data do serviço',     type: 'text' },
    { id: 'serv', label: 'Serviço executado',   type: 'text' },
    { id: 'prod', label: 'Produto utilizado',   type: 'text' },
    { id: 'cert', label: 'Número do certificado', type: 'text' },
    { id: 'foto', label: 'Comprovante',         type: 'photo' },
    { id: 'obs',  label: 'Observações',         type: 'text', optional: true },
  ]}],
};

const todosOsCampos = {
  emp: 'Dedetizadora X', data: '05/09/2026', serv: 'Desinsetização',
  prod: 'Produto Y', cert: '12345', foto: { path: 'casadoce/ded.pdf', at: '2026-09-05' },
};

describe('planilha só de texto e foto (Controle de Dedetização)', () => {
  it('em branco é 0%', () => {
    expect(completionPct(dedetizacao, { responses: {} })).toBe(0);
  });

  it('o percentual anda conforme se preenche — era isso que travava em 0%', () => {
    const um = completionPct(dedetizacao, { responses: { emp: 'Dedetizadora X' } });
    const dois = completionPct(dedetizacao, { responses: { emp: 'Dedetizadora X', data: '05/09/2026' } });
    expect(um).toBeGreaterThan(0);
    expect(dois).toBeGreaterThan(um);
  });

  it('chega a 100% sem exigir Observações — senão o aviso de "confirmar mesmo assim?" vinha todo mês', () => {
    expect(completionPct(dedetizacao, { responses: todosOsCampos })).toBe(100);
  });

  it('a foto conta pelo caminho no Storage ({ path, at }), que é como PhotoField grava', () => {
    const semFoto = { ...todosOsCampos }; delete semFoto.foto;
    expect(completionPct(dedetizacao, { responses: semFoto })).toBeLessThan(100);
    expect(completionPct(dedetizacao, { responses: todosOsCampos })).toBe(100);
  });
});

describe('planilha com tarefas de verdade não mudou', () => {
  // A regra original continua valendo onde há o que contar: texto e foto
  // seguem FORA do percentual, senão toda planilha de higienização passaria a
  // exigir observação e foto pra fechar 100%.
  const higienizacao = {
    frequency: 'weekly',
    sections: [{ id: 'sec', title: 'Tarefas', fields: [
      { id: 't1', label: 'Piso',    type: 'cnc' },
      { id: 't2', label: 'Paredes', type: 'cnc' },
      { id: 'ob', label: 'Observações', type: 'text' },
      { id: 'ft', label: 'Foto',    type: 'photo' },
    ]}],
  };

  it('100% com as tarefas feitas, sem observação nem foto', () => {
    const resp = { t1: { date: '2026-09-09', sig: 'Ana' }, t2: { date: '2026-09-09', sig: 'Ana' } };
    expect(completionPct(higienizacao, { responses: resp })).toBe(100);
  });

  it('metade das tarefas é 50% — texto e foto não diluem o total', () => {
    const resp = { t1: { date: '2026-09-09', sig: 'Ana' }, ob: 'tudo certo', ft: { path: 'x.jpg' } };
    expect(completionPct(higienizacao, { responses: resp })).toBe(50);
  });

  it('checkbox só conta marcado', () => {
    const tpl = { frequency: 'daily', sections: [{ id: 's', fields: [
      { id: 'c1', label: 'A', type: 'checkbox' }, { id: 'c2', label: 'B', type: 'checkbox' },
    ]}]};
    expect(completionPct(tpl, { responses: { c1: true, c2: false } })).toBe(50);
    expect(completionPct(tpl, { responses: { c1: true, c2: true } })).toBe(100);
  });
});
