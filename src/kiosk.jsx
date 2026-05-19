import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTemperatureRepository } from './repository';

// ─── Helpers ───────────────────────────────────────────────────────────────

function resolveTemperatureLimits(label = '') {
  const l = label.toLowerCase();
  if (l.includes('freezer') || l.includes('congel') || l.includes('congelada')) return { min: -25, max: -18 };
  return { min: 0, max: 9 };
}

function resolveTemperatureTone(value, min, max) {
  const v = Number(value), mn = Number(min), mx = Number(max);
  if (isNaN(v) || isNaN(mn) || isNaN(mx)) return 'neutral';
  if (v >= mn && v <= mx) return 'ok';
  if (v >= mn - 3 && v <= mx + 3) return 'warn';
  return 'danger';
}

function fmtTime() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const KIOSK_KEY = 'nutriops.kiosk.config';
const ls = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const lw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function readKioskConfig() { return ls(KIOSK_KEY, null); }
export function writeKioskConfig(v) { lw(KIOSK_KEY, v); }

// ─── Numpad ────────────────────────────────────────────────────────────────

function Numpad({ value, onChange, onConfirm, label, hint, tone }) {
  const handleKey = (k) => {
    if (k === '⌫') { onChange(value.slice(0, -1)); return; }
    if (k === '.' && value.includes('.')) return;
    if (k === '-' && value.length > 0) return;
    if (value.length >= 6) return;
    onChange(value + k);
  };

  const keys = [['7','8','9'],['4','5','6'],['1','2','3'],['-','0','.'],['⌫','','✓']];
  const bgTone = tone === 'ok' ? '#dafbe1' : tone === 'warn' ? '#fdf8e3' : tone === 'danger' ? '#ffebe9' : 'white';
  const colorTone = tone === 'ok' ? '#1a7f37' : tone === 'warn' ? '#9a6700' : tone === 'danger' ? '#cf222e' : '#1c2128';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, alignItems:'center' }}>
      {/* Display */}
      <div style={{ width:'100%', padding:'16px 20px', background: bgTone, border:`2px solid ${tone==='ok'?'#4ac26b':tone==='warn'?'#e3aa14':tone==='danger'?'#ff8182':'#d0d7de'}`, borderRadius:16, textAlign:'center', transition:'all .2s' }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#656d76', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:56, fontWeight:800, fontFamily:'monospace', color: colorTone, lineHeight:1, minHeight:64 }}>
          {value || <span style={{ color:'#d0d7de' }}>–</span>}
          {value && <span style={{ fontSize:28, fontWeight:400 }}>°C</span>}
        </div>
        {hint && <div style={{ fontSize:13, color:'#656d76', marginTop:4 }}>{hint}</div>}
      </div>

      {/* Keys */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, width:'100%' }}>
        {keys.flat().map((k, i) => {
          if (k === '') return <div key={i} />;
          const isConfirm = k === '✓';
          const isClear   = k === '⌫';
          return (
            <button key={i} onClick={() => k === '✓' ? onConfirm() : handleKey(k)}
              style={{
                height: 68, borderRadius: 14, border: 'none', cursor: 'pointer',
                fontSize: isConfirm ? 28 : isClear ? 22 : 28,
                fontWeight: 700,
                background: isConfirm ? '#1a7f37' : isClear ? '#ffebe9' : 'white',
                color: isConfirm ? 'white' : isClear ? '#cf222e' : '#1c2128',
                boxShadow: '0 2px 4px rgba(0,0,0,.08)',
                transition: 'transform .1s, background .1s',
                fontFamily: 'inherit',
              }}
              onMouseDown={e => e.currentTarget.style.transform='scale(.95)'}
              onMouseUp={e => e.currentTarget.style.transform='scale(1)'}
              onTouchStart={e => e.currentTarget.style.transform='scale(.95)'}
              onTouchEnd={e => e.currentTarget.style.transform='scale(1)'}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Equipment card ────────────────────────────────────────────────────────

function EquipmentCard({ item, saved, active, onClick }) {
  const tone = saved ? 'ok' : active ? 'active' : 'idle';
  const bg    = tone==='ok' ? '#dafbe1' : tone==='active' ? '#ddf4ff' : 'white';
  const border= tone==='ok' ? '#4ac26b' : tone==='active' ? '#54aeff' : '#d0d7de';
  const color = tone==='ok' ? '#1a7f37' : tone==='active' ? '#1f6feb' : '#1c2128';

  return (
    <button onClick={onClick} style={{ padding:'14px 16px', borderRadius:14, border:`2px solid ${border}`, background:bg, cursor:'pointer', textAlign:'left', transition:'all .15s', fontFamily:'inherit', position:'relative' }}>
      <div style={{ fontSize:15, fontWeight:700, color }}>{item.label}</div>
      <div style={{ fontSize:11, color:'#656d76', marginTop:2 }}>{item.location || 'Sem localização'}</div>
      {saved && <span style={{ position:'absolute', top:8, right:10, fontSize:12, fontWeight:800, color:'#1a7f37' }}>✓✓</span>}
    </button>
  );
}

// ─── Success overlay ───────────────────────────────────────────────────────

function SuccessOverlay({ temperature, equipment, tone, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 2500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const bg    = tone==='ok' ? '#1a7f37' : tone==='warn' ? '#9a6700' : '#cf222e';
  const label = tone==='ok' ? 'Dentro da faixa' : tone==='warn' ? 'Desvio leve' : 'Fora da faixa';
  const icon  = tone==='ok' ? '✓' : '⚠';

  return (
    <div style={{ position:'fixed', inset:0, background:`${bg}ee`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:100, gap:16 }}>
      <div style={{ fontSize:80, color:'white' }}>{icon}</div>
      <div style={{ fontSize:32, fontWeight:800, color:'white' }}>{temperature}°C</div>
      <div style={{ fontSize:18, color:'rgba(255,255,255,.9)' }}>{equipment} — {label}</div>
      <div style={{ fontSize:14, color:'rgba(255,255,255,.7)', marginTop:8 }}>Registro salvo com sucesso</div>
    </div>
  );
}

// ─── Kiosk App ─────────────────────────────────────────────────────────────

export function KioskApp({ config, onExit }) {
  const repository = useMemo(() => getTemperatureRepository(), []);
  const catalog = config.equipmentCatalog ?? [];
  const [activeIdx, setActiveIdx] = useState(0);
  const [value, setValue]         = useState('');
  const [savedValues, setSavedValues] = useState({});
  const [saving, setSaving]       = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [exitAttempts, setExitAttempts] = useState(0);
  const [currentTime, setCurrentTime] = useState(fmtTime());

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(fmtTime()), 10000);
    return () => clearInterval(t);
  }, []);

  const active = catalog[activeIdx];
  const limits = resolveTemperatureLimits(active?.label ?? '');
  const tone   = value ? resolveTemperatureTone(value, limits.min, limits.max) : 'neutral';

  const handleConfirm = useCallback(async () => {
    if (!value || !active || saving) return;
    setSaving(true);
    try {
      const payload = {
        tenantId: config.tenantId, tenantName: config.tenantName,
        equipmentInput: active.label, equipmentKey: active.label,
        equipmentLocation: active.location ?? null,
        user: config.userName ?? 'Quiosque', role: config.userRole ?? 'Colaborador',
        equipment: active.label, measuredAt: fmtTime(), controlMode: 'routine',
        value: Number(value), note: '',
        min: limits.min, max: limits.max,
      };
      await repository.create(payload);
      const tone = resolveTemperatureTone(value, limits.min, limits.max);
      setSavedValues(prev => ({ ...prev, [active.label]: value }));
      setSuccessData({ temperature: value, equipment: active.label, tone });
      setValue('');
      // Auto-advance to next unsaved
      const next = catalog.findIndex((eq, i) => i > activeIdx && !savedValues[eq.label]);
      if (next !== -1) setTimeout(() => setActiveIdx(next), 2600);
    } finally { setSaving(false); }
  }, [value, active, saving, config, limits, repository, catalog, activeIdx, savedValues]);

  const allSaved = catalog.every(eq => savedValues[eq.label]);
  const savedCount = Object.keys(savedValues).length;

  const handleExit = () => {
    if (exitAttempts < 2) { setExitAttempts(e => e + 1); return; }
    onExit();
  };

  return (
    <div style={{ minHeight:'100vh', background:'#f0f4f8', fontFamily:'-apple-system, "Segoe UI", system-ui, sans-serif', userSelect:'none' }}>
      {successData && <SuccessOverlay {...successData} onDismiss={() => setSuccessData(null)} />}

      {/* Header */}
      <div style={{ background:'#0d1117', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:7, background:'linear-gradient(135deg,#1c73e8,#2da6ff)', display:'grid', placeItems:'center', fontSize:14, fontWeight:800, color:'white' }}>N</div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:'#e6edf3', letterSpacing:'-.03em' }}>NutriOPS</div>
            <div style={{ fontSize:11, color:'#7d8590' }}>{config.tenantName} · {config.userName}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:22, fontWeight:700, fontFamily:'monospace', color:'#e6edf3' }}>{currentTime}</div>
            <div style={{ fontSize:10, color:'#7d8590' }}>{savedCount}/{catalog.length} registrados</div>
          </div>
          <button onClick={handleExit} style={{ background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.12)', color:'#7d8590', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>
            {exitAttempts === 0 ? 'Sair' : exitAttempts === 1 ? 'Confirmar?' : 'Sair agora'}
          </button>
        </div>
      </div>

      {allSaved ? (
        /* All done screen */
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'calc(100vh - 57px)', gap:16, padding:24 }}>
          <div style={{ fontSize:72, color:'#1a7f37' }}>✓</div>
          <h2 style={{ fontSize:28, fontWeight:800, letterSpacing:'-.03em', color:'#1a7f37' }}>Todos os registros concluídos!</h2>
          <p style={{ color:'#656d76', fontSize:15 }}>Todos os {catalog.length} equipamentos foram registrados com sucesso.</p>
          <button onClick={() => { setSavedValues({}); setActiveIdx(0); setValue(''); }}
            style={{ marginTop:8, padding:'12px 28px', background:'#0969da', color:'white', border:'none', borderRadius:12, fontSize:16, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
            Iniciar novo registro
          </button>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:0, minHeight:'calc(100vh - 57px)' }}>
          {/* Left: Equipment list */}
          <div style={{ padding:20, borderRight:'1px solid #e2e8f0', overflowY:'auto' }}>
            <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#656d76', marginBottom:12 }}>
              Equipamentos — {config.tenantName}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:10 }}>
              {catalog.map((item, i) => (
                <EquipmentCard key={item.label} item={item} saved={Boolean(savedValues[item.label])} active={i===activeIdx} onClick={() => { setActiveIdx(i); setValue(''); }} />
              ))}
            </div>
          </div>

          {/* Right: Numpad */}
          <div style={{ padding:20, background:'#f8fafc' }}>
            <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#656d76', marginBottom:12 }}>
              Registrar temperatura
            </div>
            <Numpad
              value={value}
              onChange={setValue}
              onConfirm={handleConfirm}
              label={active?.label ?? '—'}
              hint={`Faixa: ${limits.min}°C a ${limits.max}°C${active?.location ? ` · ${active.location}` : ''}`}
              tone={tone}
            />
            {saving && <div style={{ textAlign:'center', marginTop:12, fontSize:13, color:'#656d76' }}>Salvando…</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Kiosk Setup (modal dentro do app normal) ──────────────────────────────

export function KioskSetup({ activeTenant, equipmentCatalog, session, onLaunch, onCancel }) {
  const [selectedEquips, setSelectedEquips] = useState(equipmentCatalog.map(e => e.label));

  const toggle = (label) => setSelectedEquips(prev =>
    prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
  );

  const launch = () => {
    const cfg = {
      tenantId: activeTenant.id,
      tenantName: activeTenant.name,
      userName: session?.user?.name ?? 'Quiosque',
      userRole: session?.user?.role ?? 'Colaborador',
      equipmentCatalog: equipmentCatalog.filter(e => selectedEquips.includes(e.label)),
    };
    writeKioskConfig(cfg);
    onLaunch(cfg);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:24 }}>
      <div style={{ background:'white', borderRadius:16, padding:28, width:'100%', maxWidth:480, boxShadow:'0 24px 48px rgba(0,0,0,.2)' }}>
        <h2 style={{ fontSize:20, fontWeight:800, letterSpacing:'-.03em', marginBottom:6 }}>Modo Quiosque</h2>
        <p style={{ fontSize:13, color:'#656d76', marginBottom:20 }}>Interface simplificada para tablet na loja. Selecione os equipamentos a registrar.</p>

        <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
          {equipmentCatalog.map(eq => {
            const sel = selectedEquips.includes(eq.label);
            return (
              <div key={eq.label} onClick={() => toggle(eq.label)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderRadius:10, border:`1.5px solid ${sel?'#54aeff':'#d0d7de'}`, background:sel?'#ddf4ff':'white', cursor:'pointer' }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color: sel?'#1f6feb':'#1c2128' }}>{eq.label}</div>
                  {eq.location && <div style={{ fontSize:11, color:'#656d76' }}>{eq.location}</div>}
                </div>
                <span style={{ width:20, height:20, borderRadius:4, border:`2px solid ${sel?'#0969da':'#d0d7de'}`, background:sel?'#0969da':'white', display:'grid', placeItems:'center', flexShrink:0 }}>
                  {sel && <span style={{ color:'white', fontSize:12, fontWeight:800 }}>✓</span>}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCancel} style={{ flex:1, padding:'10px', borderRadius:10, border:'1px solid #d0d7de', background:'white', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit' }}>Cancelar</button>
          <button onClick={launch} disabled={selectedEquips.length === 0} style={{ flex:2, padding:'10px', borderRadius:10, border:'none', background: selectedEquips.length===0?'#d0d7de':'#0969da', color:'white', cursor:selectedEquips.length===0?'not-allowed':'pointer', fontSize:14, fontWeight:700, fontFamily:'inherit' }}>
            🖥️ Lançar quiosque ({selectedEquips.length} equip.)
          </button>
        </div>
      </div>
    </div>
  );
}
