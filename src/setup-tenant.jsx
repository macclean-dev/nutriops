import React, { useEffect, useRef, useState } from 'react';
import { BrandLockup, APP_VERSION } from './brand';
import { verifyPin, hashPin } from './crypto';
import { isWeakPin, writePinOverride } from './pin';
import { writeOnboardingTenants } from './onboarding-storage';
import {
  fetchTenantByToken,
  bumpSetupAttempts,
  markSetupConsumed,
} from './tenant-sync';

// Tela do 1º acesso de cliente criado via /admin.
// Fluxo:
//   1. Cliente abre nutriops.uniwares.net?token=ABC
//   2. main.jsx já populou nutriops.onboarding.tenants (de Supabase)
//   3. Renderizamos essa tela: pede setup PIN → cria PIN definitivo
//   4. Salva admin owner no tenant local + marca setup como consumido no cloud

const RATE_LIMIT_KEY = (tenantId) => `nutriops.setup.attempts.${tenantId}`;
const MAX_ATTEMPTS = 3;
const LOCK_MINUTES = 15;

function readLocalAttempts(tenantId) {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY(tenantId));
    return raw ? JSON.parse(raw) : { count: 0, lockedUntil: null };
  } catch {
    return { count: 0, lockedUntil: null };
  }
}

function writeLocalAttempts(tenantId, state) {
  try { localStorage.setItem(RATE_LIMIT_KEY(tenantId), JSON.stringify(state)); } catch {}
}

function clearLocalAttempts(tenantId) {
  try { localStorage.removeItem(RATE_LIMIT_KEY(tenantId)); } catch {}
}

function fmtCountdown(lockedUntil) {
  if (!lockedUntil) return null;
  const ms = new Date(lockedUntil).getTime() - Date.now();
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  if (min > 0) return `${min}min ${sec}s`;
  return `${sec}s`;
}

