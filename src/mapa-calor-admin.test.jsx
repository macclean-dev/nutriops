import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { WeeklyHeatmap } from './overview-v2.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido do dono (23/08): "libera o mapa de calor pro administrador".
//
// Ele tentou achar a tela e não encontrou nem pelo Cmd+K — porque o mapa nunca
// foi uma tela: era uma seção da Visão geral da NUTRICIONISTA RT, e só o papel
// 'Nutricionista RT' cai naquele painel. O dono da loja (papel Administrador)
// nunca viu, e o admin da plataforma também não — a impersonação entra como
// Administrador. Ou seja: quem sustenta o produto não conseguia enxergar a
// tela que o cliente descrevia no suporte.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/overview-v2.jsx`, 'utf8');

const supervisor = (() => {
  const ini = fonte.indexOf('function SupervisorDashboard(');
  return fonte.slice(ini, fonte.indexOf('\nfunction ColaboradorDashboard', ini));
})();

describe('o mapa aparece no painel do Administrador', () => {
  it('a seção existe no SupervisorDashboard', () => {
    expect(supervisor).toContain('title="Mapa de calor semanal"');
    expect(supervisor).toContain('<WeeklyHeatmap');
  });

  it('escopado à empresa ATIVA — o painel da RT é que itera várias', () => {
    expect(supervisor).toContain('tenants={[activeTenant]}');
  });

  it('o clique reusa o drill-down que a tela já tem', () => {
    expect(supervisor).toContain('onCellClick={(_tenant, equipment, cell) => { if (cell.count > 0) setDrillEq(equipment); }}');
  });

  it('a janela de 7 dias recalcula — não congela no 1º render', () => {
    // `Date.now()` fora do memo ficaria preso no instante em que a aba abriu,
    // e o mapa mostraria a semana errada num tablet que fica ligado dias.
    expect(supervisor).toContain('const ultimos7Dias = useMemo(() => {');
    expect(supervisor).toContain('}, [tenantRecords]);');
  });

  it('o painel da RT continua com o dele — não movemos, duplicamos a seção', () => {
    const rt = fonte.slice(fonte.indexOf('function RTDashboard('));
    expect(rt).toContain('tenants={allTenants}');
  });
});

describe('WeeklyHeatmap renderiza com uma empresa só', () => {
  const tenant = { id: 't1', name: 'CASA DOCE', equipmentCatalog: [
    { label: 'Freezer — F.1', location: 'Cozinha', minTemp: -22, maxTemp: -18 },
  ] };
  const hoje = new Date().toISOString();

  it('monta a linha do equipamento e o total', () => {
    const html = renderToStaticMarkup(
      <WeeklyHeatmap tenants={[tenant]} onCellClick={() => {}}
        records={[{ tenantId: 't1', equipmentInput: 'Freezer — F.1', equipmentKey: 'Freezer — F.1', value: -19, createdAt: hoje }]} />
    );
    expect(html).toContain('Freezer — F.1');
    expect(html).toContain('CASA DOCE');
  });

  it('equipamento sem leitura nenhuma não quebra a renderização', () => {
    const html = renderToStaticMarkup(
      <WeeklyHeatmap tenants={[tenant]} records={[]} onCellClick={() => {}} />
    );
    expect(html).toContain('Freezer — F.1');
  });
});
