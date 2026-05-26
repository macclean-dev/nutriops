import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { pushSpecialControl } from './repository';

// ─── Storage ───────────────────────────────────────────────────────────────

const sk = (key, id) => `nutriops.${key}.${id}`;
const sl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const ss = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const readPOPs    = (id) => sl(sk('pops', id), []);
export const writePOPs   = (id, v) => ss(sk('pops', id), v);
export const readOil     = (id) => sl(sk('oil', id), []);
export const writeOil    = (id, v) => ss(sk('oil', id), v);
export const readThaw    = (id) => sl(sk('thaw', id), []);
export const writeThaw   = (id, v) => ss(sk('thaw', id), v);
export const readCool    = (id) => sl(sk('cool', id), []);
export const writeCool   = (id, v) => ss(sk('cool', id), v);

function uid() { return crypto.randomUUID(); }
function fmtDT(iso) { try { return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch { return iso; } }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; } }

// ═══════════════════════════════════════════════════════════════════════════
// 1. NOTIFICAÇÕES NO BROWSER
// ═══════════════════════════════════════════════════════════════════════════

export function useBrowserNotifications(turns, activeTenantId) {
  const [permission, setPermission] = useState(() => 'Notification' in window ? Notification.permission : 'unavailable');

  const request = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  const notify = useCallback((title, body, onClick) => {
    if (permission !== 'granted') return;
    const n = new Notification(title, { body, icon: '/favicon.ico', badge: '/favicon.ico' });
    if (onClick) n.onclick = onClick;
  }, [permission]);

  useEffect(() => {
    if (permission !== 'granted' || !turns?.length) return;
    const jobs = [];
    const now = new Date();

    for (const turn of turns) {
      const [sh, sm] = turn.start.split(':').map(Number);
      const [eh, em] = turn.end.split(':').map(Number);
      const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0).getTime() - Date.now();
      const remMs   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em - 5 < 0 ? em + 55 : em - 5, 0).getTime() - Date.now();

      if (startMs > 0) {
        const t = setTimeout(() => {
          notify(`⏰ Turno ${turn.name} iniciado — NutriOPS`, 'Hora de registrar as temperaturas!');
        }, startMs);
        jobs.push(t);
      }
      if (remMs > 0) {
        const t = setTimeout(() => {
          notify(`⚠️ 5 min para o turno ${turn.name} encerrar`, 'Verifique se todos os registros foram feitos.');
        }, remMs);
        jobs.push(t);
      }
    }
    return () => jobs.forEach(clearTimeout);
  }, [permission, turns, notify]);

  return { permission, request, notify };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. POPS DIGITAIS
// ═══════════════════════════════════════════════════════════════════════════

const POP_CATEGORIES = [
  { id: 'higiene',      label: 'Higiene pessoal e ambiental', color: '#cc785c' },
  { id: 'temperatura',  label: 'Controle de temperatura',     color: '#c0392b' },
  { id: 'manipulacao',  label: 'Manipulação de alimentos',    color: '#9a3412' },
  { id: 'limpeza',      label: 'Limpeza e desinfecção',       color: '#065f46' },
  { id: 'recepcao',     label: 'Recebimento de mercadorias',  color: '#6b21a8' },
  { id: 'pragas',       label: 'Controle de pragas',          color: '#92400e' },
  { id: 'equipamentos', label: 'Equipamentos',                color: '#374151' },
  { id: 'outros',       label: 'Outros',                      color: '#6b6760' },
];

