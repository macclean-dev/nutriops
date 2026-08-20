// ─────────────────────────────────────────────────────────────────────────────
// Leitor de etiqueta — dá função ao QR que a etiqueta de abertura já imprime.
//
// O QR NÃO é um link (ver validity-rules.js: buildLabelTrace/parseLabelTrace)
// — é um identificador que só este leitor, dentro de uma sessão logada,
// interpreta. Câmera comum de celular aponta e não abre nada: de propósito,
// pra não expor dado do produto (fornecedor, quem abriu) pra quem só tem uma
// câmera na mão.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parseLabelTrace, fmtDate, fmtDateTime } from './validity-rules';
import { fetchProductById } from './repository';

const CATEGORY_LABEL = {
  carnes: '🥩 Carnes e proteínas', laticinios: '🧀 Laticínios', hortifruti: '🥦 Hortifruti',
  massas: '🥖 Massas e panificados', confeit: '🍰 Confeitaria', bebidas: '🥤 Bebidas',
  congelados: '🧊 Congelados', secos: '📦 Secos e embalados', limpeza: '🧹 Limpeza e higiene', outros: '📋 Outros',
};

// Puro (menos a chamada de rede) e testável sem precisar montar o componente:
// pega o texto cru do QR (ou digitado manualmente) e devolve o que a tela
// precisa pra decidir o que mostrar. `activeTenantProducts` é a lista que a
// tela de Validades já tem em memória (evita reler o localStorage à toa); só
// bate na nuvem quando o produto não está nela — cobre "etiqueta de outra
// loja que este usuário também acessa" ou "produto legítimo mas ainda não
// carregado". O RLS de `fetchProductById` barra qualquer loja fora do
// alcance do usuário, sem precisar de lógica extra aqui.
export async function resolveScannedLabel(text, { activeTenantId, activeTenantProducts = [], allTenants }) {
  const parsed = parseLabelTrace(text);
  if (!parsed) return { raw: text, invalid: true };

  let product = parsed.tenantId === activeTenantId
    ? activeTenantProducts.find((p) => p.id === parsed.productId)
    : null;
  // checkFailed distingue "a nuvem não respondeu" de "chequei e não existe" —
  // ver fetchProductById (repository.js). Só fica false quando o produto já
  // veio do cache em memória (achou sem precisar perguntar pra nuvem) ou
  // quando a nuvem respondeu de verdade (achado ou confirmadamente ausente).
  let checkFailed = false;
  if (!product) {
    const r = await fetchProductById(parsed.tenantId, parsed.productId);
    product = r.product;
    checkFailed = r.checkFailed;
  }

  const tenantMeta = allTenants?.find((t) => t.id === parsed.tenantId) ?? null;
  return { ...parsed, product, checkFailed, tenantMeta, wrongTenant: parsed.tenantId !== activeTenantId };
}

