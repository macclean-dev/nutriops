# NutriOPS — guia rápido pra Claude Code

> Antes de mexer em qualquer coisa: leia este arquivo e `project_specs.md`.

---

## O que é

SaaS multi-tenant de conformidade sanitária RDC 216/2004 (ANVISA). Em produção
com 3 clientes (Swiss, Bäckerei, DBK Produção). Detalhes técnicos completos em
`project_specs.md`.

- **Prod:** https://nutriops.uniwares.net
- **Repo:** https://github.com/macclean-dev/nutriops.git
- **Local:** `/Users/mac/Documents/NutriOPS/`
- **Versão atual:** v1.9.0

---

## Stack (não é Next.js — atenção)

- React 19 + Vite 7, **sem TypeScript**
- CSS puro com variáveis (sem Tailwind, sem styled-components)
- localStorage como cache + Supabase REST v2 como nuvem
- EmailJS para transacionais
- PWA (manifest + service worker)
- Deploy Vercel (auto-publish no push para `main`)

Se você for tentado a sugerir migrar pra Next/TS/Tailwind: **não**. Já temos
clientes pagando. O ROI dessa reescrita é negativo agora.

---

## Regras críticas

### `src/data.js` e PINs

A partir do split (`src/tenants-public.js` + `src/data.js`), os defaults
de PIN (`0000` colaboradores, `6270` Fran, `8771` Ana Paula, `9999` admin)
ficam no `data.js` e **são commitáveis** — são apenas valores de fábrica
sobrescritos pelo PIN reset obrigatório no 1º login.

**Não commitar:**

- `nutriops.pin.overrides.{tenantId}` no localStorage — fica só no device
- Qualquer alteração em `data.js` que coloque PINs **específicos** de
  cliente pago (ex.: a Fran pediu PIN `4729`). Nesses casos:

  ```bash
  git add -A
  git reset src/data.js
  git commit -m "mensagem"
  git push
  ```

- `data.js` com `usersList` de cliente real que não passou pelo `/admin`.

### Variáveis de ambiente

`.env.example` lista as envs esperadas. Copia pra `.env.local` em dev. Em
produção, configura em Vercel → Project → Settings → Environment Variables.
`.env.local` está no `.gitignore` e nunca deve ir pro repo.

| Variável | Onde é usada | Default |
|----------|--------------|---------|
| `VITE_ADMIN_PASSWORD` | Senha do `/admin` | `nutriops@admin2026` (fallback, com warning no console) |
| `VITE_SB_URL` | URL do projeto Supabase compartilhado pelos tenants seed | vazio (modo local por device) |
| `VITE_SB_ANON_KEY` | Anon key pública desse projeto Supabase | vazio (modo local por device) |

Quando `VITE_SB_URL` + `VITE_SB_ANON_KEY` estão preenchidas no build, todos
os 3 tenants seed (Swiss, Bäckerei, DBK Produção) ganham `tenant.supabase`
automaticamente, e `handleLogin` em `pages.jsx` propaga pro localStorage do
device. Resultado: qualquer aparelho que abrir o app já entra sincronizando.

### Onde mora cada parte de tenant

- `src/tenants-public.js` — metadata pura (id, nome, segmento, equipamentos).
  **Pode commitar.** Sem PINs, sem credenciais.
- `src/data.js` — `usersList` com PINs + `globalAdmin`. **Gitignored.**
  Importa de `tenants-public.js` e merge no runtime.

### Antes de marcar tarefa como "done"

- `npm run build` passa sem erro
- `npm run dev` carrega sem erro de console
- Validei a feature no browser (não só o build)

### Design (alinhado com Nexum / Claude design system)

- **Sem emojis em ícones de UI** — usar `NavIcon` (SVG outline 16×16) ou outro SVG
- **Sem gradientes genéricos** — primária é coral sólido (`--primary`)
- **Tipografia:** `Instrument Sans` (UI) + `Instrument Serif` (wordmark)
- **Paleta:** creme `#faf9f5` canvas / ink `#141413` / coral `#cc785c` / warm dark rail `#181715`
- **Brand primitives:** `src/brand.jsx` exporta `NutriMark`, `BrandLockup`, `APP_VERSION`

### Adicionar novo módulo/view

Atualizar **TRÊS lugares**:

1. `src/permissions.js` — adicionar o key em `ALL_VIEWS` e nos `nav` dos roles que devem ver
2. `buildNavSections` em `pages.jsx` — adicionar o item no grupo certo
3. Switch de views em `App()` (`pages.jsx` ~2700) — adicionar a renderização

