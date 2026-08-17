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
  { version: '1.9.148', date: '2026-08-17', items: [
    'Corrigido: os equipamentos cadastrados na Manutenção não estavam subindo para a nuvem. Os mais antigos não tinham um código interno que o servidor exige, e eram recusados a cada tentativa. Agora o app gera esse código e envia — nada precisa ser recadastrado.',
    'Corrigido também: reenviar um recebimento já salvo dava erro de duplicado em vez de simplesmente não fazer nada. Como o app reenvia o acervo antigo a cada abertura, isso se repetia todo dia e travava a sincronização de fundo — que nunca terminava e recomeçava do zero na abertura seguinte.',
    'Com os dois, o envio do acervo antigo finalmente conclui e para de repetir.',
  ]},
  { version: '1.9.147', date: '2026-08-17', items: [
    'O aviso vermelho de sincronização parou de acusar a chave sem saber. Ele dizia "chave do Supabase inválida" para qualquer recusa do servidor — inclusive quando a chave estava perfeita e o que faltava era o vínculo do acesso com a loja. Agora ele diz o que realmente aconteceu, e some sozinho em até 10 segundos depois que a sincronização volta.',
    'Uma falha isolada de rede não pinta mais a tela de vermelho: o aviso só aparece se o problema insistir. Antes ele surgia e sumia sozinho, assustando sem motivo.',
    'Em todos os casos o aviso agora lembra que nenhum registro se perde — o que não subiu fica na fila e sobe depois.',
  ]},
  { version: '1.9.146', date: '2026-08-17', items: [
    'O registro rápido agora confirma na tela: "✓ Registrado: 3,4°C em Vitrine Refrigerada". Antes a janela apenas fechava — exatamente igual a fechar sem querer tocando fora dela. Não havia como saber se a leitura tinha sido gravada ou perdida. A tela inicial sempre confirmou, e era a única em que as equipes confiavam.',
    'Tocar fora da janela não descarta mais um número já digitado. Para sair sem registrar, use o Cancelar.',
    'E se der erro ao salvar, agora aparece um aviso vermelho dizendo que a leitura NÃO foi registrada. Antes o erro era engolido e a janela ficava parada, sem explicar nada.',
  ]},
  { version: '1.9.145', date: '2026-08-17', items: [
    'Correção importante no registro rápido (o "+ Registrar" do card do equipamento): quando o app suspeitava que faltou o sinal de menos — digitar 20 num freezer que trabalha a −20°C, por exemplo — ele bloqueava para você confirmar, mas o botão continuava verde escrito "Registrar" e simplesmente não fazia nada. Dava pra medir, tocar e ir embora achando que registrou. Agora o botão fica cinza e diz "Confirme o sinal acima".',
    'No celular, a janela de registro rápido agora rola. Quando o aviso de sinal aparecia com o teclado aberto, o botão ficava embaixo da borda da tela e não tinha como alcançar.',
  ]},
  { version: '1.9.144', date: '2026-08-17', items: [
    'Os aparelhos agora se atualizam sozinhos. Antes, quem registrava no computador não aparecia nos tablets até alguém sair e entrar de novo — o app só buscava dados ao abrir. Agora ele busca a cada 2 minutos e sempre que a tela volta a ser usada, inclusive no Modo Quiosque.',
    'Corrigido: "Suas leituras hoje" não contava as leituras feitas pelo Modo Quiosque. O registro sempre esteve certo, com o nome de quem mediu — quem estava errado era o contador da tela inicial.',
    'Correção importante: quando a nuvem não responde (queda de internet ou problema de permissão), a tela passa a mostrar o histórico guardado no aparelho em vez de aparecer vazia. Era isso que fazia parecer que os registros de uma loja tinham sumido.',
  ]},
  { version: '1.9.143', date: '2026-08-17', items: [
    'Correção importante no Modo Quiosque: quando a temperatura está bem fora da faixa, o app pede uma observação antes de salvar — mas o botão ✓ ficava apenas cinza e não dizia nada. O dedo sentia que apertou e a leitura não era gravada. Agora aparece um aviso vermelho, bem visível: "Ainda não salvou" e o motivo.',
    'Também corrigido: se ficasse só um sinal de menos no visor (ao apagar dígitos, por exemplo), o app gravava um valor vazio que nunca conseguia subir e travava a fila de envio. Agora ele avisa que o número está incompleto.',
    'E as leituras que ainda não subiram para a nuvem passam a aparecer na tela normalmente. Antes elas ficavam salvas e seguras no aparelho, mas invisíveis — parecia que não tinham sido registradas, e só apareciam depois de sair e entrar de novo.',
  ]},
  { version: '1.9.140', date: '2026-08-17', items: [
    'Manutenção agora fica guardada na nuvem — ativos, execuções e ordens de serviço. Era o último módulo que vivia só no aparelho: trocar ou limpar o celular apagava o histórico de manutenção, que a RDC 216 exige manter. Com isso, nenhuma evidência do app depende mais de um aparelho específico.',
    'Na tela de Prontidão, o item "a evidência sobrevive a uma troca de aparelho?" passa a responder que sim para todos os módulos.',
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
