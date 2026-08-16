# Revisão de produto — NutriOPS (09/08/2026)

> Revisão profunda feita a pedido do dono, com a regra: **não reinventar o
> produto**. Cada achado abaixo vem de leitura direta do código (três varreduras
> completas: dashboards/relatórios, controles/alertas, fluxo de captura no
> tablet), com arquivo e linha citados. Onde não há evidência, está escrito
> "não tenho informação suficiente".

---

## 1. Entendimento do produto

**Propósito.** Substituir as planilhas de papel da conformidade sanitária
(RDC 216/ANVISA) por registro digital com evidência: temperaturas de
equipamentos, planilhas de boas práticas (BPF), controles de processo (óleo,
descongelamento, resfriamento, tratamento térmico, higiene de mãos),
recebimento, validades/estoque, capacitação — tudo com autor, hora e validação
da nutricionista responsável (RT).

**Usuários e papéis reais:**

- **Colaborador** — registra no tablet do balcão (quiosque) ou celular. Meta:
  velocidade. "Produção é uma loucura" (palavras do cliente).
- **Nutricionista RT** — monta as planilhas, valida os preenchimentos, corrige
  registros, responde pela conformidade perante a vigilância.
- **Dono da loja / Supervisor** — quer saber "está tudo em dia?" sem fuçar.
- **Dono da plataforma** — opera 4 clientes, acompanha saúde e cobrança.

**Fluxos centrais:** (a) rodada de temperaturas por turno no quiosque;
(b) preenchimento das planilhas BPF por período (dia/semana/quinzena/mês);
(c) validação RT; (d) relatórios/PDF pra fiscalização; (e) onboarding de novo
cliente (transcrever as planilhas de papel dele pra dentro do sistema).

**Dado que o sistema já possui:** meses de séries de temperatura por
equipamento (Swiss: 632 registros/90d), faixas min/max por equipamento,
respostas completas de planilha em JSON (incluindo seções de não conformidade),
recebimentos com resultado aceito/rejeitado, controles especiais com veredito,
catálogo de equipamentos com setor, equipe nomeada por loja, log de acesso com
IP. **Boa parte desse dado hoje é gravado e nunca mais lido** — é a maior
oportunidade da revisão.

---

## 2. O que está bom (e não deve ser mexido)

- **A fila offline** (`repository.js`): todo push enfileira mesmo sem nuvem.
  É a fundação certa pra ambiente de cozinha com Wi-Fi ruim. Não tocar.
- **O quiosque de temperatura em si**: ~4 toques por equipamento, avanço
  automático pro próximo pendente, agrupamento por setor, numpad grande.
  O desenho está certo — os ajustes sugeridos (item 8) são lapidação, não redesenho.
- **A trilha de correção da auditoria** (`reports-views.jsx:671-687`): valor
  original riscado + motivo obrigatório + quem corrigiu. Exatamente o que uma
  fiscalização quer ver.
- **A validação da RT** carimba `by/role/at` sozinha (`forms.jsx:1194-1201`) —
  o padrão de UX que o resto das assinaturas deveria seguir.
- **Postura de segurança recente** (RLS nas 9 tabelas, PIN aposentado,
  device-token removido): acima da média pra SaaS desse porte.
- **PDF por `window.print()` sem biblioteca**: zero dependência, funciona em
  produção. Não trocar por lib de PDF.
- **O heatmap semanal da RT** (`overview-v2.jsx:289`): conceito ótimo — o
  ajuste sugerido é só distinguir "sem leitura" de "não devida" (item 5).

## 3. Onde não tenho informação suficiente

- **Telemetria de uso real**: não sei quais telas os colaboradores de fato
  abrem, nem se usam celular além do tablet. As sugestões de UX partem da
  contagem de toques no código, não de observação de uso.
- **Apetite da RT por e-mail**: o resumo semanal (item 12) pode ser só in-app;
  não sei se ela quer e-mail.
- **Causa do zero da DBK na nuvem**: pode ser só device offline; não dá pra
  avaliar pelo código.

---

## 4. Tabela geral (ordem de prioridade)