export function LabelScannerModal({ activeTenant, activeTenantProducts, allTenants, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const streamRef = useRef(null);

  const [cameraState, setCameraState] = useState('starting'); // starting | ok | denied | unsupported
  const [manualCode, setManualCode]   = useState('');
  const [busy, setBusy]               = useState(false);
  const [result, setResult]           = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      const video = videoRef.current, canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(frame.data, frame.width, frame.height);
        if (code?.data) { lookup(code.data); return; } // achou — para o loop
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setCameraState('unsupported'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraState('ok');
        tick();
      } catch {
        if (!cancelled) setCameraState('denied');
      }
    }

    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- lookup é estável o bastante (fecha sobre result via setState functional)

  async function lookup(text) {
    setBusy(true);
    setResult(await resolveScannedLabel(text, { activeTenantId: activeTenant.id, activeTenantProducts, allTenants }));
    setBusy(false);
  }

  const tryManual = () => { if (manualCode.trim()) lookup(manualCode.trim()); };
  const scanAgain = () => { setResult(null); setManualCode(''); };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(20,20,19,.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--surface)', borderRadius: 'var(--r-xl)',
        width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: 'var(--shadow-lg)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Etiquetas de abertura
            </div>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', color: 'var(--text)', margin: 0 }}>
              Escanear etiqueta
            </h2>
          </div>
          <button className="ghost-action" onClick={onClose}>✕</button>
        </div>

        {!result && (
          <>
            <div style={{
              position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 'var(--r-lg)',
              overflow: 'hidden', background: '#000',
            }}>
              <video ref={videoRef} playsInline muted style={{
                width: '100%', height: '100%', objectFit: 'cover',
                display: cameraState === 'ok' ? 'block' : 'none',
              }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {cameraState === 'starting' && (
                <div style={overlayMsgStyle}>Ligando a câmera…</div>
              )}
              {cameraState === 'denied' && (
                <div style={overlayMsgStyle}>Sem acesso à câmera.<br />Use o código manual abaixo.</div>
              )}
              {cameraState === 'unsupported' && (
                <div style={overlayMsgStyle}>Este navegador não tem câmera disponível aqui.<br />Use o código manual abaixo.</div>
              )}
              {cameraState === 'ok' && (
                <div style={{
                  position: 'absolute', inset: '18%', border: '2px solid var(--accent, #00ed64)',
                  borderRadius: 12, pointerEvents: 'none',
                }} />
              )}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Ou cole o código da etiqueta
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={manualCode} onChange={(e) => setManualCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') tryManual(); }}
                  placeholder="nutriops:..." style={{ flex: 1 }} />
                <button className="primary-action" disabled={!manualCode.trim() || busy} onClick={tryManual}>Buscar</button>
              </div>
            </label>
          </>
        )}

        {result && <ScanResult result={result} onScanAgain={scanAgain} onClose={onClose} />}
      </div>
    </div>
  );
}

const overlayMsgStyle = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  textAlign: 'center', color: '#fff', fontSize: 13, padding: 24, lineHeight: 1.5,
};

function ScanResult({ result, onScanAgain, onClose }) {
  const { product, checkFailed, tenantMeta, wrongTenant, invalid } = result;

  if (invalid) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="muted">Esse código não é de uma etiqueta do NutriOPS.</p>
        <button className="primary-action" onClick={onScanAgain}>Tentar de novo</button>
      </div>
    );
  }

  // Falha de rede/RLS é uma afirmação sobre a CONEXÃO, não sobre o produto —
  // diferente do card abaixo (nuvem respondeu e confirmou que não existe).
  // Achado da auditoria (19/08): os dois casos mostravam a mesma frase, e
  // quem lia concluía que o produto tinha sido excluído do sistema.
  if (!product && checkFailed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="muted">
          Não consegui verificar esse produto agora — sem conexão ou a nuvem não respondeu.
          Isso NÃO significa que o produto não existe. Tente de novo em instantes.
        </p>
        <button className="primary-action" onClick={onScanAgain}>Tentar de novo</button>
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="muted">
          Não encontrei esse produto{tenantMeta ? ` em ${tenantMeta.name}` : ''}.
          Pode ter sido excluído, ou você não tem acesso a essa loja.
        </p>
        <button className="primary-action" onClick={onScanAgain}>Tentar de novo</button>
      </div>
    );
  }

  const aberto = Boolean(product.openedAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {wrongTenant && tenantMeta && (
        <div className="badge neutral" style={{ alignSelf: 'flex-start' }}>Etiqueta de {tenantMeta.name}</div>
      )}
      <h3 style={{ margin: 0, fontSize: 18 }}>{product.name}</h3>
      <div className="muted" style={{ fontSize: 13 }}>
        {CATEGORY_LABEL[product.category] ?? product.category} · {product.conservation || '—'}
      </div>

      <InfoRow label="Fornecedor / Lote" value={[product.supplier, product.lot].filter(Boolean).join(' · ') || '—'} />
      <InfoRow label="Validade original" value={product.expiryDate ? fmtDate(product.expiryDate) : '—'} />
      {aberto && <InfoRow label="Aberto em" value={fmtDateTime(product.openedAt)} />}
      {aberto && <InfoRow label="Aberto por" value={product.openedBy || '—'} />}
      {aberto && product.openedUntil && <InfoRow label="Validade pós-abertura" value={fmtDateTime(product.openedUntil)} highlight />}
      {!aberto && <InfoRow label="Status" value="Ainda não aberto" />}

      <div className="actions-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="ghost-action" onClick={onScanAgain}>Escanear outra</button>
        <button className="primary-action" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <strong style={{ fontSize: 13, color: highlight ? 'var(--green, #00a35c)' : 'var(--text)' }}>{value}</strong>
    </div>
  );
}