export function POPsView({ activeTenant, allTenants, onTenantChange, session }) {
  const [pops, setPOPs]         = useState(() => readPOPs(activeTenant.id));
  const [view, setView]         = useState('list'); // list | new | detail
  const [selected, setSelected] = useState(null);
  const [catFilter, setCatFilter] = useState('all');
  const [search, setSearch]     = useState('');

  // Form state
  const [title, setTitle]         = useState('');
  const [category, setCategory]   = useState('higiene');
  const [objective, setObjective] = useState('');
  const [steps, setSteps]         = useState(['']);
  const [materials, setMaterials] = useState('');
  const [frequency, setFrequency] = useState('Diário');
  const [responsible, setResponsible] = useState('');

  useEffect(() => { setPOPs(readPOPs(activeTenant.id)); setView('list'); setSelected(null); }, [activeTenant.id]);
  useEffect(() => { writePOPs(activeTenant.id, pops); }, [activeTenant.id, pops]);

  const isRT = ['Nutricionista RT','Administrador','Super-admin'].includes(session?.user?.role);

  const resetForm = () => { setTitle(''); setCategory('higiene'); setObjective(''); setSteps(['']); setMaterials(''); setFrequency('Diário'); setResponsible(''); };

  const savePOP = () => {
    if (!title.trim()) return;
    const pop = {
      id: uid(), title: title.trim(), category, objective: objective.trim(),
      steps: steps.filter(s => s.trim()), materials: materials.trim(),
      frequency, responsible: responsible.trim(),
      createdBy: session?.user?.name, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPOPs(prev => [pop, ...prev]);
    resetForm(); setView('list');
  };

  const deletePOP = (id) => {
    if (!window.confirm('Remover este POP?')) return;
    setPOPs(prev => prev.filter(p => p.id !== id));
    if (selected?.id === id) { setSelected(null); setView('list'); }
  };

  const printPOP = (pop) => {
    const cat = POP_CATEGORIES.find(c => c.id === pop.category);
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>POP — ${pop.title}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#141413;padding:24px}
    h1{font-size:16px;font-weight:800;margin-bottom:4px}.meta{color:#6b6760;font-size:9px;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #d9d1c4}
    h2{font-size:12px;font-weight:700;margin:14px 0 6px;color:#cc785c}ol{padding-left:18px}li{margin-bottom:6px;font-size:11px;line-height:1.5}
    .footer{margin-top:20px;padding-top:10px;border-top:1px solid #d9d1c4;font-size:9px;color:#9198a1;display:flex;justify-content:space-between}
    .sig{border-top:1px solid #374151;width:200px;margin-top:40px;padding-top:4px;font-size:9px}
    @page{size:A4;margin:14mm}</style></head><body>
    <h1>POP — ${pop.title}</h1>
    <div class="meta">${activeTenant.name} · ${cat?.label ?? pop.category} · ${pop.frequency} · Elaborado por: ${pop.createdBy ?? '—'} · ${fmtDate(pop.createdAt)}</div>
    ${pop.objective ? `<h2>Objetivo</h2><p>${pop.objective}</p>` : ''}
    ${pop.materials ? `<h2>Materiais necessários</h2><p>${pop.materials}</p>` : ''}
    ${pop.steps.length ? `<h2>Procedimento</h2><ol>${pop.steps.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}
    <div style="margin-top:40px;display:flex;gap:40px">
      <div class="sig">Responsável pela execução: ${pop.responsible || '_______________'}</div>
      <div class="sig">Nutricionista RT / Data: _______________</div>
    </div>
    <div class="footer"><span>NutriOPS · RDC 216/2004</span><span>Gerado em ${new Date().toLocaleString('pt-BR')}</span></div>
    </body></html>`);
    win.document.close(); setTimeout(() => win.print(), 400);
  };

  const filtered = pops.filter(p => {
    if (catFilter !== 'all' && p.category !== catFilter) return false;
    if (search) { const q = search.toLowerCase(); return p.title.toLowerCase().includes(q) || p.objective?.toLowerCase().includes(q); }
    return true;
  });

  if (view === 'new') return (
    <section className="management-page">
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button className="ghost-action" onClick={() => { setView('list'); resetForm(); }} style={{ padding:'6px 10px' }}>← Voltar</button>
        <div><span className="eyebrow">Boas Práticas</span><h1 style={{ fontSize:20, fontWeight:800, letterSpacing:'-.04em', marginTop:2 }}>Novo POP</h1></div>
      </div>
      <article className="management-card">
        <div className="capture-fields">
          <div className="grid-2">
            <label>Título do procedimento<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex.: Higienização das mãos" /></label>
            <label>Categoria
              <select value={category} onChange={e=>setCategory(e.target.value)}>
                {POP_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label>Frequência<input value={frequency} onChange={e=>setFrequency(e.target.value)} placeholder="Ex.: Diário, A cada turno" /></label>
            <label>Responsável<input value={responsible} onChange={e=>setResponsible(e.target.value)} placeholder="Ex.: Toda a equipe, Supervisor" /></label>
          </div>
          <label>Objetivo<textarea value={objective} onChange={e=>setObjective(e.target.value)} placeholder="Descreva o objetivo deste procedimento…" style={{ minHeight:60 }} /></label>
          <label>Materiais necessários<textarea value={materials} onChange={e=>setMaterials(e.target.value)} placeholder="Liste os materiais, produtos e EPIs necessários…" style={{ minHeight:54 }} /></label>
          <div>
            <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginBottom:8 }}>Passos do procedimento</div>
            {steps.map((step, i) => (
              <div key={i} style={{ display:'flex', gap:8, marginBottom:8, alignItems:'flex-start' }}>
                <span style={{ minWidth:22, height:22, background:'var(--blue)', color:'white', borderRadius:'50%', display:'grid', placeItems:'center', fontSize:11, fontWeight:800, flexShrink:0, marginTop:8 }}>{i+1}</span>
                <textarea value={step} onChange={e => setSteps(prev => prev.map((s,idx) => idx===i ? e.target.value : s))}
                  placeholder={`Passo ${i+1}…`} style={{ flex:1, padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit', resize:'vertical', minHeight:48 }} />
                {steps.length > 1 && <button className="ghost-action danger" style={{ padding:'6px 8px', marginTop:4 }} onClick={() => setSteps(prev => prev.filter((_,idx) => idx!==i))}>✕</button>}
              </div>
            ))}
            <button className="secondary-action" style={{ fontSize:12, marginTop:4 }} onClick={() => setSteps(prev => [...prev, ''])}>+ Adicionar passo</button>
          </div>
          <div className="actions-row" style={{ justifyContent:'flex-end' }}>
            <button className="secondary-action" onClick={() => { setView('list'); resetForm(); }}>Cancelar</button>
            <button className="primary-action attention" onClick={savePOP} disabled={!title.trim() || steps.filter(s=>s.trim()).length === 0}>Salvar POP</button>
          </div>
        </div>
      </article>
    </section>
  );

  if (view === 'detail' && selected) return (
    <section className="management-page">
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button className="ghost-action" onClick={() => { setView('list'); setSelected(null); }} style={{ padding:'6px 10px' }}>← Voltar</button>
        <div style={{ flex:1 }}>
          <span className="eyebrow">{POP_CATEGORIES.find(c=>c.id===selected.category)?.label}</span>
          <h1 style={{ fontSize:20, fontWeight:800, letterSpacing:'-.04em', marginTop:2 }}>{selected.title}</h1>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="secondary-action" style={{ fontSize:12 }} onClick={() => printPOP(selected)}>↓ Imprimir PDF</button>
          {isRT && <button className="ghost-action danger" style={{ fontSize:12 }} onClick={() => deletePOP(selected.id)}>Remover</button>}
        </div>
      </div>
      <article className="management-card">
        <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
            <div className="info-box"><span>Frequência</span><strong>{selected.frequency || '—'}</strong></div>
            <div className="info-box"><span>Responsável</span><strong>{selected.responsible || '—'}</strong></div>
            <div className="info-box"><span>Elaborado por</span><strong>{selected.createdBy || '—'}</strong></div>
            <div className="info-box"><span>Data</span><strong>{fmtDate(selected.createdAt)}</strong></div>
          </div>
          {selected.objective && <div><p style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', marginBottom:6 }}>Objetivo</p><p style={{ fontSize:13, lineHeight:1.6 }}>{selected.objective}</p></div>}
          {selected.materials && <div><p style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', marginBottom:6 }}>Materiais necessários</p><p style={{ fontSize:13, lineHeight:1.6 }}>{selected.materials}</p></div>}
          {selected.steps.length > 0 && (
            <div>
              <p style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', marginBottom:10 }}>Procedimento</p>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {selected.steps.map((step, i) => (
                  <div key={i} style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                    <span style={{ minWidth:26, height:26, background:'var(--blue)', color:'white', borderRadius:'50%', display:'grid', placeItems:'center', fontSize:12, fontWeight:800, flexShrink:0, marginTop:1 }}>{i+1}</span>
                    <p style={{ fontSize:13, lineHeight:1.6, paddingTop:3 }}>{step}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </article>
    </section>
  );

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Boas Práticas de Fabricação</span><h1>POPs Digitais</h1><p className="muted">Procedimentos Operacionais Padrão da unidade.</p></div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {isRT && <button className="primary-action" onClick={() => setView('new')}>+ Novo POP</button>}
        </div>
      </div>
      <div className="audit-filters" style={{ marginBottom:16 }}>
        <label>Categoria
          <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
            <option value="all">Todas as categorias</option>
            {POP_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label>Buscar<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por título…" /></label>
      </div>
      {filtered.length === 0 ? (
        <article className="management-card">
          <div style={{ padding:'40px 20px', textAlign:'center' }}>
            <p className="muted" style={{ marginBottom:16 }}>{pops.length === 0 ? 'Nenhum POP cadastrado ainda.' : 'Nenhum POP encontrado para o filtro selecionado.'}</p>
            {isRT && pops.length === 0 && <button className="primary-action" onClick={() => setView('new')}>+ Criar primeiro POP</button>}
          </div>
        </article>
      ) : (
        <div className="forms-grid">
          {filtered.map(pop => {
            const cat = POP_CATEGORIES.find(c => c.id === pop.category);
            return (
              <article key={pop.id} className="form-card" style={{ borderTopColor: cat?.color ?? 'var(--border)', cursor:'pointer' }} onClick={() => { setSelected(pop); setView('detail'); }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <div>
                    <span className="eyebrow" style={{ color: cat?.color }}>{cat?.label}</span>
                    <h3 style={{ fontSize:14, fontWeight:700, marginTop:3 }}>{pop.title}</h3>
                  </div>
                  <span className="badge subtle" style={{ fontSize:10 }}>{pop.frequency}</span>
                </div>
                {pop.objective && <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:8, lineHeight:1.5 }}>{pop.objective.slice(0,80)}{pop.objective.length>80?'…':''}</p>}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11, color:'var(--text-secondary)' }}>
                  <span>{pop.steps.length} passo{pop.steps.length!==1?'s':''}</span>
                  <span>{pop.responsible || '—'}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CONTROLE DE ÓLEO DE FRITURA
// ═══════════════════════════════════════════════════════════════════════════

export function OilControlView({ activeTenant, allTenants, onTenantChange, session }) {
  const [records, setRecords] = useState(() => readOil(activeTenant.id));
  const [equipment, setEquipment] = useState('');
  const [acidez, setAcidez]       = useState('');
  const [cor, setCor]             = useState('');
  const [odor, setOdor]           = useState('');
  const [espuma, setEspuma]       = useState('');
  const [resultado, setResultado] = useState('');
  const [acao, setAcao]           = useState('');
  const [obs, setObs]             = useState('');
  const [saved, setSaved]         = useState(false);

  useEffect(() => { setRecords(readOil(activeTenant.id)); }, [activeTenant.id]);
  useEffect(() => { writeOil(activeTenant.id, records); }, [activeTenant.id, records]);

  const handleSave = () => {
    if (!equipment.trim() || !resultado) return;
    const record = {
      id: uid(), tenantId: activeTenant.id, equipment: equipment.trim(),
      acidez, cor, odor, espuma, resultado, acao: acao.trim(), obs: obs.trim(),
      user: session?.user?.name, createdAt: new Date().toISOString(),
    };
    setRecords(prev => [record, ...prev].slice(0, 200));
    pushSpecialControl('oil', activeTenant.id, record);
    setResultado(''); setAcao(''); setObs('');
    setSaved(true); setTimeout(() => setSaved(false), 3000);
  };

  const CNCBtn = ({ label, value, current, onChange }) => {
    const on = current === value;
    const [bg,color,border] = value==='C' ? ['#dafbe1','#2d6e4a','#4ac26b'] : value==='NC' ? ['#ffebe9','#c0392b','#ff8182'] : ['#faf9f5','#6b6760','#d9d1c4'];
    return <button onClick={() => onChange(on?'':value)} style={{ padding:'5px 14px', borderRadius:6, border:`1.5px solid ${on?border:'#d9d1c4'}`, background:on?bg:'white', color:on?color:'#6b6760', fontWeight:on?700:500, fontSize:12, cursor:'pointer' }}>{label}</button>;
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Controle especial</span><h1>Óleo de Fritura</h1><p className="muted">Registro de qualidade do óleo. Troca obrigatória quando houver alteração. RDC 216/2004.</p></div>
        <div className="page-actions"><select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>{allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Novo registro</span><h2>Avaliação do óleo</h2></div></div>
          <div className="capture-fields">
            <label>Equipamento / Fritadeira<input value={equipment} onChange={e=>setEquipment(e.target.value)} placeholder="Ex.: Fritadeira 1, Tacho" /></label>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {[['Acidez / coloração escura', acidez, setAcidez], ['Cor (escurecimento excessivo)', cor, setCor], ['Odor (ranço ou estranho)', odor, setOdor], ['Formação de espuma', espuma, setEspuma]].map(([lbl, val, setter]) => (
                <div key={lbl} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize:13 }}>{lbl}</span>
                  <div style={{ display:'flex', gap:6 }}>
                    <CNCBtn label="C" value="C" current={val} onChange={setter} />
                    <CNCBtn label="NC" value="NC" current={val} onChange={setter} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginBottom:8 }}>Resultado</div>
              <div style={{ display:'flex', gap:8 }}>
                {[['aprovado','✓ Aprovado'],['reprovado','✗ Trocar óleo'],['observacao','⚠ Em observação']].map(([val,lbl]) => {
                  const on = resultado===val;
                  const [bg,color,border] = val==='aprovado'?['#dafbe1','#2d6e4a','#4ac26b']:val==='reprovado'?['#ffebe9','#c0392b','#ff8182']:['#fdf8e3','#8a4e00','#e3aa14'];
                  return <button key={val} onClick={() => setResultado(on?'':val)} style={{ flex:1, padding:'8px 6px', borderRadius:8, border:`1.5px solid ${on?border:'#d9d1c4'}`, background:on?bg:'white', color:on?color:'#6b6760', fontWeight:on?700:500, fontSize:12, cursor:'pointer', textAlign:'center' }}>{lbl}</button>;
                })}
              </div>
            </div>
            {resultado === 'reprovado' && <label>Ação realizada<input value={acao} onChange={e=>setAcao(e.target.value)} placeholder="Ex.: Óleo descartado e substituído" /></label>}
            <label>Observações<textarea value={obs} onChange={e=>setObs(e.target.value)} placeholder="Observações adicionais…" style={{ minHeight:48 }} /></label>
            <div className="actions-row">
              <button className={`primary-action${resultado?' attention':''}`} onClick={handleSave} disabled={!equipment.trim()||!resultado}>Registrar</button>
            </div>
            {saved && <div className="submission ok">✓ Registro salvo.</div>}
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Registros de óleo</h2></div><span className="badge neutral">{records.length}</span></div>
          <div className="equipment-maintenance-list">
            {records.length===0 ? <p className="muted" style={{ padding:'20px' }}>Nenhum registro ainda.</p>
              : records.slice(0,10).map(r => {
                const tone = r.resultado==='aprovado'?'ok':r.resultado==='reprovado'?'danger':'warn';
                const lbl  = {aprovado:'Aprovado',reprovado:'Trocar óleo',observacao:'Em observação'}[r.resultado];
                return (
                  <div key={r.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid var(--${tone==='ok'?'green':tone==='danger'?'red':'amber'}-border)` }}>
                    <div><strong>{r.equipment}</strong><span>{fmtDT(r.createdAt)} · {r.user}</span>{r.acao&&<span style={{ fontSize:11, color:'var(--text-secondary)' }}>{r.acao}</span>}</div>
                    <span className={`badge ${tone}`}>{lbl}</span>
                  </div>
                );
              })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTROLE DE DESCONGELAMENTO
// ═══════════════════════════════════════════════════════════════════════════

export function ThawControlView({ activeTenant, allTenants, onTenantChange, session }) {
  const [records, setRecords]   = useState(() => readThaw(activeTenant.id));
  const [product, setProduct]   = useState('');
  const [weight, setWeight]     = useState('');
  const [method, setMethod]     = useState('refrigerador');
  const [startAt, setStartAt]   = useState('');
  const [endAt, setEndAt]       = useState('');
  const [tempStart, setTempStart] = useState('');
  const [tempEnd, setTempEnd]   = useState('');
  const [resultado, setResultado] = useState('');
  const [obs, setObs]           = useState('');
  const [saved, setSaved]       = useState(false);

  useEffect(() => { setRecords(readThaw(activeTenant.id)); }, [activeTenant.id]);
  useEffect(() => { writeThaw(activeTenant.id, records); }, [activeTenant.id, records]);

  const METHODS = [
    { id:'refrigerador', label:'Sob refrigeração (até 4°C)', ok:'≤ 4°C' },
    { id:'microondas',   label:'Em forno micro-ondas',       ok:'Imediato uso' },
    { id:'agua_corrente',label:'Sob água corrente potável',  ok:'< 21°C' },
    { id:'cozimento',    label:'Direto no cozimento',        ok:'Temperatura de cozimento' },
  ];

  const handleSave = () => {
    if (!product.trim() || !resultado) return;
    const thawRecord = { id:uid(), tenantId:activeTenant.id, product:product.trim(), weight:weight.trim(), method, startAt, endAt, tempStart, tempEnd, resultado, obs:obs.trim(), user:session?.user?.name, createdAt:new Date().toISOString() };
    setRecords(prev => [thawRecord, ...prev].slice(0,200));
    pushSpecialControl('thaw', activeTenant.id, thawRecord);
    setProduct(''); setWeight(''); setMethod('refrigerador'); setStartAt(''); setEndAt(''); setTempStart(''); setTempEnd(''); setResultado(''); setObs('');
    setSaved(true); setTimeout(() => setSaved(false), 3000);
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Controle especial</span><h1>Descongelamento</h1><p className="muted">Registro do processo de descongelamento conforme RDC 216/2004.</p></div>
        <div className="page-actions"><select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>{allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Novo registro</span><h2>Iniciar descongelamento</h2></div></div>
          <div className="capture-fields">
            <div className="grid-2">
              <label>Produto<input value={product} onChange={e=>setProduct(e.target.value)} placeholder="Ex.: Frango, Carne bovina" /></label>
              <label>Quantidade / Peso<input value={weight} onChange={e=>setWeight(e.target.value)} placeholder="Ex.: 2 kg, 500 g" /></label>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginBottom:8 }}>Método de descongelamento</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {METHODS.map(m => (
                  <div key={m.id} onClick={() => setMethod(m.id)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderRadius:8, border:`1.5px solid ${method===m.id?'var(--blue-border)':'var(--border)'}`, background:method===m.id?'var(--blue-light)':'var(--surface)', cursor:'pointer' }}>
                    <div><div style={{ fontSize:13, fontWeight:600 }}>{m.label}</div><div style={{ fontSize:11, color:'var(--text-secondary)' }}>Critério: {m.ok}</div></div>
                    {method===m.id && <span style={{ color:'var(--blue)', fontWeight:700 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="grid-2">
              <label>Início<input type="datetime-local" value={startAt} onChange={e=>setStartAt(e.target.value)} /></label>
              <label>Término<input type="datetime-local" value={endAt} onChange={e=>setEndAt(e.target.value)} /></label>
            </div>
            <div className="grid-2">
              <label>Temp. no início (°C)<input inputMode="decimal" value={tempStart} onChange={e=>setTempStart(e.target.value)} placeholder="°C" /></label>
              <label>Temp. no término (°C)<input inputMode="decimal" value={tempEnd} onChange={e=>setTempEnd(e.target.value)} placeholder="°C" /></label>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginBottom:8 }}>Resultado</div>
              <div style={{ display:'flex', gap:8 }}>
                {[['conforme','✓ Conforme'],['nao_conforme','✗ Não conforme'],['descartado','⊗ Descartado']].map(([val,lbl]) => {
                  const on = resultado===val;
                  const [bg,color,border] = val==='conforme'?['#dafbe1','#2d6e4a','#4ac26b']:val==='descartado'?['#ffebe9','#c0392b','#ff8182']:['#fdf8e3','#8a4e00','#e3aa14'];
                  return <button key={val} onClick={() => setResultado(on?'':val)} style={{ flex:1, padding:'8px 6px', borderRadius:8, border:`1.5px solid ${on?border:'#d9d1c4'}`, background:on?bg:'white', color:on?color:'#6b6760', fontWeight:on?700:500, fontSize:12, cursor:'pointer', textAlign:'center' }}>{lbl}</button>;
                })}
              </div>
            </div>
            <label>Observações<textarea value={obs} onChange={e=>setObs(e.target.value)} style={{ minHeight:48 }} /></label>
            <div className="actions-row">
              <button className={`primary-action${resultado?' attention':''}`} onClick={handleSave} disabled={!product.trim()||!resultado}>Registrar</button>
            </div>
            {saved && <div className="submission ok">✓ Registro salvo.</div>}
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Registros de descongelamento</h2></div><span className="badge neutral">{records.length}</span></div>
          <div className="equipment-maintenance-list">
            {records.length===0 ? <p className="muted" style={{ padding:'20px' }}>Nenhum registro ainda.</p>
              : records.slice(0,10).map(r => {
                const tone = r.resultado==='conforme'?'ok':r.resultado==='descartado'?'danger':'warn';
                const lbl = {conforme:'Conforme',nao_conforme:'Não conforme',descartado:'Descartado'}[r.resultado];
                const mLabel = METHODS.find(m=>m.id===r.method)?.label ?? r.method;
                return (
                  <div key={r.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid var(--${tone==='ok'?'green':tone==='danger'?'red':'amber'}-border)` }}>
                    <div><strong>{r.product}</strong><span>{r.weight ? `${r.weight} · ` : ''}{mLabel}</span><span>{fmtDT(r.createdAt)} · {r.user}</span></div>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                      <span className={`badge ${tone}`}>{lbl}</span>
                      {r.tempEnd && <span style={{ fontFamily:'var(--mono)', fontSize:12 }}>{r.tempEnd}°C</span>}
                    </div>
                  </div>
                );
              })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. CONTROLE DE RESFRIAMENTO
// ═══════════════════════════════════════════════════════════════════════════

export function CoolingControlView({ activeTenant, allTenants, onTenantChange, session }) {
  const [records, setRecords]   = useState(() => readCool(activeTenant.id));
  const [product, setProduct]   = useState('');
  const [quantity, setQuantity] = useState('');
  const [tempHot, setTempHot]   = useState('');
  const [time1, setTime1]       = useState('');
  const [temp1, setTemp1]       = useState('');
  const [time2, setTime2]       = useState('');
  const [temp2, setTemp2]       = useState('');
  const [method, setMethod]     = useState('banho_gelo');
  const [resultado, setResultado] = useState('');
  const [obs, setObs]           = useState('');
  const [saved, setSaved]       = useState(false);

  useEffect(() => { setRecords(readCool(activeTenant.id)); }, [activeTenant.id]);
  useEffect(() => { writeCool(activeTenant.id, records); }, [activeTenant.id, records]);

  // RDC 216: deve sair de 60°C para ≤10°C em até 2h, depois para ≤4°C em mais 4h
  const checkCompliance = () => {
    const h = Number(tempHot), t1 = Number(temp1), t2 = Number(temp2);
    if (!h || !t1 || !t2) return null;
    return t1 <= 10 && t2 <= 4;
  };
  const compliant = checkCompliance();

  const handleSave = () => {
    if (!product.trim() || !resultado) return;
    const coolRecord = { id:uid(), tenantId:activeTenant.id, product:product.trim(), quantity:quantity.trim(), tempHot, time1, temp1, time2, temp2, method, resultado, obs:obs.trim(), user:session?.user?.name, createdAt:new Date().toISOString() };
    setRecords(prev => [coolRecord, ...prev].slice(0,200));
    pushSpecialControl('cool', activeTenant.id, coolRecord);
    setProduct(''); setQuantity(''); setTempHot(''); setTime1(''); setTemp1(''); setTime2(''); setTemp2(''); setMethod('banho_gelo'); setResultado(''); setObs('');
    setSaved(true); setTimeout(() => setSaved(false), 3000);
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div><span className="eyebrow">Controle especial</span><h1>Resfriamento</h1><p className="muted">Monitoramento do resfriamento rápido. Critério RDC 216: 60°C → ≤10°C em 2h → ≤4°C em 6h.</p></div>
        <div className="page-actions"><select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>{allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>

      {/* Criteria reminder */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        {[['Temp. inicial','≥ 60°C (saída do cozimento)','neutral'],['Após 2 horas','≤ 10°C','warn'],['Após 6 horas','≤ 4°C (armazenamento)','ok']].map(([label,value,tone]) => (
          <div key={label} className={`audit-stat ${tone}`} style={{ flex:1, minWidth:120 }}><span>{label}</span><strong style={{ fontSize:18 }}>{value}</strong></div>
        ))}
      </div>

      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Novo registro</span><h2>Registrar resfriamento</h2></div></div>
          <div className="capture-fields">
            <div className="grid-2">
              <label>Produto / Preparação<input value={product} onChange={e=>setProduct(e.target.value)} placeholder="Ex.: Frango assado, Arroz" /></label>
              <label>Quantidade<input value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="Ex.: 3 kg, 5 L" /></label>
            </div>
            <label>Método de resfriamento
              <select value={method} onChange={e=>setMethod(e.target.value)}>
                <option value="banho_gelo">Banho de gelo</option>
                <option value="blast_chiller">Blast chiller / abatedouro</option>
                <option value="porcoes_pequenas">Divisão em porções pequenas</option>
                <option value="geladeira">Geladeira / câmara fria</option>
              </select>
            </label>
            <label>Temperatura de saída do cozimento (°C)<input inputMode="decimal" value={tempHot} onChange={e=>setTempHot(e.target.value)} placeholder="≥ 60°C" /></label>
            <div className="grid-2">
              <label>Horário — 1ª leitura (2h)<input type="time" value={time1} onChange={e=>setTime1(e.target.value)} /></label>
              <label>Temperatura na 1ª leitura (°C)<input inputMode="decimal" value={temp1} onChange={e=>setTemp1(e.target.value)} placeholder="deve ser ≤ 10°C" /></label>
            </div>
            <div className="grid-2">
              <label>Horário — 2ª leitura (6h)<input type="time" value={time2} onChange={e=>setTime2(e.target.value)} /></label>
              <label>Temperatura na 2ª leitura (°C)<input inputMode="decimal" value={temp2} onChange={e=>setTemp2(e.target.value)} placeholder="deve ser ≤ 4°C" /></label>
            </div>
            {compliant !== null && (
              <div className={`submission ${compliant?'ok':'danger'}`}>
                {compliant ? '✓ Resfriamento dentro dos critérios da RDC 216.' : '✕ Fora do critério! Verificar ação corretiva.'}
              </div>
            )}
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginBottom:8 }}>Resultado final</div>
              <div style={{ display:'flex', gap:8 }}>
                {[['conforme','✓ Conforme'],['nao_conforme','✗ Não conforme'],['descartado','⊗ Descartado']].map(([val,lbl]) => {
                  const on = resultado===val;
                  const [bg,color,border] = val==='conforme'?['#dafbe1','#2d6e4a','#4ac26b']:val==='descartado'?['#ffebe9','#c0392b','#ff8182']:['#fdf8e3','#8a4e00','#e3aa14'];
                  return <button key={val} onClick={() => setResultado(on?'':val)} style={{ flex:1, padding:'8px 6px', borderRadius:8, border:`1.5px solid ${on?border:'#d9d1c4'}`, background:on?bg:'white', color:on?color:'#6b6760', fontWeight:on?700:500, fontSize:12, cursor:'pointer', textAlign:'center' }}>{lbl}</button>;
                })}
              </div>
            </div>
            <label>Observações<textarea value={obs} onChange={e=>setObs(e.target.value)} style={{ minHeight:48 }} /></label>
            <div className="actions-row">
              <button className={`primary-action${resultado?' attention':''}`} onClick={handleSave} disabled={!product.trim()||!resultado}>Registrar</button>
            </div>
            {saved && <div className="submission ok">✓ Registro salvo.</div>}
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Registros de resfriamento</h2></div><span className="badge neutral">{records.length}</span></div>
          <div className="equipment-maintenance-list">
            {records.length===0 ? <p className="muted" style={{ padding:'20px' }}>Nenhum registro ainda.</p>
              : records.slice(0,10).map(r => {
                const tone = r.resultado==='conforme'?'ok':r.resultado==='descartado'?'danger':'warn';
                const lbl = {conforme:'Conforme',nao_conforme:'Não conforme',descartado:'Descartado'}[r.resultado];
                return (
                  <div key={r.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid var(--${tone==='ok'?'green':tone==='danger'?'red':'amber'}-border)` }}>
                    <div><strong>{r.product}</strong><span>{r.quantity ? `${r.quantity} · ` : ''}{fmtDT(r.createdAt)} · {r.user}</span>
                      {r.temp2 && <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--text-secondary)' }}>Final: {r.temp2}°C</span>}
                    </div>
                    <span className={`badge ${tone}`}>{lbl}</span>
                  </div>
                );
              })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. TRATAMENTO TÉRMICO
// ═══════════════════════════════════════════════════════════════════════════

export const readThermal  = (id) => sl(sk('thermal', id), []);
export const writeThermal = (id, v) => ss(sk('thermal', id), v);

export function ThermalControlView({ activeTenant, allTenants, onTenantChange, session }) {
  const [records, setRecords]   = useState(() => readThermal(activeTenant.id));
  const [product, setProduct]   = useState('');
  const [quantity, setQuantity] = useState('');
  const [equipment, setEquipment] = useState('');
  const [tempTarget, setTempTarget] = useState('');
  const [tempReached, setTempReached] = useState('');
  const [timeReached, setTimeReached] = useState('');
  const [holdTime, setHoldTime] = useState('');
  const [resultado, setResultado] = useState('');
  const [obs, setObs]           = useState('');
  const [saved, setSaved]       = useState(false);

  useEffect(() => { setRecords(readThermal(activeTenant.id)); }, [activeTenant.id]);
  useEffect(() => { writeThermal(activeTenant.id, records); }, [activeTenant.id, records]);

  // RDC 216: centro geométrico ≥ 70°C ou combinação tempo/temp equivalente
  const isCompliant = Number(tempReached) >= 70;

  const handleSave = () => {
    if (!product.trim() || !resultado) return;
    const thermalRecord = {
      id: uid(), tenantId: activeTenant.id, product: product.trim(), quantity: quantity.trim(),
      equipment: equipment.trim(), tempTarget, tempReached, timeReached, holdTime,
      resultado, obs: obs.trim(), user: session?.user?.name, createdAt: new Date().toISOString()
    };
    setRecords(prev => [thermalRecord, ...prev].slice(0, 200));
    pushSpecialControl('thermal', activeTenant.id, thermalRecord);
    setProduct(''); setQuantity(''); setEquipment(''); setTempTarget('');
    setTempReached(''); setTimeReached(''); setHoldTime(''); setResultado(''); setObs('');
    setSaved(true); setTimeout(() => setSaved(false), 3000);
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Controle especial</span>
          <h1>Tratamento Térmico</h1>
          <p className="muted">Controle de cocção e pasteurização. Critério RDC 216: temperatura no centro geométrico ≥ 70°C.</p>
        </div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* Criteria reminder */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        {[
          ['Critério principal','≥ 70°C no centro geométrico','ok'],
          ['Alternativa','65°C por 15 minutos','warn'],
          ['Alternativa','55°C por 1 hora e 46 min','neutral'],
        ].map(([label, value, tone]) => (
          <div key={label} className={`audit-stat ${tone}`} style={{ flex:1, minWidth:120 }}>
            <span>{label}</span><strong style={{ fontSize:16 }}>{value}</strong>
          </div>
        ))}
      </div>

      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Novo registro</span><h2>Registrar tratamento</h2></div></div>
          <div className="capture-fields">
            <div className="grid-2">
              <label>Produto / Preparação<input value={product} onChange={e=>setProduct(e.target.value)} placeholder="Ex.: Frango assado, Molho" /></label>
              <label>Quantidade<input value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="Ex.: 2 kg, 5 L" /></label>
            </div>
            <label>Equipamento<input value={equipment} onChange={e=>setEquipment(e.target.value)} placeholder="Ex.: Forno combinado, Fogão, Fritadeira" /></label>
            <div className="grid-2">
              <label>Temperatura alvo (°C)<input inputMode="decimal" value={tempTarget} onChange={e=>setTempTarget(e.target.value)} placeholder="Ex.: 180°C (forno)" /></label>
              <label>Horário de início<input type="time" value={timeReached} onChange={e=>setTimeReached(e.target.value)} /></label>
            </div>
            <div className="grid-2">
              <label>Temperatura no centro geométrico (°C)
                <input inputMode="decimal" value={tempReached} onChange={e=>setTempReached(e.target.value)} placeholder="≥ 70°C" />
              </label>
              <label>Tempo de manutenção (min)<input inputMode="numeric" value={holdTime} onChange={e=>setHoldTime(e.target.value)} placeholder="Minutos na temp. mínima" /></label>
            </div>
            {tempReached && (
              <div className={`submission ${isCompliant ? 'ok' : 'danger'}`}>
                {isCompliant ? `✓ ${tempReached}°C — critério atingido.` : `✕ ${tempReached}°C — abaixo de 70°C. Verificar tratamento.`}
              </div>
            )}
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginBottom:8 }}>Resultado</div>
              <div style={{ display:'flex', gap:8 }}>
                {[['conforme','✓ Conforme'],['nao_conforme','✗ Não conforme'],['descartado','⊗ Descartado']].map(([val,lbl]) => {
                  const on = resultado===val;
                  const [bg,color,border] = val==='conforme'?['#dafbe1','#2d6e4a','#4ac26b']:val==='descartado'?['#ffebe9','#c0392b','#ff8182']:['#fdf8e3','#8a4e00','#e3aa14'];
                  return <button key={val} onClick={() => setResultado(on?'':val)} style={{ flex:1, padding:'8px 6px', borderRadius:8, border:`1.5px solid ${on?border:'#d9d1c4'}`, background:on?bg:'white', color:on?color:'#6b6760', fontWeight:on?700:500, fontSize:12, cursor:'pointer', textAlign:'center' }}>{lbl}</button>;
                })}
              </div>
            </div>
            <label>Observações<textarea value={obs} onChange={e=>setObs(e.target.value)} style={{ minHeight:48 }} /></label>
            <div className="actions-row">
              <button className={`primary-action${resultado?' attention':''}`} onClick={handleSave} disabled={!product.trim()||!resultado}>Registrar</button>
            </div>
            {saved && <div className="submission ok">✓ Registro salvo.</div>}
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Registros de tratamento térmico</h2></div><span className="badge neutral">{records.length}</span></div>
          <div className="equipment-maintenance-list">
            {records.length === 0 ? <p className="muted" style={{ padding:'20px' }}>Nenhum registro ainda.</p>
              : records.slice(0, 10).map(r => {
                const tone = r.resultado==='conforme'?'ok':r.resultado==='descartado'?'danger':'warn';
                const lbl = {conforme:'Conforme',nao_conforme:'Não conforme',descartado:'Descartado'}[r.resultado];
                return (
                  <div key={r.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid var(--${tone==='ok'?'green':tone==='danger'?'red':'amber'}-border)` }}>
                    <div>
                      <strong>{r.product}</strong>
                      <span>{r.equipment ? `${r.equipment} · ` : ''}{fmtDT(r.createdAt)} · {r.user}</span>
                      {r.tempReached && <span style={{ fontFamily:'var(--mono)', fontSize:12, color: Number(r.tempReached)>=70?'var(--green)':'var(--red)', fontWeight:700 }}>Centro: {r.tempReached}°C</span>}
                    </div>
                    <span className={`badge ${tone}`}>{lbl}</span>
                  </div>
                );
              })}
          </div>
        </article>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. IMPRESSÃO RÁPIDA — TUDO DE HOJE
// ═══════════════════════════════════════════════════════════════════════════

export function printTodayReport(activeTenant, records) {
  const p       = (() => { try { const r = localStorage.getItem(`nutriops.company.profile.${activeTenant.id}`); return r ? JSON.parse(r) : {}; } catch { return {}; } })();
  const todayStr = new Date().toDateString();
  const todayRecords = records.filter(r =>
    r.tenantId === activeTenant.id &&
    new Date(r.createdAt).toDateString() === todayStr
  ).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));

  const date = new Date().toLocaleString('pt-BR');
  const toneLabel = r => {
    const t = ({ok:'Conforme',warn:'Desvio leve',danger:'Fora da faixa',neutral:'—'})[
      (() => { const v=Number(r?.value),mn=Number(r?.min),mx=Number(r?.max); if(isNaN(v)||isNaN(mn)||isNaN(mx))return'neutral'; if(v>=mn&&v<=mx)return'ok'; if(v>=mn-3&&v<=mx+3)return'warn'; return'danger'; })()
    ];
    return t;
  };

  const rows = todayRecords.map(r => `<tr>
    <td>${new Date(r.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td>
    <td><strong>${r.equipmentInput||r.equipment||'—'}</strong>${r.equipmentLocation?`<br><small>${r.equipmentLocation}</small>`:''}</td>
    <td style="font-family:monospace;font-size:14px;font-weight:700">${r.value}°C</td>
    <td style="font-size:9px;color:#6b6760">${r.min??'?'}–${r.max??'?'}°C</td>
    <td>${toneLabel(r)}</td>
    <td style="font-size:9px">${r.user||'—'}</td>
    <td style="font-size:9px;color:#6b6760">${r.note||'—'}</td>
  </tr>`).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>Registros do Dia — ${activeTenant.name}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#141413;padding:20px}
  .company-header{display:flex;justify-content:space-between;padding:8px 12px;background:#faf9f5;border:1px solid #d9d1c4;border-radius:4px;margin-bottom:12px}
  .company-name{font-size:13px;font-weight:800}.company-detail{font-size:9px;color:#6b6760}
  h1{font-size:16px;font-weight:800;margin-bottom:4px}.meta{color:#6b6760;font-size:9px;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #d9d1c4}
  table{width:100%;border-collapse:collapse}th{background:#faf9f5;padding:5px 7px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #d9d1c4;color:#6b6760}
  td{padding:6px 7px;border-bottom:1px solid #eaeef2;vertical-align:top}tr:last-child td{border-bottom:none}small{font-size:8px;color:#6b6760}
  .sig{display:flex;gap:40px;margin-top:32px}.sig-line{flex:1;border-top:1px solid #374151;padding-top:4px;font-size:9px;color:#6b6760;text-align:center}
  .footer{margin-top:16px;padding-top:8px;border-top:1px solid #d9d1c4;font-size:8px;color:#9198a1;display:flex;justify-content:space-between}
  @page{size:A4;margin:12mm}</style></head><body>
  <div class="company-header">
    <div>
      <div class="company-name">${p.razaoSocial || activeTenant.name}</div>
      ${p.cnpj ? `<div class="company-detail">CNPJ: ${p.cnpj}</div>` : ''}
      ${p.endereco ? `<div class="company-detail">${p.endereco}</div>` : ''}
    </div>
    ${p.atividade ? `<div style="font-size:10px;font-weight:700;color:#cc785c">${p.atividade}</div>` : ''}
  </div>
  <h1>Registros do Dia — ${activeTenant.name}</h1>
  <p class="meta">${new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${todayRecords.length} registros · Gerado às ${date}</p>
  ${todayRecords.length === 0
    ? '<p style="color:#6b6760;padding:20px 0">Nenhum registro encontrado para hoje.</p>'
    : `<table><thead><tr><th>Hora</th><th>Equipamento</th><th>Temp.</th><th>Faixa</th><th>Status</th><th>Responsável</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table>`}
  <div class="sig">
    <div class="sig-line">Responsável pela operação · Data: ___/___/______</div>
    <div class="sig-line">${p.rtNome || 'Nutricionista RT'}${p.rtCrn ? ` · ${p.rtCrn}` : ''}</div>
  </div>
  <div class="footer"><span>NutriOPS · RDC 216/2004 · ${p.razaoSocial || activeTenant.name}</span>${p.cnpj ? `<span>CNPJ: ${p.cnpj}</span>` : ''}<span>${date}</span></div>
  </body></html>`);
  win.document.close(); setTimeout(() => win.print(), 400);
}