| # | Melhoria | Categoria | Benefício | Impacto | Complexidade | Prioridade |
|---|----------|-----------|-----------|---------|--------------|------------|
| 1 | Assinatura de 1 toque nas planilhas | AUTOMAÇÃO | Corta ~150 teclas e 15 date-pickers por folha | Alto | Baixa | Alta |
| 2 | Central de não-conformidades | INSIGHT | NC registrada deixa de evaporar; RT enxerga tudo num lugar | Alto | Média | Alta |
| 3 | Ações corretivas e higiene de mãos na nuvem | MELHORIA | Evidência legal não some se o device for limpo | Alto | Baixa | Alta |
| 4 | Tablet de planilhas: não apagar o que existe + rascunho | MELHORIA | Elimina perda de dados silenciosa | Alto | Baixa | Alta |
| 5 | "Minha lista de hoje" do colaborador | UX | Planilha deixa de atrasar por esquecimento | Alto | Média | Alta |
| 6 | Sentinela de tendência dos equipamentos | INSIGHT | Avisa a câmara degradando antes do prejuízo | Alto | Média | Alta |
| 7 | Uma régua só de cálculo (tone/conformidade/capacitação) | MELHORIA | O mesmo número em todas as telas | Médio | Baixa | Alta |
| 8 | Quiosque: overlay dispensável, leituras do dia semeadas, config relida | UX | Menos espera e menos leitura duplicada | Médio | Baixa | Média |
| 9 | Veredito automático nos controles especiais | AUTOMAÇÃO | Resultado deixa de poder contradizer a medição | Médio | Baixa | Média |
| 10 | Dossiê de fiscalização completo em 1 clique | MELHORIA | Visita da vigilância resolvida na hora | Alto | Média | Média |
| 11 | Importar planilha de papel por foto (IA) | IA | Onboarding de dias vira minutos | Alto | Alta | Média |
| 12 | Resumo semanal da RT (in-app; e-mail opcional) | AUTOMAÇÃO | RT para de caçar pendência tela a tela | Médio | Média | Média |
| 13 | Tarefa com frequência própria dentro da folha semanal | MELHORIA | "Parede (mensal)" para de cobrar toda semana | Médio | Média | Média |
| 14 | Acabar com o teto silencioso de 90 dias | MELHORIA | Export mensal antigo deixa de sair vazio | Médio | Média | Média |
| 15 | Período legível ("8–14 de agosto") | UX | Colaborador entende o prazo sem decifrar "W33" | Baixo | Baixa | Média |
| 16 | Observação obrigatória em registro crítico | MELHORIA | Desvio nasce com a ação anotada (exigência RDC) | Médio | Baixa | Média |
| 17 | Trocar operador no celular | UX | Atribuição correta fora do desktop | Baixo | Baixa | Baixa |
| 18 | Filtros e export no histórico de acessos | MELHORIA | Investigação de acesso mais rápida | Baixo | Baixa | Baixa |

Nenhum item é "NOVA FUNCIONALIDADE" pura — o mais próximo é o 11, e a
justificativa está no detalhamento.

---

## 5. As 10 melhores, em detalhe

### 1. Assinatura de 1 toque nas planilhas (`date_sig`)

- **O que existe:** cada tarefa de higienização tem um campo `date_sig` = um
  `<input type=date>` vazio + um texto "Responsável" digitado à mão
  (`forms.jsx:1079-1088`, `kiosk.jsx:481-489`). Numa folha da Padaria são 14
  tarefas; Confeitaria, 28; Bistrô, 30. O sistema **já sabe** quem está
  registrando (operador escolhido no picker) e que dia é hoje — e carimba os
  dois automaticamente no `record.user`/`createdAt` (`forms.jsx:1339-1342`).
- **Problema:** o colaborador digita o próprio nome 14–30 vezes por folha e
  abre 14–30 date-pickers pra informar "hoje". ~32 toques + ~150 teclas numa
  folha de 14 tarefas. É o maior atrito diário do produto — e convida ao
  preenchimento relaxado, que é o inimigo da conformidade.
- **Como melhorar:** o `DateSigField` vira um botão **"✓ Feito"** que carimba
  `{date: hoje, sig: operadorAtual}` num toque, exibindo "09/08 · Fran" com um
  lápis pra editar quando a tarefa foi de outra pessoa/dia. Mesmo padrão da
  validação RT, que já funciona assim. Os campos "Responsável pelo setor" e
  afins viram `select` da equipe (o `readStaff()` já existe,
  `operator-picker.jsx:17`).
- **IA:** não precisa. É carimbo, não inteligência.
- **Benefício:** folha de 14 tarefas cai de ~32 pra ~16 toques, sem digitação.
- **Impacto no negócio:** é a tela que o cliente usa todo dia; é onde o "mais
  simples que papel" se prova. Retenção pura.
