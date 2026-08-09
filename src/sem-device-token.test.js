import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Device-token aposentado em 09/08 — era o item 🔴 do CLAUDE.md: a senha
// VITE_DEVICE_PASSWORD ficava INLINADA no bundle público (o prefixo VITE_ vira
// literal no build), junto com o padrão device-{loja}@nutriops.internal. Quem
// baixasse o JS logava como o device de qualquer loja e recebia um JWT com
// app_metadata.tenant_id — exatamente o carimbo em que o RLS confia.
//
// Este teste guarda a REMOÇÃO. Se alguém reintroduzir o módulo ou a env var,
// a senha volta pro bundle e o furo reabre sem barulho nenhum.
const raiz = (p) => resolve(process.cwd(), p);
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('device-token aposentado', () => {
  it('o módulo device-auth não existe mais', () => {
    expect(existsSync(raiz('src/device-auth.js'))).toBe(false);
  });

  it('nenhum fonte importa device-auth nem lê VITE_DEVICE_PASSWORD', () => {
    const arquivos = ['src/repository.js', 'src/auth.jsx', 'src/pages.jsx', 'src/login.jsx'];
    for (const f of arquivos) {
      const src = semComentarios(readFileSync(raiz(f), 'utf8'));
      expect(src, `${f} importa device-auth`).not.toMatch(/device-auth/);
      expect(src, `${f} lê VITE_DEVICE_PASSWORD`).not.toMatch(/VITE_DEVICE_PASSWORD/);
      expect(src, `${f} monta e-mail de device`).not.toMatch(/nutriops\.internal/);
    }
  });

  it('sbHeaders usa só o JWT do usuário — sem 2º caminho de credencial', () => {
    const repo = semComentarios(readFileSync(raiz('src/repository.js'), 'utf8'));
    expect(repo).toMatch(/async function sbHeaders/);
    expect(repo).not.toMatch(/getDeviceAccessToken/);
  });
});
