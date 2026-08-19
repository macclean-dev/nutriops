import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chavesDoBackup, ehChaveSensivel } from './settings';

// ─────────────────────────────────────────────────────────────────────────────
// O filtro do export era `k.includes(tenantId) || k.includes('nutriops.')` — o
// segundo termo anulava o primeiro e levava TUDO. O "backup da Swiss" carregava
// CASA DOCE, Bäckerei e DBK, e restaurar sobrescrevia as quatro lojas.
// E levava credencial junto: JWT de sessão, config do Supabase e os PIN
// overrides, que o CLAUDE.md diz que não podem sair do aparelho — num arquivo
// que a pessoa manda por e-mail.
// Achado da auditoria (18/08).
// ─────────────────────────────────────────────────────────────────────────────

const CHAVES = [
  'nutriops.forms.records.swiss',
  'nutriops.forms.templates.swiss',
  'nutriops.oil.swiss',
  'nutriops.users.swiss',
  'nutriops.company.profile.swiss',
  'nutriops.forms.records.casadoce',
  'nutriops.users.casadoce',
  'nutriops.oil.backerei',
  'nutriops.temperature.records',     // GLOBAL — as 4 lojas
  'nutriops.offline.queue',           // global
  'nutriops.auth.session',            // credencial
  'nutriops.supabase.config',         // credencial
  'nutriops.pin.overrides.swiss',     // credencial
  'nutriops.operator.swiss',          // credencial
];

describe('escopo do backup', () => {
  const doSwiss = chavesDoBackup(CHAVES, 'swiss');

  it('leva só as chaves da loja pedida', () => {
    expect(doSwiss).toContain('nutriops.forms.records.swiss');
    expect(doSwiss).toContain('nutriops.users.swiss');
  });

  it('NÃO leva chave de outra loja — era o vazamento', () => {
    expect(doSwiss.some(k => k.includes('casadoce'))).toBe(false);
    expect(doSwiss.some(k => k.includes('backerei'))).toBe(false);
  });

  it('NÃO leva as globais — restaurar uma loja não pode reescrever as outras', () => {
    expect(doSwiss).not.toContain('nutriops.temperature.records');
    expect(doSwiss).not.toContain('nutriops.offline.queue');
  });

  it('NÃO leva credencial nenhuma', () => {
    for (const k of ['nutriops.auth.session','nutriops.supabase.config','nutriops.pin.overrides.swiss','nutriops.operator.swiss']) {
      expect(doSwiss, `vazou ${k}`).not.toContain(k);
    }
  });

  it('sem tenant não leva nada — melhor vazio que tudo', () => {
    expect(chavesDoBackup(CHAVES, null)).toEqual([]);
    expect(chavesDoBackup(CHAVES, '')).toEqual([]);
  });

  it('ignora chave que não é do app', () => {
    expect(chavesDoBackup(['outra.coisa.swiss'], 'swiss')).toEqual([]);
  });
});

describe('ehChaveSensivel', () => {
  it('reconhece as credenciais conhecidas', () => {
    for (const k of ['nutriops.auth.session','nutriops.session','nutriops.supabase.config',
                     'nutriops.pin.overrides.casadoce','nutriops.admin.auth','nutriops.operator.swiss']) {
      expect(ehChaveSensivel(k), k).toBe(true);
    }
  });

  it('não marca dado de conformidade como sensível', () => {
    for (const k of ['nutriops.forms.records.swiss','nutriops.oil.swiss','nutriops.users.swiss']) {
      expect(ehChaveSensivel(k), k).toBe(false);
    }
  });
});

describe('settings.jsx — a restauração respeita o escopo', () => {
  const fonte = readFileSync(`${process.cwd()}/src/settings.jsx`, 'utf8');

  it('o filtro largo saiu', () => {
    // só linhas executáveis — o comentário do porquê CITA o filtro antigo
    const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(codigo).not.toContain("k.includes(tenantId) || k.includes('nutriops.')");
  });

  it('export e restore usam o MESMO filtro — senão voltam a divergir', () => {
    expect((fonte.match(/chavesDoBackup\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('o que foi ignorado é informado, não descartado em silêncio', () => {
    expect(fonte).toContain('foram IGNORADOS por não pertencerem a esta empresa');
  });
});
