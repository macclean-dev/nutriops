import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
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

// ─────────────────────────────────────────────────────────────────────────────
// Relato do dono (17/08): "na tela de abrir OS, não mostra os equipamentos
// cadastrados na Swiss". Não era falta de cadastro — a Swiss já tem Freezer,
// Refrigerador etc. monitorados na Visão Geral. O dropdown da Nova OS estava
// ligado no `equipments` cru (só ativos de manutenção manualmente cadastrados,
// vazio se a loja nunca abriu Manutenção → Equipamentos), não no
// `mergedEquipments` que junta o catálogo de temperatura. As duas fontes vivem
// no MESMO arquivo mas são conceitos distintos; o resto da tela (grade,
// contadores) já usava mergedEquipments — só o modal de OS ficou de fora.
// ─────────────────────────────────────────────────────────────────────────────
describe('maintenance.jsx — Nova OS enxerga o catálogo de temperatura', () => {
  const fonte = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');

  it('WorkOrderModal recebe mergedEquipments, não o equipments cru', () => {
    const bloco = fonte.match(/\{editOrder !== null && \([\s\S]{0,600}?\/>/)?.[0] ?? '';
    expect(bloco).toContain('equipments={mergedEquipments}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Achado ao corrigir o bug acima: converter um item VIRTUAL do catálogo
// (mergedEquipments, id sintético "cat-<label>", _fromCatalog:true) em ativo
// real reusava esse id. A coluna equip_assets.id é uuid — "cat-Freezer" nunca
// seria aceito, e falharia pra sempre (22P02), do mesmo jeito que o ativo sem
// id desta manhã (23502). Ninguém tinha batido nisso ainda porque o dropdown
// quebrado (bug acima) impedia de sequer abrir um item virtual pela OS — mas
// a Equipamentos tab já deixava editar o card virtual direto, então o caminho
// sempre esteve aberto.
// ─────────────────────────────────────────────────────────────────────────────
describe('maintenance.jsx — converter equipamento virtual gera id de verdade', () => {
  const fonte = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');

  it('EquipmentModal não reusa o id sintético de um item _fromCatalog', () => {
    expect(fonte).toContain("equipment?._fromCatalog ? uid() : (equipment?.id ?? uid())");
  });
});
