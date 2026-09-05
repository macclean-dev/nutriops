import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeTurnAlertsPure } from './turn-alerts';
import { equipamentosForaDaRotina } from './fora-da-rotina';

// ─────────────────────────────────────────────────────────────────────────────
// Relato da RT da CASA DOCE (05/09) sobre o U.3, ultracongelador da gelateria:
//   "Hoje elas registraram com 0° porque o equipamento estava desligado. Ele
//    não fica ligado constantemente, só quando está em uso. Provavelmente terei
//    que excluí-lo do cadastro, pois sempre que não for preenchido ficará
//    pendente."
//
// Os dois desfechos que ela descreve são ruins: 0 °C num ultracongelador vira
// desvio gravíssimo FALSO no histórico, e apagar o equipamento tira da
// evidência algo que existe e é usado. `usoIntermitente` corta a cobrança sem
// criar leitura nenhuma — nenhum número inventado entra no registro sanitário.
// ─────────────────────────────────────────────────────────────────────────────

const eq = (label, extra = {}) => ({ label, aliases: [label.toLowerCase()], location: 'Gelateria', ...extra });
const U3   = eq('Ultracongelado U.3', { usoIntermitente: true, minTemp: -40, maxTemp: -30 });
const F3   = eq('Congelador vertical — F.3', { minTemp: -18, maxTemp: -11 });

const TURNOS = [{ id:'t1', name:'Manhã', start:'06:00', end:'12:00' }];
const AGORA  = new Date(2026, 8, 5, 13, 0);   // turno já encerrado

describe('alerta de turno não cobra equipamento de uso intermitente', () => {
  it('o U.3 sai da lista; o F.3 continua sendo cobrado', () => {
    const a = computeTurnAlertsPure(TURNOS, [], [U3, F3], 'casadoce', false, AGORA);
    expect(a.map((x) => x.equipment)).toEqual(['Congelador vertical — F.3']);
  });

  it('sem a marca, o U.3 volta a ser cobrado — a exceção é opt-in', () => {
    const semMarca = { ...U3, usoIntermitente: false };
    const a = computeTurnAlertsPure(TURNOS, [], [semMarca, F3], 'casadoce', false, AGORA);
    expect(a.map((x) => x.equipment)).toContain('Ultracongelado U.3');
  });

  it('equipamento antigo, sem o campo, segue cobrado — ninguém sai por omissão', () => {
    const antigo = eq('Freezer — F.1');
    expect(computeTurnAlertsPure(TURNOS, [], [antigo], 'casadoce', false, AGORA)).toHaveLength(1);
  });

  it('só o booleano true corta — a string "true" não vale', () => {
    const torto = { ...U3, usoIntermitente: 'true' };
    expect(computeTurnAlertsPure(TURNOS, [], [torto], 'casadoce', false, AGORA)).toHaveLength(1);
  });
});

describe('"equipamentos fora da rotina" ignora uso intermitente', () => {
  it('o U.3 não aparece como "nunca medido"', () => {
    const fora = equipamentosForaDaRotina({ catalog:[U3, F3], records:[], tenantId:'casadoce', now: AGORA });
    expect(fora.map((x) => x.equipamento)).toEqual(['Congelador vertical — F.3']);
  });

  it('nem como "sem leitura há N dias" quando a última é antiga', () => {
    const antiga = [{ tenantId:'casadoce', equipmentKey:'Ultracongelado U.3',
                      equipment:'Ultracongelado U.3', value:-35,
                      createdAt: new Date(2026, 7, 1).toISOString() }];
    const fora = equipamentosForaDaRotina({ catalog:[U3], records:antiga, tenantId:'casadoce', now: AGORA });
    expect(fora).toEqual([]);
  });

  it('sem a marca, a leitura velha o traria de volta pra lista', () => {
    const semMarca = { ...U3, usoIntermitente: false };
    const antiga = [{ tenantId:'casadoce', equipmentKey:'Ultracongelado U.3',
                      equipment:'Ultracongelado U.3', value:-35,
                      createdAt: new Date(2026, 7, 1).toISOString() }];
    const fora = equipamentosForaDaRotina({ catalog:[semMarca], records:antiga, tenantId:'casadoce', now: AGORA });
    expect(fora).toHaveLength(1);
  });
});

