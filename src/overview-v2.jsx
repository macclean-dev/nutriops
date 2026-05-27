// ─────────────────────────────────────────────────────────────────────────────
// Visão Geral v2 — dashboard adaptativo por perfil de usuário.
//
// Premissa de design (Linear / Stripe / Vercel):
//   - Tipografia generosa, números grandes em serif
//   - Espaço respirável (gap 16-24px entre seções)
//   - Cor com função (semântica), não decoração
//   - Hierarquia clara: pulse → status → atividade → tarefas
//   - Cada perfil vê primeiro o que mais importa pra ele
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState, useEffect } from 'react';

// ─── helpers ──────────────────────────────────────────────────────────────

function resolveLimits(label = '') {
  const l = label.toLowerCase();
  if (l.includes('freezer') || l.includes('congel')) return { min: -25, max: -18 };
  return { min: 0, max: 9 };
}

function resolveTone(value, min, max) {
  const v = Number(value), mn = Number(min), mx = Number(max);
  if (isNaN(v)) return 'neutral';
  if (v >= mn && v <= mx) return 'ok';
  if (v >= mn - 3 && v <= mx + 3) return 'warn';
  return 'danger';
}

function toneColor(tone) {
  return tone === 'ok' ? 'var(--green)' :
         tone === 'warn' ? 'var(--amber)' :
         tone === 'danger' ? 'var(--red)' :
         'var(--text-secondary)';
}

function toneBg(tone) {
  return tone === 'ok' ? 'var(--green-light)' :
         tone === 'warn' ? 'var(--amber-light)' :
         tone === 'danger' ? 'var(--red-light)' :
         'var(--surface-muted)';
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// ─── Chart maior pra drill-down (com eixos) ──────────────────────────────

function EquipmentChart({ data, limits, width = 720, height = 280 }) {
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

  // Y-scale: faixa permitida ± 40%
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
      {/* Faixa permitida */}
      <rect x={padL} y={sy(limits.max)} width={cW} height={Math.max(0, sy(limits.min) - sy(limits.max))}
        fill="var(--green-light)" />
      {/* Linhas de faixa */}
      <line x1={padL} y1={sy(limits.min)} x2={padL+cW} y2={sy(limits.min)} stroke="var(--green-border)" strokeDasharray="3 3" strokeWidth={0.8} />
      <line x1={padL} y1={sy(limits.max)} x2={padL+cW} y2={sy(limits.max)} stroke="var(--green-border)" strokeDasharray="3 3" strokeWidth={0.8} />

      {/* Y-axis */}
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

      {/* X-axis */}
      <line x1={padL} y1={padT+cH} x2={padL+cW} y2={padT+cH} stroke="var(--border)" strokeWidth={1} />
      {points.map((p, i) => i % xLabelEvery === 0 ? (
        <text key={i} x={p.x} y={padT+cH+14} textAnchor="middle"
          fontSize={9} fill="var(--text-secondary)" fontFamily="var(--mono)">
          {fmtTime(p.createdAt)}
        </text>
      ) : null)}

      {/* Área + linha */}
      <path d={areaPath} fill="var(--primary)" fillOpacity={0.08} />
      <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Pontos coloridos por tone */}
      {points.map((p, i) => {
        const tone = resolveTone(p.value, limits.min, limits.max);
        return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={toneColor(tone)} stroke="var(--surface)" strokeWidth={1.5} />;
      })}
    </svg>
  );
}

// ─── Equipment detail modal (drill-down) ──────────────────────────────────

