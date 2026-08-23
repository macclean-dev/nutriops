import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localRepository, supabaseRepository, saveSupabaseConfig, lw, ls, tmplToRow, tmplFromRow, syncProducts, getSupabaseAuthError, countAllLocalRecords, migrateAllToSupabase, SUPABASE_SQL } from './repository';

const RECORDS_KEY = 'nutriops.temperature.records';

beforeEach(() => {
  localStorage.clear();
  saveSupabaseConfig({ url: 'https://fake.supabase.co', anonKey: 'anon-fake', enabled: true });
});

describe('localRepository.list', () => {
  const now = Date.now();
  const DAY = 86400000;

  it('days>0 filtra por tenant e por corte de data', () => {
    lw(RECORDS_KEY, [
      { id: 'a', tenantId: 'swiss', createdAt: new Date(now - 5 * DAY).toISOString() },
      { id: 'b', tenantId: 'swiss', createdAt: new Date(now - 100 * DAY).toISOString() },
      { id: 'c', tenantId: 'outra', createdAt: new Date(now - 1 * DAY).toISOString() },
    ]);
    return localRepository.list({ tenantId: 'swiss', days: 90 }).then((rows) => {
      expect(rows.map((r) => r.id)).toEqual(['a']);
    });
  });

  it('days<=0 (item 14, "Todos") não corta por data — devolve tudo do tenant', () => {
    lw(RECORDS_KEY, [
      { id: 'a', tenantId: 'swiss', createdAt: new Date(now - 5 * DAY).toISOString() },
      { id: 'b', tenantId: 'swiss', createdAt: new Date(now - 900 * DAY).toISOString() },
      { id: 'c', tenantId: 'outra', createdAt: new Date(now - 1 * DAY).toISOString() },
    ]);
    return localRepository.list({ tenantId: 'swiss', days: 0 }).then((rows) => {
      expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
    });
  });
});

describe('supabaseRepository.list — paginação do "Todos" (item 14)', () => {
  function mockFetchPages(pageSizes) {
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      const size = pageSizes[call] ?? 0;
      call += 1;
      const rows = Array.from({ length: size }, (_, i) => ({ id: `r${call}-${i}`, tenant_id: 'swiss', created_at: new Date().toISOString() }));
      return { ok: true, text: async () => JSON.stringify(rows) };
    });
    return () => call;
  }

  it('days>0 faz UMA chamada só, com filtro de data e sem offset', async () => {
    const getCalls = mockFetchPages([3]);
    await supabaseRepository.list({ tenantId: 'swiss', days: 90 });
    expect(getCalls()).toBe(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('created_at=gte.');
    expect(url).not.toContain('offset=');
  });

  it('days<=0 com uma página incompleta para na primeira chamada', async () => {
    const getCalls = mockFetchPages([250]);
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 0 });
    expect(getCalls()).toBe(1);
    expect(rows).toHaveLength(250);
    expect(global.fetch.mock.calls[0][0]).not.toContain('created_at=gte.');
  });

  it('days<=0 pagina até a página vir incompleta, concatenando tudo', async () => {
    const getCalls = mockFetchPages([1000, 1000, 400]);
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 0 });
    expect(getCalls()).toBe(3);
    expect(rows).toHaveLength(2400);
    const offsets = global.fetch.mock.calls.map((c) => new URL(c[0]).searchParams.get('offset'));
    expect(offsets).toEqual(['0', '1000', '2000']);
  });

  it('days<=0 respeita o teto de segurança de páginas mesmo se todas vierem cheias', async () => {
    const getCalls = mockFetchPages(Array(30).fill(1000));
    const rows = await supabaseRepository.list({ tenantId: 'swiss', days: 0 });
    expect(getCalls()).toBe(20); // MAX_PAGES
    expect(rows).toHaveLength(20000);
  });
});

