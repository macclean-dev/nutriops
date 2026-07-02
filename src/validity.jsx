import React, { useEffect, useMemo, useState } from 'react';
import { pushProduct, pushStockLog } from './repository';

// ─── Storage ───────────────────────────────────────────────────────────────

const sk = (k, id) => `nutriops.${k}.${id}`;
const sl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const ss = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const readProducts    = (id) => sl(sk('products', id), []);
export const writeProducts   = (id, v) => ss(sk('products', id), v);
export const readStockLogs   = (id) => sl(sk('stocklogs', id), []);
export const writeStockLogs  = (id, v) => ss(sk('stocklogs', id), v.slice(0, 500));

function uid() { return crypto.randomUUID(); }
function fmtDate(iso) { try { return new Date(iso + 'T12:00').toLocaleDateString('pt-BR'); } catch { return iso; } }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr + 'T12:00').getTime() - new Date().setHours(0,0,0,0);
  return Math.ceil(diff / 86400000);
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

// ─── PDF label generator ───────────────────────────────────────────────────

export function generateLabel(product, tenant, session) {
  const today = new Date().toLocaleDateString('pt-BR');
  const manipExp = product.daysAfterOpen && product.openedAt
    ? new Date(new Date(product.openedAt).getTime() + product.daysAfterOpen * 86400000).toLocaleDateString('pt-BR')
    : '—';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Etiqueta — ${product.name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:10px;color:#001e2b}
    .label{width:60mm;height:60mm;padding:4mm;border:1px solid #c1ccd6;border-radius:2mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #eaeef2;padding-bottom:2mm;margin-bottom:2mm}
    .product-name{font-size:12px;font-weight:800;line-height:1.2}
    .badge{font-size:8px;font-weight:700;padding:1px 5px;border-radius:10px;background:rgba(29,78,137,.10);color:#00684a;border:1px solid rgba(29,78,137,.4);white-space:nowrap}
    .row{display:flex;justify-content:space-between;padding:1mm 0;border-bottom:1px solid #f9fbfa}
    .row:last-child{border-bottom:none}
    .row span{font-size:9px;color:#5c6c7a}
    .row strong{font-size:9px;font-weight:700}
    .val-box{background:#dafbe1;border:1px solid #4ac26b;border-radius:2mm;padding:2mm;text-align:center;margin-top:2mm}
    .val-box span{font-size:8px;color:#00a35c;display:block}
    .val-box strong{font-size:11px;font-weight:800;color:#00a35c}
    .footer{font-size:7px;color:#9198a1;text-align:center;padding-top:1mm;border-top:1px solid #eaeef2}
    @page{size:60mm 60mm;margin:0}
  </style></head><body>
  <div class="label">
    <div>
      <div class="header">
        <div class="product-name">${product.name}</div>
        <div class="badge">${product.conservation || 'Ambiente'}</div>
      </div>
      <div class="row"><span>Fornecedor</span><strong>${product.supplier || '—'}</strong></div>
      <div class="row"><span>Lote</span><strong>${product.lot || '—'}</strong></div>
      <div class="row"><span>Validade original</span><strong>${product.expiryDate ? fmtDate(product.expiryDate) : '—'}</strong></div>
      <div class="row"><span>Manipulado em</span><strong>${today}</strong></div>
      <div class="row"><span>Responsável</span><strong>${session?.user?.name || '—'}</strong></div>
      ${product.daysAfterOpen ? `<div class="val-box"><span>Validade após abertura</span><strong>${manipExp}</strong></div>` : ''}
    </div>
    <div class="footer">${tenant?.name || ''} · NutriOPS · RDC 216/2004</div>
  </div>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDADES E ESTOQUE — MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════

export function ValidityStockView({ activeTenant, allTenants, onTenantChange, session }) {
  const [products, setProducts] = useState(() => readProducts(activeTenant.id));
  const [logs, setLogs]         = useState(() => readStockLogs(activeTenant.id));
  const [tab, setTab]           = useState('dashboard'); // dashboard | products | add | stock
  const [editingId, setEditingId] = useState(null);
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch]     = useState('');

  // Form state
  const [name, setName]           = useState('');
  const [category, setCategory]   = useState('outros');
  const [conservation, setConservation] = useState('Temperatura ambiente');
  const [unit, setUnit]           = useState('kg');
  const [minStock, setMinStock]   = useState('');
  const [currentStock, setCurrentStock] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplier, setSupplier]   = useState('');
  const [lot, setLot]             = useState('');
  const [daysAfterOpen, setDaysAfterOpen] = useState('');
  const [isDiamond, setIsDiamond] = useState(false);

  // Stock adjustment
  const [adjProduct, setAdjProduct] = useState('');
  const [adjQty, setAdjQty]         = useState('');
  const [adjType, setAdjType]       = useState('entrada');
  const [adjNote, setAdjNote]       = useState('');

  useEffect(() => { setProducts(readProducts(activeTenant.id)); setLogs(readStockLogs(activeTenant.id)); setTab('dashboard'); }, [activeTenant.id]);
  useEffect(() => { writeProducts(activeTenant.id, products); }, [activeTenant.id, products]);
  useEffect(() => { writeStockLogs(activeTenant.id, logs); }, [activeTenant.id, logs]);

  const resetForm = () => { setName(''); setCategory('outros'); setConservation('Temperatura ambiente'); setUnit('kg'); setMinStock(''); setCurrentStock(''); setExpiryDate(''); setSupplier(''); setLot(''); setDaysAfterOpen(''); setIsDiamond(false); setEditingId(null); };

  const startEdit = (p) => {
    setName(p.name); setCategory(p.category); setConservation(p.conservation); setUnit(p.unit);
    setMinStock(String(p.minStock ?? '')); setCurrentStock(String(p.currentStock ?? ''));
    setExpiryDate(p.expiryDate ?? ''); setSupplier(p.supplier ?? ''); setLot(p.lot ?? '');
    setDaysAfterOpen(String(p.daysAfterOpen ?? '')); setIsDiamond(p.isDiamond ?? false);
    setEditingId(p.id); setTab('add');
  };

  const saveProduct = () => {
    if (!name.trim()) return;
    const product = {
      id: editingId ?? uid(), name: name.trim(), category, conservation, unit,
      minStock: Number(minStock) || 0, currentStock: Number(currentStock) || 0,
      expiryDate: expiryDate || null, supplier: supplier.trim(), lot: lot.trim(),
      daysAfterOpen: Number(daysAfterOpen) || null, isDiamond,
      createdAt: editingId ? (products.find(p=>p.id===editingId)?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProducts(prev => editingId ? prev.map(p => p.id===editingId ? product : p) : [...prev, product]);
    pushProduct(activeTenant.id, product);
    resetForm(); setTab('products');
  };

  const deleteProduct = (id) => { if (!window.confirm('Remover produto?')) return; setProducts(prev => prev.filter(p => p.id !== id)); };

  const saveAdjustment = () => {
    if (!adjProduct || !adjQty) return;
    const qty = Number(adjQty);
    if (isNaN(qty) || qty <= 0) return;
    const delta = adjType === 'entrada' ? qty : -qty;
    setProducts(prev => prev.map(p => p.id === adjProduct ? { ...p, currentStock: Math.max(0, (p.currentStock || 0) + delta), updatedAt: new Date().toISOString() } : p));
    const stockLog = { id:uid(), productId:adjProduct, productName:products.find(p=>p.id===adjProduct)?.name, type:adjType, qty, note:adjNote.trim(), user:session?.user?.name, createdAt:new Date().toISOString() };
    setLogs(prev => [stockLog, ...prev]);
    pushStockLog(activeTenant.id, stockLog);
    setAdjProduct(''); setAdjQty(''); setAdjNote(''); setAdjType('entrada');
  };

  const printLabel = (product) => {
    const win = window.open('', '_blank');
    win.document.write(generateLabel(product, activeTenant, session));
    win.document.close(); setTimeout(() => win.print(), 400);
  };

  // Computed
  const withDays = products.map(p => ({ ...p, daysLeft: daysUntil(p.expiryDate), tone: validityTone(daysUntil(p.expiryDate)), lowStock: p.minStock > 0 && p.currentStock < p.minStock }));

  const alerts = withDays.filter(p => p.tone === 'danger' || p.tone === 'expired' || p.lowStock);
  const expiringSoon = withDays.filter(p => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 7);
  const diamonds = withDays.filter(p => p.isDiamond);
  const lowStockItems = withDays.filter(p => p.lowStock);

  const filtered = withDays.filter(p => {
    if (catFilter !== 'all' && p.category !== catFilter) return false;
    if (statusFilter === 'expiring' && (p.daysLeft === null || p.daysLeft > 7)) return false;
    if (statusFilter === 'expired'  && (p.daysLeft === null || p.daysLeft >= 0)) return false;
    if (statusFilter === 'low'      && !p.lowStock) return false;
    if (statusFilter === 'diamond'  && !p.isDiamond) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.supplier.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // ─── Dashboard tab ───────────────────────────────────────────────────────

  const renderDashboard = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* KPIs */}
      <div className="audit-stats">
        <div className="audit-stat"><span>Produtos cadastrados</span><strong>{products.length}</strong></div>
        <div className={`audit-stat ${expiringSoon.length>0?'warn':'ok'}`}><span>Vencendo em 7 dias</span><strong>{expiringSoon.length}</strong></div>
        <div className={`audit-stat ${withDays.filter(p=>p.daysLeft!==null&&p.daysLeft<0).length>0?'danger':'ok'}`}><span>Vencidos</span><strong>{withDays.filter(p=>p.daysLeft!==null&&p.daysLeft<0).length}</strong></div>
        <div className={`audit-stat ${lowStockItems.length>0?'warn':'ok'}`}><span>Estoque baixo</span><strong>{lowStockItems.length}</strong></div>
        <div className="audit-stat"><span>💎 Diamantes</span><strong>{diamonds.length}</strong></div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <article className="management-card" style={{ borderColor:'var(--red-border)' }}>
          <div className="card-head" style={{ background:'var(--red-light)', borderBottomColor:'var(--red-border)' }}>
            <div><span className="eyebrow" style={{ color:'var(--red)' }}>Atenção imediata</span><h2>Alertas de estoque e validade</h2></div>
            <span className="badge danger">{alerts.length}</span>
          </div>
          <div className="equipment-maintenance-list">
            {alerts.slice(0,8).map(p => {
              const c = TONE_COLOR[p.lowStock && (p.tone==='ok'||p.tone==='neutral') ? 'warn' : p.tone];
              return (
                <div key={p.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid ${c.border}` }}>
                  <div>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <strong>{p.name}</strong>
                      {p.isDiamond && <span>💎</span>}
                      {p.lowStock && <span className="badge warn" style={{ fontSize:10 }}>Estoque baixo</span>}
                    </div>
                    <span>{CATEGORIES.find(c=>c.id===p.category)?.label} · {p.conservation}</span>
                    {p.currentStock !== undefined && <span>Estoque: <strong>{p.currentStock} {p.unit}</strong>{p.minStock > 0 ? ` (mín: ${p.minStock})` : ''}</span>}
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
              const c = TONE_COLOR[p.lowStock?'warn':p.tone];
              return (
                <div key={p.id} style={{ padding:'12px 14px', borderRadius:'var(--r)', border:`1.5px solid ${c.border}`, background:c.bg }}>
                  <div style={{ fontSize:14, fontWeight:700, marginBottom:4, color:c.text }}>{p.name}</div>
                  <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:6 }}>{p.conservation}</div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:12 }}>Estoque: <strong>{p.currentStock} {p.unit}</strong></span>
                    {p.daysLeft !== null && <span style={{ fontSize:11, fontWeight:700, color:c.text }}>{validityLabel(p.daysLeft)}</span>}
                  </div>
                  {p.lowStock && <div style={{ fontSize:11, color:'var(--amber)', marginTop:4, fontWeight:600 }}>⚠ Repor — abaixo do mínimo</div>}
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
            <option value="low">Estoque baixo</option>
            <option value="diamond">💎 Diamantes</option>
          </select>
        </label>
      </div>
      <div className="audit-table-wrap">
        {filtered.length === 0 ? <p className="muted" style={{ padding:'24px 20px' }}>Nenhum produto encontrado.</p> : (
          <table className="table">
            <thead><tr>
              <th>Produto</th><th>Categoria</th><th>Conservação</th>
              <th>Estoque</th><th>Validade</th><th>Dias</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.map(p => {
                const c = TONE_COLOR[p.lowStock&&(p.tone==='ok'||p.tone==='neutral')?'warn':p.tone];
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
                    <td>
                      <div style={{ fontFamily:'var(--mono)', fontWeight:700, color:p.lowStock?'var(--amber)':'var(--text)' }}>
                        {p.currentStock} {p.unit}
                      </div>
                      {p.minStock > 0 && <div style={{ fontSize:10, color:'var(--text-secondary)' }}>mín: {p.minStock}</div>}
                    </td>
                    <td style={{ fontSize:12 }}>{p.expiryDate ? fmtDate(p.expiryDate) : '—'}</td>
                    <td>
                      {p.daysLeft !== null && (
                        <span style={{ padding:'3px 8px', borderRadius:20, fontSize:11, fontWeight:700, background:c.bg, color:c.text, border:`1px solid ${c.border}` }}>
                          {validityLabel(p.daysLeft)}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:4 }}>
                        <button className="ghost-action" style={{ fontSize:11 }} onClick={() => printLabel(p)}>🏷️</button>
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
          <label>Unidade de medida<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="kg, L, un, cx…" /></label>
          <label>Lote<input value={lot} onChange={e=>setLot(e.target.value)} placeholder="Número do lote" /></label>
        </div>
        <div className="grid-2">
          <label>Estoque atual<input type="number" min="0" value={currentStock} onChange={e=>setCurrentStock(e.target.value)} placeholder="0" /></label>
          <label>Estoque mínimo (alerta)<input type="number" min="0" value={minStock} onChange={e=>setMinStock(e.target.value)} placeholder="Ex.: 2" /></label>
        </div>
        <div className="grid-2">
          <label>Data de validade<input type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} /></label>
          <label>Validade após abertura (dias)<input type="number" min="0" value={daysAfterOpen} onChange={e=>setDaysAfterOpen(e.target.value)} placeholder="Ex.: 3 dias" /></label>
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

  // ─── Stock movement tab ──────────────────────────────────────────────────

  const renderStock = () => (
    <div className="management-grid">
      <article className="management-card">
        <div className="card-head"><div><span className="eyebrow">Movimentação</span><h2>Entrada / Saída de estoque</h2></div></div>
        <div className="capture-fields">
          <label>Produto
            <select value={adjProduct} onChange={e=>setAdjProduct(e.target.value)}>
              <option value="">Selecione o produto…</option>
              {products.map(p=><option key={p.id} value={p.id}>{p.name} ({p.currentStock} {p.unit})</option>)}
            </select>
          </label>
          <div style={{ display:'flex', gap:8 }}>
            {[['entrada','▲ Entrada'],['saida','▼ Saída'],['ajuste','⟳ Ajuste']].map(([val,lbl]) => {
              const on = adjType===val;
              const color = val==='entrada'?'var(--green)':val==='saida'?'var(--red)':'var(--blue)';
              return <button key={val} onClick={()=>setAdjType(val)} style={{ flex:1, padding:'8px', borderRadius:8, border:`1.5px solid ${on?color:'var(--border)'}`, background:on?`${color}22`:'white', color:on?color:'var(--text-secondary)', fontWeight:on?700:500, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>{lbl}</button>;
            })}
          </div>
          <label>Quantidade<input type="number" min="0" step="0.1" value={adjQty} onChange={e=>setAdjQty(e.target.value)} placeholder="Ex.: 2.5" /></label>
          <label>Observação<input value={adjNote} onChange={e=>setAdjNote(e.target.value)} placeholder="Ex.: Recebimento nota 123, Quebra operacional…" /></label>
          <button className="primary-action attention" onClick={saveAdjustment} disabled={!adjProduct||!adjQty}>Registrar movimentação</button>
        </div>
      </article>
      <article className="management-card">
        <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Últimas movimentações</h2></div><span className="badge neutral">{logs.length}</span></div>
        <div className="equipment-maintenance-list">
          {logs.length === 0 ? <p className="muted" style={{ padding:'20px' }}>Nenhuma movimentação registrada.</p>
            : logs.slice(0,15).map(l => {
              const isIn = l.type==='entrada';
              return (
                <div key={l.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid ${isIn?'var(--green-border)':'var(--red-border)'}` }}>
                  <div>
                    <strong>{l.productName}</strong>
                    <span>{new Date(l.createdAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · {l.user}</span>
                    {l.note && <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{l.note}</span>}
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:'var(--mono)', fontWeight:700, fontSize:16, color:isIn?'var(--green)':'var(--red)' }}>
                      {isIn?'+':'-'}{l.qty}
                    </div>
                    <span className={`badge ${isIn?'ok':'danger'}`} style={{ fontSize:10 }}>{l.type==='entrada'?'Entrada':l.type==='saida'?'Saída':'Ajuste'}</span>
                  </div>
                </div>
              );
            })}
        </div>
      </article>
    </div>
  );

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Controle de insumos</span>
          <h1>Validades e Estoque</h1>
          <p className="muted">Controle de vencimentos, estoque mínimo e etiquetas digitais.</p>
        </div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="primary-action" onClick={() => { resetForm(); setTab('add'); }}>+ Produto</button>
        </div>
      </div>

      {/* Tabs — mesmo visual do HubTabs do design system */}
      <div style={{
        display:'flex', gap:4, padding:4, marginBottom:16,
        background:'var(--surface-muted)', border:'1px solid var(--border-subtle)',
        borderRadius:'var(--r-lg)', overflowX:'auto',
      }}>
        {[['dashboard','Dashboard'],['products','Produtos'],['add', editingId?'Editar':'Cadastrar'],['stock','Movimentação']].map(([key,label]) => {
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
      {tab === 'stock'     && renderStock()}
    </section>
  );
}
