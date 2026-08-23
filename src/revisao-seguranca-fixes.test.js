import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Os dois achados MÉDIA da revisão adversarial de 21/08
// (docs/REVISAO-SEGURANCA-21-08.md), corrigidos em 22/08.
// ─────────────────────────────────────────────────────────────────────────────

const edge = readFileSync(`${process.cwd()}/supabase/functions/invite-collaborator/index.ts`, 'utf8');
const rls  = readFileSync(`${process.cwd()}/docs/rls-policies.sql`, 'utf8');
const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');

const executavel = (sql) => sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('ACHADO 1 — reset_password permitia takeover entre unidades', () => {
  const fn = (() => {
    const ini = edge.indexOf("if (action === 'reset_password') {");
    return edge.slice(ini, edge.indexOf("return json({ ok: true, user_id: userId });", ini));
  })();

  it('busca TODAS as empresas do alvo, não só a do chamador', () => {
    // A contagem é o que fecha a brecha — sem ela não dá pra saber se a conta
    // é multi-unidade.
    expect(fn).toContain(".from('tenant_members').select('tenant_id, role').eq('user_id', userId);");
  });

  it('dono de loja NÃO reseta quem responde por mais de uma empresa', () => {
    // A senha no Supabase Auth é global à conta. Um tenant_admin da unidade A
    // resetaria a senha da dona (membro de A) e entraria como ela — e a sessão
    // dela alcança a unidade B, onde ele nunca teve papel.
    expect(fn).toContain('const empresasDoAlvo = (alvoVinculos ?? []).length;');
    expect(fn).toContain('if (empresasDoAlvo > 1 && !isGlobalAdmin) {');
  });

  it('o admin da plataforma continua podendo — é quem vê as duas pontas', () => {
    expect(fn).toMatch(/empresasDoAlvo > 1 && !isGlobalAdmin/);
  });

  it('a recusa explica o motivo, em vez de "não autorizado"', () => {
    // Quem toma o 403 é o dono da loja tentando ajudar a própria RT. Uma
    // negação seca vira chamado de suporte.
    expect(fn).toMatch(/também responde por outra empresa/);
    expect(fn).toMatch(/Peça ao administrador da plataforma/);
  });

  it('a checagem antiga (alvo pertence a ESTA loja) continua', () => {
    // Ela impede reset de userId arbitrário. As duas somam.
    expect(fn).toContain("if (!targetMembership) return json({ error: 'esse usuário não pertence a esta empresa' }, 404);");
  });

  it('a checagem de multi-unidade vem ANTES do update de senha', () => {
    expect(fn.indexOf('empresasDoAlvo > 1')).toBeLessThan(fn.indexOf('updateUserById'));
  });
});

describe('ACHADO 2 — __healthcheck__ era escrita livre em 20 tabelas', () => {
  it('saiu da regra genérica — 19 tabelas não têm mais o caminho', () => {
    // A sonda só escreve em temperature_records; nas outras o caminho era
    // escrita de linha arbitrária liberada pra qualquer conta autenticada,
    // inclusive sem vínculo com loja nenhuma.
    const corpo = executavel(rls);
    const loop = corpo.slice(corpo.indexOf('regra text :='), corpo.indexOf('foreach t in array'));
    expect(loop).not.toContain('__healthcheck__');
    expect(loop).toContain("or public.is_member(tenant_id)");
  });

  it('temperature_records tem bloco próprio, com a sonda escopada ao uid', () => {
    const corpo = executavel(rls);
    expect(corpo).toContain("or (tenant_id = '__healthcheck__' and user_name = auth.uid()::text)");
    expect(corpo).toContain('drop policy if exists tenant_isolation on public.temperature_records;');
  });

  it('varre as sondas órfãs de antes (user_name = system)', () => {
    expect(executavel(rls)).toContain("where tenant_id = '__healthcheck__' and user_name = 'system';");
  });

  it('o SUPABASE_SQL da tela de Configurações está espelhado', () => {
    // CLAUDE.md: mexeu em policy, mexe em docs/rls-policies.sql E espelha
    // aqui. Divergir foi a raiz do incidente de 16/08.
    const sqlDaTela = repo.slice(repo.indexOf('export const SUPABASE_SQL'));
    const comHc = sqlDaTela.split('create policy tenant_isolation').slice(1)
      .filter((b) => b.split(';')[0].includes('__healthcheck__'));
    expect(comHc).toHaveLength(1);
    expect(comHc[0]).toContain('on temperature_records for all');
  });
});

describe('a sonda carimba quem a escreveu', () => {
  const fn = (() => {
    const ini = repo.indexOf('async testWrite(tenantId = null) {');
    return repo.slice(ini, repo.indexOf("return { ok: true };", ini));
  })();

  it('lê o uid da sessão e desiste sem ele', () => {
    expect(fn).toContain("?.user?.id ?? null;");
    expect(fn).toContain("if (!meuUid) return { ok: false, reason: 'sem_sessao' };");
  });

  it('grava o uid em user_name — é o que a policy confere', () => {
    expect(fn).toContain('user_name: meuUid, user_role: \'healthcheck\',');
    expect(fn).not.toContain("user_name: 'system'");
  });

  it('o DELETE filtra pelas SUAS sondas, não por tenant_id solto', () => {
    // O filtro antigo apagava a sonda de todo mundo: num boot concorrente,
    // falso negativo no healthcheck de outra loja.
    expect(fn).toContain('tenant_id=eq.__healthcheck__&user_name=eq.${encodeURIComponent(meuUid)}');
    expect(fn).not.toMatch(/temperature_records\?tenant_id=eq\.__healthcheck__`/);
  });
});
