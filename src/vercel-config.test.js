import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Regressão de 08/09: o `vercel.json` ganhou uma chave `"//"` com a explicação
// do redirect da landing (v1.9.236). A Vercel valida o arquivo contra um schema
// FECHADO e recusou o deploy inteiro:
//
//   The `vercel.json` schema validation failed with the following message:
//   should NOT have additional property `//`
//
// O pior é como isso falha: o deploy morre ANTES de buildar (0ms, sem log de
// build), então parece que nada aconteceu — o push vai, o commit está lá, e a
// produção segue servindo a versão anterior em silêncio. Ficaram 3 dias e 2
// deploys perdidos, um deles a correção do cadastro de equipamentos.
//
// Explicação de configuração vai pra docs/HISTORICO.md, não pra dentro do JSON.

const bruto = readFileSync(`${process.cwd()}/vercel.json`, 'utf8');

// Só o que a Vercel aceita no topo do arquivo. Acrescentar aqui ao passar a
// usar uma opção nova DELA — nunca pra acomodar uma chave inventada nossa.
const CHAVES_VERCEL = new Set([
  'buildCommand', 'cleanUrls', 'crons', 'devCommand', 'framework', 'functions',
  'git', 'headers', 'ignoreCommand', 'images', 'installCommand',
  'outputDirectory', 'public', 'redirects', 'regions', 'rewrites', 'routes',
  'trailingSlash', 'version',
]);

describe('vercel.json', () => {
  it('é JSON válido', () => {
    expect(() => JSON.parse(bruto)).not.toThrow();
  });

  it('não tem chave de comentário — o schema da Vercel recusa e o deploy morre calado', () => {
    const chaves = Object.keys(JSON.parse(bruto));
    const comentarios = chaves.filter((k) => /^(\/\/|#|_)/.test(k));
    expect(comentarios, `comentário no vercel.json quebra o deploy: ${comentarios.join(', ')}`).toEqual([]);
  });

  it('só tem chaves que a Vercel reconhece', () => {
    const chaves = Object.keys(JSON.parse(bruto));
    const estranhas = chaves.filter((k) => !CHAVES_VERCEL.has(k));
    expect(estranhas, `chave que a Vercel não conhece: ${estranhas.join(', ')}`).toEqual([]);
  });

  it('o redirect da landing legada continua de pé', () => {
    // Apagar o redirect devolve 404 pra quem tem o link salvo — ver HISTORICO.
    const { redirects } = JSON.parse(bruto);
    const landing = (redirects ?? []).find((r) => r.source === '/landing-nutriops.html');
    expect(landing, 'redirect da landing legada sumiu').toBeTruthy();
    expect(landing.destination).toBe('https://www.uniwares.net/nutriops/landing');
    expect(landing.permanent).toBe(true);
  });
});