describe('o equipamento continua existindo pra todo o resto', () => {
  it('a leitura de quando ele ESTÁ ligado é registrada e julgada normalmente', async () => {
    const { resolveRecordTone } = await import('./limits');
    // -35 dentro de -40/-30 → conforme. A marca não mexe em conformidade.
    expect(resolveRecordTone({ value:-35, min:-40, max:-30 })).toBe('ok');
    // e um desvio de verdade continua sendo desvio
    expect(resolveRecordTone({ value:0, min:-40, max:-30 })).toBe('danger');
  });
});

describe('a marca viaja pra nuvem', () => {
  const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');

  it('eqToRow manda uso_intermitente', () => {
    expect(repo).toContain('uso_intermitente: eq.usoIntermitente === true');
  });

  it('eqFromRow lê de volta, e null vira false', () => {
    expect(repo).toContain('usoIntermitente: row.uso_intermitente ?? false');
    expect(repo).not.toContain('usoIntermitente: row.uso_intermitente === true');
  });

  it('a coluna está no SQL que Configurações mostra pro usuário copiar', () => {
    expect(repo).toContain('uso_intermitente boolean not null default false');
  });
});

describe('a tela de Equipamentos grava e mostra a marca', () => {
  const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  it('o checkbox existe', () => {
    expect(pages).toContain('Só liga quando está em uso');
    expect(pages).toContain('checked={intermitenteInput}');
  });

  it('o valor entra no objeto salvo', () => {
    expect(pages).toContain('usoIntermitente: intermitenteInput');
  });

  it('editar carrega a marca — senão salvar a desmarcaria sem querer', () => {
    expect(pages).toContain('setIntermitente(item.usoIntermitente === true)');
  });

  it('a lista mostra quem está marcado', () => {
    expect(pages).toContain('{item.usoIntermitente && <span className="badge neutral"');
  });

  it('o texto avisa pra NÃO registrar com o aparelho desligado — é a origem do problema', () => {
    expect(pages).toContain('não registre temperatura com ele desligado');
  });
});

describe('a migração existe, é idempotente e confere o banco antes', () => {
  const sql = readFileSync(`${process.cwd()}/docs/equipamento-uso-intermitente.sql`, 'utf8');

  it('usa add column if not exists', () => {
    expect(sql).toContain('add column if not exists uso_intermitente');
  });

  it('default false: migração não tira ninguém da cobrança', () => {
    expect(sql).toContain('boolean not null default false');
  });

  it('abre confirmando o projeto — já rodei migração no banco errado antes', () => {
    const antesDoAlter = sql.slice(0, sql.indexOf('alter table'));
    expect(antesDoAlter).toContain('current_database()');
    expect(antesDoAlter).toContain('PARE');
  });
});

describe('a Visão geral reflete a marca sem precisar recarregar', () => {
  const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  it('o App reavalia o catálogo quando alguma tela avisa que mexeu nele', () => {
    const ini = pages.indexOf('const [catalogVersion, setCatalogVersion]');
    const corpo = pages.slice(ini, ini + 1400);
    expect(corpo).toContain('window.addEventListener(SYNC_EVENT, reler)');
    expect(corpo).toContain('setCatalogVersion((v) => v + 1)');
  });

  it('o aviso sai DEPOIS de gravar, não do handler — a ordem é o que faz funcionar', () => {
    // Primeira tentativa emitia de dentro do saveItem/removeItem. Não
    // funcionava: o handler roda ANTES do efeito que grava no localStorage,
    // então quem ouvia relia o catálogo VELHO e a tela não mudava. Verificado
    // no navegador: continuava "2 nunca medidos" depois de marcar.
    const ini = pages.indexOf('writeEquipmentCatalog(activeTenant.id, catalog);');
    const corpo = pages.slice(ini, ini + 900);
    expect(corpo).toContain("notificarSyncAplicado({ tenantId: activeTenant.id, trigger: 'edicao-equipamento' })");

    // e o saveItem NÃO emite mais por conta própria
    const save = pages.slice(pages.indexOf('const saveItem = async () => {'),
                             pages.indexOf('const removeItem = async (i) => {'));
    expect(save).not.toContain('notificarSyncAplicado');
  });

  it('não emite no mount — abrir a tela não é mudança', () => {
    const ini = pages.indexOf('writeEquipmentCatalog(activeTenant.id, catalog);');
    expect(pages.slice(ini, ini + 900)).toContain('if (primeiraGravacao.current)');
  });
});
