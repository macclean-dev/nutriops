# Auditoria RDC 216/2004 × código NutriOPS — 15/08/2026

> **Objetivo:** transformar o NutriOPS de "registra conformidade" em "sabe se a
> loja está pronta para uma fiscalização AGORA". Esta é a Fase 1: o levantamento
> do que a RDC 216/2004 (e a RDC 275/2002 no que couber) exige de **registro e
> evidência**, mapeado contra o código real em `src/` na versão **v1.9.129**.
>
> **Método e ceticismo:** cada item só é COBERTO se o código foi localizado e
> citado (`arquivo:linha`). Se não achei código, o item é DESCOBERTO — sem
> "provavelmente tem". "Sobrevive a wipe" = o dado volta num device limpo via
> Supabase (tabela + função de sync no `repository.js`). "Apresentável" = sai
> pronto num PDF/print sem alguém montar planilha à mão.
>
> Referências à norma usam as **seções** da RDC 216 (4.1 a 4.12). Não cito
> número de sub-item de cabeça para não inventar numeração — os valores
> numéricos (70°C, 60°C/6h, 5 dias, 180°C, 6 meses, 30 dias) são os da norma.

---

## 1. Resumo executivo

| Classificação | Itens |
|---|---|
| **COBERTO** | 12 — temperatura de equipamentos, planilhas BPF de higienização, higiene pessoal diária, higiene das mãos, ocorrência de pragas, recebimento, descongelamento, resfriamento, tratamento térmico, óleo de fritura, etiquetas/validade de produtos, NC + ações corretivas |
| **PARCIAL** | 9 — capacitação, POPs, dedetização (comprovante), manutenção de equipamentos, calibração, conservação a quente/exposição, retenção ≥30 dias, alvará/RT no perfil, resíduos |
| **DESCOBERTO** | 5 — controle de saúde dos manipuladores (ASO), higienização semestral do reservatório, laudo de potabilidade, Manual de Boas Práticas, comprovante de capacitação do responsável (4.12) |
| **NÃO SE APLICA** | 2 — estrutura física (não é registro), amostras-guarda (exigência estadual, não da RDC 216) |

**As três frases que resumem a auditoria:**

1. **O que o colaborador registra no dia a dia está bem coberto e sincroniza.**
   Temperatura, BPF, recebimento, controles especiais e ações corretivas
   sobrevivem a limpeza de device e saem prontos no Dossiê de 1 clique.
2. **O que a RT constrói uma vez e reaproveita — capacitação, POPs, manutenção,
   perfil da empresa — vive só no localStorage do aparelho dela.** Um wipe
   apaga certificados de treinamento, POPs e histórico de manutenção sem
   deixar rastro na nuvem. É exatamente a classe de evidência que o fiscal
   pede e que a RDC manda "comprovar mediante documentação".
3. **Três exigências clássicas de fiscalização não têm NENHUMA captura no
   app:** controle de saúde dos manipuladores, higienização semestral do
   reservatório de água e Manual de Boas Práticas. Hoje o cliente se vira no
   papel — ou não tem.

---

## 2. Mapa de sincronização — o que sobrevive à limpeza de um device

