# NutriOPS — histórico de pendências resolvidas

> Arquivo de arquivo morto. Saiu do `CLAUDE.md` (que é reenviado ao Claude em
> todo turno) pra cá. Consultar só quando precisar do "por que fizemos assim".
> O que ainda influencia decisão de hoje continua no `CLAUDE.md`.

---

## Épico Auth + RLS (concluído 19/07/2026)

**As 8 tabelas de dados estão com RLS LIGADO e auditadas em produção.**

Prova empírica (anon key extraída do bundle público, `GET /rest/v1/<tabela>` nas
8): 7 retornam `[]` e `temperature_records` retorna só a linha `__healthcheck__`
— zero dado real vaza, mesmo havendo 100+ registros da Swiss lá dentro (é RLS
filtrando, não tabela vazia). `tenants` → **401**. RPC legítima
`get_tenant_by_token` → 200 (onboarding intacto).

Limpeza da Fase 4: o `SUPABASE_SQL` do `repository.js` — que a UI de
**Configurações** exibe com botão de copiar — tinha 8 `disable row level
security` + policies lendo `user_metadata` (forjável); um paste desfazia o épico
inteiro. Reescrito pra espelhar a produção (policies `app_metadata` +
`__healthcheck__`, depois `enable`, nessa ordem).

### `upsert_tenant` fechada (23/07/2026)

Era a última brecha de **escrita não-autenticada** — `SECURITY DEFINER` +
anon-callable = qualquer um com a chave pública criava/sobrescrevia empresa,
inclusive girando `access_token` e `setup_pin_hash`. Fechada em 3 fases:

1. `revoke` nas 2 RPCs de admin
2. v1.9.47 — `pushTenant` passou a assinar com o JWT do admin (`sbHeaders()`
   fixava a anon key, então o upsert rodava como `role=anon` mesmo com admin
   logado; revogar antes disso quebraria o cadastro de clientes)
3. Portão `app_metadata.role='admin'` DENTRO da função + `revoke from anon, public`

Prova: ataque simulado com a chave pública → **401 `permission denied for
function`**, nenhuma empresa fantasma criada; `get_tenant_by_token` segue 200.

⚠️ O `revoke` do `anon` precisou rodar ISOLADO (fora da transação do `create or
replace`, que o Supabase re-concede). Se voltar a aparecer `anon=X` na `proacl`,
o portão interno continua barrando.

### Aparas remanescentes do épico

Nenhuma é vazamento de dado nem escrita não-autenticada — as duas primeiras são
negação de serviço no onboarding:

- `get_tenant_by_token` devolve `setup_pin_hash` a quem tiver o token (PIN de 4
  dígitos quebrável offline → mover a conferência pra RPC
  `verify_setup_pin(token, pin)`)
- `mark_setup_consumed` / `bump_setup_attempts` são chaveadas por `tenant_id`
  adivinhável (`swiss`, `backerei`) sem prova de posse do token → dá pra travar
  o onboarding de cliente novo (chavear por `access_token`)
- Suspensão por `active` sem enforcement server-side
- 2FA ainda é TOFU

### Rollout (ordem cronológica)

- **Fases 0/1/2** (v1.9.6–1.9.15, 01/07) — 3 contas device no Supabase Auth,
  `device-auth.js` (JWT por tenant com fallback pra anon key), 8 policies
  escritas (RLS ainda OFF). Revisão adversarial (22 agentes) confirmou zero
  regressão.
- **v1.9.31 (10/07)** — `tenants` exposta + colunas sensíveis: acesso anon
  migrado pra RPCs `security definer` (`get_tenant_by_token` não devolve
  `access_token`) + RLS deny-all + grants revogados
  (`docs/security-tenants-lockdown.sql`, rodado). `GET /tenants?select=*` com
  anon key → 401.
- **v1.9.34 (15/07)** — vazamento cross-tenant client-side: um Administrador/RT
  PRESO a um tenant (ex.: CASA DOCE) via `perms.multiTenant` enxergava,
  CARREGAVA os registros e podia entrar SEM PIN nas lojas-seed (Swiss/Bäckerei/
  DBK, embutidas no build via `data.js`). Fix: `pages.jsx` amarra
  "ver/carregar/trocar todas" em `seesAllTenants = isGlobalAdmin(session)`.
  Validado: global vê 3, scoped vê 1.
