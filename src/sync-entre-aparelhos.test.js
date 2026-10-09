import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  lw, ls, saveSupabaseConfig, clearOfflineQueue, getOfflineQueue,
  syncRecentes, juntarFilaRestante, ALVO_DE_CONFLITO_NA_FILA, supabaseRepository,
} from './repository';
import { fundirRespostas, fundirStatus, maisRecente, umPorPeriodo, respostaVazia } from './planilha-fusao';
import { readFormRecords, writeFormRecords } from './forms';
import { seedSavedValuesFromToday } from './kiosk';
import { turnoAtual } from './turns';

// ─────────────────────────────────────────────────────────────────────────────
// Relato da RT da CASA DOCE (09/10), quatro sintomas, uma família:
//   · "na Confeitaria, quando entra às 16:20 para registrar a temperatura, os
//     equipamentos ficam com os dois vistos como se já estivessem preenchidos";
//   · "planilha com itens já dados como feitos, no outro dia aparece como não
//     feito" (Terraço);
//   · "o recebimento de mercadorias não está sincronizando para os outros
//     computadores, somente consta no computador que está fazendo o registro";
//   · leitura registrada que "não consta no sistema".
// ─────────────────────────────────────────────────────────────────────────────

const LOJA = 'cd-terraco';

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const resposta = (corpo) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(corpo)), json: () => Promise.resolve(corpo) });

// ─── 1. Quiosque: ✓✓ por turno ──────────────────────────────────────────────
describe('quiosque: o ✓✓ vale para o turno, não para o dia', () => {
  const TURNOS = [
    { id: 'manha', name: 'Manhã', start: '07:00', end: '14:59' },
    { id: 'tarde', name: 'Tarde', start: '15:00', end: '22:00' },
  ];
  const as = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  const leitura = (equipment, h, m, value) => ({ equipment, value, createdAt: as(h, m).toISOString() });

  it('16:20: a leitura das 08:00 NÃO marca o equipamento (o caso da Confeitaria)', () => {
    const recs = [leitura('Vitrine Confeitaria', 8, 0, 4)];
    expect(seedSavedValuesFromToday(recs, as(16, 20).getTime(), TURNOS)).toEqual({});
  });

  it('16:20: a leitura das 15:30 marca', () => {
    const recs = [leitura('Vitrine Confeitaria', 8, 0, 4), leitura('Vitrine Confeitaria', 15, 30, 5)];
    expect(seedSavedValuesFromToday(recs, as(16, 20).getTime(), TURNOS)).toEqual({ 'Vitrine Confeitaria': 5 });
  });

  it('10:00: a leitura das 07:30 marca (mesmo turno)', () => {
    expect(seedSavedValuesFromToday([leitura('Freezer', 7, 30, -18)], as(10, 0).getTime(), TURNOS)).toEqual({ Freezer: -18 });
  });

  it('fora de qualquer turno (23:00): continua valendo o dia, como antes', () => {
    expect(seedSavedValuesFromToday([leitura('Freezer', 21, 0, -18)], as(23, 0).getTime(), TURNOS)).toEqual({ Freezer: -18 });
  });

  it('sem turnos informados: comportamento antigo (o dia)', () => {
    expect(seedSavedValuesFromToday([leitura('Freezer', 8, 0, -18)], as(16, 20).getTime())).toEqual({ Freezer: -18 });
  });

  it('turnoAtual: mesma conta do alerta de turno (fim inclusivo)', () => {
    expect(turnoAtual(TURNOS, as(14, 59))?.id).toBe('manha');
    expect(turnoAtual(TURNOS, as(15, 0))?.id).toBe('tarde');
    expect(turnoAtual(TURNOS, as(15, 0)).inicioMs).toBe(as(15, 0).getTime());
    expect(turnoAtual(TURNOS, as(23, 0))).toBeNull();
  });

  it('a tela zera os ✓✓ quando o turno vira com o tablet aberto', () => {
    const k = readFileSync(`${process.cwd()}/src/kiosk.jsx`, 'utf8');
    expect(k).toContain('useEffect(() => { setSavedValues({}); }, [turnoChave]);');
    expect(k).toContain('setTurnoChave(chaveDoTurno(config.tenantId));');
    expect(k).toContain("seedSavedValuesFromToday(recs, Date.now(), readTurns({ id: config.tenantId }))");
    expect(k).toContain('}, [config.tenantId, repository, catalog, semente, turnoChave]);');
  });
});

