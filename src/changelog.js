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
  { version: '1.9.194', date: '2026-08-21', items: [
    'Sumiu o aviso vermelho de "sincronização falhando — sem permissão para esta loja". Era alarme falso: a verificação automática que o app faz ao abrir não estava usando o seu login, e o banco recusava por isso — não por falta de permissão sua. Seu acesso sempre esteve certo, e nenhum registro foi afetado.',
    'Se você chegou a ver esse aviso, ele some sozinho na primeira vez que abrir o app depois desta atualização.',
  ]},
  { version: '1.9.193', date: '2026-08-21', items: [
    'Quem tem mais de uma unidade agora usa UM login só. Em Equipe → Usuários apareceu "Vincular conta existente": você informa o e-mail de quem já usa o NutriOPS em outra empresa, escolhe o perfil dela aqui, e pronto — ela entra com a mesma senha de sempre e troca de empresa dentro do app.',
    'Serve pra dono de várias lojas, nutricionista RT que responde por mais de uma unidade e supervisora que cobre duas. Antes só dava pra criar conta NOVA: quem já tinha e-mail cadastrado precisava pedir pro suporte fazer o vínculo à mão.',
    'Importante: não crie uma segunda conta pra mesma pessoa. Os registros dela ficariam divididos entre dois nomes na trilha de auditoria — use o vínculo.',
  ]},
  { version: '1.9.189', date: '2026-08-20', items: [
    'Agora dá pra colocar qualquer planilha dentro de uma aba de setor da Higienização — é só escolher em qual setor ela entra. Antes só as planilhas cujo nome já começava com "Higienização — " conseguiam ficar lá, e as outras não tinham como entrar.',
    'Na prática: a "Lavagem do Filtro de Café" pode aparecer na aba Atendimento Pães e Café, ao lado da higienização daquele setor, sem precisar mudar o nome dela (o nome é o que sai no PDF do fiscal). E dá pra criar uma aba nova pra uma planilha que não se encaixa em nenhuma das existentes.',
    'Em Planilhas BPF → Organizar. Vale só para a sua empresa, como o resto da organização de planilhas.',
    'Corrigido junto: se o armazenamento do aparelho estiver cheio na hora de salvar a organização, o app agora avisa em vez de mostrar a mudança na tela e perdê-la ao recarregar.',
  ]},
  { version: '1.9.185', date: '2026-08-20', items: [
    'Concluímos a revisão ativa do sistema que começamos em 17/08 — de ponta a ponta, tela por tela, sempre em busca da mesma coisa: casos em que o app dizia "salvo" ou "sincronizado" sem ter feito de verdade. Passamos os últimos dias corrigindo o que essa revisão encontrou. Como da vez passada, a maioria são falhas antigas que passamos a pegar de forma sistemática, não problemas novos.',
    'Mais confiável quando algo falha: agora o app avisa (em vez de ficar quieto) quando o armazenamento do aparelho está cheio ao salvar os dados da empresa, quando a sincronização não confirma nada de verdade com a nuvem, quando um backup não consegue ser lido, e quando a fila de envio pendente fica tão cheia que precisa descartar os itens mais antigos.',
    'Dois colaboradores com o mesmo nome na mesma empresa agora são bloqueados no cadastro — nomes duplicados podiam fazer um substituir o outro silenciosamente na nuvem.',
    'A tela de Manutenção passou a atualizar sozinha quando a sincronização termina (equipamentos, ordens de serviço, histórico de execuções), em vez de exigir recarregar a página. O mesmo vale para o badge de manutenções pendentes no menu lateral.',
    'A Central de Não-conformidades ganhou avisos mais claros: o botão de criar ação corretiva agora exige uma descrição, e a tela avisa quando não consegue carregar as pendências de planilhas ou controles especiais, em vez de parecer que está tudo em ordem.',
    'Correções de leitura de temperatura feitas pela RT agora deixam claro quando a nuvem não confirma o salvamento, e o gráfico de temperatura por equipamento avisa quando está mostrando só uma parte do período (para não ficar pesado com centenas de pontos).',
    'A tela "Saúde dos Tenants" (uso interno da administração) tinha uma falha que impedia o alerta mais grave de inatividade de disparar; corrigido, junto com o gráfico de atividade que perdia registros feitos à noite por causa do fuso horário.',
    'Vários botões desabilitados (por exemplo, "Testar conexão" sem os dados preenchidos) continuavam parecendo clicáveis — agora ficam visualmente apagados, principalmente perceptível em tablets.',
    'Diversos ajustes menores de sincronização entre aparelhos e lojas — catálogo de equipamentos, planilhas, controles especiais e cadastro de clientes — para que o que um aparelho registra sempre chegue aos outros de forma confiável.',
  ]},
  { version: '1.9.165', date: '2026-08-19', items: [
    'Nos últimos dias fizemos uma revisão ativa do sistema, testando fluxo por fluxo em busca de falhas silenciosas — casos em que a tela dizia "salvo" sem ter salvo de verdade. As correções abaixo vêm dessa revisão: a maioria são falhas antigas que passamos a encontrar de forma sistemática, não problemas que surgiram agora.',
    'Relatórios: cabeçalhos e cards de resumo (Temperatura, Planilhas BPF, Capacitação, Auditoria, Validades) agora são clicáveis — um clique ordena a tabela, outro filtra por um grupo, e dá pra voltar ao normal a qualquer momento.',
    'A RT ganhou autonomia total para organizar as Planilhas BPF: nome das abas, em qual aba cada planilha aparece, e o nome, a frequência e a descrição de cada uma — sem precisar pedir alteração no sistema. Vale só para a sua empresa.',
    'Sincronização entre empresas ficou mais precisa: a planilha do Reservatório de Água, o catálogo de equipamentos e o backup agora respeitam corretamente os limites entre empresas — cada uma só vê e edita os próprios dados.',
    'Backup mais seguro: o arquivo exportado deixou de carregar senha de acesso e sessão, e cada backup passa a pertencer a uma única empresa. Backups antigos guardados fora do aparelho ainda contêm esses dados — vale substituí-los pelos novos.',
    'Uma correção de leitura de temperatura feita na Auditoria agora fica registrada de forma definitiva, sem risco de reverter sozinha na sincronização seguinte.',
    'Mais avisos para nunca confirmar "salvo" sem ter salvo: armazenamento cheio, alterações não salvas ao sair de uma tela, data inválida num campo, e nome de equipamento repetido dentro da mesma empresa.',
  ]},
  { version: '1.9.154', date: '2026-08-18', items: [
    'A tela inicial passou a mostrar a atividade da loja no dia inteiro — quem registrou o quê, mesmo em contas compartilhadas por vários colaboradores.',
    'Planilhas com campo Setor (Hortifrutícolas, Higiene Pessoal, Vetores e Pragas) agora deixam cada setor preencher a própria via no mesmo dia, sem um sobrescrever o outro.',
    'A Manutenção passou a enxergar todos os equipamentos monitorados na hora de abrir uma Ordem de Serviço, e os controles especiais (óleo, resfriamento, descongelamento, tratamento térmico) e a higiene das mãos passaram a sincronizar entre aparelhos em tempo real.',
    'Renomear um equipamento no catálogo deixou de criar uma cópia — o nome antigo some de verdade.',
  ]},
  { version: '1.9.148', date: '2026-08-17', items: [
    'Manutenção (ativos, execuções e ordens de serviço) passou a sincronizar com a nuvem — era o último módulo que dependia só do aparelho.',
    'Os aparelhos passaram a se atualizar sozinhos entre si, sem precisar sair e entrar para ver o que outro dispositivo já registrou.',
    'No Modo Quiosque e no registro rápido, uma leitura fora da faixa agora avisa claramente quando NÃO foi salva, em vez de dar a impressão de que salvou.',
    'O aviso de sincronização parou de acusar "chave inválida" sem necessidade, e passou a explicar a causa certa.',
    'Corrigidas travas na fila de envio que deixavam equipamentos de Manutenção e recebimentos presos sem subir para a nuvem.',
  ]},
  { version: '1.9.139', date: '2026-08-16', items: [
    'Novo em Configurações: "Planilhas BPF duplicadas". Mostra quantas cópias repetidas a loja acumulou e limpa com um clique — sempre mostrando antes o que vai acontecer, e sem apagar nenhum registro preenchido.',
    'Correção importante junto: registros de planilha que tinham ficado "soltos" (apontavam pra uma cópia que não existe mais) voltam a aparecer na Central de Não-conformidades. Na Swiss eram 35 de 41 registros invisíveis — o histórico estava lá, mas nenhuma tela mostrava.',
  ]},
  { version: '1.9.137', date: '2026-08-16', items: [
    'Corrigido: uma loja com acesso só à própria unidade (login por e-mail) ficava tentando sincronizar as OUTRAS lojas do sistema sem parar, gerando erros de permissão em loop no fundo — nunca aparecia pro usuário, mas consumia rede à toa e enchia o console de avisos. Agora cada aparelho só tenta sincronizar o que a sessão dele alcança.',
  ]},
  { version: '1.9.136', date: '2026-08-16', items: [
    'Corrigido: o aviso vermelho "chave do Supabase inválida" aparecia sozinho e sumia sozinho, sem a chave ter problema nenhum. O que acontecia era a sessão sendo renovada — várias telas pediam a renovação ao mesmo tempo e atrapalhavam umas às outras. Agora a renovação é uma só, e ninguém é desconectado por causa disso.',
    'Quando o aviso realmente precisar aparecer, ele passa a dizer a causa certa: "sua sessão não está sendo renovada" (é só sair e entrar de novo) ou "chave inválida" (aí sim é configuração). E não alarma mais na primeira falha passageira.',
  ]},
  { version: '1.9.135', date: '2026-08-15', items: [
    'Nova aba "Saúde (ASO)" dentro de Capacitação: registre o exame de cada colaborador com data e validade, e veja num painel quem está em dia, quem vence em breve e quem está sem exame. O ASO é item clássico de autuação e até agora o app não tinha onde anotar.',
    'O alvará sanitário agora tem data de validade. A tela de Prontidão avisa quando ele está vencendo — renovação de alvará costuma demorar, e antes o app guardava só o número.',
    'Em Configurações dá pra registrar o Manual de Boas Práticas (versão, data e quem elaborou). O NutriOPS não guarda o arquivo: guarda o registro de que ele existe, que é o que faltava pra tela de Prontidão parar de responder "sem dado".',
    'Com isso, uma loja realmente em dia agora consegue ler PRONTA na tela de Prontidão. Até esta versão o veredito máximo era "PRONTA COM RESSALVAS", porque faltavam capturas no app.',
  ]},
  { version: '1.9.134', date: '2026-08-15', items: [
    'Nova planilha "Higienização do Reservatório de Água", semestral, em todas as lojas. A RDC 216 exige a limpeza do reservatório a cada 6 meses com registro, e até agora o app não tinha onde guardar isso — na tela de Prontidão esse item vivia como "sem dado". Agora ele responde de verdade.',
    'O comprovante de dedetização agora aceita foto ou PDF do laudo. Antes a planilha pedia "anexar comprovante" mas só tinha campo de texto — o documento em si nunca era anexado.',
    'Em Configurações dá pra ajustar a validade da dedetização da loja (padrão 6 meses). A norma não fixa esse prazo: quem manda é o contrato da empresa de controle de pragas e a vigilância do município.',
  ]},
  { version: '1.9.133', date: '2026-08-15', items: [
    'Correção importante: as planilhas BPF da Swiss, da Bäckerei e da DBK estavam se duplicando sozinhas — cada tela aberta criava mais uma cópia de cada planilha. Agora para de duplicar. As cópias que já existem continuam na lista por enquanto: apagá-las exige decidir o que fazer com o que já foi preenchido dentro de cada uma, e isso vai ser tratado à parte.',
  ]},
  { version: '1.9.132', date: '2026-08-15', items: [
    'POPs e Capacitação agora ficam guardados na nuvem, como as planilhas e as temperaturas. Antes viviam só no aparelho de quem cadastrou — trocar ou limpar o celular apagava certificados de treinamento e POPs sem aviso. Agora eles voltam sozinhos em qualquer aparelho da loja.',
    'A validade do treinamento configurada (ex.: 24 meses) também sincroniza — um aparelho novo não volta mais pro padrão de 12 meses por conta própria.',
    'A assinatura de período da RT (em Relatórios → Auditoria) agora é registrada por empresa e guardada na nuvem, valendo como trilha de verificação da loja mesmo que o aparelho original suma.',
  ]},
  { version: '1.9.130', date: '2026-08-15', items: [
    'Nova tela "Prontidão" (menu Gestão): responde "se a vigilância chegasse agora, esta loja passaria?". Cada empresa ganha um veredito ao vivo — PRONTA, PRONTA COM RESSALVAS ou EM RISCO — com a lista do que falta e um botão que leva direto pra tela que resolve cada item.',
    'As pendências vêm separadas por gravidade: o grupo A é o que gera auto de infração na hora (produto vencido, temperatura sem registro no turno, capacitação vencida, não conformidade sem ação, dedetização fora do prazo). Só pendência do grupo A pinta a loja de EM RISCO.',
    'Quando o app ainda não tem como saber (higienização do reservatório, ASO dos manipuladores, Manual de Boas Práticas), a tela diz "sem dado" em vez de fingir que está tudo certo — e explica o que falta capturar.',
  ]},
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