function EquipmentDetailModal({ equipment, history, onClose }) {
  // ESC fecha
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const limits = resolveLimits(equipment.label);

  // Stats (últimas 30 leituras)
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
              ['Mínima',      `${stats.min.toFixed(1)}°`, resolveTone(stats.min, limits.min, limits.max)],
              ['Máxima',      `${stats.max.toFixed(1)}°`, resolveTone(stats.max, limits.min, limits.max)],
              ['Média',       `${stats.avg.toFixed(1)}°`, resolveTone(stats.avg, limits.min, limits.max)],
              ['Desvio padrão', `${stats.std.toFixed(2)}°`, 'neutral'],
              ['Conformidade', `${stats.compliance}%`, stats.compliance >= 90 ? 'ok' : stats.compliance >= 70 ? 'warn' : 'danger'],
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

// ─── Sparkline (SVG puro, sem libs) ───────────────────────────────────────

function Sparkline({ data, limits, width = 220, height = 72 }) {
  if (!data?.length) {
    return (
      <div style={{ width, height, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-placeholder)', fontSize:11 }}>
        sem leituras
      </div>
    );
  }

  const pad = 4;
  const cW = width - pad * 2;
  const cH = height - pad * 2;

  // Y-scale: usa faixa permitida ± 30% pra dar contexto
  const span = (limits.max - limits.min) || 1;
  const yMin = limits.min - span * 0.3;
  const yMax = limits.max + span * 0.3;

  const sx = (i) => pad + (i / Math.max(data.length - 1, 1)) * cW;
  const sy = (v) => pad + cH - ((v - yMin) / (yMax - yMin)) * cH;

  const points = data.map((p, i) => ({ x: sx(i), y: sy(p.value), value: p.value }));
  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length-1].x.toFixed(1)},${height-pad} L${pad},${height-pad} Z`;

  const bandTop = sy(limits.max);
  const bandBot = sy(limits.min);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width:'100%', height:'auto', display:'block', overflow:'visible' }}>
      {/* Faixa permitida (banda verde sutil) */}
      <rect x={pad} y={bandTop} width={cW} height={Math.max(0, bandBot - bandTop)}
        fill="var(--green-light)" rx={2} />
      {/* Área sob a linha */}
      <path d={areaPath} fill="var(--primary)" fillOpacity={0.06} />
      {/* Linha */}
      <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {/* Último ponto destacado */}
      {points.length > 0 && (() => {
        const last = points[points.length - 1];
        const tone = resolveTone(last.value, limits.min, limits.max);
        return <circle cx={last.x} cy={last.y} r={3.2} fill={toneColor(tone)} stroke="var(--surface)" strokeWidth={1.5} />;
      })()}
    </svg>
  );
}

// ─── KPI grande (estilo Linear/Stripe) ────────────────────────────────────

function MetricBig({ label, value, sub, tone = 'neutral', accent }) {
  return (
    <div style={{
      flex:1, minWidth:140, padding:'18px 22px',
      background:'var(--surface)', border:'1px solid var(--border-subtle)',
      borderRadius:'var(--r-lg)',
      display:'flex', flexDirection:'column', gap:6,
    }}>
      <div style={{
        fontSize:9, fontWeight:600, letterSpacing:'.14em', textTransform:'uppercase',
        color:'var(--text-secondary)',
      }}>{label}</div>
      <div style={{
        fontFamily:'var(--serif)', fontSize:38, fontWeight:400, lineHeight:1,
        letterSpacing:'-.02em',
        color: accent ?? (tone !== 'neutral' ? toneColor(tone) : 'var(--text)'),
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>{sub}</div>
      )}
    </div>
  );
}

// ─── Equipment card (a estrela do show pro Supervisor) ────────────────────

function EquipmentCard({ equipment, history, onOpen }) {
  const limits = resolveLimits(equipment.label);
  const last = history[history.length - 1];
  const tone = last ? resolveTone(last.value, limits.min, limits.max) : 'neutral';

  return (
    <button onClick={onOpen} style={{
      padding:'20px 22px',
      background:'var(--surface)', border:'1px solid var(--border-subtle)',
      borderRadius:'var(--r-lg)',
      display:'flex', flexDirection:'column', gap:10,
      cursor:'pointer', textAlign:'left', fontFamily:'var(--font)',
      transition:'border-color .15s, transform .12s, box-shadow .15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:2, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {equipment.label}
          </div>
          <div style={{ fontSize:10, color:'var(--text-secondary)', letterSpacing:'.04em', textTransform:'uppercase' }}>
            {equipment.location || 'Sem localização'} · faixa {limits.min}° / {limits.max}°
          </div>
        </div>
        <span style={{
          padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600,
          letterSpacing:'.06em', textTransform:'uppercase',
          background:toneBg(tone), color:toneColor(tone),
          flexShrink:0,
        }}>
          {tone === 'ok' ? 'OK' : tone === 'warn' ? 'Atenção' : tone === 'danger' ? 'Crítico' : 'Sem leitura'}
        </span>
      </div>

      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:12 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0 }}>
          <div style={{
            fontFamily:'var(--serif)', fontSize:42, fontWeight:400, lineHeight:1,
            letterSpacing:'-.03em', color: toneColor(tone),
          }}>
            {last ? `${last.value}°` : '—'}
          </div>
          <div style={{ fontSize:10, color:'var(--text-secondary)' }}>
            {last ? `${fmtRelative(last.createdAt)} · ${last.user}` : 'aguardando leitura'}
          </div>
        </div>
        <div style={{ flex:1, minWidth:120 }}>
          <Sparkline data={history.slice(-30)} limits={limits} />
        </div>
      </div>
    </button>
  );
}

// ─── Weekly heatmap (linha = equipamento, coluna = dia) ─────────────────

function WeeklyHeatmap({ tenants, records, onCellClick }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const days = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      out.push({
        ms: d.getTime(),
        label: d.toLocaleDateString('pt-BR', { weekday:'short' }).replace(/\.$/, ''),
        sub:   d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }),
        isToday: i === 0,
      });
    }
    return out;
  }, [today.getTime()]);

  // Linha = (tenant, equipamento). Coluna = dia. Célula = pior tone do dia.
  const rows = useMemo(() => {
    const out = [];
    for (const t of tenants) {
      for (const eq of (t.equipmentCatalog || [])) {
        const cells = days.map(d => {
          const dayEnd = d.ms + 86400000;
          const dayRecords = records.filter(r =>
            r.tenantId === t.id &&
            (r.equipmentInput === eq.label || r.equipmentKey === eq.label) &&
            new Date(r.createdAt).getTime() >= d.ms &&
            new Date(r.createdAt).getTime() < dayEnd
          );
          if (!dayRecords.length) return { tone: 'empty', count: 0, dayMs: d.ms };
          const limits = resolveLimits(eq.label);
          const tones = dayRecords.map(r => resolveTone(r.value, limits.min, limits.max));
          // Pior tone vence
          const worst = tones.includes('danger') ? 'danger'
                      : tones.includes('warn') ? 'warn'
                      : tones.includes('ok') ? 'ok' : 'empty';
          return { tone: worst, count: dayRecords.length, dayMs: d.ms };
        });
        out.push({
          tenant: t,
          equipment: eq,
          cells,
          total: cells.reduce((s, c) => s + c.count, 0),
        });
      }
    }
    return out;
  }, [tenants, records, days]);

  if (!rows.length) {
    return (
      <div style={{ padding:'24px', textAlign:'center', color:'var(--text-secondary)', fontStyle:'italic' }}>
        Nenhum equipamento cadastrado nas unidades.
      </div>
    );
  }

  const cellBg = (tone) => ({
    ok:     'var(--green)',
    warn:   'var(--amber)',
    danger: 'var(--red)',
    empty:  'var(--border-subtle)',
  })[tone];

  return (
    <div style={{
      overflowX:'auto',
      background:'var(--surface)',
      border:'1px solid var(--border-subtle)',
      borderRadius:'var(--r-lg)',
      padding:'18px',
    }}>
      <table style={{ borderCollapse:'separate', borderSpacing:'4px 6px', minWidth:'100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign:'left', padding:'6px 12px 6px 0', minWidth:200 }}>
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--text-secondary)' }}>
                Equipamento
              </span>
            </th>
            {days.map(d => (
              <th key={d.ms} style={{ textAlign:'center', padding:'4px 0', minWidth:50 }}>
                <div style={{
                  fontSize:10, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase',
                  color: d.isToday ? 'var(--primary)' : 'var(--text-secondary)',
                }}>{d.label}</div>
                <div style={{ fontSize:10, color:'var(--text-secondary)', fontFamily:'var(--mono)', marginTop:2 }}>{d.sub}</div>
              </th>
            ))}
            <th style={{ textAlign:'right', padding:'4px 0 4px 12px', minWidth:50 }}>
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--text-secondary)' }}>
                Total
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.tenant.id}-${row.equipment.label}`}>
              <td style={{ padding:'6px 12px 6px 0', verticalAlign:'middle' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                  <span style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{row.equipment.label}</span>
                  <span style={{ fontSize:10, color:'var(--text-secondary)', letterSpacing:'.04em' }}>
                    {row.tenant.name} · {row.equipment.location}
                  </span>
                </div>
              </td>
              {row.cells.map((c, j) => (
                <td key={j} style={{ padding:0, textAlign:'center' }}>
                  <button onClick={() => onCellClick?.(row.tenant, row.equipment, c)}
                    title={`${c.count} leitura${c.count!==1?'s':''} · ${c.tone === 'empty' ? 'sem dados' : c.tone}`}
                    style={{
                      width:32, height:32, borderRadius:6, border:'none',
                      background: cellBg(c.tone),
                      cursor: c.count > 0 ? 'pointer' : 'default',
                      opacity: c.tone === 'empty' ? 0.5 : 1,
                      transition:'transform .12s, opacity .12s',
                      fontFamily:'var(--font)', fontSize:10, fontWeight:700,
                      color: c.tone === 'empty' ? 'var(--text-placeholder)' : 'white',
                    }}
                    onMouseEnter={e => { if (c.count > 0) e.currentTarget.style.transform = 'scale(1.1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    {c.count > 0 ? c.count : ''}
                  </button>
                </td>
              ))}
              <td style={{ textAlign:'right', padding:'4px 0 4px 12px', fontFamily:'var(--mono)', fontSize:12, color: row.total === 0 ? 'var(--text-placeholder)' : 'var(--text)' }}>
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Legenda */}
      <div style={{ display:'flex', gap:18, marginTop:14, paddingTop:14, borderTop:'1px solid var(--border-subtle)', fontSize:11, color:'var(--text-secondary)' }}>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ width:12, height:12, borderRadius:3, background:'var(--green)' }} /> Dentro da faixa
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ width:12, height:12, borderRadius:3, background:'var(--amber)' }} /> Desvio leve
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ width:12, height:12, borderRadius:3, background:'var(--red)' }} /> Fora da faixa
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ width:12, height:12, borderRadius:3, background:'var(--border-subtle)', opacity:.5 }} /> Sem leitura
        </span>
      </div>
    </div>
  );
}

