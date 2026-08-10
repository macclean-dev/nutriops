// ─────────────────────────────────────────────────────────────────────────────
// Log de novidades — "o que mudou desde a última vez que você abriu o app",
// pedido do dono (10/08), inspirado no Nexum. Puro: comparação de versão e
// filtro de entradas não vistas ainda; localStorage fica por conta da view.
//
// Manutenção: adicionar uma entrada nova aqui (topo do array) a cada versão
// que valha a pena o usuário saber — não precisa ser toda mudança técnica,
// só o que muda pra quem usa o app no dia a dia.
// ─────────────────────────────────────────────────────────────────────────────

export function compareVersions(a, b) {
  const pa = String(a ?? '0').split('.').map(Number);
  const pb = String(b ?? '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0, db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

// Mais recente primeiro. `items` na linguagem de quem usa o app, não jargão
// técnico — isso aqui é o que a pessoa lê, não um changelog de commit.
export const CHANGELOG = [
  { version: '1.9.117', date: '2026-08-10', items: [
    'Novo: sempre que o app for atualizado, essa telinha de novidades aparece pra contar o que mudou desde a última vez que você entrou.',
  ]},
  { version: '1.9.116', date: '2026-08-10', items: [
    'A nutricionista pode editar sozinha as opções de listas suspensas nas planilhas (ex.: "Qual banheiro"), sem precisar pedir mudança de código.',
    'O campo "Equipamento" nos controles de óleo e tratamento térmico agora sugere os equipamentos já cadastrados, evitando registros duplicados por erro de digitação.',
  ]},
  { version: '1.9.115', date: '2026-08-10', items: [
    'Planilha de higienização de banheiros: opção "Vestiário" trocada por "Unissex 1º andar".',
  ]},
  { version: '1.9.114', date: '2026-08-10', items: [
    'Avaliação do óleo de fritura ganhou campos de Data e Responsável, e usa o grau de acidez real (teste da fita) pra sugerir o resultado.',
  ]},
  { version: '1.9.113', date: '2026-08-10', items: [
    'O período das planilhas semanais agora mostra as datas (ex.: "9–15 de agosto") em vez do número da semana.',
  ]},
  { version: '1.9.112', date: '2026-08-10', items: [
    'Exportação mensal e Auditoria agora trazem o histórico completo, mesmo além dos últimos 90 dias.',
  ]},
  { version: '1.9.111', date: '2026-08-09', items: [
    'Tarefas com frequência diferente da planilha (ex.: uma limpeza trimestral dentro de uma folha semanal) só cobram na semana certa.',
  ]},
  { version: '1.9.110', date: '2026-08-09', items: [
    'O Painel da Nutricionista RT ganhou um resumo da semana: não conformidades novas, ações resolvidas e planilhas validadas.',
  ]},
  { version: '1.9.109', date: '2026-08-09', items: [
    'Nova forma de importar planilha de papel: tire uma foto ou envie um PDF e a IA sugere um rascunho pra revisar antes de publicar.',
  ]},
  { version: '1.9.108', date: '2026-08-09', items: [
    'Novo "Dossiê Completo": gera um PDF único com todas as seções (temperatura, planilhas, capacitação, não conformidades, controles, recebimento, validades, manutenção e POPs) prontas pra fiscalização.',
  ]},
  { version: '1.9.107', date: '2026-08-09', items: [
    'Controles especiais (resfriamento, tratamento térmico, descongelamento) sugerem o resultado a partir da própria medição — você só confirma, ou justifica se discordar.',
  ]},
];

export function getUnseenEntries(lastSeenVersion, entries = CHANGELOG) {
  if (!lastSeenVersion) return []; // 1º acesso: nada "novo" pra mostrar, só passa a acompanhar a partir daqui
  return entries.filter((e) => compareVersions(e.version, lastSeenVersion) > 0);
}
