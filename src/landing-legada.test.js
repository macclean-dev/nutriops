import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// A landing de verdade vive noutro projeto (www.uniwares.net/nutriops/landing).
// A cópia que existia aqui era servida em nutriops.uniwares.net e só criava
// divergência: ficou meses com R$149 depois de o preço mudar, e ninguém
// percebeu até eu editar a cópia errada em 28/08.
// ─────────────────────────────────────────────────────────────────────────────

const raiz = process.cwd();
const vercel = JSON.parse(readFileSync(`${raiz}/vercel.json`, 'utf8'));

describe('a landing legada não volta', () => {
  it('não existe mais em nenhuma das duas cópias', () => {
    expect(existsSync(`${raiz}/landing-nutriops.html`)).toBe(false);
    expect(existsSync(`${raiz}/public/landing-nutriops.html`)).toBe(false);
  });

  it('a URL antiga redireciona em vez de dar 404 — link salvo continua chegando', () => {
    const r = (vercel.redirects ?? []).find((x) => x.source === '/landing-nutriops.html');
    expect(r).toBeTruthy();
    expect(r.destination).toBe('https://www.uniwares.net/nutriops/landing');
  });

  it('o redirect é permanente — é o que faz o buscador transferir a relevância', () => {
    const r = vercel.redirects.find((x) => x.source === '/landing-nutriops.html');
    expect(r.permanent).toBe(true);
  });

  it('não sobrou rewrite apontando pro arquivo que não existe mais', () => {
    expect((vercel.rewrites ?? []).some((x) => x.source.includes('landing'))).toBe(false);
  });
});

describe('o manual FICA — os e-mails transacionais linkam pra ele', () => {
  it('o arquivo continua em public/', () => {
    expect(existsSync(`${raiz}/public/manual-nutriops.html`)).toBe(true);
  });

  it('o rewrite dele continua, senão a SPA engole a rota', () => {
    expect((vercel.rewrites ?? []).some((x) => x.source === '/manual-nutriops.html')).toBe(true);
  });

  it('e o e-mail aponta pra uma URL que existe', () => {
    const email = readFileSync(`${raiz}/src/email.js`, 'utf8');
    expect(email).toContain('https://nutriops.uniwares.net/manual-nutriops.html');
  });
});

describe('o catch-all da SPA continua por último', () => {
  it('a regra /(.*) é a ÚLTIMA — antes dela, engoliria o manual', () => {
    const idx = vercel.rewrites.findIndex((x) => x.source === '/(.*)');
    expect(idx).toBe(vercel.rewrites.length - 1);
  });
});
