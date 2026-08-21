import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  saveSupabaseConfig, getSupabaseAuthError, clearSupabaseAuthError,
  supabaseRepository, clearOfflineQueue,
} from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Achado em PRODUÇÃO (21/08), pela RT da CASA DOCE: banner vermelho
// "Sincronização falhando — sem permissão para esta loja
// (temperature_records (RLS))" numa sessão que estava perfeita — a mesma tela
// carregava 33 planilhas e 17 validações RT da loja sem erro nenhum.
//
// A CAUSA não era permissão. `testWrite` (o healthcheck de escrita do boot)
// chamava `sbHeaders()` SEM tenantId, e sbHeaders só anexa o JWT
// `if (tenantId)` — então a sonda saía com a CHAVE ANÔNIMA, sempre, pra todo
// mundo. Com RLS ligado isso é falha garantida: a policy `tenant_isolation`
// referencia `public.is_member()`, e `docs/rls-policies.sql` revoga essa
// função de anon de propósito. O Postgres recusa com 42501 sem sequer chegar
// no `tenant_id = '__healthcheck__'` que deveria liberar a linha.
//
// O 42501 era então classificado como kind 'rls', e o banner dizia "o que
// falta é o vínculo do seu acesso com esta loja" — culpando exatamente a
// coisa que estava certa. Como o flag só é limpo por um healthcheck que dê
// certo, o vermelho era permanente e as falhas se acumulavam a cada boot.
//
// Quebrado desde que o RLS ligou (18/07); ficou invisível até a v1.9.176
// passar a mostrar o banner. Mesmo mecanismo do bug do admin global (20/08,
// src/admin-global-sync.test.js) — passar tenantId vazio pra sbHeaders — só
// que num caminho que aquele fix não alcançava, porque testWrite nem sequer
// aceitava tenantId.
// ─────────────────────────────────────────────────────────────────────────────

const repo  = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const rls   = readFileSync(`${process.cwd()}/docs/rls-policies.sql`, 'utf8');

const nega = (status, body) => Promise.resolve({
  ok: false, status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});
const aceita = () => Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('') });

vi.mock('./auth', () => ({ getValidAccessToken: async () => 'jwt-de-teste' }));

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue(); clearSupabaseAuthError();
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const comSessao = (tenantId = 'casadoce') => localStorage.setItem('nutriops.session',
  JSON.stringify({ tenantId, accessToken: 'jwt-de-teste' }));

describe('por que anon NUNCA passa — o mecanismo, travado nos dois arquivos', () => {
  it('a policy chama is_member(), e is_member é revogada de anon', () => {
    // Estes dois fatos juntos são o bug. Nenhum dos dois está errado
    // isoladamente: a policy PRECISA de is_member (é o caminho 3, o que a
    // CASA DOCE usa), e revogar de anon é a proteção certa. O erro era mandar
    // a sonda como anon.
    expect(rls).toContain("revoke execute on function public.is_member(text) from anon, public;");
    expect(rls).toContain("grant  execute on function public.is_member(text) to authenticated;");
    expect(rls).toContain("|| ' or public.is_member(tenant_id)'");
  });

  it('sbHeaders só anexa o JWT quando recebe tenantId', () => {
    expect(repo).toContain('async function sbHeaders(tenantId) {');
    expect(repo).toMatch(/if \(tenantId\) \{\s*\n\s*const jwt = await memberTokenFor\(tenantId\);/);
  });
});

describe('testWrite — a sonda usa a credencial da pessoa', () => {
  it('aceita tenantId e o repassa pro sbHeaders', () => {
    expect(repo).toContain('async testWrite(tenantId = null) {');
    expect(repo).toContain('const hcHeaders = { ...(await sbHeaders(tenantId)) };');
    // a chamada sem argumento é justamente o que não pode voltar
    expect(repo).not.toContain('const hcHeaders = { ...(await sbHeaders()) };');
  });

  it('manda o JWT quando a sessão cobre a loja', async () => {
    comSessao('casadoce');
    const spy = vi.fn(() => aceita());
    vi.stubGlobal('fetch', spy);
    await supabaseRepository.testWrite('casadoce');
    expect(spy.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-de-teste');
  });

  it('a sonda com JWT que dá certo LIMPA o banner que estava preso', async () => {
    comSessao('casadoce');
    // simula o estado em que a RT estava: flag de erro acumulado no aparelho
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { code: '42501' })));
    await supabaseRepository.testWrite('casadoce');
    expect(getSupabaseAuthError()).toBeTruthy();
    // agora o boot corrigido roda e passa
    vi.stubGlobal('fetch', vi.fn(() => aceita()));
    const r = await supabaseRepository.testWrite('casadoce');
    expect(r.ok).toBe(true);
    expect(getSupabaseAuthError()).toBeFalsy();
  });
});

