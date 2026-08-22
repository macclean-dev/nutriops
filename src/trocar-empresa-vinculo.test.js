import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Achado no 1º uso real do multi-unidade (21/08). O dono da CASA DOCE foi
// vinculado a uma unidade nova, o vínculo funcionou (confirmado no banco:
// tenant_members com 3 linhas), ele entrou — inclusive em janela privada, com
// login fresco — e continuou vendo só uma empresa. Concluiu que não tinha dado
// certo, e a conclusão era razoável: não havia NADA na tela indicando a outra.
//
// Eram dois defeitos somados, e um terceiro esperando:
//   1. `switchableTenants` era `seesAllTenants ? activeTenants : []` — VAZIO
//      pra membro. É essa lista que alimenta o seletor de empresa do menu
//      lateral, então ele nunca aparecia.
//   2. A Visão geral nova só mostra várias unidades no painel de RT; quem é
//      `tenant_admin` (→ papel "Administrador") cai no painel de loja única.
//      A única forma de alcançar a outra empresa era o <select> escondido
//      dentro de Alertas/NC/Relatórios.
//   3. E se a lista fosse corrigida sozinha, o clique mandaria pro relogin com
//      PIN — modelo aposentado na v1.9.99, que essa pessoa não tem. Trocaria
//      "não vejo a empresa" por "clico e não consigo entrar".
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

describe('o seletor de empresa enxerga o vínculo', () => {
  it('switchableTenants cai em visibleTenants, não em lista vazia', () => {
    expect(fonte).toContain('() => (seesAllTenants ? activeTenants : visibleTenants),');
    expect(fonte).not.toContain('() => (seesAllTenants ? activeTenants : []),');
  });

  it('visibleTenants já resolve os dois casos — não duplicamos a regra', () => {
    // admin global → todas; membro → as do vínculo. Reimplementar aqui seria
    // uma segunda fonte de verdade pra "que empresas esta sessão alcança".
    const ini = fonte.indexOf('const visibleTenants = useMemo(() => {');
    const corpo = fonte.slice(ini, fonte.indexOf('}, [seesAllTenants', ini));
    expect(corpo).toContain('if (seesAllTenants) return activeTenants;');
    expect(corpo).toContain('if (session?.memberTenants?.length > 0) {');
  });

  it('a dep entra no memo — senão o seletor não atualiza ao ganhar vínculo', () => {
    expect(fonte).toContain('[seesAllTenants, activeTenants, visibleTenants]');
  });
});

describe('trocar de empresa por vínculo NÃO pede PIN', () => {
  const fn = (() => {
    const ini = fonte.indexOf('const requestTenantSwitch = useCallback((id) => {');
    return fonte.slice(ini, fonte.indexOf('}, [activeTenantId, seesAllTenants', ini));
  })();

  it('quem está em memberTenants troca na hora', () => {
    // O vínculo É a autorização: foi um administrador que criou, e o RLS
    // libera as duas empresas com o MESMO JWT.
    expect(fn).toContain('if (session?.memberTenants?.some((m) => m.id === id)) { handleTenantChange(id); return; }');
  });

  it('a checagem do vínculo vem ANTES do modal de PIN', () => {
    const posVinculo = fn.indexOf('session?.memberTenants?.some');
    const posPin = fn.indexOf('setSwitchTarget(t);');
    expect(posVinculo).toBeGreaterThan(-1);
    expect(posPin).toBeGreaterThan(posVinculo);
  });

  it('o admin global continua com o caminho dele', () => {
    expect(fn).toContain('if (seesAllTenants) { handleTenantChange(id); return; }');
  });

  it('o relogin com PIN sobrevive pra quem NÃO tem vínculo', () => {
    // Supervisora do modelo antigo (loja-seed, sem tenant_members) ainda passa
    // por ele. Remover fecharia o acesso dela.
    expect(fn).toContain('const t = activeTenants.find(x => x.id === id);');
    expect(fn).toContain('if (t) setSwitchTarget(t);');
  });

  it('memberTenants entra nas deps do callback', () => {
    expect(fonte).toContain('}, [activeTenantId, seesAllTenants, handleTenantChange, activeTenants, session?.memberTenants]);');
  });
});

describe('handleTenantChange aceita o alvo — a ponta que já estava certa', () => {
  it('valida contra visibleTenants, que agora é a mesma lista do seletor', () => {
    // Correção de 18/08. Se voltasse a exigir admin global, o seletor novo
    // apareceria e o clique seria engolido em silêncio.
    expect(fonte).toContain('if (!visibleTenants.some((t) => t.id === id)) return;');
  });
});
