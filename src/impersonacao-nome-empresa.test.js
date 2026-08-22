import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Achado pelo dono (21/08) ao entrar numa empresa pelo Super Admin pra
// vincular contas: o seletor "Empresa" mostrava "Impersonação (Super Admin)"
// em vez do nome da empresa. Ele parou antes de clicar em "Vincular a esta
// empresa" — não dava pra saber se estava na empresa certa.
//
// O ID sempre esteve correto (handleImpersonate grava `tenantId: tenant.id`),
// então o vínculo teria ido pro lugar certo. Era só o RÓTULO mentindo — o que
// não é pouco: numa ação que dá acesso a dados de cliente, "não sei onde
// estou" é motivo legítimo pra não clicar.
//
// CAUSA: a empresa impersonada não vive em `activeTenants` (ela está em
// `nutriops.admin.clients`, a lista do Super Admin — outro armazenamento),
// então o memo SEMPRE cai no stub de emergência. E o stub nomeava a empresa
// com `session.user.location`, que na impersonação é a string
// "Impersonação (Super Admin)".
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

describe('impersonação — a tela diz em qual empresa você está', () => {
  it('o stub usa o nome da empresa impersonada antes de qualquer outra coisa', () => {
    expect(fonte).toContain("name: session._impersonatedName || session.user?.location || 'Sua empresa',");
  });

  it('a ordem importa: location vinha primeiro e era o texto errado', () => {
    const ini = fonte.indexOf('name: session._impersonatedName');
    const linha = fonte.slice(ini, fonte.indexOf('\n', ini));
    expect(linha.indexOf('_impersonatedName')).toBeLessThan(linha.indexOf('user?.location'));
  });

  it('handleImpersonate guarda o nome real da empresa', () => {
    // É a fonte do rótulo. Sem isso o fallback não tem o que mostrar.
    expect(fonte).toContain('_impersonatedName: tenant.name,');
  });

  it('o id da sessão impersonada é o da empresa — nunca foi esse o problema', () => {
    // Trava o que estava CERTO: se isto mudar, o vínculo passa a ir pra
    // empresa errada, que é bem pior que um rótulo confuso.
    const ini = fonte.indexOf('const imp = {');
    const corpo = fonte.slice(ini, fonte.indexOf('save(SESSION_KEY, imp);', ini));
    expect(corpo).toContain('tenantId: tenant.id,');
  });

  it('o memo recalcula quando o nome impersonado muda', () => {
    // Sem a dep, trocar de empresa impersonada mantinha o rótulo anterior.
    expect(fonte).toContain('}, [activeTenantId, session?.tenantId, session?._impersonatedName, session?.user?.location, activeTenants]);');
  });

  it('o stub NÃO cai em loja-seed de outro cliente', () => {
    // Regressão do vazamento de 30/07 — o comentário e a guarda continuam.
    const ini = fonte.indexOf('const activeTenant = useMemo(() => {');
    const corpo = fonte.slice(ini, fonte.indexOf('return activeTenants[0];', ini));
    expect(corpo).toContain('if (session?.tenantId) {');
    expect(corpo).toMatch(/NUNCA cair numa\s*\n\s*\/\/ loja-seed de outro cliente/);
  });
});
