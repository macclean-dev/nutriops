import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deveAvisarAoFechar, instalarAvisoAoFechar } from './aviso-ao-fechar';
import { descreverPendencia } from './leituras-pendentes';

// ─────────────────────────────────────────────────────────────────────────────
// Relato da RT da CASA DOCE (09/10): leitura com "erro de sincronização" ficou
// marrom (guardada só no computador) e depois não constava nem nele. O app não
// apaga a fila; o navegador apaga (janela anônima, convidado, limpar ao
// fechar). Fechar a janela com registro pendente agora pede confirmação.
// ─────────────────────────────────────────────────────────────────────────────

const fechar = (alvo) => {
  const e = new Event('beforeunload', { cancelable: true });
  alvo.dispatchEvent(e);
  return e;
};

describe('aviso ao fechar a janela', () => {
  it('com registro na fila: o navegador pede confirmação', () => {
    const alvo = new EventTarget();
    instalarAvisoAoFechar(() => [{ table: 'temperature_records' }], alvo);
    const e = fechar(alvo);
    expect(e.defaultPrevented).toBe(true);
  });

  it('fila vazia: fecha sem perguntar', () => {
    const alvo = new EventTarget();
    instalarAvisoAoFechar(() => [], alvo);
    expect(fechar(alvo).defaultPrevented).toBe(false);
  });

  it('lê a fila na hora de fechar, não na instalação', () => {
    const alvo = new EventTarget();
    let fila = [];
    instalarAvisoAoFechar(() => fila, alvo);
    fila = [{ table: 'form_records' }];
    expect(fechar(alvo).defaultPrevented).toBe(true);
  });

  it('desinstalar tira o aviso', () => {
    const alvo = new EventTarget();
    const desligar = instalarAvisoAoFechar(() => [{}], alvo);
    desligar();
    expect(fechar(alvo).defaultPrevented).toBe(false);
  });

  it('falha ao ler a fila não trava o fechamento', () => {
    const alvo = new EventTarget();
    instalarAvisoAoFechar(() => { throw new Error('storage'); }, alvo);
    expect(fechar(alvo).defaultPrevented).toBe(false);
  });

  it('deveAvisarAoFechar', () => {
    expect(deveAvisarAoFechar([{}])).toBe(true);
    expect(deveAvisarAoFechar([])).toBe(false);
    expect(deveAvisarAoFechar(null)).toBe(false);
  });

  it('o App liga o aviso antes do retorno do Modo Quiosque (vale nos dois)', () => {
    const p = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
    const aviso = p.indexOf('useEffect(() => instalarAvisoAoFechar(getOfflineQueue), []);');
    expect(aviso).toBeGreaterThan(-1);
    expect(aviso).toBeLessThan(p.indexOf('if (kioskConfig) return ('));
  });

  it('a tela diz para não fechar onde o pendente aparece', () => {
    const p = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
    expect(p).toContain('Não feche esta janela até eles serem enviados.');
    expect(descreverPendencia({ total: 1 })).toContain('Não feche esta janela até ela ser enviada.');
    expect(descreverPendencia({ total: 3 })).toContain('Não feche esta janela até elas serem enviadas.');
  });
});
