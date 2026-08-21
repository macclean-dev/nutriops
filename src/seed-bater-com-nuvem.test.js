import { describe, it, expect } from 'vitest';
import { tenantsBase } from './tenants-public';

// ─────────────────────────────────────────────────────────────────────────────
// O seed de `tenants-public.js` só é lido quando o catálogo da nuvem está
// VAZIO (repository.js: "remoto > 0 sobrescreve local; remoto vazio cai no
// seed"). Por isso ele é fácil de esquecer — e foi.
//
// Caso real (Bäckerei, 21/08): o seed dizia que o "Refrigerador da Bancada"
// ficava na "Cozinha". A Bäckerei NÃO TEM cozinha. Quando perguntei em qual
// setor ficava, o dono respondeu lendo o que a tela mostrava — que era o seed.
// O código respondeu pela loja, e eu propaguei o erro pra nuvem ao criar o
// cadastro. Só apareceu quando o card "fora da rotina" exibiu o setor
// fantasma na Visão geral.
//
// Estes testes travam o seed contra as decisões que já foram tomadas sobre o
// catálogo real. Não são cosméticos: cada um deles corresponde a dado que já
// esteve errado em produção.
// ─────────────────────────────────────────────────────────────────────────────

const porId = (id) => tenantsBase.find((t) => t.id === id);
const setores = (t) => [...new Set((t.equipmentCatalog ?? []).map((e) => e.location).filter(Boolean))];

describe('Bäckerei — a loja é toda Salão, não existe Cozinha', () => {
  const backerei = porId('backerei');

  it('o tenant existe no seed', () => {
    expect(backerei).toBeTruthy();
  });

  it('NENHUM equipamento fica na Cozinha', () => {
    expect(setores(backerei)).toEqual(['Salão']);
  });

  it('todo equipamento tem setor — sem setor o card agrupa em "Sem setor"', () => {
    for (const eq of backerei.equipmentCatalog) {
      expect(String(eq.location ?? '').trim()).not.toBe('');
    }
  });
});

describe('Bäckerei — "Balcão Refrigerado" é apelido, não equipamento próprio', () => {
  const backerei = porId('backerei');
  const labels = backerei.equipmentCatalog.map((e) => e.label);

  it('não tem linha própria (duas linhas = dois cards e histórico dividido)', () => {
    expect(labels).not.toContain('Balcão Refrigerado');
  });

  it('o nome antigo está entre os apelidos do Refrigerador da Bancada', () => {
    // 55 das 75 leituras foram gravadas com esse nome. Sem o apelido elas
    // ficam órfãs — é o defeito da v1.9.196.
    const bancada = backerei.equipmentCatalog.find((e) => e.label === 'Refrigerador da Bancada');
    expect(bancada.aliases).toContain('Balcão Refrigerado');
    expect(bancada.aliases).toContain('Balcão Refrigerado Horizontal');
  });
});

describe('Bäckerei — Máquina de Gelo ficou fora de propósito', () => {
  it('não tem visor de temperatura, então não é equipamento monitorável', () => {
    // Decisão do dono (21/08). As 11 leituras antigas continuam no banco —
    // evidência sanitária não se apaga —, só não têm cadastro.
    const labels = porId('backerei').equipmentCatalog.map((e) => e.label);
    expect(labels).not.toContain('Máquina de Gelo');
  });
});

describe('os 3 seeds continuam íntegros', () => {
  it('cada tenant do seed tem id, nome e catálogo utilizável', () => {
    for (const t of tenantsBase) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(Array.isArray(t.equipmentCatalog)).toBe(true);
      for (const eq of t.equipmentCatalog) {
        expect(String(eq.label ?? '').trim()).not.toBe('');
      }
    }
  });

  it('nenhum tenant tem equipamento com nome repetido', () => {
    // Nome repetido é perda de dado: a linha na nuvem é chaveada por
    // (tenant_id, label) e o segundo apaga o primeiro. O cadastro pela tela já
    // bloqueia isso (saveItem, pages.jsx) — o seed também precisa respeitar.
    for (const t of tenantsBase) {
      const nomes = t.equipmentCatalog.map((e) => e.label.trim().toLowerCase());
      expect(new Set(nomes).size).toBe(nomes.length);
    }
  });

  it('nenhum apelido colide com o NOME de outro equipamento da mesma loja', () => {
    // Colisão assim faz a leitura de um equipamento resolver pro outro.
    for (const t of tenantsBase) {
      const nomes = new Set(t.equipmentCatalog.map((e) => e.label.trim().toLowerCase()));
      for (const eq of t.equipmentCatalog) {
        for (const a of eq.aliases ?? []) {
          const alias = String(a).trim().toLowerCase();
          if (alias === eq.label.trim().toLowerCase()) continue; // apelido igual ao próprio nome é inofensivo
          expect(nomes.has(alias)).toBe(false);
        }
      }
    }
  });
});