// ─── Activity timeline (últimas N ações) ──────────────────────────────────

function ActivityTimeline({ records, limit = 12 }) {
  const items = useMemo(() => {
    return [...records]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }, [records, limit]);

  if (!items.length) {
    return (
      <div style={{
        padding:'20px 16px', textAlign:'center', color:'var(--text-secondary)',
        fontSize:13, fontStyle:'italic',
      }}>
        Nenhuma atividade nas últimas 24 horas.
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {items.map((r, i) => {
        const limits = resolveLimits(r.equipmentInput);
        const tone   = resolveTone(r.value, limits.min, limits.max);
        return (
          <div key={r.id || i} style={{
            display:'flex', alignItems:'center', gap:14,
            padding:'12px 4px',
            borderBottom: i < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
          }}>
            <div style={{
              width:8, height:8, borderRadius:4,
              background: toneColor(tone), flexShrink:0,
            }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:'var(--text)', fontWeight:500 }}>
                <strong>{r.equipmentInput}</strong> · {r.value}°
              </div>
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:1 }}>
                {r.user} · {r.role}
              </div>
            </div>
            <div style={{ fontSize:11, color:'var(--text-secondary)', flexShrink:0, fontFamily:'var(--mono)' }}>
              {fmtRelative(r.createdAt)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────

function Section({ title, subtitle, action, children }) {
  return (
    <section style={{ display:'flex', flexDirection:'column', gap:14, marginTop:32 }}>
      <header style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:12 }}>
        <div>
          <h2 style={{
            fontFamily:'var(--serif)', fontSize:24, fontWeight:400,
            letterSpacing:'-.02em', color:'var(--text)', margin:0, lineHeight:1.1,
          }}>{title}</h2>
          {subtitle && (
            <p style={{ fontSize:13, color:'var(--text-secondary)', margin:'4px 0 0' }}>{subtitle}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

// ─── Composições por perfil ───────────────────────────────────────────────

function HeroGreeting({ session, activeTenant, lastRecord, complianceToday }) {
  return (
    <header style={{
      display:'flex', flexDirection:'column', gap:8, marginBottom:24,
      paddingBottom:24, borderBottom:'1px solid var(--border-subtle)',
    }}>
      <span style={{
        fontSize:11, fontWeight:600, letterSpacing:'.14em', textTransform:'uppercase',
        color:'var(--text-secondary)',
      }}>
        {new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' })}
      </span>
      <h1 style={{
        fontFamily:'var(--serif)', fontSize:42, fontWeight:400, lineHeight:1.05,
        letterSpacing:'-.025em', margin:0, color:'var(--text)',
      }}>
        {greeting()}, {session.user.name.split(' ')[0]}.
      </h1>
      <p style={{ fontSize:14, color:'var(--text-secondary)', margin:0 }}>
        {activeTenant.name} · {session.user.role}
        {lastRecord ? ` · última leitura ${fmtRelative(lastRecord.createdAt)}` : ' · sem leituras hoje'}
        {complianceToday != null ? ` · conformidade ${complianceToday}%` : ''}
      </p>
    </header>
  );
}

function SupervisorDashboard({ session, activeTenant, equipmentCatalog, records, onLaunchKiosk, onNavigate }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const [drillEq, setDrillEq] = useState(null);

  const tenantRecords = useMemo(() =>
    records.filter(r => r.tenantId === activeTenant.id),
  [records, activeTenant.id]);

  const todayRecords = useMemo(() =>
    tenantRecords.filter(r => new Date(r.createdAt).getTime() >= todayMs),
  [tenantRecords, todayMs]);

  const lastRecord = tenantRecords[0]; // já está ordenado por createdAt desc no parent

  const alertCount = useMemo(() =>
    todayRecords.filter(r => {
      const limits = resolveLimits(r.equipmentInput);
      const tone = resolveTone(r.value, limits.min, limits.max);
      return tone === 'warn' || tone === 'danger';
    }).length,
  [todayRecords]);

  // Expected readings hoje = equipamentos × turnos. Assumir 3 turnos como base.
  const expected = (equipmentCatalog?.length || 0) * 3;
  const complianceToday = expected > 0
    ? Math.min(100, Math.round((todayRecords.length / expected) * 100))
    : null;

  // Mapa equipamento → histórico (últimas 30 leituras)
  const equipmentHistory = useMemo(() => {
    const map = new Map();
    for (const eq of (equipmentCatalog || [])) map.set(eq.label, []);
    for (const r of tenantRecords) {
      const arr = map.get(r.equipmentInput) ?? map.get(r.equipmentKey);
      if (arr) arr.unshift(r); // unshift pra ficar cronológico (mais antigo primeiro)
    }
    return map;
  }, [tenantRecords, equipmentCatalog]);

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      <HeroGreeting session={session} activeTenant={activeTenant} lastRecord={lastRecord} complianceToday={complianceToday} />

      {/* Pulse — 3 KPIs grandes. Estado vazio é neutro (não alarmante). */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <MetricBig
          label="Conformidade hoje"
          value={todayRecords.length === 0 ? '—' : `${complianceToday}%`}
          sub={todayRecords.length === 0
            ? 'aguardando primeira leitura do dia'
            : `${todayRecords.length} de ${expected} leituras esperadas`}
          tone={todayRecords.length === 0 ? 'neutral'
            : complianceToday >= 80 ? 'ok'
            : complianceToday >= 50 ? 'warn' : 'danger'} />
        <MetricBig
          label="Alertas ativos"
          value={alertCount}
          sub={alertCount === 0 ? (todayRecords.length === 0 ? 'sem leituras hoje' : 'tudo dentro da faixa') : 'leituras fora/no limite'}
          tone={alertCount === 0 ? 'neutral' : 'warn'} />
        <MetricBig
          label="Última atividade"
          value={lastRecord ? fmtRelative(lastRecord.createdAt) : '—'}
          sub={lastRecord ? `${lastRecord.user}` : 'sem registros'} />
      </div>

      {/* Equipamentos — grade */}
      <Section
        title="Equipamentos"
        subtitle="Status atual, faixa permitida e tendência das últimas 30 leituras"
        action={
          <button onClick={onLaunchKiosk} style={{
            padding:'8px 16px', border:'1px solid var(--border)', borderRadius:'var(--r)',
            background:'var(--surface)', color:'var(--text)', fontSize:13, fontWeight:500,
            cursor:'pointer', fontFamily:'var(--font)',
          }}>Modo quiosque</button>
        }>
        <div style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fit, minmax(340px, 1fr))',
          gap:12,
        }}>
          {(equipmentCatalog || []).map(eq => (
            <EquipmentCard
              key={eq.label}
              equipment={eq}
              history={equipmentHistory.get(eq.label) ?? []}
              onOpen={() => setDrillEq(eq)}
            />
          ))}
        </div>
      </Section>

      {/* Timeline */}
      <Section title="Atividade ao vivo" subtitle="Últimas 12 leituras registradas">
        <div style={{
          padding:'4px 18px', background:'var(--surface)',
          border:'1px solid var(--border-subtle)', borderRadius:'var(--r-lg)',
        }}>
          <ActivityTimeline records={tenantRecords} limit={12} />
        </div>
      </Section>

      {/* Drill-down modal */}
      {drillEq && (
        <EquipmentDetailModal
          equipment={drillEq}
          history={equipmentHistory.get(drillEq.label) ?? []}
          onClose={() => setDrillEq(null)}
        />
      )}
    </div>
  );
}

function ColaboradorDashboard({ session, activeTenant, equipmentCatalog, records, onLaunchKiosk, onNavigate }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const tenantRecords = useMemo(() =>
    records.filter(r => r.tenantId === activeTenant.id),
  [records, activeTenant.id]);

  const myToday = useMemo(() =>
    tenantRecords.filter(r => r.user === session.user.name && new Date(r.createdAt).getTime() >= todayMs),
  [tenantRecords, session.user.name, todayMs]);

  // Equipamentos pendentes = não tem leitura no turno atual
  const equipmentHistory = useMemo(() => {
    const map = new Map();
    for (const eq of (equipmentCatalog || [])) map.set(eq.label, []);
    for (const r of tenantRecords) {
      const arr = map.get(r.equipmentInput) ?? map.get(r.equipmentKey);
      if (arr) arr.unshift(r);
    }
    return map;
  }, [tenantRecords, equipmentCatalog]);

  const pending = useMemo(() => {
    return (equipmentCatalog || []).filter(eq => {
      const history = equipmentHistory.get(eq.label) ?? [];
      const lastToday = history.find(r => new Date(r.createdAt).getTime() >= todayMs);
      return !lastToday;
    });
  }, [equipmentCatalog, equipmentHistory, todayMs]);

  const lastRecord = tenantRecords[0];

  return (
    <div style={{ maxWidth:1000, margin:'0 auto' }}>
      <HeroGreeting session={session} activeTenant={activeTenant} lastRecord={lastRecord} />

      {/* Pulse focado no colaborador */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <MetricBig
          label="Pendentes no turno"
          value={pending.length}
          sub={pending.length === 0 ? 'tudo registrado' : `de ${equipmentCatalog?.length || 0} equipamentos`}
          tone={pending.length === 0 ? 'ok' : 'warn'} />
        <MetricBig
          label="Suas leituras hoje"
          value={myToday.length}
          sub={myToday.length > 0 ? `última ${fmtRelative(myToday[0].createdAt)}` : 'comece registrando'} />
      </div>

      {/* Captura rápida — botões grandes pros pendentes */}
      {pending.length > 0 && (
        <Section
          title="Registrar agora"
          subtitle="Toque no equipamento pra abrir a tela de captura">
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            {pending.map(eq => (
              <button key={eq.label} onClick={() => onNavigate?.('overview')} style={{
                flex:'1 1 200px', padding:'18px 20px',
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:'var(--r-lg)', cursor:'pointer', fontFamily:'var(--font)',
                display:'flex', flexDirection:'column', gap:4, textAlign:'left',
                transition:'all .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='var(--primary)'; e.currentTarget.style.background='var(--surface-muted)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--surface)'; }}>
                <div style={{ fontSize:15, fontWeight:600, color:'var(--text)' }}>{eq.label}</div>
                <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{eq.location}</div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* O que você já fez */}
      {myToday.length > 0 && (
        <Section title="O que você fez hoje" subtitle={`${myToday.length} leituras registradas`}>
          <div style={{ padding:'4px 18px', background:'var(--surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--r-lg)' }}>
            <ActivityTimeline records={myToday} limit={8} />
          </div>
        </Section>
      )}

      {/* Modo quiosque sempre disponível */}
      <div style={{ marginTop:32, textAlign:'center' }}>
        <button onClick={onLaunchKiosk} style={{
          padding:'10px 22px', border:'1px solid var(--border)', borderRadius:'var(--r)',
          background:'var(--surface)', color:'var(--text-secondary)', fontSize:13, fontWeight:500,
          cursor:'pointer', fontFamily:'var(--font)',
        }}>
          Abrir modo quiosque (tablet do balcão)
        </button>
      </div>
    </div>
  );
}

function RTDashboard({ session, allTenants, records, onNavigate }) {
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const [drill, setDrill] = useState(null); // { tenant, equipment }
  const recentRecords = useMemo(() =>
    records.filter(r => new Date(r.createdAt).getTime() >= sevenDaysAgo),
  [records, sevenDaysAgo]);

  const stats = useMemo(() => {
    const byTone = { ok:0, warn:0, danger:0, neutral:0 };
    for (const r of recentRecords) {
      const limits = resolveLimits(r.equipmentInput);
      const tone = resolveTone(r.value, limits.min, limits.max);
      byTone[tone] = (byTone[tone] || 0) + 1;
    }
    const total = recentRecords.length;
    const conformityPct = total > 0 ? Math.round((byTone.ok / total) * 100) : null;
    return { byTone, total, conformityPct };
  }, [recentRecords]);

  const lastRecord = recentRecords.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      <HeroGreeting session={session} activeTenant={{ name: `${allTenants.length} unidade${allTenants.length>1?'s':''} sob responsabilidade` }} lastRecord={lastRecord} />

      {/* Pulse — visão semanal */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <MetricBig
          label="Conformidade — 7 dias"
          value={stats.conformityPct != null ? `${stats.conformityPct}%` : '—'}
          sub={stats.total === 0 ? 'nenhuma leitura nos últimos 7 dias' : `${stats.byTone.ok} de ${stats.total} leituras dentro da faixa`}
          tone={stats.conformityPct == null ? 'neutral'
            : stats.conformityPct >= 90 ? 'ok'
            : stats.conformityPct >= 70 ? 'warn' : 'danger'} />
        <MetricBig
          label="Desvios leves"
          value={stats.byTone.warn}
          sub="leituras próximas dos limites"
          tone={stats.byTone.warn === 0 ? 'neutral' : 'warn'} />
        <MetricBig
          label="Não-conformes"
          value={stats.byTone.danger}
          sub="leituras fora da faixa"
          tone={stats.byTone.danger === 0 ? 'neutral' : 'danger'} />
      </div>

      {/* Distribuição por unidade */}
      <Section title="Distribuição por unidade" subtitle="Volume de leituras dos últimos 7 dias">
        <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
          {allTenants.map(t => {
            const tRecs = recentRecords.filter(r => r.tenantId === t.id);
            const ok = tRecs.filter(r => {
              const lim = resolveLimits(r.equipmentInput);
              return resolveTone(r.value, lim.min, lim.max) === 'ok';
            }).length;
            const pct = tRecs.length ? Math.round((ok / tRecs.length) * 100) : null;
            return (
              <div key={t.id} style={{
                flex:'1 1 240px', padding:'16px 20px',
                background:'var(--surface)', border:'1px solid var(--border-subtle)',
                borderRadius:'var(--r-lg)',
                display:'flex', flexDirection:'column', gap:6,
                borderTop:`3px solid ${t.brandColor}`,
              }}>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--text-secondary)', letterSpacing:'.06em', textTransform:'uppercase' }}>
                  {t.segment || 'unidade'}
                </div>
                <div style={{ fontFamily:'var(--serif)', fontSize:20, color:'var(--text)' }}>{t.name}</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:8, marginTop:4 }}>
                  <span style={{ fontFamily:'var(--serif)', fontSize:32, color: pct != null ? toneColor(pct >= 90 ? 'ok' : pct >= 70 ? 'warn' : 'danger') : 'var(--text-secondary)' }}>
                    {pct != null ? `${pct}%` : '—'}
                  </span>
                  <span style={{ fontSize:12, color:'var(--text-secondary)' }}>conformidade</span>
                </div>
                <div style={{ fontSize:11, color:'var(--text-secondary)' }}>
                  {tRecs.length} leitura{tRecs.length!==1?'s':''} · 7 dias
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Heatmap semanal — equipamento × dia */}
      <Section
        title="Mapa de calor semanal"
        subtitle="Cor mostra o pior status do dia em cada equipamento. Click numa célula com leitura abre o detalhe.">
        <WeeklyHeatmap
          tenants={allTenants}
          records={recentRecords}
          onCellClick={(tenant, equipment, cell) => {
            if (cell.count > 0) setDrill({ tenant, equipment });
          }} />
      </Section>

      {/* Timeline cross-tenant */}
      <Section
        title="Atividade consolidada"
        subtitle="Últimas leituras em todas as unidades"
        action={
          <button onClick={() => onNavigate?.('audit')} style={{
            padding:'8px 16px', border:'1px solid var(--border)', borderRadius:'var(--r)',
            background:'var(--surface)', color:'var(--text)', fontSize:13, fontWeight:500,
            cursor:'pointer', fontFamily:'var(--font)',
          }}>Ver auditoria completa →</button>
        }>
        <div style={{ padding:'4px 18px', background:'var(--surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--r-lg)' }}>
          <ActivityTimeline records={recentRecords} limit={15} />
        </div>
      </Section>

      {/* Drill-down modal */}
      {drill && (
        <EquipmentDetailModal
          equipment={drill.equipment}
          history={records
            .filter(r =>
              r.tenantId === drill.tenant.id &&
              (r.equipmentInput === drill.equipment.label || r.equipmentKey === drill.equipment.label))
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          }
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// ─── Entry point: escolhe dashboard por role ──────────────────────────────

function BetaBar({ onBack }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
      padding:'8px 14px', marginBottom:20,
      background:'rgba(204,120,92,.08)', border:'1px solid rgba(204,120,92,.25)',
      borderRadius:'var(--r)',
      fontSize:12, color:'var(--text-secondary)',
    }}>
      <span>
        <strong style={{ color:'var(--primary)', letterSpacing:'.08em' }}>BETA</strong>
        {' '}— você está vendo a nova Visão Geral. Avaliando? Manda feedback.
      </span>
      {onBack && (
        <button onClick={onBack} style={{
          background:'none', border:'none', cursor:'pointer',
          color:'var(--primary)', fontSize:12, fontWeight:600, fontFamily:'var(--font)',
          padding:'4px 8px', borderRadius:'var(--r)',
        }}>← visão antiga</button>
      )}
    </div>
  );
}

export function OverviewV2(props) {
  const role = props.session?.user?.role;
  const Dashboard = role === 'Colaborador' ? ColaboradorDashboard
                   : role === 'Nutricionista RT' ? RTDashboard
                   : SupervisorDashboard;
  return (
    <>
      <BetaBar onBack={props.onBack} />
      <Dashboard {...props} />
    </>
  );
}
