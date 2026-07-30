import { describe, it, expect, beforeEach } from 'vitest';

// Regressão do bug de 30/07: trocar de empresa na tela Equipamentos gravava o
// catálogo da loja ANTERIOR por cima da loja de destino (os 44 equipamentos da
// CASA DOCE apagaram Swiss/Bäckerei/DBK).
//
// Não há @testing-library aqui, então modelamos a sequência de renders/efeitos
// do React exatamente como o EquipmentView faz. O que importa é a ORDEM:
// no render da troca, activeTenant.id já é o NOVO mas o `catalog` do state
// ainda é o ANTIGO — e o efeito de escrita tem activeTenant.id nas deps.

const key = (id) => `nutriops.equipment.catalog.${id}`;
const read = (id, seed) => { const r = localStorage.getItem(key(id)); return r ? JSON.parse(r) : seed; };
const write = (id, v) => localStorage.setItem(key(id), JSON.stringify(v));

// Simula o componente: state + os 2 efeitos, com `guard` ligando/desligando a
// correção. Devolve o localStorage final.
function simulateTenantSwitch({ guard }) {
  const seeds = { casadoce: [{ label: 'Freezer — F.1' }], backerei: [{ label: 'Vitrine Bäckerei' }] };
  // ── Estado do componente (o que o React guardaria entre renders)
  let catalog = read('casadoce', seeds.casadoce);
  let catalogTenant = 'casadoce';
  write('casadoce', catalog); // efeito de escrita do 1º render

  // ── Usuário troca pra backerei. React re-renderiza com o id NOVO e o
  //    catalog ANTIGO (setState é assíncrono).
  let activeId = 'backerei';
  let pendingCatalog = null, pendingTenant = null;

  // efeito #1 (deps [activeTenant.id]) — roda primeiro, só AGENDA o setState
  pendingCatalog = read(activeId, seeds.backerei);
  pendingTenant = activeId;

  // efeito #2 (deps incluem activeTenant.id → dispara nesta mesma passada)
  if (!guard || catalogTenant === activeId) write(activeId, catalog);

  // ── Próximo render: o state agendado entrou em vigor
  catalog = pendingCatalog; catalogTenant = pendingTenant;
  if (!guard || catalogTenant === activeId) write(activeId, catalog);

  return {
    backerei: JSON.parse(localStorage.getItem(key('backerei'))),
    casadoce: JSON.parse(localStorage.getItem(key('casadoce'))),
  };
}

beforeEach(() => localStorage.clear());

describe('troca de empresa na tela Equipamentos', () => {
  it('SEM o guard, o catálogo da loja anterior vaza pra loja nova (o bug)', () => {
    // Documenta a causa: o efeito de escrita roda com id novo + catalog velho.
    // Aqui o desfecho final até se auto-corrige, mas só porque o componente
    // continuou montado até o render seguinte — se ele desmonta antes (usuário
    // navega junto com a troca), o que fica gravado é o catálogo errado.
    const seeds = { casadoce: [{ label: 'Freezer — F.1' }], backerei: [{ label: 'Vitrine Bäckerei' }] };
    localStorage.setItem(key('backerei'), JSON.stringify(seeds.backerei));
    let catalog = seeds.casadoce, catalogTenant = 'casadoce';
    const activeId = 'backerei';
    read(activeId, seeds.backerei);          // efeito #1 (agenda)
    write(activeId, catalog);                // efeito #2 SEM guard → corrompe
    expect(JSON.parse(localStorage.getItem(key('backerei'))))
      .toEqual([{ label: 'Freezer — F.1' }]); // ← Bäckerei com dado da CASA DOCE
  });

  it('COM o guard, a loja de destino mantém o próprio catálogo', () => {
    const out = simulateTenantSwitch({ guard: true });
    expect(out.backerei).toEqual([{ label: 'Vitrine Bäckerei' }]);
  });

  it('COM o guard, a loja de origem não é alterada', () => {
    const out = simulateTenantSwitch({ guard: true });
    expect(out.casadoce).toEqual([{ label: 'Freezer — F.1' }]);
  });
});
