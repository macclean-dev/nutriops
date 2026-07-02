# Plano — Supabase Auth real + RLS por tenant

> **Status: DECISÕES #1 e #2 APROVADAS (05/06/2026).** O dono aprovou as duas
> recomendações: modelo **híbrido (1A)** e **device-token por tenant (2A)**.
> Falta só o dado da Decisão #3 (existe projeto Supabase de staging?). Nada
> implementado ainda — épico grande, mexe em auth + dados de 3 clientes pagando.
> Escrito na sessão de 29/05, decisões aprovadas na de 05/06.

## Decisões aprovadas

- ✅ **#1 — Modelo de identidade: A (híbrido).** Admin/RT/Supervisor com conta
  real (e-mail/senha + JWT); colaborador segue PIN, escrita autorizada via #2.
- ✅ **#2 — Autorização de escrita do colaborador: 2A (device-token por
  tenant).** Reaproveita o fluxo `?token=`; troca a anon key compartilhada por
  um JWT escopado no `tenant_id`. Caminho pra 2C (Edge Function) depois.
- ⚠️ **#3 — Staging: NÃO haverá staging.** Decisão do dono (05/06): testar as
  policies no **próprio prod com RLS ainda OFF** (Fase 0 não liga nada — só cria
  as policies). Margem de erro zero quando chegar a Fase 3 (ligar RLS): fazer
  **tenant por tenant**, com `testWrite` + banner de 401 como rede de segurança,
  e estar pronto pra `disable row level security` de rollback imediato.

> **Atualização (06/06):** Fase 1 concluída — admin global loga com e-mail/senha
> real (Supabase Auth), PIN `9999` removido (v1.9.8–1.9.10). **Fase 0
> concluída**: policies RLS escritas em `SUPABASE_SQL` (repository.js, RLS
> continua OFF, zero efeito ainda) + as 3 contas device criadas e confirmadas
> no Supabase Auth com metadata correto:
> - `device-swiss@nutriops.internal` → `{"role":"device","tenant_id":"swiss"}`
> - `device-backerei@nutriops.internal` → `{"role":"device","tenant_id":"backerei"}`
> - `device-dbk@nutriops.internal` → `{"role":"device","tenant_id":"dbk-producao"}`
>
> Senhas das 3 contas: mesma senha (escolha do dono — aceitável porque o
> isolamento vem do `tenant_id` no metadata de cada conta, não da senha).
> Guardadas fora do repo — não estão em nenhum arquivo committado.
>
> **Atualização (01/07):** Fase 2 concluída. `src/device-auth.js` (novo) faz
> login com a conta device do tenant e cacheia o JWT; `repository.js` passa a
> tentar esse JWT em toda chamada de rede que tem `tenantId` no escopo (20
> call-sites atualizados — `sbFetch`/`sbHeaders` aceitam `tenantId` opcional),
> com fallback SEMPRE pra anon key se o device-auth falhar por qualquer motivo
> (sem senha configurada, rede fora, credencial inválida). `pushModule`
> (código morto, nunca chamado) e `testWrite`/`testConnection` (health-check
> genérico, sem tenant real) ficam de fora de propósito — continuam na anon key.
>
> **Zero mudança de comportamento em produção hoje:** a env `VITE_DEVICE_PASSWORD`
> ainda não existe no Vercel, então `getDeviceAccessToken` retorna `null` na
> hora (sem tentar rede) e tudo cai pra anon key — bit-a-bit igual a antes
> desta fase. Validado no browser nos dois caminhos (sem senha → null
> instantâneo; com senha + URL fake → tenta rede de verdade, falha graciosamente
> em ~1.2s, cai pra anon key). 147 testes.
>
> **Próximo — Fase 3 (sessão própria, com monitoramento):** adicionar
> `VITE_DEVICE_PASSWORD` no Vercel (ativa o device-auth de verdade, mas RLS
> ainda off — sem efeito funcional ainda), confirmar nos logs que os 3
> tenants conseguem token, DEPOIS ligar RLS (`enable row level security`)
> — e só então o isolamento passa a valer. Lembrar de atualizar `admin.jsx`
> (usa anon key direto no painel `/admin`) antes de ligar RLS, senão o
> HealthView quebra (risco já mapeado abaixo).

