import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Achado em PRODUÇÃO (20/08), a partir do banner vermelho que a v1.9.176 tinha
// acabado de tornar visível: "Sincronização falhando — sem permissão para esta
// loja (equipment_catalog)", com 47 falhas seguidas na conta de admin global.
//
// A investigação descartou token (JWT íntegro, app_metadata.role='admin',
// válido) e policy (as 20 tabelas conferidas com os 4 caminhos 'ok'). A causa
// era o tenantId: o admin global tem `session.tenantId === null` POR DESIGN —
// ele não pertence a uma loja, alcança todas. Esse null era passado adiante
// pro sync, e `sbHeaders` (repository.js) decide anexar o JWT com um
// `if (tenantId)` — com null, a requisição saía com a CHAVE ANÔNIMA. A policy
// então tentava executar `is_member()`, que `docs/rls-policies.sql` revoga de
// anon de propósito, e o Postgres devolvia 42501. As 22 tabelas falhavam a
// cada boot, em silêncio, desde que o admin global existe.
//
// Nada se perdia (as telas leem por loja, com tenantId real), mas o auto-sync
// do admin era um no-op — e o botão "Tentar de novo" do banner de catálogo
// tinha um `if (!session?.tenantId) return` que o fazia não fazer NADA pra ele.
//
// Correção: cair na loja que o admin está OLHANDO (`activeTenant.id`).
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const repo  = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');

describe('o mecanismo que causou o bug — trava pra não regredir', () => {
  it('sbHeaders só anexa o JWT quando recebe tenantId (é daqui que vinha o anon)', () => {
    // Não é um defeito de sbHeaders — é o contrato dela. O teste existe pra
    // deixar explícito que passar null significa "vai com a chave anônima",
    // e que por isso NENHUM chamador pode passar null achando que está
    // autenticado.
    expect(repo).toContain('async function sbHeaders(tenantId) {');
    expect(repo).toMatch(/if \(tenantId\) \{\s*\n\s*const jwt = await memberTokenFor\(tenantId\);/);
  });

  it('memberTokenFor devolve null sem tenantId — mesmo pro admin da plataforma', () => {
    // O `if (!tenantId) return null` vem ANTES da checagem de isPlatformAdmin,
    // então "sou admin global" não salva uma chamada sem tenantId.
    const ini = repo.indexOf('async function memberTokenFor(tenantId) {');
    const corpo = repo.slice(ini, repo.indexOf('async function sbHeaders', ini));
    const posGuarda = corpo.indexOf('if (!tenantId) return null;');
    const posAdmin  = corpo.indexOf('isPlatformAdmin');
    expect(posGuarda).toBeGreaterThan(-1);
    expect(posAdmin).toBeGreaterThan(posGuarda);
  });
});

describe('auto-sync do boot — não manda mais null adiante', () => {
  const efeito = (() => {
    const ini = fonte.indexOf('  // Auto-sync on login and when coming online');
    return fonte.slice(ini, fonte.indexOf('}, [session?.tenantId, activeTenant?.id]);', ini));
  })();

  it('resolve a loja alvo com fallback pro activeTenant', () => {
    expect(efeito).toContain('const tenantAlvo = session.tenantId ?? activeTenant?.id ?? null;');
  });

  it('desiste explicitamente se não houver loja alguma, em vez de sincronizar null', () => {
    const posAlvo = efeito.indexOf('const tenantAlvo =');
    const posGuarda = efeito.indexOf('if (!tenantAlvo) {');
    expect(posGuarda).toBeGreaterThan(posAlvo);
    expect(efeito).toContain('auto-sync skip — sessão sem loja alvo');
  });

  it('session.tenantId aparece SÓ na linha do fallback — era o vazamento por todo o resto', () => {
    // A própria resolução do alvo lê session.tenantId, e deve mesmo. O que não
    // pode voltar é algum outro ponto do efeito lendo direto e furando o
    // fallback — foi assim que os 22 módulos saíram com null.
    const usos = [...efeito.matchAll(/session\??\.tenantId/g)];
    expect(usos).toHaveLength(1);
    const linhaDoUso = efeito.split('\n').find((l) => /session\??\.tenantId/.test(l));
    expect(linhaDoUso).toContain('const tenantAlvo =');
  });

  it('os 4 consumidores do alvo recebem tenantAlvo', () => {
    expect(efeito).toContain('maybeAutoConfigSupabase(tenantAlvo, activeTenants);');
    expect(efeito).toContain('await syncAllModules(tenantAlvo);');
    expect(efeito).toContain('await syncEquipmentCatalog(tenantAlvo);');
    expect(efeito).toContain('notificarSyncAplicado({ tenantId: tenantAlvo, trigger });');
  });

  it('trocar de loja redispara o sync (activeTenant nas deps)', () => {
    // Sem isso, o admin trocaria de loja no seletor e o sync continuaria
    // apontado pra loja anterior — o fallback só é lido quando o efeito roda.
    expect(fonte).toContain('}, [session?.tenantId, activeTenant?.id]);');
  });
});

describe('botão "Tentar de novo" do banner de catálogo — não é mais no-op pro admin', () => {
  const retry = (() => {
    const ini = fonte.indexOf('const retryCatalogSync = useCallback(async () => {');
    return fonte.slice(ini, fonte.indexOf('setCatalogRetrying(false);', ini));
  })();

  it('usa o mesmo fallback, em vez de desistir quando tenantId é null', () => {
    expect(retry).toContain('const alvo = session?.tenantId ?? activeTenant?.id ?? null;');
    expect(retry).toContain('if (!alvo) return;');
    // a guarda antiga fazia o botão não responder pro admin global
    expect(retry).not.toContain('if (!session?.tenantId) return;');
  });

  it('sincroniza e avisa as telas usando o alvo resolvido', () => {
    expect(retry).toContain('await syncEquipmentCatalog(alvo);');
    expect(retry).toContain("notificarSyncAplicado({ tenantId: alvo, trigger: 'retry-catalogo' });");
  });
});
