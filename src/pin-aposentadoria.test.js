import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Login por PIN aposentado em 09/08, depois de Swiss, Bäckerei e DBK migrarem
// pra conta de loja + operador por registro (CASA DOCE já era e-mail).
//
// Este teste guarda a REMOÇÃO, não uma função: o risco aqui é alguém reabrir o
// caminho do PIN sem perceber e uma loja voltar a registrar sem a identificação
// que a RDC 216 exige — a conta é compartilhada, então sem o seletor de
// operador o registro sai no nome genérico da loja.
// import.meta.url não é file:// no ambiente jsdom do vitest — resolve pela raiz.
// Tira comentários antes de checar: o cabeçalho do arquivo CITA o que foi
// removido ("saiu junto: handlePinLogin…"), e sem isso o teste acusaria a
// própria documentação da remoção.
const login = readFileSync(resolve(process.cwd(), 'src/login.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('login: PIN aposentado', () => {
  it('não existe mais formulário nem handler de PIN', () => {
    expect(login).not.toMatch(/handlePinLogin/);
    expect(login).not.toMatch(/handleSetPin/);
    expect(login).not.toMatch(/pinResetCtx/);
    expect(login).not.toMatch(/getEffectivePin/);
  });

  it('não há caminho de volta pro modo PIN pela interface', () => {
    expect(login).not.toMatch(/setMode\('pin'\)/);
    expect(login).not.toMatch(/mode === 'pin'/);
  });

  it('e-mail é o único ponto de entrada', () => {
    expect(login).toMatch(/useState\('email'\)/);
    expect(login).toMatch(/handleEmailLogin/);
  });
});
