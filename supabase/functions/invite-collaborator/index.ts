// ─────────────────────────────────────────────────────────────────────────────
// invite-collaborator — o "pedacinho de servidor" do NutriOPS.
//
// POR QUE existe: criar conta de auth com senha inicial (ou redefinir a senha
// de uma já existente) exige a service_role (chave-mestra). Numa SPA estática
// ela não pode existir (iria pro bundle público). Aqui ela vive no lado do
// Supabase (env SUPABASE_SERVICE_ROLE_KEY, injetada automaticamente) — o
// navegador nunca a vê. É o equivalente ao que o servidor do Nexum faz.
//
// Duas ações, body.action (default 'invite' — compat com quem já chamava sem o
// campo):
//   'invite'         — cria conta nova com senha inicial + vincula em tenant_members.
//   'reset_password' — redefine a senha de um membro JÁ vinculado a essa loja
//                      (ex.: dono esqueceu a senha que definiu no convite).
//
// AUTORIZAÇÃO (10/08 — pedido da RT da CASA DOCE, que via o botão convidar no
// app mas tomava 403 aqui: o app já achava que RT podia, o servidor não sabia):
//   'invite'         — dono da loja (tenant_admin), Nutricionista RT, ou admin
//                      global. RT não pode atribuir papel 'tenant_admin' (não
//                      cria outro dono) nem criar conta de loja (isStoreAccount).
//   'reset_password' — só dono da loja ou admin global (poder sensível demais
//                      pra dar pra RT: troca a senha de QUALQUER membro).
//
// FLUXO: 1) valida o JWT de quem chamou (Supabase Auth). 2) autoriza conforme
// acima. 3) 'invite' cria a conta (email_confirm=true → já pode logar) +
// vincula; 'reset_password' confere que o ALVO pertence a essa loja (evita
// reset cross-tenant por um chamador mal-intencionado) e troca a senha.
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
    const action = String(body.action ?? 'invite');
    const tenantId = String(body.tenantId ?? '').trim();
    const password = String(body.password ?? '');
    if (!tenantId) return json({ error: 'empresa é obrigatória' }, 400);

    const admin = createClient(url, serviceKey);

    // 2) AUTORIZAÇÃO — quem pode chamar isto.
    const { data: membership } = await admin
      .from('tenant_members').select('role')
      .eq('user_id', caller.id).eq('tenant_id', tenantId).maybeSingle();
    const isGlobalAdmin = (caller.app_metadata as Record<string, unknown> | null)?.role === 'admin';
    const isOwner = membership?.role === 'tenant_admin';
    // A Nutricionista RT também administra a equipe da própria loja (convida
    // colaboradores) — pedido da RT da CASA DOCE (10/08), que via o botão no
    // app mas tomava 403 aqui. Ela NÃO pode redefinir senha de terceiros nem
    // criar outro dono da loja (checagens abaixo) — só o dono/admin global.
    const isRT = membership?.role === 'Nutricionista RT';

    if (action === 'reset_password') {
      // Redefinir a senha de qualquer membro é poder sensível demais pra dar
      // pra RT — fica só com quem já podia antes (dono da loja/admin global).
      if (!isOwner && !isGlobalAdmin) {
        return json({ error: 'você não administra esta empresa' }, 403);
      }
      const userId = String(body.userId ?? '').trim();
      if (!userId) return json({ error: 'usuário é obrigatório' }, 400);
      if (password.length < 8) return json({ error: 'a senha precisa de no mínimo 8 caracteres' }, 400);

      // Confere que o ALVO pertence a esta loja — sem isso, um tenant_admin
      // poderia redefinir a senha de QUALQUER usuário da instância só
      // informando um userId arbitrário junto com a própria loja.
      //
      // Busca TODAS as empresas do alvo, não só esta: a contagem é o que fecha
      // a brecha multi-unidade logo abaixo.
      const { data: alvoVinculos } = await admin
        .from('tenant_members').select('tenant_id, role').eq('user_id', userId);
      const targetMembership = (alvoVinculos ?? []).find((m) => m.tenant_id === tenantId);
      if (!targetMembership) return json({ error: 'esse usuário não pertence a esta empresa' }, 404);

      // ── TAKEOVER ENTRE UNIDADES (achado da revisão de 21/08) ──────────────
      // A senha no Supabase Auth é GLOBAL à conta, não por empresa. Com
      // multi-unidade, a dona e a RT são o MESMO auth.users vinculado a N
      // empresas.
      //
      // Sem esta checagem: um tenant_admin da unidade A (ex.: gerente local)
      // reseta a senha da dona — que também é membro de A — pra uma senha que
      // ele escolhe. Ele entra como ela, e a sessão dela escopa pra TODAS as
      // memberTenants. Ele alcança a unidade B, onde nunca teve papel algum.
      // A→B, sem tocar em nada de B.
      //
      // Regra: dono de loja só reseta quem pertence EXCLUSIVAMENTE à loja
      // dele. Conta que cobre mais de uma empresa é assunto do admin da
      // plataforma — que é quem tem visão das duas pontas.
      const empresasDoAlvo = (alvoVinculos ?? []).length;
      if (empresasDoAlvo > 1 && !isGlobalAdmin) {
        return json({
          error: 'Essa pessoa também responde por outra empresa, e a senha é a mesma nas duas. '
               + 'Redefinir daqui daria acesso às outras unidades dela. Peça ao administrador da plataforma.',
        }, 403);
      }

      const { error: pErr } = await admin.auth.admin.updateUserById(userId, { password });
      if (pErr) return json({ error: pErr.message || 'erro ao redefinir senha' }, 400);

      return json({ ok: true, user_id: userId });
    }

    // ── action === 'invite' (default) ──────────────────────────────────────
    if (!isOwner && !isRT && !isGlobalAdmin) {
      return json({ error: 'você não administra esta empresa' }, 403);
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim();
    const role = String(body.role ?? 'Colaborador');
    // Conta GENÉRICA de loja (Fase 4 — operador por registro): não é uma
    // pessoa, é o login compartilhado do aparelho do balcão. buildSession
    // (src/auth.jsx) lê este carimbo do user_metadata e é ele que liga a tela
    // "Quem está registrando?" — sem isto a conta loga normal e nunca pede
    // operador, silenciosamente. Decisão estrutural: só admin da PLATAFORMA cria.
    const isStoreAccount = body.isStoreAccount === true;
    if (isStoreAccount && !isGlobalAdmin) {
      return json({ error: 'só o admin da plataforma cria conta de loja' }, 403);
    }

    if (!email) return json({ error: 'e-mail é obrigatório' }, 400);
    if (!ALLOWED_ROLES.includes(role)) return json({ error: 'papel inválido' }, 400);
    // RT convida a própria equipe, mas não cria outro dono da loja.
    if (isRT && !isOwner && !isGlobalAdmin && role === 'tenant_admin') {
      return json({ error: 'só o administrador da loja pode atribuir este papel' }, 403);
    }
    if (password.length < 8) return json({ error: 'a senha inicial precisa de no mínimo 8 caracteres' }, 400);

    // 3) Cria a conta com a senha inicial (já confirmada → loga na hora).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name, isStoreAccount },
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