describe('tmplToRow/tmplFromRow — custom/v sobrevivem ao round-trip com a nuvem', () => {
  it('tmplToRow inclui custom/v', () => {
    const row = tmplToRow({ id: 't1', category: 'faxina', frequency: 'daily', title: 'X', sections: [], custom: true, v: 3 }, 'swiss');
    expect(row.custom).toBe(true);
    expect(row.v).toBe(3);
  });

  it('template sem custom/v (nunca editado) grava default seguro', () => {
    const row = tmplToRow({ id: 't1', category: 'faxina', frequency: 'daily', title: 'X', sections: [] }, 'swiss');
    expect(row.custom).toBe(false);
    expect(row.v).toBe(0);
  });

  it('tmplFromRow devolve custom/v da linha da nuvem', () => {
    const tpl = tmplFromRow({ id: 't1', category: 'faxina', frequency: 'daily', title: 'X', sections: [], custom: true, v: 3, updated_at: '2026-08-10T00:00:00Z' });
    expect(tpl.custom).toBe(true);
    expect(tpl.v).toBe(3);
  });

  it('linha antiga da nuvem (de antes da migração, sem as colunas) não quebra e assume default', () => {
    const tpl = tmplFromRow({ id: 't1', category: 'faxina', frequency: 'daily', title: 'X', sections: [], updated_at: '2026-08-10T00:00:00Z' });
    expect(tpl.custom).toBe(false);
    expect(tpl.v).toBe(0);
  });

  it('round-trip completo preserva a edição da RT (regressão do bug encontrado em 10/08)', () => {
    const editado = { id: 't1', category: 'faxina', frequency: 'daily', title: 'X', sections: [{ id: 's1', fields: [] }], custom: true, v: 4, updatedAt: '2026-08-10T00:00:00Z' };
    const devolta = tmplFromRow(tmplToRow(editado, 'swiss'));
    expect(devolta.custom).toBe(true);
    expect(devolta.v).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Classificação do 401 — incidente CASA DOCE (15/08). O banner tratava todo
// 401 como "chave do Supabase inválida" e mandava o dono rotacionar uma chave
// perfeitamente boa. Um 401 com o JWT do usuário é sessão expirando (se cura
// no próximo refresh); só com a anon key é a chave que está podre.
// ─────────────────────────────────────────────────────────────────────────────
describe('markSupabaseAuthError — separa sessão expirando de chave podre', () => {
  beforeEach(() => {
    localStorage.clear();
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const nega401 = () => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: false, status: 401, text: () => Promise.resolve('{"message":"JWT expired"}'),
  })));

  it('SEM sessão (cai na anon key) ⇒ kind "anon" — é a chave mesmo', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    nega401();
    await syncProducts('swiss').catch(() => {});
    expect(getSupabaseAuthError()).toMatchObject({ status: 401, kind: 'anon' });
  });

  it('COM sessão do membro (usa JWT) ⇒ kind "session" — é a sessão expirando', async () => {
    localStorage.setItem('nutriops.session', JSON.stringify({
      tenantId: 'swiss', accessToken: 'jwt-x', user: { name: 'Ana' },
    }));
    localStorage.setItem('nutriops.auth.session', JSON.stringify({
      accessToken: 'jwt-x', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, user: { name: 'Ana' },
    }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    nega401();
    await syncProducts('swiss').catch(() => {});
    expect(getSupabaseAuthError()).toMatchObject({ status: 401, kind: 'session' });
  });

  it('conta falhas SEGUIDAS do mesmo tipo — o banner de sessão só acende se insistir', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    nega401();
    await syncProducts('swiss').catch(() => {});
    expect(getSupabaseAuthError().falhas).toBe(1);
    await syncProducts('swiss').catch(() => {});
    expect(getSupabaseAuthError().falhas).toBe(2);
  });

  it('o marcador interno _comJwt NUNCA vai no header da requisição', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('[]') }));
    vi.stubGlobal('fetch', fetchMock);
    await syncProducts('swiss');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers).not.toHaveProperty('_comJwt');
    expect(opts.headers.apikey).toBe('anon123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Escopo do auto-backfill — incidente CASA DOCE (16/08, 01h). O CALL SITE em
// pages.jsx passava `activeTenants` (TODAS as lojas do device) em vez da
// lista que a sessão alcança. Uma sessão de loja única tentava empurrar dado
// das outras três; RLS recusava (42501 — corretamente, é isolamento entre
// lojas), o backfill nunca fechava com failed:0, nunca marcava "done", e
// repetia a cada boot pra sempre — POST 401 em loop no console.
//
// migrateAllToSupabase/countAllLocalRecords em si sempre respeitaram o array
// recebido; estes testes travam esse contrato pra que um call site futuro não
// reintroduza o mesmo bug passando a lista errada.
// ─────────────────────────────────────────────────────────────────────────────
describe('countAllLocalRecords — só conta o que está na lista recebida', () => {
  beforeEach(() => localStorage.clear());

  it('ignora dado local de tenant que NÃO está na lista passada', () => {
    lw('nutriops.forms.records.swiss', [{ id: 'a' }, { id: 'b' }]);
    lw('nutriops.forms.records.casadoce', [{ id: 'c' }]);
    // só a CASA DOCE alcançável — Swiss existe no device mas não na sessão
    expect(countAllLocalRecords([{ id: 'casadoce' }])).toBe(1);
  });

  it('lista vazia (sessão sem nenhuma loja alcançável) conta 0, não estoura', () => {
    lw('nutriops.forms.records.swiss', [{ id: 'a' }]);
    expect(countAllLocalRecords([])).toBe(0);
    expect(countAllLocalRecords(undefined)).toBe(0);
  });
});

describe('migrateAllToSupabase — só empurra as lojas recebidas (isolamento)', () => {
  beforeEach(() => { localStorage.clear(); saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true }); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('não tenta gravar tenant_id de fora da lista, mesmo com dado local presente', async () => {
    // `value` presente e válido de propósito: a triagem de 19/08 ensinou
    // migrateAllToSupabase a pular temperatura com value não-finito (mesma
    // guarda de purgarFilaEnvenenada) — sem isto aqui, o fixture parecia
    // "envenenado" só por omissão e o teste media a guarda nova, não o
    // isolamento por tenant que é o assunto deste describe.
    lw('nutriops.temperature.records', [
      { id: 't1', tenantId: 'casadoce', value: -18, createdAt: '2026-08-01T10:00:00.000Z' },
      { id: 't2', tenantId: 'swiss',    value: -18, createdAt: '2026-08-01T10:00:00.000Z' },
    ]);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('null') }));
    vi.stubGlobal('fetch', fetchMock);

    // sessão só alcança CASA DOCE — mesmo cenário do incidente
    const r = await migrateAllToSupabase([{ id: 'casadoce', name: 'CASA DOCE' }]);

    expect(r.pushed).toBe(1);                 // só o registro da CASA DOCE
    const tenantIdsEnviados = fetchMock.mock.calls.map(([, opts]) => JSON.parse(opts.body).tenant_id);
    expect(tenantIdsEnviados).not.toContain('swiss');   // ✅ nunca tentou a Swiss
  });

  it('lista vazia não faz nenhuma chamada de rede — sem loop de 401', async () => {
    lw('nutriops.temperature.records', [{ id: 't1', tenantId: 'swiss', createdAt: '2026-08-01T10:00:00.000Z' }]);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('null') }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await migrateAllToSupabase([]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.pushed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE_SQL — o bloco que a tela de Configurações exibe pro usuário COPIAR
// e rodar no Supabase. Até 16/08/2026 ele trazia a policy de 2 caminhos: quem
// copiasse e rodasse REBAIXAVA o banco, trancando as lojas que entram por
// vínculo (tenant_members). Foi assim que a CASA DOCE perdeu acesso aos
// próprios 108 registros — dado intacto, tela zerada, 401/42501 em loop.
// Fonte de verdade: docs/rls-policies.sql.
// ─────────────────────────────────────────────────────────────────────────────
describe('SUPABASE_SQL — não pode rebaixar as policies do banco', () => {
  it('toda policy tenant_isolation tem os 3 caminhos de acesso', () => {
    // Eram 4 até 21/08. O caminho '__healthcheck__' saiu daqui e passou a
    // valer SÓ na temperature_records, escopado (teste abaixo): a sonda do
    // boot só escreve nessa tabela, e nas outras 19 o caminho era escrita de
    // linha arbitrária liberada pra qualquer conta autenticada, sem uso nenhum.
    const criacoes = SUPABASE_SQL.split('create policy tenant_isolation').slice(1);
    expect(criacoes.length).toBeGreaterThanOrEqual(8);   // as tabelas do núcleo
    for (const bloco of criacoes) {
      const corpo = bloco.split(';')[0];
      expect(corpo).toContain('app_metadata');            // 1. conta presa à loja
      expect(corpo).toContain('is_member');               // 2. login por vínculo ⚠️
      expect(corpo).toContain('is_admin_plataforma');     // 3. admin da plataforma
    }
  });

  it('a sonda do boot só alcança temperature_records, e só a linha DELA', () => {
    // `user_name = auth.uid()::text` é o dono da linha. Sem isso, o DELETE por
    // tenant_id apagava a sonda de todo mundo — num boot concorrente, falso
    // negativo no healthcheck de outra loja.
    const criacoes = SUPABASE_SQL.split('create policy tenant_isolation').slice(1);
    const comHealthcheck = criacoes.filter((b) => b.split(';')[0].includes('__healthcheck__'));
    expect(comHealthcheck).toHaveLength(1);
    expect(comHealthcheck[0]).toContain("on temperature_records for all");
    expect(comHealthcheck[0].split(';')[0])
      .toContain("(tenant_id = '__healthcheck__' and user_name = auth.uid()::text)");
  });

  it('define as funções de apoio antes de usá-las (base nova não quebra)', () => {
    const posFuncoes = SUPABASE_SQL.indexOf('function public.is_member');
    const posUso     = SUPABASE_SQL.indexOf('create policy tenant_isolation');
    expect(posFuncoes).toBeGreaterThan(-1);
    expect(posFuncoes).toBeLessThan(posUso);
  });

  it('NUNCA lê user_metadata no SQL executável — seria forjável via updateUser', () => {
    // Só as linhas de código: os comentários MENCIONAM user_metadata de
    // propósito, pra explicar por que ele não pode ser usado.
    const executavel = SUPABASE_SQL
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(executavel).not.toContain('user_metadata');
  });
});
