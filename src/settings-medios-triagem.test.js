import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { latestManualBp, DOC_TYPES } from './compliance';
import { computeReadiness } from './readiness';
import { readFormRecords, writeFormRecords, writeFormTemplates } from './forms';
import { planejarDedupe, aplicarDedupe } from './forms-dedupe';
import { aplicarLimpezaFormularios, clearOfflineQueue } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 8 achados de gravidade MÉDIA sem perda de dado que
// apontam pra src/settings.jsx (pool de 169 não-julgados da auditoria de
// falha silenciosa, 18-19/08). Agrupados por família.
//
// Dois já estavam RESOLVIDOS por commits ANTERIORES desta mesma sessão, antes
// deste arquivo existir:
//   · "Restauração parcial anunciada como sucesso" (catch vazio no restore) —
//     corrigido em 8e40084 (v1.9.163, família C do pool "média COM perda de
//     dado" — o mesmo trecho tinha os dois defeitos, escopo e catch vazio).
//   · "Migração offline mostra '✓ undefined registros migrados'" — corrigido
//     em 49d2a11 (v1.9.168, item 2 do pool de repository.js).
// Ganham teste de trava aqui mesmo assim (bônus, mesmo padrão usado em
// repository-medios-triagem.test.js pros dois achados já resolvidos de lá).
//
// Os outros 6 achados viram 4 famílias com bug real:
//   · Item 0 — file input do backup nunca reseta: escolher o MESMO arquivo
//     duas vezes não dispara onChange na segunda vez.
//   · Item 3 — "Copiar SQL" sem .catch e sem checar se a Clipboard API existe.
//   · Itens 4+5+6 — ManualBpCard: MESMA causa raiz (a chave
//     nutriops.compliance.{tenantId} é lida uma vez no mount) citada por 3
//     lentes — (4) duas lojas offline nunca convergem porque a leitura pega a
//     PRIMEIRA entrada manual_bp, não a mais recente; (5)/(6) são o mesmo
//     achado duas vezes: salvar() regrava a chave INTEIRA a partir do
//     snapshot velho, apagando ASOs que o sync trouxe depois da montagem.
//   · Item 7 — LimpezaPlanilhasCard monta o plano no mount e aplica esse
//     plano velho ao clicar minutos depois; aplicarLimpezaFormularios regrava
//     records/templates por SUBSTITUIÇÃO (não merge), então um sync no meio
//     do caminho é apagado do aparelho — o oposto do que o confirm() promete.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/settings.jsx`, 'utf8');
const fonteReadiness = readFileSync(`${process.cwd()}/src/readiness.js`, 'utf8');

beforeEach(() => { localStorage.clear(); clearOfflineQueue(); });

describe('Já resolvido (8e40084) — restauração parcial não finge mais sucesso liso', () => {
  it('cada chave que falha entra em `falharam` com o motivo — catch não é mais vazio', () => {
    expect(fonte).toContain('catch (e) { falharam.push(key); console.warn(`[backup] não restaurou ${key}:`, e?.message); }');
    // a forma antiga: Object.entries(...).forEach(...) direto, sem filtrar por
    // doTenant e sem capturar o erro — só sobrava o catch{} vazio.
    expect(fonte).not.toMatch(/localStorage\.setItem\(key, JSON\.stringify\(value\)\); \} catch \{\}\s*\}\);/);
  });

  it('só alerta "restaurado" liso quando NADA falhou e nada foi ignorado', () => {
    const ini = fonte.indexOf('const handleImportBackup = (e) => {');
    const handler = fonte.slice(ini, fonte.indexOf('const handleMigrate = async'));
    expect(handler.indexOf('if (falharam.length) {')).toBeGreaterThan(-1);
    expect(handler.indexOf('PARCIALMENTE')).toBeGreaterThan(handler.indexOf('if (falharam.length) {'));
    expect(handler.indexOf("else if (ignoradas.length) {")).toBeGreaterThan(handler.indexOf('if (falharam.length) {'));
    expect(handler.indexOf("alert('✓ Backup restaurado! A página será recarregada.');"))
      .toBeGreaterThan(handler.indexOf('else if (ignoradas.length) {'));
  });
});

