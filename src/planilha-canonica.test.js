import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  lw, ls, saveSupabaseConfig, clearOfflineQueue, getOfflineQueue,
  registrarPlanilhasMovidas, enviarPlanilhasMovidas, syncRecentes,
} from './repository';
import { readFormTemplates, readFormRecords, templateHistory, idsPorLoja } from './forms';
import { unificarCopias, mapaDeCampos, traduzirRespostas } from './planilha-canonica';

// ─────────────────────────────────────────────────────────────────────────────
// Relato da RT (09/11): "o preenchimento das planilhas do Terraço e PKS de
// Higiene Pessoal e Controle Integrado de Vetores e Pragas não está
// sincronizando no meu login, de nenhum dia da semana. O histórico consta como
// sem registros." Cada aparelho sorteava o código da planilha e dos campos.
// ─────────────────────────────────────────────────────────────────────────────

const PKS = { id: 'loja-pks', name: 'FABRIZZIO PKS' };
const TERRACO = { id: 'loja-terraco', name: 'Fabrizzio Terraço' };
const tplKey = (id) => `nutriops.forms.templates.${id}`;
const recKey = (id) => `nutriops.forms.records.${id}`;
const VETORES = 'vetores_pragas::controle integrado de vetores e pragas';
const HIGIENE = 'higiene_pessoal::higiene pessoal dos colaboradores';
const chave = (t) => `${t.category}::${t.title.trim().toLowerCase()}`;
const daChave = (lista, k) => lista.filter((t) => chave(t) === k);
const camposDe = (t) => t.sections.flatMap((s) => s.fields);

// Cópia como o seed antigo gerava: código de planilha e de campo sorteados.
const vetoresSorteada = (sufixo) => ({
  id: `vet-${sufixo}`, category: 'vetores_pragas', frequency: 'daily',
  title: 'Controle Integrado de Vetores e Pragas',
  sections: [{ id: `s-${sufixo}`, title: 'Ocorrências do dia', fields: [
    { id: `abelha-${sufixo}`, label: 'Abelha (A)', type: 'presence' },
    { id: `barata-${sufixo}`, label: 'Barata (B)', type: 'presence' },
    { id: `acao-${sufixo}`, label: 'Ação tomada', type: 'text' },
  ]}],
});
// A Higiene ganhou id fixo em 05/09, mas IGUAL em todas as lojas e com os
// campos ainda sorteados.
const higieneSorteada = (sufixo) => ({
  id: 'a7ce5e0d-4b2e-4b16-9d51-2b3a6a0f9c74', category: 'higiene_pessoal', frequency: 'daily', v: 2,
  title: 'Higiene Pessoal dos Colaboradores',
  sections: [{ id: `h-${sufixo}`, title: 'Verificação', fields: [
    { id: `unif-${sufixo}`, label: 'Uniforme', type: 'cnc' },
    { id: `maos-${sufixo}`, label: 'Lavar Mãos', type: 'cnc' },
  ]}],
});
const registro = (id, formId, periodKey, responses, extra = {}) => ({
  id, tenantId: PKS.id, formId, formTitle: 'x', category: 'vetores_pragas', frequency: 'daily',
  periodKey, responses, status: 'submitted', user: 'Loja', updatedAt: '2026-11-05T15:00:00.000Z', ...extra,
});

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a planilha é a mesma em qualquer aparelho da loja', () => {
  it('dois aparelhos novos geram os mesmos códigos de planilha e de campo', () => {
    const a = readFormTemplates(PKS);
    localStorage.clear();
    const b = readFormTemplates(PKS);
    for (const k of [VETORES, HIGIENE, 'dedetizacao::controle de dedetização']) {
      const [ta] = daChave(a, k), [tb] = daChave(b, k);
      expect(ta.id).toBe(tb.id);
      expect(camposDe(ta).map((f) => f.id)).toEqual(camposDe(tb).map((f) => f.id));
    }
  });

  it('cada loja tem o seu código (na nuvem form_templates é chaveada só por id)', () => {
    const pks = readFormTemplates(PKS);
    const ter = readFormTemplates(TERRACO);
    expect(daChave(pks, HIGIENE)[0].id).not.toBe(daChave(ter, HIGIENE)[0].id);
    expect(daChave(pks, VETORES)[0].id).not.toBe(daChave(ter, VETORES)[0].id);
  });
});

