// ─────────────────────────────────────────────────────────────────────────────
// Temperaturas de UMA loja, buscadas por loja.
//
// A prop `records` do App não serve sozinha pra tela que mostra várias lojas:
// quando a sessão não é de admin global (o caso da RT com 3 unidades, que é
// justamente quem usa essas telas), `refreshRecords` (pages.jsx) só carrega a
// loja ATIVA, enquanto `visibleTenants` traz todas. Usar a prop crua faz as
// outras unidades aparecerem com zero leituras.
//
// Nasceu na Prontidão (readiness-view.jsx), onde isso fazia a unidade nascer
// "EM RISCO" sem evidência. Saiu de lá em 03/10 porque o Painel RT tinha o
// mesmo defeito (achado da pesquisa de funcionalidades): as unidades que não
// eram a ativa apareciam sem desvio e sem conformidade. Um lugar só, pra as
// duas telas não divergirem de novo.
// ─────────────────────────────────────────────────────────────────────────────

import { getTemperatureRepository } from './repository';

// Une as duas fontes: o repositório devolve o que veio da nuvem, e o que ainda
// está na fila offline vive só na prop. Pura, testável sem rede.
export function unirLeituras(doRepo, daProp) {
  const porId = new Map((doRepo ?? []).map((r) => [r.id, r]));
  for (const r of daProp ?? []) if (!porId.has(r.id)) porId.set(r.id, r);
  return [...porId.values()];
}

// Mesma janela de 90 dias que o App usa. Rede caiu: devolve o que a prop já
// tinha desta loja, melhor do que nada.
export async function readTenantTemperatures(tenant, records, repository = getTemperatureRepository()) {
  const daProp = (records ?? []).filter((r) => r.tenantId === tenant.id);
  try {
    const doRepo = await repository.list({ tenantId: tenant.id, days: 90 });
    return unirLeituras(doRepo, daProp);
  } catch {
    return daProp;
  }
}
