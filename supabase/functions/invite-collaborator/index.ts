// ─────────────────────────────────────────────────────────────────────────────
// invite-collaborator — o "pedacinho de servidor" do NutriOPS.
//
// POR QUE existe: criar conta de auth com senha inicial exige a service_role
// (chave-mestra). Numa SPA estática ela não pode existir (iria pro bundle
// público). Aqui ela vive no lado do Supabase (env SUPABASE_SERVICE_ROLE_KEY,
// injetada automaticamente) — o navegador nunca a vê. É o equivalente ao que o
// servidor do Nexum faz.
//
// FLUXO:
//   1. Recebe o JWT do dono da loja (tenant_admin) + {email, senha, papel, tenantId}.
//   2. AUTORIZA: confirma que quem chamou é tenant_admin DAQUELA loja (ou admin
//      global) — senão 403. Um dono não cria gente em loja que não é dele.
//   3. Cria a conta com a senha inicial (email_confirm=true → já pode logar).
//   4. Vincula em tenant_members com o papel escolhido.
//
// Segurança: papel restrito a um allowlist (não dá pra criar admin GLOBAL nem
// tenant_admin de outra loja); service_role só no servidor.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Papéis que um dono de loja pode atribuir. 'admin' (global) NUNCA entra aqui.
const ALLOWED_ROLES = ['Colaborador', 'Supervisor', 'Nutricionista RT', 'tenant_admin'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'não autenticado' }, 401);

    // 1) Identidade do chamador — validada pelo próprio Supabase Auth via o JWT.
    const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: uErr } = await asCaller.auth.getUser();
    if (uErr || !caller) return json({ error: 'sessão inválida' }, 401);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const name = String(body.name ?? '').trim();
    const role = String(body.role ?? 'Colaborador');
    const tenantId = String(body.tenantId ?? '').trim();

    if (!email || !tenantId) return json({ error: 'e-mail e empresa são obrigatórios' }, 400);
    if (!ALLOWED_ROLES.includes(role)) return json({ error: 'papel inválido' }, 400);
    if (password.length < 8) return json({ error: 'a senha inicial precisa de no mínimo 8 caracteres' }, 400);

    const admin = createClient(url, serviceKey);

    // 2) AUTORIZAÇÃO — o chamador tem que ser tenant_admin DESTA loja (ou admin global).
    const { data: membership } = await admin
      .from('tenant_members').select('role')
      .eq('user_id', caller.id).eq('tenant_id', tenantId).maybeSingle();
    const isGlobalAdmin = (caller.app_metadata as Record<string, unknown> | null)?.role === 'admin';
    if (membership?.role !== 'tenant_admin' && !isGlobalAdmin) {
      return json({ error: 'você não administra esta empresa' }, 403);
    }

    // 3) Cria a conta com a senha inicial (já confirmada → loga na hora).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (cErr || !created?.user) {
      const msg = String(cErr?.message ?? '');
      if (/already|exist|registered/i.test(msg)) {
        return json({ error: 'Já existe uma conta com esse e-mail. Peça a um administrador para vinculá-la a esta empresa.' }, 409);
      }
      return json({ error: msg || 'erro ao criar conta' }, 400);
    }

    // 4) Vincula à empresa com o papel escolhido.
    const { error: mErr } = await admin.from('tenant_members').upsert(
      { user_id: created.user.id, tenant_id: tenantId, role },
      { onConflict: 'user_id,tenant_id' },
    );
    if (mErr) {
      // Rollback: sem vínculo, a conta órfã não serve — remove pra não deixar lixo.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      return json({ error: 'conta criada mas falhou ao vincular: ' + mErr.message }, 500);
    }

    return json({ ok: true, user_id: created.user.id, email, role });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
