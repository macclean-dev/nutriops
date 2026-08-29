import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { teamAsoSummary, DOC_TYPES } from './compliance';

// ─────────────────────────────────────────────────────────────────────────────
// CASA DOCE opera com 2 CNPJs no mesmo endereço. Os equipamentos estão todos
// na CASA DOCE; 15 pessoas que aferem lá são contratadas pela Fabrizzio.
//
// Cadastrá-las na CASA DOCE resolvia o seletor de nome mas contaminava o
// controle de ASO — a RT chegou a fazer isso num sábado e teve que desfazer.
// `asoExterno` separa as duas coisas.
// ─────────────────────────────────────────────────────────────────────────────

const pessoa = (name, extra = {}) => ({ name, role: 'Colaborador', status: 'Ativo', ...extra });

const EQUIPE = [
  pessoa('DANIELA FERREIRA DOS SANTOS'),                          // CASA DOCE
  pessoa('LAYZA CRISTINA PEREIRA LUSTOSA', { asoExterno: true }), // Fabrizzio
  pessoa('SAMILLY CRISTINA COSTA TEIXEIRA', { asoExterno: true }),// Fabrizzio
];

describe('quem "só opera aqui" fica fora do controle de ASO desta loja', () => {
  it('não aparece na lista de situações', () => {
    const nomes = teamAsoSummary(EQUIPE, []).situacoes.map((s) => s.name);
    expect(nomes).toEqual(['DANIELA FERREIRA DOS SANTOS']);
  });

  it('não entra no total nem nas contagens', () => {
    const r = teamAsoSummary(EQUIPE, []);
    expect(r.total).toBe(1);
    expect(r.never).toBe(1);   // só a Daniela, sem ASO
  });

  it('ASO vencido de quem opera aqui NÃO soa alarme nesta loja', () => {
    const docs = [{ id:'a1', docType: DOC_TYPES.ASO, subject:'LAYZA CRISTINA PEREIRA LUSTOSA',
                    issuedAt:'2020-01-01', validUntil:'2020-06-01' }];
    expect(teamAsoSummary(EQUIPE, docs).expired).toBe(0);
  });

  it('mas o ASO dela CONTA na empresa que a controla — a marca é por loja', () => {
    // Mesma pessoa, cadastrada na Fabrizzio SEM a marca: lá ela é cobrada.
    const naFabrizzio = [pessoa('LAYZA CRISTINA PEREIRA LUSTOSA')];
    const docs = [{ id:'a1', docType: DOC_TYPES.ASO, subject:'LAYZA CRISTINA PEREIRA LUSTOSA',
                    issuedAt:'2020-01-01', validUntil:'2020-06-01' }];
    expect(teamAsoSummary(naFabrizzio, docs).expired).toBe(1);
  });
});

describe('a marca é opt-in — ninguém sai do ASO por omissão', () => {
  it('sem o campo, a pessoa continua no controle (comportamento de sempre)', () => {
    expect(teamAsoSummary([pessoa('FULANA')], []).total).toBe(1);
  });

  it('asoExterno false conta normalmente', () => {
    expect(teamAsoSummary([pessoa('FULANA', { asoExterno: false })], []).total).toBe(1);
  });

  it('só o booleano true tira — string "true" não vale', () => {
    // Guarda contra o valor chegar como texto de um JSON malformado.
    expect(teamAsoSummary([pessoa('FULANA', { asoExterno: 'true' })], []).total).toBe(1);
  });

  it('Inativo continua saindo, independente da marca nova', () => {
    const lista = [pessoa('FULANA', { status: 'Inativo' }), pessoa('BELTRANA')];
    expect(teamAsoSummary(lista, []).total).toBe(1);
  });
});

describe('a marca viaja pra nuvem — senão vale só no aparelho onde foi feita', () => {
  const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');

  it('staffToRow manda aso_externo', () => {
    expect(repo).toContain('aso_externo: u.asoExterno === true');
  });

  it('staffFromRow lê de volta, e null vira false — linha antiga não some do ASO', () => {
    expect(repo).toContain('asoExterno: row.aso_externo ?? false');
    expect(repo).not.toContain('asoExterno: row.aso_externo === true');
  });

  it('a coluna está no SQL que a tela de Configurações mostra pro usuário copiar', () => {
    expect(repo).toContain('aso_externo boolean not null default false');
  });
});

describe('a migração existe e é idempotente', () => {
  const sql = readFileSync(`${process.cwd()}/docs/aso-so-opera-aqui.sql`, 'utf8');

  it('usa add column if not exists — pode rodar de novo', () => {
    expect(sql).toContain('add column if not exists aso_externo');
  });

  it('default false: migração não tira ninguém do controle de saúde', () => {
    expect(sql).toContain('boolean not null default false');
  });
});

describe('a tela de Equipe grava e mostra a marca', () => {
  const team = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');

  it('o checkbox existe', () => {
    expect(team).toContain('Só opera aqui');
    expect(team).toContain('checked={asoExternoInput}');
  });

  it('o valor entra no objeto salvo', () => {
    expect(team).toContain('asoExterno: asoExternoInput');
  });

  it('editar uma pessoa carrega a marca dela — senão salvar desmarcaria sem querer', () => {
    expect(team).toContain('setAsoExterno(u.asoExterno === true)');
  });

  it('a lista mostra quem está marcado, sem precisar abrir cada um', () => {
    expect(team).toContain('{u.asoExterno && <span className="badge neutral"');
  });

  it('o texto explica que a capacitação continua valendo', () => {
    expect(team).toContain('capacitação continua sendo cobrada aqui');
  });
});
