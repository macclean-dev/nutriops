# NutriOPS — receitas operacionais

Procedimentos de campo. Não precisam de dev.

---

## Validar/destravar device de loja que não sincroniza

Quando um device de loja estiver com dados só locais:

1. No device: feche o app por completo (ou Cmd+Shift+R no navegador)
2. Reabra `nutriops.uniwares.net` → aparece o toast **"Nova versão disponível"**
   → **Atualizar agora**
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

---

## Ativar o CI do GitHub Actions

O workflow `.github/workflows/ci.yml` (`npm test` + `npm run build`) está
versionado localmente mas **não foi pushado** — o PAT atual não tem scope
`workflow`. Pra ativar:

1. GitHub → Settings → Developer settings → Personal access tokens
2. Edita o token usado nesse repo
3. Marca o scope `workflow`
4. Salva, depois:

   ```bash
   git add .github/workflows/ci.yml && git commit -m "ci: build + test em push/PR" && git push
   ```

A partir daí, todo PR e push pra `main` roda build + testes automaticamente.

---

## Rotacionar a senha dos device-tokens

Não exige deploy de código:

1. Supabase → Authentication → Users → trocar a senha das 3 contas
   `device-{tenantId}@nutriops.internal`
2. Vercel → Settings → Environment Variables → atualizar `VITE_DEVICE_PASSWORD`
   (ou as `VITE_DEVICE_PASSWORD_{TENANT}` por loja)
3. Redeploy

⚠️ Isso é paliativo — qualquer segredo usado por app client-side é público. Ver
a pendência de segurança aberta no `CLAUDE.md`.

---

## Testar etiqueta de validade na Zebra real (ZD220/GC420)

Mecanismo: `window.print()` puro com CSS `@page{size:60mm 60mm}`
(`printLabel`/`generateLabel` em `src/validity.jsx`) — mesmo padrão que já
funciona pros PDFs de BPF, mas nunca foi confirmado nessa impressora física.
Rolo confirmado 60×60mm, impressora Ethernet com driver padrão de Windows.

1. **No computador/notebook da rede da loja** (caminho com maior chance de
   funcionar de cara):
   - NutriOPS → **Validades e Estoque** → aba **Produtos**
   - Em qualquer produto, clicar no botão **🏷️** ("Reimprimir etiqueta") — não
     precisa clicar em "Abrir": reimprime sem criar abertura nova no histórico
   - Abre aba nova com a etiqueta e chama a caixa de impressão sozinha depois
     de ~400ms → selecionar a Zebra na lista do sistema operacional
2. **Conferir na etiqueta impressa:**
   - Tamanho bateu com o rolo físico (60×60mm), sem cortar borda
   - QR legível — testar escaneando em **Validades e Estoque → Escanear
     etiqueta**, dentro do próprio app
   - Nome do produto, VAL. ORIGINAL, RESP. e rodapé da empresa corretos
3. **Repetir no tablet Android** — é o ponto incerto. A Zebra em rede fala
   ZPL/EPL nativamente; o tablet precisa do app **"Zebra Print Service
   Plugin"** instalado pra aparecer como impressora do sistema pro
   `window.print()` do navegador enxergar. Sem o plugin, o tablet
   provavelmente nem lista a impressora.

Se travar no passo 3: plano B é imprimir sempre pelo computador da loja (já
resolve o caso de uso original — produção corrida, mas com etiqueta rápida de
tirar do PC) e reavaliar depois se vale investir num caminho pro tablet.
