# NutriOPS — guia rápido pra Claude Code

> Antes de mexer em qualquer coisa: leia este arquivo e `project_specs.md`.
> Histórico de pendências já resolvidas: `docs/HISTORICO.md`.
> Receitas operacionais (destravar device, ativar CI): `docs/RUNBOOK.md`.

---

## O que é

SaaS multi-tenant de conformidade sanitária RDC 216/2004 (ANVISA). Em produção
com 3 clientes (Swiss, Bäckerei, DBK Produção) + CASA DOCE em implantação.
Detalhes técnicos completos em `project_specs.md`.

- **Prod:** https://nutriops.uniwares.net
- **Repo:** https://github.com/macclean-dev/nutriops.git
- **Local:** `/Users/mac/Documents/NutriOPS/`
- **Versão atual:** `APP_VERSION` em `src/brand.jsx` (fonte de verdade)

---

## Stack (não é Next.js — atenção)

- React 19 + Vite 7, **sem TypeScript**
- CSS puro com variáveis (sem Tailwind, sem styled-components)
- localStorage como cache + Supabase REST v2 como nuvem
- EmailJS para transacionais
- PWA (manifest + service worker)
- Deploy Vercel (auto-publish no push para `main`)
- `api/extract-template.js` (desde 09/08/v1.9.109) — única função serverless
  do projeto, chama a Anthropic com visão pra importar planilha por foto/PDF.
  `ANTHROPIC_API_KEY` fica só nela (nunca `VITE_`-prefixada). Fora essa rota,
  o resto do app continua 100% estático.

Se você for tentado a sugerir migrar pra Next/TS/Tailwind: **não**. Já temos
clientes pagando. O ROI dessa reescrita é negativo agora.

---

## Regras críticas

### Login do admin global (v1.9.9+)

> **O admin global NÃO usa mais PIN `9999`.** Ele autentica com **e-mail + senha
> via Supabase Auth** (`auth.jsx` → `signIn`). O usuário vive em
> `Authentication → Users` no Supabase, com `raw_user_meta_data`
> `{"name":"Administrador","role":"Administrador","tenantId":null}`. Na tela de
> login: botão **"Entrar como administrador"**. O `__admin__`/PIN 9999 foi
> **removido** do `login.jsx`. (Colaborador segue com PIN no tablet.)
> O `tenants-public.js` precisa das env `VITE_SB_*` no build pra o Supabase ligar
> antes do login — já garantido em produção. Ver `docs/AUTH_RLS_PLAN.md`.

### `src/data.js` e PINs

Os defaults de PIN (`0000` colaboradores, `6270` Fran, `8771` Ana Paula) ficam no
`data.js` e **são commitáveis** — valores de fábrica sobrescritos pelo PIN reset
obrigatório no 1º login.

**Não commitar:**

- `nutriops.pin.overrides.{tenantId}` no localStorage — fica só no device
- Alteração em `data.js` com PIN **específico** de cliente pago (ex.: a Fran
  pediu `4729`). Nesses casos:

  ```bash
  git add -A
  git reset src/data.js
  git commit -m "mensagem"
  git push
  ```

- `data.js` com `usersList` de cliente real que não passou pelo `/admin`.

### Variáveis de ambiente

`.env.example` lista as envs esperadas. Copia pra `.env.local` em dev (está no
`.gitignore`). Em produção: Vercel → Project → Settings → Environment Variables.

