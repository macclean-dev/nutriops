import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readTurns, writeTurns, publicarTurnos, turnosDoPerfil, turnosSoNesteAparelho, DEFAULT_TURNS } from './turns';

// ─────────────────────────────────────────────────────────────────────────────
// Candidata 6 da pesquisa de 03/10. Os turnos viviam só no navegador de cada
// aparelho: num aparelho novo voltavam ao padrão, e dois aparelhos da mesma
// loja podiam cobrar pendência em horários diferentes (alertas, Prontidão A3,
// cobertura do dashboard). A CASA DOCE opera com "2 tablets e 3 computadores"
// (relato de 17/08). Agora moram no perfil da empresa, que já sincroniza.
// ─────────────────────────────────────────────────────────────────────────────

const LOJA = { id: 'cd' };
const DOIS = [{ id: 'm', name: 'Manhã', start: '07:00', end: '14:59' }, { id: 't', name: 'Tarde', start: '15:00', end: '22:00' }];
const perfil = (dados) => localStorage.setItem('nutriops.company.profile.cd', JSON.stringify(dados));

beforeEach(() => { localStorage.clear(); });

describe('de onde os turnos são lidos', () => {
  it('nada salvo: padrão (como antes)', () => {
    expect(readTurns(LOJA)).toEqual(DEFAULT_TURNS);
  });

  it('só local: o deste aparelho (como antes)', () => {
    writeTurns('cd', DOIS);
    expect(readTurns(LOJA)).toEqual(DOIS);
  });

  it('perfil com turnos: valem pra loja toda, acima do local', () => {
    writeTurns('cd', DEFAULT_TURNS);
    perfil({ razaoSocial: 'Casa Doce', turns: DOIS });
    expect(readTurns(LOJA)).toEqual(DOIS);
  });

  it('turnos inválidos no perfil são ignorados', () => {
    perfil({ turns: [] });
    expect(turnosDoPerfil('cd')).toBeNull();
    perfil({ turns: [{ name: 'sem horário' }] });
    expect(readTurns(LOJA)).toEqual(DEFAULT_TURNS);
  });
});

describe('publicarTurnos', () => {
  it('envia o perfil INTEIRO com os turnos (não apaga razão social, alvará...)', async () => {
    perfil({ razaoSocial: 'Casa Doce', alvara: '123' });
    const enviados = [];
    const ok = await publicarTurnos('cd', DOIS, async (id, p) => { enviados.push([id, p]); });
    expect(ok).toBe(true);
    expect(enviados).toEqual([['cd', { razaoSocial: 'Casa Doce', alvara: '123', turns: DOIS }]]);
  });

  it('sem mudança, não envia (a tela grava a cada montagem)', async () => {
    perfil({ turns: DOIS });
    let chamadas = 0;
    expect(await publicarTurnos('cd', DOIS, async () => { chamadas++; })).toBe(false);
    expect(chamadas).toBe(0);
  });

  it('lista vazia ou inválida não vai pra nuvem', async () => {
    let chamadas = 0;
    expect(await publicarTurnos('cd', [], async () => { chamadas++; })).toBe(false);
    expect(chamadas).toBe(0);
  });
});

describe('turnos só neste aparelho', () => {
  it('local personalizado e perfil sem turnos: avisa', () => {
    writeTurns('cd', DOIS);
    expect(turnosSoNesteAparelho('cd')).toBe(true);
  });
  it('local igual ao padrão: nada a avisar', () => {
    writeTurns('cd', DEFAULT_TURNS);
    expect(turnosSoNesteAparelho('cd')).toBe(false);
  });
  it('perfil já tem turnos: nada a avisar', () => {
    writeTurns('cd', DOIS);
    perfil({ turns: DOIS });
    expect(turnosSoNesteAparelho('cd')).toBe(false);
  });
});

describe('a tela de Turnos', () => {
  const tela = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');
  const turnos = tela.slice(tela.indexOf('export function TurnsView('), tela.indexOf('export function UsersView('));

  it('publica nas ações do usuário (adicionar, editar, remover), não no efeito de montagem', () => {
    expect(turnos).toContain('publicarTurnos(activeTenant.id, next)');
    expect(turnos).toContain('}, [activeTenant.id, turns]);');
    const efeito = turnos.slice(turnos.indexOf('useEffect(() => { writeTurns('), turnos.indexOf('}, [activeTenant.id, turns]);'));
    expect(efeito).not.toContain('publicarTurnos');
  });

  it('oferece publicar quando os turnos estão só neste aparelho, em vez de decidir sozinha', () => {
    expect(turnos).toContain('Usar estes turnos em todos os aparelhos');
  });
});