O boot chama `syncAllModules` ([repository.js:1094-1121](../src/repository.js#L1094)),
que cobre 13 módulos; temperatura tem repositório próprio
([repository.js:489-491](../src/repository.js#L489)) e fotos vão pro Supabase
Storage ([repository.js:759-792](../src/repository.js#L759)).

| Dado | Chave local | Tabela cloud | Sobrevive a wipe? |
|---|---|---|---|
| Temperaturas (+ correções) | `nutriops.temperature.records` | `temperature_records` | ✅ ([repository.js:292](../src/repository.js#L292), [:384](../src/repository.js#L384)) |
| Planilhas BPF (registros) | `nutriops.forms.records.{id}` | `form_records` (inclui `validation`) | ✅ ([repository.js:497-518](../src/repository.js#L497)) |
| Modelos de planilha | `nutriops.forms.templates.{id}` | `form_templates` | ✅ ([repository.js:570](../src/repository.js#L570)) |
| Fotos de planilha | — (só path no record) | Storage `form-photos` | ✅ ([repository.js:759](../src/repository.js#L759)) |
| Catálogo de equipamentos | `nutriops.equipment.catalog.{id}` | `equipment_catalog` | ✅ ([repository.js:624-647](../src/repository.js#L624)) |
| Equipe (nomes) | `nutriops.users.{id}` | `tenant_staff` | ✅ ([repository.js:697](../src/repository.js#L697)) |
| Recebimento | `nutriops.receiving.{id}` | `receiving_records` | ✅ ([repository.js:855](../src/repository.js#L855)) |
| Produtos/validades | `nutriops.products.{id}` | `products` | ✅ ([repository.js:897](../src/repository.js#L897)) |
| Regras de validade | `nutriops.validity.rules.{id}` | `validity_rules` | ✅ ([repository.js:1108](../src/repository.js#L1108)) |
| Controles especiais ×5 (óleo, descongelamento, resfriamento, térmico, mãos) | `nutriops.{tipo}.{id}` | `special_controls` | ✅ ([repository.js:1065-1088](../src/repository.js#L1065)) |
| Ações corretivas | `nutriops.corrective_actions.{id}` | `corrective_actions` | ✅ no código ([repository.js:1036](../src/repository.js#L1036)) — ⚠️ pendência do CLAUDE.md diz que `docs/corrective-actions-sync.sql` pode não ter sido rodado em prod. **Verificar no Supabase antes de confiar.** |
| Movimentações de estoque | `nutriops.stocklogs.{id}` | `stock_logs` | ⚠️ **só push** ([repository.js:941-950](../src/repository.js#L941)) — a nuvem guarda, mas não existe `syncStockLogs`; depois de um wipe o device não re-baixa o histórico |
| **POPs** | `nutriops.pops.{id}` | — | ❌ **local-only** ([controls.jsx:13-14](../src/controls.jsx#L13)) |
| **Capacitação (sessões + config)** | `nutriops.training.sessions.{id}` / `training.config.{id}` | — | ❌ **local-only** ([training.jsx:12-22](../src/training.jsx#L12)) |
| **Manutenção (ativos, execuções, OS)** | `nutriops.equip_assets/maint_logs/work_orders.{id}` | — | ❌ **local-only** ([maintenance.jsx:16-24](../src/maintenance.jsx#L16)) |
| **Perfil do estabelecimento (CNPJ, RT, CRN, alvará)** | `nutriops.company.profile.{id}` | — | ❌ **local-only** ([settings.jsx:13](../src/settings.jsx#L13)) |
| **Validações de período da RT (temperatura)** | `nutriops.rt.validations` | — | ❌ local-only, nem é por tenant, cap 50 ([reports-views.jsx:525-585](../src/reports-views.jsx#L525)) |
| Turnos (config dos alertas) | `nutriops.turns.{id}` | — | ❌ local-only ([turns.js:10](../src/turns.js#L10)) — config, não evidência, mas sem ela os alertas de turno somem no device novo |

---

## 3. Auditoria item a item

Formato: **exigência → onde no app → completo? → sobrevive a wipe? →
apresentável ao fiscal? → classificação.**

### 3.1 Temperatura de equipamentos de frio/calor (RDC 216 §4.7/4.8/4.10)

- **Exigência:** alimentos sob temperatura controlada; equipamentos de
  refrigeração/congelamento monitorados; na prática o fiscal pede a planilha
  de temperatura por equipamento.
- **No app:** registro por equipamento com faixa min/max do catálogo
  ([limits.js:21-43](../src/limits.js#L21)), tone conforme/desvio/crítico
  ([limits.js:46-60](../src/limits.js#L46)), quiosque de balcão com operador
  identificado ([kiosk.jsx:175-182](../src/kiosk.jsx#L175)), alertas de turno
  pendente ([pages.jsx:158-186](../src/pages.jsx#L158)), guarda contra sinal
  trocado ([limits.js:106-113](../src/limits.js#L106)), correção auditável com
  valor original + motivo + quem corrigiu
  ([reports-views.jsx:563-578](../src/reports-views.jsx#L563)), sentinela de
  tendência já em produção ([trend.js:22](../src/trend.js#L22),
  [overview-v2.jsx:685](../src/overview-v2.jsx#L685)).
- **Completo?** Sim para equipamentos. (Temperatura do ALIMENTO em exposição é
  outro item — ver 3.14.)
- **Sobrevive a wipe?** ✅. **Apresentável?** ✅ PDF de auditoria
  ([pages.jsx:190-198](../src/pages.jsx#L190)) + dossiê.
- **→ COBERTO** ✅

### 3.2 Higienização de instalações, equipamentos e móveis (§4.2; POP obrigatório do §4.11)

- **No app:** planilhas BPF com seed por tenant — faxina Bäckerei/Swiss/DBK
  ([forms.jsx:654-753](../src/forms.jsx#L654)), 21 folhas de higienização por
  setor da CASA DOCE ([forms.jsx:1044+](../src/forms.jsx#L1044)), banheiros
  ([forms.jsx:772](../src/forms.jsx#L772)), hortifrutícolas
  ([forms.jsx:805](../src/forms.jsx#L805)), com frequência por tarefa
  ([field-frequency.js:37-49](../src/field-frequency.js#L37)), percentual de
  preenchimento ([forms.jsx:397](../src/forms.jsx#L397)), extração de NC
  ([forms.jsx:425](../src/forms.jsx#L425)), validação da RT carimbada no
  registro ([forms.jsx:513-518](../src/forms.jsx#L513)) e foto como evidência
  ([forms.jsx:168-188](../src/forms.jsx#L168)).
- **Sobrevive a wipe?** ✅ (`form_records`/`form_templates` + Storage).
- **→ COBERTO** ✅ (a cobertura de setores depende do seed de cada tenant, mas
  a RT pode criar/importar planilha — inclusive por foto/IA,
  [import-template-modal.jsx](../src/import-template-modal.jsx)).

### 3.3 Higiene pessoal diária dos manipuladores (§4.6)

- **No app:** planilha diária de uniforme/unha/adorno/ferimento etc.
  ([forms.jsx:583-601](../src/forms.jsx#L583), versão CASA DOCE
  [forms.jsx:939+](../src/forms.jsx#L939)) + controle de higiene das mãos
  ([extras.jsx:22-23](../src/extras.jsx#L22), sync via `special_controls`
  [repository.js:1114](../src/repository.js#L1114)).
- **→ COBERTO** ✅ (mesma ressalva do SQL de `special_controls`/handwash da
  pendência do CLAUDE.md — verificar em prod).

### 3.4 Controle de saúde dos manipuladores — ASO/exames (§4.6)

- **Exigência:** "o controle da saúde dos manipuladores deve ser registrado".
  Fiscal pede ASO/exames periódicos válidos por colaborador.
- **No app:** **nada.** Busca por `ASO|exame|atestado|laudo` no `src/` só
  encontra tópico de treinamento e textos de UI. Não há campo, tela ou tabela.
- **→ DESCOBERTO** ❌ — risco alto: é item de autuação clássico e o app não
  tem nem onde anotar.

### 3.5 Capacitação dos manipuladores (§4.6 — "comprovada mediante documentação")

- **No app:** módulo completo — sessões com temas, participantes confirmados,
  certificado em PDF com RT/CRN ([training.jsx:49+](../src/training.jsx#L49)),
  status canônico em-dia/renovação/vencido/nunca
  ([training-status.js:18-32](../src/training-status.js#L18)), entra no PDF
  fiscal e no dossiê ([dossie-view.jsx:53](../src/dossie-view.jsx#L53)).
- **Mas:** `nutriops.training.sessions.{id}` é **local-only**
  ([training.jsx:12-22](../src/training.jsx#L12)). Limpou o celular da RT,
  **todos os comprovantes de capacitação da rede desaparecem** — e o
  certificado PDF só existe se alguém salvou o arquivo.
- **→ PARCIAL** ⚠️ (captura ótima, evidência frágil).

### 3.6 Controle integrado de vetores e pragas (§4.3; POP obrigatório)

- **Ocorrências diárias:** planilha com espécie/local/ação
  ([forms.jsx:605-620](../src/forms.jsx#L605)). ✅ sincroniza.
- **Comprovante de dedetização por empresa especializada:** planilha mensal
  com empresa/data/produto/nº do certificado
  ([forms.jsx:623-636](../src/forms.jsx#L623), CASA DOCE
  [forms.jsx:995-1004](../src/forms.jsx#L995)) — mas o **comprovante em si
  não é anexado** (campos só de texto; o seed não incluiu campo `photo`, que
  o motor de planilhas já suporta) e **nada valida periodicidade**: se a
  última dedetização foi há 8 meses, nenhuma tela acusa.
- **→ Ocorrências COBERTO ✅ · Comprovante PARCIAL** ⚠️

### 3.7 Água — reservatório e potabilidade (§4.4; POP obrigatório)

- **Exigência:** reservatório higienizado em intervalo máximo de **6 meses,
  com registro**; água potável (na prática, fiscais pedem laudo laboratorial —
  periodicidade varia por município, ver Suposições).
- **No app:** só a planilha quinzenal de **troca de filtros**
  ([forms.jsx:638-651](../src/forms.jsx#L638)). A higienização do reservatório
  aparece na *descrição* do template, mas **não há campo nem planilha
  semestral própria**, e não existe nada sobre laudo de potabilidade.
- **→ Filtros PARCIAL ⚠️ · Reservatório DESCOBERTO ❌ · Laudo DESCOBERTO** ❌

### 3.8 Recebimento de matérias-primas (§4.7)

- **No app:** fornecedor, NF, produto, quantidade, validade, temperatura na
  chegada, conservação, 6 checks (embalagem/rotulagem/veículo/entregador/
  temperatura/aparência — [pages.jsx:1613-1620](../src/pages.jsx#L1613)),
  resultado sugerido pelo cálculo ([verdict.js:35-42](../src/verdict.js#L35)),
  motivo obrigatório em rejeição ([pages.jsx:1644-1656](../src/pages.jsx#L1644)),
  CSV ([pages.jsx:1690](../src/pages.jsx#L1690)) e seção no dossiê.
- **→ COBERTO** ✅

### 3.9 Descongelamento (§4.8)

- **No app:** método, início/término, temperaturas, conformidade calculada
  (refrigeração ≤4°C / água corrente <21°C —
  [verdict.js:22-31](../src/verdict.js#L22),
  [controls.jsx:422-455](../src/controls.jsx#L422)). Sincroniza. **→ COBERTO** ✅

### 3.10 Resfriamento (§4.8 — 60°C→10°C em 2h)

- **No app:** leituras em 2h/6h com critério da norma na tela
  ([controls.jsx:556-641](../src/controls.jsx#L556)), veredito automático
  ([verdict.js:9-20](../src/verdict.js#L9)). **→ COBERTO** ✅

### 3.11 Tratamento térmico (§4.8 — 70°C no interior)

- **No app:** equipamento, alvo/atingida, horário, tempo de manutenção
  ([controls.jsx:693-737](../src/controls.jsx#L693)). **→ COBERTO** ✅

### 3.12 Óleos e gorduras de fritura (§4.8 — máx. 180°C, troca por alteração)

- **No app:** teste de fita de acidez com mapeamento aprovado/observação/
  reprovado ([verdict.js:51-55](../src/verdict.js#L51),
  [controls.jsx:282-312](../src/controls.jsx#L282)) + cor/odor/espuma.
- **Nota:** a temperatura da fritura (≤180°C) não é registrada — a evidência
  de troca/qualidade existe, a de temperatura não. Aceitável na prática (a
  fita é o que as VISAs pedem), registrado aqui por honestidade.
- **→ COBERTO** ✅ (com a nota)

### 3.13 Alimentos preparados: identificação e prazo de validade (§4.8/4.9)

- **Exigência:** alimento preparado armazenado identificado com designação,
  data de preparo e prazo de validade (refrigerado ≤5°C: máx. 5 dias).
- **No app:** produtos com validade original + abertura
  (`openedAt`/`openedUntil` — [validity.jsx:219-233](../src/validity.jsx#L219)),
  regra de validade pós-abertura configurável e sincronizada
  ([validity-rules.js](../src/validity-rules.js),
  [repository.js:1108](../src/repository.js#L1108)), etiqueta 60×60 modelo
  Suflex ([validity.jsx:74-118](../src/validity.jsx#L74)), rastreio de
  impressão, seção "vencidos e a vencer" no dossiê
  ([dossier.js:98-119](../src/dossier.js#L98)).
- **→ COBERTO** ✅ (pendência conhecida: validar impressão na Zebra real).

### 3.14 Conservação a quente e exposição ao consumo (§4.8/4.10 — 60°C por até 6h)

- **No app:** dá para cadastrar um balcão térmico no catálogo com faixa
  customizada (ex.: min 60) e registrar como temperatura de equipamento
  ([limits.js:21-27](../src/limits.js#L21)) — funciona, mas é convenção, não
  controle: **não existe controle de TEMPO de exposição** (as 6h) nem
  distinção equipamento-frio/equipamento-quente na UI.
- **→ PARCIAL** ⚠️

### 3.15 Manutenção programada de equipamentos (§4.1 — "mantidos registros")

- **No app:** módulo de manutenção com planos, próxima execução, logs e OS
  ([maintenance.jsx:169-178](../src/maintenance.jsx#L169)) + seção no dossiê.
  CASA DOCE também tem a planilha BPF "Manutenção Programada e Periódica"
  ([forms.jsx:906](../src/forms.jsx#L906)) — essa sincroniza.
- **Mas:** `equip_assets`/`maint_logs`/`work_orders` são **local-only**
  ([maintenance.jsx:16-24](../src/maintenance.jsx#L16)).
- **→ PARCIAL** ⚠️ (existe e é bom; evidência não sobrevive a wipe).

### 3.16 Calibração de instrumentos de medição (§4.1)

- **No app:** só a planilha seed da CASA DOCE
  ([forms.jsx:1009-1022](../src/forms.jsx#L1009)). Swiss/Bäckerei/DBK não têm
  nada, e nenhuma tela cobra "próxima calibração vencida" (o campo
  `cd-cal-prox` existe e ninguém lê).
- **→ PARCIAL** ⚠️ (um tenant, sem cobrança de vencimento).

### 3.17 POPs — os 4 obrigatórios (§4.11)

- **Exigência:** POPs de (a) higienização de instalações/equipamentos,
  (b) vetores e pragas, (c) reservatório, (d) higiene e saúde dos
  manipuladores — **aprovados, datados e assinados** pelo responsável
  (RDC 275 reforça isso para os registros).
- **No app:** módulo de POPs com objetivo/passos/materiais/frequência/
  responsável e impressão ([controls.jsx:68-110](../src/controls.jsx#L68)).
  A impressão sai com **linha de assinatura em branco** — não há aprovação/
  assinatura estruturada, nem verificação de que os 4 obrigatórios existem.
  E é **local-only** ([controls.jsx:13-14](../src/controls.jsx#L13)).
- **→ PARCIAL** ⚠️ (três buracos: assinatura, completude dos 4, sync).

### 3.18 Manual de Boas Práticas (§4.11)

- **Exigência:** manual disponível às autoridades sanitárias.
- **No app:** **nada** — nenhum upload, nenhum registro de "manual existe,
  versão X, elaborado por Y". Só um tópico de treinamento com o nome
  ([training.jsx:31](../src/training.jsx#L31)).
- **→ DESCOBERTO** ❌ (basta um atestado com arquivo/versão/data para mudar de
  categoria — o fiscal aceita o manual impresso, mas o app hoje nem sabe se
  ele existe).

### 3.19 Retenção de registros ≥30 dias (§4.11)

- **No app:** com Supabase ligado, a nuvem guarda tudo (a UI corta em 90 dias
  por performance e busca o histórico completo sob demanda —
  [reports-views.jsx:536-555](../src/reports-views.jsx#L536)). **Sem** nuvem,
  os caps locais (200 controles/300 recebimentos/500 estoque —
  [repository.js:1068](../src/repository.js#L1068), [:861](../src/repository.js#L861),
  [:943](../src/repository.js#L943)) podem comer registro dentro da janela de
  30 dias em loja movimentada.
- **→ PARCIAL** ⚠️ (COBERTO quando sync ligado; DBK ainda está zerada na nuvem
  — pendência aberta do CLAUDE.md).

### 3.20 Não conformidades e ações corretivas (§4.8/§4.11; prática de fiscalização)

- **No app:** as 4 origens de NC normalizadas
  ([nonconformities.js:15-90](../src/nonconformities.js#L15)), central de
  ações corretivas ([pages.jsx:1106](../src/pages.jsx#L1106)), status
  aberto/resolvido com data ([weekly-summary.js:27-29](../src/weekly-summary.js#L27)),
  seção "NC → ação tomada" no dossiê ([dossier.js:25-46](../src/dossier.js#L25)).
- **→ COBERTO** ✅ no código — ⚠️ **condicionado à verificação do
  `corrective-actions-sync.sql` em prod** (pendência do CLAUDE.md).

### 3.21 Responsabilidade técnica (§4.12) e identificação do estabelecimento

- **Exigência:** responsável pelas atividades comprovadamente capacitado
  (curso com os conteúdos da norma); na prática o fiscal confere RT/CRN e
  alvará.
- **No app:** perfil com razão social, CNPJ, RT, CRN e nº do alvará
  ([settings.jsx:184-218](../src/settings.jsx#L184)) — usado nos PDFs. Mas:
  **local-only**, o alvará não tem **data de validade** (só o número), e não
  há registro do certificado de capacitação do responsável.
- **→ PARCIAL** ⚠️ (perfil) / **DESCOBERTO** ❌ (comprovante de curso do
  responsável).

### 3.22 Resíduos (§4.5)

- **No app:** planilha "Controle de Saída de Resíduos" só da CASA DOCE
  ([forms.jsx:840](../src/forms.jsx#L840)). A RDC exige manejo adequado, não
  registro explícito — mas é evidência barata de conformidade.
- **→ PARCIAL** ⚠️ (baixo risco).

### 3.23 Apresentação ao fiscal (transversal)

- **No app:** Dossiê de Fiscalização em 1 clique com 9 seções
  ([dossie-view.jsx:50-60](../src/dossie-view.jsx#L50)), PDF fiscal, PDF por
  planilha com carimbo de validação da RT, CSVs.
- **Ressalva estrutural:** o dossiê lê **localStorage**
  ([dossie-view.jsx:12-13](../src/dossie-view.jsx#L12)). Num device recém-
  trocado, as seções que sincronizam voltam — mas **POPs, capacitação e
  manutenção saem VAZIOS** (ver §2), e o dossiê não avisa que aquilo é
  ausência de dado, não ausência de ocorrência.
- **→ COBERTO** ✅ com a ressalva acima.

### 3.24 Não se aplica

- **Estrutura física, layout, ventilação (§4.1):** exigência de instalação,
  não de registro contínuo — um checklist de autoavaliação seria feature nova,
  não buraco de conformidade de registro.
- **Amostras-guarda de refeições:** exigência de legislações estaduais/
  municipais (e para eventos), não da RDC 216. Fora do escopo até um cliente
  operar onde isso é cobrado.

---

## 4. Suposições explícitas (não são fatos)

1. **Periodicidade de dedetização:** a RDC não fixa prazo; assumi **6 meses**
   como régua default de "vencido" por ser o contrato típico — precisa ser
   configurável por loja, porque a VISA local e o contrato mandam.
2. **Laudo de potabilidade:** assumi **semestral** como default de mercado
   (obrigatório na prática quando há reservatório/poço; a periodicidade real
   é da legislação municipal). Configurável, idem.
3. **ASO/saúde:** assumi validade **anual** (PCMSO/NR-7 usual) como default.
4. **O que o fiscal pede primeiro:** a priorização da Fase 2 (documentação →
   registros de 30 dias → NC sem ação) vem da prática comum de VISA municipal,
   não de texto de norma. O dono/RT deve validar contra a experiência real
   das lojas (Swiss/Bäckerei/DBK/CASA DOCE).
5. **RDC 275:** usada aqui só como reforço de "registro assinado/datado e
   verificação" — ela é formalmente para indústria, mas os checklists de
   inspeção municipais herdam a estrutura dela.

---

## 5. Fase 2 — Proposta: tela "Prontidão para Fiscalização" (aguardando aprovação)

### Conceito

Uma view nova (`readiness`) no grupo **Gestão**: para cada loja, um veredito
ao vivo — **PRONTA / PRONTA COM RESSALVAS / EM RISCO** — com a lista do que
está em ordem, o que falta, e o que dá para resolver hoje (cada pendência com
botão que navega para a tela que resolve). Sem score numérico inventado:
veredito categórico defensável, com contagem de itens por gravidade.

### Motor de decisão

`src/readiness.js` **puro + testado** (padrão limits/verdict/nonconformities),
que **reaproveita** em vez de recalcular:

- `pendingTemperatureItems/pendingReceivingItems/pendingControlItems/
  pendingFormItems` + `excludeWithAction` (nonconformities.js) → NC sem ação
- `conformityStats`/`resolveRecordTone` (limits.js) → conformidade por equipamento
- `computeTurnAlerts` (pages.jsx — extrair para módulo puro na implementação)
- `employeeTrainingStatus` (training-status.js) → capacitação vencida
- `pendingFormsForPeriod` (forms.jsx:128) → planilhas do período em aberto
- lógica de `sectionValidity` (dossier.js) → produto vencido no estoque
- `getSyncStatus`/fila offline (repository.js) → evidência em risco

Assinatura: `computeReadiness(inputs) → { verdict, groups: [{ id, title,
checks: [{ id, label, status: ok|warn|fail|unknown, detail, severity,
navTarget }] }] }` — `unknown` é primeira-classe: "não há dado" ≠ "está ok"
(mesma lição do `pct: null` em conformityStats).

### Checks, priorizados por risco real de autuação (não por facilidade)

**Grupo A — gera auto de infração na hora (qualquer FAIL ⇒ EM RISCO):**
1. NC crítica sem ação corretiva registrada (todas as 4 origens)
2. Produto vencido presente no estoque
3. Equipamento de frio sem registro de temperatura hoje/turno (e desvio
   crítico recorrente nos últimos 7 dias)
4. Capacitação vencida ou nunca feita para colaborador ativo
5. Dedetização vencida (último registro da planilha > validade configurada)
6. Reservatório sem higienização registrada há mais de 6 meses *(hoje sempre
   `unknown` — vira call-to-action da Fatia 2)*
7. ASO vencido *(idem — depende da Fatia 2)*

**Grupo B — documentação que o fiscal pede na entrada:**
RT + CRN preenchidos · alvará com validade · os 4 POPs obrigatórios presentes
e assinados · Manual de BP atestado (arquivo ou declaração de versão/data)

**Grupo C — registros vivos dos últimos 30 dias:**
% de planilhas BPF do período preenchidas · planilhas aguardando validação da
RT · cada controle especial aplicável com registro no ciclo (aplicabilidade
inferida do catálogo: tem fritadeira ⇒ óleo é aplicável — suposição a validar)

**Grupo D — a evidência sobrevive?:**
Supabase ligado e último sync recente · fila offline zerada · aviso "POPs/
capacitação/manutenção existem só neste aparelho" enquanto a Fatia 3 não sai

### Fatias de implementação (aprovar separadamente)

| Fatia | O quê | Toca SQL? |
|---|---|---|
| **1. Motor + tela** | `readiness.js` + testes, view nos 3 lugares (permissions/buildNavSections/switch), cards por loja pra RT multi-tenant, deep-link pras telas. Só lê o que já existe; A6/A7/B ficam `unknown` com call-to-action. | Não |
| **2. Captura dos descobertos de alto risco** | Planilha semestral de reservatório (seed), campo photo no template de dedetização + validade configurável, controle de saúde por colaborador (ASO com vencimento), validade do alvará, atestado do Manual de BP. Alimenta A5/A6/A7/B2/B4. | `form_templates` já cobre planilhas; ASO/alvará/manual pedem decisão de onde morar (proposta: `company.profile` + nova tabela pequena `compliance_docs` com RLS) |
| **3. Evidência sobrevivente** | Sync de POPs e capacitação (2 tabelas novas + RLS, padrão `special_controls`), pull de `stock_logs`, `rt.validations` por tenant na nuvem. Manutenção depois. | Sim — SQL antes do deploy, como sempre |

**Recomendação de ordem:** 1 → 3 → 2. A Fatia 1 entrega o valor de venda
("sabe se está pronta AGORA") sem SQL. A Fatia 3 fecha o risco mais
traiçoeiro (evidência que evapora com um wipe — o mesmo bug de classe que
motivou a Central de NC). A Fatia 2 muda rotina do cliente (novos dados a
capturar), então merece conversa com a RT antes.

**PAROU AQUI — nada de código até aprovação das fatias.**
