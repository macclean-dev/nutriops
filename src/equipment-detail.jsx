// ─────────────────────────────────────────────────────────────────────────────
// Equipment drill-down: chart grande + modal full-detail.
// Extraído pra ser reutilizado por overview-v2 e pages.jsx (ChartsView etc).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo } from 'react';
import { resolveLimits, resolveTone } from './limits';

// ─── Token helpers ────────────────────────────────────────────────────────

export function toneColor(tone) {
  return tone === 'ok' ? 'var(--green)' :
         tone === 'warn' ? 'var(--amber)' :
         tone === 'danger' ? 'var(--red)' :
         'var(--text-secondary)';
}
export function toneBg(tone) {
  return tone === 'ok' ? 'var(--green-light)' :
         tone === 'warn' ? 'var(--amber-light)' :
         tone === 'danger' ? 'var(--red-light)' :
         'var(--surface-muted)';
}

// ─── EquipmentChart — SVG puro com eixos ─────────────────────────────────

export function EquipmentChart({ data, limits, width = 720, height = 280 }) {
  if (!data?.length) {
    return (
      <div style={{
        width:'100%', height, display:'flex', alignItems:'center', justifyContent:'center',
        color:'var(--text-placeholder)', fontSize:13, fontStyle:'italic',
        background:'var(--surface-muted)', borderRadius:'var(--r-lg)',
      }}>
        sem leituras pra mostrar
      </div>
    );
  }

  const padL = 48, padR = 12, padT = 16, padB = 32;
  const cW = width - padL - padR;
  const cH = height - padT - padB;

  const span = (limits.max - limits.min) || 1;
  const yMin = Math.min(limits.min - span * 0.4, Math.min(...data.map(d => d.value)));
  const yMax = Math.max(limits.max + span * 0.4, Math.max(...data.map(d => d.value)));

  const sx = (i) => padL + (i / Math.max(data.length - 1, 1)) * cW;
  const sy = (v) => padT + cH - ((v - yMin) / (yMax - yMin)) * cH;

  const points = data.map((p, i) => ({
    x: sx(i), y: sy(p.value),
    value: p.value, createdAt: p.createdAt,
  }));
  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length-1].x.toFixed(1)},${padT+cH} L${padL},${padT+cH} Z`;

  const yTicks = [yMin, limits.min, (limits.min + limits.max) / 2, limits.max, yMax];
  const xLabelEvery = Math.max(1, Math.floor(data.length / 6));
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}h`;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width:'100%', height:'auto', display:'block' }}>
      <rect x={padL} y={sy(limits.max)} width={cW} height={Math.max(0, sy(limits.min) - sy(limits.max))}
        fill="var(--green-light)" />
      <line x1={padL} y1={sy(limits.min)} x2={padL+cW} y2={sy(limits.min)} stroke="var(--green-border)" strokeDasharray="3 3" strokeWidth={0.8} />
      <line x1={padL} y1={sy(limits.max)} x2={padL+cW} y2={sy(limits.max)} stroke="var(--green-border)" strokeDasharray="3 3" strokeWidth={0.8} />
      <line x1={padL} y1={padT} x2={padL} y2={padT+cH} stroke="var(--border)" strokeWidth={1} />
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={padL-3} y1={sy(v)} x2={padL} y2={sy(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={padL-6} y={sy(v)} dominantBaseline="middle" textAnchor="end"
            fontSize={10} fill="var(--text-secondary)" fontFamily="var(--mono)">
            {Number(v).toFixed(1)}°
          </text>
        </g>
      ))}
      <line x1={padL} y1={padT+cH} x2={padL+cW} y2={padT+cH} stroke="var(--border)" strokeWidth={1} />
      {points.map((p, i) => i % xLabelEvery === 0 ? (
        <text key={i} x={p.x} y={padT+cH+14} textAnchor="middle"
          fontSize={9} fill="var(--text-secondary)" fontFamily="var(--mono)">
          {fmtTime(p.createdAt)}
        </text>
      ) : null)}
      <path d={areaPath} fill="var(--primary)" fillOpacity={0.08} />
      <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => {
        const tone = resolveTone(p.value, limits.min, limits.max);
        return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={toneColor(tone)} stroke="var(--surface)" strokeWidth={1.5} />;
      })}
    </svg>
  );
}

// ─── EquipmentDetailModal — drill-down completo ──────────────────────────