describe('sem JWT a sonda desiste — em vez de inventar um erro de permissão', () => {
  it('sem sessão nenhuma: não chama o servidor e não marca nada', async () => {
    const spy = vi.fn(() => nega(401, { code: '42501' }));
    vi.stubGlobal('fetch', spy);
    const r = await supabaseRepository.testWrite('casadoce');
    expect(r).toEqual({ ok: false, reason: 'sem_sessao' });
    expect(spy).not.toHaveBeenCalled();
    // o ponto todo: nenhum banner vermelho nasce daqui
    expect(getSupabaseAuthError()).toBeFalsy();
  });

  it('sem tenantId: mesmo com sessão válida, desiste (era o caminho do bug)', async () => {
    comSessao('casadoce');
    const spy = vi.fn(() => nega(401, { code: '42501' }));
    vi.stubGlobal('fetch', spy);
    const r = await supabaseRepository.testWrite();
    expect(r.reason).toBe('sem_sessao');
    expect(spy).not.toHaveBeenCalled();
    expect(getSupabaseAuthError()).toBeFalsy();
  });

  it('sessão que NÃO cobre a loja pedida também desiste', async () => {
    // memberTokenFor exige que a sessão cubra o tenant — uma conta da Swiss
    // sondando a CASA DOCE cairia em anon e produziria o mesmo alarme falso.
    comSessao('swiss');
    const spy = vi.fn(() => nega(401, { code: '42501' }));
    vi.stubGlobal('fetch', spy);
    const r = await supabaseRepository.testWrite('casadoce');
    expect(r.reason).toBe('sem_sessao');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('com JWT, a classificação de erro continua valendo', () => {
  it('42501 autenticado é RLS de verdade — aí o banner está certo', async () => {
    // Depois do fix, kind 'rls' passa a significar o que sempre dizia:
    // credencial boa, policy recusando. Vale o vermelho.
    comSessao('casadoce');
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { code: '42501', message: 'row-level security' })));
    const r = await supabaseRepository.testWrite('casadoce');
    expect(r.reason).toBe('rls_blocked');
    expect(getSupabaseAuthError()?.kind).toBe('rls');
  });

  it('401 sem RLS segue como problema de credencial', async () => {
    comSessao('casadoce');
    vi.stubGlobal('fetch', vi.fn(() => nega(401, { message: 'Invalid API key' })));
    const r = await supabaseRepository.testWrite('casadoce');
    expect(r.reason).toBe('auth_error');
    expect(getSupabaseAuthError()?.kind).not.toBe('rls');
  });

  it('404 continua sendo tabela ausente', async () => {
    comSessao('casadoce');
    vi.stubGlobal('fetch', vi.fn(() => nega(404, 'not found')));
    const r = await supabaseRepository.testWrite('casadoce');
    expect(r.reason).toBe('table_missing');
  });
});

describe('o chamador (pages.jsx) passa a loja', () => {
  it('o boot sonda com tenantAlvo, não vazio', () => {
    expect(fonte).toContain('const probe = await supabaseRepository.testWrite(tenantAlvo);');
    expect(fonte).not.toContain('supabaseRepository.testWrite();');
  });

  it('o throttle foi renomeado pra o banner preso limpar na 1ª abertura', () => {
    // A sonda roda 1x/dia e grava a chave mesmo quando falha. Sem renomear,
    // quem está com o vermelho preso esperaria até 24h depois de atualizar
    // pra a sonda rodar de novo e limpar o flag.
    expect(fonte).toContain("const HC_KEY = 'nutriops.healthcheck.v2';");
    expect(fonte).not.toContain("'nutriops.healthcheck.last'");
  });

  it('tenantAlvo já é o fallback do admin global — a sonda herda ele', () => {
    // Sem isso o admin (session.tenantId null por design) mandaria null e
    // cairia no mesmo anon. O fix de 20/08 já resolve o alvo; aqui só
    // garantimos que a sonda usa o MESMO alvo, e não outra coisa.
    expect(fonte).toContain('const tenantAlvo = session.tenantId ?? activeTenant?.id ?? null;');
    const ini = fonte.indexOf('const tenantAlvo = session.tenantId ?? activeTenant?.id ?? null;');
    const posProbe = fonte.indexOf('supabaseRepository.testWrite(tenantAlvo)', ini);
    expect(posProbe).toBeGreaterThan(ini);
  });
});
