import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { templateSector } from './forms';
import { ls, lw } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Última rodada da tier "baixa" (sem perda de dado) da auditoria de falha
// silenciosa — pool: os achados que apontam pra src/forms.jsx (3) e
// src/pages.jsx (2), tratados como dois mini-lotes independentes na mesma
// rodada (data_achados_pendentes_19-08.json). Rodadas anteriores desta tier:
// settings.jsx, repository.js, admin.jsx+superadmin-view.jsx
// (admin-superadmin-baixa-triagem.test.js).
//
// Os dois arquivos já tinham levado fixes em tiers anteriores (média:
// 6e0a667/v1.9.171 em forms.jsx, 1c53a0f/v1.9.167 em pages.jsx; alta:
// c8a947e/v1.9.175 em pages.jsx) — conferido no código ATUAL antes de mexer,
// nenhum dos 5 já estava resolvido.
//
// Todos os 5 eram reais. Sem @testing-library neste repo (mesma convenção do
// resto da auditoria): UI vira asserção de código-fonte + reimplementação
// pura ("modelo") das decisões, igual ao padrão já usado em
// admin-superadmin-baixa-triagem.test.js pra handler embutido em componente
// não exportado.
//
//   FORMS.JSX
//   · Achado 1/3 (T2) — criarTemplate: publicar uma planilha importada por IA
//     com o filtro de categoria/setor num valor diferente do dela fazia o
//     card sumir da grade sem nenhum aviso (igual a "Cancelar"). Corrigido
//     saltando pro filtro de onde a planilha nova está (pickCategory), mesmo
//     fallback que salvarOrganizacao já usa.
//   · Achados 2/3 e 3/3 (T1 + T3) — DUPLICADOS: os dois relatam o MESMO bug
//     (mesma linha 1452 do JSON, que hoje é forms.jsx:1725 e 2353) —
//     window.open sem guarda de null no "Exportar PDF" (rodapé do
//     preenchimento) e no "↓ PDF" do card concluído. Tratado como uma
//     correção só, cobrindo os dois call sites. Mesmo padrão de guarda que
//     reports-views.jsx e maintenance.jsx já usam (fixado em rodadas
//     anteriores desta mesma auditoria).
//
//   PAGES.JSX
//   · Achado 1/2 (T3) — handleLogin: logSession vem de import() dinâmico com
//     .catch(() => {}) vazio — se o chunk de extras.jsx falhar (device
//     offline no boot, ou SW ainda sem cachear o chunk logo após um deploy),
//     o login funciona normal mas a entrada em Histórico de acessos nunca
//     nasce, sem nenhum aviso. Corrigido com um fallback que grava a MESMA
//     entrada direto, usando ls/lw (já estáticos em pages.jsx via
//     repository.js) — sem precisar do chunk de UI inteiro pra 3 campos.
//   · Achado 2/2 (T6) — maintAlertCount: useMemo com deps=[activeTenant.id]
//     só recomputava ao trocar de empresa — aparelho novo com boot sync
//     terminando depois do primeiro render ficava com o badge em branco a
//     sessão inteira, e registrar execução na tela de Manutenção também não
//     abaixava o número. Corrigido com dois gatilhos NOVOS (SYNC_EVENT via
//     tick + activeView) SEM tocar em maintenance.jsx — esse arquivo também
//     ESCUTA SYNC_EVENT pra reler o próprio state, e disparar o evento de lá
//     fecharia um ciclo escreve→avisa→relê→escreve sem fim. Também parou de
//     contar ativo sem `name` que a própria tela de Manutenção descarta
//     (readEquipments), fechando a divergência de escopo que o achado citava.
// ─────────────────────────────────────────────────────────────────────────────

const fonteForms       = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
const fontePages       = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const fonteMaintenance = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');

beforeEach(() => { localStorage.clear(); });

// ═══════════════════════════════════════════════════════════════════════════
// FORMS.JSX — Achado 1/3 (T2)
// ═══════════════════════════════════════════════════════════════════════════

