import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTemperatura } from './limits';

// ─────────────────────────────────────────────────────────────────────────────
// Cluster de 5 achados na tela principal de registro (TemperatureCapture,
// pages.jsx) — achados nº10, 11, 12, 14 da auditoria de 18/08, que eram o
// MESMO defeito visto por lentes diferentes: `pendingDrafts` (o número no
// botão) e `toSave` (o que o laço grava) usavam critérios distintos.
//
// O pior caso: pendingDrafts = 2, toSave = [], o laço não grava nada, e a tela
// mostra "✓ Registro salvo com timestamp auditável." mesmo assim.
// ─────────────────────────────────────────────────────────────────────────────

describe('parseTemperatura — vírgula decimal (achado nº10)', () => {
  it('aceita vírgula: o teclado do celular em pt-BR entrega "3,4"', () => {
    expect(parseTemperatura('3,4')).toBe(3.4);
    expect(parseTemperatura('-11,5')).toBe(-11.5);
  });

  it('Number() sozinho falharia — é o que causava a perda', () => {
    expect(Number('3,4')).toBeNaN();
  });

  it('ponto continua funcionando', () => {
    expect(parseTemperatura('3.4')).toBe(3.4);
    expect(parseTemperatura(-18)).toBe(-18);
  });

  it('zero é valor legítimo (câmara a 0°C), não vazio', () => {
    expect(parseTemperatura('0')).toBe(0);
    expect(parseTemperatura(0)).toBe(0);
  });

  it('o que NÃO é número devolve NaN — pra tela poder avisar em vez de sumir', () => {
    for (const v of ['', '-', '.', '-.', '  ', null, undefined, 'abc']) {
      expect(parseTemperatura(v), `${JSON.stringify(v)} deveria ser NaN`).toBeNaN();
    }
  });
});

// A regra que unifica contador e laço, replicada do componente.
const jaGravado = (savedByEquipment, lbl, val) => {
  const s = savedByEquipment[lbl];
  return s ? parseTemperatura(s.temperature) === val : false;
};

describe('contador e laço precisam concordar (achados nº12 e 14)', () => {
  it('equipamento já gravado com o MESMO valor não conta nem grava', () => {
    const saved = { Freezer: { temperature: '-18' } };
    expect(jaGravado(saved, 'Freezer', -18)).toBe(true);
  });

  it('já gravado com valor DIFERENTE volta a ser gravável — corrigir tem que funcionar', () => {
    const saved = { Freezer: { temperature: '-18' } };
    expect(jaGravado(saved, 'Freezer', -20)).toBe(false);
  });

  it('a comparação passa por parseTemperatura dos DOIS lados', () => {
    // gravado como "3.4", remedido como "3,4" — é o mesmo número, não um novo
    expect(jaGravado({ R1: { temperature: '3.4' } }, 'R1', parseTemperatura('3,4'))).toBe(true);
  });

  it('equipamento nunca gravado é sempre gravável', () => {
    expect(jaGravado({}, 'Novo', 5)).toBe(false);
  });
});

describe('guardas de fonte — pages.jsx', () => {
  const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

  it('existe UMA fonte do que seria gravado, e o laço usa ela', () => {
    expect(fonte).toContain('const rascunhosGravaveis = useMemo(');
    expect(fonte).toContain('const pendingDrafts = rascunhosGravaveis.length;');
    expect(fonte).toContain('const toSave = rascunhosGravaveis;');
  });

  it('o laço não recalcula o próprio critério — era isso que divergia', () => {
    expect(fonte).not.toContain("const val = Number(draft.value || '');");
  });

  it('rascunho inválido avisa em vez de sumir (achado nº10)', () => {
    expect(fonte).toContain('const rascunhosInvalidos = useMemo(');
    expect(fonte).toContain('não são números válidos e NÃO serão registrados');
  });

  it('"corrigir o sinal" diz que ainda não gravou (achado nº11)', () => {
    expect(fonte).toContain("setSubmissionState('corrigido')");
    expect(fonte).toContain('ainda não gravou');
  });

  it('a captura lê temperatura com parseTemperatura, não Number()', () => {
    expect(fonte).toContain('const numericValue = parseTemperatura(value);');
  });
});

describe('estilo do aviso novo existe — senão sai sem cor', () => {
  it('.submission.warn está definido', () => {
    expect(readFileSync(`${process.cwd()}/src/styles.css`, 'utf8')).toContain('.submission.warn {');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ ALCANCE REAL DESTE CLUSTER — descoberto ao tentar validar no browser.
//
// `TemperatureCapture` vive só dentro de `OverviewView`, que só renderiza em
// `activeView === 'overview-v2'`. Esse view NÃO está no menu (nav.js expõe só
// 'overview'), e o único caminho seria o botão "← visão antiga" do `BetaBar`,
// que está DEFINIDO e nunca renderizado (overview-v2.jsx:1240).
//
// Ou seja: os 5 achados deste cluster (nº10, 11, 12, 14 e o de troca de
// equipamento) descrevem defeitos REAIS, mas em tela que ninguém alcança hoje.
// A auditoria classificou como "alta/perda de dado" sem checar alcance — e eu
// também, até tentar abrir a tela.
//
// As correções ficam: são baratas, estão certas, e a tela pode voltar. Mas
// este teste trava a informação, pra ninguém (eu inclusive) tratar isso como
// incêndio de novo — e pra avisar se a tela VOLTAR ao menu.
// ─────────────────────────────────────────────────────────────────────────────
describe('alcance: a tela legada de captura segue fora do app', () => {
  const nav = readFileSync(`${process.cwd()}/src/nav.js`, 'utf8');
  const ov2 = readFileSync(`${process.cwd()}/src/overview-v2.jsx`, 'utf8');

  it("'overview-v2' não está no menu", () => {
    expect(nav).not.toContain("'overview-v2'");
  });

  it('BetaBar (o único escape pra ela) continua sem ser renderizado', () => {
    expect(ov2).toContain('function BetaBar({ onBack })');
    expect(ov2).not.toMatch(/<BetaBar[\s/>]/);
  });
});
