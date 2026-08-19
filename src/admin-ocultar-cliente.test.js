import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeCloudTenants } from './tenant-sync';

// ─────────────────────────────────────────────────────────────────────────────
// /admin → 🗑 "Remover cliente?" dizia "Esta ação não pode ser desfeita. O
// cliente perderá acesso ao sistema." As DUAS afirmações eram falsas:
//   · a remoção era só do estado local; a linha em `tenants` continuava, e o
//     merge do próximo boot trazia o cliente de volta — reativado e sem os
//     campos comerciais, que só existem localmente;
//   · o acesso dele (token) nunca foi tocado.
// Achado da auditoria de 18/08.
// ─────────────────────────────────────────────────────────────────────────────

const linhaNuvem = (id, name) => ({ id, name, plan:'pro', segment:'padaria' });

describe('o mecanismo da ressurreição', () => {
  it('cliente ausente do local é RECRIADO pelo merge — é o bug', () => {
    const depoisDeRemover = [];                       // admin removeu o único cliente
    const out = mergeCloudTenants(depoisDeRemover, [linhaNuvem('c1','Padaria X')]);
    expect(out.map(c => c.id)).toEqual(['c1']);       // voltou
  });

  it('filtrar o oculto ANTES do merge impede a volta — é a correção', () => {
    const ocultos = ['c1'];
    const nuvem = [linhaNuvem('c1','Padaria X'), linhaNuvem('c2','Café Y')];
    const out = mergeCloudTenants([], nuvem.filter(r => !ocultos.includes(r.id)));
    expect(out.map(c => c.id)).toEqual(['c2']);
  });

  it('quem não foi ocultado continua chegando da nuvem', () => {
    const out = mergeCloudTenants([], [linhaNuvem('c2','Café Y')].filter(r => !['c1'].includes(r.id)));
    expect(out).toHaveLength(1);
  });
});

describe('admin.jsx — a correção está no lugar', () => {
  const fonte = readFileSync(`${process.cwd()}/src/admin.jsx`, 'utf8');

  it('a remoção grava uma lápide que persiste', () => {
    expect(fonte).toContain('function ocultarCliente(id)');
    expect(fonte).toContain('ocultarCliente(id);');
  });

  it('o merge do boot respeita as lápides', () => {
    expect(fonte).toContain('cloud.filter(r => !ocultos.includes(r.id))');
  });

  it('o modal parou de afirmar o que não acontece', () => {
    expect(fonte).not.toContain('Esta ação não pode ser desfeita');
    expect(fonte).not.toContain('O cliente perderá acesso ao sistema');
  });

  it('e diz o que de fato acontece — inclusive que os dados NÃO são apagados', () => {
    expect(fonte).toContain('Ocultar cliente do painel?');
    expect(fonte).toContain('Os dados dele não são apagados');
  });
});