describe('o que já foi preenchido vai junto', () => {
  function computadorDaLoja() {
    lw(tplKey(PKS.id), [vetoresSorteada('loja'), higieneSorteada('loja')]);
    lw(recKey(PKS.id), [
      registro('r-vet', 'vet-loja', '2026-11-05', { 'barata-loja': { detected: true, local: 'Salão' }, 'acao-loja': 'gel aplicado' }),
      registro('r-hig', 'a7ce5e0d-4b2e-4b16-9d51-2b3a6a0f9c74', '2026-11-05', { 'unif-loja': 'C', 'maos-loja': 'NC' }, { category: 'higiene_pessoal' }),
    ]);
  }

  it('no computador da loja: registro passa pra planilha fixa, com as respostas no campo certo', () => {
    computadorDaLoja();
    const tpls = readFormTemplates(PKS);
    const [vet] = daChave(tpls, VETORES), [hig] = daChave(tpls, HIGIENE);
    expect(daChave(tpls, VETORES)).toHaveLength(1);
    expect(daChave(tpls, HIGIENE)).toHaveLength(1);
    expect(idsPorLoja(PKS.id).has(vet.id)).toBe(true);
    expect(idsPorLoja(PKS.id).has(hig.id)).toBe(true);

    const recs = readFormRecords(PKS.id);
    const rv = recs.find((r) => r.id === 'r-vet');
    expect(rv.formId).toBe(vet.id);
    expect(rv.responses).toEqual({ 'vet-barata': { detected: true, local: 'Salão' }, 'vet-acao': 'gel aplicado' });
    expect(rv.updatedAt).toBe('2026-11-05T15:00:00.001Z');   // +1 ms: a data na tela não muda
    expect(recs.find((r) => r.id === 'r-hig').responses).toEqual({ 'hp-uniforme': 'C', 'hp-maos': 'NC' });
    expect(ls(`nutriops.forms.movidos.${PKS.id}`, []).sort()).toEqual(['r-hig', 'r-vet']);
  });

  it('o CASO DA RT: preenchido no computador da loja aparece no histórico do login dela', () => {
    computadorDaLoja();
    readFormTemplates(PKS);
    const subiu = readFormRecords(PKS.id).find((r) => r.id === 'r-vet');

    // Aparelho da RT: tinha a própria cópia sorteada, sem registro nenhum.
    localStorage.clear();
    lw(tplKey(PKS.id), [vetoresSorteada('rt'), higieneSorteada('rt')]);
    readFormTemplates(PKS);
    lw(recKey(PKS.id), [subiu]);                               // chegou pelo sync
    const [vet] = daChave(readFormTemplates(PKS), VETORES);
    const historico = templateHistory(readFormRecords(PKS.id), vet);
    expect(historico.map((r) => r.id)).toEqual(['r-vet']);
    const idsDosCampos = new Set(camposDe(vet).map((f) => f.id));
    expect(Object.keys(historico[0].responses).every((k) => idsDosCampos.has(k))).toBe(true);
  });

  it('roda uma vez só: ler de novo não mexe em nada', () => {
    computadorDaLoja();
    readFormTemplates(PKS);
    const antes = JSON.stringify(readFormRecords(PKS.id));
    readFormTemplates(PKS);
    expect(JSON.stringify(readFormRecords(PKS.id))).toBe(antes);
  });

  it('item da fila com a versão antiga sobe com o código novo', () => {
    computadorDaLoja();
    lw('nutriops.offline.queue', [{ table: 'form_records', operation: 'upsert', payload: { id: 'r-vet', form_id: 'vet-loja' }, _id: 'q1' }]);
    readFormTemplates(PKS);
    const [item] = getOfflineQueue();
    expect(item._id).toBe('q1');
    expect(idsPorLoja(PKS.id).has(item.payload.form_id)).toBe(true);
    expect(item.payload.responses['vet-barata']).toEqual({ detected: true, local: 'Salão' });
  });
});

