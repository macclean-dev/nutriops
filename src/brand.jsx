// ─────────────────────────────────────────────────────────────────────────────
// NutriOPS — Brand primitives compartilhados pela suite (design system Claude)
// Importado por pages.jsx, admin.jsx, onboarding.jsx, trial.jsx, kiosk.jsx
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';

export const APP_VERSION = '1.9.187';

// ─── Logomark: N-termômetro ────────────────────────────────────────────────
// O stem esquerdo do N é um termômetro: coluna de mercúrio verde subindo dentro
// do tubo branco e bulbo na base. Amarra a marca ao coração do produto
// (monitoramento de temperatura) — o N caligráfico anterior era vocabulário
// herdado do Nexum e não dizia nada sobre alimento/conformidade.
//
// Cores sólidas de propósito (sem gradiente): o mark é usado a partir de 20px,
// onde gradiente vira sujeira. `idPrefix` continua na assinatura só pra não
// quebrar quem já chama com ele.
export function NutriMark({ size = 21, idPrefix = 'nut' }) {
  void idPrefix;
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
      {/* Tubo do termômetro (stem esquerdo do N) */}
      <line x1="7.5" y1="4.5" x2="7.5" y2="19"  stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round"/>
      {/* Coluna de mercúrio — verde vivo, por dentro do tubo */}
      <line x1="7.5" y1="13"  x2="7.5" y2="20.5" stroke="#00ed64" strokeWidth="2"   strokeLinecap="round"/>
      {/* Bulbo */}
      <circle cx="7.5" cy="23.4" r="4" fill="#00ed64"/>
      {/* Diagonal do N */}
      <line x1="7.5"  y1="4.5"  x2="22.5" y2="25.5" stroke="#ffffff" strokeWidth="3"   strokeLinecap="round"/>
      {/* Stem direito do N */}
      <line x1="22.5" y1="25.5" x2="22.5" y2="4.5"  stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round"/>
    </svg>
  );
}

// ─── Lockup completo: mark + wordmark serif + sublabel uppercase ───────────
// Props:
//   size:    'lg' (default, 34px box) | 'sm' (28px box)
//   theme:   'dark' (default, fundo escuro) | 'light' (fundo claro)
//   showSub: bool — mostrar "FOOD SAFETY · vX.Y.Z" abaixo do wordmark
//   idPrefix: string — único por uso na mesma página (pra gradient ids)
export function BrandLockup({ size = 'lg', showSub = true, idPrefix = 'sid', theme = 'dark' }) {
  const isSm    = size === 'sm';
  const markBox = isSm ? 28 : 34;
  const markSvg = isSm ? 17 : 21;
  const wordSz  = isSm ? 18 : 22;
  const radius  = isSm ? 8 : 10;
  const isLight = theme === 'light';
  const wordColor = isLight ? 'var(--text)' : '#fff';
  const subColor  = isLight ? 'var(--text-secondary)' : 'rgba(255,255,255,.28)';
  return (
    <div style={{ display:'flex', alignItems:'center', gap: isSm ? 8 : 10, textDecoration:'none' }}>
      <div className="brand-mark" style={{ width: markBox, height: markBox, borderRadius: radius }}>
        <NutriMark size={markSvg} idPrefix={idPrefix} />
      </div>
      <div>
        <div className="brand-wordmark" style={{ fontSize: wordSz, color: wordColor }}>NutriOPS</div>
        {showSub && (
          <div style={{ fontSize: 9, color: subColor, letterSpacing:'.18em', textTransform:'uppercase', marginTop: 3 }}>
            Food Safety · v{APP_VERSION}
          </div>
        )}
      </div>
    </div>
  );
}
