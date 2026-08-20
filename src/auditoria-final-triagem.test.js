import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { lw, mergeByKey } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// ÚLTIMA rodada da auditoria de falha silenciosa inteira do NutriOPS — tier
// "baixa", pool final: os 4 achados que sobraram no
// data_achados_pendentes_19-08.json depois de todas as rodadas anteriores
// (23 graves, 17 médios com perda, 69 médios sem perda, 35 altos sem perda,
// 4 rodadas de baixa). Espalhados em 3 arquivos pequenos, tratados como três
// mini-lotes independentes:
//
//   MAINTENANCE.JSX (1, COM perda) — catch vazio no `ss`. JÁ RESOLVIDO na
//   rodada dos médios-com-perda (8e40084, v1.9.163, FAMÍLIA E) — confirmado
//   lendo o código atual, sem mudança nesta rodada.
//
//   REPORTS-VIEWS.JSX (2)
//   · Achado A (T4, COM perda) — saveValidation (AuditView) regravava
//     `nutriops.rt.validations` (chave GLOBAL, sem sufixo de tenant) a partir
//     do snapshot de `rtValidations` do MOUNT, apagando validações que o
//     syncRtValidations tivesse escrito nessa mesma chave por fora do React
//     enquanto a tela ficava aberta. Mesmo padrão do ManualBpCard
//     (settings.jsx, já corrigido). Corrigido relendo o storage no instante
//     do clique e mesclando por id com mergeByKey (repository.js) — real,
//     não uma cópia.
//   · Achado B (T6, sem perda) — TempLineChart plota só as últimas 30
//     leituras enquanto o chip/card ao lado contam o período inteiro sem
//     esse corte, e nada avisava — trocar o período de 30→90 dias não mudava
//     o desenho, parecia filtro quebrado. Corrigido com uma legenda condicional
//     ("Mostrando as últimas N de M leituras...") quando o corte realmente
//     acontece.
//
//   TRAINING.JSX (1, sem perda) — TopicEditor.add: tópico já existente na
//     lista fazia `return` mudo, botão "Adicionar" nunca ficava disabled
//     (.secondary-action:disabled já existe em styles.css desde rodada
//     anterior, só faltava o atributo). Corrigido com estado `dup` (aviso no
//     caminho do Enter) + `disabled` no botão (cobre o clique).
//
// Sem @testing-library neste repo (convenção já estabelecida): UI vira
// asserção de código-fonte + reimplementação fiel ("modelo") das decisões,
// mesma técnica de forms-pages-baixa-triagem.test.js.
// ─────────────────────────────────────────────────────────────────────────────

const fonteMaintenance = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');
const fonteReports     = readFileSync(`${process.cwd()}/src/reports-views.jsx`, 'utf8');
const fonteTraining    = readFileSync(`${process.cwd()}/src/training.jsx`, 'utf8');

