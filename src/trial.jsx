import React, { useEffect, useState } from 'react';
import { readClients } from './admin';

// ─── Trial check ───────────────────────────────────────────────────────────

export function checkTrialStatus() {
  const token = localStorage.getItem('nutriops.access.token');
  if (!token) return { ok: true }; // demo/internal users always ok

  const clients = readClients();
  const client  = clients.find(c => c.accessToken === token);
  if (!client) return { ok: true };
  if (!client.active) return { ok: false, reason: 'inactive', client };

  if (client.plan === 'trial') {
    const expires = new Date(client.trialEndsAt).getTime();
    const daysLeft = Math.ceil((expires - Date.now()) / 86400000);
    if (daysLeft < 0) return { ok: false, reason: 'trial_expired', client, daysLeft };
    if (daysLeft <= 3) return { ok: true, reason: 'trial_warning', client, daysLeft };
  }

  if (client.billingStatus === 'overdue') {
    return { ok: true, reason: 'payment_overdue', client };
  }

  return { ok: true, client };
}

// ─── Trial warning banner ─────────────────────────────────────────────────

export function TrialBanner({ status, onDismiss }) {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem('nutriops.trial.banner.dismissed') === new Date().toDateString();
  });

  if (dismissed || !status?.reason) return null;

  const dismiss = () => {
    localStorage.setItem('nutriops.trial.banner.dismissed', new Date().toDateString());
    setDismissed(true);
    onDismiss?.();
  };

  if (status.reason === 'trial_warning') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '10px 16px', background: 'var(--amber-light)', border: '1px solid var(--amber-border)',
        borderRadius: 10, marginBottom: 16, flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <span style={{ fontWeight: 700, color: 'var(--amber)' }}>
            ⏰ Trial expira em {status.daysLeft} dia{status.daysLeft !== 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
            Fale conosco para continuar usando o NutriOPS.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="mailto:contato@nutriops.com.br?subject=Quero assinar o NutriOPS"
            style={{ padding: '6px 14px', background: 'var(--amber)', color: 'white', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            Falar com a equipe
          </a>
          <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}>×</button>
        </div>
      </div>
    );
  }

  if (status.reason === 'payment_overdue') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '10px 16px', background: 'var(--red-light)', border: '1px solid var(--red-border)',
        borderRadius: 10, marginBottom: 16, flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 700, color: 'var(--red)' }}>
          ⚠️ Pagamento em atraso — entre em contato para manter o acesso.
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="mailto:financeiro@nutriops.com.br"
            style={{ padding: '6px 14px', background: 'var(--red)', color: 'white', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            Regularizar pagamento
          </a>
          <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}>×</button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Trial expired screen ─────────────────────────────────────────────────

export function TrialExpiredScreen({ client }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg,#0d1117,#1c2128)',
      padding: 24, textAlign: 'center', fontFamily: '-apple-system,"Segoe UI",system-ui,sans-serif',
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 40 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#1c73e8,#2da6ff)', display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 800, color: 'white' }}>N</div>
        <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.05em', color: '#e6edf3' }}>NutriOPS</span>
      </div>

      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>⏰</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.04em', color: '#e6edf3', marginBottom: 12, lineHeight: 1.2 }}>
          Seu trial de 14 dias encerrou
        </h1>
        <p style={{ fontSize: 16, color: '#8b949e', marginBottom: 32, lineHeight: 1.6 }}>
          Obrigado por testar o NutriOPS, {client?.name || 'você'}! Para continuar acessando seus dados e registros, escolha um plano.
        </p>

        {/* Plans */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Loja', price: 149, desc: '1 unidade · até 15 colaboradores', color: '#0969da' },
            { label: 'Rede', price: 349, desc: 'Até 3 unidades · ilimitado', color: '#1a7f37', featured: true },
          ].map(plan => (
            <div key={plan.label} style={{
              padding: '18px 16px', borderRadius: 14,
              border: `2px solid ${plan.featured ? plan.color : 'rgba(240,246,252,.15)'}`,
              background: plan.featured ? `${plan.color}22` : 'rgba(255,255,255,.05)',
              position: 'relative',
            }}>
              {plan.featured && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: plan.color, color: 'white', padding: '2px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  Mais popular
                </div>
              )}
              <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>{plan.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: plan.color, marginBottom: 4 }}>R${plan.price}<span style={{ fontSize: 13, fontWeight: 500, color: '#8b949e' }}>/mês</span></div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>{plan.desc}</div>
            </div>
          ))}
        </div>

        <a href="mailto:contato@nutriops.com.br?subject=Quero assinar o NutriOPS&body=Olá! Meu trial expirou e gostaria de assinar o plano."
          style={{
            display: 'inline-block', width: '100%', padding: '14px',
            background: 'linear-gradient(135deg,#0969da,#2d7de8)', color: 'white',
            borderRadius: 12, textDecoration: 'none', fontSize: 16, fontWeight: 700,
            marginBottom: 12, boxSizing: 'border-box',
          }}>
          📧 Falar com a equipe NutriOPS
        </a>

        <a href="https://wa.me/5561999999999?text=Olá! Meu trial NutriOPS expirou e quero assinar."
          style={{
            display: 'inline-block', width: '100%', padding: '14px',
            background: '#25d366', color: 'white',
            borderRadius: 12, textDecoration: 'none', fontSize: 16, fontWeight: 700,
            boxSizing: 'border-box',
          }}>
          💬 WhatsApp
        </a>

        <p style={{ marginTop: 20, fontSize: 12, color: '#6e7681' }}>
          Seus dados ficam salvos por 30 dias após o vencimento do trial.<br />
          Após assinar, o acesso é liberado imediatamente.
        </p>
      </div>
    </div>
  );
}