| Variável | Onde é usada | Default |
|----------|--------------|---------|
| `VITE_ADMIN_PASSWORD` | Senha do `/admin` **só em DEV**. Em PROD o `/admin` usa Supabase Auth (v1.9.37+). | `nutriops@admin2026` (fallback dev) |
| `VITE_SB_URL` | URL do projeto Supabase compartilhado pelos tenants seed | vazio (modo local por device) |
| `VITE_SB_ANON_KEY` | Anon key pública desse projeto | vazio (modo local por device) |
| ~~`VITE_DEVICE_PASSWORD`~~ | **Aposentada em 09/08.** O sync agora é assinado pelo JWT da sessão (conta de loja ou admin). Pode sair da Vercel. | — |
| `ANTHROPIC_API_KEY` | **Sem prefixo `VITE_` de propósito** — só `api/extract-template.js` (função serverless) lê isso via `process.env`. Nunca embutir com `VITE_`, senão vaza no bundle do client. | vazio (botão "Importar por IA" falha com erro claro) |

Com `VITE_SB_URL` + `VITE_SB_ANON_KEY` no build, os 3 tenants seed ganham
`tenant.supabase` automaticamente e `handleLogin` (`pages.jsx`) propaga pro
localStorage do device — qualquer aparelho já entra sincronizando.

### Onde mora cada parte de tenant

- `src/tenants-public.js` — metadata pura (id, nome, segmento, equipamentos).
  **Pode commitar.** Sem PINs, sem credenciais.
- `src/data.js` — `usersList` com PINs. Importa de `tenants-public.js` e faz
  merge no runtime. Ver regra de commit acima.

### Antes de marcar tarefa como "done"

- `npm run build` passa sem erro
- `npm run dev` carrega sem erro de console
- Validei a feature no browser (não só o build)

### Versionamento (acordo com o dono — 05/06/2026)

**Todo commit incrementa o patch do `APP_VERSION` em +1** (`src/brand.jsx`),
inclusive docs/chore. Bump no mesmo commit da mudança.

### Deploys

**Não dar `git push` sem aprovação** — a cota da Vercel é apertada. Commitar
local é livre; push só quando o dono confirmar.

### Design (paleta MongoDB — verde/teal, NÃO mais coral/Nexum)

> **v1.9.26+** trocou a paleta coral/creme pela do MongoDB design system
> (`DesignNewColours.md`). Só as CORES mudaram. Tudo dirigido por variáveis CSS
> em `src/styles.css` (`:root` + `[data-theme="dark"]`).

- **Sem emojis em ícones de UI** — usar `NavIcon` (SVG outline 16×16) ou outro SVG
- **Sem gradientes genéricos** — primária é verde sólido (`--primary` = `#00684a`)
- **Tipografia:** `Instrument Sans` (UI) + `Instrument Serif` (wordmark)
- **Paleta:** off-white `#f9fbfa` canvas / ink navy-teal `#001e2b` / verde primary
  `#00684a` (fill com texto branco) / **verde vivo `#00ed64`** (`--accent`, só
  acento: nav ativo, focus, diagonal do logo) / **rail Green Dark `#00543b` com
  letras brancas** (preferência do dono — não é teal). Vermelho/âmbar/azul são
  sinais de status funcionais, não "marca".
- **Regra do verde:** `#00684a` é o único verde que aceita texto branco em cima;
  `#00ed64` só como acento, nunca como fundo de texto.
- **Brand primitives:** `src/brand.jsx` exporta `NutriMark`, `BrandLockup`,
  `APP_VERSION`

### Adicionar novo módulo/view

Atualizar **TRÊS lugares**:

1. `src/permissions.js` — key em `ALL_VIEWS` e nos `nav` dos roles que devem ver
2. `buildNavSections` em `pages.jsx` — item no grupo certo
3. Switch de views em `App()` (`pages.jsx` ~2700) — a renderização

### Hubs com sub-tabs

Quando 3+ views são variações da mesma coisa, agrupar num hub. Hoje:
`ControlsHub` (5 controles), `ReportsHub` (5 relatórios), `TeamHub`
(users/turns/sessions). Padrão em `pages.jsx` — copiar `HubTabs` +
`resolveHubTab`.

---

## Estrutura de arquivos (`src/`)

Mais detalhes em `project_specs.md`. Resumo:

