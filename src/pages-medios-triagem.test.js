import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { daysUntil } from './limits';
import { mesclaTenants } from './pages';

const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 2ª rodada da triagem de médios sem perda de dado. pages.jsx tinha 19 achados
// — 3 na zona morta do TemperatureCapture (v1.9.159), 16 vivos. Dois já
// estavam resolvidos por commits de hoje (renomear equipamento cria cópia —
// v1.9.153/160); os 14 restantes viram 6 consertos (algumas famílias tinham
// 2-4 citações apontando pro mesmo lugar).
// ─────────────────────────────────────────────────────────────────────────────

describe('"Sincronizar" não mente mais quando tudo falha', () => {
  it('mostra o que falhou, não só o que deu certo em verde', () => {
    expect(fonte).toContain("syncResult.failed > 0 ? 'var(--red)' : 'var(--green)'");
    expect(fonte).toContain('falhou${syncResult.failed > 1');
  });
});

describe('"Remover ação corretiva" e "Remover equipamento" sincronizam de verdade', () => {
  it('ação corretiva tem função de delete e a tela chama', () => {
    const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(repo).toContain('export async function deleteCorrectiveAction(tenantId, id)');
    expect(fonte).toContain('deleteCorrectiveAction(activeTenant.id, id)');
  });

  it('remover equipamento não descarta mais o {ok:false}', () => {
    expect(fonte).toContain('const r = await deleteEquipmentItem(activeTenant.id, item.label);');
    expect(fonte).not.toContain('deleteEquipmentItem(activeTenant.id, item.label).catch(() => {});');
  });

  it('as duas distinguem offline (silencioso) de falha real (avisa)', () => {
    const trechos = fonte.split("r.reason !== 'offline_or_disabled'");
    expect(trechos.length).toBeGreaterThanOrEqual(3); // 2 usos + o split em si
  });
});

describe('badge de Validades no menu — cálculo e atualização', () => {
  const limits = readFileSync(`${process.cwd()}/src/limits.js`, 'utf8');

  it('usa a validade EFETIVA (pós-abertura), não só expiryDate cru', () => {
    expect(limits).toContain('p.openedUntil ? p.openedUntil.slice(0, 10) : p.expiryDate');
  });

  it('usa daysUntil (o mesmo que a tela de Validades), não reimplementa', () => {
    expect(limits).toContain('const days = daysUntil(efetiva);');
    expect(fonte).not.toContain("Math.ceil((new Date(p.expiryDate + 'T12:00')");
  });

  it('o import NÃO é estático de ./validity — isso puxaria o módulo inteiro (componentes + PDF + QR) pro bundle principal', () => {
    expect(fonte).not.toMatch(/import\s*\{\s*daysUntil\s*\}\s*from\s*'\.\/validity'/);
  });

  // A auditoria só citou UMA ocorrência (BottomNav). Ao corrigir, grep achou
  // a MESMA fórmula quebrada reimplementada mais 2 vezes — MobileDrawer e
  // RailNav (a navegação principal do desktop). As três convergem pro mesmo
  // helper puro agora, em vez de 3 cópias que iam divergir entre si.
  it('as 3 telas (RailNav, MobileDrawer, BottomNav) usam o mesmo helper — zero cópias da fórmula antiga', () => {
    expect(fonte).not.toContain("Math.ceil((new Date(p.expiryDate + 'T12:00')");
    const usos = (fonte.match(/contarValidadesEmAlerta\(products\)/g) ?? []).length;
    expect(usos).toBe(3);
  });

  it('daysUntil mora em limits.js (puro, já importado eager) e validity.jsx reexporta sem duplicar', () => {
    const limits = readFileSync(`${process.cwd()}/src/limits.js`, 'utf8');
    const validity = readFileSync(`${process.cwd()}/src/validity.jsx`, 'utf8');
    expect(limits).toContain('export function daysUntil(dateStr)');
    expect(validity).toContain("import { daysUntil } from './limits';");
    expect(validity).not.toContain('export function daysUntil');
  });

  it('daysUntil calcula certo — meia-noite com meia-noite, sem off-by-one', () => {
    const hoje = new Date(); hoje.setHours(12,0,0,0);
    const amanha = new Date(hoje.getTime() + 86400000).toISOString().slice(0,10);
    expect(daysUntil(amanha)).toBe(1);
  });

  it('o badge recalcula quando a aba volta a ficar visível, não só na troca de loja', () => {
    expect(fonte).toContain("document.addEventListener('visibilitychange', atualizar)");
  });
});

describe('Central de NC — lista não esconde item sem avisar', () => {
  it('o corte de 15 vira toggle explícito, não descarte silencioso', () => {
    expect(fonte).toContain('(verTodosPendentes ? pending : pending.slice(0, 15))');
    expect(fonte).toContain('Ver os outros {pending.length - 15}');
  });
});

describe('lista de empresas — mesma lógica de merge em todo lugar', () => {
  it('mesclaTenants: storage vazio cai no seed inteiro', () => {
    const seed = [{id:'a'},{id:'b'}];
    expect(mesclaTenants(null, seed)).toEqual(seed);
    expect(mesclaTenants([], seed)).toEqual(seed);
  });

  it('mesclaTenants: cliente novo no seed aparece mesmo com storage não-vazio — era o bug', () => {
    const salvos = [{id:'a', nome:'salvo'}];
    const seed = [{id:'a'},{id:'b', nome:'novo cliente'}];
    const out = mesclaTenants(salvos, seed);
    expect(out.map(t=>t.id)).toEqual(['a','b']);
    expect(out.find(t=>t.id==='a').nome).toBe('salvo'); // o salvo local vence
  });

  it('activeTenants usa mesclaTenants, não mais o `?? defaultTenants` ingênuo', () => {
    expect(fonte).toContain('useState(() => mesclaTenants(readOnboardingTenants(), defaultTenants));');
    expect(fonte).not.toContain('useState(() => readOnboardingTenants() ?? defaultTenants);');
  });
});

describe('hidratação da segunda unidade no boot', () => {
  it('a guarda checa TODAS as unidades do membro, não só session.tenantId', () => {
    expect(fonte).toContain('const necessarios = session.memberTenants?.length > 0');
    expect(fonte).toContain('necessarios.every((id) => activeTenants.some((t) => t.id === id))');
  });

  it('memberTenants entra nas deps do efeito — senão a guarda usa closure velha', () => {
    expect(fonte).toContain("[session?.tenantId, session?.memberTenants, activeTenants]);");
  });
});
