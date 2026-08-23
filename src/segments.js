// Segmentos de estabelecimento e equipamentos default por segmento.
// Compartilhado entre o onboarding wizard e o painel admin pra que tenants
// criados num lado tenham a mesma metadata seed.

export const SEGMENTS = [
  { id: 'padaria',      label: 'Padaria',                localityType: 'Loja' },
  { id: 'confeitaria',  label: 'Confeitaria',            localityType: 'Loja' },
  { id: 'restaurante',  label: 'Restaurante',            localityType: 'Loja' },
  { id: 'lanchonete',   label: 'Lanchonete / Fast food', localityType: 'Loja' },
  { id: 'cafeteria',    label: 'Cafeteria',              localityType: 'Loja' },
  { id: 'producao',     label: 'Produção de alimentos',  localityType: 'Produção' },
  { id: 'catering',     label: 'Catering / Eventos',     localityType: 'Loja' },
  { id: 'outro',        label: 'Outro',                  localityType: 'Loja' },
];

export const DEFAULT_EQUIPMENT = {
  padaria:     ['Câmara Refrigerada', 'Câmara Congelada', 'Vitrine Refrigerada', 'Balcão Refrigerado'],
  confeitaria: ['Freezer', 'Refrigerador', 'Vitrine Refrigerada', 'Cervejeiro'],
  restaurante: ['Câmara Fria', 'Freezer', 'Refrigerador de Saladas', 'Balcão Refrigerado'],
  lanchonete:  ['Freezer', 'Refrigerador', 'Balcão Refrigerado', 'Estufa Quente'],
  cafeteria:   ['Refrigerador', 'Vitrine Refrigerada', 'Freezer'],
  producao:    ['Câmara Refrigerada', 'Câmara Congelada', 'Refrigerador', 'Freezer'],
  catering:    ['Câmara Fria', 'Freezer', 'Refrigerador', 'Caixa Térmica'],
  outro:       ['Refrigerador', 'Freezer'],
};

export const DEFAULT_MODULES = ['Temperatura', 'Higiene Pessoal', 'Vetores e Pragas', 'Faxina'];

export function segmentLabel(id) {
  return SEGMENTS.find(s => s.id === id)?.label ?? id ?? 'Estabelecimento';
}

export function segmentLocalityType(id) {
  return SEGMENTS.find(s => s.id === id)?.localityType ?? 'Loja';
}

// O campo `tenant.segment` guarda o LABEL pronto pra exibir (contrato usado
// em toda a base — App.jsx, pages.jsx, reports-views.jsx etc. imprimem
// `tenant.segment` direto, sem passar por segmentLabel). O <select> do
// ClientModal, porém, trabalha com IDs minúsculos ('confeitaria').
//
// Sem esta ponte, abrir "Editar" num cliente existente comparava o label
// salvo ("Confeitaria") com os ids das opções — nunca batia — e o <select>
// caía no valor padrão do navegador (a 1ª opção, "Padaria"), não importa o
// segmento real. Escolher "Confeitaria" ali corrigia a tela, mas ao reabrir
// o mesmo cliente o mesmo descasamento acontecia de novo: parecia que a
// escolha "não pegava" (achado do dono, 23/08).
//
// `startsWith` cobre o seed antigo de `tenants-public.js`, que guarda forma
// curta ("Produção") enquanto o label completo é "Produção de alimentos".
export function segmentIdFromLabel(value) {
  const alvo = String(value ?? '').trim().toLowerCase();
  if (!alvo) return null;
  const porId    = SEGMENTS.find(s => s.id === alvo);
  if (porId) return porId.id;
  const porLabel = SEGMENTS.find(s => s.label.toLowerCase() === alvo);
  if (porLabel) return porLabel.id;
  const porPrefixo = SEGMENTS.find(s => s.label.toLowerCase().startsWith(alvo));
  return porPrefixo?.id ?? null;
}

// Converte uma lista de labels (ex: ['Freezer', 'Refrigerador']) no formato
// equipmentCatalog que `pages.jsx` e `repository.js` esperam.
export function buildEquipmentCatalog(labels) {
  return (labels ?? []).map(label => ({
    label,
    aliases: [label.toLowerCase()],
    location: 'Unidade principal',
  }));
}

// O catálogo "de fábrica" é real? Não — é o que `buildEquipmentCatalog` gera
// pra uma loja recém-criada: genéricos do segmento, todos no setor inventado
// 'Unidade principal' e sem faixa de temperatura. É um provisório à espera do
// catálogo de verdade, que vive na TABELA equipment_catalog da nuvem.
//
// POR QUE detectar: quando o sync do catálogo falha, ele engole o erro e só
// escreve no console (`syncEquipmentCatalog`, repository.js) — num tablet
// ninguém vê console. O device fica exibindo esses genéricos como se fossem os
// equipamentos da loja. Aconteceu na CASA DOCE (07 e 10/08): a loja tem 44
// equipamentos em 11 setores, e um aparelho mostrava 4 falsos num setor só —
// a nutricionista leu isso como "o app parou de agrupar", não como "não
// sincronizou". Pior: dá pra registrar temperatura de equipamento inexistente.
//
// Mora aqui de propósito, ao lado do gerador: se um mudar sem o outro, o
// detector para de reconhecer o próprio provisório que o app cria.
export function isPlaceholderCatalog(catalog) {
  const list = Array.isArray(catalog) ? catalog : [];
  if (list.length === 0) return false;   // vazio é vazio — quem trata é o chamador
  const genericos = new Set(Object.values(DEFAULT_EQUIPMENT).flat());
  return list.every((eq) =>
    eq?.location === 'Unidade principal' &&
    genericos.has(eq?.label) &&
    eq?.minTemp == null && eq?.maxTemp == null);
}
