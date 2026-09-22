import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Duas queixas da nutricionista (22/09) sobre "Validação RT":
//   1. "tem como eu validar todas as planilhas de uma vez?" (275 pendentes)
//   2. "mesmo que eu valide no meu, nos outros equipamentos fica em aberto
//       essas validações" - ESTA é a de verdade grave: handleValidate nunca
//       chamava pushFormRecord. A validação só existia no localStorage do
//       aparelho que validou; nenhum outro dispositivo via, pra sempre.
//       form_records/formToRow já tinham a coluna `validation` pronta -
//       faltava só empurrar. "Validar todas" sozinho, sem este conserto,
//       continuaria local-only e não resolveria a queixa 2 de jeito nenhum.

const forms = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
const corpoPanel = forms.slice(forms.indexOf('function RTValidationPanel('), forms.indexOf('\nfunction ', forms.indexOf('function RTValidationPanel(') + 10));

describe('handleValidate agora sincroniza (a causa raiz da queixa 2)', () => {
  const ini = forms.indexOf('const handleValidate = useCallback(');
  const fim = forms.indexOf('}, [records, activeTenant.id]);', ini) + '}, [records, activeTenant.id]);'.length;
  const bloco = forms.slice(ini, fim);

  it('existe e não está mais vazio de dependências ([]) - precisa de records/activeTenant pra achar e empurrar o registro', () => {
    expect(bloco.length).toBeGreaterThan(0);
    expect(bloco).toContain('[records, activeTenant.id]');
  });

  it('chama pushFormRecord - é isto que fazia falta; sem ele a validação nunca saía do aparelho', () => {
    expect(bloco).toContain('pushFormRecord(activeTenant.id, updated)');
  });

  it('push ANTES do setRecords, registro montado FORA do updater - mesma correção das "vias" de handleSave (28/08): React pode chamar o updater 2x, e push lá dentro duplicaria o POST', () => {
    const push = bloco.indexOf('pushFormRecord(activeTenant.id, updated)');
    const setRec = bloco.indexOf('setRecords(');
    expect(push).toBeGreaterThan(-1);
    expect(setRec).toBeGreaterThan(push);
  });
});

describe('handleValidateAll - "validar todas" pedido pela nutricionista', () => {
  const ini = forms.indexOf('const handleValidateAll = useCallback(');
  const fim = forms.indexOf('}, [records, session, activeTenant.id]);', ini) + '}, [records, session, activeTenant.id]);'.length;
  const bloco = forms.slice(ini, fim);

  it('existe', () => {
    expect(bloco.length).toBeGreaterThan(0);
  });

  it('filtra só o que está pendente de verdade (submitted e sem validation)', () => {
    expect(bloco).toContain("r.status === 'submitted' && !r.validation");
  });

  it('UM carimbo só pro lote inteiro - não finge que 275 planilhas foram revisadas em 275 instantes diferentes', () => {
    // `carimbo` é montado uma vez, fora do loop, e reusado em cada `up` -
    // não tem um `new Date().toISOString()` novo por iteração pro campo
    // `validation` (updatedAt por registro é outra coisa, esse pode variar).
    const declaracao = bloco.indexOf('const carimbo = {');
    const loop = bloco.indexOf('for (const rec of pendentes)');
    expect(declaracao).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(declaracao);
    expect(bloco).toContain('validation: carimbo');
  });

  it('sequencial e AGUARDADO (await dentro do for), não um monte de POST em paralelo - 275 requisições de uma vez é o tipo de coisa que esbarra em rate limit', () => {
    const loopIni = bloco.indexOf('for (const rec of pendentes)');
    const loopFim = bloco.indexOf('}', bloco.indexOf('onProgress?.', loopIni));
    const corpoLoop = bloco.slice(loopIni, loopFim);
    expect(corpoLoop).toContain('await pushFormRecord(activeTenant.id, up)');
  });

  it('avisa progresso (onProgress) a cada item - 275 pushes sequenciais aguardados levam dezenas de segundos; sem isto pareceria travado', () => {
    expect(bloco).toContain('onProgress?.(ups.length, pendentes.length)');
  });

  it('UM setRecords no final (fora do loop), não 275 - evita 275 re-renders da lista', () => {
    const loopFim = bloco.lastIndexOf('}', bloco.indexOf('setRecords('));
    expect(bloco.indexOf('setRecords(')).toBeGreaterThan(bloco.indexOf('for (const rec of pendentes)'));
    // só 1 ocorrência de "setRecords(" no bloco inteiro
    expect((bloco.match(/setRecords\(/g) ?? []).length).toBe(1);
  });

  it('é passada pro painel (RTValidationPanel recebe onValidateAll)', () => {
    expect(forms).toContain('onValidateAll={handleValidateAll}');
  });
});

describe('botão "Validar todas" - UI', () => {
  it('existe, mostra a contagem, e some quando não há pendente', () => {
    expect(corpoPanel).toContain('pending.length>0 && (');
    expect(corpoPanel).toContain('✓ Validar todas (${pending.length})');
  });

  it('exige confirmação antes de disparar - é uma assinatura em lote (RDC 216), não um clique inofensivo', () => {
    expect(corpoPanel).toContain('window.confirm(');
    expect(corpoPanel).toContain('Isso assina, em seu nome, que cada uma foi revisada');
  });

  it('fica desabilitado e mostra "Validando X/Y…" enquanto roda - não dá pra clicar 2x e disparar duas rodadas', () => {
    expect(corpoPanel).toContain('disabled={Boolean(validandoTodas)}');
    expect(corpoPanel).toContain('`Validando ${validandoTodas.done}/${validandoTodas.total}…`');
  });

  it('o fluxo individual (botão "Validar" por linha) continua existindo, pra planilha que precisa de observação específica', () => {
    expect(corpoPanel).toContain("onClick={() => setValidatingId(validatingId===rec.id?null:rec.id)}");
    expect(corpoPanel).toContain('✓ Assinar e validar');
  });
});
