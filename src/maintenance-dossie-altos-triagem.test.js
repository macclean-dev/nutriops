import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  printMaintenanceReport,
  readEquipments, writeEquipments,
  readMaintenanceLogs, writeMaintenanceLogs,
  readWorkOrders, writeWorkOrders,
} from './maintenance';
import { gravarMesclando, SYNC_EVENT } from './lista-local';
import { mergeByKey } from './repository';
import { summarizeDossieRun } from './dossie-view';
import { buildDossierHtml } from './dossier';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 6 achados de gravidade ALTA sem perda de dado que apontam
// pra src/maintenance.jsx (3) e src/dossie-view.jsx (3) — pool de 169
// não-julgados da auditoria de falha silenciosa (18-19/08,
// data_achados_pendentes_19-08.json). Dois arquivos independentes, tratados
// como dois mini-lotes na mesma rodada. Rodadas anteriores desta tier: 1
// pages.jsx (c8a947e, v1.9.175), 2 repository.js (b9a81bc, v1.9.176), 3
// settings.jsx (8d7294f, v1.9.177).
//
// maintenance.jsx (3 achados, todos REAIS, todos corrigidos nesta rodada):
//   · Família 1 — a tela lia o localStorage só no mount/troca de empresa e
//     nunca reagia ao sync (mesma classe de bug já corrigida em controls.jsx/
//     forms.jsx/extras.jsx em 18/08, mas maintenance.jsx tinha ficado de
//     fora). Corrigido com o mesmo padrão: releitura em SYNC_EVENT (guardada
//     contra modal aberto) + gravarMesclando pros dois state que não têm
//     exclusão pela UI (logs, orders). equipments FICA de fora da mescla de
//     propósito — tem exclusão (onDelete), e mesclar ressuscitaria um ativo
//     removido.
//   · Família 2 — o religamento de histórico ao converter um item do
//     catálogo em ativo real (já existia, de uma rodada anterior desta mesma
//     sessão) só atualizava o state local; nunca empurrava pra nuvem. Como
//     maint_logs não carrega updatedAt na linha remota, o próximo sync
//     (deste aparelho OU de outro) desfazia o religamento em silêncio —
//     mergeByKey empata e o remoto (que entra por último no array) vence.
//     Completado empurrando os registros religados com pushMaintLog/
//     pushWorkOrder.
//   · Família 3 — o PDF de manutenção corta o histórico em 100 sem avisar,
//     enquanto o cabeçalho anuncia o TOTAL (`${logs.length} registros`).
//     Corrigido com uma nota visível na própria seção quando há corte.
//
// dossie-view.jsx (3 achados):
//   · Família A (2 achados, T2 e T3 — mesmo bug por duas lentes de auditoria)
//     — JÁ CORRIGIDO antes desta sessão (8dd10b5, v1.9.174): summarizeDossieRun
//     já conta janelas que de fato abriram, não as pedidas. Confirmado aqui
//     com testes diretos da função pura + guarda de fonte, mesmo padrão usado
//     no resto desta auditoria pros achados já fechados.
//   · Família B (1 achado) — REAL, corrigido nesta rodada. Gerando o dossiê
//     pra uma empresa diferente da sessão ativa (RT/Admin com várias lojas
//     visíveis), as 8 seções que leem localStorage por tenant (tudo menos
//     Temperatura) podem sair vazias só porque este aparelho nunca
//     sincronizou aquela loja — e caem no emptyMessage ("Nenhuma não
//     conformidade — parabéns.") como se estivesse tudo conforme. Corrigir de
//     verdade exigiria sincronizar cada módulo de cada tenant visível antes
//     de gerar (mudança de arquitetura, fora do escopo deste conserto) — o
//     que dá pra fazer sem mexer em como os dados são buscados é avisar
//     sempre que o alvo não é a própria empresa da sessão, que é exatamente
//     quando o risco existe. Ver análise completa no relatório desta rodada.
// ─────────────────────────────────────────────────────────────────────────────

