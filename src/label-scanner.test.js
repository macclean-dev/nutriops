import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveScannedLabel } from './label-scanner';
import { saveSupabaseConfig } from './repository';
import { buildLabelTrace } from './validity-rules';

// Leitor de etiqueta (QR) — dá função ao código que a etiqueta já imprime.
// resolveScannedLabel é a parte pura (menos a chamada de rede) do fluxo:
// parse do texto + resolução do produto (cache em memória da tela atual, ou
// nuvem quando não achou). O RLS de fetchProductById faz o resto do trabalho
// de segurança — aqui só confirmamos que o roteamento local/nuvem é correto.

const okJson = (body) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const swissProducts = [{ id: 'p1', name: 'Açúcar', tenantId: 'swiss' }];
const allTenants = [{ id: 'swiss', name: 'Swiss' }, { id: 'casadoce-uuid', name: 'CASA DOCE' }];

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('resolveScannedLabel', () => {
  it('texto que não é do NutriOPS → invalid, sem tentar rede', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await resolveScannedLabel('https://outracoisa.com', { activeTenantId: 'swiss', activeTenantProducts: swissProducts, allTenants });
    expect(r).toEqual({ raw: 'https://outracoisa.com', invalid: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('produto da própria loja, já em memória: acha na hora, sem chamar rede', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const trace = buildLabelTrace('swiss', 'p1', null);
    const r = await resolveScannedLabel(trace, { activeTenantId: 'swiss', activeTenantProducts: swissProducts, allTenants });
    expect(r.product).toEqual(swissProducts[0]);
    expect(r.wrongTenant).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('produto da própria loja mas ainda não carregado em memória: cai pra nuvem', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([{ id: 'p2', tenant_id: 'swiss', name: 'Farinha' }])));

    const trace = buildLabelTrace('swiss', 'p2', null);
    const r = await resolveScannedLabel(trace, { activeTenantId: 'swiss', activeTenantProducts: swissProducts, allTenants });
    expect(r.product?.name).toBe('Farinha');
  });

  it('etiqueta de OUTRA loja que o usuário também acessa: não olha o cache local (é de outro tenant), busca na nuvem', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const fetchMock = vi.fn(() => okJson([{ id: 'p9', tenant_id: 'casadoce-uuid', name: 'Leite condensado' }]));
    vi.stubGlobal('fetch', fetchMock);

    const trace = buildLabelTrace('casadoce-uuid', 'p9', null);
    const r = await resolveScannedLabel(trace, { activeTenantId: 'swiss', activeTenantProducts: swissProducts, allTenants });

    expect(r.wrongTenant).toBe(true);
    expect(r.tenantMeta).toEqual({ id: 'casadoce-uuid', name: 'CASA DOCE' });
    expect(r.product?.name).toBe('Leite condensado');
    // não deve nem OLHAR a lista da Swiss pra um id de outra loja
    expect(swissProducts.some(p => p.id === 'p9')).toBe(false);
  });

  it('produto que não existe em lugar nenhum (excluído, ou sem acesso via RLS): product null, sem quebrar', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));

    const trace = buildLabelTrace('swiss', 'nao-existe', null);
    const r = await resolveScannedLabel(trace, { activeTenantId: 'swiss', activeTenantProducts: swissProducts, allTenants });
    expect(r.product).toBeNull();
  });

  it('tenantId desconhecido (loja que o usuário não tem no seletor): tenantMeta null, mas ainda tenta a nuvem (RLS decide)', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => okJson([])));

    const trace = buildLabelTrace('loja-que-nao-e-minha', 'p1', null);
    const r = await resolveScannedLabel(trace, { activeTenantId: 'swiss', activeTenantProducts: swissProducts, allTenants });
    expect(r.tenantMeta).toBeNull();
    expect(r.product).toBeFalsy();
  });

  it('offline e produto não está em memória: não quebra, devolve product ausente', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const trace = buildLabelTrace('swiss', 'p-offline', null);
    const r = await resolveScannedLabel(trace, { activeTenantId: 'swiss', activeTenantProducts: swissProducts, allTenants });
    expect(r.product).toBeFalsy();
  });
});