export function EquipmentDetailModal({ equipment, history, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Usa min/max do próprio objeto se cadastrado, senão heurística pelo nome
  const limits = resolveLimits(equipment.label, equipment);

  // Stats: até 30 últimas leituras
  const recent = history.slice(-30);
  const stats = useMemo(() => {
    if (!recent.length) return null;
    const values = recent.map(r => Number(r.value)).filter(v => !isNaN(v));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const ok = recent.filter(r => resolveTone(r.value, limits.min, limits.max) === 'ok').length;
    const compliance = Math.round((ok / recent.length) * 100);
    return { min, max, avg, std, compliance, count: recent.length };
  }, [recent, limits]);

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(20,20,19,.55)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'flex-start', justifyContent:'center',
      padding:'40px 24px', overflowY:'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:'var(--surface)', borderRadius:'var(--r-xl)',
        width:'100%', maxWidth:880,
        boxShadow:'var(--shadow-lg)',
        display:'flex', flexDirection:'column',
      }}>
        {/* Header */}
        <div style={{
          display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16,
          padding:'24px 28px 18px', borderBottom:'1px solid var(--border-subtle)',
        }}>
          <div>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--text-secondary)', marginBottom:4 }}>
              {equipment.location || 'Equipamento'}
            </div>
            <h2 style={{
              fontFamily:'var(--serif)', fontSize:30, fontWeight:400,
              letterSpacing:'-.02em', color:'var(--text)', margin:0,
            }}>{equipment.label}</h2>
            <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:6 }}>
              Faixa permitida: <strong style={{ color:'var(--green)' }}>{limits.min}° a {limits.max}°</strong> · {recent.length} leitura{recent.length!==1?'s':''} mostrada{recent.length!==1?'s':''}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{
            background:'none', border:'1px solid var(--border)', borderRadius:'var(--r)',
            padding:'6px 10px', cursor:'pointer', fontFamily:'var(--font)',
            fontSize:13, color:'var(--text-secondary)',
          }}>Fechar (Esc)</button>
        </div>

        {/* Stats grid */}
        {stats && (
          <div style={{
            display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:0,
            borderBottom:'1px solid var(--border-subtle)',
          }}>
            {[
              ['Mínima',        `${stats.min.toFixed(1)}°`, resolveTone(stats.min, limits.min, limits.max)],
              ['Máxima',        `${stats.max.toFixed(1)}°`, resolveTone(stats.max, limits.min, limits.max)],
              ['Média',         `${stats.avg.toFixed(1)}°`, resolveTone(stats.avg, limits.min, limits.max)],
              ['Desvio padrão', `${stats.std.toFixed(2)}°`, 'neutral'],
              ['Conformidade',  `${stats.compliance}%`, stats.compliance >= 90 ? 'ok' : stats.compliance >= 70 ? 'warn' : 'danger'],
            ].map(([label, value, tone], i, arr) => (
              <div key={label} style={{
                padding:'16px 18px',
                borderRight: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                display:'flex', flexDirection:'column', gap:4,
              }}>
                <div style={{ fontSize:9, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--text-secondary)' }}>{label}</div>
                <div style={{ fontFamily:'var(--serif)', fontSize:22, color: toneColor(tone) }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Chart */}
        <div style={{ padding:'18px 24px' }}>
          <EquipmentChart data={recent} limits={limits} />
        </div>

        {/* Table */}
        <div style={{
          padding:'8px 28px 24px', borderTop:'1px solid var(--border-subtle)',
          maxHeight:280, overflowY:'auto',
        }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--text-secondary)', padding:'12px 0 8px' }}>
            Histórico completo
          </div>
          {recent.length === 0 ? (
            <div style={{ padding:'16px 0', color:'var(--text-placeholder)', fontStyle:'italic', fontSize:13 }}>
              Nenhuma leitura registrada ainda.
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--border-subtle)' }}>
                  <th style={{ textAlign:'left', padding:'8px 4px', fontSize:10, fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-secondary)' }}>Quando</th>
                  <th style={{ textAlign:'right', padding:'8px 4px', fontSize:10, fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-secondary)' }}>Temp</th>
                  <th style={{ textAlign:'left', padding:'8px 4px', fontSize:10, fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-secondary)' }}>Status</th>
                  <th style={{ textAlign:'left', padding:'8px 4px', fontSize:10, fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-secondary)' }}>Quem</th>
                </tr>
              </thead>
              <tbody>
                {[...recent].reverse().map(r => {
                  const tone = resolveTone(r.value, limits.min, limits.max);
                  return (
                    <tr key={r.id} style={{ borderBottom:'1px solid var(--border-subtle)' }}>
                      <td style={{ padding:'8px 4px', color:'var(--text-secondary)', fontFamily:'var(--mono)', fontSize:11 }}>
                        {new Date(r.createdAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                      </td>
                      <td style={{ padding:'8px 4px', textAlign:'right', fontFamily:'var(--mono)', fontWeight:600, color: toneColor(tone) }}>
                        {r.value}°
                      </td>
                      <td style={{ padding:'8px 4px' }}>
                        <span style={{
                          padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600,
                          letterSpacing:'.06em', textTransform:'uppercase',
                          background:toneBg(tone), color:toneColor(tone),
                        }}>
                          {tone === 'ok' ? 'OK' : tone === 'warn' ? 'Atenção' : tone === 'danger' ? 'Crítico' : '—'}
                        </span>
                      </td>
                      <td style={{ padding:'8px 4px', color:'var(--text)' }}>{r.user}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