### Hubs com sub-tabs

Quando 3+ views são variações da mesma coisa, agrupar num hub (estilo
Nexum flat nav). Hoje já temos: `ControlsHub` (5 controles especiais),
`ReportsHub` (5 relatórios), `TeamHub` (users/turns/sessions). Padrão em
`pages.jsx` — copiar `HubTabs` + `resolveHubTab`.

---

## Estrutura de arquivos (`src/`)

Mais detalhes em `project_specs.md`. Resumo:

| Arquivo | Responsabilidade |
|---------|------------------|
| `pages.jsx` | App principal, todos os views, login, RailNav, hubs — ~2900 linhas |
| `styles.css` | Design system, dark mode, mobile responsivo |
| `brand.jsx` | NutriMark, BrandLockup, APP_VERSION — compartilhado pela suite |
| `permissions.js` | RBAC por perfil + ALL_VIEWS |
| `repository.js` | localStorage + Supabase REST + offline queue |
| `data.js` | ⚠️ Tenants e PINs reais — **nunca commitar** |

---

## Como responder

Pra cada resposta de mudança no código, incluir:

- **O que fiz** — em português claro, sem jargão
- **O que você precisa fazer** — passo a passo
- **Por que** — uma linha de propósito
- **Próximo passo** — uma ação clara
- **Erros** — se algo deu errado, o que é e como corrigir

Quando envolver ferramenta externa (Supabase, Vercel, etc.):
- Mostrar exatamente onde encontrar (ex.: "Supabase → Settings → API")
- Explicar o que cada coisa faz em uma frase
- Se tem SQL, explicar o que faz antes de pedir pra rodar

---

## Comandos úteis

```bash
cd /Users/mac/Documents/NutriOPS

# Dev local
npm run dev         # http://localhost:5173

# Build
npm run build

# Antes do commit/push
git status
git add -A && git reset src/data.js
```

---

## Sync por tenant (via Supabase)

Tabelas que sincronizam via `syncAllModules`:
- `temperature_records` · `form_records` · `form_templates`
- **`equipment_catalog`** (label/aliases/location/min_temp/max_temp por tenant)
- `receiving_records` · `products` · `stock_logs` · `special_controls`

Tabela `tenants` (separada do `syncAllModules`):
- Espelha tenants criados via `/admin` pra que clientes consigam abrir
  o link `?token=` em qualquer device e baixar a metadata + hash do
  setup PIN. Lida só por `src/tenant-sync.js` (push no admin, fetch no boot).
- Schema:
  ```sql
  create table if not exists tenants (
    id text primary key,
    access_token text unique not null,
    name text, segment text, plan text,
    brand_color text, brand_soft text,
    equipment_catalog jsonb,
    modules jsonb,
    stores jsonb,
    setup_pin_hash text,
    setup_pin_used_at timestamptz,
    setup_pin_attempts integer default 0,
    setup_pin_locked_until timestamptz,
    admin_email text, admin_name text,
    trial_ends_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create unique index if not exists idx_tenants_token on tenants(access_token);
  alter table tenants disable row level security;
  ```

Equipment catalog: salvar em qualquer device chama `pushEquipmentItem`;
boot em qualquer outro device chama `syncEquipmentCatalog` e puxa updates.
Cloud é source-of-truth: se remoto > 0, sobrescreve local. Se remoto vazio,
cai no seed de `tenants-public.js`.

## Fluxo admin → cliente operacional (v1.8.0+)

Quando o admin cadastra um cliente em `/admin`:

1. Gera setup PIN aleatório de 4 dígitos (PBKDF2 100k iter — `src/crypto.js`)
2. Push do tenant na tabela `tenants` do Supabase (`src/tenant-sync.js`)
3. `AccessTokenModal` mostra o PIN uma única vez no overlay coral —
   admin precisa enviar por **canal separado** do link (WhatsApp/SMS)
4. Cliente abre `?token=XYZ`:
   - `main.jsx` busca tenant no Supabase via `fetchTenantByToken`
   - Popula `nutriops.onboarding.tenants` local
   - `pages.jsx` detecta tenant sem usersList povoado → renderiza `SetupPinScreen`
5. Cliente digita setup PIN → rate-limited (3 tentativas → bloqueio 15 min,
   persistido em local + remoto)
6. Acerto → tela "Crie seu PIN definitivo" → valida não-fraco (`isWeakPin`)
   → cria admin owner → marca `setup_pin_used_at` no cloud → sessão criada