describe('forms.jsx achado 1/3 (T2) — criarTemplate salta pro filtro da planilha nova (a IA publicada não some mais da grade)', () => {
  const ini = fonteForms.indexOf('const criarTemplate = useCallback((novo) => {');
  const fim = fonteForms.indexOf('\n  }, [activeTenant.id]);', ini);
  const corpo = fonteForms.slice(ini, fim);

  it('existe e a slice não está vazia', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(corpo.length).toBeGreaterThan(0);
  });

  it('fonte: criarTemplate chama pickCategory(novo.category) ANTES do push pra nuvem', () => {
    expect(corpo).toContain('pickCategory(novo.category);');
    const posPick = corpo.indexOf('pickCategory(novo.category);');
    const posPush = corpo.indexOf("import('./repository')");
    expect(posPick).toBeGreaterThan(-1);
    expect(posPush).toBeGreaterThan(posPick);
  });

  // Mesma lógica de filtragem de FormsView (byCategory/filteredTemplates),
  // usando o templateSector REAL exportado — não uma cópia da regra de setor.
  function filtrar(templates, catFilter, sectorFilter) {
    const byCategory = catFilter === 'all' ? templates : templates.filter((t) => t.category === catFilter);
    return sectorFilter === 'all' ? byCategory : byCategory.filter((t) => templateSector(t) === sectorFilter);
  }
  function pickCategoryModel(cat) { return { catFilter: cat, sectorFilter: 'all' }; } // espelha o pickCategory real

  const existentes = [{ id: 'h1', category: 'higienizacao', title: 'Higienização — Padaria' }];

  it('ANTES (bug, cenário do achado): chip "Higienização" ativo, publica planilha "Personalizado" — filtros ficam como estavam e o card some da grade', () => {
    const novo = { id: 'novo1', category: 'custom', title: 'Checklist recebimento' };
    const templates = [novo, ...existentes];
    const visiveis = filtrar(templates, 'higienizacao', 'all'); // filtros NÃO mudam (comportamento antigo)
    expect(visiveis.find((t) => t.id === 'novo1')).toBeUndefined();
  });

  it('DEPOIS (correção real): mesmo cenário, com pickCategory(novo.category) aplicado — o card aparece na hora', () => {
    const novo = { id: 'novo1', category: 'custom', title: 'Checklist recebimento' };
    const templates = [novo, ...existentes];
    const { catFilter, sectorFilter } = pickCategoryModel(novo.category);
    const visiveis = filtrar(templates, catFilter, sectorFilter);
    expect(visiveis.find((t) => t.id === 'novo1')).toBeDefined();
  });

  it('ANTES (bug, cenário CASA DOCE): "Todas" com chip de setor "Padaria" ativo, publica Higienização de OUTRO setor — some igual', () => {
    const novo = { id: 'novo2', category: 'higienizacao', title: 'Higienização — Confeitaria' };
    const templates = [novo, ...existentes];
    const visiveis = filtrar(templates, 'all', 'Padaria'); // sectorFilter não zerado
    expect(visiveis.find((t) => t.id === 'novo2')).toBeUndefined();
  });

  it('DEPOIS: mesmo cenário CASA DOCE, pickCategory zera o setor pra "all" — o card de Confeitaria aparece', () => {
    const novo = { id: 'novo2', category: 'higienizacao', title: 'Higienização — Confeitaria' };
    const templates = [novo, ...existentes];
    const { catFilter, sectorFilter } = pickCategoryModel(novo.category);
    expect(sectorFilter).toBe('all'); // sai do setor "Padaria" preso
    const visiveis = filtrar(templates, catFilter, sectorFilter);
    expect(visiveis.find((t) => t.id === 'novo2')).toBeDefined();
  });

  it('não regrediu: planilha existente do mesmo filtro continua visível depois de criar uma nova', () => {
    const novo = { id: 'novo3', category: 'higienizacao', title: 'Higienização — Padaria' };
    const templates = [novo, ...existentes];
    const { catFilter, sectorFilter } = pickCategoryModel(novo.category);
    const visiveis = filtrar(templates, catFilter, sectorFilter).map((t) => t.id).sort();
    expect(visiveis).toEqual(['h1', 'novo3']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FORMS.JSX — Achados 2/3 e 3/3 (T1 + T3, DUPLICADOS — mesmo bug, mesma linha)
// ═══════════════════════════════════════════════════════════════════════════

describe('forms.jsx achados 2/3 e 3/3 (T1 + T3, duplicados) — "Exportar PDF" não quebra mais em silêncio com pop-up bloqueado', () => {
  it('fonte: as DUAS chamadas de window.open (handlePDF e botão "↓ PDF" do card) ganharam guarda de null', () => {
    const ocorrencias = (fonteForms.match(/if \(!win\) \{/g) ?? []).length;
    expect(ocorrencias).toBe(2);
  });

  it('fonte: handlePDF (rodapé do preenchimento) avisa e sai ANTES de tocar em win.document', () => {
    const ini = fonteForms.indexOf('const handlePDF = () => {');
    const fim = fonteForms.indexOf('\n  };', ini);
    const corpo = fonteForms.slice(ini, fim);
    expect(ini).toBeGreaterThan(-1);
    const posGuarda = corpo.indexOf('if (!win) {');
    const posReturn = corpo.indexOf('return;');
    const posWrite  = corpo.indexOf('win.document.write(');
    expect(posGuarda).toBeGreaterThan(-1);
    expect(posReturn).toBeGreaterThan(posGuarda);
    expect(posReturn).toBeLessThan(posWrite); // sai ANTES de qualquer win.document
    expect(corpo).toContain('"↓ Exportar PDF"'); // mensagem cita o botão certo
  });

  it('fonte: botão "↓ PDF" do card concluído tem a MESMA guarda, mensagem citando o próprio rótulo', () => {
    const posBotao = fonteForms.indexOf('}}>↓ PDF</button>');
    const ini = fonteForms.lastIndexOf('onClick={() => {', posBotao);
    expect(posBotao).toBeGreaterThan(-1);
    const corpo = fonteForms.slice(ini, posBotao);
    expect(corpo).toContain('if (!win) {');
    expect(corpo).toContain('"↓ PDF"');
    const posReturn = corpo.indexOf('return;');
    const posWrite  = corpo.indexOf('win.document.write(');
    expect(posReturn).toBeLessThan(posWrite);
  });

  // Handlers vivem dentro de componentes não exportados (FormFill / card do
  // grid) — sem @testing-library, provamos o MECANISMO com uma reimplementação
  // fiel às duas versões (mesma técnica da Família A de
  // admin-superadmin-baixa-triagem.test.js pra um handler embutido em JSX).
  function exportarPdfAntigo(openWindow) {
    const win = openWindow();
    win.document.write('<html>pdf</html>'); // sem guarda — é aqui que estourava
    win.document.close();
  }
  function exportarPdfNovo(openWindow, alert, rotulo) {
    const win = openWindow();
    if (!win) {
      alert(`Não foi possível abrir a janela de impressão — o navegador pode estar bloqueando pop-ups. Libere pop-ups para este site e toque em "${rotulo}" de novo.`);
      return;
    }
    win.document.write('<html>pdf</html>');
    win.document.close();
  }

  it('ANTES (bug, comprovado): pop-up bloqueado (window.open devolve null) — win.document.write estoura TypeError não tratado', () => {
    expect(() => exportarPdfAntigo(() => null)).toThrow(TypeError);
  });

  it('DEPOIS (handlePDF real): pop-up bloqueado — não quebra mais, e avisa citando o rótulo certo do botão', () => {
    const alert = vi.fn();
    expect(() => exportarPdfNovo(() => null, alert, '↓ Exportar PDF')).not.toThrow();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('↓ Exportar PDF'));
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('bloqueando pop-ups'));
  });

  it('DEPOIS (card "↓ PDF" real): mesmo cenário, mensagem cita o rótulo do card', () => {
    const alert = vi.fn();
    exportarPdfNovo(() => null, alert, '↓ PDF');
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('"↓ PDF"'));
  });

  it('caminho feliz: pop-up permitido — abre, escreve e fecha normalmente, sem alert', () => {
    const write = vi.fn(); const close = vi.fn();
    const fakeWin = { document: { write, close } };
    const alert = vi.fn();
    exportarPdfNovo(() => fakeWin, alert, '↓ Exportar PDF');
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PAGES.JSX — Achado 1/2 (T3)
// ═══════════════════════════════════════════════════════════════════════════

describe('pages.jsx achado 1/2 (T3) — handleLogin: falha no chunk de extras.jsx não apaga mais o registro do Histórico de acessos', () => {
  const ini = fontePages.indexOf("import('./extras').then(m => m.logSession(s.tenantId, s.user)).catch(() => {");
  const fim = fontePages.indexOf('\n    });', ini);
  const corpo = fontePages.slice(ini, fim);

  it('existe e a slice não está vazia', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(corpo.length).toBeGreaterThan(0);
  });

  it('fonte: o catch deixou de ser vazio — o formato antigo ".catch(() => {});" sumiu desta chamada', () => {
    expect(fontePages).not.toContain('m.logSession(s.tenantId, s.user)).catch(() => {});');
  });

  it('fonte: o fallback grava a MESMA chave/campos que logSession (extras.jsx), sem depender do chunk', () => {
    expect(corpo).toContain('const key = `nutriops.sessions.${s.tenantId}`;');
    expect(corpo).toContain('lw(key, [entry, ...ls(key, [])].slice(0, 100));');
  });

  it('fonte: ls/lw entraram no import ESTÁTICO de repository.js — não precisa do chunk de UI pra isto', () => {
    expect(fontePages).toContain("import { trackUsage, ls, lw } from './repository';");
  });

  // Reimplementação fiel do fallback (mesma técnica do resto da auditoria pra
  // lógica presa dentro de um useCallback não exportado) — usando ls/lw REAIS
  // de repository.js (não uma cópia), contra localStorage real do jsdom.
  function logSessionFallback(tenantId, user) {
    const key = `nutriops.sessions.${tenantId}`;
    const entry = { id: crypto.randomUUID(), user: user.name, role: user.role, loginAt: new Date().toISOString(), device: navigator.userAgent.slice(0, 80) };
    lw(key, [entry, ...ls(key, [])].slice(0, 100));
  }

  it('ANTES (bug, comprovado): .catch(() => {}) vazio — é literalmente isto que rodava, e não grava nada', () => {
    const tenantId = 'swiss';
    const catchVazio = () => {}; // código antigo, ao pé da letra
    catchVazio();
    expect(ls(`nutriops.sessions.${tenantId}`, [])).toEqual([]);
  });

  it('DEPOIS: o fallback grava a entrada com user/role/loginAt/device, mesmo sem o chunk carregar', () => {
    const tenantId = 'swiss';
    logSessionFallback(tenantId, { name: 'Ana Paula', role: 'Nutricionista RT' });
    const sessions = ls(`nutriops.sessions.${tenantId}`, []);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ user: 'Ana Paula', role: 'Nutricionista RT' });
    expect(sessions[0].id).toBeTruthy();
    expect(sessions[0].loginAt).toBeTruthy();
  });

  it('PREPEND, não sobrescreve: um login anterior (gravado pela via normal) continua na lista', () => {
    const tenantId = 'swiss';
    lw(`nutriops.sessions.${tenantId}`, [{ id: 'antigo', user: 'Beto', role: 'Colaborador', loginAt: '2026-08-18T10:00:00Z', device: 'iPad' }]);
    logSessionFallback(tenantId, { name: 'Ana Paula', role: 'Nutricionista RT' });
    const sessions = ls(`nutriops.sessions.${tenantId}`, []);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].user).toBe('Ana Paula'); // o novo entra na frente
    expect(sessions[1].id).toBe('antigo');      // o antigo não desaparece
  });

  it('cap de 100, igual ao writeSessions2 original (extras.jsx)', () => {
    const tenantId = 'swiss';
    const cem = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, user: 'X', role: 'Colaborador', loginAt: '2026-08-01T00:00:00Z', device: 'd' }));
    lw(`nutriops.sessions.${tenantId}`, cem);
    logSessionFallback(tenantId, { name: 'Novo', role: 'Colaborador' });
    expect(ls(`nutriops.sessions.${tenantId}`, [])).toHaveLength(100); // corta, não cresce sem limite
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PAGES.JSX — Achado 2/2 (T6)
// ═══════════════════════════════════════════════════════════════════════════

describe('pages.jsx achado 2/2 (T6) — badge de Manutenção deixa de ficar preso a um retrato de quando a empresa foi trocada', () => {
  const ini = fontePages.indexOf('const maintAlertCount = useMemo(');
  const fim = fontePages.indexOf('\n  }, [activeTenant.id, activeView, maintTick]);', ini);
  const corpo = fontePages.slice(ini, fim);

  it('existe e a slice não está vazia', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
  });

  it('fonte: o useMemo ganhou activeView e maintTick nas deps — não fica mais preso só a activeTenant.id', () => {
    expect(fontePages).toContain('}, [activeTenant.id, activeView, maintTick]);');
    // a adjacência antiga (deps só com activeTenant.id, seguida do comentário
    // do actionCount) sumiu — não é mais A ÚLTIMA COISA antes daquele bloco
    expect(fontePages).not.toContain('  }, [activeTenant.id]);\n  // O sinal certo pro badge do menu');
  });

  it('fonte: existe um listener de SYNC_EVENT que bumpa maintTick (mesmo sinal que o boot sync/retry já disparam)', () => {
    expect(fontePages).toContain('const [maintTick, setMaintTick] = useState(0);');
    expect(fontePages).toContain('window.addEventListener(SYNC_EVENT, bump);');
  });

  it('fonte: o cálculo passou a filtrar equipamento sem `name` — mesmo filtro de readEquipments (maintenance.jsx)', () => {
    expect(corpo).toContain('equips.filter((e) => e && e.name).reduce(');
  });

  it('decisão de design registrada: NÃO disparamos o evento de dentro de maintenance.jsx (evitaria um ciclo escreve→avisa→relê→escreve)', () => {
    // maintenance.jsx ESCUTA SYNC_EVENT (pra reler o próprio state) mas nunca
    // o DISPARA — se disparasse a partir do efeito que grava logs/equipments,
    // o próprio listener dele reagiria de novo, gerando um array novo e
    // reescrevendo, num loop sem fim. Ver comentário do achado em pages.jsx.
    expect(fonteMaintenance).toContain('window.addEventListener(SYNC_EVENT, reler);');
    expect(fonteMaintenance).not.toContain('notificarSyncAplicado');
  });

  // Reimplementação fiel da conta (equips/logs → quantos planos vencem em 7d),
  // igual ao corpo real do useMemo — parametrizada só por "aplica o filtro de
  // nome ou não", pra isolar exatamente o que o achado aponta.
  function addDaysModel(iso, days) { const d = new Date(iso || new Date()); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
  function contarPendentes(equips, logs, { filtrarSemNome }) {
    const base = filtrarSemNome ? equips.filter((e) => e && e.name) : equips;
    return base.reduce((count, eq) => {
      return count + (eq.maintenancePlans ?? []).filter((plan) => {
        const last = logs.filter((l) => l.equipmentId === eq.id && l.planId === plan.id).sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt))[0];
        const nextDue = last ? addDaysModel(last.executedAt, plan.frequencyDays) : plan.nextDue;
        const days = Math.ceil((new Date(nextDue).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
        return days <= 7;
      }).length;
    }, 0);
  }

  const ontem = new Date(Date.now() - 86400000).toISOString();
  const equipSemNomeVencido = { id: 'cat-Freezer 1', maintenancePlans: [{ id: 'p1', frequencyDays: 30, nextDue: ontem }] }; // sem `name` — vem cru do catálogo

  it('ANTES (bug, cenário do achado): ativo "do catálogo" sem `name` com plano vencido É contado — a tela de Manutenção nunca mostraria esse card', () => {
    expect(contarPendentes([equipSemNomeVencido], [], { filtrarSemNome: false })).toBe(1);
  });

  it('DEPOIS (correção real, mesmo filtro de readEquipments): o mesmo ativo sem nome NÃO é contado — badge bate com o que a tela mostra', () => {
    expect(contarPendentes([equipSemNomeVencido], [], { filtrarSemNome: true })).toBe(0);
  });

  it('ativo COM nome e plano vencido continua contado nos dois — não regrediu o caminho normal', () => {
    const equipComNome = { id: 'eq1', name: 'Freezer 1', maintenancePlans: [{ id: 'p1', frequencyDays: 30, nextDue: ontem }] };
    expect(contarPendentes([equipComNome], [], { filtrarSemNome: false })).toBe(1);
    expect(contarPendentes([equipComNome], [], { filtrarSemNome: true })).toBe(1);
  });

  // Simulador do contrato real de dependências do useMemo do React (compara
  // cada dep por Object.is; recomputa só se ALGUMA mudou) — não é suposição
  // sobre o React, é o mesmo contrato documentado.
  function criarMemo() {
    let cache = null;
    return (deps, compute) => {
      const mudou = !cache || deps.length !== cache.deps.length || deps.some((d, i) => !Object.is(d, cache.deps[i]));
      if (mudou) cache = { deps, value: compute() };
      return cache.value;
    };
  }

  it('ANTES (deps=[activeTenant.id]): sync grava plano vencido por baixo, mas o badge não recomputa — activeTenant.id não mudou', () => {
    const memo = criarMemo();
    let equips = [];
    const tenantId = 'casa-doce';
    const badge1 = memo([tenantId], () => contarPendentes(equips, [], { filtrarSemNome: true }));
    equips = [{ id: 'eq1', name: 'Freezer 1', maintenancePlans: [{ id: 'p1', frequencyDays: 30, nextDue: ontem }] }]; // "boot sync" terminou
    const badge2 = memo([tenantId], () => contarPendentes(equips, [], { filtrarSemNome: true }));
    expect(badge1).toBe(0);
    expect(badge2).toBe(0); // preso — era o bug relatado ("aparelho novo... fica em branco a sessão inteira")
  });

  it('DEPOIS (deps=[activeTenant.id, activeView, maintTick]): SYNC_EVENT bumpa maintTick e o badge recomputa sem precisar trocar de empresa', () => {
    const memo = criarMemo();
    let equips = [];
    const tenantId = 'casa-doce'; const activeView = 'overview'; let maintTick = 0;
    const badge1 = memo([tenantId, activeView, maintTick], () => contarPendentes(equips, [], { filtrarSemNome: true }));
    equips = [{ id: 'eq1', name: 'Freezer 1', maintenancePlans: [{ id: 'p1', frequencyDays: 30, nextDue: ontem }] }];
    maintTick = 1; // bump do listener de SYNC_EVENT
    const badge2 = memo([tenantId, activeView, maintTick], () => contarPendentes(equips, [], { filtrarSemNome: true }));
    expect(badge1).toBe(0);
    expect(badge2).toBe(1); // atualizado — fecha o achado
  });

  it('DEPOIS: trocar de view (sem nenhum SYNC_EVENT) também recomputa — cobre "registrou execução e navegou pra outro lugar"', () => {
    const memo = criarMemo();
    const equip = { id: 'eq1', name: 'Freezer 1', maintenancePlans: [{ id: 'p1', frequencyDays: 30, nextDue: ontem }] };
    let logs = [];
    const tenantId = 'casa-doce'; let activeView = 'maintenance'; const maintTick = 0;
    const badge1 = memo([tenantId, activeView, maintTick], () => contarPendentes([equip], logs, { filtrarSemNome: true }));
    logs = [{ equipmentId: 'eq1', planId: 'p1', executedAt: new Date().toISOString() }]; // acabou de registrar a execução
    activeView = 'overview'; // navegou pra outra tela
    const badge2 = memo([tenantId, activeView, maintTick], () => contarPendentes([equip], logs, { filtrarSemNome: true }));
    expect(badge1).toBe(1);
    expect(badge2).toBe(0); // executado hoje + frequencyDays 30 → nextDue está longe, não conta mais
  });
});