---

## Por que fazer (o que isso mata)

Hoje temos 3 débitos de segurança acoplados:

1. **Anon key exposta** — a chave fica no bundle (por design do Supabase), mas
   com **RLS off** ela dá acesso de leitura/escrita a **todos os tenants**.
   Quem extrair a key do bundle lê/escreve dados de qualquer cliente.
2. **RLS off** — sem isolamento por tenant no banco. Um bug de `tenant_id` no
   client vaza dado entre clientes.
3. **PIN local** — auth é validada no frontend contra `data.js`/localStorage.
   Não há identidade real; qualquer um com o link + PIN entra.

O épico resolve os 3 de uma vez: identidade real (JWT) + isolamento no banco
(RLS por `tenant_id` no claim do JWT).

---

## Estado atual (o que já existe)

- `src/auth.jsx` — wrapper Supabase Auth **completo mas NÃO wired**:
  `signUp`, `signIn`, `signOut`, `resetPassword`, `refreshSession`,
  `inviteUser`, `isSessionValid`. Guarda `tenantId`/`role` em `user_metadata`.
- `LoginScreen` (`src/login.jsx`) já tem modo e-mail/senha (`mode==='email'`)
  que chama `signIn` via dynamic import — mas o default é PIN e o modo e-mail
  só aparece se `isSupabaseEnabled()`.
- Sync (`repository.js`) usa a anon key direto em `sbFetch` com RLS off.

---

## O NÓ do problema (leia antes de decidir)

**Colaboradores usam PIN num tablet compartilhado de cozinha.** Eles não vão
gerenciar e-mail/senha individual. PIN de 4 dígitos é a UX certa pra eles.

Mas RLS precisa de um JWT com claim de `tenant_id` pra autorizar a escrita.
Se o colaborador não tem JWT, a escrita dele usa a anon key — e RLS bloquearia.

**Então a pergunta central é: como autorizar as escritas dos colaboradores
(PIN) sob RLS?** As opções estão na Decisão #2 abaixo. Esse é o ponto que
trava ou destrava o épico inteiro.

---

## Decisões pra você aprovar

### Decisão #1 — Modelo de identidade

