import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { idSeedPorTenant, readFormTemplates } from './forms';

const BASE = '8f2b1c04-6d3a-4e57-9b18-2a7c5e0d4f91';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// `form_templates` é chaveada só por `id` (tenant_id é coluna indexada, não
// parte da chave). A planilha do Reservatório ia pras 4 lojas com id FIXO:
// a RT de uma loja salvando sobrescrevia a linha de outra, trocando até o
// tenant_id. A loja perdida parava de achar a dela no pull e caía no seed.
// Achado da auditoria de 18/08.
// ─────────────────────────────────────────────────────────────────────────────
describe('idSeedPorTenant', () => {
  it('lojas diferentes recebem ids DIFERENTES — é o ponto', () => {
    const ids = ['swiss','backerei','dbk-producao','casadoce'].map(t => idSeedPorTenant(BASE, t));
    expect(new Set(ids).size).toBe(4);
  });

  it('a mesma loja recebe SEMPRE o mesmo id — senão volta a duplicação da v1.9.139', () => {
    expect(idSeedPorTenant(BASE, 'swiss')).toBe(idSeedPorTenant(BASE, 'swiss'));
  });

  it('continua sendo uuid válido — a coluna é uuid', () => {
    for (const t of ['swiss','casadoce','','x']) {
      expect(idSeedPorTenant(BASE, t)).toMatch(UUID);
    }
  });

  it('preserva o prefixo da base — dá pra reconhecer de qual seed veio', () => {
    expect(idSeedPorTenant(BASE, 'swiss').slice(0, 24)).toBe(BASE.slice(0, 24));
  });

  it('tenantId ausente não quebra', () => {
    expect(idSeedPorTenant(BASE, undefined)).toMatch(UUID);
    expect(idSeedPorTenant(BASE, null)).toMatch(UUID);
  });
});

describe('o seed em si', () => {
  it('as 4 lojas geram id distinto pro Reservatório', () => {
    localStorage.clear();
    const ids = ['swiss','backerei','dbk-producao','bf245c3b-casadoce'].map((id) => {
      localStorage.clear();
      const t = readFormTemplates({ id, name: id }).find(x => x.title.includes('Reservatório'));
      return t?.id;
    });
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4);
  });

  it('nenhum seed compartilhado voltou a usar id fixo', () => {
    const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
    expect(fonte).not.toContain("id:'8f2b1c04-6d3a-4e57-9b18-2a7c5e0d4f91'");
    expect(fonte).toContain("idSeedPorTenant('8f2b1c04-6d3a-4e57-9b18-2a7c5e0d4f91', tenantId)");
  });
});
