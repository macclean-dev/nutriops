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

// Converte uma lista de labels (ex: ['Freezer', 'Refrigerador']) no formato
// equipmentCatalog que `pages.jsx` e `repository.js` esperam.
export function buildEquipmentCatalog(labels) {
  return (labels ?? []).map(label => ({
    label,
    aliases: [label.toLowerCase()],
    location: 'Unidade principal',
  }));
}
