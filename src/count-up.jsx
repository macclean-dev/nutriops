// ─────────────────────────────────────────────────────────────────────────────
// CountUp — número que conta de 0 até o valor na entrada da tela.
//
// Recebe o texto JÁ formatado ("87%", "1.234", "R$ 82,10") e preserva
// prefixo/sufixo/decimais — funciona com qualquer unidade do projeto.
// SPA (Vite, sem SSR): anima ao montar e sempre que `text` muda (ex.: dado
// novo chega do sync). prefers-reduced-motion: não anima. Assume pt-BR
// (milhar '.', decimal ',').
//
// Uso: <CountUp text={valorJaFormatado} /> no lugar do número. O elemento
// que envolve precisa de font-variant-numeric: tabular-nums (senão os
// dígitos tremem de largura ao contar).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

export default function CountUp({ text, duration = 1300, delay = 400 }) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(text); return; }

    const s = String(text);
    const m = s.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/);
    if (!m) { setShown(text); return; }
    const seg = m[0];
    const idx = m.index ?? 0;
    const decimals = seg.includes(',') ? seg.split(',')[1].length : 0;
    const target = parseFloat(seg.replace(/\./g, '').replace(',', '.'));
    if (!isFinite(target) || target === 0) { setShown(text); return; }

    const prefix = s.slice(0, idx);
    const suffix = s.slice(idx + seg.length);
    const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

    let raf = 0;
    const t0 = performance.now() + delay;
    setShown(prefix + fmt.format(0) + suffix); // fica escondido sob o fade do card
    const tick = (now) => {
      const t = Math.min(1, Math.max(0, (now - t0) / duration));
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic — desacelera ao pousar
      setShown(t >= 1 ? text : prefix + fmt.format(target * eased) + suffix);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration, delay]);

  return <>{shown}</>;
}
