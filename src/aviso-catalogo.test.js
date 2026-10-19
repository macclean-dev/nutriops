import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mostrarAvisoCatalogo } from './aviso-catalogo';
import { buildEquipmentCatalog, DEFAULT_EQUIPMENT } from './segments';

// Print do dono (19/10): "Esta não é a lista de equipamentos da sua unidade"
// no Fabrizzio Terraço, com os 11 equipamentos reais logo abaixo. A marca era
// uma só para o aparelho e ficava ligada depois de trocar de loja.

const reais = [{ label: 'Freezer F.1 (PRODUÇÃO)' }, { label: 'Vitrine V.1 (Atendimento)' }];

describe('aviso de lista de exemplo', () => {
  // A lista de exemplo é a que o app gera para loja recém-criada.
  const exemplo = buildEquipmentCatalog(Object.values(DEFAULT_EQUIPMENT)[0]);

  it('marca de outra loja não aparece nesta (o caso do print)', () => {
    expect(mostrarAvisoCatalogo({ marcadoPara: 'fabrizzio-matriz', lojaNaTela: 'terraco', catalogoNaTela: reais })).toBe(false);
  });

  it('marca de outra loja não aparece aqui nem quando esta também está na lista de exemplo', () => {
    // A marca diz respeito a outra loja: nesta o auto-reparo ainda não rodou,
    // e o "Tentar de novo" do aviso tentaria a loja errada.
    expect(mostrarAvisoCatalogo({ marcadoPara: 'fabrizzio-matriz', lojaNaTela: 'terraco', catalogoNaTela: exemplo })).toBe(false);
  });

  it('marca desta loja, mas a tela já mostra a lista real: não aparece', () => {
    expect(mostrarAvisoCatalogo({ marcadoPara: 'terraco', lojaNaTela: 'terraco', catalogoNaTela: reais })).toBe(false);
  });

  it('marca desta loja e a tela na lista de exemplo: aparece', () => {
    expect(mostrarAvisoCatalogo({ marcadoPara: 'terraco', lojaNaTela: 'terraco', catalogoNaTela: exemplo })).toBe(true);
  });

  it('sem marca: nunca aparece', () => {
    expect(mostrarAvisoCatalogo({ marcadoPara: null, lojaNaTela: 'terraco', catalogoNaTela: exemplo })).toBe(false);
  });

  it('o App usa a regra no lugar da marca única', () => {
    const p = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
    expect(p).toContain('{mostrarAvisoCatalogo({ marcadoPara: catalogStaleDe, lojaNaTela: activeTenant.id, catalogoNaTela: equipmentCatalog }) && <CatalogStaleBanner');
    expect(p).toContain('setCatalogStaleDe(tenantAlvo);');
  });
});