export function SetupPinScreen({ tenant, onComplete }) {
  const [stage, setStage] = useState('setup-pin'); // setup-pin | create-pin | done
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [lockedUntil, setLockedUntil] = useState(() => {
    const remote = tenant.setupPinLockedUntil;
    const local = readLocalAttempts(tenant.id).lockedUntil;
    const remoteMs = remote ? new Date(remote).getTime() : 0;
    const localMs  = local  ? new Date(local).getTime()  : 0;
    const max = Math.max(remoteMs, localMs);
    return max > Date.now() ? new Date(max).toISOString() : null;
  });
  const [, tick] = useState(0);
  const pinRef = useRef(null);

  // Tick a cada segundo enquanto bloqueado pra atualizar countdown
  useEffect(() => {
    if (!lockedUntil) return undefined;
    const id = setInterval(() => {
      if (new Date(lockedUntil).getTime() <= Date.now()) {
        setLockedUntil(null);
        clearLocalAttempts(tenant.id);
      } else {
        tick(t => t + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntil, tenant.id]);

  // Foco automático no input
  useEffect(() => { pinRef.current?.focus(); }, [stage]);

  // Caso o setup já tenha sido consumido (cliente entrou de outro device antes)
  if (tenant.setupPinUsedAt) {
    return (
      <SetupErrorScreen
        title="Conta já configurada"
        message="Esta conta já foi ativada em outro dispositivo. Faça login com o PIN definitivo que você criou."
        actionLabel="Ir para login"
        onAction={() => {
          // Remove o token pra cair na tela de login normal
          localStorage.removeItem('nutriops.access.token');
          localStorage.removeItem('nutriops.access.clientId');
          localStorage.removeItem('nutriops.access.clientName');
          window.location.href = '/';
        }}
      />
    );
  }

  const handleSetupPin = async () => {
    setError('');
    if (lockedUntil) {
      setError(`Bloqueado por ${fmtCountdown(lockedUntil)}`);
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('Digite os 4 dígitos do PIN de configuração.');
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyPin(pin, tenant.id, tenant.setupPinHash);
      if (!ok) {
        // Incrementa local + remoto. Usa o pior (mais restritivo) dos dois.
        const localState = readLocalAttempts(tenant.id);
        const nextLocal = localState.count + 1;
        let nextLockedLocal = localState.lockedUntil;
        if (nextLocal >= MAX_ATTEMPTS) {
          nextLockedLocal = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
        }
        writeLocalAttempts(tenant.id, { count: nextLocal, lockedUntil: nextLockedLocal });

        const remote = await bumpSetupAttempts(tenant.id, { maxBeforeLock: MAX_ATTEMPTS, lockMinutes: LOCK_MINUTES });
        const remoteLocked = remote?.lockedUntil ?? null;

        const finalLocked = [nextLockedLocal, remoteLocked]
          .filter(Boolean)
          .map(d => new Date(d).getTime())
          .reduce((a, b) => Math.max(a, b), 0);

        if (finalLocked > Date.now()) {
          setLockedUntil(new Date(finalLocked).toISOString());
          setError(`Muitas tentativas. Bloqueado por ${LOCK_MINUTES} minutos.`);
        } else {
          const left = MAX_ATTEMPTS - nextLocal;
          setError(`PIN incorreto. ${left > 0 ? `Restam ${left} tentativa(s).` : 'Próxima tentativa errada bloqueia o acesso.'}`);
        }
        setPin('');
        pinRef.current?.focus();
        return;
      }
      // Acertou! Limpa contadores e avança pra criação do PIN definitivo
      clearLocalAttempts(tenant.id);
      setStage('create-pin');
      setPin('');
    } catch (e) {
      setError(`Erro ao validar: ${e.message ?? 'desconhecido'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePin = async () => {
    setError('');
    if (!adminName.trim() || adminName.trim().length < 2) {
      setError('Informe seu nome.');
      return;
    }
    if (!/^\d{4,6}$/.test(newPin)) {
      setError('PIN deve ter 4 a 6 dígitos.');
      return;
    }
    if (isWeakPin(newPin)) {
      setError('PIN muito fácil. Evite sequências como 0000, 1234, 1111.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('Os PINs não coincidem.');
      return;
    }
    setBusy(true);
    try {
      const ownerName = adminName.trim();
      const adminUser = {
        name: ownerName,
        role: 'Administrador',
        status: 'Ativo',
        location: tenant.name,
        storeId: tenant.stores?.[0]?.id ?? null,
        pin: newPin, // só pro shape dos seeds — override é o que vale
      };

      // Salva tenant operacional local com o admin owner
      const updatedTenant = {
        ...tenant,
        usersList: [adminUser],
      };
      writeOnboardingTenants([updatedTenant]);

      // PIN override (formato canônico do app — `pin.js` lê dele primeiro)
      writePinOverride(tenant.id, ownerName, newPin);

      // Cria sessão
      const session = {
        tenantId: tenant.id,
        user: {
          id: `${tenant.id}-${ownerName}`,
          name: ownerName,
          role: 'Administrador',
          location: tenant.name,
          storeId: adminUser.storeId,
        },
      };
      localStorage.setItem('nutriops.session', JSON.stringify(session));

      // Marca setup como consumido no Supabase (não bloqueante)
      markSetupConsumed(tenant.id).catch(() => {});

      // Limpa o token de acesso — não precisa mais (sessão local cuida)
      localStorage.removeItem('nutriops.access.token');

      setStage('done');
      onComplete?.(session, updatedTenant);
    } catch (e) {
      setError(`Erro ao criar PIN: ${e.message ?? 'desconhecido'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg, #faf9f5)', padding: 24 }}>
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--surface, white)',
        border: '1px solid var(--border, #d9d1c4)',
        borderRadius: 20,
        padding: '36px 40px',
        boxShadow: '0 8px 32px rgba(20,20,19,.08)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <BrandLockup size="sm" idPrefix="setup" showSub={false} />
          <span style={{ fontSize: 9, color: 'var(--text-secondary, #6b6760)', letterSpacing: '.14em', textTransform: 'uppercase' }}>
            v{APP_VERSION}
          </span>
        </div>

        {/* Identidade do tenant — confirma que o link bate com o estabelecimento */}
        <div style={{
          padding: '14px 16px', marginBottom: 24,
          borderRadius: 12,
          background: tenant.brandSoft ?? 'rgba(204,120,92,.10)',
          borderLeft: `3px solid ${tenant.brandColor ?? '#cc785c'}`,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-secondary, #6b6760)' }}>
            {tenant.segment || 'Estabelecimento'}
          </div>
          <div style={{ fontFamily: 'var(--serif, "Instrument Serif", serif)', fontSize: 22, color: 'var(--text, #141413)', letterSpacing: '-.02em', marginTop: 2 }}>
            {tenant.name}
          </div>
        </div>

        {stage === 'setup-pin' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text, #141413)', margin: '0 0 6px', letterSpacing: '-.02em' }}>
              Insira o PIN de configuração
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary, #6b6760)', margin: '0 0 20px', lineHeight: 1.5 }}>
              A equipe NutriOPS enviou um PIN de 4 dígitos por canal separado
              (WhatsApp, SMS ou ligação). Digite abaixo pra ativar sua conta.
            </p>

            <input
              ref={pinRef}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') handleSetupPin(); }}
              disabled={Boolean(lockedUntil) || busy}
              placeholder="••••"
              style={{
                width: '100%', padding: '14px',
                fontSize: 28, letterSpacing: '0.5em', textAlign: 'center',
                fontFamily: 'var(--mono, monospace)',
                background: 'var(--bg, #faf9f5)',
                border: '1px solid var(--border, #d9d1c4)',
                borderRadius: 12,
                outline: 'none',
                opacity: lockedUntil ? 0.5 : 1,
                boxSizing: 'border-box',
              }}
            />

            {lockedUntil && (
              <div style={{
                marginTop: 14, padding: '10px 14px',
                background: '#fdecea', border: '1px solid #c0392b33',
                borderRadius: 10, fontSize: 13, color: '#c0392b', fontWeight: 600,
              }}>
                Acesso bloqueado por {fmtCountdown(lockedUntil) ?? 'instantes'}. Aguarde antes de tentar novamente.
              </div>
            )}

            {error && !lockedUntil && (
              <div style={{
                marginTop: 14, padding: '10px 14px',
                background: '#fdecea', border: '1px solid #c0392b33',
                borderRadius: 10, fontSize: 13, color: '#c0392b', fontWeight: 500,
              }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSetupPin}
              disabled={busy || Boolean(lockedUntil) || pin.length !== 4}
              style={{
                width: '100%', marginTop: 18, padding: '12px',
                background: (busy || lockedUntil || pin.length !== 4) ? '#d9d1c4' : 'var(--primary, #cc785c)',
                color: 'white', border: 'none', borderRadius: 10,
                fontSize: 15, fontWeight: 700,
                cursor: (busy || lockedUntil || pin.length !== 4) ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font, inherit)',
              }}
            >
              {busy ? 'Validando…' : 'Continuar'}
            </button>

            <div style={{ marginTop: 18, fontSize: 12, color: 'var(--text-secondary, #6b6760)', textAlign: 'center' }}>
              Não recebeu o PIN? <a href="mailto:contato@nutriops.com.br?subject=PIN de configuração NutriOPS" style={{ color: 'var(--primary, #cc785c)', fontWeight: 600 }}>Fale com a equipe</a>
            </div>
          </div>
        )}

        {stage === 'create-pin' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text, #141413)', margin: '0 0 6px', letterSpacing: '-.02em' }}>
              Crie seu PIN definitivo
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary, #6b6760)', margin: '0 0 20px', lineHeight: 1.5 }}>
              Esse PIN passa a ser sua senha de acesso. Escolha 4 a 6 dígitos
              fáceis de lembrar mas difíceis de adivinhar.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #6b6760)' }}>
                Seu nome
                <input
                  ref={pinRef}
                  value={adminName}
                  onChange={e => setAdminName(e.target.value)}
                  placeholder="Nome completo"
                  style={{
                    padding: '10px 12px', borderRadius: 8,
                    border: '1px solid var(--border, #d9d1c4)',
                    background: 'var(--surface, white)', fontSize: 14, fontFamily: 'var(--font, inherit)',
                    outline: 'none',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #6b6760)' }}>
                PIN (4 a 6 dígitos)
                <input
                  type="password" inputMode="numeric" maxLength={6}
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  style={{
                    padding: '12px', borderRadius: 8,
                    border: '1px solid var(--border, #d9d1c4)',
                    background: 'var(--surface, white)',
                    fontSize: 22, letterSpacing: '0.3em', textAlign: 'center',
                    fontFamily: 'var(--mono, monospace)',
                    outline: 'none',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #6b6760)' }}>
                Confirmar PIN
                <input
                  type="password" inputMode="numeric" maxLength={6}
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreatePin(); }}
                  placeholder="••••"
                  style={{
                    padding: '12px', borderRadius: 8,
                    border: '1px solid var(--border, #d9d1c4)',
                    background: 'var(--surface, white)',
                    fontSize: 22, letterSpacing: '0.3em', textAlign: 'center',
                    fontFamily: 'var(--mono, monospace)',
                    outline: 'none',
                  }}
                />
              </label>
            </div>

            {error && (
              <div style={{
                marginTop: 14, padding: '10px 14px',
                background: '#fdecea', border: '1px solid #c0392b33',
                borderRadius: 10, fontSize: 13, color: '#c0392b', fontWeight: 500,
              }}>
                {error}
              </div>
            )}

            <button
              onClick={handleCreatePin}
              disabled={busy}
              style={{
                width: '100%', marginTop: 18, padding: '12px',
                background: busy ? '#d9d1c4' : 'var(--primary, #cc785c)',
                color: 'white', border: 'none', borderRadius: 10,
                fontSize: 15, fontWeight: 700,
                cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'var(--font, inherit)',
              }}
            >
              {busy ? 'Configurando…' : 'Entrar no NutriOPS'}
            </button>

            <div style={{ marginTop: 18, padding: '10px 14px', background: 'var(--bg, #faf9f5)', borderRadius: 8, fontSize: 11, color: 'var(--text-secondary, #6b6760)', lineHeight: 1.5 }}>
              Você é o <strong>administrador</strong> dessa conta. Pode cadastrar
              colaboradores, supervisores e o RT em Equipe depois de entrar.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SetupErrorScreen({ title, message, actionLabel, onAction }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg, #faf9f5)', padding: 24 }}>
      <div style={{
        width: '100%', maxWidth: 420, textAlign: 'center',
        background: 'var(--surface, white)',
        border: '1px solid var(--border, #d9d1c4)',
        borderRadius: 20, padding: '36px 40px',
      }}>
        <BrandLockup size="sm" idPrefix="setup-err" showSub={false} />
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text, #141413)', margin: '24px 0 8px', letterSpacing: '-.02em' }}>
          {title}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary, #6b6760)', margin: '0 0 24px', lineHeight: 1.5 }}>
          {message}
        </p>
        <button
          onClick={onAction}
          style={{
            padding: '10px 24px',
            background: 'var(--primary, #cc785c)', color: 'white',
            border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'var(--font, inherit)',
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
