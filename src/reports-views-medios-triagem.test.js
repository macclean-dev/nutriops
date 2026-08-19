import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTemperatura } from './limits';
import { shouldWarnPendingCorrection, visibleRtValidations } from './reports-views';

const fonte = readFileSync(`${process.cwd()}/src/reports-views.jsx`, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 7 achados de gravidade MÉDIA sem perda de dado que
// apontam pra src/reports-views.jsx (pool de 169 não-julgados da auditoria de
// falha silenciosa, 18-19/08). 3 citações (PDF da Auditoria / PDF executivo do
// Dashboard / a "coerência" que junta as duas — mesmo `window.open` sem
// guarda de null, em 2 lugares) são o MESMO bug visto por lentes diferentes —
// viram 1 família com 2 correções gêmeas. As outras 4 citações são 4 famílias
// distintas, todas com bug real:
//
//   · Família 1 (achado "vírgula") — submitCorrection usava Number() puro;
//     teclado decimal em pt-BR entrega vírgula, Number('4,5') é NaN, e o
//     `disabled` do botão só olhava o motivo — ficava habilitado sem fazer
//     nada. Efeito colateral: campo vazio (Number('')===0) gravava 0°C calado.
//   · Família 2 (achados "PDF trava") — window.open(...) sem guarda de null
//     em exportPDF (Auditoria) e printDashboard (Dashboard executivo).
//   · Família 3 (achado "correção não avisa falha") — repository.update nunca
//     lança; falha online (RLS/sessão/timeout) vira `_pending:true` igual ao
//     caso offline, e submitCorrection nem capturava o retorno — a tela
//     mostrava "corrigido" idêntico ao sucesso mesmo quando a nuvem recusou.
//   · Família 4 (achado "correção some com período Todos") — extraRecords é
//     buscado à parte da prop `records` e não se atualiza sozinho: a correção
//     gravava de verdade mas a linha só mudava trocando o filtro ou com F5.
//   · Família 5 (achado "assinatura RT em N lojas") — saveValidation cria 1
//     validação por loja presente no período; a tira de chips cortava em
//     slice(0,3) (escondia a 4ª sem avisar), nunca mostrava de qual loja era
//     cada chip, e ignorava o filtro "Empresa" da tela.
// ─────────────────────────────────────────────────────────────────────────────

describe('Família 1 — vírgula decimal na correção de leitura (achado 0)', () => {
  it('submitCorrection usa parseTemperatura, não Number puro', () => {
    const ini = fonte.indexOf('const submitCorrection = async (r) => {');
    const fim = fonte.indexOf('const saveValidation = (note) => {');
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('const val = parseTemperatura(correctionValue);');
    expect(corpo).not.toMatch(/const val = Number\(correctionValue\)/);
  });

  it('parseTemperatura aceita vírgula onde Number rejeitava — a causa raiz do botão mudo', () => {
    expect(Number('4,5')).toBeNaN();               // documenta o defeito original
    expect(parseTemperatura('4,5')).toBe(4.5);      // a correção
    expect(parseTemperatura('-18,5')).toBe(-18.5);
  });

  it('campo vazio não vira 0°C silencioso — Number("") é 0, parseTemperatura("") é NaN', () => {
    expect(Number('')).toBe(0);                     // documenta o efeito colateral original
    expect(isNaN(parseTemperatura(''))).toBe(true);  // a correção bloqueia o Salvar
  });

  it('correctionInvalid é calculado com parseTemperatura, e entra no `disabled` do botão Salvar', () => {
    expect(fonte).toContain('const correctionInvalid = isNaN(parseTemperatura(correctionValue));');
    const ini = fonte.indexOf('{isRT && correctingId === r.id && (');
    const fim = fonte.indexOf('{isRT && correctingId !== r.id && (');
    const bloco = fonte.slice(ini, fim);
    expect(bloco).toMatch(/disabled=\{correctionSaving \|\| !correctionReason\.trim\(\) \|\| correctionInvalid\}/);
  });

  it('tem botão de trocar sinal — sem ele, digitar negativo no teclado decimal (sem tecla de menos) é impossível', () => {
    const ini = fonte.indexOf('{isRT && correctingId === r.id && (');
    const fim = fonte.indexOf('{isRT && correctingId !== r.id && (');
    const bloco = fonte.slice(ini, fim);
    expect(bloco).toContain('title="Trocar sinal (+/−)"');
    expect(bloco).toMatch(/setCorrectionValue\(\(v\) => v\.startsWith\('-'\)/);
  });
});

describe('Família 2 — PDF estoura em silêncio com pop-up bloqueado (achados 1+2+3)', () => {
  it('exportPDF (Auditoria) guarda window.open contra null antes do document.write', () => {
    const ini = fonte.indexOf('const exportPDF = () => {');
    const fim = fonte.indexOf('const tl = {');
    const corpo = fonte.slice(ini, fim);
    const posWin = corpo.indexOf("window.open('', '_blank')");
    const posGuarda = corpo.indexOf('if (!win)');
    const posWrite = corpo.indexOf('win.document.write(');
    expect(posWin).toBeGreaterThan(-1);
    expect(posGuarda).toBeGreaterThan(posWin);
    expect(posWrite).toBeGreaterThan(posGuarda);
    expect(corpo).toContain('window.alert(');
  });

  it('printDashboard (Dashboard executivo) guarda window.open contra null antes do document.write', () => {
    const ini = fonte.indexOf('const printDashboard = () => {');
    const fim = fonte.indexOf('return (', ini);
    const corpo = fonte.slice(ini, fim);
    const posWin = corpo.indexOf("window.open('', '_blank')");
    const posGuarda = corpo.indexOf('if (!win)');
    const posWrite = corpo.indexOf('win.document.write(');
    expect(posWin).toBeGreaterThan(-1);
    expect(posGuarda).toBeGreaterThan(posWin);
    expect(posWrite).toBeGreaterThan(posGuarda);
    expect(corpo).toContain('window.alert(');
  });

  it('as duas guardas avisam a pessoa em vez de só engolir o erro (mesmo padrão de dossie-view.jsx)', () => {
    expect((fonte.match(/if \(!win\) \{ window\.alert\(/g) ?? []).length).toBe(2);
  });
});

describe('Família 3 — correção que a nuvem recusa mostra "corrigido" igual ao sucesso (achado 4)', () => {
  it('shouldWarnPendingCorrection só avisa quando pendente E online — offline é o comportamento esperado (fila)', () => {
    expect(shouldWarnPendingCorrection({ _pending: true }, true)).toBe(true);
    expect(shouldWarnPendingCorrection({ _pending: true }, false)).toBe(false);
    expect(shouldWarnPendingCorrection({ _pending: false }, true)).toBe(false);
    expect(shouldWarnPendingCorrection({ value: -18 }, true)).toBe(false); // sucesso online: sem _pending
    expect(shouldWarnPendingCorrection(null, true)).toBe(false);
    expect(shouldWarnPendingCorrection(undefined, true)).toBe(false);
  });

  it('submitCorrection captura o retorno de repository.update (antes era descartado) e usa a decisão acima', () => {
    const ini = fonte.indexOf('const submitCorrection = async (r) => {');
    const fim = fonte.indexOf('const saveValidation = (note) => {');
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('const result = await repository.update(r.id, r.tenantId, patch);');
    expect(corpo).not.toMatch(/^\s*await repository\.update\(r\.id, r\.tenantId, \{/m);
    expect(corpo).toContain('shouldWarnPendingCorrection(result, navigator.onLine)');
    expect(corpo).toContain('window.alert(');
  });
});

describe('Família 4 — correção não aparece com "Período: Todos" (achado 5)', () => {
  it('submitCorrection atualiza extraRecords pelo id, não só a prop `records`', () => {
    const ini = fonte.indexOf('const submitCorrection = async (r) => {');
    const fim = fonte.indexOf('const saveValidation = (note) => {');
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('setExtraRecords((prev) => prev?.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) ?? prev);');
  });

  it('o useEffect que busca extraRecords continua sem `records`/`extraRecords` nas deps — evita loop de refetch', () => {
    // O conserto certo é local (setExtraRecords direto, teste acima). Se
    // alguém "consertar de novo" um dia adicionando records/extraRecords às
    // deps deste efeito pra forçar o refresh, ele reconsulta a nuvem em loop
    // a cada patch local que o próprio efeito causa.
    const ini = fonte.indexOf('useEffect(() => {\n    let cancelled = false;');
    const fim = fonte.indexOf('const effectiveRecords');
    const corpo = fonte.slice(ini, fim);
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain('}, [periodFilter, tenantFilter, allTenants, repository]);');
  });
});

describe('Família 5 — assinatura RT em N lojas: chips escondiam a 4ª e não diziam de qual loja (achado 6)', () => {
  const v = (tenantId, at, extra = {}) => ({ id: `${tenantId}-${at}`, tenantId, by: 'Fran', role: 'Nutricionista RT', at, recordCount: 10, note: '', ...extra });

  it('4 lojas assinadas de uma vez → 4 chips, não 3 (sem cap fixo escondendo a 4ª)', () => {
    const rtValidations = [
      v('swiss',    '2026-08-19T10:00:00.000Z'),
      v('backerei', '2026-08-19T10:00:01.000Z'),
      v('dbk',      '2026-08-19T10:00:02.000Z'),
      v('casadoce', '2026-08-19T10:00:03.000Z'),
    ];
    expect(visibleRtValidations(rtValidations, 'all')).toHaveLength(4);
  });

  it('respeita o filtro de Empresa — não mostra o chip de outra loja', () => {
    const rtValidations = [v('swiss', '2026-08-19T10:00:00.000Z'), v('backerei', '2026-08-19T10:00:01.000Z')];
    const out = visibleRtValidations(rtValidations, 'backerei');
    expect(out).toHaveLength(1);
    expect(out[0].tenantId).toBe('backerei');
  });

  it('dedup por loja: a validação mais recente vence, independente da ordem de entrada', () => {
    const velha = v('swiss', '2026-08-01T00:00:00.000Z', { recordCount: 3 });
    const nova  = v('swiss', '2026-08-19T00:00:00.000Z', { recordCount: 40 });
    expect(visibleRtValidations([velha, nova], 'all')).toEqual([nova]);
    expect(visibleRtValidations([nova, velha], 'all')).toEqual([nova]);
  });

  it('ordena as mais recentes primeiro', () => {
    const antiga  = v('swiss',    '2026-08-01T00:00:00.000Z');
    const recente = v('backerei', '2026-08-19T00:00:00.000Z');
    const out = visibleRtValidations([antiga, recente], 'all');
    expect(out.map(x => x.tenantId)).toEqual(['backerei', 'swiss']);
  });

  it('lista vazia não quebra', () => {
    expect(visibleRtValidations([], 'all')).toEqual([]);
  });

  it('a tela usa visibleValidations (não mais o corte fixo rtValidations.slice(0,3)) e mostra o nome da loja', () => {
    expect(fonte).not.toContain('rtValidations.slice(0,3)');
    expect(fonte).toContain('{visibleValidations.map(v =>');
    expect(fonte).toContain("allTenants.find(t => t.id === v.tenantId)?.name ?? 'Empresa removida'");
  });
});
