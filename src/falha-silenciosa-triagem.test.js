import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { lw, getStorageFull, clearStorageFull, STORAGE_FULL_KEY } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Segunda rodada da triagem manual dos achados não-julgados da auditoria
// (19/08). Todos confirmados lendo o código, sem agente.
// ─────────────────────────────────────────────────────────────────────────────

describe('lw — armazenamento cheio não pode falhar calado (achado nº15)', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => vi.restoreAllMocks());

  it('gravação normal devolve true e não levanta bandeira', () => {
    expect(lw('nutriops.teste', { a: 1 })).toBe(true);
    expect(getStorageFull()).toBeNull();
  });

  it('QuotaExceeded devolve false, loga e levanta a bandeira', () => {
    const erro = new DOMException('quota', 'QuotaExceededError');
    let chamadas = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k) => {
      chamadas++;
      if (k === STORAGE_FULL_KEY) return;   // a bandeira ainda cabe
      throw erro;
    });
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(lw('nutriops.temperature.records', [1,2,3])).toBe(false);
    expect(aviso).toHaveBeenCalled();
    expect(chamadas).toBeGreaterThanOrEqual(2);   // tentou gravar E tentou marcar
  });

  it('a bandeira guarda QUAL chave falhou — sem isso não dá pra diagnosticar', () => {
    localStorage.clear();
    localStorage.setItem(STORAGE_FULL_KEY, JSON.stringify({ chave: 'nutriops.forms.records.x', at: new Date().toISOString() }));
    expect(getStorageFull().chave).toBe('nutriops.forms.records.x');
  });

  it('nem a bandeira cabendo, não estoura — o console é o que sobra', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cheio'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => lw('x', 1)).not.toThrow();
    expect(lw('x', 1)).toBe(false);
  });

  it('dispensar limpa a bandeira', () => {
    localStorage.setItem(STORAGE_FULL_KEY, JSON.stringify({ chave:'x', at:new Date().toISOString() }));
    clearStorageFull();
    expect(getStorageFull()).toBeNull();
  });
});

describe('guardas de fonte — 2ª rodada', () => {
  const arq = (n) => readFileSync(`${process.cwd()}/src/${n}`, 'utf8');

  it('há banner de armazenamento cheio, e ele é renderizado', () => {
    const pages = arq('pages.jsx');
    expect(pages).toContain('function StorageFullBanner()');
    expect(pages).toContain('<StorageFullBanner />');
  });

  it('restaurar backup relata o que NÃO restaurou (achado nº5)', () => {
    const st = arq('settings.jsx');
    expect(st).toContain('const falharam = [];');
    expect(st).toContain('Backup restaurado PARCIALMENTE');
    // e o catch vazio da restauração saiu
    expect(st).not.toContain('localStorage.setItem(key, JSON.stringify(value)); } catch {}');
  });

  it('sair do preenchimento com alteração não salva avisa (achado nº1)', () => {
    const f = arq('forms.jsx');
    expect(f).toContain('const temAlteracaoNaoSalva =');
    expect(f).toContain('Sair sem salvar?');
    expect(f).toContain('onClick={voltar}');
  });

  it('FormsView relê no sync e mescla os REGISTROS (achado nº2)', () => {
    const f = arq('forms.jsx');
    expect(f).toContain('window.addEventListener(SYNC_EVENT, reler)');
    expect(f).toContain('gravarMesclando(readFormRecords, writeFormRecords, activeTenant.id, records)');
  });

  it('mas NÃO mescla os TEMPLATES — mesclar ressuscitaria o que a limpeza apagou', () => {
    const f = arq('forms.jsx');
    expect(f).toContain('writeFormTemplates(activeTenant.id, templates);');
    expect(f).not.toContain('gravarMesclando(readFormTemplates');
  });

  it('não relê enquanto alguém preenche — trocaria a lista sob os pés de quem digita', () => {
    expect(arq('forms.jsx')).toMatch(/useEffect\(\(\) => \{\s*if \(filling\) return;/);
  });
});
