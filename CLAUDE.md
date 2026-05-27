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
- **Versão atual:** v1.6.0

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
| 🔴 Alta | Senha do `/admin` (`nutriops@admin2026`) — trocar antes de escalar |
| 🔴 Alta | Sync automático no boot + logs (problema da loja v1.5 com dados só locais) |
| 🟡 Média | Versionar `CACHE` do service worker (hoje `nutriops-v1` hardcoded) |
| 🟡 Média | Banner "modo local" quando Supabase desligado |
| 🟡 Média | Supabase Auth real — hoje é PIN local; `auth.jsx` pronto mas não wired |
| 🟢 Baixa | Code splitting (bundle JS em 594 KB) |
| 🟢 Baixa | Migrar PINs `0000` pra reset obrigatório no 1º login |