- **v1.9.37** — `/admin` migrado pro Supabase Auth, fechando o backdoor
  `VITE_ADMIN_PASSWORD`.
- **v1.9.38** — RPCs security-definer gated por `app_metadata.role='admin'`.
- **v1.9.78 (03/08)** — caminhos residuais do vazamento cross-tenant fechados.

### VITE_ADMIN_PASSWORD — parqueado e depois superado

Tentamos setar no Vercel em 30/05; a env **não chegava no build** (as `VITE_SB_*`
chegam, essa não; provado via hash do chunk; causa inconclusiva). Ficou no
fallback `nutriops@admin2026` até a v1.9.37 migrar o `/admin` pro Supabase Auth,
que tornou a questão irrelevante.

**Anon key:** rotação adiada de propósito — a chave é pública por design (vai no
bundle). A proteção real era RLS, que já está no ar.

---

## Sessão 01/07/2026 (v1.9.6–1.9.15)

- ✅ **Login endurecido** — admin global saiu do PIN `9999` pra e-mail/senha via
  Supabase Auth (`6e79b1d`→`4ebeef6`); backdoor removido.
- ✅ **Auto-connect + auto-backfill do Supabase** (`1908d08`) — devices ligam o
  Supabase e sobem histórico sozinhos no boot; env `VITE_SB_*` no build da Vercel.
- ✅ **Bugs de cadastro/login** (`e977275`) — nome com espaço, `@Bäckerei` com
  trema, handle na lista de usuários.
- ✅ **Dedup do catálogo de equipamentos** (`19f16e3`) — mata alerta de turno em
  dobro (`dedupeCatalog` em `limits.js`).
- ✅ **Infra Vercel limpa** — projeto duplicado deletado, `nutriops-dev`
  renomeado pra `nutriops` (produção).

---

## Sessão 06/06/2026 (v1.9.1–1.9.5)

- ✅ **Seletor de empresa no header** (`d75f412`) — dropdown no avatar pra
  Supervisor/RT/Admin. RT/Admin trocam instantâneo; Supervisora via relogin com
  PIN da empresa-alvo (`TenantSwitchModal` + `CompanySwitcher` em `pages.jsx`;
  flag `canSwitchTenant` em `permissions.js`; `user-match.js` compartilhado).
- ✅ **Breadcrumb nos hubs** (`f6090bb`) — "Hub › Sub-view"; barra de tabs some
  com 1 sub-view só.
- ✅ **Polimento login + ⌘K** (`0f197db`).
- ✅ **Swiss conectada** — `testWrite ok`, fila 92→0, 77 registros de temperatura
  na nuvem. Roteiro de campo:
  `~/Documents/NutriOPS-roteiro-migracao-estacoes.pdf`.
- ✅ **Convenção de versionamento** — cada commit bumpa o patch do `APP_VERSION`.

---

## Sessão 29-30/05/2026 (v1.9.0)

- ✅ **Sync automático no boot + logs** — health-check de write, banner "modo
  local" agressivo, detector de 401, logs verbosos. Ver `HANDOFF_2026-05-29.md`.
- ✅ **Banner "modo local"** — `LocalModeBanner` conta registros e escala cor.
  Na v1.9.30 ganhou o guard `buildEnvHasSupabase = import.meta.env.VITE_SB_URL`:
  em build de PROD o banner **nunca aparece** pro cliente. Erros reais de conexão
  seguem no `SupabaseAuthErrorBanner` à parte.
- ✅ **Versionar CACHE do SW** — `scripts/version-sw.js` injeta BUILD_ID por deploy.
- ✅ **Code splitting** — bundle inicial 121 KB → 95 KB gzip. `pages.jsx` quebrado
  em login/settings/reports-views/team-views.
- ✅ **CI no GitHub Actions** — build + 128 testes em todo push/PR pra `main`.
- ✅ **Tooltip no gráfico** — hover nos pontos mostra temperatura + data/hora.

---

## Schema da tabela `tenants` (referência)

Criada antes do lockdown. **Hoje ela está com RLS deny-all e acesso anon
revogado** — o `disable row level security` do DDL original NÃO vale mais; a
fonte de verdade é `docs/security-tenants-lockdown.sql`.

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
```
