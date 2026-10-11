import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Incidente de 11/10: a coluna `hora` do recebimento nunca foi criada no banco
// e, desde 21/09, a nuvem recusou TODO recebimento de todas as lojas, em
// silêncio. docs/conferencia-colunas.sql confere, tabela a tabela, se o banco
// tem cada coluna que o app envia. Este teste trava a lista daquele SQL contra
// as funções que montam o envio (repository.js): coluna nova no app sem
// entrar na conferência faz o teste falhar.
// ─────────────────────────────────────────────────────────────────────────────

const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
const sql = readFileSync(`${process.cwd()}/docs/conferencia-colunas.sql`, 'utf8');

const TABELA_DE = {
  tempToRow: 'temperature_records', correctionToRow: 'temperature_records', formToRow: 'form_records',
  tmplToRow: 'form_templates', eqToRow: 'equipment_catalog', staffToRow: 'tenant_staff',
  recvToRow: 'receiving_records', productToRow: 'products', rulesToRow: 'validity_rules',
  actionToRow: 'corrective_actions', controlToRow: 'special_controls', popToRow: 'pops',
  trainingSessionToRow: 'training_sessions', rtValidationToRow: 'rt_validations',
  complianceToRow: 'compliance_docs', assetToRow: 'equip_assets', maintLogToRow: 'maint_logs',
  workOrderToRow: 'work_orders',
};

// Corpo da função, do `{` de abertura ao `}` que fecha.
function corpo(nome) {
  const m = repo.match(new RegExp(`function ${nome}\\([^)]*\\)\\s*\\{`));
  if (!m) return null;
  let i = m.index + m[0].length, nivel = 1;
  const ini = i;
  while (nivel && i < repo.length) { if (repo[i] === '{') nivel++; else if (repo[i] === '}') nivel--; i++; }
  return repo.slice(ini, i).replace(/\/\/[^\n]*/g, '');
}

// Chaves snake_case enviadas (`chave:`) e atalhos (`rules,` em rulesToRow).
function colunas(nome) {
  const c = corpo(nome);
  const chaves = [...c.matchAll(/(?<![\w.$])([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\s*:(?!:)/g)].map((m) => m[1]);
  const atalhos = [...c.matchAll(/[{,]\s*([a-z]+)\s*(?=[,}])/g)].map((m) => m[1]);
  return [...new Set([...chaves, ...atalhos])];
}

const noSql = new Set([...sql.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}.${m[2]}`));

describe('a conferência de colunas acompanha o app', () => {
  for (const [fn, tabela] of Object.entries(TABELA_DE)) {
    it(`${fn} → ${tabela}: toda coluna enviada está na conferência`, () => {
      expect(corpo(fn), `${fn} sumiu de repository.js`).not.toBeNull();
      const faltando = colunas(fn).filter((c) => !noSql.has(`${tabela}.${c}`));
      expect(faltando).toEqual([]);
    });
  }

  it('o caso que originou tudo está lá: receiving_records.hora', () => {
    expect(noSql.has('receiving_records.hora')).toBe(true);
  });

  it('o SQL só lê: prova o projeto e não altera nada', () => {
    expect(sql).toContain('owuycuyfdngyjsumwgmy');
    expect(sql).toContain('select current_database()');
    expect(sql).not.toMatch(/\b(alter|drop|delete|update|insert|create)\b/i);
  });
});
