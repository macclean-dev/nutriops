import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Achado numa revisão adversarial das RPCs (21/08). NÃO houve exploração: a
// produção está com o portão de admin desde 23/07. O que estava errado era o
// REPOSITÓRIO.
//
// A única definição versionada de `upsert_tenant` vivia em
// docs/security-tenants-lockdown.sql — SEM o portão (ele existia só como
// comentário) e seguida de `grant execute ... to anon, authenticated`. E o
// cabeçalho do arquivo dizia "IDEMPOTENTE: pode rodar de novo à vontade".
//
// Seguir a instrução do próprio repositório reabriria a brecha de escrita
// não-autenticada: `drop` + `create` sem portão + `grant` pra anon = qualquer
// um com a chave pública do bundle volta a criar e SOBRESCREVER empresa,
// girando access_token e setup_pin_hash de qualquer loja. Takeover, não
// bloqueio.
//
// Mesma classe do incidente de 16/08 (arquivo re-runnable com drop+create que
// vence em silêncio), com impacto pior — e o mesmo remédio: fonte de verdade
// única e runnable, arquivo antigo marcado com ⛔.
// ─────────────────────────────────────────────────────────────────────────────

const gated    = readFileSync(`${process.cwd()}/docs/upsert-tenant-gated.sql`, 'utf8');
const lockdown = readFileSync(`${process.cwd()}/docs/security-tenants-lockdown.sql`, 'utf8');

// Linhas EXECUTÁVEIS — comentário que cita o padrão perigoso não é achado.
const executavel = (sql) => sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('a fonte de verdade tem o portão', () => {
  it('o gate está DENTRO da função, não em comentário', () => {
    const corpo = executavel(gated);
    expect(corpo).toContain("if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then");
    expect(corpo).toContain("using errcode = '42501';");
  });

  it('usa app_metadata, nunca user_metadata', () => {
    // user_metadata é editável pelo próprio usuário via updateUser — bastaria
    // o devtools pra virar admin.
    expect(executavel(gated)).not.toContain('user_metadata');
  });

  it('revoke de anon E grant só pra authenticated', () => {
    const corpo = executavel(gated);
    expect(corpo).toMatch(/revoke execute on function public\.upsert_tenant\([^)]*\) from anon, public;/);
    expect(corpo).toMatch(/grant\s+execute on function public\.upsert_tenant\([^)]*\) to authenticated;/);
    expect(corpo).not.toMatch(/grant[^\n]*upsert_tenant[^\n]*to anon/);
  });

  it('o portão vem ANTES do insert', () => {
    const corpo = executavel(gated);
    expect(corpo.indexOf("<> 'admin' then")).toBeLessThan(corpo.indexOf('insert into public.tenants'));
  });

  it('hash null preserva o setup PIN — coalesce mantido', () => {
    // Sem isso, editar o plano revogaria em silêncio o PIN que o cliente
    // acabou de receber (achado T4 da auditoria de 18/08).
    expect(gated).toContain('setup_pin_hash    = coalesce(excluded.setup_pin_hash, t.setup_pin_hash),');
  });

  it('tem teste de aceitação, em empresa descartável', () => {
    for (const c of ['CHECK 1', 'CHECK 2', 'CHECK 3', 'CHECK 4', 'CHECK 5']) expect(gated).toContain(c);
    expect(gated).toContain("v_id text := '__teste_upsert__';");
    expect(gated).toContain('returns table (passo text, resultado text)');
    expect(gated).not.toContain('bf245c3b-2f9');
  });
});

describe('o arquivo antigo foi DESARMADO', () => {
  const corpo = executavel(lockdown);

  it('não cria mais a upsert_tenant', () => {
    expect(corpo).not.toMatch(/^create function public\.upsert_tenant\(/m);
    expect(corpo).not.toMatch(/^drop function if exists public\.upsert_tenant\(/m);
  });

  it('não dá mais grant pra anon nessa função', () => {
    expect(corpo).not.toMatch(/grant[^\n]*upsert_tenant[^\n]*anon/);
  });

  it('a promessa de "idempotente à vontade" saiu do cabeçalho', () => {
    // Era ela que transformava o arquivo em armadilha: instruía a rodar de novo.
    expect(lockdown).not.toContain('-- IDEMPOTENTE: pode rodar de novo à vontade');
    expect(lockdown).toContain('⛔ NÃO É MAIS IDEMPOTENTE');
  });

  it('aponta pra fonte de verdade', () => {
    expect(lockdown).toContain('docs/upsert-tenant-gated.sql');
  });

  it('as OUTRAS RPCs do lockdown continuam intactas', () => {
    // O arquivo segue válido pro resto — desarmar não pode ter quebrado o
    // onboarding por ?token=.
    expect(corpo).toContain('grant execute on function public.get_tenant_by_token(text)');
    expect(corpo).toContain('grant execute on function public.mark_setup_consumed(text)');
    expect(corpo).toContain('grant execute on function public.bump_setup_attempts(text, integer, integer)');
  });
});