describe('Já resolvido (49d2a11) — "Migrar registros locais" não finge sucesso offline', () => {
  it('checa result.ok ANTES de formatar a mensagem de sucesso', () => {
    const ini = fonte.indexOf('const handleMigrate = async () => {');
    const handler = fonte.slice(ini, fonte.indexOf('const handleChangePin = ()'));
    const posCheck = handler.indexOf('if (!result.ok) {');
    const posPushed = handler.indexOf('${result.pushed} registros migrados');
    expect(posCheck).toBeGreaterThan(-1);
    expect(posPushed).toBeGreaterThan(posCheck); // só lê pushed/failed depois de garantir ok
  });

  it('mensagem offline não usa pushed/failed (que vinham undefined)', () => {
    expect(fonte).toContain("text:'Sem internet no momento — nada foi migrado. Tente de novo quando reconectar.'");
  });
});

describe('Item 0 — "Restaurar backup": reselecionar o MESMO arquivo agora funciona', () => {
  it('reseta e.target.value logo após capturar o arquivo, antes de começar a ler', () => {
    const ini = fonte.indexOf('const handleImportBackup = (e) => {');
    expect(ini).toBeGreaterThan(-1);
    const posFile = fonte.indexOf('const file = e.target.files?.[0];', ini);
    const posReset = fonte.indexOf("e.target.value = '';", ini);
    const posReader = fonte.indexOf('const reader = new FileReader();', ini);
    expect(posFile).toBeGreaterThan(ini);
    expect(posReset).toBeGreaterThan(posFile);
    expect(posReader).toBeGreaterThan(posReset); // reset ANTES de disparar a leitura assíncrona
  });
});

