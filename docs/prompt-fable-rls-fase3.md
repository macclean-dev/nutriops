# Prompt de handoff — Fable (épico Auth+RLS, Fase 3)

> Gerado em 15/07/2026. Cole este prompt numa sessão nova do Fable pra retomar
> o fechamento do isolamento server-side (RLS nas 8 tabelas de dados). Contexto
> completo abaixo — a sessão do Fable não tem memória desta conversa.

```
Você é o Claude Code (modelo Fable) trabalhando no NutriOPS — um SaaS multi-tenant
de conformidade sanitária RDC 216/2004, em PRODUÇÃO com 3 clientes pagando
(Swiss, Bäckerei, DBK Produção) + agora a CASA DOCE. Stack: React 19 + Vite (SEM
TypeScript), CSS com variáveis, localStorage + Supabase REST (anon key no bundle),
deploy Vercel (auto-publish no push pra `main`). Dono: Mac, fala PT-BR.

## Sua missão
Fechar a ÚLTIMA e maior peça de segurança: o **isolamento server-side** entre
tenants — o épico Auth+RLS, Fase 3. Hoje as 8 tabelas de DADOS
(temperature_records, form_records, form_templates, equipment_catalog,
receiving_records, products, stock_logs, special_controls) estão com **RLS OFF** →
qualquer um com a anon key (pública, extraível do bundle) lê/escreve QUALQUER
tenant_id direto na API REST. Essa é a brecha real que falta.

## LEIA PRIMEIRO (nesta ordem)
1. `CLAUDE.md` — guia do projeto + tabela de "Pendências conhecidas" (o estado de
   segurança está lá, com os itens já resolvidos).
2. `docs/AUTH_RLS_PLAN.md` — o RUNBOOK completo da Fase 3 (decisões aprovadas,
   bloqueadores, sequência de rollout tabela-por-tabela, rollback). É a fonte de
   verdade; parta dele.
3. `docs/security-tenants-lockdown.sql` — o padrão RPC `security definer` + RLS
   deny-all que já usamos pra fechar a tabela `tenants` (referência de estilo).
4. Código-chave: `src/device-auth.js`, `src/repository.js` (procure `SUPABASE_SQL`,
   `testWrite`, `testConnection`, `sbHeaders`/`sbFetch`), `src/tenant-sync.js`,
   `src/admin.jsx` (HealthView), `src/permissions.js`.

## O que JÁ está feito (não refaça, não regrida)
- Fases 0/1/2 do épico: 8 policies `tenant_isolation` escritas (RLS ainda OFF), 3
  contas device no Supabase Auth, `device-auth.js` plugado no sync com fallback
  SEMPRE pra anon key.
- v1.9.31 (commit b8c7ad7): tabela `tenants` FECHADA — acesso anon migrado pra RPCs
  `security definer` + RLS deny-all. Verificado em prod (GET /tenants?select=* →
  401). Ref: docs/security-tenants-lockdown.sql.
- v1.9.34 (commit 97105f8): vazamento cross-tenant CLIENT-SIDE fechado —
  `seesAllTenants = isGlobalAdmin(session)` em pages.jsx (só admin global vê o
  portfólio). NÃO substitui o RLS; é só UI.

## Restrições INEGOCIÁVEIS (produção, clientes pagando)
- A ARMADILHA: NUNCA ligue RLS sem policy — `enable row level security` sem policy
  = deny-all = QUEBRA o app (o cliente lê pela anon key).
- Antes de QUALQUER `enable RLS`: (a) `VITE_DEVICE_PASSWORD` no Vercel + confirmar
  nos logs que os 3 tenants pegam device token; (b) corrigir os bloqueadores abaixo.
- Ligar RLS **tabela por tabela**, começando pela de menor risco, com o dono
  presente + janela de monitoramento, e `alter table X disable row level security`
  de rollback a 1 comando.
- Você NÃO tem acesso ao dashboard do Supabase/Vercel. Entregue **SQL idempotente**
  + passos exatos pro dono rodar. VALIDE empiricamente o que der: a anon key é
  pública — extraia do bundle de prod e prove o fix batendo na API REST (foi assim
  que provamos o lockdown da `tenants`: 401 no acesso direto, RPC respondendo).

## Bloqueadores conhecidos — CORRIGIR ANTES de ligar RLS
1. `testWrite`/`testConnection` (repository.js) inserem/leem com anon key → sob RLS
   viram falso 401/banner em todo boot. Fix: exceção de policy pro tenant
   `__healthcheck__` OU usar device token.
2. `admin.jsx` HealthView lê `temperature_records` com anon key sem filtro → painel
   vazio sob RLS. Depende da decisão de auth do /admin (abaixo).
3. Garantir que a `tenants` (já via RPC) não regrida.

## Decisão pendente que muda o caminho
Auth do `/admin` sob RLS: o painel autentica por SENHA própria (VITE_ADMIN_PASSWORD,
sem JWT do Supabase) → quebra sob RLS. Opções: (A) migrar `/admin` pro Supabase Auth
(admin JWT com role → bypass nas policies + fecha o backdoor da senha) — o dono já
sinalizou preferência por isso; (B) manter a senha. Confirme com o dono antes de codar.

## DIVISÃO DE TRABALHO (regra explícita do dono)
- VOCÊ (Fable) faz as partes de ALTO RISCO / JULGAMENTO: desenhar a sequência de
  rollout do RLS, a arquitetura de auth do /admin, a revisão adversarial das
  policies (`tenant_id` tem que vir do CLAIM do JWT, não do payload), e a validação
  empírica contra a prod.
- Para partes MECÂNICAS simples (edições de string repetitivas, bump de versão,
  ajuste de teste, docs), NÃO gaste seu julgamento: marque explicitamente
  "➡️ isso pode ir de Opus" e deixe a tarefa especificada/pronta pra delegar.

## Como trabalhar (convenções do projeto)
- Responda em PT-BR no formato do CLAUDE.md: O que fiz / O que você precisa fazer /
  Por que / Próximo passo / Erros.
- Cada commit bumpa o patch do `APP_VERSION` (src/brand.jsx). SEMPRE
  `git add -A && git reset src/data.js` antes de commitar — NUNCA commitar data.js.
- `npm run build` e `npx vitest run` têm que passar. Valide no browser quando for
  observável.
- NÃO execute o flip do RLS sem o OK explícito do dono + monitoramento. Entregue
  plano + SQL + checklist de teste + rollback; o dono roda.

## SEU PRIMEIRO PASSO (não mexa em nada ainda)
Leia o runbook + o estado atual e devolva um PLANO alinhado:
(a) plano faseado atualizado (o que mudou desde o runbook, dado que tenants +
    client-side já foram fechados);
(b) lista exata dos bloqueadores com o fix proposto pra cada;
(c) a decisão de auth do /admin com sua recomendação;
(d) o que você fará como Fable vs o que recomenda delegar pro Opus;
(e) a ordem de rollout tabela-por-tabela (qual tabela primeiro e por quê).
Só depois de o dono aprovar esse plano, comece a executar — e mesmo assim, o
`enable RLS` só com ele presente.
```
