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
  { version: '1.9.129', date: '2026-08-15', items: [
    'A tela "Validades e Estoque" virou só "Validades". O controle de estoque (entrada/saída, estoque mínimo) saiu do NutriOPS — quem faz isso é o Nexum, e manter os dois pedindo o mesmo número só garantia que os dois ficassem errados. Continua tudo de validade: vencimentos, validade pós-abertura, regras por categoria e as etiquetas.',
  ]},
  { version: '1.9.128', date: '2026-08-15', items: [
    'Corrigido: esta telinha de novidades sumia sozinha logo depois de uma atualização, antes de dar tempo de ler. Agora ela só fecha quando você toca em "Entendi".',
  ]},
  { version: '1.9.127', date: '2026-08-15', items: [
    'Em Relatórios → Gráficos dá pra ordenar por "Pior conformidade primeiro" — os equipamentos com problema sobem pro topo em vez de ficarem escondidos no meio da lista. Uma linha no topo já diz quantos estão fora de 100% e quantos estão sem leitura no período.',
  ]},
  { version: '1.9.126', date: '2026-08-14', items: [
    'Correção importante: agora dá pra digitar temperatura negativa no celular e no tablet. O teclado numérico do aparelho não tem tecla de menos, então leituras de freezer estavam sendo gravadas positivas (-18 virava +18). Cada campo de temperatura ganhou um botão ± ao lado.',
    'Se mesmo assim um valor positivo for digitado num equipamento de congelamento, o app pergunta "Faltou o sinal de menos?" e corrige num toque, em vez de deixar passar.',
  ]},
  { version: '1.9.125', date: '2026-08-13', items: [
    'Histórico de Acessos: agora dá pra filtrar por usuário e por período (7/30/90 dias ou tudo), e exportar em CSV.',
  ]},
  { version: '1.9.124', date: '2026-08-13', items: [
    'Registrar temperatura: quando a leitura fica bem fora da faixa, agora pede pra descrever a ação tomada antes de salvar (no computador e no quiosque) — vira parte do registro e aparece na Central de Não-conformidades.',
    'Trocar quem está registrando (conta de loja) agora também funciona pelo celular — antes só dava pra trocar no computador/tablet.',
  ]},
  { version: '1.9.123', date: '2026-08-13', items: [
    'Modo Quiosque: botões "Todos"/"Nenhum" pra montar a seleção de equipamentos rápido, e o "marcar/desmarcar setor" ficou mais visível (agora é um botão, não só um textinho sublinhado).',
  ]},
  { version: '1.9.122', date: '2026-08-10', items: [
    'Corrigido: no gráfico de temperatura, os rótulos "máx"/"mín" cortavam na borda do card pra equipamentos com faixa negativa (freezers).',
  ]},
  { version: '1.9.121', date: '2026-08-10', items: [
    'O "Registrar agora" da tela inicial agora separa os equipamentos por setor, igual ao modo quiosque — antes vinham todos numa lista corrida, e quem cuida de uma área só precisava caçar os dela no meio das outras.',
  ]},
  { version: '1.9.120', date: '2026-08-10', items: [
    'O app agora avisa quando a lista de equipamentos que está na tela não é a da sua unidade (antes ele mostrava uma lista de exemplo em silêncio, e dava pra registrar temperatura num equipamento que não existe). Tem um botão "Tentar de novo" no próprio aviso.',
  ]},
  { version: '1.9.119', date: '2026-08-10', items: [
    'Correção: a nutricionista RT agora consegue convidar colaboradores de verdade (o botão aparecia mas dava erro "você não administra esta empresa").',
  ]},
  { version: '1.9.118', date: '2026-08-10', items: [
    'Correção importante: nas planilhas com pergunta de "ocorrência" (ex.: vetores e pragas), o botão "Sem ocorrência" não ficava mais marcado por engano antes de alguém realmente tocar nele — agora fica claro quando a pergunta ainda não foi respondida.',
  ]},
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