describe('Item 3 — "Copiar SQL": clipboard indisponível ou rejeitada agora avisa', () => {
  it('não chama writeText sem checar antes se a API existe (contexto inseguro = undefined)', () => {
    expect(fonte).toContain('if (!navigator.clipboard?.writeText) {');
  });

  it('tem .catch encadeado — antes era só .then, sem tratar rejeição', () => {
    expect(fonte).toMatch(/navigator\.clipboard\.writeText\(SUPABASE_SQL\)\s*\.then\(\(\) => \{[^}]*\}\)\s*\.catch\(\(\) => \{/);
  });

  it('o botão sai do "Copiar SQL" mudo quando falha — mostra estado de erro', () => {
    expect(fonte).toContain("copyFailed?'✕ Falha — selecione e copie manualmente'");
  });
});

describe('latestManualBp (compliance.js) — pura, escolhe a revisão mais recente', () => {
  const doc = (id, over = {}) => ({ id, docType: DOC_TYPES.MANUAL_BP, versao: id, ...over });

  it('sem docs devolve null (vazio, null ou undefined)', () => {
    expect(latestManualBp([])).toBeNull();
    expect(latestManualBp(null)).toBeNull();
    expect(latestManualBp(undefined)).toBeNull();
  });

  it('ignora documento de outro tipo (ASO não conta como Manual de BP)', () => {
    const aso = { id: 'a1', docType: DOC_TYPES.ASO, subject: 'Ana' };
    expect(latestManualBp([aso])).toBeNull();
  });

  it('com um só manual_bp, devolve ele', () => {
    expect(latestManualBp([doc('m1')]).id).toBe('m1');
  });

  it('com dois, pega o de updatedAt mais recente — independente da posição no array', () => {
    const velho = doc('velho', { updatedAt: '2026-01-01T00:00:00.000Z' });
    const novo  = doc('novo',  { updatedAt: '2026-08-01T00:00:00.000Z' });
    // é exatamente essa inversão de ordem que .find() acertava só por sorte
    // (achado nº4): local sempre entra primeiro no array pelo merge, então
    // .find() pegava sempre o primeiro elemento, relevante ou não.
    expect(latestManualBp([velho, novo]).id).toBe('novo');
    expect(latestManualBp([novo, velho]).id).toBe('novo');
  });

  it('sem updatedAt, cai pra createdAt', () => {
    const velho = doc('velho', { createdAt: '2026-01-01T00:00:00.000Z' });
    const novo  = doc('novo',  { createdAt: '2026-08-01T00:00:00.000Z' });
    expect(latestManualBp([velho, novo]).id).toBe('novo');
  });

  it('empate (mesmo updatedAt) resolve determinístico — o último do array vence', () => {
    const a = doc('a', { updatedAt: '2026-01-01T00:00:00.000Z' });
    const b = doc('b', { updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(latestManualBp([a, b]).id).toBe('b');
    expect(latestManualBp([b, a]).id).toBe('a');
  });
});

describe('Itens 4/5/6 — ManualBpCard: identidade duplicada + ASO apagado pelo snapshot velho', () => {
  it('a leitura de exibição usa latestManualBp, não mais .find() (que sempre pegava a primeira)', () => {
    expect(fonte).toContain('const manual = latestManualBp(docs);');
    expect(fonte).toContain('const m = latestManualBp(lerDocs(tenantId));');
    expect(fonte).not.toContain('docs.find((d) => d.docType === DOC_TYPES.MANUAL_BP)');
  });

  it('salvar() relê a chave compartilhada NA HORA — não confia no `docs` do mount', () => {
    expect(fonte).toContain('const atual = lerDocs(tenantId);');
    expect(fonte).toContain('const manualAtual = latestManualBp(atual);');
    // o id reaproveitado pro upsert vem do doc FRESCO, não do `manual` fechado
    // no escopo do render (que pode ser de antes do sync trazer o outro lado)
    expect(fonte).toContain('id: manualAtual?.id ?? crypto.randomUUID(),');
  });

  it('proximos preserva tudo que NÃO é manual_bp (ASOs inclusos) — filtra por docType, não por id', () => {
    expect(fonte).toContain('const proximos = [atualizado, ...atual.filter((d) => d.docType !== DOC_TYPES.MANUAL_BP)];');
    // a forma antiga só tirava a entrada de MESMO id — duplicata de outro
    // aparelho (id diferente) sobrevivia, e o array partia do `docs` velho.
    expect(fonte).not.toContain('...docs.filter((d) => d.id !== atualizado.id)');
  });

  it('readiness.js (check B4) também usa latestManualBp — as duas telas convergem pro mesmo doc', () => {
    expect(fonteReadiness).toContain('const manualDoc = latestManualBp(complianceDocs);');
    expect(fonteReadiness).not.toContain("(complianceDocs ?? []).find((d) => d?.docType === 'manual_bp')");
  });

  // Prova fim-a-fim via computeReadiness (o mesmo motor que readiness-view.jsx
  // usa): duas linhas manual_bp — a "própria" do aparelho (velha, e que o
  // merge local+remoto sempre põe PRIMEIRO no array) e a que veio do outro
  // aparelho pelo sync (bem mais nova). Antes, o check B4 lia a revisão de
  // 900 dias atrás pra sempre, mesmo com o Manual atualizado no outro tablet.
  it('computeReadiness (B4) reflete a revisão mais recente mesmo com a local vindo primeiro no array', () => {
    const NOW = new Date('2026-08-15T12:00:00Z').getTime();
    const diasAtras = (n) => new Date(NOW - n * 86400000).toISOString();
    const complianceDocs = [
      { id: 'manual-local',  docType: 'manual_bp', issuedAt: diasAtras(900), versao: '1ª revisão', updatedAt: diasAtras(900) },
      { id: 'manual-remoto', docType: 'manual_bp', issuedAt: diasAtras(10),  versao: '2ª revisão', updatedAt: diasAtras(10) },
    ];
    const r = computeReadiness({ now: NOW, complianceDocs });
    const b4 = r.groups.flatMap((g) => g.checks).find((c) => c.id === 'b4-manual-bp');
    expect(b4.status).toBe('ok');                  // não 'warn' — isso pegaria os 900 dias
    expect(b4.detail).toContain('2ª revisão');
  });
});

describe('Item 7 — "Limpar duplicatas": aplica plano recalculado na hora, não o snapshot do mount', () => {
  it('montarPlano existe e é a ÚNICA fonte do plano — usada por calcular() e por aplicar()', () => {
    expect(fonte).toContain('const montarPlano = useCallback(async () => {');
    expect(fonte).toContain('setPlano(await montarPlano());');       // calcular()
    expect(fonte).toContain('planoAtual = await montarPlano();');    // aplicar()
  });

  it('aplicar() recalcula ANTES do confirm() e usa o plano fresco pra aplicar, não o `plano` do state', () => {
    const ini = fonte.indexOf('const aplicar = async () => {');
    const aplicar = fonte.slice(ini, fonte.indexOf('const r = plano?.resumo;'));
    expect(ini).toBeGreaterThan(-1);
    const posMontar = aplicar.indexOf('planoAtual = await montarPlano();');
    const posConfirm = aplicar.indexOf('window.confirm(');
    expect(posMontar).toBeGreaterThan(-1);
    expect(posConfirm).toBeGreaterThan(posMontar);
    expect(aplicar).toContain('aplicarDedupe(planoAtual.templates, planoAtual.records, planoAtual)');
    expect(aplicar).toContain('apagar: planoAtual.apagar, remapear: planoAtual.remapear,');
    expect(aplicar).not.toContain('aplicarDedupe(plano.templates, plano.records, plano)');
  });

  it('colisão nova descoberta no recálculo bloqueia a aplicação — mesma trava do botão, reconferida com dado fresco', () => {
    expect(fonte).toContain('Apareceu registro novo com colisão de período desde o último cálculo');
  });

  // Mecanismo por trás do fix: aplicarLimpezaFormularios (repository.js)
  // regrava nutriops.forms.records.{tenantId} por SUBSTITUIÇÃO, não merge.
  // Isto prova as duas metades da alegação — aplicar com snapshot velho
  // apaga o que chegou depois (o bug); aplicar com leitura fresca preserva (o
  // fix). O teste acima (fonte) garante que aplicar() realmente usa o
  // segundo caminho.
  it('mecanismo: snapshot velho de records apaga o que "o sync" trouxe depois (o bug, comprovado)', async () => {
    const T = 'triagem-lp-velho';
    const tpl = { id: 'tpl1', category: 'outros', title: 'Planilha Teste', updatedAt: '2026-08-01T00:00:00.000Z' };
    writeFormTemplates(T, [tpl]);
    writeFormRecords(T, [{ id: 'rec1', formId: 'tpl1', periodKey: '2026-08', status: 'submitted', updatedAt: '2026-08-01T00:00:00.000Z' }]);

    // snapshot "de quando o card montou"
    const snapshotTemplates = [tpl];
    const snapshotRecords = readFormRecords(T);
    const planoVelho = { ...planejarDedupe(snapshotTemplates, snapshotRecords), templates: snapshotTemplates, records: snapshotRecords };

    // "sync" (doSync online-event) grava um registro novo por baixo, DEPOIS do snapshot
    writeFormRecords(T, [...readFormRecords(T), { id: 'rec2', formId: 'tpl1', periodKey: '2026-09', status: 'submitted', updatedAt: '2026-08-10T00:00:00.000Z' }]);

    const limpo = aplicarDedupe(planoVelho.templates, planoVelho.records, planoVelho);
    await aplicarLimpezaFormularios(T, {
      templates: limpo.templates, records: limpo.records,
      apagar: planoVelho.apagar, remapear: planoVelho.remapear,
    });

    expect(readFormRecords(T).find((r) => r.id === 'rec2')).toBeUndefined(); // sumiu — era o bug
  });

  it('mecanismo: plano recalculado na hora do clique preserva o que "o sync" trouxe antes (o fix)', async () => {
    const T = 'triagem-lp-fresco';
    const tpl = { id: 'tpl1', category: 'outros', title: 'Planilha Teste', updatedAt: '2026-08-01T00:00:00.000Z' };
    writeFormTemplates(T, [tpl]);
    writeFormRecords(T, [{ id: 'rec1', formId: 'tpl1', periodKey: '2026-08', status: 'submitted', updatedAt: '2026-08-01T00:00:00.000Z' }]);

    // "sync" grava o registro novo ANTES do clique em "Limpar duplicatas"
    writeFormRecords(T, [...readFormRecords(T), { id: 'rec2', formId: 'tpl1', periodKey: '2026-09', status: 'submitted', updatedAt: '2026-08-10T00:00:00.000Z' }]);

    // isto é o que montarPlano() faz agora: lê fresco na hora do clique
    const templatesFrescos = JSON.parse(localStorage.getItem(`nutriops.forms.templates.${T}`));
    const recordsFrescos = readFormRecords(T);
    const planoFresco = { ...planejarDedupe(templatesFrescos, recordsFrescos), templates: templatesFrescos, records: recordsFrescos };

    const limpo = aplicarDedupe(planoFresco.templates, planoFresco.records, planoFresco);
    await aplicarLimpezaFormularios(T, {
      templates: limpo.templates, records: limpo.records,
      apagar: planoFresco.apagar, remapear: planoFresco.remapear,
    });

    expect(readFormRecords(T).find((r) => r.id === 'rec2')).toBeDefined(); // preservado
  });
});
