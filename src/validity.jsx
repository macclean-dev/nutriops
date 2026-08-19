import React, { useEffect, useMemo, useState } from 'react';
import { Th, useOrdenacao } from './tabela-ordenavel';
import { pushProduct, pushValidityRules, syncValidityRules , lw as gravarLocal } from './repository';
import {
  readOpenRules, resolveOpenRule, computeOpenedUntil,
  fmtRule, fmtDate, fmtDateTime, DEFAULT_OPEN_RULES, buildLabelTrace,
} from './validity-rules';
import { LabelScannerModal } from './label-scanner';

// ─── Storage ───────────────────────────────────────────────────────────────

const sk = (k, id) => `nutriops.${k}.${id}`;
const sl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
// Grava pelo `lw` do repositório em vez de engolir a falha: quando o
// localStorage enche, o setItem estoura e o app inteiro segue confirmando
// sucesso. O `lw` loga e levanta a bandeira que o banner de "armazenamento
// cheio" lê (v1.9.158) — este arquivo tinha a própria cópia muda do helper,
// e a bandeira nunca chegava aqui. Achado da auditoria (18/08).
const ss = (k, v) => gravarLocal(k, v);

export const readProducts    = (id) => sl(sk('products', id), []);
export const writeProducts   = (id, v) => ss(sk('products', id), v);
export const readStockLogs   = (id) => sl(sk('stocklogs', id), []);
export const writeStockLogs  = (id, v) => ss(sk('stocklogs', id), v.slice(0, 500));

function uid() { return crypto.randomUUID(); }
// Dias corridos entre HOJE e a data — meia-noite com meia-noite. O ceil da
// versão antiga comparava 12:00 com 00:00 e somava 1 dia em tudo (produto
// vencendo hoje dizia "Vence amanhã"; regra de 30 dias virava badge de 31).
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr + 'T00:00').getTime() - new Date().setHours(0,0,0,0);
  return Math.round(diff / 86400000);
}

// ─── Validade tone ─────────────────────────────────────────────────────────

function validityTone(days) {
  if (days === null) return 'neutral';
  if (days < 0)  return 'expired';
  if (days === 0) return 'danger';
  if (days <= 2)  return 'danger';
  if (days <= 7)  return 'warn';
  return 'ok';
}

function validityLabel(days) {
  if (days === null)  return '—';
  if (days < 0)       return `Vencido há ${Math.abs(days)}d`;
  if (days === 0)     return 'Vence hoje!';
  if (days === 1)     return 'Vence amanhã';
  return `${days} dias`;
}

const TONE_COLOR = {
  ok:      { bg:'var(--green-light)',  border:'var(--green-border)',  text:'var(--green)' },
  warn:    { bg:'var(--amber-light)',  border:'var(--amber-border)',  text:'var(--amber)' },
  danger:  { bg:'var(--red-light)',    border:'var(--red-border)',    text:'var(--red)' },
  expired: { bg:'#f1f5f9',            border:'#94a3b8',              text:'#64748b' },
  neutral: { bg:'var(--surface-muted)',border:'var(--border)',        text:'var(--text-secondary)' },
};

// ─── Product categories ────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'carnes',     label: 'Carnes e proteínas',   icon: '🥩' },
  { id: 'laticinios', label: 'Laticínios',            icon: '🧀' },
  { id: 'hortifruti', label: 'Hortifruti',            icon: '🥦' },
  { id: 'massas',     label: 'Massas e panificados',  icon: '🥖' },
  { id: 'confeit',    label: 'Confeitaria',            icon: '🍰' },
  { id: 'bebidas',    label: 'Bebidas',               icon: '🥤' },
  { id: 'congelados', label: 'Congelados',            icon: '🧊' },
  { id: 'secos',      label: 'Secos e embalados',     icon: '📦' },
  { id: 'limpeza',    label: 'Limpeza e higiene',     icon: '🧹' },
  { id: 'outros',     label: 'Outros',                icon: '📋' },
];

const CONSERVATION = ['Refrigerado', 'Congelado', 'Temperatura ambiente', 'Seco e ventilado'];