// ─── 2. Planilha: o último a salvar não apaga o outro ──────────────────────
describe('planilha preenchida em dois aparelhos', () => {
  it('o computador com a cópia da manhã não apaga o item que o tablet marcou', () => {
    const base = { limpezaPiso: true };                                  // o que o computador viu ao abrir
    const minhas = { limpezaPiso: true, limpezaBancada: true };          // ele marca a bancada
    const daNuvem = { limpezaPiso: true, limpezaCoifa: true };           // o tablet marcou a coifa
    expect(fundirRespostas(base, minhas, daNuvem)).toEqual({ limpezaPiso: true, limpezaBancada: true, limpezaCoifa: true });
  });

  it('desmarcar de propósito continua valendo (é mudança de quem salva)', () => {
    expect(fundirRespostas({ limpezaPiso: true }, { limpezaPiso: false }, { limpezaPiso: true })).toEqual({ limpezaPiso: false });
  });

  it('os dois mexeram no mesmo campo: vence quem salva por último (como antes)', () => {
    expect(fundirRespostas({ obs: '' }, { obs: 'trocado o pano' }, { obs: 'ok' })).toEqual({ obs: 'trocado o pano' });
  });

  it('carimbo "Feito agora" de outro aparelho sobrevive', () => {
    const sig = { date: '2026-10-09T15:00:00Z', sig: 'Ana' };
    expect(fundirRespostas({}, { a: true }, { b: sig })).toEqual({ a: true, b: sig });
  });

  it('campo apagado e nunca tocado são o mesmo vazio', () => {
    expect(respostaVazia(undefined)).toBe(true);
    expect(respostaVazia('')).toBe(true);
    expect(respostaVazia(false)).toBe(true);
    expect(respostaVazia({ date: '', sig: '' })).toBe(true);
    expect(respostaVazia(0)).toBe(false);
    expect(respostaVazia({ date: 'x' })).toBe(false);
  });

  it('rascunho com a cópia velha não rebaixa a folha que o outro aparelho confirmou', () => {
    expect(fundirStatus('draft', 'draft', 'submitted')).toBe('submitted');
    expect(fundirStatus(undefined, 'draft', 'submitted')).toBe('submitted');
  });

  it('quem viu "confirmada" e voltou pra rascunho de propósito: vale o rascunho', () => {
    expect(fundirStatus('submitted', 'draft', 'submitted')).toBe('draft');
  });

  it('folha nova (nada na nuvem): fica o status de quem salva', () => {
    expect(fundirStatus(undefined, 'draft', undefined)).toBe('draft');
  });

  it('maisRecente escolhe por updatedAt', () => {
    const a = { id: 'a', updatedAt: '2026-10-09T10:00:00Z' }, b = { id: 'b', updatedAt: '2026-10-09T15:00:00Z' };
    expect(maisRecente(a, b)).toBe(b);
    expect(maisRecente(null, a)).toBe(a);
    expect(maisRecente(null, null)).toBeNull();
  });
});

describe('um registro por planilha e período no aparelho', () => {
  const velho = { id: 'meu', formId: 'f1', periodKey: '2026-10-09', status: 'draft', updatedAt: '2026-10-09T09:00:00Z' };
  const novo  = { id: 'da-nuvem', formId: 'f1', periodKey: '2026-10-09', status: 'submitted', updatedAt: '2026-10-09T15:00:00Z' };
  const outro = { id: 'x', formId: 'f2', periodKey: '2026-10-09', updatedAt: '2026-10-09T08:00:00Z' };

  it('duas cópias do mesmo período: fica a mais nova, na ordem original', () => {
    expect(umPorPeriodo([velho, outro, novo])).toEqual([outro, novo]);
  });

  it('a tela pegava a cópia velha (primeira da lista) e mostrava a folha como não feita', () => {
    writeFormRecords(LOJA, [velho, novo]);
    const lidos = readFormRecords(LOJA);
    expect(lidos.find((r) => r.formId === 'f1' && r.periodKey === '2026-10-09').status).toBe('submitted');
  });

  it('a gravação converge: a cópia perdedora sai do aparelho', () => {
    writeFormRecords(LOJA, [velho, novo]);
    expect(JSON.parse(localStorage.getItem(`nutriops.forms.records.${LOJA}`)).map((r) => r.id)).toEqual(['da-nuvem']);
  });
});

describe('o salvar da planilha usa a fusão', () => {
  const f = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

  it('preenchimento normal: busca a nuvem e funde antes de enviar', () => {
    const corpo = f.slice(f.indexOf('const handleSave = useCallback(async'), f.indexOf('const handleValidate = useCallback'));
    expect(corpo).toContain('await buscarFormRecordNaNuvem(activeTenant.id, template.id, via.periodKey)');
    expect(corpo).toContain('fundirRespostas(base, via.responses, outra.responses)');
    expect(corpo).toContain('fundirStatus(baseStatus, status, outra?.status)');
    expect(corpo).toContain('id: daNuvem?.id ?? doAparelho?.id ?? uid()');
    expect(corpo.indexOf('buscarFormRecordNaNuvem')).toBeLessThan(corpo.indexOf('pushFormRecord(activeTenant.id, up)'));
  });

  it('modo tablet: mesma fusão', () => {
    const corpo = f.slice(f.indexOf('onSave={async (responses, status = \'submitted\') => {'), f.indexOf('onSave={async (responses, status = \'submitted\') => {') + 2500);
    expect(corpo).toContain('await buscarFormRecordNaNuvem(activeTenant.id, template.id, periodKey)');
    expect(corpo).toContain('fundirRespostas(record?.responses ?? {}, responses, outra.responses)');
  });
});