describe('unificarCopias: os casos de borda', () => {
  const fixa = { id: 'fixa', category: 'vetores_pragas', title: 'Controle Integrado de Vetores e Pragas', sections: [{ id: 's', fields: [
    { id: 'vet-barata', label: 'Barata (B)' }, { id: 'vet-acao', label: 'Ação tomada' },
  ]}] };

  it('período já preenchido na fixa: o registro fica onde está, e a cópia dele também', () => {
    const r = unificarCopias({
      templates: [fixa, vetoresSorteada('a')],
      records: [registro('ja', 'fixa', '2026-11-05', {}), registro('velho', 'vet-a', '2026-11-05', { 'barata-a': 'x' })],
      canonicas: [fixa],
    });
    expect(r.movidos).toEqual([]);
    expect(r.ficaram.map((x) => x.id)).toEqual(['velho']);
    expect(r.templates.map((t) => t.id)).toContain('vet-a');   // não some da tela
  });

  it('planilha editada pela RT (custom) é o destino, não a fixa', () => {
    const editada = { ...vetoresSorteada('rt'), custom: true };
    const r = unificarCopias({
      templates: [editada, vetoresSorteada('loja')],
      records: [registro('r1', 'vet-loja', '2026-11-05', { 'acao-loja': 'gel' })],
      canonicas: [fixa],
    });
    expect(r.templates.map((t) => t.id)).toEqual([editada.id]);
    expect(r.records[0].formId).toBe(editada.id);
    expect(r.records[0].responses).toEqual({ 'acao-rt': 'gel' });
  });

  it('fixa já na lista e editada da RT chegando da nuvem: fica uma só, a editada, com os registros', () => {
    const editada = { ...vetoresSorteada('rt'), custom: true };
    const r = unificarCopias({
      templates: [fixa, editada],
      records: [registro('r1', 'fixa', '2026-11-05', { 'vet-acao': 'gel' })],
      canonicas: [fixa],
    });
    expect(r.templates.map((t) => t.id)).toEqual([editada.id]);
    expect(r.records[0]).toMatchObject({ formId: editada.id, responses: { 'acao-rt': 'gel' } });
  });

  it('resposta de campo sem par no destino fica guardada com a chave antiga', () => {
    const mapa = mapaDeCampos(vetoresSorteada('a'), fixa);
    expect(traduzirRespostas({ 'barata-a': 1, 'abelha-a': 2 }, mapa)).toEqual({ 'vet-barata': 1, 'abelha-a': 2 });
  });

  it('sem cópia sorteada, nada muda', () => {
    const r = unificarCopias({ templates: [fixa], records: [], canonicas: [fixa] });
    expect(r.mudou).toBe(false);
  });
});

describe('na nuvem, a linha é atualizada no lugar', () => {
  const resposta = (status, corpo = '') => Promise.resolve({ ok: status < 300, status, text: () => Promise.resolve(corpo) });
  const movido = registro('r-vet', 'fixa-pks', '2026-11-05', { 'vet-acao': 'gel' });

  beforeEach(() => {
    lw(recKey(PKS.id), [movido]);
    registrarPlanilhasMovidas(PKS.id, [movido]);
  });

  it('sobe pela chave primária (sem on_conflict), e sai da lista', async () => {
    const fetchMock = vi.fn(() => resposta(201));
    vi.stubGlobal('fetch', fetchMock);
    expect(await enviarPlanilhasMovidas(PKS.id)).toEqual({ enviados: 1, pendentes: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/form_records');
    expect(url).not.toContain('on_conflict');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).form_id).toBe('fixa-pks');
    expect(ls(`nutriops.forms.movidos.${PKS.id}`, [])).toEqual([]);
  });

  it('outro aparelho já tem o período: vai pra fila (que funde) e a linha velha é apagada', async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(resposta(409, '{"code":"23505","message":"duplicate key value violates unique constraint"}'))
      .mockReturnValueOnce(resposta(204));
    vi.stubGlobal('fetch', fetchMock);
    expect(await enviarPlanilhasMovidas(PKS.id)).toEqual({ enviados: 1, pendentes: 0 });
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[1][0]).toContain('id=eq.r-vet');
    expect(getOfflineQueue().map((i) => i.payload.form_id)).toEqual(['fixa-pks']);
  });

  it('falha de rede ou servidor: continua na lista pra próxima vez', async () => {
    vi.stubGlobal('fetch', vi.fn(() => resposta(500, 'erro')));
    expect(await enviarPlanilhasMovidas(PKS.id)).toEqual({ enviados: 0, pendentes: 1 });
    expect(ls(`nutriops.forms.movidos.${PKS.id}`, [])).toEqual(['r-vet']);
  });

  it('o sync periódico leva antes de descarregar a fila', async () => {
    const fetchMock = vi.fn(() => resposta(200, '[]'));
    vi.stubGlobal('fetch', fetchMock);
    await syncRecentes(PKS.id);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(url).not.toContain('on_conflict');
    expect(JSON.parse(init.body).id).toBe('r-vet');
  });
});