// ─── Etiqueta 60×60mm (modelo Suflex) ──────────────────────────────────────
// Síncrona e pura de propósito: o QR e o perfil da empresa entram por `opts`
// (gerados pelo chamador), o que deixa o HTML testável sem canvas/browser.

export function generateLabel(product, tenant, session, opts = {}) {
  const { qrDataUrl = null, profile = {} } = opts;
  const aberto = Boolean(product.openedAt);
  const respName = product.openedBy || session?.user?.name || '—';
  const empresa = profile.razaoSocial || tenant?.name || '';
  const rodape = [empresa, profile.cnpj ? `CNPJ ${profile.cnpj}` : '', profile.endereco || '']
    .filter(Boolean).join(' · ');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Etiqueta — ${product.name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:10px;color:#001e2b}
    .label{width:60mm;height:60mm;padding:3.5mm;border:1px solid #c1ccd6;border-radius:2mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #eaeef2;padding-bottom:1.5mm;margin-bottom:1.5mm}
    .product-name{font-size:12px;font-weight:800;line-height:1.2;text-transform:uppercase}
    .badge{font-size:8px;font-weight:700;padding:1px 5px;border-radius:10px;background:#f1f5f4;color:#00684a;border:1px solid #c1ccd6;white-space:nowrap}
    .row{display:flex;justify-content:space-between;padding:.8mm 0;border-bottom:1px solid #f9fbfa}
    .row:last-child{border-bottom:none}
    .row span{font-size:9px;color:#5c6c7a}
    .row strong{font-size:9px;font-weight:700}
    .val-box{background:#dafbe1;border:1.5px solid #4ac26b;border-radius:2mm;padding:1.5mm 2mm;text-align:center;margin-top:1.5mm}
    .val-box span{font-size:8px;font-weight:700;color:#00a35c;display:block;letter-spacing:.06em}
    .val-box strong{font-size:13px;font-weight:800;color:#007a45}
    .footer{display:flex;align-items:center;gap:2mm;padding-top:1mm;border-top:1px solid #eaeef2}
    .footer img{width:11mm;height:11mm;flex:none}
    .footer div{font-size:6.5px;color:#5c6c7a;line-height:1.35;text-align:left}
    @page{size:60mm 60mm;margin:0}
  </style></head><body>
  <div class="label">
    <div>
      <div class="header">
        <div class="product-name">${product.name}</div>
        <div class="badge">${product.conservation || 'Ambiente'}</div>
      </div>
      <div class="row"><span>Fornecedor / Lote</span><strong>${[product.supplier, product.lot].filter(Boolean).join(' · ') || '—'}</strong></div>
      <div class="row"><span>VAL. ORIGINAL</span><strong>${product.expiryDate ? fmtDate(product.expiryDate) : '—'}</strong></div>
      ${aberto ? `<div class="row"><span>MANIPULAÇÃO</span><strong>${fmtDateTime(product.openedAt)}</strong></div>` : ''}
      <div class="row"><span>RESP.</span><strong>${respName}</strong></div>
      ${aberto && product.openedUntil
        ? `<div class="val-box"><span>VALIDADE</span><strong>${fmtDateTime(product.openedUntil)}</strong></div>`
        : (product.expiryDate ? `<div class="val-box"><span>VALIDADE</span><strong>${fmtDate(product.expiryDate)}</strong></div>` : '')}
    </div>
    <div class="footer">
      ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR">` : ''}
      <div>${rodape ? `${rodape}<br>` : ''}NutriOPS · RDC 216/2004</div>
    </div>
  </div>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDADES — MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════


// Ordenar por "Dias" é o uso real desta tabela: a RT quer o que vence primeiro
// no topo. `daysLeft` pode ser null (produto sem validade) — o motor manda
// vazio pro fim nas duas direções, então esses não poluem a lista.
const COLS_VALIDADE = {
  name:         { valor: (p) => p.name,         tipo: 'texto'  },
  category:     { valor: (p) => p.category,     tipo: 'texto'  },
  conservation: { valor: (p) => p.conservation, tipo: 'texto'  },
  expiry:       { valor: (p) => p.openedUntil ?? p.expiryDate, tipo: 'data' },
  daysLeft:     { valor: (p) => p.daysLeft,     tipo: 'numero' },
};

export function ValidityStockView({ activeTenant, allTenants, onTenantChange, session }) {
  const [products, setProducts] = useState(() => readProducts(activeTenant.id));
  const [tab, setTab]           = useState('dashboard'); // dashboard | products | add | rules
  const [rules, setRules]       = useState(() => readOpenRules(activeTenant.id));
  const [scanning, setScanning] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch]     = useState('');

  // Form state
  const [name, setName]           = useState('');
  const [category, setCategory]   = useState('outros');
  const [conservation, setConservation] = useState('Temperatura ambiente');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplier, setSupplier]   = useState('');
  const [lot, setLot]             = useState('');
  const [daysAfterOpen, setDaysAfterOpen] = useState('');
  const [isDiamond, setIsDiamond] = useState(false);

  useEffect(() => {
    setProducts(readProducts(activeTenant.id));
    setRules(readOpenRules(activeTenant.id));
    setTab('dashboard');
    // Puxa a versão mais recente das regras (pode ter sido ajustada em outro
    // device — ex.: a nutricionista de casa) antes de mostrar a tela. Relê do
    // local (não confia só em `applied`) porque em StrictMode/troca rápida de
    // tenant este efeito pode rodar 2x em paralelo — o outro disparo pode ter
    // sido quem de fato gravou; o que importa é o estado final gravado no
    // momento em que ESTA chamada termina, não quem venceu a corrida.
    let vivo = true;
    syncValidityRules(activeTenant.id).then(() => {
      if (vivo) setRules(readOpenRules(activeTenant.id));
    });
    return () => { vivo = false; };
  }, [activeTenant.id]);
  useEffect(() => { writeProducts(activeTenant.id, products); }, [activeTenant.id, products]);

  const resetForm = () => { setName(''); setCategory('outros'); setConservation('Temperatura ambiente'); setExpiryDate(''); setSupplier(''); setLot(''); setDaysAfterOpen(''); setIsDiamond(false); setEditingId(null); };

  const startEdit = (p) => {
    setName(p.name); setCategory(p.category); setConservation(p.conservation);
    setExpiryDate(p.expiryDate ?? ''); setSupplier(p.supplier ?? ''); setLot(p.lot ?? '');
    setDaysAfterOpen(String(p.daysAfterOpen ?? '')); setIsDiamond(p.isDiamond ?? false);
    setEditingId(p.id); setTab('add');
  };

  const saveProduct = () => {
    if (!name.trim()) return;
    const anterior = editingId ? products.find(p => p.id === editingId) : null;
    const product = {
      // Preserva o que veio do produto existente (inclusive campos de estoque
      // de antes da v1.9.129, que saíram da UI mas continuam no dado) — editar
      // um produto antigo não pode apagar histórico em silêncio.
      ...(anterior ?? {}),
      id: editingId ?? uid(), name: name.trim(), category, conservation,
      expiryDate: expiryDate || null, supplier: supplier.trim(), lot: lot.trim(),
      daysAfterOpen: Number(daysAfterOpen) || null, isDiamond,
      createdAt: anterior?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProducts(prev => editingId ? prev.map(p => p.id===editingId ? product : p) : [...prev, product]);
    pushProduct(activeTenant.id, product);
    resetForm(); setTab('products');
  };

  const deleteProduct = (id) => { if (!window.confirm('Remover produto?')) return; setProducts(prev => prev.filter(p => p.id !== id)); };

  const printLabel = async (product) => {
    // QR com o rastreio da abertura; perfil da empresa é o mesmo dos PDFs BPF.
    let qrDataUrl = null;
    try {
      const QR = (await import('qrcode')).default;
      const trace = buildLabelTrace(activeTenant.id, product.id, product.openedAt);
      qrDataUrl = await QR.toDataURL(trace, { width: 120, margin: 0, errorCorrectionLevel: 'M' });
    } catch { /* etiqueta sai sem QR */ }
    let profile = {};
    try { const r = localStorage.getItem(`nutriops.company.profile.${activeTenant.id}`); profile = r ? JSON.parse(r) : {}; } catch {}
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(generateLabel(product, activeTenant, session, { qrDataUrl, profile }));
    win.document.close(); setTimeout(() => win.print(), 400);
  };

  // "Abrir agora": carimba data+hora, calcula a validade pela regra da
  // categoria (ou exceção do produto) e já imprime a etiqueta. 1 clique.
  const openNow = async (product) => {
    if (product.openedAt) {
      const ok = window.confirm(`"${product.name}" já teve abertura registrada em ${fmtDateTime(product.openedAt)}. Registrar uma NOVA abertura (novo pacote) e imprimir outra etiqueta?`);
      if (!ok) return;
    }
    const rule = resolveOpenRule(product, rules);
    const openedAt = new Date().toISOString();
    const { until } = computeOpenedUntil(openedAt, rule, product.expiryDate);
    const updated = {
      ...product, openedAt, openedUntil: until,
      openedBy: session?.user?.name ?? null,
      updatedAt: new Date().toISOString(),
    };
    setProducts(prev => prev.map(p => p.id === product.id ? updated : p));
    pushProduct(activeTenant.id, updated);
    await printLabel(updated);
  };

  // Computed — a validade EFETIVA é a pós-abertura quando o produto foi
  // aberto (por construção ela nunca passa da original de fábrica).
  const withDays = products.map(p => {
    const effective = p.openedUntil ? p.openedUntil.slice(0, 10) : p.expiryDate;
    const daysLeft = daysUntil(effective);
    return { ...p, daysLeft, tone: validityTone(daysLeft), postOpen: Boolean(p.openedUntil) };
  });

  const alerts = withDays.filter(p => p.tone === 'danger' || p.tone === 'expired');
  const expiringSoon = withDays.filter(p => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 7);
  const diamonds = withDays.filter(p => p.isDiamond);

  const filtered = withDays.filter(p => {
    if (catFilter !== 'all' && p.category !== catFilter) return false;
    if (statusFilter === 'expiring' && (p.daysLeft === null || p.daysLeft > 7)) return false;
    if (statusFilter === 'expired'  && (p.daysLeft === null || p.daysLeft >= 0)) return false;
    if (statusFilter === 'diamond'  && !p.isDiamond) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.supplier.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const { ordem, aoClicar, ordenar } = useOrdenacao();
  const linhasValidade = ordenar(filtered, COLS_VALIDADE);

  // ─── Dashboard tab ───────────────────────────────────────────────────────

  const renderDashboard = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* KPIs */}
      <div className="audit-stats">
        <div className="audit-stat"><span>Produtos cadastrados</span><strong>{products.length}</strong></div>
        <div className={`audit-stat ${expiringSoon.length>0?'warn':'ok'}`}><span>Vencendo em 7 dias</span><strong>{expiringSoon.length}</strong></div>
        <div className={`audit-stat ${withDays.filter(p=>p.daysLeft!==null&&p.daysLeft<0).length>0?'danger':'ok'}`}><span>Vencidos</span><strong>{withDays.filter(p=>p.daysLeft!==null&&p.daysLeft<0).length}</strong></div>
        <div className="audit-stat"><span>💎 Diamantes</span><strong>{diamonds.length}</strong></div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <article className="management-card" style={{ borderColor:'var(--red-border)' }}>
          <div className="card-head" style={{ background:'var(--red-light)', borderBottomColor:'var(--red-border)' }}>
            <div><span className="eyebrow" style={{ color:'var(--red)' }}>Atenção imediata</span><h2>Alertas de validade</h2></div>
            <span className="badge danger">{alerts.length}</span>
          </div>
          <div className="equipment-maintenance-list">
            {alerts.slice(0,8).map(p => {
              const c = TONE_COLOR[p.tone];
              return (
                <div key={p.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid ${c.border}` }}>
                  <div>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <strong>{p.name}</strong>
                      {p.isDiamond && <span>💎</span>}
                    </div>
                    <span>{CATEGORIES.find(c=>c.id===p.category)?.label} · {p.conservation}</span>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    {p.daysLeft !== null && <div style={{ fontSize:14, fontWeight:800, color:c.text, fontFamily:'var(--mono)' }}>{validityLabel(p.daysLeft)}</div>}
                    {p.expiryDate && <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{fmtDate(p.expiryDate)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}

      {/* Diamonds */}
      {diamonds.length > 0 && (
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Itens prioritários</span><h2>💎 Seus Diamantes</h2></div><span className="badge neutral">{diamonds.length}</span></div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:10, padding:'14px 20px' }}>
            {diamonds.map(p => {
              const c = TONE_COLOR[p.tone];
              return (
                <div key={p.id} style={{ padding:'12px 14px', borderRadius:'var(--r)', border:`1.5px solid ${c.border}`, background:c.bg }}>
                  <div style={{ fontSize:14, fontWeight:700, marginBottom:4, color:c.text }}>{p.name}</div>
                  <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:6 }}>{p.conservation}</div>
                  <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center' }}>
                    {p.daysLeft !== null && <span style={{ fontSize:11, fontWeight:700, color:c.text }}>{validityLabel(p.daysLeft)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}

      {/* Expiring soon timeline */}
      {expiringSoon.length > 0 && (
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Próximos 7 dias</span><h2>Vencimentos próximos</h2></div></div>
          <div className="equipment-maintenance-list">
            {expiringSoon.sort((a,b)=>a.daysLeft-b.daysLeft).map(p => {
              const c = TONE_COLOR[p.tone];
              return (
                <div key={p.id} className="equipment-maintenance-row">
                  <div>
                    <strong>{p.name}</strong>
                    <span>{p.supplier||'—'} · Lote: {p.lot||'—'}</span>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:14, fontWeight:800, color:c.text, fontFamily:'var(--mono)' }}>{validityLabel(p.daysLeft)}</div>
                    <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{fmtDate(p.expiryDate)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}
    </div>
  );

  // ─── Products list tab ───────────────────────────────────────────────────

  const renderProducts = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div className="audit-filters">
        <label>Buscar<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome ou fornecedor…" /></label>
        <label>Categoria
          <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
            <option value="all">Todas</option>
            {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>
        </label>
        <label>Status
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="all">Todos</option>
            <option value="expiring">Vencendo em 7 dias</option>
            <option value="expired">Vencidos</option>
            <option value="diamond">💎 Diamantes</option>
          </select>
        </label>
      </div>
      <div className="audit-table-wrap">
        {filtered.length === 0 ? <p className="muted" style={{ padding:'24px 20px' }}>Nenhum produto encontrado.</p> : (
          <table className="table">
            <thead><tr>
              <Th id="name"         ordem={ordem} onClick={aoClicar}>Produto</Th>
              <Th id="category"     ordem={ordem} onClick={aoClicar}>Categoria</Th>
              <Th id="conservation" ordem={ordem} onClick={aoClicar}>Conservação</Th>
              <Th id="expiry"       ordem={ordem} onClick={aoClicar}>Validade</Th>
              <Th id="daysLeft"     ordem={ordem} onClick={aoClicar} num>Dias</Th>
              <th></th>
            </tr></thead>
            <tbody>
              {linhasValidade.map(p => {
                const c = TONE_COLOR[p.tone];
                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <strong>{p.name}</strong>
                        {p.isDiamond && <span title="Diamante">💎</span>}
                      </div>
                      {p.supplier && <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{p.supplier} · Lote: {p.lot||'—'}</div>}
                    </td>
                    <td>{CATEGORIES.find(c=>c.id===p.category)?.icon} {CATEGORIES.find(c=>c.id===p.category)?.label}</td>
                    <td><span className="badge neutral" style={{ fontSize:10 }}>{p.conservation}</span></td>
                    <td style={{ fontSize:12 }}>
                      {p.expiryDate ? fmtDate(p.expiryDate) : '—'}
                      {p.openedAt && (
                        <div style={{ fontSize:10, color:'var(--text-secondary)' }}>
                          Aberto {fmtDateTime(p.openedAt)}{p.openedUntil ? ` → vence ${fmtDateTime(p.openedUntil)}` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      {p.daysLeft !== null && (
                        <span title={p.postOpen ? 'Validade após abertura' : 'Validade original'} style={{ padding:'3px 8px', borderRadius:20, fontSize:11, fontWeight:700, background:c.bg, color:c.text, border:`1px solid ${c.border}` }}>
                          {validityLabel(p.daysLeft)}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:4 }}>
                        <button className="ghost-action" style={{ fontSize:11, fontWeight:700, color:'var(--primary)' }}
                          title={`Registrar abertura agora e imprimir etiqueta (regra: ${fmtRule(resolveOpenRule(p, rules))})`}
                          onClick={() => openNow(p)}>Abrir</button>
                        <button className="ghost-action" style={{ fontSize:11 }} title="Reimprimir etiqueta" onClick={() => printLabel(p)}>🏷️</button>
                        <button className="ghost-action" style={{ fontSize:11 }} onClick={() => startEdit(p)}>Editar</button>
                        <button className="ghost-action danger" style={{ fontSize:11 }} onClick={() => deleteProduct(p.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  // ─── Add/Edit form tab ───────────────────────────────────────────────────

  const renderForm = () => (
    <article className="management-card">
      <div className="card-head">
        <div><span className="eyebrow">{editingId ? 'Editar' : 'Novo'}</span><h2>{editingId ? name : 'Cadastrar produto'}</h2></div>
        {editingId && <button className="ghost-action" onClick={() => { resetForm(); setTab('products'); }}>Cancelar</button>}
      </div>
      <div className="capture-fields">
        <div className="grid-2">
          <label>Nome do produto<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Filé de frango, Cream cheese" /></label>
          <label>Fornecedor<input value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="Nome do fornecedor" /></label>
        </div>
        <div className="grid-2">
          <label>Categoria
            <select value={category} onChange={e=>setCategory(e.target.value)}>
              {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </select>
          </label>
          <label>Método de conservação
            <select value={conservation} onChange={e=>setConservation(e.target.value)}>
              {CONSERVATION.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="grid-2">
          <label>Lote<input value={lot} onChange={e=>setLot(e.target.value)} placeholder="Número do lote" /></label>
          <label>Data de validade<input type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} /></label>
        </div>
        <div className="grid-2">
          <label>Validade após abertura (dias) — exceção<input type="number" min="0" value={daysAfterOpen} onChange={e=>setDaysAfterOpen(e.target.value)} placeholder={`Vazio = regra da categoria (${fmtRule(rules[category] ?? DEFAULT_OPEN_RULES[category])})`} /></label>
        </div>
        <label style={{ flexDirection:'row', alignItems:'center', gap:10, cursor:'pointer' }}>
          <input type="checkbox" checked={isDiamond} onChange={e=>setIsDiamond(e.target.checked)} />
          <span style={{ fontWeight:600, color:'var(--text)' }}>💎 Marcar como Diamante (item prioritário)</span>
        </label>
        <div className="actions-row" style={{ justifyContent:'flex-end' }}>
          <button className="primary-action attention" onClick={saveProduct} disabled={!name.trim()}>
            {editingId ? 'Salvar alterações' : 'Cadastrar produto'}
          </button>
        </div>
      </div>
    </article>
  );

  // ─── Rules tab — validade pós-abertura por categoria ─────────────────────

  const setRule = (cat, patch) => setRules(prev => ({ ...prev, [cat]: { ...prev[cat], ...patch } }));

  const saveRules = () => {
    const clean = {};
    for (const cat of Object.keys(DEFAULT_OPEN_RULES)) {
      const r = rules[cat] ?? DEFAULT_OPEN_RULES[cat];
      clean[cat] = { amount: Math.max(1, Number(r.amount) || DEFAULT_OPEN_RULES[cat].amount), unit: r.unit === 'h' ? 'h' : 'd' };
    }
    setRules(clean);
    pushValidityRules(activeTenant.id, clean); // grava local + sobe pra nuvem (ou enfileira offline)
  };

  const renderRules = () => (
    <article className="management-card">
      <div className="card-head">
        <div>
          <span className="eyebrow">Etiquetas de abertura</span>
          <h2>Regras de validade após abertura</h2>
        </div>
      </div>
      <div className="capture-fields">
        <p className="muted" style={{ fontSize:13, lineHeight:1.5 }}>
          Configure uma vez, use no dia a dia com um clique: o botão <strong>Abrir</strong> na
          lista de produtos carimba a data e a hora da abertura, calcula a validade pela regra
          da categoria e imprime a etiqueta. Se um produto tiver "Validade após abertura (dias)"
          preenchida no cadastro, essa exceção vence a regra da categoria. A validade calculada
          nunca passa da validade original do rótulo.
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))', gap:10 }}>
          {CATEGORIES.map(c => {
            const r = rules[c.id] ?? DEFAULT_OPEN_RULES[c.id];
            return (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', border:'1px solid var(--border)', borderRadius:'var(--r)', background:'var(--surface)' }}>
                <span style={{ flex:1, fontSize:13, fontWeight:600 }}>{c.icon} {c.label}</span>
                <input type="number" min="1" value={r.amount} onChange={e=>setRule(c.id,{ amount:e.target.value })}
                  style={{ width:64, textAlign:'right' }} />
                <select value={r.unit} onChange={e=>setRule(c.id,{ unit:e.target.value })} style={{ width:'auto' }}>
                  <option value="h">horas</option>
                  <option value="d">dias</option>
                </select>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize:12 }}>
          As regras ficam salvas neste dispositivo. Configure no aparelho que imprime as etiquetas.
        </p>
        <div className="actions-row" style={{ justifyContent:'flex-end' }}>
          <button className="primary-action attention" onClick={saveRules}>Salvar regras</button>
        </div>
      </div>
    </article>
  );

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Controle de insumos</span>
          <h1>Validades</h1>
          <p className="muted">Controle de vencimentos, validade pós-abertura e etiquetas digitais.</p>
        </div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="ghost-action" onClick={() => setScanning(true)}>📷 Escanear etiqueta</button>
          <button className="primary-action" onClick={() => { resetForm(); setTab('add'); }}>+ Produto</button>
        </div>
      </div>

      {scanning && (
        <LabelScannerModal
          activeTenant={activeTenant} activeTenantProducts={products} allTenants={allTenants}
          onClose={() => setScanning(false)}
        />
      )}

      {/* Tabs — mesmo visual do HubTabs do design system */}
      <div style={{
        display:'flex', gap:4, padding:4, marginBottom:16,
        background:'var(--surface-muted)', border:'1px solid var(--border-subtle)',
        borderRadius:'var(--r-lg)', overflowX:'auto',
      }}>
        {[['dashboard','Dashboard'],['products','Produtos'],['add', editingId?'Editar':'Cadastrar'],['rules','Regras']].map(([key,label]) => {
          const isActive = tab === key;
          return (
            <button key={key} onClick={() => { if(key!=='add') { resetForm(); } setTab(key); }}
              style={{
                display:'flex', alignItems:'center', gap:7, padding:'7px 12px',
                borderRadius:'var(--r)', border:'none', cursor:'pointer',
                fontFamily:'var(--font)', fontSize:13,
                fontWeight: isActive ? 600 : 500,
                background: isActive ? 'var(--surface)' : 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                boxShadow: isActive ? '0 1px 3px rgba(20,20,19,.06)' : 'none',
                transition:'all .15s', whiteSpace:'nowrap',
              }}>
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'dashboard' && renderDashboard()}
      {tab === 'products'  && renderProducts()}
      {tab === 'add'       && renderForm()}
      {tab === 'rules'     && renderRules()}
    </section>
  );
}