| Opção | Como | Prós | Contras |
|-------|------|------|---------|
| **A. Híbrido (recomendado)** | Admin/RT/Supervisor têm conta real (e-mail/senha + JWT). Colaboradores seguem PIN, mas a escrita deles é autorizada por um mecanismo de tenant (Decisão #2). | UX certa pra cada perfil. Migração incremental. RT (que assina pela rede) ganha identidade real pra auditoria. | Dois caminhos de auth pra manter. |
| **B. Todos com conta real** | Todo usuário, incluindo colaborador, faz login e-mail/senha. | Modelo único, RLS limpa. | Colaborador em tablet compartilhado não gerencia senha — quebra a operação real da cozinha. |
| **C. Anonymous sign-in** | Supabase Auth anônimo gera um JWT por device, com tenant no metadata. | Todo device tem JWT → RLS funciona uniformemente. | Identidade fraca (device, não pessoa); auditoria por pessoa fica no PIN ainda. |

**Recomendação: A (híbrido).** É o que respeita a operação real. RT e admin —
que são quem importa pra auditoria e gestão — ganham identidade forte. O PIN
do colaborador continua sendo o carimbo de "quem fez" no registro (campo
`user_name`), enquanto a autorização de escrita vem do tenant.

---

### Decisão #2 — Como autorizar a escrita do colaborador (PIN) sob RLS

Essa é a decisão técnica mais pesada. 3 caminhos:

| Opção | Como | Prós | Contras |
|-------|------|------|---------|
| **2A. Device token por tenant (recomendado p/ MVP)** | Cada tenant tem um JWT de longa duração (ou uma conta de serviço "device") com claim `tenant_id`. O device guarda esse token (vem no `?token=` ou no setup). Escritas usam esse JWT; RLS valida `tenant_id` do claim. | Implementação direta. RLS real por tenant. Não exige conta por colaborador. | Token compartilhado por tenant — se vazar de um device, expõe aquele tenant (não todos). Rotação precisa de processo. |
| **2B. Anonymous sign-in com metadata** | `POST /auth/v1/signup` anônimo no setup do device → JWT com `tenant_id` no metadata. | Nativo do Supabase. JWT por device. | Precisa habilitar anonymous auth; cada device vira um "usuário" (limpeza/limites). |
| **2C. Edge Function valida PIN** | Colaborador manda PIN → Edge Function valida server-side → escreve com service role (bypassa RLS com segurança). | PIN nunca confia no client; service role fica no servidor. | Precisa de Edge Functions (infra nova); latência por escrita; mais código. |

**Recomendação: 2A (device token por tenant) pro MVP**, com caminho pra 2C
depois se precisar de PIN server-side. 2A reaproveita o fluxo `?token=` que já
existe (o cliente abre o link e o device herda credenciais) — só trocaríamos a
anon key compartilhada por um JWT escopado no tenant.

> ⚠️ Em QUALQUER opção: `tenant_id` das escritas tem que vir do **claim do JWT**,
> não do payload do client. Hoje o client manda `tenant_id` no corpo — sob RLS
> isso vira a brecha. A policy precisa comparar o `tenant_id` da linha com o do
> token.

---

### Decisão #3 — Migração sem quebrar os 3 clientes

Não dá pra ligar RLS e quebrar Swiss/Bäckerei/DBK. Sequência proposta:

1. **Fase 0 (prep, sem risco):** criar as policies RLS **mas deixar RLS ainda
   off**. Escrever e testar as policies num tenant de staging.
2. **Fase 1 (auth opt-in):** wirar `auth.jsx` pro admin/RT — eles passam a logar
   com e-mail/senha. PIN continua funcionando em paralelo. Nada de RLS ainda.
3. **Fase 2 (token por tenant):** trocar a anon key compartilhada pelo
   device-token escopado (Decisão #2A) no fluxo de boot/`?token=`. Testar que
   sync continua funcionando com o novo token (o health-check `testWrite` que
   já existe vira a rede de segurança aqui).
4. **Fase 3 (ligar RLS):** tenant por tenant, habilitar RLS + policies.
   Monitorar o banner de 401 e o `testWrite` — se algo bloquear, o device avisa.
5. **Fase 4 (limpeza):** remover o `disable row level security` do
   `SUPABASE_SQL`, documentar as policies como o novo default.

> A regra do CLAUDE.md ("RLS está OFF — se ligar, reverter o disable do SQL e
> escrever policies `auth.uid()`") aponta exatamente pra Fase 3/4.

---

## Esboço das policies RLS (rascunho técnico)

Assumindo `tenant_id` como claim no JWT (`auth.jwt() ->> 'tenant_id'`):

```sql
-- Exemplo pra temperature_records (repetir pras 8 tabelas)
alter table temperature_records enable row level security;

-- Leitura: só linhas do próprio tenant
create policy temp_select on temperature_records
  for select using (tenant_id = auth.jwt() ->> 'tenant_id');

-- Escrita: só pode inserir linhas com o próprio tenant_id
create policy temp_insert on temperature_records
  for insert with check (tenant_id = auth.jwt() ->> 'tenant_id');

-- Update/delete: idem (RT validando, etc.)
create policy temp_update on temperature_records
  for update using (tenant_id = auth.jwt() ->> 'tenant_id');
```

Admin global (NutriOPS) precisa ver todos os tenants → role especial no JWT
(`role = 'super-admin'`) com policy adicional `using (true)` pra esse role, ou
acesso via service role no painel `/admin` (mais seguro — o /admin não usaria a
anon key).

---

## Riscos

- **Quebrar sync em produção** — mitigado pela migração faseada + health-check
  `testWrite` já existente + banner de 401. Ligar RLS tenant-por-tenant, não
  tudo de uma vez.
- **Admin `/admin` lê todos os tenants** — hoje usa anon key direto
  (`fetchSupabase` em admin.jsx). Sob RLS, precisa de role super-admin ou
  service role. **Não esquecer** — senão o HealthView/painel quebra.
- **`tenant_id` no payload vs. no claim** — a maior brecha conceitual. Tem que
  migrar a origem do `tenant_id` pro token.
- **Rotação de token (2A)** — definir processo antes de depender dele.

---

## Estimativa grosseira

- Fase 0–1: ~1 sessão (policies em staging + wire auth.jsx pro admin/RT)
- Fase 2: ~1 sessão (device-token + ajustar sbFetch/boot)
- Fase 3–4: ~1 sessão + janela de monitoramento por tenant

Total: ~3 sessões de trabalho + acompanhamento em produção. Não é um
"liga e pronto".

---

## Pergunta pra você (quando voltar)

1. Aprova o modelo **híbrido** (Decisão #1A)?
2. Topa **device-token por tenant** (Decisão #2A) como MVP, ou prefere já ir
   pra Edge Function (2C)?
3. Tem um projeto Supabase de **staging** pra testar as policies sem risco, ou
   crio um?

Com essas 3 respostas eu consigo começar a Fase 0 com segurança.

---

## RUNBOOK — Fase 3 (ligar RLS de verdade) · rascunho 01/07

> Escrito na sessão de 01/07 enquanto o deploy estava travado no limite do
> Vercel. **NÃO executar sem o dono presente + janela de monitoramento.** RLS
> mexe no acesso a dados de 3 clientes pagando. Rollback é 1 comando (ver fim).

### Pré-requisitos (antes de tocar em RLS)

1. **`VITE_DEVICE_PASSWORD` no Vercel** (Production) = a senha das 3 contas
   device. Sem isso, `getDeviceAccessToken` retorna null → tudo cai pra anon
   key → sob RLS, TUDO é bloqueado. Adicionar a env + redeploy é o passo que
   "liga" o device-auth (mas ainda sem efeito funcional enquanto RLS off).
2. **Confirmar nos logs** (F12 no device, com a env já no build) que os 3
   tenants pegam token: procurar `[device-auth] token obtido pro tenant swiss`
   (e backerei, dbk-producao). Se algum falhar → conta/senha/metadata errados.

### Revisão adversarial (01/07) — 22 agentes, 10 achados confirmados

Rodei uma revisão multi-agente do device-auth + Fase 2 antes de virar produção.
Resultado tranquilizador: **TODOS os 10 achados são "on-rls-enable"** — nenhum é
regressão do estado atual (RLS off + sem `VITE_DEVICE_PASSWORD` = zero mudança
hoje, confirmado por todos os reviewers). Já corrigido nesta sessão (efeito zero
hoje, robustez pra Fase 3):
- ✅ device-auth invalida o token no 401/403 (não fica preso ~1h) + desliga na
  hora se a senha sumir da env (`invalidateDeviceToken` + check de senha).
- ✅ `tenants` documentada no SUPABASE_SQL (RLS off proposital).

Nota extra da revisão: a cláusula de bypass do admin nas policies
(`role in Administrador/Super-admin`) hoje é **código morto** — nenhum caminho
de sync manda o JWT do admin (admin/RT sincronizam via device token do tenant).
Ou se remove a cláusula, ou se wira o JWT do admin no /admin (ver abaixo).

### Bloqueadores conhecidos — CORRIGIR ANTES de `enable row level security`

Estes usam anon key crua (sem JWT de tenant) e seriam BLOQUEADOS sob RLS:

- **`testWrite` / `testConnection` (repository.js):** o health-check insere/lê
  `temperature_records` (tenant_id `__healthcheck__`) com anon key. Sob RLS →
  bloqueado → banner de auth_error/rls_blocked em TODO boot, mesmo com writes
  reais (device token) funcionando. **Falso alarme assustador.**
  Fix: ou usar um device token no testWrite, ou pular o testWrite quando RLS
  estiver on, ou dar exceção de policy pro tenant `__healthcheck__`.
- **`admin.jsx` HealthView (linha ~1040):** `fetchSupabase('temperature_records',
  'limit=5000')` lê TODOS os tenants com anon key, sem filtro. Sob RLS → 0 linhas
  → painel /admin vazio. Fix: usar o JWT do admin logado (auth.jsx, role
  Administrador → bypass na policy) no lugar da anon key, com fallback.
- **Conferir a tabela `tenants`** (tenant-sync.js): NÃO está nas 8 policies e
  segue com `disable row level security` (CLAUDE.md). Confirmar que continua off
  (o boot faz `fetchTenantByToken` com anon key). Se um dia ligar RLS nela,
  quebra o fluxo `?token=`.

### Sequência de rollout (tenant por tenant)

1. Corrigir os bloqueadores acima + deploy + verificar device tokens nos logs.
2. Rodar o SQL das policies (já está em SUPABASE_SQL) — idempotente.
3. **Ligar RLS numa tabela de UM tenant primeiro?** Não dá granularidade por
   tenant no `enable row level security` (é por tabela, afeta todos os tenants
   daquela tabela). Então: ligar RLS **numa tabela só** primeiro (ex.:
   `special_controls`, a de menor volume/risco), monitorar 24h, e só então as
   outras 7. Assim o raio de explosão de um erro de policy é 1 tabela, não 8.
   Comando: `alter table special_controls enable row level security;`
4. Monitorar: banner de 401/rls_blocked na app + `testWrite` (já corrigido) +
   contagem de linhas subindo normal (SQL de conferência).
5. Repetir tabela por tabela até as 8.
6. Fase 4: atualizar o SUPABASE_SQL trocando os `disable` por `enable` como
   novo default, atualizar a regra do CLAUDE.md ("RLS está OFF").

### Rollback imediato (se algo travar)

```sql
-- por tabela, na hora:
alter table <tabela> disable row level security;
```
Volta ao estado atual (anon key acessa tudo) instantaneamente. O device-auth
continua tentando o JWT mas cai pra anon key — sem quebra.

### Risco residual aceito (senha compartilhada)

As 3 contas device usam a MESMA senha (escolha do dono). Como o e-mail de cada
uma é derivável do tenant_id (público no bundle), se essa senha vazar, expõe as
3 lojas. Mitigação futura (sem mudar código): trocar por senhas distintas e
adicionar `VITE_DEVICE_PASSWORD_SWISS` / `_BACKEREI` / `_DBK_PRODUCAO` no Vercel
— device-auth.js já lê a env específica por tenant com fallback pra compartilhada.

---

## Revisão adversarial do Super Admin (02/07) — o que ficou pendente

Revisão multi-agente (29 agentes) do épico Super Admin. Corrigidos na hora
(v1.9.24): logout limpa impersonation.origin + auth.session + flag MFA; flag
2FA por-usuário; refresh de token no gate (evita lockout 401); limpa fator TOTP
órfão antes de re-enroll; erro amigável quando MFA está off no projeto.

**Fica pro épico Auth+RLS (NÃO resolvido — é limitação de arquitetura):**
- 🔴 **O gate do Super Admin é client-side e forjável.** `isGlobalAdmin` lê o
  `nutriops.session` (blob não-assinado do localStorage) e a flag de 2FA é um
  booleano em sessionStorage — ambos setáveis no devtools. Com RLS OFF, a anon
  key lê/escreve qualquer tenant. Ou seja: o Super Admin NÃO é fronteira de
  segurança hoje; é conveniência de UI. A proteção real precisa de:
  role/AAL2 no JWT + RLS server-side (as policies já estão escritas, seção 8).
- 🟠 **Suspensão/plano não são enforced server-side.** `active` vive só no
  localStorage do admin; o `tenants` do Supabase nem tem coluna `active`. Um
  device que hidrata via `?token=` não vê a suspensão. Fix real: coluna
  `active` no `tenants` + push no toggle + gate no boot (main.jsx) — self-contido,
  dá pra fazer sem RLS, mas fica no bojo do épico.
- 🟠 **2FA TOFU:** o gate auto-enrolla um fator na 1ª vez, então quem tem a
  senha do admin binda o próprio autenticador. Mitigar com enroll out-of-band
  (provisionar o fator na criação da conta), quando o épico endurecer o admin.