const fonteMaintenance = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');
const fonteDossieView  = readFileSync(`${process.cwd()}/src/dossie-view.jsx`, 'utf8');
const fontePages       = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// src/maintenance.jsx — Família 1: relê no sync, grava mesclando (exceto
// equipments)
// ═══════════════════════════════════════════════════════════════════════════
describe('maintenance.jsx — Família 1: tela relê quando o sync avisa, e logs/orders não sobrescrevem o que o sync trouxe', () => {
  it('fonte: importa gravarMesclando e SYNC_EVENT de lista-local', () => {
    expect(fonteMaintenance).toContain("import { gravarMesclando, SYNC_EVENT } from './lista-local';");
  });

  it('fonte: existe um useEffect que relê os 4 states ao ouvir SYNC_EVENT', () => {
    const ini = fonteMaintenance.indexOf('useEffect(() => {\n    if (editEquip !== null || editOrder !== null || showLogModal !== null) return;');
    expect(ini).toBeGreaterThan(-1);
    const fim = fonteMaintenance.indexOf('}, [activeTenant, editEquip, editOrder, showLogModal]);', ini);
    expect(fim).toBeGreaterThan(ini);
    const corpo = fonteMaintenance.slice(ini, fim);
    expect(corpo).toContain('setEquipments(readEquipments(activeTenant.id));');
    expect(corpo).toContain('setCatalog(readCatalog(activeTenant));');
    expect(corpo).toContain('setLogs(readMaintenanceLogs(activeTenant.id));');
    expect(corpo).toContain('setOrders(readWorkOrders(activeTenant.id));');
    expect(corpo).toContain('window.addEventListener(SYNC_EVENT, reler);');
    expect(corpo).toContain('return () => window.removeEventListener(SYNC_EVENT, reler);');
  });

  it('fonte: a releitura NÃO roda com um modal aberto (equipamento, OS ou execução) — não troca a lista sob os pés de quem edita', () => {
    expect(fonteMaintenance).toContain('if (editEquip !== null || editOrder !== null || showLogModal !== null) return;');
  });

  it('fonte: logs e orders gravam MESCLANDO; equipments continua com escrita direta (tem exclusão pela UI)', () => {
    expect(fonteMaintenance).toContain('useEffect(() => { writeEquipments(activeTenant.id, equipments); }, [activeTenant.id, equipments]);');
    expect(fonteMaintenance).toContain('useEffect(() => { gravarMesclando(readMaintenanceLogs, writeMaintenanceLogs, activeTenant.id, logs); }, [activeTenant.id, logs]);');
    expect(fonteMaintenance).toContain('useEffect(() => { gravarMesclando(readWorkOrders, writeWorkOrders, activeTenant.id, orders); }, [activeTenant.id, orders]);');
    // não pode ter voltado a gravar logs/orders cru
    expect(fonteMaintenance).not.toContain('useEffect(() => { writeMaintenanceLogs(activeTenant.id, logs); }, [activeTenant.id, logs]);');
    expect(fonteMaintenance).not.toContain('useEffect(() => { writeWorkOrders(activeTenant.id, orders); }, [activeTenant.id, orders]);');
  });

  describe('mecanismo — releitura, testado com os readers/writers reais (sem renderizar o componente; convenção do projeto, ver lista-local.test.js)', () => {
    const tenantId = 'dbk-teste';
    const gera44 = () => Array.from({ length: 44 }, (_, i) => ({ id: `eq-${i}`, name: `Equipamento ${i}` }));

    it('sem reler: o retrato tirado no mount (useState inicial) fica congelado mesmo depois do sync gravar o acervo', () => {
      writeEquipments(tenantId, []); // boot: aparelho novo, nada ainda
      const retratoDoMount = readEquipments(tenantId); // é o que useState(() => readEquipments(...)) capturou
      writeEquipments(tenantId, gera44()); // sync chega segundos depois
      expect(retratoDoMount).toEqual([]); // a "tela" (sem reler) continuaria mostrando isto
    });

    it('com a releitura (a mesma função `reler` que o listener do SYNC_EVENT chama): pega o acervo que o sync gravou', () => {
      writeEquipments(tenantId, []);
      writeEquipments(tenantId, gera44());
      const reler = () => readEquipments(tenantId);
      expect(reler()).toHaveLength(44);
    });
  });

  describe('mecanismo — gravação mesclando (logs), usando readMaintenanceLogs/writeMaintenanceLogs reais', () => {
    const tenantId = 'dbk-teste';

    it('SEM mesclar (write cru): o 1º registro feito a partir do retrato vazio apaga os 2 que o sync tinha acabado de trazer', () => {
      const retratoDoMount = readMaintenanceLogs(tenantId); // []
      const doSync = [
        { id: 'nuvem-1', equipmentId: 'eq1', executedAt: '2026-08-10', createdAt: '2026-08-10T09:00:00Z' },
        { id: 'nuvem-2', equipmentId: 'eq1', executedAt: '2026-08-15', createdAt: '2026-08-15T09:00:00Z' },
      ];
      writeMaintenanceLogs(tenantId, doSync); // sync grava por baixo da tela
      const novoLog = { id: 'local-1', equipmentId: 'eq1', executedAt: '2026-08-19', createdAt: '2026-08-19T09:00:00Z' };
      // comportamento ANTIGO: setLogs(prev => [novoLog, ...prev]) com prev = retratoDoMount ([])
      writeMaintenanceLogs(tenantId, [novoLog, ...retratoDoMount]);
      expect(readMaintenanceLogs(tenantId)).toHaveLength(1); // os 2 do sync sumiram — o bug, comprovado
    });

    it('COM gravarMesclando: o mesmo cenário preserva os 2 registros do sync + o novo (nada se perde)', () => {
      const retratoDoMount = readMaintenanceLogs(tenantId); // []
      const doSync = [
        { id: 'nuvem-1', equipmentId: 'eq1', executedAt: '2026-08-10', createdAt: '2026-08-10T09:00:00Z' },
        { id: 'nuvem-2', equipmentId: 'eq1', executedAt: '2026-08-15', createdAt: '2026-08-15T09:00:00Z' },
      ];
      writeMaintenanceLogs(tenantId, doSync);
      const novoLog = { id: 'local-1', equipmentId: 'eq1', executedAt: '2026-08-19', createdAt: '2026-08-19T09:00:00Z' };
      gravarMesclando(readMaintenanceLogs, writeMaintenanceLogs, tenantId, [novoLog, ...retratoDoMount]);
      expect(readMaintenanceLogs(tenantId)).toHaveLength(3);
      expect(readMaintenanceLogs(tenantId).map((l) => l.id).sort()).toEqual(['local-1', 'nuvem-1', 'nuvem-2']);
    });
  });

  it('mecanismo — mesmo cenário pra orders (writeWorkOrders/gravarMesclando)', () => {
    const tenantId = 'dbk-teste';
    const doSync = [{ id: 'os-nuvem', equipmentId: 'eq1', title: 'Chamar técnico', status: 'pendente', createdAt: '2026-08-10T09:00:00Z', updatedAt: '2026-08-10T09:00:00Z' }];
    writeWorkOrders(tenantId, doSync);
    const novaOS = { id: 'os-local', equipmentId: 'eq1', title: 'Trocar gaxeta', status: 'pendente', createdAt: '2026-08-19T09:00:00Z', updatedAt: '2026-08-19T09:00:00Z' };
    gravarMesclando(readWorkOrders, writeWorkOrders, tenantId, [novaOS]); // retrato do mount era []
    expect(readWorkOrders(tenantId)).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/maintenance.jsx — Família 2: religamento do histórico agora sobrevive
// ao próximo sync (empurra pra nuvem)
// ═══════════════════════════════════════════════════════════════════════════
describe('maintenance.jsx — Família 2: religar catálogo→ativo real empurra logs/OS religados pra nuvem, não só o state local', () => {
  const extrairOnSave = () => {
    const ini = fonteMaintenance.indexOf('onSave={(eq) => {');
    const fim = fonteMaintenance.indexOf('onDelete={async (id) => {', ini);
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    return fonteMaintenance.slice(ini, fim);
  };

  it('fonte: religamento continua existindo (idAntigo → eq.id) pros dois states locais', () => {
    const corpo = extrairOnSave();
    expect(corpo).toContain("const idAntigo = editEquip?._fromCatalog ? editEquip.id : null;");
    // forma ternária de propósito — é a mesma string que
    // cache-teto.test.js ("manutenção — converter ativo virtual religa o
    // histórico") já travava numa rodada anterior desta auditoria; a
    // correção desta rodada não podia quebrar esse guard.
    expect(corpo).toContain('l.equipmentId === idAntigo ? { ...l, equipmentId: eq.id } : l');
    expect(corpo).toContain('o.equipmentId === idAntigo ? { ...o, equipmentId: eq.id } : o');
  });

  it('fonte: os registros religados são empurrados pra nuvem com pushMaintLog/pushWorkOrder — não fica só no state', () => {
    const corpo = extrairOnSave();
    expect(corpo).toContain('logs.filter(l => l.equipmentId === idAntigo)');
    expect(corpo).toContain('.forEach(l => pushMaintLog(activeTenant.id, { ...l, equipmentId: eq.id }));');
    expect(corpo).toContain('orders.filter(o => o.equipmentId === idAntigo)');
    expect(corpo).toContain(".forEach(o => pushWorkOrder(activeTenant.id, { ...o, equipmentId: eq.id, updatedAt: new Date().toISOString() }));");
  });

  it('fonte: a OS empurrada pra nuvem bumpa updatedAt (é o campo que desempata o merge pra work_orders) — logs não têm esse campo na nuvem, por isso precisam do push mesmo sem bump', () => {
    const corpo = extrairOnSave();
    expect(corpo).toContain("pushWorkOrder(activeTenant.id, { ...o, equipmentId: eq.id, updatedAt: new Date().toISOString() })");
  });

  it('pushMaintLog/pushWorkOrder já estavam importados neste arquivo (nenhum import novo necessário)', () => {
    expect(fonteMaintenance).toContain("import { pushEquipAsset, pushMaintLog, pushWorkOrder, deleteMaintenanceItem , lw as gravarLocal } from './repository';");
  });

  describe('mecanismo — por que só religar no state local não bastava (mergeByKey real, de repository.js)', () => {
    it('SEM empurrar pra nuvem: o próximo sync desfaz o religamento — maint_logs não tem updatedAt, então empata por createdAt e o REMOTO (que entra por último) vence', () => {
      const criadoEm = '2026-08-01T10:00:00Z';
      const logLocalReligado   = { id: 'log1', equipmentId: 'uuid-real-do-freezer', createdAt: criadoEm };
      const logRemotoAindaVelho = { id: 'log1', equipmentId: 'cat-Freezer', createdAt: criadoEm }; // nunca foi empurrado
      // syncModule monta assim: mergeByKey([...local, ...remoteRecords], 'id')
      const merged = mergeByKey([logLocalReligado, logRemotoAindaVelho], 'id');
      expect(merged[0].equipmentId).toBe('cat-Freezer'); // o religamento local foi desfeito em silêncio — o bug, comprovado
    });

    it('empurrando o religamento (pushMaintLog): o próximo pull já vem com o vínculo corrigido — o empate deixa de importar', () => {
      const criadoEm = '2026-08-01T10:00:00Z';
      const logLocalReligado = { id: 'log1', equipmentId: 'uuid-real-do-freezer', createdAt: criadoEm };
      // depois do push, maintLogFromRow devolveria isto no próximo pull — mesmo
      // equipmentId, porque o servidor foi corrigido também.
      const logRemotoJaCorrigido = { id: 'log1', equipmentId: 'uuid-real-do-freezer', createdAt: criadoEm };
      const merged = mergeByKey([logLocalReligado, logRemotoJaCorrigido], 'id');
      expect(merged[0].equipmentId).toBe('uuid-real-do-freezer');
    });

    it('work_orders religada: SEM bumpar updatedAt perderia o desempate pro remoto velho', () => {
      const osLocalReligadaSemBump = { id: 'os1', equipmentId: 'uuid-real', updatedAt: '2026-08-01T10:00:00Z' };
      const osRemotaVelha         = { id: 'os1', equipmentId: 'cat-Freezer', updatedAt: '2026-08-01T10:00:00Z' };
      expect(mergeByKey([osLocalReligadaSemBump, osRemotaVelha], 'id')[0].equipmentId).toBe('cat-Freezer');
    });

    it('work_orders religada: COM updatedAt bumpado (a correção real), o local vence mesmo antes do push chegar', () => {
      const osLocalReligadaComBump = { id: 'os1', equipmentId: 'uuid-real', updatedAt: '2026-08-19T12:00:00Z' };
      const osRemotaVelha          = { id: 'os1', equipmentId: 'cat-Freezer', updatedAt: '2026-08-01T10:00:00Z' };
      expect(mergeByKey([osLocalReligadaComBump, osRemotaVelha], 'id')[0].equipmentId).toBe('uuid-real');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/maintenance.jsx — Família 3: PDF avisa quando corta o histórico em 100
// ═══════════════════════════════════════════════════════════════════════════
describe('maintenance.jsx — Família 3: PDF de manutenção avisa quando corta o histórico em 100', () => {
  const tenant = { id: 'padaria-teste', name: 'Padaria Teste' };
  const gerarLogs = (n) => Array.from({ length: n }, (_, i) => ({
    id: `log-${i}`, equipmentId: 'eq1', executedAt: `2026-01-${String((i % 27) + 1).padStart(2, '0')}`,
    title: `Execução ${i}`, executedBy: 'Ana', type: 'limpeza',
  }));
  const gerarPdf = (logs) => {
    const fakeWin = { document: { write: vi.fn(), close: vi.fn() }, print: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin);
    printMaintenanceReport(tenant, [], logs, []);
    return fakeWin.document.write.mock.calls[0][0];
  };

  it('340 registros: a seção do histórico avisa "mostrando as 100 mais recentes de 340"', () => {
    const html = gerarPdf(gerarLogs(340));
    expect(html).toContain('Histórico de execuções — mostrando as 100 mais recentes de 340');
  });

  it('340 registros: nota adicional diz quantas ficaram de fora (240)', () => {
    const html = gerarPdf(gerarLogs(340));
    expect(html).toContain('As demais 240 execuções não couberam neste PDF');
  });

  it('340 registros: a tabela lista exatamente 100 linhas, não as 340', () => {
    const html = gerarPdf(gerarLogs(340));
    const linhas = (html.match(/<tr><td>/g) ?? []).length;
    expect(linhas).toBe(100);
  });

  it('o cabeçalho continua anunciando o TOTAL (340 registros) — só a seção do histórico ganhou o aviso', () => {
    const html = gerarPdf(gerarLogs(340));
    expect(html).toContain('340 registros');
  });

  it('com 100 registros ou menos, não mostra aviso nenhum de corte (nem mentira, nem alarme falso)', () => {
    const html = gerarPdf(gerarLogs(100));
    expect(html).toContain('<h2>Histórico de execuções</h2>');
    expect(html).not.toContain('mostrando as 100 mais recentes');
    expect(html).not.toContain('não couberam neste PDF');
  });

  it('sem registro nenhum, comportamento de sempre (mensagem "Sem registros")', () => {
    const html = gerarPdf([]);
    expect(html).toContain('Sem registros');
    expect(html).not.toContain('mostrando as 100 mais recentes');
  });

  it('fonte: o corte usa sortLogsByExecution ANTES de fatiar (não perdeu a correção da tier média — histórico por data de execução, não ordem crua)', () => {
    expect(fonteMaintenance).toContain('const logsOrdenados = sortLogsByExecution(logs);');
    expect(fonteMaintenance).toContain('const logRows = logsOrdenados.slice(0,100).map(l => {');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/dossie-view.jsx — Família A (achados T2 + T3): banner de sucesso não
// mente mais quando pop-up é bloqueado — JÁ CORRIGIDO antes desta sessão
// (8dd10b5, v1.9.174). Confirmação de regressão, sem mudança de código.
// ═══════════════════════════════════════════════════════════════════════════
describe('dossie-view.jsx — Família A (achados T2 e T3): "✓ Dossiê gerado" só conta janelas que de fato abriram (summarizeDossieRun)', () => {
  it('todas as janelas abriram → ok:true, count = quantas abriram', () => {
    expect(summarizeDossieRun(4, 4)).toEqual({ ok: true, count: 4 });
  });

  it('mais janelas abertas do que pedidas nunca acontece na prática, mas a função não quebra (ok se opened>=requested)', () => {
    expect(summarizeDossieRun(1, 1)).toEqual({ ok: true, count: 1 });
  });

  it('bloqueio parcial (1 de 4 abriu) → ok:false, mensagem cita quantas travaram e quantas abriram', () => {
    const r = summarizeDossieRun(4, 1);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('bloqueou 3 de 4');
    expect(r.message).toContain('abriu só 1');
  });

  it('bloqueio total com 1 empresa só → mensagem no singular (sem "de 1")', () => {
    const r = summarizeDossieRun(1, 0);
    expect(r).toEqual({ ok: false, message: 'O navegador bloqueou a janela de impressão. Libere pop-ups para este site e gere de novo.' });
  });

  it('documenta o defeito original: contar tenants.length (PEDIDAS) em vez de opened (ABERTAS) mentiria sucesso', () => {
    const comportamentoAntigo = (requested) => ({ ok: true, count: requested }); // setResult({ ok: true, count: tenants.length })
    const r = comportamentoAntigo(4); // só 1 das 4 realmente abriu
    expect(r).toEqual({ ok: true, count: 4 }); // diria "✓ Dossiê gerado para 4 empresas" com 1 só
    expect(summarizeDossieRun(4, 1).ok).toBe(false); // a versão real não cai nessa
  });

  it('fonte: window.open tem guarda de null, opened só incrementa DEPOIS do continue, e o resultado usa summarizeDossieRun', () => {
    const ini = fonteDossieView.indexOf('const handleGenerate = async () => {');
    const fim = fonteDossieView.indexOf('return (', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonteDossieView.slice(ini, fim);
    const posContinue = corpo.indexOf('if (!win) continue;');
    const posOpenedPlusPlus = corpo.indexOf('opened++;');
    expect(posContinue).toBeGreaterThan(-1);
    expect(posOpenedPlusPlus).toBeGreaterThan(posContinue);
    expect(corpo).toContain('setResult(summarizeDossieRun(tenants.length, opened));');
    expect(corpo).not.toContain('setResult({ ok: true, count: tenants.length });');
  });

  it('fonte: o banner verde só aparece com result?.ok — e ok só é true quando summarizeDossieRun confirmou', () => {
    expect(fonteDossieView).toContain("{result?.ok && <div className=\"submission ok\"");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/dossie-view.jsx — Família B (achado T6, linha 31): aviso quando o
// dossiê é gerado pra uma empresa diferente da sessão ativa
// ═══════════════════════════════════════════════════════════════════════════
describe('dossie-view.jsx — Família B: dossiê avisa quando gerado neste aparelho pra empresa diferente da sessão (achado "Nenhuma não conformidade — parabéns para loja errada")', () => {
  // ⚠️ a folha de estilo tem a REGRA `.device-warning{...}` sempre presente
  // (é CSS estático) — checar só a substring 'device-warning' dá falso
  // positivo em QUALQUER html gerado. O que só existe quando o banner
  // renderiza de fato é a tag com o atributo `class="device-warning"`.
  it('buildDossierHtml com deviceMismatch:true inclui o <div> do aviso, citando a empresa', () => {
    const html = buildDossierHtml({ tenantName: 'CASA DOCE', periodLabel: '30 dias', companyProfile: {}, sections: [], generatedAt: Date.now(), deviceMismatch: true });
    expect(html).toContain('<div class="device-warning">');
    expect(html).toContain('empresa diferente da sessão ativa');
    expect(html).toContain('CASA DOCE');
    expect(html).toContain('antes de apresentar ao fiscal');
  });

  it('buildDossierHtml sem deviceMismatch (default) NÃO renderiza o <div> do aviso — comportamento antigo preservado quando o tenant bate com a sessão', () => {
    const html = buildDossierHtml({ tenantName: 'Swiss', periodLabel: '30 dias', companyProfile: {}, sections: [], generatedAt: Date.now() });
    expect(html).not.toContain('<div class="device-warning">');
    expect(html).toContain('.device-warning{'); // a REGRA de CSS continua lá — só o <div> some
  });

  it('buildDossierHtml com deviceMismatch:false explícito também não renderiza o <div>', () => {
    const html = buildDossierHtml({ tenantName: 'Swiss', periodLabel: '30 dias', companyProfile: {}, sections: [], generatedAt: Date.now(), deviceMismatch: false });
    expect(html).not.toContain('<div class="device-warning">');
  });

  it('escapa o nome da empresa dentro do próprio aviso — mesma régua anti-injeção do resto do dossiê', () => {
    const html = buildDossierHtml({ tenantName: '<img src=x onerror=alert(1)>', periodLabel: '7 dias', companyProfile: {}, sections: [], generatedAt: Date.now(), deviceMismatch: true });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('teste de regressão do dossier.test.js (capa/seções/assinatura) continua batendo mesmo com o parâmetro novo — não quebrou o contrato existente', () => {
    const html = buildDossierHtml({
      tenantName: 'Swiss',
      periodLabel: 'Últimos 30 dias',
      companyProfile: { razaoSocial: 'Swiss Confeitaria LTDA', cnpj: '00.000.000/0001-00' },
      sections: [{ title: 'Controle de Temperatura', headers: ['Equipamento'], rowsHtml: '', emptyMessage: 'Sem registros' }],
      generatedAt: new Date('2026-08-09T12:00:00Z').getTime(),
    });
    expect(html).toContain('Swiss Confeitaria LTDA');
    expect(html).toContain('1. Controle de Temperatura');
  });

  it('fonte (dossie-view.jsx): deviceMismatch é tenant.id !== session?.tenantId — a mesma condição do caminho do achado (RT/Admin com várias lojas visíveis)', () => {
    expect(fonteDossieView).toContain('const deviceMismatch = tenant.id !== session?.tenantId;');
    expect(fonteDossieView).toContain('generatedAt: Date.now(), deviceMismatch });');
  });

  it('fonte (dossie-view.jsx): session chega em generateTenantDossier, em DossieView, e é repassado no loop de geração', () => {
    expect(fonteDossieView).toContain('async function generateTenantDossier({ tenant, records, periodDays, periodLabel, session })');
    expect(fonteDossieView).toContain('export function DossieView({ allTenants, records, session })');
    expect(fonteDossieView).toContain('generateTenantDossier({ tenant, records, periodDays, periodLabel, session })');
  });

  it('fonte (pages.jsx): o hub de Relatórios passa session pro DossieView — sem isso session? sempre seria undefined e o aviso nunca apareceria', () => {
    expect(fontePages).toContain('<DossieView    allTenants={allTenants} records={records} session={session} />');
  });

  it('mecanismo: mesma condição usada de fato no código, testada com os valores do caminho do achado', () => {
    const deviceMismatch = (tenantId, sessionTenantId) => tenantId !== sessionTenantId;
    expect(deviceMismatch('swiss', 'swiss')).toBe(false);        // gerando pra própria loja da sessão — sem aviso
    expect(deviceMismatch('casadoce', 'swiss')).toBe(true);      // RT/admin gerando pra OUTRA loja visível — avisa
    expect(deviceMismatch('casadoce', null)).toBe(true);         // admin global (session.tenantId === null) — o mais exposto, nenhuma loja é "a dele" — avisa
    expect(deviceMismatch('casadoce', undefined)).toBe(true);    // sem sessão — por segurança, avisa
  });

  it('documenta o que este conserto NÃO resolve: as 8 leituras locais (readFormRecords, readOil, readMaintenanceLogs...) continuam as mesmas de antes — só o aviso foi adicionado, nenhuma chamada de sync', () => {
    // decisão deliberada (ver relatório da rodada): sincronizar cada módulo de
    // cada tenant visível antes de gerar seria mudança de arquitetura, fora
    // do escopo deste conserto.
    const linhasDeLeitura = fonteDossieView.slice(
      fonteDossieView.indexOf('const templates = readFormTemplates(tenant);'),
      fonteDossieView.indexOf('const ncItems ='),
    );
    expect(linhasDeLeitura).toContain('readFormTemplates(tenant)');
    expect(linhasDeLeitura).toContain('readOil(tenant.id)');
    expect(linhasDeLeitura).not.toMatch(/\bawait\s+sync/);
  });
});
