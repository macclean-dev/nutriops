import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { AtivarOperacaoModal } from './superadmin-view.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido do dono (21/08), ao ver a unidade nova abrir com 4 equipamentos que
// não existem: "está correto começar como implantação, mas deve existir uma
// rota para o administrador ativar — algo que peça confirmação obrigando a
// digitar uma palavra".
//
// O modo implantação sempre existiu (alertas de pendência suspensos durante o
// treino). O que nunca existiu foi a SAÍDA: era um UPDATE comentado em
// docs/casadoce-golive.sql. A CASA DOCE ficou assim de 12/07 a 21/08 — quase
// mês e meio com os alertas de turno DESLIGADOS sem ninguém perceber, e foi um
// dos motivos de 12 equipamentos parados não gerarem aviso nenhum.
//
// Modo de treino sem botão de sair vira modo permanente.
// ─────────────────────────────────────────────────────────────────────────────

const view = readFileSync(`${process.cwd()}/src/superadmin-view.jsx`, 'utf8');
const sql  = readFileSync(`${process.cwd()}/docs/ativar-operacao.sql`, 'utf8');
const sync = readFileSync(`${process.cwd()}/src/tenant-sync.js`, 'utf8');

const alvo = { id: 'x1', name: 'Fabrizzio Matriz' };
const render = (extra = {}) => renderToStaticMarkup(
  <AtivarOperacaoModal estado={{ tenant: alvo, erro: '', salvando: false, ...extra }}
    onConfirmar={() => {}} onFechar={() => {}} />
);

describe('a confirmação obriga a LER qual empresa', () => {
  it('pede o nome digitado e nasce com o botão travado', () => {
    const html = render();
    expect(html).toContain('Fabrizzio Matriz');
    expect(html).toContain('para confirmar');
    // sem digitar nada, o botão de ativar está desabilitado
    expect(html).toMatch(/Ativar operação<\/button>/);
    expect(html).toContain('disabled=""');
  });

  it('a comparação ignora caixa e espaço de sobra', () => {
    // O objetivo é provar atenção, não testar digitação.
    expect(view).toContain("const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\\s+/g, ' ');");
    expect(view).toContain('const confere = norm(texto) === norm(tenant.name)');
  });

  it('texto vazio nunca confere — norm("") não pode passar', () => {
    expect(view).toContain("norm(texto) !== ''");
  });

  it('explica a consequência dos dois lados, não só "tem certeza?"', () => {
    const html = render();
    expect(html).toMatch(/alertas de pendência/);
    expect(html).toMatch(/cedo demais/);
    expect(html).toMatch(/tarde demais/);
  });

  it('erro do servidor aparece na tela', () => {
    expect(render({ erro: 'Só o administrador da plataforma pode ativar' }))
      .toContain('Só o administrador da plataforma pode ativar');
  });

  it('salvando trava os botões', () => {
    expect(render({ salvando: true })).toContain('Ativando…');
  });
});

describe('a trava real vive no servidor', () => {
  it('só admin da plataforma', () => {
    expect(sql).toMatch(/if coalesce\(auth\.jwt\(\) -> 'app_metadata' ->> 'role', ''\) <> 'admin' then/);
  });

  it('go_live_at guarda a PRIMEIRA ativação e não é reescrito', () => {
    // É o marco de quando a loja passou a valer como operação. Sobrescrever
    // numa reativação apagaria a linha do tempo da evidência.
    expect(sql).toContain('go_live_at  = case when p_implantacao then go_live_at');
    expect(sql).toContain('else coalesce(go_live_at, now()) end');
  });

  it('empresa inexistente é recusada', () => {
    expect(sql).toContain("using errcode = 'P0002'");
  });

  it('o teste de aceitação cobre os 5 caminhos e devolve tabela', () => {
    for (const c of ['CHECK 1', 'CHECK 2', 'CHECK 3', 'CHECK 4', 'CHECK 5']) expect(sql).toContain(c);
    expect(sql).toContain('returns table (passo text, resultado text)');
    expect(sql).toContain('select * from public.__teste_golive();');
  });

  it('o teste não encosta em cliente real', () => {
    expect(sql).not.toContain('bf245c3b-2f9');
    expect(sql).toContain("v_id text := '__teste_golive__';");
  });
});

describe('o botão e o efeito na lista', () => {
  it('só aparece pra cliente em implantação', () => {
    // Loja-seed não tem linha em `tenants` pra atualizar.
    expect(view).toContain("{t.source==='client' && t.implantacao === true && (");
  });

  it('espelha local só DEPOIS da nuvem confirmar', () => {
    const ini = view.indexOf('const confirmarGoLive = async () => {');
    const corpo = view.slice(ini, view.indexOf('\n  };', ini));
    expect(corpo.indexOf('await setTenantImplantacao(t.id, false);')).toBeLessThan(corpo.indexOf('persistClients('));
  });

  it('entra no log de auditoria com rótulo próprio', () => {
    expect(view).toContain("logAction({ type: 'golive', tenantId: t.id, tenantName: t.name });");
    expect(view).toContain("golive: 'Ativou operação',");
  });

  it('setTenantImplantacao propaga o erro e trata RPC ausente', () => {
    expect(sync).toContain('rode docs/ativar-operacao.sql no Supabase');
    expect(sync).toContain('throw new Error(data?.message ?? data?.error ??');
  });
});

describe('cliente novo não inventa mais equipamento', () => {
  const admin = readFileSync(`${process.cwd()}/src/admin.jsx`, 'utf8');

  it('catálogo nasce VAZIO, não com genéricos do segmento', () => {
    // Os 4 genéricos ("Freezer", "Refrigerador", "Vitrine Refrigerada",
    // "Cervejeiro") em setor fictício faziam a loja abrir com "4 nunca
    // medidos" — lacuna de evidência inventada pelo sistema.
    expect(admin).toContain('equipmentCatalog: client?.equipmentCatalog ?? [],');
    expect(admin).not.toContain('buildEquipmentCatalog(DEFAULT_EQUIPMENT[segment]');
  });

  it('o detector de placeholder continua existindo pros cadastros antigos', () => {
    // isPlaceholderCatalog (segments.js) foi criado porque esses genéricos já
    // tinham enganado a CASA DOCE. Cortamos a origem; o detector segue útil
    // pra quem já tem o lixo na nuvem.
    const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
    expect(pages).toContain('isPlaceholderCatalog(naTela)');
  });
});
