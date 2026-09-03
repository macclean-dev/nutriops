import { describe, it, expect } from 'vitest';
import { planejarMudancaDeUnidade, explicarRecusa, avisoDaMudanca } from './mover-colaborador';

const CASA = { id: 'casadoce', name: 'CASA DOCE' };
const FABZ = { id: 'fabrizzio', name: 'Fabrizzio Matriz' };
const pessoa = (name, extra = {}) => ({ name, role: 'Colaborador', location: 'ATENDENTE', status: 'Ativo', pin: '0000', ...extra });

describe('planejarMudancaDeUnidade', () => {
  it('move quando o destino não tem ninguém com esse nome', () => {
    const r = planejarMudancaDeUnidade(pessoa('RAIANE DA SILVA SOUSA MARQUES'), CASA, FABZ, []);
    expect(r.ok).toBe(true);
    expect(r.pessoa.name).toBe('RAIANE DA SILVA SOUSA MARQUES');
  });

  it('preserva cargo, localização, status e PIN', () => {
    const r = planejarMudancaDeUnidade(pessoa('FULANA', { role: 'Supervisor', location: 'GELATERIA' }), CASA, FABZ, []);
    expect(r.pessoa.role).toBe('Supervisor');
    expect(r.pessoa.location).toBe('GELATERIA');
    expect(r.pessoa.status).toBe('Ativo');
    expect(r.pessoa.pin).toBe('0000');
  });

  it('LIMPA "só opera aqui" — na empresa que assina a carteira dela a marca a tiraria do ASO dos dois lados', () => {
    const r = planejarMudancaDeUnidade(pessoa('LAYZA', { asoExterno: true }), CASA, FABZ, []);
    expect(r.pessoa.asoExterno).toBe(false);
  });

  it('recusa homônimo no destino — a chave na nuvem é (empresa, nome) e a linha de lá sumiria', () => {
    const r = planejarMudancaDeUnidade(pessoa('MARIA SILVA'), CASA, FABZ, [pessoa('maria silva')]);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('ja_existe_no_destino');
  });

  it('a comparação de homônimo ignora caixa e espaço', () => {
    const r = planejarMudancaDeUnidade(pessoa('  Maria Silva '), CASA, FABZ, [pessoa('MARIA SILVA')]);
    expect(r.motivo).toBe('ja_existe_no_destino');
  });

  it('recusa mover pra própria empresa', () => {
    expect(planejarMudancaDeUnidade(pessoa('FULANA'), CASA, CASA, []).motivo).toBe('mesma_empresa');
  });

  it('recusa sem destino e sem nome', () => {
    expect(planejarMudancaDeUnidade(pessoa('FULANA'), CASA, null, []).motivo).toBe('sem_destino');
    expect(planejarMudancaDeUnidade(pessoa('   '), CASA, FABZ, []).motivo).toBe('sem_nome');
  });

  it('não muta o objeto original', () => {
    const p = pessoa('FULANA', { asoExterno: true });
    planejarMudancaDeUnidade(p, CASA, FABZ, []);
    expect(p.asoExterno).toBe(true);
  });

  it('equipe de destino nula não quebra', () => {
    expect(planejarMudancaDeUnidade(pessoa('FULANA'), CASA, FABZ, null).ok).toBe(true);
  });
});

describe('as mensagens dizem o que a pessoa precisa saber', () => {
  it('a recusa por homônimo explica a consequência, não só o erro', () => {
    const t = explicarRecusa('ja_existe_no_destino', 'Fabrizzio Matriz');
    expect(t).toContain('Fabrizzio Matriz');
    expect(t).toContain('some da lista sem aviso');
  });

  it('o aviso deixa claro que o histórico NÃO se move — é a dúvida que vem depois', () => {
    const t = avisoDaMudanca('RAIANE', 'CASA DOCE', 'Fabrizzio Matriz');
    expect(t).toContain('FICAM em CASA DOCE');
    expect(t).toContain('registro sanitário fica onde foi feito');
  });

  it('e diz o que passa a valer no destino', () => {
    const t = avisoDaMudanca('RAIANE', 'CASA DOCE', 'Fabrizzio Matriz');
    expect(t).toContain('controle de ASO');
    expect(t).toContain('Fabrizzio Matriz');
  });

  it('motivo desconhecido não vira mensagem vazia', () => {
    expect(explicarRecusa('coisa-nova', 'X')).toBe('Não foi possível mover.');
  });
});

// ─── A ligação com a tela ────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
const team = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');

describe('team-views.jsx liga o motor na tela', () => {
  it('o botão Mover existe, só com mais de uma empresa alcançável', () => {
    expect(team).toContain('outrasUnidades.length > 0 &&');
    expect(team).toContain('>Mover</button>');
  });

  it('a lista de destinos exclui a empresa atual', () => {
    expect(team).toContain("(allTenants ?? []).filter((t) => t.id !== activeTenant.id)");
  });

  it('grava no DESTINO antes de tirar da ORIGEM — perder dos dois lados é o pior desfecho', () => {
    const ini = team.indexOf('const moverParaUnidade');
    const corpo = team.slice(ini, team.indexOf('const removeUser', ini));
    expect(corpo.indexOf('writeUsers(destino.id')).toBeLessThan(corpo.indexOf('setUsers((prev) => prev.filter'));
    expect(corpo.indexOf('pushStaffMember(destino.id')).toBeLessThan(corpo.indexOf('deleteStaffMember(activeTenant.id'));
  });

  it('pede confirmação com o aviso do histórico antes de mexer em qualquer coisa', () => {
    const ini = team.indexOf('const moverParaUnidade');
    const corpo = team.slice(ini, team.indexOf('const removeUser', ini));
    expect(corpo.indexOf('avisoDaMudanca')).toBeLessThan(corpo.indexOf('writeUsers(destino.id'));
  });

  it('falha ao apagar a origem avisa que a pessoa pode aparecer nas DUAS listas', () => {
    expect(team).toContain('pode reaparecer nas duas listas');
  });

  it('o card de acesso por e-mail subiu pra antes da lista de ~100 pessoas', () => {
    expect(team.indexOf('Colaboradores por e-mail')).toBeLessThan(team.indexOf('Equipe cadastrada'));
  });
});