Wizard antigo (`OnboardingWizard`) ainda existe como fallback quando o
cliente abre `?onboarding=1` ou quando o tenant não foi pré-criado pelo admin.

## GitHub Actions CI

Workflow `.github/workflows/ci.yml` (rodando `npm test` + `npm run build`)
está versionado localmente mas ainda **não foi pushado** — o PAT atual não
tem scope `workflow`. Pra ativar:

1. GitHub → Settings → Developer settings → Personal access tokens
2. Edita o token usado nesse repo
3. Marca o scope `workflow`
4. Salva, depois `git add .github/workflows/ci.yml && git commit -m "ci: build + test em push/PR" && git push`

A partir daí, todo PR e push pra `main` roda build + 38 testes automaticamente.

## Pendências conhecidas

| Prioridade | Item |
|------------|------|
| 🟡 Média | Validar sync de Bäckerei + DBK (receita abaixo) — esperando acesso aos devices das lojas |
| 🟢 Alta (épico) | Supabase Auth real + RLS — mata anon key exposta + RLS off + PIN local de uma vez. Plano em `docs/AUTH_RLS_PLAN.md` (3 decisões aguardando aprovação) |
| 🟢 Baixa | Migrar PINs `0000`/`9999` pra reset obrigatório no 1º login (cai junto no épico de Auth) |

### Resolvidas (v1.9.0 — sessão 29-30/05)

- ✅ **Sync automático no boot + logs** — health-check de write, banner "modo
  local" agressivo, detector de 401, logs verbosos. Ver `HANDOFF_2026-05-29.md`.
- ✅ **Banner "modo local"** — `LocalModeBanner` conta registros e escala cor.
- ✅ **Versionar CACHE do SW** — `scripts/version-sw.js` injeta BUILD_ID por deploy.
- ✅ **Code splitting** — bundle inicial 121 KB → 95 KB gzip (<100 KB). pages.jsx
  quebrado em login/settings/reports-views/team-views.
- ✅ **CI no GitHub Actions** — `.github/workflows/ci.yml` rodando build + 128
  testes em todo push/PR pra `main`.
- ✅ **VITE_ADMIN_PASSWORD no Vercel** — fallback público `nutriops@admin2026`
  aposentado (setada em Production + Preview).
- ✅ **Tooltip no gráfico** — hover nos pontos mostra temperatura + data/hora.

> ⚠️ Anon key: **adiada de propósito**. Rotacionar não adianta enquanto RLS
> estiver off (a chave é pública por design — vai no bundle). A proteção real
> é o épico de Auth + RLS. Ver `docs/AUTH_RLS_PLAN.md`.

### Receita — validar/destravar device de loja (sem precisar de mim)

Quando um device de loja não estiver sincronizando (dados só locais):

1. No device: feche o app por completo (ou Cmd+Shift+R no navegador)
2. Reabra `nutriops.uniwares.net` → aparece o toast coral **"Nova versão
   disponível"** → **Atualizar agora**
3. Faça login normal
4. F12 → Console, confirme as 3 linhas:
   `[NutriOPS] boot — Supabase: ON …` · `testWrite ok` · `auto-sync done — N/9`
5. Se aparecer banner amarelo "N registros aguardando" → **Configurações →
   Migrar registros locais para Supabase**
6. Confirme na nuvem (Supabase → SQL Editor):
   ```sql
   SELECT tenant_id, COUNT(*), MAX(created_at)
   FROM temperature_records GROUP BY tenant_id ORDER BY tenant_id;
   ```
   As 3 lojas (`swiss`, `backerei`, `dbk-producao`) devem ter `MAX(created_at)`
   recente.

## Sync — entenda antes de mexer (lições da v1.9.0)

Bug crítico investigado em 29/05: dados das lojas não chegavam no Supabase.
Causa = PWA preso em bundle antigo (sem env vars) + pushes que faziam no-op
silencioso quando Supabase off. Regras que NÃO podem regredir:

- **Todo push enfileira mesmo com Supabase off** (`repository.js`). Quando
  habilitar depois, `syncQueue` empurra. Nunca voltar pro `if (!enabled) return`.
- **Service worker força update** via toast + `controllerchange` (`main.jsx`).
- **Auto-config sobrescreve** se URL/anonKey mudaram (`handleLogin` em pages.jsx).
- **RLS está OFF** em todas as tabelas (auth é PIN local). Se ligar Supabase
  Auth + RLS, reverter o `disable row level security` do `SUPABASE_SQL` e
  escrever policies `auth.uid()` — senão volta o bug de push silencioso.