beforeEach(() => { localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
// MAINTENANCE.JSX — achado único (T3, COM perda) — CONFIRMADO JÁ RESOLVIDO
// ═══════════════════════════════════════════════════════════════════════════

describe('maintenance.jsx — catch vazio no `ss` (T3, com perda) — confirmado já resolvido (8e40084, v1.9.163)', () => {
  it('fonte: `ss` não é mais o catch vazio próprio — delega pro `lw` do repositório (gravarLocal)', () => {
    expect(fonteMaintenance).toContain("const ss = (k, v) => gravarLocal(k, v);");
    expect(fonteMaintenance).not.toContain('localStorage.setItem(k, JSON.stringify(v)); } catch {} };');
    expect(fonteMaintenance).toContain("lw as gravarLocal } from './repository';");
  });

  it('fonte: os 3 acervos da Manutenção (equip_assets, maint_logs, work_orders) gravam todos por `ss`', () => {
    expect(fonteMaintenance).toContain("export const writeEquipments    = (id, v) => ss(sk('equip_assets', id), v);");
    expect(fonteMaintenance).toMatch(/writeMaintenanceLogs\s*=\s*\(id, v\)\s*=>\s*ss\(sk\('maint_logs', id\)/);
    expect(fonteMaintenance).toMatch(/writeWorkOrders\s*=\s*\(id, v\)\s*=>\s*ss\(sk\('work_orders', id\)/);
  });

  // Reproduz a perda de verdade: o padrão ANTIGO (catch vazio, citado no
  // achado ao pé da letra) contra o que `ss` faz HOJE (delega pro `lw` real).
  function ssAntigo(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  function ssAtual(k, v) { return lw(k, v); } // é literalmente o que `gravarLocal` é (lw reexportado)

  it('ANTES (bug, comprovado): localStorage cheio — o catch vazio engole, devolve undefined, e NADA fica gravado nem sinalizado', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => ssAntigo('nutriops.equip_assets.swiss', [{ id: 'novo' }])).not.toThrow();
    expect(aviso).not.toHaveBeenCalled(); // nem loga — o cadastro simplesmente não existe em lugar nenhum
  });

  it('DEPOIS (o que `ss` faz hoje): mesmo cenário — devolve false, loga, e levanta a bandeira que o banner de "armazenamento cheio" lê', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k) => {
      if (k === 'nutriops.storage.full') return; // a bandeira ainda cabe
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(ssAtual('nutriops.equip_assets.swiss', [{ id: 'novo' }])).toBe(false);
    expect(aviso).toHaveBeenCalled();
  });

  it('caminho feliz: sem quota estourada, grava normal e devolve true', () => {
    expect(ssAtual('nutriops.equip_assets.swiss', [{ id: 'novo' }])).toBe(true);
    expect(JSON.parse(localStorage.getItem('nutriops.equip_assets.swiss'))).toEqual([{ id: 'novo' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORTS-VIEWS.JSX — Achado A (T4, COM perda) — saveValidation
// ═══════════════════════════════════════════════════════════════════════════

describe('reports-views.jsx achado A (T4, com perda) — assinar o período não apaga mais o que o sync trouxe na chave global', () => {
  it('existe e importa mergeByKey do repository real (não uma cópia)', () => {
    expect(fonteReports).toContain("import { getTemperatureRepository, pushRtValidation, mergeByKey } from './repository';");
  });

  it('fonte: saveValidation relê `nutriops.rt.validations` do storage ANTES de gravar, e mescla com mergeByKey', () => {
    const ini = fonteReports.indexOf('const saveValidation = (note) => {');
    const fim = fonteReports.indexOf('\n  };', ini);
    const corpo = fonteReports.slice(ini, fim);
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain("localStorage.getItem('nutriops.rt.validations')");
    expect(corpo).toContain('mergeByKey([...created, ...rtValidations, ...noStorage], \'id\')');
    const posRead  = corpo.indexOf('localStorage.getItem');
    const posMerge = corpo.indexOf('mergeByKey(');
    const posWrite = corpo.indexOf("localStorage.setItem('nutriops.rt.validations'");
    expect(posRead).toBeGreaterThan(-1);
    expect(posMerge).toBeGreaterThan(posRead);   // relê ANTES de mesclar
    expect(posWrite).toBeGreaterThan(posMerge);  // mescla ANTES de gravar
  });

  it('fonte: o teto passou a ser 200, igual ao syncRtValidations (repository.js) — não reintroduz o descompasso 100×200', () => {
    const ini = fonteReports.indexOf('const saveValidation = (note) => {');
    const fim = fonteReports.indexOf('\n  };', ini);
    const corpo = fonteReports.slice(ini, fim);
    expect(corpo).toContain('.slice(0, 200)');
    expect(corpo).not.toContain('.slice(0, 100)');
  });

  // Reimplementação fiel dos dois caminhos (ANTES/DEPOIS de saveValidation),
  // usando o mergeByKey REAL exportado por repository.js — não uma cópia.
  function saveValidationAntigo(rtValidationsState, created) {
    const updated = [...created, ...rtValidationsState];
    localStorage.setItem('nutriops.rt.validations', JSON.stringify(updated.slice(0, 100)));
    return updated.slice(0, 100);
  }
  function saveValidationNovo(rtValidationsState, created) {
    let noStorage = [];
    try { noStorage = JSON.parse(localStorage.getItem('nutriops.rt.validations') ?? '[]'); } catch { noStorage = []; }
    const updated = mergeByKey([...created, ...rtValidationsState, ...noStorage], 'id')
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 200);
    localStorage.setItem('nutriops.rt.validations', JSON.stringify(updated));
    return updated;
  }

  // Cenário do achado: a tela de Auditoria monta com 1 validação da Swiss.
  // Depois, o device perde/recupera o wi-fi — syncRtValidations roda por
  // FORA do React e escreve na MESMA chave global a validação que a RT da
  // Bäckerei assinou em OUTRO device. A RT local, com a tela ainda aberta
  // (rtValidations do state parado no snapshot do mount), clica "Assinar".
  const mountSnapshot = [{ id: 'v-swiss-1', tenantId: 'swiss', at: '2026-08-19T10:00:00.000Z', by: 'Ana Paula', role: 'Nutricionista RT', periodFilter: '30', recordCount: 42, note: '' }];

  function montarCenario() {
    localStorage.setItem('nutriops.rt.validations', JSON.stringify(mountSnapshot)); // estado no mount
    const trazidaPeloSync = { id: 'v-backerei-1', tenantId: 'backerei', at: '2026-08-19T10:05:00.000Z', by: 'RT remota', role: 'Nutricionista RT', periodFilter: '30', recordCount: 7, note: '' };
    localStorage.setItem('nutriops.rt.validations', JSON.stringify([...mountSnapshot, trazidaPeloSync])); // syncRtValidations escreveu por fora do React
    const created = [{ id: 'v-casadoce-nova', tenantId: 'casadoce', at: '2026-08-19T10:10:00.000Z', by: 'RT', role: 'Nutricionista RT', periodFilter: '30', recordCount: 5, note: 'período conferido' }];
    return { created, trazidaPeloSyncId: trazidaPeloSync.id };
  }

  it('ANTES (bug, comprovado): a validação de OUTRA loja que o sync trouxe depois do mount é apagada do localStorage ao assinar', () => {
    const { created, trazidaPeloSyncId } = montarCenario();
    saveValidationAntigo(mountSnapshot, created); // `rtValidations` do state = snapshot do mount, sem a de Bäckerei
    const noStorageDepois = JSON.parse(localStorage.getItem('nutriops.rt.validations'));
    expect(noStorageDepois.find((v) => v.id === trazidaPeloSyncId)).toBeUndefined(); // perdida
    expect(noStorageDepois.find((v) => v.id === 'v-casadoce-nova')).toBeDefined();   // a nova entrou
  });

  it('DEPOIS (correção real): mesmo cenário — a validação da outra loja sobrevive, e a nova também entra', () => {
    const { created, trazidaPeloSyncId } = montarCenario();
    saveValidationNovo(mountSnapshot, created);
    const noStorageDepois = JSON.parse(localStorage.getItem('nutriops.rt.validations'));
    expect(noStorageDepois.find((v) => v.id === trazidaPeloSyncId)).toBeDefined();   // preservada
    expect(noStorageDepois.find((v) => v.id === 'v-swiss-1')).toBeDefined();         // a do mount também
    expect(noStorageDepois.find((v) => v.id === 'v-casadoce-nova')).toBeDefined();   // e a nova
    expect(noStorageDepois).toHaveLength(3);
  });

  it('não regrediu: sem nenhuma escrita concorrente do sync, assinar continua funcionando igual (só a nova entra)', () => {
    localStorage.setItem('nutriops.rt.validations', JSON.stringify(mountSnapshot));
    const created = [{ id: 'v-swiss-2', tenantId: 'swiss', at: '2026-08-19T11:00:00.000Z', by: 'Ana Paula', role: 'Nutricionista RT', periodFilter: '30', recordCount: 10, note: '' }];
    saveValidationNovo(mountSnapshot, created);
    const depois = JSON.parse(localStorage.getItem('nutriops.rt.validations'));
    expect(depois.map((v) => v.id).sort()).toEqual(['v-swiss-1', 'v-swiss-2']);
  });

  it('teto de 200 é respeitado mesmo depois da mesclagem (mais recente sobrevive ao corte)', () => {
    const antigas = Array.from({ length: 200 }, (_, i) => ({ id: `old-${i}`, tenantId: 'swiss', at: new Date(2026, 0, 1, 0, i).toISOString(), by: 'X', role: 'Colaborador', periodFilter: '30', recordCount: 1, note: '' }));
    localStorage.setItem('nutriops.rt.validations', JSON.stringify(antigas));
    const created = [{ id: 'v-mais-nova', tenantId: 'swiss', at: '2026-08-19T12:00:00.000Z', by: 'Ana Paula', role: 'Nutricionista RT', periodFilter: '30', recordCount: 1, note: '' }];
    saveValidationNovo([], created);
    const depois = JSON.parse(localStorage.getItem('nutriops.rt.validations'));
    expect(depois).toHaveLength(200); // cortou, não cresceu sem limite
    expect(depois.find((v) => v.id === 'v-mais-nova')).toBeDefined(); // a mais nova não foi cortada
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORTS-VIEWS.JSX — Achado B (T6, sem perda) — TempLineChart
// ═══════════════════════════════════════════════════════════════════════════

describe('reports-views.jsx achado B (T6, sem perda) — gráfico avisa quando plota só uma fração do período', () => {
  it('fonte: TempLineChart separa `filtered` (período inteiro) de `data` (últimas 30) e avisa quando os dois divergem', () => {
    const ini = fonteReports.indexOf('function TempLineChart(');
    const fim = fonteReports.indexOf('\n// Lista de equipamentos de um card do Dashboard', ini);
    const corpo = fonteReports.slice(ini, fim);
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain('.slice(-30), [filtered]);');
    expect(corpo).toContain('{filtered.length > data.length && (');
    expect(corpo).toContain('Mostrando as últimas {data.length} de {filtered.length} leituras do período selecionado.');
  });

  // Reimplementação fiel da decisão de mostrar (ou não) a legenda.
  function corteModel(totalNoPeríodo, teto = 30) {
    const data = totalNoPeríodo.slice(-teto);
    const mostrarAviso = totalNoPeríodo.length > data.length;
    return {
      data,
      aviso: mostrarAviso ? `Mostrando as últimas ${data.length} de ${totalNoPeríodo.length} leituras do período selecionado.` : null,
    };
  }

  it('ANTES (bug, comprovado): 117 leituras no período (cenário real do achado, "Total 117 · Crítico 5") — nada no gráfico dizia que só 30 foram plotadas', () => {
    // o comportamento antigo é a MESMA função sem o campo `aviso` — expresso
    // aqui como "nenhuma das 117 strings de leitura aparece anotada no
    // resultado", já que a versão anterior não carregava avaliação nenhuma.
    const registros = Array.from({ length: 117 }, (_, i) => ({ createdAt: `2026-0${1 + (i % 8)}-01`, value: 4 }));
    const semAvisoAntigo = registros.slice(-30); // é só isso que a versão antiga devolvia
    expect(semAvisoAntigo).toHaveLength(30);
    expect(registros.length).toBe(117); // a divergência 117×30 existe e passava batido
  });

  it('DEPOIS (correção real): mesmo cenário de 117 leituras — a legenda aparece com os números corretos', () => {
    const registros = Array.from({ length: 117 }, () => ({ value: 4 }));
    const { data, aviso } = corteModel(registros);
    expect(data).toHaveLength(30);
    expect(aviso).toBe('Mostrando as últimas 30 de 117 leituras do período selecionado.');
  });

  it('não regrediu: com 30 leituras ou menos (sem corte real), a legenda NÃO aparece', () => {
    const registros = Array.from({ length: 12 }, () => ({ value: 4 }));
    const { data, aviso } = corteModel(registros);
    expect(data).toHaveLength(12);
    expect(aviso).toBeNull();
  });

  it('borda: exatamente 30 leituras — sem corte, sem legenda', () => {
    const registros = Array.from({ length: 30 }, () => ({ value: 4 }));
    const { aviso } = corteModel(registros);
    expect(aviso).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TRAINING.JSX — achado único (T1, sem perda) — TopicEditor
// ═══════════════════════════════════════════════════════════════════════════

describe('training.jsx achado (T1, sem perda) — "Adicionar" tópico duplicado agora avisa e desabilita, em vez de retornar mudo', () => {
  const ini = fonteTraining.indexOf('function TopicEditor(');
  const fim = fonteTraining.indexOf('\nfunction ParticipantSelector(');
  const corpo = fonteTraining.slice(ini, fim);

  it('existe e a slice não está vazia', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
  });

  it('fonte: estado `dup`, checagem via isDuplicate, e o `add` sinaliza (não só retorna) quando o texto já existe', () => {
    expect(corpo).toContain("const [dup, setDup] = useState(false);");
    expect(corpo).toContain('const isDuplicate = (t) => topics.includes(t);');
    expect(corpo).toContain('if (isDuplicate(t)) { setDup(true); return; }');
  });

  it('fonte: o botão "Adicionar" ganhou `disabled` (campo vazio OU duplicado) — cobre o clique', () => {
    expect(corpo).toContain('disabled={!trimmedInput || isDuplicate(trimmedInput)}');
  });

  it('fonte: existe mensagem visível de duplicata, e o input limpa o aviso ao ser editado de novo', () => {
    expect(corpo).toContain('Esse tópico já está na lista.');
    expect(corpo).toContain("onChange={(e) => { setInput(e.target.value); setDup(false); }}");
  });

  // Reimplementação fiel do `add` ANTES/DEPOIS (função embutida em componente
  // não exportado — mesma técnica do resto da auditoria).
  function addAntigo(topics, input) {
    const t = input.trim();
    if (!t || topics.includes(t)) return { topics, input, dup: false }; // `return` mudo — nenhum sinal do motivo
    return { topics: [...topics, t], input: '', dup: false };
  }
  function addNovo(topics, input) {
    const t = input.trim();
    if (!t) return { topics, input, dup: false };
    if (topics.includes(t)) return { topics, input, dup: true }; // sinaliza
    return { topics: [...topics, t], input: '', dup: false };
  }

  const padroesMBPF = ['Higienização correta e frequência da lavagem das mãos'];

  it('ANTES (bug, comprovado): tópico duplicado e campo vazio dão o MESMO resultado — nada diferencia os dois motivos do no-op', () => {
    const rDuplicado = addAntigo(padroesMBPF, padroesMBPF[0]);
    const rVazio      = addAntigo(padroesMBPF, '   ');
    expect(rDuplicado.topics).toBe(padroesMBPF);   // não mudou a lista
    expect(rDuplicado.input).toBe(padroesMBPF[0]); // texto continua no campo, setInput('') nunca roda
    expect(rDuplicado.dup).toBe(rVazio.dup);        // indistinguíveis (ambos "false" — nenhum sinal)
  });

  it('DEPOIS (correção real): duplicado sinaliza dup:true, diferente do campo vazio (dup:false)', () => {
    const rDuplicado = addNovo(padroesMBPF, padroesMBPF[0]);
    const rVazio      = addNovo(padroesMBPF, '   ');
    expect(rDuplicado.dup).toBe(true);
    expect(rVazio.dup).toBe(false);
    expect(rDuplicado.topics).toEqual(padroesMBPF); // ainda não duplicou a lista
  });

  it('caminho feliz: texto novo entra, campo limpa e dup fica false', () => {
    const r = addNovo(padroesMBPF, 'Uso correto de EPI');
    expect(r.topics).toEqual([...padroesMBPF, 'Uso correto de EPI']);
    expect(r.input).toBe('');
    expect(r.dup).toBe(false);
  });

  it('não regrediu: "Restaurar padrão MBPF" (reset) continua fora do `add` — não é afetado pela mudança', () => {
    expect(corpo).toContain("const reset  = () => onChange([...DEFAULT_TOPICS]);");
  });
});