// ─── 3. Fila de envio ───────────────────────────────────────────────────────
describe('fila de envio deste aparelho', () => {
  it('item que entrou na fila DURANTE a descarga não é apagado', () => {
    const a = { table: 'temperature_records', payload: { id: '1' }, _at: 't1' };
    const b = { table: 'temperature_records', payload: { id: '2' }, _at: 't2' };
    const chegou = { table: 'temperature_records', payload: { id: '3' }, _at: 't3' };
    // a descarga leu [a, b]; a falhou, b subiu; enquanto isso chegou o 3
    const filaAgora = JSON.parse(JSON.stringify([a, b, chegou]));
    expect(juntarFilaRestante([a, b], [a], filaAgora)).toEqual([a, chegou]);
  });

  it('planilha na fila vai com o alvo de conflito (tenant, planilha, período)', () => {
    expect(ALVO_DE_CONFLITO_NA_FILA.form_records).toBe('on_conflict=tenant_id,form_id,period_key');
  });

  it('a descarga manda o alvo de conflito no POST da planilha', async () => {
    const spy = vi.fn(() => resposta(null));
    vi.stubGlobal('fetch', spy);
    lw('nutriops.offline.queue', [{ table: 'form_records', operation: 'upsert', payload: { id: 'p1', tenant_id: LOJA, form_id: 'f1', period_key: '2026-10-09' }, _at: 't' }]);
    expect(getOfflineQueue()).toHaveLength(1);
    await supabaseRepository.syncQueue();
    expect(spy.mock.calls[0][0]).toContain('on_conflict=tenant_id,form_id,period_key');
    expect(getOfflineQueue()).toEqual([]);
  });

  it('duas descargas ao mesmo tempo viram uma só', async () => {
    let chamadas = 0;
    vi.stubGlobal('fetch', vi.fn(() => { chamadas++; return resposta(null); }));
    lw('nutriops.offline.queue', [{ table: 'receiving_records', operation: 'insert', payload: { id: 'r1', tenant_id: LOJA }, _at: 't' }]);
    expect(getOfflineQueue()).toHaveLength(1);
    await Promise.all([supabaseRepository.syncQueue(), supabaseRepository.syncQueue()]);
    expect(chamadas).toBe(1);
  });
});

// ─── 4. Sync leve periódico ─────────────────────────────────────────────────
describe('recebimento e planilhas chegam nos outros aparelhos sem reabrir o app', () => {
  it('traz o recebimento feito no outro computador e avisa que mudou', async () => {
    const urls = [];
    vi.stubGlobal('fetch', vi.fn((url) => {
      urls.push(url);
      if (url.includes('/receiving_records')) {
        return resposta([{ id: 'rec-outro-pc', tenant_id: LOJA, produto: 'Leite', resultado: 'aceito', created_at: '2026-10-09T13:00:00Z' }]);
      }
      return resposta([]);
    }));
    const r = await syncRecentes(LOJA, { agora: Date.parse('2026-10-09T14:00:00Z') });
    expect(r.mudou).toBe(true);
    expect(ls(`nutriops.receiving.${LOJA}`, []).map((x) => x.id)).toEqual(['rec-outro-pc']);
    // só a janela recente, não as 1000 linhas do boot
    expect(urls.find((u) => u.includes('/receiving_records'))).toContain('created_at=gte.2026-10-07T14:00:00.000Z');
    expect(urls.find((u) => u.includes('/form_records'))).toContain('updated_at=gte.2026-10-07T14:00:00.000Z');
  });

  it('nada novo: não avisa (as telas não releem à toa)', async () => {
    lw(`nutriops.receiving.${LOJA}`, [{ id: 'r1', tenantId: LOJA, createdAt: '2026-10-09T13:00:00Z' }]);
    vi.stubGlobal('fetch', vi.fn((url) => resposta(url.includes('/receiving_records')
      ? [{ id: 'r1', tenant_id: LOJA, created_at: '2026-10-09T13:00:00Z' }] : [])));
    const r = await syncRecentes(LOJA);
    expect(r.mudou).toBe(false);
  });

  it('sem nuvem configurada: não faz nada', async () => {
    saveSupabaseConfig({ url: '', anonKey: '', enabled: false });
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect((await syncRecentes(LOJA)).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('o App chama a cada 2 min, ao voltar o foco, e avisa as telas só quando mudou', () => {
    const p = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
    const ini = p.indexOf('const tenantDoSyncLeve');
    const efeito = p.slice(ini, p.indexOf('}, [tenantDoSyncLeve]);', ini));
    expect(efeito).toContain('await syncRecentes(tenantDoSyncLeve)');
    expect(efeito).toContain("if (r.mudou) notificarSyncAplicado(");
    expect(efeito).toContain('setInterval(atualizar, 120000)');
    expect(efeito).toContain("window.addEventListener('focus', atualizar)");
    expect(efeito).toContain("document.visibilityState !== 'visible'");
  });

  it('a tela de Recebimento relê quando o sync avisa', () => {
    const p = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
    const tela = p.slice(p.indexOf('function RecebimentoView('), p.indexOf('// ─── Offline Indicator'));
    expect(tela).toContain('window.addEventListener(SYNC_EVENT, reler)');
  });
});
