// ─────────────────────────────────────────────────────────────────────────────
// NutriOPS — Brand primitives compartilhados pela suite (design system Claude)
// Importado por pages.jsx, admin.jsx, onboarding.jsx, trial.jsx, kiosk.jsx
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';

export const APP_VERSION = '1.9.30';

// ─── Logomark: N calligráfico — diagonal verde, stems brancos ──────────────
// Diagonal em verde MongoDB (#00ed64) como assinatura do NutriOPS.
// Compartilha o vocabulário da suite.
export function NutriMark({ size = 21, idPrefix = 'nut' }) {
  const d = `${idPrefix}-d`;
  const r = `${idPrefix}-r`;
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
      <defs>
        {/* Diagonal — traço verde MongoDB (assinatura do NutriOPS) */}
        <linearGradient id={d} x1="7" y1="4" x2="23" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#00ed64" stopOpacity="0.78"/>
          <stop offset="100%" stopColor="#00ed64"/>
        </linearGradient>
        {/* Right stem — sobe do verde em direção ao branco */}
        <linearGradient id={r} x1="23" y1="26" x2="23" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.40)"/>
          <stop offset="38%"  stopColor="#ffffff"/>
          <stop offset="100%" stopColor="#ffffff"/>
        </linearGradient>
      </defs>
      {/* Left stem — branco sólido */}
      <line x1="7"  y1="4"  x2="7"  y2="26" stroke="#ffffff"       strokeWidth="4.5" strokeLinecap="round"/>
      {/* Diagonal — verde calligráfico (mais fino) */}
      <line x1="7"  y1="4"  x2="23" y2="26" stroke={`url(#${d})`} strokeWidth="3"   strokeLinecap="round"/>
      {/* Right stem — gradiente verde→branco */}
      <line x1="23" y1="26" x2="23" y2="4"  stroke={`url(#${r})`} strokeWidth="4.5" strokeLinecap="round"/>
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
