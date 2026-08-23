# Revisão adversarial de segurança — 21/08/2026

Revisão das 12 superfícies de autorização do projeto: RLS de 4 caminhos, gating
por `app_metadata`, as RPCs `security definer` e a Edge Function.

**Nenhum vazamento direto de dado de tenant alheio pela anon key.** O modelo
está bem construído e visivelmente cicatrizado por incidentes reais. Os achados
abaixo são de superfície e armadilha, não de brecha ativa.

---

## 🔴 ALTA — armadilha versionada na `upsert_tenant` · **CORRIGIDO (v1.9.213)**

`docs/security-tenants-lockdown.sql` era a **única** definição versionada da
`upsert_tenant`, e criava a função **sem o portão de admin** (o gate existia só
como comentário), seguida de `grant execute ... to anon, authenticated`. O
cabeçalho dizia *"IDEMPOTENTE: pode rodar de novo à vontade"*.

O portão real foi aplicado **à mão em produção em 23/07** (ver `HISTORICO.md`) e
nunca virou arquivo.

**Consequência:** seguir a instrução do próprio repositório reabriria em
silêncio a escrita não-autenticada — qualquer um com a chave pública do bundle
voltaria a criar e **sobrescrever** empresa, girando `access_token` e
`setup_pin_hash` de qualquer loja. Takeover, não bloqueio.

Mesma classe do incidente de 16/08 (arquivo re-runnable com `drop`+`create` que
vence em silêncio), com impacto pior.

**Correção:** `docs/upsert-tenant-gated.sql` passa a ser a fonte de verdade
runnable, com o portão dentro da função, `revoke` de anon e teste de aceitação
em empresa descartável. O bloco no lockdown foi neutralizado (⛔ + comentado) e
a promessa de idempotência saiu do cabeçalho. Travado em
`src/upsert-tenant-portao.test.js`.

---

## 🟡 MÉDIA — `reset_password` permitia takeover cross-tenant · **CORRIGIDO (v1.9.214)**

`supabase/functions/invite-collaborator/index.ts`

O gate confere que o alvo pertence à loja de quem chama — bom, evita reset de
`userId` arbitrário. Mas **a senha no Supabase Auth é global à conta, não por
tenant**. Com multi-unidade, a dona e a RT são o MESMO `auth.users` vinculado a
N empresas.

Cenário: um `tenant_admin` da unidade A (ex.: gerente local) reseta a senha da
conta da dona, que também é membro de A → define a senha que quiser → **login
completo como ela**, cuja sessão escopa para todas as `memberTenants`,
incluindo a unidade B onde ele nunca teve papel.

Ficou mais relevante agora que o multi-unidade entrou em uso real (21/08).

**Correção:** a Edge Function agora busca TODAS as empresas do alvo e recusa
quando ele responde por mais de uma — nesse caso só o admin da plataforma
reseta. A recusa explica o motivo, porque quem toma o 403 é o dono da loja
tentando ajudar a própria RT.

*Bom, para registro:* o admin da plataforma nunca é alvo elegível —
`link_existing_member` veta vinculá-lo a loja, e `isGlobalAdmin` exige
membership vazio.

---

## 🟡 MÉDIA — `__healthcheck__` era canal de escrita aberto · **CORRIGIDO (v1.9.214)**

`docs/rls-policies.sql` (aplicado às 20 tabelas)

A policy libera `tenant_id = '__healthcheck__'` incondicionalmente. Qualquer
conta autenticada — **inclusive sem nenhum vínculo** — pode INSERT/SELECT/DELETE
linhas marcadas assim em todas as 20 tabelas de evidência.

Não vaza dado real (as telas filtram por `tenant_id` de verdade), mas dá:

- **poluição de armazenamento**: escrita ilimitada de linhas arbitrárias;
- **interferência no healthcheck alheio**: `testWrite` faz
  `DELETE ?tenant_id=eq.__healthcheck__`, então qualquer autenticado apaga a
  linha de sonda de qualquer outro — falso negativo no boot de outra loja.

**Correção:** o caminho saiu das outras 19 tabelas (a sonda só escreve em
`temperature_records`) e, na que resta, exige `user_name = auth.uid()::text` —
a linha de sonda passou a ter dono. O `testWrite` carimba o uid e o DELETE
filtra por ele, então ninguém apaga a sonda alheia. Espelhado no `SUPABASE_SQL`
que a tela de Configurações exibe, e travado em `src/revisao-seguranca-fixes.test.js`.

---

## 🟢 BAIXA

- **`link_existing_member` lê `user_metadata`** (`isStoreAccount`). É um VETO,
  não um grant — mas `user_metadata` é forjável via `updateUser`, então um
  detentor de conta de loja poderia remover o próprio carimbo pra conseguir ser
  vinculado. Única leitura de `user_metadata` num gate entre as RPCs; as demais
  usam `app_metadata` / `is_admin_plataforma()` corretamente.

- **Oráculo de enumeração de e-mail**: `link_existing_member` distingue "não
  existe conta com esse e-mail" de sucesso. Um dono de loja ou RT consegue
  sondar quais e-mails existem na plataforma inteira. Requer já ser admin de
  loja.

- **TOCTOU em `delete_tenant`**: contagem de evidência e delete rodam em
  snapshots separados. Mas o delete **nunca apaga evidência** — o pior caso é
  evidência órfã, não perda de registro. Só o admin da plataforma dispara.

---

## Conferido e OK

- `format('%I', ...)` nos loops usa arrays hardcoded, tabelas qualificadas com
  `public.` → sem injeção. Todas as funções revisadas com `search_path = ''`.
- O rollback de conta órfã do `invite-collaborator` só apaga o usuário
  recém-criado por id — não é abusável.
- `list_tenant_members` / `contar_registros_tenant` / `get_member_tenants` nunca
  devolvem hash ou senha, e barram não-membros.
- `tenant_members` só tem policy `self_read`, sem insert — conta autenticada sem
  vínculo **não consegue se auto-vincular**.
