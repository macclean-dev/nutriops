import { describe, it, expect, beforeEach } from 'vitest';
import { readEquipments, writeEquipments } from './maintenance';

beforeEach(() => { localStorage.clear(); });

describe('readEquipments — repara lixo sem nome', () => {
  it('remove entradas sem `name` (contaminação do bug de EQ_KEY pré-v1.9.60)', () => {
    localStorage.setItem('nutriops.equip_assets.casadoce', JSON.stringify([
      { label: 'Freezer 1', aliases: [], location: 'Cozinha', minTemp: -22, maxTemp: -18 }, // lixo: shape do catálogo, sem name
      { id: 'a1', name: 'Câmara fria', location: 'Estoque', status: 'Operacional', maintenancePlans: [] }, // ativo real
    ]));
    const result = readEquipments('casadoce');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Câmara fria');
  });

  it('lista vazia continua vazia', () => {
    expect(readEquipments('sem-dados')).toEqual([]);
  });

  it('não mexe em ativos legítimos', () => {
    const assets = [
      { id: 'a1', name: 'Forno', location: 'Cozinha', status: 'Operacional', maintenancePlans: [] },
      { id: 'a2', name: 'Câmara fria', location: 'Estoque', status: 'Operacional', maintenancePlans: [] },
    ];
    writeEquipments('swiss', assets);
    expect(readEquipments('swiss')).toEqual(assets);
  });
});
