import { describe, it, expect } from 'vitest';
import { buildEquipmentCatalog, isPlaceholderCatalog, DEFAULT_EQUIPMENT } from './segments';

// O caso real que motivou tudo (CASA DOCE, 07 e 10/08): a loja tem 44
// equipamentos em 11 setores na nuvem, mas um aparelho exibia os 4 genéricos
// de fábrica — e ninguém sabia, porque a falha do sync só ia pro console.
describe('isPlaceholderCatalog', () => {
  it('reconhece o catálogo de fábrica que o próprio app gera', () => {
    expect(isPlaceholderCatalog(buildEquipmentCatalog(DEFAULT_EQUIPMENT.padaria))).toBe(true);
    expect(isPlaceholderCatalog(buildEquipmentCatalog(DEFAULT_EQUIPMENT.confeitaria))).toBe(true);
    expect(isPlaceholderCatalog(buildEquipmentCatalog(DEFAULT_EQUIPMENT.outro))).toBe(true);
  });

  it('os 4 falsos da CASA DOCE são placeholder', () => {
    const osQuatro = [
      { label: 'Câmara Refrigerada',  aliases: [], location: 'Unidade principal' },
      { label: 'Câmara Congelada',    aliases: [], location: 'Unidade principal' },
      { label: 'Vitrine Refrigerada', aliases: [], location: 'Unidade principal' },
      { label: 'Balcão Refrigerado',  aliases: [], location: 'Unidade principal' },
    ];
    expect(isPlaceholderCatalog(osQuatro)).toBe(true);
  });

  it('catálogo real da loja NÃO é placeholder — tem setor e faixa de verdade', () => {
    const real = [
      { label: 'Câmara Fria 01 — CF01', location: 'Confeitaria', minTemp: 2, maxTemp: 6 },
      { label: 'Vitrine Gelato — VG02',  location: 'Gelateria',   minTemp: -16, maxTemp: -14 },
    ];
    expect(isPlaceholderCatalog(real)).toBe(false);
  });

  it('um único equipamento real fora do padrão de fábrica já invalida', () => {
    const misto = [
      ...buildEquipmentCatalog(DEFAULT_EQUIPMENT.padaria),
      { label: 'Banho-maria — BM01', location: 'Cozinha', minTemp: 60, maxTemp: 85 },
    ];
    expect(isPlaceholderCatalog(misto)).toBe(false);
  });

  it('nome genérico mas com faixa configurada = a loja mexeu nele, é real', () => {
    const configurado = [{ label: 'Freezer', location: 'Unidade principal', minTemp: -18, maxTemp: -12 }];
    expect(isPlaceholderCatalog(configurado)).toBe(false);
  });

  it('nome genérico mas em setor de verdade = a loja mexeu nele, é real', () => {
    const comSetor = [{ label: 'Freezer', location: 'Padaria' }];
    expect(isPlaceholderCatalog(comSetor)).toBe(false);
  });

  it('lista vazia não é placeholder — é ausência, quem decide é o chamador', () => {
    expect(isPlaceholderCatalog([])).toBe(false);
  });

  it('não quebra com entrada inválida', () => {
    expect(isPlaceholderCatalog(null)).toBe(false);
    expect(isPlaceholderCatalog(undefined)).toBe(false);
    expect(isPlaceholderCatalog('nada disso')).toBe(false);
    expect(isPlaceholderCatalog([null])).toBe(false);
  });
});
