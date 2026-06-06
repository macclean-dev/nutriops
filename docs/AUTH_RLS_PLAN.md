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

> **Ordem atual (05/06):** o épico Auth+RLS fica **pausado** — prioridade é
> fechar a migração da **Swiss** (91 registros) quando houver acesso ao device.
> Retomar daqui depois disso.

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
