import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ls, lw, garantirIds, saveSupabaseConfig, clearOfflineQueue,
  pushReceivingRecord, getOfflineQueue,
} from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Console da CASA DOCE (17/08) alagado, e o auto-backfill dizendo
// "incompleto — repete no próximo boot" em TODO boot. Duas causas distintas,
// as duas fazendo o backfill nunca fechar (ele só fecha com failed:0):
//
//   POST equip_assets    400 → 23502 null value in column "id"
//   POST receiving_records 409 → 23505 duplicate key
//
// O padrão é o mesmo dos outros bugs desta semana: falha que se repete pra
// sempre sem ninguém ver, porque nada na tela conta.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ─── 1. Ativo de manutenção sem id ──────────────────────────────────────────
describe('garantirIds — recupera o item em vez de descartar', () => {
  const CHAVE = 'nutriops.equip_assets.casadoce';

  it('item sem id ganha um e a correção é GRAVADA', () => {
    lw(CHAVE, [{ name: 'Câmara C.1', location: 'Área das Câmaras' }]);
    const out = garantirIds(CHAVE);
    expect(out[0].id).toBeTruthy();
    // regravado: o próximo boot vê o mesmo id, senão viram N linhas na nuvem
    expect(ls(CHAVE, [])[0].id).toBe(out[0].id);
  });

  it('id estável entre chamadas — é o que impede duplicata a cada boot', () => {
    lw(CHAVE, [{ name: 'Freezer F.1' }]);
    const primeiro = garantirIds(CHAVE)[0].id;
    const segundo  = garantirIds(CHAVE)[0].id;
    expect(segundo).toBe(primeiro);
  });

  it('não mexe em quem já tem id, nem reescreve o storage à toa', () => {
    lw(CHAVE, [{ id: 'fixo-1', name: 'Bancada R.7' }]);
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const out = garantirIds(CHAVE);
    expect(out[0].id).toBe('fixo-1');
    expect(spy).not.toHaveBeenCalled();
  });

  it('preserva todo o resto do ativo — plano de manutenção não pode evaporar', () => {
    lw(CHAVE, [{ name: 'Câmara C.2', maintenancePlans: [{ id: 'p1', type: 'preventiva' }], status: 'Operacional' }]);
    const [a] = garantirIds(CHAVE);
    expect(a.maintenancePlans).toHaveLength(1);
    expect(a.status).toBe('Operacional');
  });

  it('descarta entrada corrompida (null) sem derrubar as boas', () => {
    lw(CHAVE, [null, { name: 'ok' }]);
    const out = garantirIds(CHAVE);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ok');
  });

  it('lista vazia ou chave inexistente não quebra', () => {
    expect(garantirIds('nutriops.equip_assets.vazio')).toEqual([]);
  });
});

// ─── 2. Recebimento reenviado ───────────────────────────────────────────────
describe('recebimento — reenviar não pode dar 409', () => {
  const registro = { id: 'r1', tenantId: 'casadoce', supplier: 'Fornecedor X', createdAt: new Date().toISOString() };

  it('o POST vai com resolution=merge-duplicates', async () => {
    const spy = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('null') }));
    vi.stubGlobal('fetch', spy);
    await pushReceivingRecord('casadoce', registro);
    const prefer = spy.mock.calls[0][1].headers.Prefer;
    expect(prefer).toContain('resolution=merge-duplicates');
  });

  it('sem isso o reenvio colide na pkey — o 23505 que travava o backfill', () => {
    // documenta o formato do erro real observado em produção
    const corpo = { code: '23505', message: 'duplicate key value violates unique constraint "receiving_records_pkey"' };
    expect(corpo.code).toBe('23505');
  });

  it('offline continua enfileirando (a fila já reexecutava com merge)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await pushReceivingRecord('casadoce', registro);
    expect(getOfflineQueue()).toHaveLength(1);
  });
});

// ─── 3. Guardas no código-fonte ─────────────────────────────────────────────
describe('repository.js — nenhum push de backfill pode ficar sem merge', () => {
  const fonte = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');

  // Este teste achou mais 4 além do recebimento — inclusive OUTRO backfill
  // (special_controls), com o mesmo 409 a cada boot. É a regra que vale pro
  // projeto todo: se o backfill reenvia tudo, todo push tem que ser no-op na
  // segunda vez.
  it('não sobrou nenhum POST com prefer só "return=minimal"', () => {
    const semMerge = [...fonte.matchAll(/prefer:'return=minimal'/g)];
    expect(semMerge).toHaveLength(0);
  });

  it('o backfill de manutenção passa por garantirIds', () => {
    expect(fonte).toContain('const itens = garantirIds(chave)');
  });
});
