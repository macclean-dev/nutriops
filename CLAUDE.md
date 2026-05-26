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

### `src/data.js` nunca vai ao GitHub

Tem PINs e tenants reais. Fluxo de push:

```bash
git add -A
git reset src/data.js   # ou: git rm --cached src/data.js 2>/dev/null; true
git commit -m "mensagem"
git push
```

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