- **Complexidade:** Baixa (1 componente + trocar `text`→`select` em templates
  com `v` bump). **Prioridade:** Alta.
- **Justificativa:** melhora algo existente com dado que o sistema já possui
  (categorias A+C). A contagem de toques é medida no código, não estimada.

### 2. Central de não-conformidades

- **O que existe:** NCs são gravadas em quatro lugares e **nenhum é lido em
  lugar nenhum**: (a) seções "Não conformidade" das 23 planilhas — o grep por
  seus campos fora dos templates só encontra um teste; (b) recebimento
  `rejeitado` + motivo — zero consumidores fora da própria tela
  (`pages.jsx:1503-1748`); (c) controles especiais reprovados — nenhum
  dashboard/relatório os lê; (d) desvios de temperatura — únicos com fluxo
  (`CorrectiveActionsView`), mas exclusivo deles (`pages.jsx:1063`).
- **Problema:** a promessa central do produto é evidência de conformidade — e
  hoje uma NC escrita numa planilha some dentro do JSON. A RT não tem como
  responder "quais NCs abertas este mês?" sem abrir folha por folha.
- **Como melhorar:** uma view "Não conformidades" que agrega as quatro fontes
  (todas já sincronizadas, menos ações corretivas — item 3) com filtro por
  origem/período/status, e permite abrir ação corretiva a partir de qualquer
  uma — hoje a `CorrectiveActionsView` só enxerga temperatura. Entra também no
  PDF fiscal como seção 4.
- **IA (aplicável):** as NCs são texto livre. Um classificador leve pode
  agrupá-las por tema ("praga", "equipamento", "estrutura") pro resumo da RT —
  útil, mas é a cereja, não o bolo.
