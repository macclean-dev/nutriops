import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ls, lw, saveSupabaseConfig, clearOfflineQueue, syncEquipmentCatalog } from './repository';

const EQ_KEY = (id) => `nutriops.equipment.catalog.${id}`;
const ok = (b) => Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(JSON.stringify(b)) });

beforeEach(() => {
  localStorage.clear(); clearOfflineQueue();
  saveSupabaseConfig({ url:'https://x.test', anonKey:'a', enabled:true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const linha = (label) => ({ tenant_id:'swiss', label, aliases:[], location:'Cozinha', min_temp:0, max_temp:5 });

// `enqueue` não é exportado — escrevo direto na chave da fila, que é o que ele faz.
const enfileirar = (payload) => {
  const q = JSON.parse(localStorage.getItem('nutriops.offline.queue') ?? '[]');
  q.push({ table:'equipment_catalog', operation:'upsert', payload, _at:new Date().toISOString() });
  localStorage.setItem('nutriops.offline.queue', JSON.stringify(q));
};

// ─────────────────────────────────────────────────────────────────────────────
// `syncEquipmentCatalog` substituía o local pela nuvem. Equipamento cadastrado
// offline, ainda na FILA, era apagado antes de subir — o pull rodava antes do
// push. Achado da auditoria (18/08).
// ─────────────────────────────────────────────────────────────────────────────
describe('sync do catálogo não pode apagar o que está na fila', () => {
  it('equipamento pendente sobrevive ao pull', async () => {
    lw(EQ_KEY('swiss'), [{ label:'Freezer' }, { label:'Forno Novo' }]);
    enfileirar(linha('Forno Novo'));
    vi.stubGlobal('fetch', vi.fn(() => ok([linha('Freezer')])));

    await syncEquipmentCatalog('swiss');
    const cat = ls(EQ_KEY('swiss'), []).map(e => e.label);
    expect(cat).toContain('Forno Novo');   // ✅ não sumiu
    expect(cat).toContain('Freezer');
  });

  it('item que NÃO está na fila e sumiu da nuvem foi apagado noutro aparelho — não ressuscita', async () => {
    lw(EQ_KEY('swiss'), [{ label:'Freezer' }, { label:'Apagado Noutro Device' }]);
    vi.stubGlobal('fetch', vi.fn(() => ok([linha('Freezer')])));

    await syncEquipmentCatalog('swiss');
    expect(ls(EQ_KEY('swiss'), []).map(e => e.label)).toEqual(['Freezer']);
  });

  it('fila de OUTRA loja não interfere', async () => {
    lw(EQ_KEY('swiss'), [{ label:'Freezer' }, { label:'Da Casa Doce' }]);
    enfileirar({ tenant_id:'casadoce', label:'Da Casa Doce' });
    vi.stubGlobal('fetch', vi.fn(() => ok([linha('Freezer')])));

    await syncEquipmentCatalog('swiss');
    expect(ls(EQ_KEY('swiss'), []).map(e => e.label)).toEqual(['Freezer']);
  });

  it('nuvem vazia não mexe no local (comportamento antigo, preservado)', async () => {
    lw(EQ_KEY('swiss'), [{ label:'Freezer' }]);
    vi.stubGlobal('fetch', vi.fn(() => ok([])));
    await syncEquipmentCatalog('swiss');
    expect(ls(EQ_KEY('swiss'), [])).toHaveLength(1);
  });
});

describe('guardas de fonte', () => {
  const maint = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');
  const forms = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

  it('manutenção bloqueia ativo homônimo e aponta a ação certa', () => {
    expect(maint).toContain('const conflito = existentes.find(');
    expect(maint).toContain('use o botão "Editar" no card dele');
  });

  it('o modal de equipamento recebe a lista pra poder checar', () => {
    expect(maint).toContain('existentes={mergedEquipments}');
  });

  it('o editor de planilha avisa antes de descartar', () => {
    expect(forms).toContain('const cancelar = () => {');
    expect(forms).toContain('As alterações nesta planilha serão perdidas');
    expect(forms).toContain('onClick={cancelar}>Cancelar<');
  });
});