| Arquivo | Responsabilidade |
|---------|------------------|
| `pages.jsx` | App principal, todos os views, login, RailNav, hubs — ~2900 linhas |
| `styles.css` | Design system, dark mode, mobile responsivo |
| `brand.jsx` | NutriMark, BrandLockup, APP_VERSION |
| `permissions.js` | RBAC por perfil + ALL_VIEWS |
| `repository.js` | localStorage + Supabase REST + offline queue |
| `data.js` | Tenants e PINs — ver regra de commit acima |

---

## Como responder

Pra cada mudança no código, incluir:

- **O que fiz** — em português claro, sem jargão
- **O que você precisa fazer** — passo a passo
- **Por que** — uma linha
- **Próximo passo** — uma ação clara
- **Erros** — o que é e como corrigir

Ferramenta externa (Supabase, Vercel): mostrar onde encontrar ("Supabase →
Settings → API"), explicar cada coisa em uma frase, e explicar o SQL antes de
pedir pra rodar.

---

## Comandos úteis

```bash
cd /Users/mac/Documents/NutriOPS
npm run dev         # http://localhost:5173
npm run build
git status
```

---

## Sync por tenant (via Supabase)

Tabelas do `syncAllModules` (8, todas com RLS ligado):
`temperature_records` · `form_records` · `form_templates` ·
**`equipment_catalog`** (label/aliases/location/min_temp/max_temp) ·
`receiving_records` · `products` · `stock_logs` · `special_controls`

⚠️ Há uma **9ª tabela, `tenant_staff`, em trabalho não commitado** (`syncTenantStaff`
+ policy no `SUPABASE_SQL` do `repository.js`, `team-views.jsx`, `staff-sync.test.js`).
Ainda não está no HEAD nem, presumivelmente, no Supabase. Ao commitar: rodar o SQL
da policy ANTES do deploy, senão o sync dessa tabela toma 401/403.

Tabela `tenants` (fora do `syncAllModules`): espelha tenants criados via `/admin`
pra o cliente abrir o link `?token=` em qualquer device. Lida só por
`src/tenant-sync.js`. Está com RLS deny-all + anon revogado; acesso só pelas RPCs
`security definer` (`docs/security-tenants-lockdown.sql`). Schema em
`docs/HISTORICO.md`.

Equipment catalog: salvar chama `pushEquipmentItem`; boot em outro device chama
`syncEquipmentCatalog`. Cloud é source-of-truth: remoto > 0 sobrescreve local;
remoto vazio cai no seed de `tenants-public.js`.

### Regras que NÃO podem regredir

Vêm do bug crítico de 29/05 (dados das lojas não chegavam no Supabase — PWA preso
em bundle antigo + pushes com no-op silencioso):

- **Todo push enfileira mesmo com Supabase off** (`repository.js`). Nunca voltar
  pro `if (!enabled) return`.
- **Service worker força update** via toast + `controllerchange` (`main.jsx`).
- **Auto-config sobrescreve** se URL/anonKey mudaram (`handleLogin`, `pages.jsx`).
- **RLS ligado nas 8 tabelas + `tenants` fechada** (épico concluído 19/07). O
  sync usa device-token por tenant (`app_metadata.tenant_id`). **Nunca** escrever
  policy que leia `user_metadata` (editável pelo próprio usuário via `updateUser`
  → forjável); só `app_metadata`. Fonte de verdade: `docs/rls-fase3-policies.sql`,
  espelhada no `SUPABASE_SQL` do `repository.js` (que a UI de Configurações exibe
  pro usuário copiar — manter os dois em sincronia, ordem policy→enable).

---

## Fluxo admin → cliente operacional (v1.8.0+)

> **v1.9.33:** o **Super Admin** (dentro do app) tem botão **"+ Novo cliente"**
> que reusa `ClientModal` + `AccessTokenModal` do `/admin` — cadastra empresa,
> gera token + setup PIN e mostra o link, sem precisar do painel separado.
> Exportados de `admin.jsx`, consumidos por `superadmin-view.jsx`.

1. Gera setup PIN aleatório de 4 dígitos (PBKDF2 100k iter — `src/crypto.js`)
2. Push do tenant na tabela `tenants` (`src/tenant-sync.js`, assinado com o JWT
   do admin)
3. `AccessTokenModal` mostra o PIN **uma única vez** — enviar por canal separado
   do link (WhatsApp/SMS)
4. Cliente abre `?token=XYZ`: `main.jsx` busca via `fetchTenantByToken` → popula
   `nutriops.onboarding.tenants` → `pages.jsx` detecta tenant sem `usersList` →
   renderiza `SetupPinScreen`
5. Cliente digita o setup PIN → rate-limited (3 tentativas → bloqueio 15 min,
   local + remoto)
6. Acerto → "Crie seu PIN definitivo" → valida `isWeakPin` → cria admin owner →
   marca `setup_pin_used_at` no cloud → sessão criada

`OnboardingWizard` antigo segue como fallback (`?onboarding=1` ou tenant não
pré-criado).

---

## Pendências abertas

| Prioridade | Item |
|------------|------|
| 🟡 Média (custo) | **Vercel migrou de Hobby pra Pro** (resolve o antigo bloqueio de deploy — confirmado 04/08, push liberou sem erro). Ciclo atual (9/jul–9/ago): US$34,87 total, US$20,00 de crédito incluso já consumido, ~US$14,87 pago sob demanda. Maior item: **Fast Origin Transfer, US$22,02** — **confirmado 04/08: é tráfego do Nexum** (função serverless/SSR, não do NutriOPS — que até 09/08 era SPA estática sem rota de API no Vercel). **A partir de 09/08 (item 11) o NutriOPS ganhou sua PRIMEIRA função serverless** (`api/extract-template.js`, importação de planilha por IA) — baixo volume de uso esperado (só a RT, sob demanda), mas vale lembrar na próxima investigação de custo que o Fast Origin Transfer pode deixar de ser 100% Nexum. Próximo passo, se quiser cortar o custo do Nexum: mover pro Cloudflare Pages. |
| 🔴 Alta | **Conectar a DBK Produção** — única loja ainda zerada na nuvem. Auto-connect + auto-backfill resolvem no próximo boot online do device dela. |
| 🟡 Média | **Bäckerei** — no ar (18 registros), último de 04/06. Verificar no device (receita em `docs/RUNBOOK.md`). |
| 🟡 Média | **Aparas do épico Auth+RLS** — 2 DoS de onboarding + suspensão sem enforcement + 2FA TOFU. Detalhe em `docs/HISTORICO.md`. |
| 🟡 Média | **Central de Não-Conformidades (v1.9.103): rodar `docs/corrective-actions-sync.sql` antes do deploy.** Cria a tabela `corrective_actions` (RLS de 4 caminhos) + confirma que `special_controls` já cobre `handwash`. Sem isso, ações corretivas e higiene das mãos continuam só locais — o achado que motivou (limpar o device apagava evidência de correção de desvio, exigência da RDC 216) segue aberto até rodar. |
| 🟢 Baixa | **Sync das regras de validade (v1.9.100) — em produção, SQL já rodado (09/08).** Tabela `validity_rules` confirmada com RLS ativo; aba Regras (Validades e Estoque) sincroniza entre devices. |
| 🟢 Baixa | **Etiquetas de abertura (v1.9.99) — em produção, SQL já rodado.** Colunas `opened_at/opened_until/opened_by` confirmadas em `products`. Falta só validar a impressão na Zebra ZD220/GC420 real da CASA DOCE. |
| 🟢 Baixa | Limpar a linha duplicada no `equipment_catalog` da Swiss na nuvem (o código dedupa desde a v1.9.14, mas o dado sujo continua lá). |
