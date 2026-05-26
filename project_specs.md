# NutriOPS — project specs

## O que o app faz

Sistema digital de conformidade sanitária para serviços de alimentação no Brasil,
seguindo a **RDC 216/2004 da ANVISA**. Substitui as planilhas de papel exigidas
pela fiscalização por um app web/PWA que coleta registros (temperatura,
higienização, recebimento, etc.) em tempo real, gera evidências para auditoria
e simplifica o trabalho da nutricionista responsável técnica (RT).

## Quem usa

Quatro perfis, com permissões diferentes (ver `src/permissions.js`):

| Perfil | Quem é | O que faz |
|--------|--------|-----------|
| **Colaborador** | Cozinheiro, auxiliar, atendente | Registra temperatura, higiene, planilhas BPF do dia |
| **Supervisor** | Gerente de loja | Acompanha pendências, alertas, manutenção |
| **Nutricionista RT** | Responsável técnica que assina pela rede | Valida registros, dashboards, relatórios, capacitações |
| **Administrador / Super-admin** | Equipe NutriOPS / dono da rede | Gestão de clientes, planos, usuários, config |

Login é `nome@empresa` + PIN de 4 dígitos. Hoje sem JWT — PIN é validado no
frontend contra `src/data.js` (em produção) ou `nutriops.onboarding.tenants`
(clientes que assinaram via onboarding wizard).

## Pages e fluxos

### Públicas

| Rota | O que é |
|------|---------|
| `/` (sem token) | Tela de login |
| `/?token=XXX` | Primeiro acesso via link de cliente novo (admin gera o link no painel) |
| `/admin` | Painel admin global (senha hardcoded — trocar antes de escalar) |

### Autenticadas (após login)

Estrutura "rail flat estilo Nexum", agrupada em seções silenciosas:

- **Operação:** Visão geral, Planilhas BPF, Recebimento, Validades, Controles especiais
- **Qualidade:** POPs, Capacitação, Manutenção
- **Gestão:** Alertas, Ações corretivas, Painel RT, Relatórios (hub), Equipe (hub)
- **Conta:** Meu perfil, Configurações

**Hubs** (tabs internos pra agrupar sub-views relacionadas):

- `controls` → handwash, oil, thaw, cooling, thermal
- `reportsHub` → dashboard, charts, reports, monthly, audit
- `team` → users, turns, sessions

Modo quiosque (`KioskApp`) é tela cheia para o tablet do balcão coletar
temperatura sem login.

## Tech stack

- **Frontend:** React 19, Vite 7, JavaScript (sem TypeScript)
- **Estilo:** CSS puro com variáveis (sem Tailwind, sem styled-components)
- **Cache local:** localStorage por tenant
- **Backend (cloud):** Supabase REST v2 (Postgres) — opcional por dispositivo
- **Auth:** PIN local hoje; `auth.jsx` pronto pra Supabase Auth (não wired ainda)
- **E-mail:** EmailJS (templates de boas-vindas + notificação interna)
- **PWA:** `public/sw.js` + `manifest.json` — instalável no celular
- **Deploy:** Vercel (auto-deploy no push pra `main`)
- **Desktop:** Electron em pasta separada (`NutriOps-Desktop/`) — sem auto-sync

## Modelos de dados

### localStorage (sempre)

| Key | Conteúdo |
|-----|----------|
| `nutriops.temperature.records` | Array de registros de temperatura (todos os tenants) |
| `nutriops.forms.records.{tenantId}` | Planilhas BPF por tenant |
| `nutriops.receiving.{tenantId}` | Registros de recebimento |
| `nutriops.products.{tenantId}` | Produtos com validade + estoque |
| `nutriops.equip_assets.{tenantId}` | Equipamentos cadastrados |
| `nutriops.maint_logs.{tenantId}` | Manutenções executadas |
| `nutriops.work_orders.{tenantId}` | Ordens de serviço |
| `nutriops.company.profile.{tenantId}` | CNPJ, RT, CRN do estabelecimento |
| `nutriops.supabase.config` | URL + anonKey + enabled (por dispositivo) |
| `nutriops.offline.queue` | Fila de writes a sincronizar quando voltar online |
| `nutriops.sync.status` | Último sync + count de pendentes |
| `nutriops.access.token` | Token do cliente (quando entrou via link) |
| `nutriops.admin.clients` | Clientes no painel admin |
| `nutriops.dark.mode` | `'true'` ou `'false'` |
| `nutriops.{hub}.lastTab` | Última sub-tab visitada em cada hub |

### Supabase (quando habilitado por dispositivo)

```sql
temperature_records   -- registros de temperatura
form_records          -- planilhas BPF
receiving_records     -- recebimento
products              -- validades/estoque
stock_logs            -- movimentações
special_controls      -- óleo/descongelamento/resfriamento/térmico
```

RLS hoje **desabilitada** — auth é PIN local. Wiring de Supabase Auth + RLS
por tenant é épico pendente.

## Serviços externos

- **Supabase** (Postgres + REST) — credenciais por cliente, configuradas em
  `Settings → Sincronização`
- **EmailJS** — chaves no `src/email.js`:
  - Public Key: `1ef0FtPY7bx_V4tA6`
  - Service: `service_vmc3qlr`
  - Template boas-vindas: `template_385ck7e`
  - Template notif interna: `template_4j2qukp`
- **Vercel** — deploy automático no push para `main`

## Tenants em produção

| ID | Nome | Segmento | Plano |
|----|------|----------|-------|
| `swiss` | Swiss Confeitaria | Confeitaria | Pro |
| `backerei` | Bäckerei Padaria | Padaria | Enterprise |
| `dbk-producao` | DBK Produção | Produção central | Enterprise |

PINs e usuários reais ficam em `src/data.js` (gitignored — ver CLAUDE.md).

## Planos comerciais

| Plano | Preço | Capacidade |
|-------|-------|------------|
| Trial | grátis 14 dias | até 5 usuários |
| Loja | R$ 149/mês | 1 unidade, até 15 colaboradores |
| Rede | R$ 349/mês | até 3 unidades |
| Enterprise | sob consulta | custom |

Cobrança é manual hoje (sem Stripe/Pagar.me).

## O que "done" significa

Pra qualquer mudança em NutriOPS:

1. `npm run build` passa sem erro
2. `npm run dev` carrega sem erro de console
3. Feature validada no browser (não só em build)
4. Comportamento existente não quebrou
5. `data.js` não entrou no commit
6. Commit message no estilo `feat:` / `fix:` / `chore:` em português

Para mudanças que tocam sync ou auth:

7. Testado online E offline (em pelo menos um cenário)
8. Sem regressão nos clientes em produção
