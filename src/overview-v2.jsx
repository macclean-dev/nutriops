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

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { resolveLimits, resolveTone, suspectMissingMinus, getEquipmentEntry, dedupeCatalog, recordBelongsTo } from './limits';
import { ordenarPorSetor, agruparPorSetor } from './setores';
import { detectTrend } from './trend';
import { readTurns } from './turns';
import { computeTurnAlertsPure } from './turn-alerts';
import { equipamentosForaDaRotina, agruparForaPorSetor, descreverAtraso, limiteForaDaRotina } from './fora-da-rotina';
import { readCompanyProfile } from './settings';
import { EquipmentDetailModal, EquipmentChart, toneColor, toneBg } from './equipment-detail';
import { getTemperatureRepository } from './repository';
import { readOperator } from './operator';
import CountUp from './count-up';

// Mesmo idioma de reports-views.jsx/team-views.jsx/maintenance.jsx: o
// catálogo VIVO mora em `nutriops.equipment.catalog.{id}` (o que
// syncEquipmentCatalog e a tela Equipamentos escrevem), não em
// `t.equipmentCatalog` — esse é só a semente (tenants-public.js ou o payload
// de criação do /admin), nunca atualizado depois. Ler direto de `t.` faz
// equipamento cadastrado depois da criação da loja nunca aparecer no que
// itera por TODOS os tenants (WeeklyHeatmap, abaixo). dedupeCatalog porque a
// nuvem pode chegar com linha duplicada (Swiss, ver CLAUDE.md pendências).
// Achado da auditoria (19/08).
const catalogKey = (id) => `nutriops.equipment.catalog.${id}`;
const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const readEquipmentCatalog = (t) => dedupeCatalog(load(catalogKey(t.id), t.equipmentCatalog ?? []));

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
  // Clampa dentro da área do gráfico: uma leitura fora da faixa (ex.: 14° numa
  // faixa 0–6°) fica colada no topo/base em vez de estourar pra fora do card.
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sy = (v) => clamp(pad + cH - ((v - yMin) / (yMax - yMin)) * cH, pad, pad + cH);

  const points = data.map((p, i) => ({ x: sx(i), y: sy(p.value), value: p.value }));
  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length-1].x.toFixed(1)},${height-pad} L${pad},${height-pad} Z`;

  const bandTop = sy(limits.max);
  const bandBot = sy(limits.min);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width:'100%', height:'auto', display:'block', overflow:'hidden' }}>
      {/* Faixa permitida (banda verde sutil) */}
      <rect x={pad} y={bandTop} width={cW} height={Math.max(0, bandBot - bandTop)}
        fill="var(--green-light)" rx={2} />
      {/* Área sob a linha — revela por fade depois que a linha se riscou */}
      <path className="chart-area" d={areaPath} fill="var(--primary)" fillOpacity={0.06} />
      {/* Linha sólida — se risca da esquerda pra direita (pathLength normaliza o dashoffset) */}
      <path className="chart-line-draw" pathLength={1} d={linePath} fill="none" stroke="var(--primary)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {/* Último ponto destacado — micro-pop no final da coreografia */}
      {points.length > 0 && (() => {
        const last = points[points.length - 1];
        const tone = resolveTone(last.value, limits.min, limits.max);
        return <circle className="chart-dot" cx={last.x} cy={last.y} r={3.2} fill={toneColor(tone)} stroke="var(--surface)" strokeWidth={1.5} />;
      })()}
    </svg>
  );
}

// ─── KPI grande (estilo Linear/Stripe) ────────────────────────────────────

function MetricBig({ label, value, sub, tone = 'neutral', accent, count = false }) {
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
        letterSpacing:'-.02em', fontVariantNumeric:'tabular-nums',
        color: accent ?? (tone !== 'neutral' ? toneColor(tone) : 'var(--text)'),
      }}>{count ? <CountUp text={String(value)} /> : value}</div>
      {sub && (
        <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>{sub}</div>
      )}
    </div>
  );
}

// ─── Sentinela de tendência (item 5 da revisão de produto) ────────────────

function TrendAlertCard({ equipment, trend, onOpen }) {
  const rising = trend.direction === 'rising';
  const arrow = rising ? '↗' : '↘';
  const verbo = rising ? 'subiu' : 'caiu';
  const dias = Math.round(trend.daysToBreach);
  return (
    <button onClick={onOpen} style={{
      flex:'1 1 260px', textAlign:'left', cursor:'pointer', fontFamily:'var(--font)',
      padding:'14px 18px', borderRadius:'var(--r-lg)',
      background:'var(--amber-light)', border:'1px solid var(--amber-border)',
      display:'flex', flexDirection:'column', gap:4,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:16 }}>{arrow}</span>
        <strong style={{ color:'var(--text)' }}>{equipment.label}</strong>
      </div>
      <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
        {verbo} {Math.abs(trend.totalChange)}°C em {Math.round(trend.spanDays)} dias — a caminho de sair da faixa em ~{dias} dia{dias === 1 ? '' : 's'}
      </div>
    </button>
  );
}

// ─── Equipment card (a estrela do show pro Supervisor) ────────────────────

function EquipmentCard({ equipment, history, onOpen, onQuickRegister }) {
  const limits = resolveLimits(equipment.label, equipment);
  const last = history[history.length - 1];
  const tone = last ? resolveTone(last.value, limits.min, limits.max) : 'neutral';

  return (
    <div onClick={onOpen} style={{
      flex:1, minWidth:0,
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
        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          {onQuickRegister && (
            <button onClick={e => { e.stopPropagation(); onQuickRegister(); }}
              title="Registrar uma leitura agora pra esse equipamento, sem abrir o modo quiosque."
              style={{
                padding:'3px 9px', borderRadius:20, fontSize:10, fontWeight:600,
                border:'1px solid var(--primary)', background:'transparent', color:'var(--primary)',
                cursor:'pointer', fontFamily:'var(--font)',
              }}>
              + Registrar
            </button>
          )}
          <span style={{
            padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600,
            letterSpacing:'.06em', textTransform:'uppercase',
            background:toneBg(tone), color:toneColor(tone),
          }}>
            {tone === 'ok' ? 'OK' : tone === 'warn' ? 'Atenção' : tone === 'danger' ? 'Crítico' : 'Sem leitura'}
          </span>
        </div>
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
    </div>
  );
}

// ─── Registro rápido — 1 equipamento, sem abrir o modo quiosque ────────────
// Atalho pedido pelo dono: Administrador/Supervisor viam os cards mas só
// conseguiam REGISTRAR abrindo o quiosque inteiro. Mesma lógica de guarda
// contra typo (fora da faixa → confirma) usada em TemperatureCapture/kiosk.

function QuickRegisterModal({ equipment, activeTenant, session, onClose, onSaved }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // 'idle' | 'salvo' | 'erro' — antes NÃO existia: o modal fechava calado ao
  // gravar, exatamente igual a fechar por engano tocando fora. Não havia como
  // a pessoa distinguir "registrei" de "perdi". A tela inicial sempre teve o
  // "✓ Registro salvo com timestamp auditável" (pages.jsx) — e é justamente a
  // que a nutricionista diz que funciona. O registro rápido não tinha nada.
  const [estado, setEstado] = useState('idle');
  const [insistiuPositivo, setInsistiuPositivo] = useState(false);
  const inputRef = useRef(null);
  const repository = useMemo(() => getTemperatureRepository(), []);
  const limits = resolveLimits(equipment.label, equipment);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  // A confirmação fica na tela um instante antes de fechar. Sem isso ela seria
  // um flash que ninguém lê, e voltaríamos ao problema de origem.
  useEffect(() => {
    if (estado !== 'salvo') return;
    const t = setTimeout(() => onClose(), 1400);
    return () => clearTimeout(t);
  }, [estado, onClose]);

  const numericValue = Number(value);
  const hasValue = value !== '' && !isNaN(numericValue);
  const tone = hasValue ? resolveTone(numericValue, limits.min, limits.max) : 'neutral';
  // "Faltou o menos?" — o teclado de celular não tem tecla de menos com
  // inputMode="decimal", e o confirm genérico que existia aqui era dispensado
  // no reflexo (gravou 5 leituras de freezer como +18 na CASA DOCE, 14/08).
  const faltouMenos = hasValue && suspectMissingMinus(numericValue, limits.min, limits.max);
  // O bloqueio precisa ser NOMEADO e aparecer no botão. Enquanto era só um
  // `return` mudo dentro do save(), o botão continuava verde escrito
  // "Registrar" e não fazia nada: a pessoa media, tocava, o modal ficava
  // parado e ela ia embora achando que registrou (CASA DOCE, 17/08 — leitura
  // das 06:30 na gelateria, feita pelo celular, nunca existiu). É a mesma
  // armadilha do ✓ do quiosque, corrigida na v1.9.143 só lá.
  const bloqueadoPeloSinal = faltouMenos && !insistiuPositivo;
  const trocarSinal = () => {
    setInsistiuPositivo(false);
    setValue((v) => (v.startsWith('-') ? v.slice(1) : v.trim() ? `-${v.trim()}` : v));
  };

  const save = async () => {
    if (!hasValue || saving) return;
    // Bloqueia enquanto a suspeita de sinal não for resolvida — ou corrige
    // pelo botão, ou confirma explicitamente que o positivo é real.
    if (bloqueadoPeloSinal) return;
    setSaving(true); setEstado('idle');
    try {
      await repository.create({
        tenantId: activeTenant.id, tenantName: activeTenant.name,
        equipmentInput: equipment.label, equipmentKey: equipment.label,
        equipmentLocation: equipment.location ?? null,
        user: session.user.name, role: session.user.role, equipment: equipment.label,
        measuredAt: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
        controlMode: 'routine', value: numericValue, note,
        min: limits.min, max: limits.max,
      });
      onSaved?.();
      setEstado('salvo');          // fecha sozinho depois de mostrar (efeito acima)
    } catch {
      // Antes era `try/finally` sem catch: a exceção subia, onClose() não
      // rodava e o modal ficava parado sem dizer nada. Falhar calado foi o que
      // criou este incidente inteiro — falha tem que aparecer.
      setEstado('erro');
    } finally { setSaving(false); }
  };

  // Tocar fora fechava e jogava fora o valor digitado — e a tela ficava
  // IDÊNTICA à de um registro bem-sucedido. Num celular o card ocupa pouco mais
  // de 300px de largura, então há muito escuro em volta pra acertar sem querer.
  // Com número digitado, só fecha pelo Cancelar (que diz o que faz).
  const fecharPeloFundo = () => { if (!hasValue && estado !== 'salvo') onClose(); };

  return (
    <div onClick={fecharPeloFundo} style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(20,20,19,.55)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:24,
    }}>
      {/* maxHeight+overflow: o card cresce quando o aviso de sinal abre, e num
          celular com o teclado por cima ele passava da tela SEM rolagem — o
          botão de registrar ficava inalcançável e não havia como saber disso. */}
      <div onClick={e => e.stopPropagation()} style={{
        background:'var(--surface)', borderRadius:'var(--r-xl)',
        width:'100%', maxWidth:360, boxShadow:'var(--shadow-lg)', padding:24,
        display:'flex', flexDirection:'column', gap:14,
        maxHeight:'calc(100dvh - 48px)', overflowY:'auto',
      }}>
        <div>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--text-secondary)' }}>
            {equipment.location || 'Registro rápido'}
          </div>
          <h2 style={{ fontFamily:'var(--serif)', fontSize:24, fontWeight:400, letterSpacing:'-.02em', color:'var(--text)', margin:0 }}>
            {equipment.label}
          </h2>
          <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:4 }}>Faixa: {limits.min}° a {limits.max}°C</div>
        </div>

        <label style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <span style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'.06em' }}>Temperatura (°C)</span>
          <div style={{ display:'flex', gap:8, alignItems:'stretch' }}>
            <input ref={inputRef} inputMode="decimal" value={value}
              onChange={e => { setValue(e.target.value); setInsistiuPositivo(false); }}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              placeholder={`${limits.min} a ${limits.max}`}
              style={{
                flex:1, minWidth:0,
                padding:'10px 14px', borderRadius:'var(--r)', fontSize:20, fontFamily:'var(--mono)',
                border:`1.5px solid ${tone==='danger'?'var(--red)':tone==='warn'?'var(--amber)':'var(--border)'}`,
                color:'var(--text)', background:'var(--surface)',
              }} />
            {/* O teclado numérico do celular não tem tecla de menos — sem este
                botão, temperatura de congelados é impossível de digitar. */}
            <button type="button" onClick={trocarSinal} title="Trocar sinal (+/−)"
              style={{ width:52, borderRadius:'var(--r)', border:'1.5px solid var(--border)', background:'var(--surface-muted)', color:'var(--text)', fontSize:20, fontWeight:700, fontFamily:'var(--mono)', cursor:'pointer', flexShrink:0 }}>
              ±
            </button>
          </div>
        </label>

        {faltouMenos && (
          <div role="alert" style={{ padding:'10px 12px', borderRadius:'var(--r)', background:'var(--amber-light)', border:'1px solid var(--amber-border)', display:'flex', flexDirection:'column', gap:8 }}>
            <strong style={{ fontSize:13, color:'var(--amber)' }}>Faltou o sinal de menos?</strong>
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
              {equipment.label} trabalha entre {limits.min}° e {limits.max}°C. Você quis dizer <strong>−{numericValue}°C</strong>?
            </span>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={trocarSinal}
                style={{ padding:'7px 14px', borderRadius:'var(--r)', border:'none', background:'var(--primary)', color:'white', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)' }}>
                Sim, corrigir para −{numericValue}°C
              </button>
              <button onClick={() => setInsistiuPositivo(true)}
                style={{ padding:'7px 14px', borderRadius:'var(--r)', border:'1px solid var(--amber-border)', background:'transparent', color:'var(--amber)', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                Não, foi +{numericValue}°C mesmo
              </button>
            </div>
          </div>
        )}

        <label style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <span style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'.06em' }}>Observação (opcional)</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} style={{ minHeight:54, padding:'8px 12px', borderRadius:'var(--r)', border:'1px solid var(--border)', fontFamily:'var(--font)', fontSize:13, resize:'vertical' }} />
        </label>

        {/* O sinal que faltava. Repete o valor gravado de propósito: confirmar
            "salvou" sem dizer O QUE salvou não pega dedo em número errado. */}
        {estado === 'salvo' && (
          <div role="status" style={{ padding:'10px 12px', borderRadius:'var(--r)', background:'var(--green-light)', border:'1px solid var(--green-border)', color:'var(--green)', fontSize:13, fontWeight:700 }}>
            ✓ Registrado: {numericValue}°C em {equipment.label}
          </div>
        )}
        {estado === 'erro' && (
          <div role="alert" style={{ padding:'10px 12px', borderRadius:'var(--r)', background:'var(--red-light)', border:'1px solid var(--red)', color:'var(--red)', fontSize:13, fontWeight:600 }}>
            Não foi possível salvar. A leitura <strong>não</strong> foi registrada — tente de novo.
          </div>
        )}

        {/* Some depois de gravar: não dá pra registrar o mesmo número duas
            vezes por ansiedade enquanto a confirmação está na tela. */}
        <div style={{ display:'flex', gap:10, visibility: estado === 'salvo' ? 'hidden' : 'visible' }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:'var(--r)', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'var(--font)' }}>Cancelar</button>
          {/* Bloqueado ≠ desabilitado sem dizer por quê: o rótulo troca pra
              apontar o aviso. Num celular com o teclado aberto o aviso âmbar
              pode estar fora da vista, e um botão cinza mudo não ensina nada. */}
          <button onClick={save} disabled={!hasValue || saving || bloqueadoPeloSinal} style={{
            flex:2, padding:'10px', borderRadius:'var(--r)', border:'none',
            background: (!hasValue || bloqueadoPeloSinal) ? 'var(--border)' : 'var(--primary)',
            color: bloqueadoPeloSinal ? 'var(--text-secondary)' : 'white',
            cursor: (!hasValue || bloqueadoPeloSinal) ? 'not-allowed' : 'pointer',
            fontSize:13, fontWeight:700, fontFamily:'var(--font)',
          }}>
            {saving ? 'Salvando…' : bloqueadoPeloSinal ? 'Confirme o sinal acima' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Weekly heatmap (linha = equipamento, coluna = dia) ─────────────────

export function WeeklyHeatmap({ tenants, records, onCellClick }) {
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
      const catalogoDoTenant = readEquipmentCatalog(t);
      for (const eq of catalogoDoTenant) {
        const cells = days.map(d => {
          const dayEnd = d.ms + 86400000;
          const dayRecords = records.filter(r =>
            r.tenantId === t.id &&
            recordBelongsTo(catalogoDoTenant, r, eq) &&
            new Date(r.createdAt).getTime() >= d.ms &&
            new Date(r.createdAt).getTime() < dayEnd
          );
          if (!dayRecords.length) return { tone: 'empty', count: 0, dayMs: d.ms };
          const limits = resolveLimits(eq.label, eq);
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
                  {/* Wrapper leva o pop de entrada; o hover do button usa transform */}
                  <div className="heat-pop" style={{ animationDelay:`${(0.45 + i * 0.09 + j * 0.065).toFixed(3)}s`, display:'inline-block' }}>
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
                  </div>
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
        // Usa min/max salvos no próprio registro (captura armazenou).
        // Fallback pra heurística se record antigo não tem.
        const min = r.min != null ? r.min : resolveLimits(r.equipmentInput).min;
        const max = r.max != null ? r.max : resolveLimits(r.equipmentInput).max;
        const tone = resolveTone(r.value, min, max);
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
    <section className="dash-in" style={{ display:'flex', flexDirection:'column', gap:14, marginTop:32, animationDelay:'.18s' }}>
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

function HeroGreeting({ session, activeTenant, lastRecord, coverageToday }) {
  return (
    <header className="dash-in" style={{
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
        {coverageToday != null ? ` · cobertura ${coverageToday}%` : ''}
      </p>
    </header>
  );
}

// Mapa equipamento → histórico de leituras, casando por label OU alias
// (case-insensitive) — mesma regra do resolveLimits/getEquipmentEntry
// (limits.js). Sem isso, o histórico casava só por igualdade exata de
// string: renomear um equipamento no catálogo (sem recriar o vínculo como
// alias) ou um registro digitado com case diferente do label cadastrado
// descolava o card do equipamento do seu próprio histórico — os registros
// continuam no banco (aparecem na Atividade ao vivo), só ficam presos num
// label que o mapa não reconhece mais. Achado da auditoria de 18/08.
// Exportada pra ganhar teste de comportamento direto (sem @testing-library
// neste repo, mas esta é pura — não precisa montar componente pra testar).
export function buildEquipmentHistory(equipmentCatalog, tenantRecords) {
  const map = new Map();
  for (const eq of (equipmentCatalog || [])) map.set(eq.label, []);
  for (const r of tenantRecords) {
    const entry = getEquipmentEntry(equipmentCatalog || [], r.equipmentInput)
      ?? getEquipmentEntry(equipmentCatalog || [], r.equipmentKey);
    const arr = entry ? map.get(entry.label) : undefined;
    if (arr) arr.unshift(r); // unshift pra ficar cronológico (mais antigo primeiro)
  }
  return map;
}

// ─── Equipamentos fora da rotina ───────────────────────────────────────────
// Pedido do dono (21/08) depois do caso da CASA DOCE: 12 equipamentos parados
// havia 2-3 dias e nada no app avisava. O alerta de turno só olha HOJE, e está
// desligado inteiro enquanto a loja está em implantação — ver fora-da-rotina.js.
//
// Só aparece quando há algo a mostrar: card que vive na tela dizendo "tudo
// certo" vira moldura e para de ser lido.
function ForaDaRotinaCard({ itens, limiteDias, onAbrir }) {
  const [verTudo, setVerTudo] = useState(false);
  const grupos = useMemo(() => agruparForaPorSetor(itens), [itens]);
  if (!itens.length) return null;

  // 3 setores é o que cabe sem empurrar os Equipamentos pra fora da dobra.
  const visiveis = verTudo ? grupos : grupos.slice(0, 3);
  const ocultos  = grupos.length - visiveis.length;
  const nunca    = itens.filter((i) => i.nunca).length;

  return (
    <Section
      title="Equipamentos fora da rotina"
      subtitle={`${itens.length} sem leitura há ${limiteDias} dia${limiteDias === 1 ? '' : 's'} ou mais${nunca ? ` · ${nunca} nunca medido${nunca === 1 ? '' : 's'}` : ''} — planilha com buraco é o primeiro item que o fiscal folheia`}
    >
      <div className="dash-stagger" style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
        {visiveis.map(({ setor, equipamentos }) => (
          <div key={setor} style={{
            flex:'1 1 260px', padding:'14px 18px', borderRadius:'var(--r-lg)',
            background:'var(--amber-light)', border:'1px solid var(--amber-border)',
            display:'flex', flexDirection:'column', gap:8,
          }}>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
              <strong style={{ color:'var(--text)' }}>{setor}</strong>
              <span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                {equipamentos.length} equipamento{equipamentos.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {equipamentos.map((eq) => (
                <button key={eq.equipamento} onClick={() => onAbrir?.(eq)} style={{
                  textAlign:'left', cursor:'pointer', fontFamily:'var(--font)',
                  background:'transparent', border:'none', padding:0,
                  display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10,
                }}>
                  <span style={{ fontSize:13, color:'var(--text)' }}>{eq.equipamento}</span>
                  <span style={{
                    fontSize:11, whiteSpace:'nowrap', fontWeight:600,
                    color: eq.nunca ? 'var(--red)' : 'var(--text-secondary)',
                  }}>{descreverAtraso(eq)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {ocultos > 0 && (
        <button className="ghost-action" style={{ alignSelf:'flex-start', fontSize:12 }}
          onClick={() => setVerTudo(true)}>
          Ver mais {ocultos} setor{ocultos === 1 ? '' : 'es'}
        </button>
      )}
    </Section>
  );
}

function SupervisorDashboard({ session, activeTenant, equipmentCatalog, records, onLaunchKiosk, onNavigate, onRecordSaved }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const [drillEq, setDrillEq] = useState(null);

  // Equipamentos parados há dias (21/08). Limite por empresa, padrão 2 —
  // ver fora-da-rotina.js pro porquê de isso não caber no alerta de turno.
  const limiteRotina = limiteForaDaRotina(readCompanyProfile(activeTenant.id));
  const foraDaRotina = useMemo(
    () => equipamentosForaDaRotina({
      catalog: equipmentCatalog, records, tenantId: activeTenant.id, limiteDias: limiteRotina,
    }),
    [equipmentCatalog, records, activeTenant.id, limiteRotina],
  );
  const [quickRegEq, setQuickRegEq] = useState(null);
  // Filtro por setor da grade de equipamentos (pedido do cliente: com 44
  // equipamentos, olhar um setor por vez). Sai da `location` do catálogo.
  const [sectorFilter, setSectorFilter] = useState('all');
  // Trocar de empresa: os setores são outros. Sem limpar, o filtro aponta pra
  // um setor inexistente e a grade fica vazia sem explicação.
  useEffect(() => { setSectorFilter('all'); }, [activeTenant.id]);

  const tenantRecords = useMemo(() =>
    records.filter(r => r.tenantId === activeTenant.id),
  [records, activeTenant.id]);

  // Janela do mapa de calor. Recalcula quando `tenantRecords` muda — o corte
  // por Date.now() dentro do memo ficaria congelado no primeiro render, e o
  // mapa mostraria a semana de quando a aba foi aberta.
  const ultimos7Dias = useMemo(() => {
    const corte = Date.now() - 7 * 86400000;
    return tenantRecords.filter((r) => new Date(r.createdAt).getTime() >= corte);
  }, [tenantRecords]);

  const todayRecords = useMemo(() =>
    tenantRecords.filter(r => new Date(r.createdAt).getTime() >= todayMs),
  [tenantRecords, todayMs]);

  const lastRecord = tenantRecords[0]; // já está ordenado por createdAt desc no parent

  const alertCount = useMemo(() =>
    todayRecords.filter(r => {
      const min = r.min != null ? r.min : resolveLimits(r.equipmentInput, equipmentCatalog).min;
      const max = r.max != null ? r.max : resolveLimits(r.equipmentInput, equipmentCatalog).max;
      const tone = resolveTone(r.value, min, max);
      return tone === 'warn' || tone === 'danger';
    }).length,
  [todayRecords]);

  // Leituras esperadas hoje = equipamentos × turnos CADASTRADOS (item 7 da
  // revisão de produto, 09/08) — antes assumia 3 turnos fixo, divergindo se a
  // loja editasse os turnos em Equipe → Turnos (team-views.jsx) sem que este
  // KPI soubesse. É cobertura de registro, não conformidade térmica — os dois
  // eram confundidos pelo mesmo nome (ver `alertCount` logo abaixo, que é
  // quem de fato mede leitura fora da faixa).
  const turnsCount = Math.max(1, readTurns(activeTenant).length);
  const expected = (equipmentCatalog?.length || 0) * turnsCount;
  const coverageToday = expected > 0
    ? Math.min(100, Math.round((todayRecords.length / expected) * 100))
    : null;

  // Mapa equipamento → histórico (últimas 30 leituras)
  const equipmentHistory = useMemo(() => buildEquipmentHistory(equipmentCatalog, tenantRecords),
  [tenantRecords, equipmentCatalog]);

  const sectors = useMemo(() => {
    const set = new Set((equipmentCatalog || []).map((e) => e.location).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [equipmentCatalog]);

  // Sentinela de tendência (item 5 da revisão de produto, 09/08) — regressão
  // linear sobre as últimas ~3 semanas de cada equipamento. Uma câmara subindo
  // 0,4°C/dia avisa aqui semanas antes do primeiro registro fora da faixa.
  // Calibrado pra não alarmar à toa (ver trend.js) — por isso a lista tende a
  // ficar vazia na maior parte do tempo, o que é o comportamento certo.
  const trendAlerts = useMemo(() => {
    return (equipmentCatalog || [])
      .map((eq) => {
        const limits = resolveLimits(eq.label, eq);
        const trend = detectTrend(equipmentHistory.get(eq.label) ?? [], limits);
        return trend ? { equipment: eq, trend } : null;
      })
      .filter(Boolean);
  }, [equipmentCatalog, equipmentHistory]);

  // Comparação exata (o valor vem da lista, não é digitado): com `includes`,
  // "Padaria" traria também "Padaria 2".
  const visibleEquipment = useMemo(() => {
    const all = equipmentCatalog || [];
    return sectorFilter === 'all' ? all : all.filter((e) => e.location === sectorFilter);
  }, [equipmentCatalog, sectorFilter]);

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      <HeroGreeting session={session} activeTenant={activeTenant} lastRecord={lastRecord} coverageToday={coverageToday} />

      {/* Pulse — 3 KPIs grandes. Estado vazio é neutro (não alarmante). */}
      <div className="dash-stagger" style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <MetricBig
          count
          label="Cobertura de registro hoje"
          value={todayRecords.length === 0 ? '—' : `${coverageToday}%`}
          sub={todayRecords.length === 0
            ? 'aguardando primeira leitura do dia'
            : `${todayRecords.length} de ${expected} leituras esperadas`}
          tone={todayRecords.length === 0 ? 'neutral'
            : coverageToday >= 80 ? 'ok'
            : coverageToday >= 50 ? 'warn' : 'danger'} />
        <MetricBig
          count
          label="Alertas ativos"
          value={alertCount}
          sub={alertCount === 0 ? (todayRecords.length === 0 ? 'sem leituras hoje' : 'tudo dentro da faixa') : 'leituras fora/no limite'}
          tone={alertCount === 0 ? 'neutral' : 'warn'} />
        <MetricBig
          label="Última atividade"
          value={lastRecord ? fmtRelative(lastRecord.createdAt) : '—'}
          sub={lastRecord ? `${lastRecord.user}` : 'sem registros'} />
      </div>

      {/* Equipamentos fora da rotina — antes da Sentinela: ausência de registro
          é problema mais imediato que tendência de desvio. */}
      <ForaDaRotinaCard
        itens={foraDaRotina}
        limiteDias={limiteRotina}
        onAbrir={(item) => {
          const eq = (equipmentCatalog ?? []).find((e) => e.label === item.equipamento);
          if (eq) setDrillEq(eq);
        }} />

      {/* Sentinela de tendência */}
      {trendAlerts.length > 0 && (
        <Section
          title="Sentinela de tendência"
          subtitle="Equipamentos indo na direção de sair da faixa — antes de estourar">
          <div className="dash-stagger" style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            {trendAlerts.map(({ equipment, trend }) => (
              <TrendAlertCard key={equipment.label} equipment={equipment} trend={trend} onOpen={() => setDrillEq(equipment)} />
            ))}
          </div>
        </Section>
      )}

      {/* Equipamentos — grade */}
      <Section
        title="Equipamentos"
        subtitle="Status atual, faixa permitida e tendência das últimas 30 leituras"
        action={
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {sectors.length > 1 && (
              <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}
                style={{ width:'auto', fontSize:13, padding:'7px 10px' }}>
                <option value="all">Todos os setores ({equipmentCatalog?.length ?? 0})</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>{s} ({equipmentCatalog.filter(e => e.location === s).length})</option>
                ))}
              </select>
            )}
            <button onClick={onLaunchKiosk} style={{
              padding:'8px 16px', border:'1px solid var(--border)', borderRadius:'var(--r)',
              background:'var(--surface)', color:'var(--text)', fontSize:13, fontWeight:500,
              cursor:'pointer', fontFamily:'var(--font)',
            }}>Modo quiosque</button>
          </div>
        }>
        <div className="dash-stagger" style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fit, minmax(340px, 1fr))',
          gap:12,
        }}>
          {/* Wrapper por card: o hover do EquipmentCard usa transform — a
              animação de entrada precisa viver no pai pra não brigar com ele */}
          {visibleEquipment.map(eq => (
            <div key={eq.label} style={{ display:'flex' }}>
              <EquipmentCard
                equipment={eq}
                history={equipmentHistory.get(eq.label) ?? []}
                onOpen={() => setDrillEq(eq)}
                onQuickRegister={() => setQuickRegEq(eq)}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* Mapa de calor — antes só existia no painel da Nutricionista RT, e o
          dono da loja (papel Administrador) nunca via. Pior: nem o admin da
          plataforma via, porque a impersonação também entra como
          Administrador — quem sustenta o produto não conseguia enxergar a tela
          que o cliente descreve no suporte.
          Aqui é escopado à empresa ATIVA (o painel da RT itera as unidades
          dela); o clique reusa o drill-down de equipamento que esta tela já
          tem. Pedido do dono, 23/08. */}
      <Section
        title="Mapa de calor semanal"
        subtitle="Cor mostra o pior status do dia em cada equipamento. Clique numa célula com leitura pra abrir o detalhe.">
        <WeeklyHeatmap
          tenants={[activeTenant]}
          records={ultimos7Dias}
          onCellClick={(_tenant, equipment, cell) => { if (cell.count > 0) setDrillEq(equipment); }} />
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

      {/* Registro rápido */}
      {quickRegEq && (
        <QuickRegisterModal
          equipment={quickRegEq} activeTenant={activeTenant} session={session}
          onClose={() => setQuickRegEq(null)} onSaved={onRecordSaved}
        />
      )}
    </div>
  );
}

function ColaboradorDashboard({ session, activeTenant, equipmentCatalog, records, onLaunchKiosk, onNavigate, onRecordSaved }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const tenantRecords = useMemo(() =>
    records.filter(r => r.tenantId === activeTenant.id),
  [records, activeTenant.id]);

  // "Minhas" leituras = as que levam o MEU nome, e o meu nome pode chegar por
  // dois caminhos (CASA DOCE, 17/08):
  //   · tela principal — o operador é aplicado NA SESSÃO (applyOperatorToSession),
  //     então session.user.name já é a pessoa;
  //   · Modo Quiosque — o operador é carimbado no REGISTRO, mas a sessão segue
  //     com o nome da conta de loja ("Equipe"). Comparar só com a sessão dava
  //     falso e as leituras do quiosque não contavam — a tela subestimava o
  //     trabalho da pessoa e o "última leitura há X" ficava velho.
  // O registro está certo nos dois casos; quem estava errado era esta conta.
  const meusNomes = useMemo(() => {
    const operador = readOperator(activeTenant.id)?.name;
    return new Set([session.user.name, operador].filter(Boolean));
  }, [session.user.name, activeTenant.id, tenantRecords]);

  const myToday = useMemo(() =>
    tenantRecords.filter(r => meusNomes.has(r.user) && new Date(r.createdAt).getTime() >= todayMs),
  [tenantRecords, meusNomes, todayMs]);

  // Leituras da LOJA hoje — de qualquer pessoa. Numa conta compartilhada sem
  // operador escolhido, "suas leituras" não tem dono: a sessão se chama
  // "Equipe", e o card contava só os registros gravados literalmente com esse
  // nome. Foi o que a nutricionista da CASA DOCE viu em 18/08 — "3" no card
  // enquanto a loja tinha medido 36 dos 46 equipamentos no mesmo dia (os
  // outros no nome de cada colaboradora). O número estava certo e não servia
  // pra nada.
  const lojaHoje = useMemo(() =>
    tenantRecords.filter(r => new Date(r.createdAt).getTime() >= todayMs),
  [tenantRecords, todayMs]);

  // NÃO tentar adivinhar "esta conta é de uma pessoa ou da loja". A sessão da
  // CASA DOCE se chama "Equipe" mas NÃO é conta de loja (não passa pelo
  // seletor de operador), então qualquer heurística baseada em
  // isStoreAccountSession erraria justamente o caso que originou isto.
  // Em vez de detectar, MOSTRAR OS DOIS: o card continua sendo o pessoal, e o
  // total da loja vai no subtítulo sempre que for diferente. Quem procurava
  // "as leituras de hoje" acha o número na hora, seja qual for o tipo de conta.
  const mostrarTotalDaLoja = lojaHoje.length !== myToday.length;

  // Equipamentos pendentes = sem leitura no turno ATUAL — não no dia inteiro.
  // Media por `todayMs` (meia-noite): 1 leitura de manhã zerava a pendência
  // dos turnos seguintes, e a equipe da Tarde/Noite abria a tela e via "tudo
  // registrado" com a seção "Registrar agora" sumida — sem medir nada desde
  // o início do PRÓPRIO turno. computeTurnAlertsPure (turn-alerts.js) já é a
  // fonte canônica de pendência por faixa de horário — o mesmo motor do badge
  // de alertas e da Prontidão; esta tela reimplementava a própria conta (por
  // dia) e discordava do resto do app, como o comentário antigo aqui mesmo
  // já constatava. Só o nível 'warn' entra (turno ativo agora) — 'danger' é
  // turno já encerrado sem registro, que é papel do badge de alertas, não
  // deste checklist de "o que fazer agora". Achado da auditoria (19/08).
  //
  // computeTurnAlertsPure casa equipamento por igualdade EXATA de string
  // (mesma limitação de WeeklyHeatmap/RTDashboard, já sinalizada à parte).
  // Sem normalizar antes, um equipamento renomeado (label novo, nome velho
  // virou alias) voltaria a aparecer "pendente" mesmo já medido sob o nome
  // velho neste turno — regredindo a correção de matching case-insensitive/
  // alias que buildEquipmentHistory já garante nesta MESMA tela desde a tier
  // média (ver SupervisorDashboard, acima). Resolve pro label canônico do
  // catálogo ANTES de checar turno, com o mesmo getEquipmentEntry que
  // buildEquipmentHistory usa por baixo — sem precisar montar o Map inteiro
  // só pra isso.
  const normalizedForTurns = useMemo(() => tenantRecords.map((r) => {
    const entry = getEquipmentEntry(equipmentCatalog || [], r.equipmentInput) ?? getEquipmentEntry(equipmentCatalog || [], r.equipmentKey);
    return entry ? { ...r, equipment: entry.label, equipmentInput: entry.label } : r;
  }), [tenantRecords, equipmentCatalog]);
  const turns = readTurns(activeTenant);
  const turnAlerts = useMemo(
    () => computeTurnAlertsPure(turns, normalizedForTurns, equipmentCatalog, activeTenant.id, activeTenant.implantacao === true),
    [turns, normalizedForTurns, equipmentCatalog, activeTenant.id, activeTenant.implantacao],
  );
  const pending = useMemo(() => {
    const pendentesAgora = new Set(turnAlerts.filter(a => a.level === 'warn').map(a => a.equipment));
    return (equipmentCatalog || []).filter(eq => pendentesAgora.has(eq.label));
  }, [equipmentCatalog, turnAlerts]);

  const lastRecord = tenantRecords[0];
  const [quickRegEq, setQuickRegEq] = useState(null);

  // Mesma regra do quiosque (setores.js). Com 44 equipamentos numa lista
  // corrida, quem é da Padaria caçava os dele no meio dos da Gelateria — e a
  // divergência entre esta tela e o quiosque foi lida pela nutricionista da
  // CASA DOCE (10/08) como "num aparelho agrupa, no outro não".
  const gruposPendentes = useMemo(
    () => agruparPorSetor(ordenarPorSetor(pending)),
    [pending]);

  // Planilhas pendentes do período — o app já cobra temperatura, nunca cobrou
  // planilha (item 4 da revisão de produto, 09/08). forms.jsx entra por
  // IMPORT DINÂMICO: overview é a tela de boot de todo mundo, e forms.jsx é
  // o chunk pesado de planilhas — carregar ele aqui sem necessidade forçaria
  // esse peso em todo login, não só em quem abre "Planilhas BPF".
  const [pendingForms, setPendingForms] = useState([]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { readFormTemplates, readFormRecords, pendingFormsForPeriod } = await import('./forms');
      if (!vivo) return;
      const list = pendingFormsForPeriod(readFormTemplates(activeTenant), readFormRecords(activeTenant.id));
      if (vivo) setPendingForms(list);
    })();
    return () => { vivo = false; };
  }, [activeTenant.id]);

  return (
    <div style={{ maxWidth:1000, margin:'0 auto' }}>
      <HeroGreeting session={session} activeTenant={activeTenant} lastRecord={lastRecord} />

      {/* Pulse focado no colaborador */}
      <div className="dash-stagger" style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <MetricBig
          count
          label="Pendentes no turno"
          value={pending.length}
          sub={pending.length === 0 ? 'tudo registrado' : `de ${equipmentCatalog?.length || 0} equipamentos`}
          tone={pending.length === 0 ? 'ok' : 'warn'} />
        <MetricBig
          count
          label="Suas leituras hoje"
          value={myToday.length}
          sub={[
            myToday.length > 0 ? `última ${fmtRelative(myToday[0].createdAt)}` : 'comece registrando',
            mostrarTotalDaLoja ? `loja: ${lojaHoje.length} hoje` : null,
          ].filter(Boolean).join(' · ')} />
        <MetricBig
          count
          label="Planilhas pendentes"
          value={pendingForms.length}
          sub={pendingForms.length === 0 ? 'tudo em dia' : 'do período atual'}
          tone={pendingForms.length === 0 ? 'ok' : 'warn'} />
      </div>

      {/* Captura rápida — botões grandes pros pendentes */}
      {pending.length > 0 && (
        <Section
          title="Registrar agora"
          subtitle="Toque no equipamento pra abrir a tela de captura">
          {gruposPendentes.map(grupo => (
            <div key={grupo.chave} style={{ marginBottom:14 }}>
              {/* Cabeçalho só quando há mais de um setor — com um só, o título
                  vira ruído (mesma regra do quiosque). */}
              {gruposPendentes.length > 1 && (
                <div style={{
                  fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase',
                  color:'var(--text-secondary)', marginBottom:8,
                }}>
                  {grupo.setor} · {grupo.itens.length}
                </div>
              )}
              <div className="dash-stagger" style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
                {grupo.itens.map(({ item: eq }) => (
                  <button key={eq.label} onClick={() => setQuickRegEq(eq)} style={{
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
            </div>
          ))}
        </Section>
      )}

      {/* Planilhas do período ainda pendentes */}
      {pendingForms.length > 0 && (
        <Section
          title="Planilhas do período"
          subtitle="Toque pra abrir e preencher">
          <div className="dash-stagger" style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            {pendingForms.slice(0, 8).map(f => (
              <button key={f.id} onClick={() => onNavigate('forms')} style={{
                flex:'1 1 200px', padding:'18px 20px',
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:'var(--r-lg)', cursor:'pointer', fontFamily:'var(--font)',
                display:'flex', flexDirection:'column', gap:4, textAlign:'left',
                transition:'all .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='var(--primary)'; e.currentTarget.style.background='var(--surface-muted)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--surface)'; }}>
                <div style={{ fontSize:15, fontWeight:600, color:'var(--text)' }}>{f.title}</div>
                <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{f.periodLabel} · {f.status === 'draft' ? 'Rascunho' : 'Pendente'}</div>
              </button>
            ))}
            {pendingForms.length > 8 && (
              <button onClick={() => onNavigate('forms')} style={{
                flex:'1 1 200px', padding:'18px 20px', background:'transparent',
                border:'1px dashed var(--border)', borderRadius:'var(--r-lg)', cursor:'pointer',
                fontFamily:'var(--font)', color:'var(--text-secondary)', fontSize:13,
              }}>
                +{pendingForms.length - 8} planilhas — ver todas
              </button>
            )}
          </div>
        </Section>
      )}

      {/* O que você já fez — só quando há um "você". Na conta compartilhada sem
          operador, a seção abaixo (a loja inteira) é a que faz sentido. */}
      {myToday.length > 0 && (
        <Section title="O que você fez hoje" subtitle={`${myToday.length} leituras registradas`}>
          <div style={{ padding:'4px 18px', background:'var(--surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--r-lg)' }}>
            <ActivityTimeline records={myToday} limit={8} />
          </div>
        </Section>
      )}

      {/* Atividade da loja — o colaborador não tinha NENHUMA lista das leituras
          do dia, de qualquer pessoa; esta seção só existia na visão do
          supervisor. Num tablet de loja, onde várias pessoas se revezam, saber
          o que já foi medido (e por quem) é o que evita medir duas vezes e o
          que responde "cadê as leituras de hoje". */}
      {lojaHoje.length > 0 && (
        <Section title="Atividade da loja hoje" subtitle={`${lojaHoje.length} leituras registradas por toda a equipe`}>
          <div style={{ padding:'4px 18px', background:'var(--surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--r-lg)' }}>
            <ActivityTimeline records={lojaHoje} limit={12} />
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

      {/* Registro rápido */}
      {quickRegEq && (
        <QuickRegisterModal
          equipment={quickRegEq} activeTenant={activeTenant} session={session}
          onClose={() => setQuickRegEq(null)} onSaved={onRecordSaved}
        />
      )}
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
      const min = r.min != null ? r.min : resolveLimits(r.equipmentInput).min;
      const max = r.max != null ? r.max : resolveLimits(r.equipmentInput).max;
      const tone = resolveTone(r.value, min, max);
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
      <div className="dash-stagger" style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <MetricBig
          count
          label="Conformidade — 7 dias"
          value={stats.conformityPct != null ? `${stats.conformityPct}%` : '—'}
          sub={stats.total === 0 ? 'nenhuma leitura nos últimos 7 dias' : `${stats.byTone.ok} de ${stats.total} leituras dentro da faixa`}
          tone={stats.conformityPct == null ? 'neutral'
            : stats.conformityPct >= 90 ? 'ok'
            : stats.conformityPct >= 70 ? 'warn' : 'danger'} />
        <MetricBig
          count
          label="Desvios leves"
          value={stats.byTone.warn}
          sub="leituras próximas dos limites"
          tone={stats.byTone.warn === 0 ? 'neutral' : 'warn'} />
        <MetricBig
          count
          label="Não-conformes"
          value={stats.byTone.danger}
          sub="leituras fora da faixa"
          tone={stats.byTone.danger === 0 ? 'neutral' : 'danger'} />
      </div>

      {/* Distribuição por unidade */}
      <Section title="Distribuição por unidade" subtitle="Volume de leituras dos últimos 7 dias">
        <div className="dash-stagger" style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
          {allTenants.map(t => {
            const tRecs = recentRecords.filter(r => r.tenantId === t.id);
            const ok = tRecs.filter(r => {
              const lim = (r.min != null && r.max != null)
                ? { min: r.min, max: r.max }
                : resolveLimits(r.equipmentInput, t.equipmentCatalog);
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
                  <span style={{ fontFamily:'var(--serif)', fontSize:32, fontVariantNumeric:'tabular-nums', color: pct != null ? toneColor(pct >= 90 ? 'ok' : pct >= 70 ? 'warn' : 'danger') : 'var(--text-secondary)' }}>
                    {pct != null ? <CountUp text={`${pct}%`} /> : '—'}
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
              recordBelongsTo(readEquipmentCatalog(drill.tenant), r, drill.equipment))
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
    <div className="dash-in" style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
      padding:'8px 14px', marginBottom:20,
      background:'rgba(0,163,92,.08)', border:'1px solid rgba(0,163,92,.25)',
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
  // v2 é a Visão Geral padrão (não é mais beta) — sem a BetaBar promocional.
  // props.onBack ainda existe (leva à v1 legada) caso queira reintroduzir um escape.
  return <Dashboard {...props} />;
}