- **Benefício:** a pergunta nº 1 de qualquer auditoria ("o que saiu errado e o
  que vocês fizeram?") respondida numa tela.
- **Impacto:** diferencial competitivo direto — planilha de papel não faz isso,
  e é o argumento de venda pra RT, que é quem indica o produto.
- **Complexidade:** Média (leitura das 4 fontes + view + seção no PDF).
  **Prioridade:** Alta.
- **Justificativa:** categoria C/D pura — dados que já existem, funcionalidades
  existentes trabalhando juntas. Nenhum campo novo é criado.

### 3. Ações corretivas e higiene de mãos na nuvem

- **O que existe:** ações corretivas vivem só em
  `localStorage['nutriops.corrective_actions.<tenantId>']` (`pages.jsx:111`) —
  sem tabela no Supabase, fora do backfill. Higiene de mãos idem: é o único dos
  5 controles que não chama `pushSpecialControl` (`repository.js:1007` só
  itera `['oil','thaw','cool','thermal']`).
- **Problema:** limpou o navegador do tablet, a evidência legal sumiu. E a RT
  (em outro device) nunca vê as ações da loja.
- **Como melhorar:** higiene de mãos entra no `special_controls` como
  `control_type:'handwash'` (a tabela é genérica, custo ~zero). Ações
  corretivas ganham tabela própria com RLS igual às demais, no padrão
  `pushX`/`syncX` já estabelecido.
- **IA:** não se aplica.
- **Benefício:** evidência sobrevive ao device; RT acompanha de onde estiver.
- **Impacto:** risco real de perda de dado de cliente pagante eliminado. É o
  mesmo tipo de bug do épico de 29/05, só que latente.
- **Complexidade:** Baixa-média (1 tabela nova + SQL de policy).
  **Prioridade:** Alta.
- **Justificativa:** categoria A — infraestrutura de sync já existe pros outros
  8 módulos; estes dois ficaram pra trás.

### 4. Tablet de planilhas: não apagar o que existe + rascunho

- **O que existe:** o modo tablet (`FormKioskApp`) abre sempre com respostas
  vazias — `useState({})` em `kiosk.jsx:546`; o `record` existente é guardado
  pelo `FormsView` mas **nunca passado** (`forms.jsx:1369-1374`). O save faz
  upsert substituindo `responses` inteiro (`forms.jsx:1377-1392`). E não há
  "salvar rascunho" no tablet — só "Confirmar", que grava `submitted`.
- **Problema:** abrir o botão "📱 Tablet" numa planilha que já tinha rascunho e
  confirmar **apaga silenciosamente** o que estava lá. Numa folha semanal
  preenchida por várias pessoas ao longo da semana, é perda de dado real.
- **Como melhorar:** passar o `record` (a variável já está lá), semear o state
  com ele, e adicionar "Salvar e continuar depois" (status `draft`) no rodapé
  do wizard. Bônus: avisar quando "Confirmar" for tocado com menos de 100%
  ("Faltam 12 tarefas — confirmar mesmo assim?") — hoje dá pra submeter com 7%
  e o card fica "Concluído" verde (`forms.jsx:1176`).
- **IA:** não se aplica.
- **Benefício:** o modo tablet vira seguro pra folha colaborativa da semana.
- **Impacto:** evita o pior tipo de bug (perda silenciosa) no público mais
  sensível (colaborador que não vai reclamar, só vai desconfiar do sistema).
- **Complexidade:** Baixa. **Prioridade:** Alta.
- **Justificativa:** categoria A — é defeito de integração entre duas
  funcionalidades existentes, achado por leitura de código.

### 5. "Minha lista de hoje" do colaborador

- **O que existe:** pendência de temperatura por turno existe e é boa
  (`computeTurnAlerts`, `pages.jsx:176`). Mas **planilha não tem cobrança em
  lugar nenhum**: o dashboard do colaborador só mostra temperatura
  (`overview-v2.jsx:736-742`), nenhum badge de nav deriva de `form_records`
  (`nav.js`), e o badge "Pendente" só aparece no próprio card — entre os 32
  cards da CASA DOCE. O heatmap da RT mostra células cinzas iguais pra "sem
  leitura" e "não devida".
- **Problema:** a planilha semanal atrasa por esquecimento, não por má vontade
  — e a RT só descobre no fim do período.
- **Como melhorar:** o dashboard do colaborador ganha um bloco único "Hoje":
  temperaturas pendentes do turno (já calculado) + planilhas do período ainda
  `missing`/`draft` (cálculo que o `BPFReport` já faz em `reports.jsx:125` —
  é reaproveitar, não inventar), cada item clicável direto pro formulário.
  Badge na nav soma os dois.
- **IA:** não precisa pra v1. (Priorizar a lista por risco seria IA, mas a
  lista simples resolve 90%.)
- **Benefício:** o colaborador abre o app e sabe o que falta, sem procurar.
- **Impacto:** taxa de preenchimento no prazo é O indicador de sucesso do
  produto — é o que a RT mostra pro dono da loja como ROI.
- **Complexidade:** Média (agregação leve + UI). **Prioridade:** Alta.
- **Justificativa:** categoria D — `computeTurnAlerts` e o cálculo de período
  do BPF já existem separados; falta juntá-los na tela certa.

### 6. Sentinela de tendência dos equipamentos

- **O que existe:** meses de série temporal por equipamento com faixa
  cadastrada. Todas as leituras dessa série hoje são pontuais: tone da leitura,
  sparkline das últimas 30, desvio padrão no drill-down
  (`equipment-detail.jsx:117`). Nada olha a **direção** da série.
- **Problema/oportunidade:** uma câmara que sobe 0,4 °C por semana está
  contando que o compressor vai morrer — semanas antes do primeiro registro
  `danger`. Hoje o sistema assiste a isso calado até estourar a faixa. Quando
  estoura, o prejuízo já é estoque perdido (numa gelateria, milhares de reais).
- **Como melhorar:** no boot do dashboard, regressão linear simples nas últimas
  ~3 semanas de cada equipamento; se a inclinação projeta cruzar o limite em
  ≤N dias, card "⚠ Câmara 2 subiu 1,2 °C em 3 semanas — a caminho de sair da
  faixa" no dashboard do supervisor e da RT. É estatística de 20 linhas, roda
  no cliente, zero infra.
- **IA:** honestamente, **não precisa de IA** — regressão resolve. (Rotular de
  "IA" no marketing é decisão comercial, não técnica.)
- **Benefício:** o produto passa de cartório (registra o que houve) a
  sentinela (evita o prejuízo). É outra categoria de valor.
- **Impacto:** primeira feature que justifica upgrade de plano — previne perda
  mensurável em R$. Argumento de venda novo.
- **Complexidade:** Média (o cuidado é calibrar pra não dar alarme falso —
  começar conservador, só tendência sustentada). **Prioridade:** Alta.
- **Justificativa:** categoria C clássica — o dado já existe em produção há
  meses; só falta olhar pra ele.

### 7. Uma régua só de cálculo

- **O que existe:** três definições de "capacitação vencendo"
  (`validityMonths*30*0.85` em `pages.jsx:954` e `reports-views.jsx:226`;
  306/365 dias fixos em `reports.jsx:185,344`). Duas de "conformidade hoje"
  (cobertura de registro com 3 turnos hardcoded em `overview-v2.jsx:585` —
  ignora os turnos cadastrados — vs. % dentro da faixa no resto).
  `resolveTemperatureTone` copiado em 4 lugares, e o painel RT usa a regra
  estrita sem a tolerância de ±3 °C (`extras.jsx:66-83`).
- **Problema:** o dashboard diz 92%, o relatório diz 87%, o painel RT diz
  outra coisa. Pra um produto cuja moeda é confiança em números, é caro.
- **Como melhorar:** um módulo `metrics.js` com as funções canônicas
  (tone, conformidade, capacitação, cobertura) e todas as telas importando
  dele. O KPI do supervisor passa a ler os turnos cadastrados e a se chamar
  pelo que é ("cobertura de registro").
- **IA:** não se aplica.
- **Benefício:** o mesmo número em toda tela; discussão "qual está certo?"
  morre.
- **Impacto:** confiança — e destrava os itens 5, 6 e 12, que precisam dessas
  funções num lugar só.
- **Complexidade:** Baixa (refactor mecânico + testes). **Prioridade:** Alta
  (fazer antes dos itens que dependem).
- **Justificativa:** categoria A/F — inconsistências verificadas linha a linha,
  não hipotéticas.

### 8. Lapidação do quiosque de temperatura

- **O que existe:** três achados no fluxo que já é bom: (a) overlay de sucesso
  em tela cheia por 2,5 s, não-dispensável (`kiosk.jsx:152-170`) — na CASA
  DOCE, 44 equipamentos = ~115 s de espera imposta por rodada; (b)
  `savedValues` é state de sessão (`kiosk.jsx:181`) — equipamento já medido de
  manhã por outra pessoa aparece como não registrado, convidando duplicata;
  (c) `readKioskConfig` existe e nunca é chamada (`kiosk.jsx:18`) — recarregou
  o tablet, caiu do modo quiosque e a seleção se perde. Extra: o operador é
  lido uma vez no mount (`kiosk.jsx:192`) — tablet aberto o dia inteiro nunca
  reexibe o picker, furando o TTL de 6 h.
- **Como melhorar:** overlay dispensável por toque e mais curto (~1 s); semear
  `savedValues` com os registros de hoje do turno; reler a config no boot
  (a função já existe); checar expiração do operador a cada save.
- **IA:** não se aplica.
- **Benefício:** rodada completa ~2 min mais rápida; sem duplicatas; tablet
  sobrevive a reload; atribuição honesta o dia todo.
- **Impacto:** médio — mas é o coração do uso diário. **Complexidade:** Baixa.
  **Prioridade:** Média.
- **Justificativa:** categoria A/F, tudo medido no código.

### 9. Veredito automático nos controles especiais

- **O que existe:** resfriamento calcula conformidade (`t1≤10 && t2≤4`,
  `controls.jsx:485`) e tratamento térmico também (`≥70 °C`,
  `controls.jsx:609`) — mas **só mostram um banner**; o usuário escolhe
  "Conforme" à mão e pode contradizer a medição. No descongelamento o critério
  do método (≤4 °C etc.) é texto decorativo. No recebimento, `allChecksOk` é
  calculado e nunca usado (`pages.jsx:1537`); a temperatura de chegada não é
  validada contra nada; motivo de rejeição não é obrigatório.
- **Como melhorar:** o resultado nasce **pré-selecionado** pelo cálculo
  (editável, com justificativa obrigatória se o usuário contrariar o
  veredito); descongelamento compara `tempEnd` com o critério do método;
  recebimento com check NC sugere "aceito parcial/rejeitado" e exige motivo.
- **IA:** não se aplica — as regras são da própria RDC.
- **Benefício:** menos um campo pra pensar; dado coerente com a medição.
- **Impacto:** qualidade do dado que a RT assina. **Complexidade:** Baixa.
  **Prioridade:** Média.
- **Justificativa:** categoria B — a decisão já está calculada; só não é usada.

### 10. Dossiê de fiscalização em 1 clique

- **O que existe:** o PDF fiscal cruza temperatura + BPF + capacitação
  (`reports.jsx:229`). Fora dele ficam: controles especiais, recebimento,
  validades, manutenção, ações corretivas, POPs — cada um com impressão
  isolada na própria tela, seis caminhos diferentes.
- **Problema:** quando a vigilância chega, a RT precisa saber onde mora cada
  impressão. O produto tem todos os dados e não tem o botão "me dá tudo".
- **Como melhorar:** "Dossiê completo" no ReportsHub: período → um PDF com as
  seções todas (reaproveitando os geradores existentes), capa com identificação
  da empresa e assinatura RT. Com a central de NCs (item 2), ela entra como
  seção.
- **IA (aplicável):** um parágrafo-resumo executivo do período gerado por LLM
  ("3 desvios, todos com ação; 96% das planilhas no prazo") como capa — útil e
  barato, mas opcional.
- **Benefício:** o momento de maior estresse do cliente resolvido num clique.
- **Impacto:** é a cena que vende o produto em demo. **Complexidade:** Média.
  **Prioridade:** Média.
- **Justificativa:** categoria D — costura de geradores que já existem.

### 11. Importar planilha de papel por foto (IA) — menção honrosa detalhada

- **O que existe:** onboarding da CASA DOCE = transcrever manualmente um PDF de
  31 páginas em 21 templates (~274 tarefas), trabalho de dias feito nesta
  sessão. Todo cliente novo chega com as planilhas dele em papel/Excel.
- **Como melhorar:** upload de foto/PDF → LLM multimodal extrai título, setor,
  tarefas e periodicidades → **rascunho** de template que a RT revisa no editor
  que já existe (`TaskEditorModal`). Nunca publicar sem revisão humana.
- **Benefício/impacto:** o custo de implantação é hoje o teto de crescimento da
  plataforma (1 pessoa operando). Reduzi-lo muda a economia de aquisição de
  cliente.
- **Complexidade:** Alta (chamada de API multimodal + revisão + custos).
  **Prioridade:** Média — vale quando houver funil de clientes novos.
- **Justificativa:** é o item mais próximo de "NOVA FUNCIONALIDADE", mas
  automatiza um processo que **já aconteceu de verdade** e vai se repetir a
  cada cliente. Categoria B/E.

---

## 6. TOP 5 — eu implementaria primeiro

**1º — Assinatura de 1 toque (item 1).** É a interseção rara de custo baixíssimo
com dor diária de todo mundo. A nutricionista acabou de ganhar 21 folhas novas;
cada semana que passa sem isso são milhares de toques desperdiçados na
operação. E o padrão já existe no produto (validação RT). Melhor investimento
por hora de trabalho da lista inteira.

**2º — Central de NCs + sync das ações corretivas (itens 2+3).** É a alma do
produto: evidência. Hoje o sistema pede a NC, guarda a NC e a esquece — e as
ações corretivas podem sumir com um "limpar dados de navegação". Fechar esse
ciclo (registrar → enxergar → agir → provar) é o que diferencia o NutriOPS de
um bloco de notas bonito.

**3º — Correções do fluxo tablet (itens 4+8).** O bug de sobrescrita do modo
tablet é perda de dado silenciosa — a categoria de defeito que mata confiança
sem gerar reclamação. Junto, a lapidação do quiosque devolve ~2 min por rodada.
Tudo baixa complexidade.

**4º — "Minha lista de hoje" (item 5).** O produto já cobra temperatura mas não
cobra planilha — e planilha é metade do produto. A taxa de preenchimento no
prazo é o número que a RT apresenta como resultado; dar visibilidade de
pendência é o jeito mais barato de subi-la.

**5º — Sentinela de tendência (item 6).** O único do TOP 5 que cria valor
*novo* em vez de destravar valor existente — por isso fecha a lista em vez de
abri-la. Usa dado que já está em produção, roda no cliente sem infra, e muda a
conversa de venda: de "substitui papel" pra "evitou um freezer de prejuízo".

**Por que não os outros:** o dossiê (10) rende mais *depois* da central de NCs;
a importação por foto (11) rende quando houver clientes novos no funil; a régua
única (7) entra naturalmente como pré-requisito técnico do 4º e do 5º.

---

*Gerado a partir de três varreduras completas do código em 09/08/2026.
Evidências citadas como `arquivo:linha`. Nenhuma sugestão sem lastro no código.*
