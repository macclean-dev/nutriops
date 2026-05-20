import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FormKioskApp } from './kiosk';
import { pushFormRecord } from './repository';

// ─── Storage ───────────────────────────────────────────────────────────────

const tplKey = (id) => `nutriops.forms.templates.${id}`;
const recKey = (id) => `nutriops.forms.records.${id}`;

const fl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const fs = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const readFormTemplates  = (tenant) => { const s = fl(tplKey(tenant.id), null); if (s) return s; const d = seedTemplates(tenant); fs(tplKey(tenant.id), d); return d; };
export const writeFormTemplates = (id, v)  => fs(tplKey(id), v);
export const readFormRecords    = (id)     => fl(recKey(id), []);
export const writeFormRecords   = (id, v)  => fs(recKey(id), v);

// ─── Period helpers ────────────────────────────────────────────────────────

export function getPeriodKey(frequency, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (frequency === 'daily')    return `${y}-${m}-${d}`;
  if (frequency === 'weekly')   { const j = new Date(y,0,1); const w = Math.ceil(((date-j)/86400000+j.getDay()+1)/7); return `${y}-W${String(w).padStart(2,'0')}`; }
  if (frequency === 'biweekly') return `${y}-${m}-${date.getDate()<=15?'A':'B'}`;
  if (frequency === 'monthly')  return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

export function formatPeriodLabel(frequency, key) {
  try {
    if (frequency === 'daily')    return new Date(key+'T12:00').toLocaleDateString('pt-BR',{weekday:'short',day:'numeric',month:'short'});
    if (frequency === 'weekly')   return `Semana ${key.replace('-',' ')}`;
    if (frequency === 'biweekly') { const [y,mo,h]=key.split('-'); const mn=new Date(`${y}-${mo}-01T12:00`).toLocaleDateString('pt-BR',{month:'long'}); return `${h==='A'?'1ª quinzena':'2ª quinzena'} de ${mn}`; }
    if (frequency === 'monthly')  return new Date(key+'-01T12:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  } catch { /**/ }
  return key;
}

export function freqLabel(f) { return {daily:'Diária',weekly:'Semanal',biweekly:'Quinzenal',monthly:'Mensal'}[f]??f; }

function uid() { return crypto.randomUUID(); }
const f = (label, type='cnc', hint=null) => ({ id:uid(), label, type, hint });

// ─── Category metadata ─────────────────────────────────────────────────────

const CAT = {
  higiene_pessoal: { label:'Higiene Pessoal',  color:'#0969da', bg:'#ddf4ff' },
  vetores_pragas:  { label:'Vetores e Pragas', color:'#9a3412', bg:'#fff7ed' },
  dedetizacao:     { label:'Dedetização',      color:'#6b21a8', bg:'#faf5ff' },
  faxina:          { label:'Faxina',           color:'#065f46', bg:'#ecfdf5' },
  potabilidade:    { label:'Potabilidade',     color:'#1e40af', bg:'#eff6ff' },
  manutencao:      { label:'Manutenção',       color:'#92400e', bg:'#fffbeb' },
  recebimento:     { label:'Recebimento',      color:'#374151', bg:'#f9fafb' },
  custom:          { label:'Personalizado',    color:'#374151', bg:'#f9fafb' },
};
export function catMeta(cat) { return CAT[cat] ?? CAT.custom; }

// ─── Completion helpers ────────────────────────────────────────────────────

export function completionPct(template, record) {
  if (!record) return 0;
  let total=0, filled=0;
  for (const sec of template.sections) {
    for (const field of sec.fields) {
      if (field.type==='text') continue;
      total++;
      const v = record.responses?.[field.id];
      if (v!==undefined && v!==null && v!=='') { if (typeof v==='object' ? (v.date||v.sig||v.detected!==undefined) : v!=='') filled++; }
    }
  }
  return total>0 ? Math.round((filled/total)*100) : 0;
}

// ─── PDF generator for forms ───────────────────────────────────────────────

export function generateFormPDF(template, record, tenant) {
  const period    = formatPeriodLabel(template.frequency, record.periodKey);
  const filledAt  = new Date(record.updatedAt).toLocaleString('pt-BR');
  const meta      = catMeta(template.category);
  const validated = record.validation;

  const renderValue = (field, val) => {
    if (!val && val !== false) return '<span style="color:#9198a1">—</span>';
    if (field.type==='cnc') return val==='C'
      ? '<span style="color:#1a7f37;font-weight:700">✓ CONFORME</span>'
      : val==='NC' ? '<span style="color:#cf222e;font-weight:700">✗ NÃO CONFORME</span>'
      : '<span style="color:#9198a1">—</span>';
    if (field.type==='presence') {
      if (typeof val==='object') return val.detected
        ? `<span style="color:#cf222e;font-weight:700">DETECTADO</span>${val.location ? ` — ${val.location}` : ''}`
        : '<span style="color:#1a7f37;font-weight:700">SEM OCORRÊNCIA</span>';
      return String(val);
    }
    if (field.type==='date_sig' && typeof val==='object')
      return `${val.date||'—'} · Resp.: <strong>${val.sig||'—'}</strong>`;
    return String(val);
  };

  const sectionsHtml = template.sections.map(sec => `
    ${template.sections.length>1 ? `<div class="sec-title">${sec.title}</div>` : ''}
    <table class="fields-table">
      ${sec.fields.map(field => `
        <tr>
          <td class="field-label">${field.label}${field.hint?`<div class="field-hint">${field.hint}</div>`:''}</td>
          <td class="field-value">${renderValue(field, record.responses?.[field.id])}</td>
        </tr>
      `).join('')}
    </table>
  `).join('');

  const validationHtml = validated ? `
    <div class="validation-stamp">
      <div class="stamp-header">✓ VALIDADO PELO RESPONSÁVEL TÉCNICO</div>
      <div><strong>${validated.by}</strong> · ${validated.role}</div>
      <div>${new Date(validated.at).toLocaleString('pt-BR')}</div>
      ${validated.note ? `<div class="stamp-note">${validated.note}</div>` : ''}
    </div>
  ` : `
    <div class="sign-block">
      <div class="sign-line"></div>
      <div>Responsável Técnico · Data: ___/___/______</div>
    </div>
  `;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>${template.title} — ${period}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#1c2128;padding:24px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #d0d7de}
    .header-left h1{font-size:16px;font-weight:800;margin-bottom:4px}
    .header-left .period{font-size:12px;color:#656d76}
    .meta-table{border-collapse:collapse;width:100%;margin-bottom:16px}
    .meta-table td{padding:4px 8px;border:1px solid #d0d7de;font-size:10px}
    .meta-table td:first-child{font-weight:700;background:#f6f8fa;width:140px}
    .cat-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}44}
    .sec-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#656d76;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid #eaeef2}
    .fields-table{width:100%;border-collapse:collapse;margin-bottom:8px}
    .fields-table td{padding:7px 10px;border:1px solid #eaeef2;vertical-align:top}
    .field-label{width:55%;font-weight:600;background:#fafafa}
    .field-hint{font-size:9px;color:#656d76;font-weight:400;margin-top:2px}
    .field-value{font-size:11px}
    .validation-stamp{margin-top:20px;padding:12px 16px;background:#dafbe1;border:2px solid #4ac26b;border-radius:6px}
    .stamp-header{font-size:12px;font-weight:800;color:#1a7f37;margin-bottom:4px}
    .stamp-note{font-style:italic;margin-top:6px;color:#065f46}
    .sign-block{margin-top:28px;padding-top:16px;border-top:1px solid #d0d7de;text-align:center;color:#656d76;font-size:10px}
    .sign-line{width:280px;border-bottom:1px solid #656d76;margin:0 auto 6px}
    .footer{margin-top:20px;padding-top:10px;border-top:1px solid #eaeef2;font-size:9px;color:#9198a1;display:flex;justify-content:space-between}
    @page{size:A4;margin:16mm}
  </style></head><body>
  <div class="header">
    <div class="header-left">
      <h1>${template.title}</h1>
      <div class="period">${tenant?.name ?? ''} · ${period} · <span class="cat-badge">${meta.label} · ${freqLabel(template.frequency)}</span></div>
    </div>
  </div>
  <table class="meta-table">
    <tr><td>Preenchido por</td><td>${record.user} · ${record.role}</td><td>Data/hora</td><td>${filledAt}</td></tr>
    <tr><td>Empresa</td><td>${tenant?.name??''}</td><td>Status</td><td>${record.status==='submitted'?'✓ Confirmado':'Rascunho'}</td></tr>
  </table>
  ${sectionsHtml}
  ${validationHtml}
  <div class="footer">
    <span>NutriOPS · Conformidade sanitária digital</span>
    <span>RDC 216/2004 · Elaborado por Nutricionista RT</span>
    <span>Gerado em ${new Date().toLocaleString('pt-BR')}</span>
  </div>
  </body></html>`;
}

// ─── Pre-built templates ───────────────────────────────────────────────────

const TPL_HIGIENE_PESSOAL = () => ({
  id:uid(), category:'higiene_pessoal', frequency:'daily',
  title:'Higiene Pessoal dos Colaboradors',
  description:'Verificação diária de higiene, uniforme, comportamento e EPI. C=conforme / NC=não conforme.',
  sections:[{ id:uid(), title:'Verificação',
    fields:[
      f('Uniforme'),
      f('Sapato'),
      f('Cabelo'),
      f('Barba'),
      f('Unha'),
      f('Adorno','cnc','Remover brincos, anéis, pulseiras, colares'),
      f('Comportamento','cnc','Atitudes higiênicas, não manipular objetos fora da atividade'),
      f('Avental'),
      f('Perfume','cnc','Ausência de perfume forte'),
      f('Ferimento','cnc','Ferimentos devidamente cobertos'),
      f('Lavar Mãos','cnc','Ao iniciar, usar banheiro, trocar atividade, colocar luvas'),
      f('Observações','text'),
    ],
  }],
});

const TPL_VETORES = (areas='D=Distribuição S=Salão E=Externa') => ({
  id:uid(), category:'vetores_pragas', frequency:'daily',
  title:'Controle Integrado de Vetores e Pragas',
  description:'Verificação diária. Registrar tipo de praga e local. Anexar comprovante de dedetização.',
  sections:[{ id:uid(), title:'Ocorrências do dia',
    fields:[
      f('Abelha (A)',           'presence', areas),
      f('Barata (B)',           'presence', areas),
      f('Formiga (F)',          'presence', areas),
      f('Mosca / Mosquito (M)', 'presence', areas),
      f('Pombo (P)',            'presence', areas),
      f('Roedor (R)',           'presence', areas),
      f('Ação tomada', 'text'),
      f('Observações',  'text'),
    ],
  }],
});

const TPL_DEDETIZACAO = () => ({
  id:uid(), category:'dedetizacao', frequency:'monthly',
  title:'Controle de Dedetização',
  description:'Registrar empresa, data, serviço e produto. Anexar comprovante.',
  sections:[{ id:uid(), title:'Registro do serviço',
    fields:[
      f('Empresa executora','text'),
      f('Data do serviço','text'),
      f('Serviço executado','text'),
      f('Produto utilizado','text'),
      f('Número do certificado','text'),
      f('Observações','text'),
    ],
  }],
});

const TPL_POTABILIDADE = () => ({
  id:uid(), category:'potabilidade', frequency:'biweekly',
  title:'Controle da Potabilidade da Água',
  description:'Verificação quinzenal da troca de filtros e higienização do reservatório.',
  sections:[{ id:uid(), title:'Filtros',
    fields:[
      f('Filtro Pia — troca realizada?'),
      f('Filtro Máquina de Gelo — troca realizada?'),
      f('Data da troca','text'),
      f('Empresa / responsável','text'),
      f('Observações','text'),
    ],
  }],
});

const TPL_FAXINA_BACKEREI = () => ({
  id:uid(), category:'faxina', frequency:'weekly',
  title:'Controle de Faxina — Bäckerei',
  description:'Verificação semanal de higienização. Registrar data e responsável.',
  sections:[
    { id:uid(), title:'Interna', fields:[
      f('Vitrine Refrigerada: acrílico, inox, vidro, filtro motor','date_sig'),
      f('Mesa Caixa: armário e gaveta','date_sig'),
      f('Refrigerador: grades, borracha da porta','date_sig'),
      f('Vitrine de Folheados: interna e externa','date_sig'),
      f('Vitrine de Pães: interna, externa e armário','date_sig'),
      f('Máquina de Café / Bancada','date_sig'),
      f('Armário Horizontal 1 e 2','date_sig'),
      f('Armário Vertical 1 e 2','date_sig'),
      f('Estufa: interna e externa','date_sig'),
      f('Máquina de Lavar Louça','date_sig'),
      f('Forno: interna e externa','date_sig'),
      f('Pia / Armário Pia','date_sig'),
      f('Caixa de Gordura','date_sig'),
    ]},
    { id:uid(), title:'Externa', fields:[
      f('Mesas / Suplat: superfície e apoio','date_sig'),
      f('Cadeiras: couro','date_sig'),
      f('Vidros: dois lados / Piso','date_sig'),
      f('Máquina de Gelo','date_sig'),
      f('Mármore / Luminárias (trimestral)','date_sig'),
      f('Toldo (anual)','date_sig'),
    ]},
  ],
});

const TPL_FAXINA_SWISS = () => ({
  id:uid(), category:'faxina', frequency:'weekly',
  title:'Controle de Faxina — Swiss',
  description:'Verificação semanal de higienização. Registrar data e responsável.',
  sections:[
    { id:uid(), title:'Interna', fields:[
      f('Prateleiras 1 e 3','date_sig'), f('Prateleiras 2 e 4','date_sig'),
      f('Bancada','date_sig'), f('Refrigerador 1 e 2','date_sig'), f('Refrigerador 3 e 4','date_sig'),
      f('Micro-ondas','date_sig'), f('Forno','date_sig'), f('Carrinho','date_sig'),
      f('Bancada de Apoio','date_sig'), f('Freezer','date_sig'),
      f('Prateleiras Pia','date_sig'), f('Máquina de Lavar Louça','date_sig'),
      f('Pia Lavabo','date_sig'), f('Caixa de Gordura','date_sig'),
      f('Lixeiras','date_sig'), f('Máquina de Gelo','date_sig'), f('Adega','date_sig'),
    ]},
    { id:uid(), title:'Externa', fields:[
      f('Máquina de Café','date_sig'), f('Refrigerador 1','date_sig'),
      f('Vitrine de Pães','date_sig'), f('Prateleira Suspensa 1 e 2','date_sig'),
      f('Armário Limpeza','date_sig'), f('Armário Alimentos','date_sig'),
      f('Nichos 17','date_sig'), f('Vitrine Refrigerada','date_sig'),
      f('Refrigerador Expositor','date_sig'), f('Armário 1 e 2','date_sig'),
      f('Prateleiras 1/2 e 3/4','date_sig'), f('Luminárias','date_sig'),
      f('Mesas / Suplat','date_sig'), f('Toldo (anual)','date_sig'),
    ]},
    { id:uid(), title:'Estoque', fields:[
      f('Geladeira: grades e contentores','date_sig'), f('Freezer: grades e contentores','date_sig'),
      f('Estante / Estrado (bimestral)','date_sig'), f('Piso / Lixeiras','date_sig'),
      f('Paredes (trimestral)','date_sig'), f('Luminárias (trimestral)','date_sig'),
    ]},
  ],
});

const TPL_FAXINA_DBK = () => ({
  id:uid(), category:'faxina', frequency:'weekly',
  title:'Controle de Faxina — DBK Serviços Gerais',
  description:'Verificação semanal por área. Registrar data e assinatura do responsável.',
  sections:[
    { id:uid(), title:'Área de Recebimento', fields:[
      f('Elevador / Escada','date_sig'), f('Parede / Janela','date_sig'),
      f('Lavatório / Dispenser','date_sig'), f('Geladeira 1 e 2','date_sig'),
      f('Estante 1 e 2','date_sig'), f('Carrinho de recebimento','date_sig'),
      f('Telas / Luminárias','date_sig'),
    ]},
    { id:uid(), title:'Vestiário', fields:[
      f('Banheiro Feminino: janela, parede, box, pia, sanitário, piso','date_sig'),
      f('Banheiro Masculino: janela, parede, box, pia, sanitário, piso','date_sig'),
      f('Cadeiras / Paredes / Janelas / Portas','date_sig'),
      f('Telas / Luminárias','date_sig'),
    ]},
    { id:uid(), title:'Refeitório', fields:[
      f('Mesa / Cadeiras','date_sig'), f('Pia / Filtro','date_sig'),
      f('Caixa de Gordura','date_sig'), f('Paredes / Janelas / Portas','date_sig'),
      f('Telas / Luminárias','date_sig'),
    ]},
    { id:uid(), title:'DML / Estoque / Escritório', fields:[
      f('Estante / Parede / Porta — DML','date_sig'),
      f('Estantes / Estrados — Estoque','date_sig'), f('Parede / Porta — Estoque','date_sig'),
      f('Banheiro Escritório','date_sig'), f('Mesa / Cadeiras — Escritório','date_sig'),
      f('Paredes / Janelas / Portas — Escritório','date_sig'),
      f('Telas / Luminárias — Escritório','date_sig'),
    ]},
    { id:uid(), title:'Confeitaria e Padaria', fields:[
      f('Caixa de Gordura — Confeitaria','date_sig'),
      f('Paredes / Janelas / Portas — Padaria','date_sig'),
      f('Bancada e Estante 1 e 2 — Padaria','date_sig'),
      f('Telas / Luminárias — Padaria','date_sig'),
      f('Telas / Luminárias — Confeitaria','date_sig'),
    ]},
  ],
});

const TPL_MANUTENCAO_DBK = () => ({
  id:uid(), category:'manutencao', frequency:'monthly',
  title:'Controle de Manutenção dos Equipamentos — DBK',
  description:'Registrar data e empresa de manutenção de cada equipamento.',
  sections:[{ id:uid(), title:'Equipamentos', fields:[
    f('Câmara Congelada','date_sig'), f('Câmara Refrigerada','date_sig'),
    f('Refrigerador Bancada Confeitaria','date_sig'), f('Congelador Bancada Confeitaria','date_sig'),
    f('Refrigerador Bancada Panificação','date_sig'),
    f('Ar Condicionado Confeitaria','date_sig'), f('Ar Condicionado Escritório','date_sig'),
    f('Ar Condicionado Estoque','date_sig'),
    f('Geladeira Dupla Padaria','date_sig'), f('Geladeira Dupla Corredor','date_sig'),
  ]}],
});

function seedTemplates(tenant) {
  const id = (tenant.id ?? '').toLowerCase();
  if (id.includes('swiss'))                          return [TPL_HIGIENE_PESSOAL(), TPL_VETORES('C=Cozinha D=Distribuição S=Salão E=Externa'), TPL_DEDETIZACAO(), TPL_FAXINA_SWISS()];
  if (id.includes('backerei')||id.includes('bäck')) return [TPL_HIGIENE_PESSOAL(), TPL_VETORES(), TPL_DEDETIZACAO(), TPL_FAXINA_BACKEREI(), TPL_POTABILIDADE()];
  if (id.includes('dbk'))                            return [TPL_FAXINA_DBK(), TPL_MANUTENCAO_DBK(), TPL_VETORES()];
  return [TPL_HIGIENE_PESSOAL(), TPL_VETORES(), TPL_DEDETIZACAO()];
}

// ─── Field components ──────────────────────────────────────────────────────

function CNCButton({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:6 }}>
      {['C','NC',''].map((opt) => {
        const on = value===opt;
        const [bg,color,border] = opt==='C' ? ['#dafbe1','#1a7f37','#4ac26b'] : opt==='NC' ? ['#ffebe9','#cf222e','#ff8182'] : ['#f6f8fa','#656d76','#d0d7de'];
        return (
          <button key={opt||'x'} onClick={() => onChange(on?'':opt)}
            style={{ padding:'5px 14px', borderRadius:6, border:`1.5px solid ${on?border:'#d0d7de'}`, background:on?bg:'white', color:on?color:'#656d76', fontWeight:on?700:500, fontSize:12, cursor:'pointer', transition:'all .12s' }}>
            {opt||'—'}
          </button>
        );
      })}
    </div>
  );
}

function PresenceField({ value={}, onChange }) {
  const detected = value?.detected ?? false;
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
      <button onClick={() => onChange({ ...value, detected:!detected })}
        style={{ padding:'5px 14px', borderRadius:6, border:`1.5px solid ${detected?'#ff8182':'#4ac26b'}`, background:detected?'#ffebe9':'#dafbe1', color:detected?'#cf222e':'#1a7f37', fontWeight:700, fontSize:12, cursor:'pointer' }}>
        {detected ? 'Detectado' : 'Sem ocorrência'}
      </button>
      {detected && (
        <input value={value?.location??''} onChange={(e) => onChange({ ...value, location:e.target.value })}
          placeholder="Local" style={{ width:130, padding:'5px 8px', borderRadius:6, border:'1px solid #d0d7de', fontSize:12, fontFamily:'inherit' }} />
      )}
    </div>
  );
}

function DateSigField({ value={}, onChange }) {
  return (
    <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
      <input type="date" value={value?.date??''} onChange={(e) => onChange({ ...value, date:e.target.value })}
        style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #d0d7de', fontSize:12, fontFamily:'inherit' }} />
      <input value={value?.sig??''} onChange={(e) => onChange({ ...value, sig:e.target.value })}
        placeholder="Responsável" style={{ flex:1, minWidth:120, padding:'5px 8px', borderRadius:6, border:'1px solid #d0d7de', fontSize:12, fontFamily:'inherit' }} />
    </div>
  );
}

// ─── Form Fill ─────────────────────────────────────────────────────────────

function FormFill({ template, record, onSave, onBack, session, tenant }) {
  const [responses, setResponses] = useState(() => record?.responses ?? {});
  const [saving, setSaving] = useState(false);
  const pct = completionPct(template, { responses });

  const setField = (id, val) => setResponses((prev) => ({ ...prev, [id]:val }));

  const handleSave = async (status) => {
    setSaving(true);
    await onSave({ responses, status });
    setSaving(false);
  };

  const handlePDF = () => {
    const rec = { ...record, responses, updatedAt:new Date().toISOString(), user:session?.user?.name??'—', role:session?.user?.role??'' };
    const win = window.open('','_blank');
    win.document.write(generateFormPDF(template, rec, tenant));
    win.document.close();
    setTimeout(() => win.print(), 400);
  };

  return (
    <div className="form-fill-view">
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button className="ghost-action" onClick={onBack} style={{ padding:'6px 10px' }}>← Voltar</button>
        <div style={{ flex:1 }}>
          <span className="eyebrow">{freqLabel(template.frequency)} · {catMeta(template.category).label}</span>
          <h2 style={{ fontSize:18, fontWeight:800, letterSpacing:'-.03em', marginTop:2 }}>{template.title}</h2>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:24, fontWeight:800, fontFamily:'var(--mono)', color:pct===100?'var(--green)':'var(--text)' }}>{pct}%</div>
          <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'.05em' }}>preenchido</div>
        </div>
      </div>

      <div style={{ height:4, background:'var(--border-subtle)', borderRadius:2, marginBottom:24, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:pct===100?'var(--green)':'var(--blue)', borderRadius:2, transition:'width .3s' }} />
      </div>

      {template.sections.map((sec) => (
        <div key={sec.id} style={{ marginBottom:24 }}>
          {template.sections.length>1 && (
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--text-secondary)', marginBottom:12, paddingBottom:8, borderBottom:'1px solid var(--border-subtle)' }}>{sec.title}</div>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {sec.fields.map((field) => (
              <div key={field.id} className="form-field-row">
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{field.label}</div>
                  {field.hint && <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>{field.hint}</div>}
                </div>
                <div>
                  {field.type==='cnc'      && <CNCButton value={responses[field.id]??''} onChange={(v) => setField(field.id,v)} />}
                  {field.type==='presence' && <PresenceField value={responses[field.id]} onChange={(v) => setField(field.id,v)} />}
                  {field.type==='date_sig' && <DateSigField value={responses[field.id]} onChange={(v) => setField(field.id,v)} />}
                  {field.type==='text'     && <textarea value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)} placeholder="Observações…" style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit', resize:'vertical', minHeight:54 }} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ display:'flex', gap:8, paddingTop:16, borderTop:'1px solid var(--border-subtle)', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap' }}>
        <button className="secondary-action" onClick={handlePDF} style={{ fontSize:12 }}>↓ Exportar PDF</button>
        <div style={{ display:'flex', gap:8 }}>
          <button className="secondary-action" onClick={() => handleSave('draft')} disabled={saving}>Salvar rascunho</button>
          <button className={`primary-action${pct>0?' attention':''}`} onClick={() => handleSave('submitted')} disabled={saving||pct===0}>
            {saving?'Salvando…':'Confirmar preenchimento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RT Validation Panel ───────────────────────────────────────────────────

function RTValidationPanel({ records, templates, onValidate, session }) {
  const [validatingId, setValidatingId] = useState(null);
  const [note, setNote] = useState('');

  const pending = records.filter((r) => r.status==='submitted' && !r.validation);
  const validated = records.filter((r) => r.validation).slice(0,10);

  const confirm = (record) => {
    onValidate(record.id, {
      by:   session?.user?.name ?? 'RT',
      role: session?.user?.role ?? 'Nutricionista RT',
      at:   new Date().toISOString(),
      note: note.trim(),
    });
    setValidatingId(null); setNote('');
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <article className="management-card">
        <div className="card-head">
          <div><span className="eyebrow">Aguardando RT</span><h2>Planilhas para validar</h2></div>
          {pending.length>0 && <span className="badge warn">{pending.length}</span>}
        </div>
        <div className="equipment-maintenance-list">
          {pending.length===0
            ? <p className="muted" style={{ padding:'20px' }}>✓ Nenhuma planilha aguardando validação.</p>
            : pending.map((rec) => {
              const tpl = templates.find((t) => t.id===rec.formId);
              const meta = catMeta(rec.category);
              return (
                <div key={rec.id} style={{ padding:'12px 20px', borderBottom:'1px solid var(--border-subtle)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
                    <div>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                        <strong style={{ fontSize:13 }}>{rec.formTitle}</strong>
                        <span className="badge subtle" style={{ background:meta.bg, color:meta.color, borderColor:'transparent' }}>{meta.label}</span>
                      </div>
                      <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
                        {formatPeriodLabel(rec.frequency, rec.periodKey)} · Preenchido por {rec.user} · {new Date(rec.updatedAt).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <button className="primary-action" style={{ fontSize:12, padding:'6px 12px' }} onClick={() => setValidatingId(validatingId===rec.id?null:rec.id)}>
                      {validatingId===rec.id ? 'Cancelar' : 'Validar'}
                    </button>
                  </div>
                  {validatingId===rec.id && (
                    <div style={{ marginTop:10, display:'flex', gap:8, alignItems:'flex-end' }}>
                      <label style={{ flex:1 }}>Observação (opcional)
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comentário do RT…" style={{ minHeight:48, marginTop:4, padding:'6px 8px', borderRadius:8, border:'1px solid var(--border)', fontSize:12, fontFamily:'inherit', width:'100%', resize:'vertical' }} />
                      </label>
                      <button className="primary-action attention" onClick={() => confirm(rec)} style={{ fontSize:12, padding:'8px 16px', whiteSpace:'nowrap' }}>✓ Assinar e validar</button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </article>

      {validated.length>0 && (
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Recentemente validadas pelo RT</h2></div></div>
          <div className="equipment-maintenance-list">
            {validated.map((rec) => {
              const meta = catMeta(rec.category);
              return (
                <div key={rec.id} className="equipment-maintenance-row">
                  <div>
                    <strong>{rec.formTitle}</strong>
                    <span>{formatPeriodLabel(rec.frequency, rec.periodKey)} · {rec.user}</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                    <span className="badge ok">✓ Validado por {rec.validation.by}</span>
                    <span style={{ fontSize:10, color:'var(--text-secondary)' }}>{new Date(rec.validation.at).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}
    </div>
  );
}

// ─── Main Forms View ───────────────────────────────────────────────────────

export function FormsView({ activeTenant, allTenants, onTenantChange, session }) {
  const isRT = ['Nutricionista RT','Administrador','Super-admin'].includes(session?.user?.role);

  const [templates, setTemplates] = useState(() => readFormTemplates(activeTenant));
  const [records,   setRecords]   = useState(() => readFormRecords(activeTenant.id));
  const [filling,   setFilling]   = useState(null);
  const [kioskForm, setKioskForm] = useState(null); // tablet mode for a specific form
  const [catFilter, setCatFilter] = useState('all');
  const [histId,    setHistId]    = useState(null);
  const [tab,       setTab]       = useState('forms'); // 'forms' | 'validation'

  useEffect(() => {
    setTemplates(readFormTemplates(activeTenant));
    setRecords(readFormRecords(activeTenant.id));
    setFilling(null); setHistId(null);
  }, [activeTenant.id]);

  useEffect(() => { writeFormRecords(activeTenant.id, records); }, [activeTenant.id, records]);
  useEffect(() => { writeFormTemplates(activeTenant.id, templates); }, [activeTenant.id, templates]);

  const today = new Date();
  const getRecord = (tpl, pk) => records.find((r) => r.formId===tpl.id && r.periodKey===pk) ?? null;

  const handleSave = useCallback(({ responses, status }) => {
    if (!filling) return;
    const { template, periodKey } = filling;
    setRecords((prev) => {
      const ex = prev.find((r) => r.formId===template.id && r.periodKey===periodKey);
    const up = {
        id: ex?.id ?? uid(),
        tenantId: activeTenant.id, formId: template.id, formTitle: template.title,
        category: template.category, frequency: template.frequency, periodKey,
        responses, status,
        user: session?.user?.name ?? 'Usuário', role: session?.user?.role ?? '',
        createdAt: ex?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      // Push to Supabase
      pushFormRecord(activeTenant.id, up);
      return ex ? prev.map((r) => r.id===ex.id?up:r) : [...prev, up];
    });
    setFilling(null);
  }, [filling, activeTenant.id, session]);

  const handleValidate = useCallback((recordId, validation) => {
    setRecords((prev) => prev.map((r) => r.id===recordId ? { ...r, validation, updatedAt:new Date().toISOString() } : r));
  }, []);

  const pendingValidation = records.filter((r) => r.status==='submitted' && !r.validation).length;
  const filteredTemplates = catFilter==='all' ? templates : templates.filter((t) => t.category===catFilter);
  const categories = [...new Set(templates.map((t) => t.category))];

  if (kioskForm) {
    const { template, record, periodKey } = kioskForm;
    return (
      <FormKioskApp
        template={template}
        tenantId={activeTenant.id}
        tenantName={activeTenant.name}
        userName={session?.user?.name ?? '—'}
        userRole={session?.user?.role ?? ''}
        onExit={() => setKioskForm(null)}
        onSave={async (responses) => {
          const existing = records.find(r => r.formId === template.id && r.periodKey === periodKey);
          const updated = {
            id: existing?.id ?? crypto.randomUUID(),
            tenantId: activeTenant.id, formId: template.id, formTitle: template.title,
            category: template.category, frequency: template.frequency, periodKey,
            responses, status: 'submitted',
            user: session?.user?.name ?? '—', role: session?.user?.role ?? '',
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setRecords(prev => existing ? prev.map(r => r.id === existing.id ? updated : r) : [...prev, updated]);
        }}
      />
    );
  }

  if (filling) {
    return (
      <div className="management-page">
        <FormFill template={filling.template} record={filling.record}
          onSave={handleSave} onBack={() => setFilling(null)} session={session} tenant={activeTenant} />
      </div>
    );
  }

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Boas Práticas de Fabricação</span>
          <h1>Planilhas de Controle</h1>
          <p className="muted">Formulários digitais do MBPF. Preencha o controle do período atual.</p>
        </div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:6, marginBottom:20 }}>
        {[['forms','Planilhas'],['validation','Validação RT']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding:'7px 16px', borderRadius:8, border:'1px solid var(--border)', background:tab===key?'var(--text)':'var(--surface)', color:tab===key?'white':'var(--text)', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'var(--font)', display:'flex', alignItems:'center', gap:8 }}>
            {label}
            {key==='validation' && pendingValidation>0 && (
              <span style={{ background:'var(--amber)', color:'white', borderRadius:10, fontSize:10, fontWeight:800, padding:'1px 6px' }}>{pendingValidation}</span>
            )}
          </button>
        ))}
      </div>

      {tab==='validation' && (
        <RTValidationPanel records={records} templates={templates} onValidate={handleValidate} session={session} />
      )}

      {tab==='forms' && (
        <>
          <div className="chip-row" style={{ marginBottom:16 }}>
            <button className={`quick-chip ${catFilter==='all'?'active':''}`} onClick={() => setCatFilter('all')}>
              <strong>Todas</strong><span>{templates.length} planilhas</span>
            </button>
            {categories.map((cat) => {
              const meta = catMeta(cat);
              return (
                <button key={cat} className={`quick-chip ${catFilter===cat?'active':''}`} onClick={() => setCatFilter(cat)}>
                  <strong>{meta.label}</strong><span>{templates.filter((t) => t.category===cat).length}</span>
                </button>
              );
            })}
          </div>

          <div className="forms-grid">
            {filteredTemplates.map((tpl) => {
              const pk     = getPeriodKey(tpl.frequency, today);
              const rec    = getRecord(tpl, pk);
              const pct    = completionPct(tpl, rec);
              const meta   = catMeta(tpl.category);
              const isDone = rec?.status==='submitted';
              const isDraft= rec?.status==='draft';
              const isValidated = Boolean(rec?.validation);
              const history = records.filter((r) => r.formId===tpl.id).sort((a,b) => b.periodKey.localeCompare(a.periodKey)).slice(0,8);

              return (
                <article key={tpl.id} className="form-card" style={{ borderTopColor:meta.color }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                    <div>
                      <span className="eyebrow" style={{ color:meta.color }}>{meta.label} · {freqLabel(tpl.frequency)}</span>
                      <h3 style={{ fontSize:14, fontWeight:700, marginTop:3, marginBottom:0 }}>{tpl.title}</h3>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                      {isValidated
                        ? <span className="badge ok">✓ RT validado</span>
                        : isDone ? <span className="badge subtle">✓ Concluído</span>
                        : isDraft ? <span className="badge warn">Rascunho</span>
                        : <span className="badge neutral">Pendente</span>}
                    </div>
                  </div>
                  <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:10, lineHeight:1.5 }}>{tpl.description}</p>
                  <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:10 }}>
                    Período: <strong style={{ color:'var(--text)' }}>{formatPeriodLabel(tpl.frequency, pk)}</strong>
                  </div>
                  <div style={{ height:4, background:'var(--border-subtle)', borderRadius:2, marginBottom:12, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${pct}%`, background:isValidated?'var(--green)':isDone?meta.color:meta.color, borderRadius:2, transition:'width .3s', opacity:isDone?1:0.6 }} />
                  </div>
                  <div style={{ display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
                    <button className="ghost-action" style={{ fontSize:11 }} onClick={() => setHistId(histId===tpl.id?null:tpl.id)}>
                      {histId===tpl.id?'Fechar':'Histórico'}
                    </button>
                    <div style={{ display:'flex', gap:6 }}>
                      {isDone && (
                        <button className="secondary-action" style={{ fontSize:11, padding:'5px 10px' }} onClick={() => {
                          const win = window.open('','_blank');
                          win.document.write(generateFormPDF(tpl, rec, activeTenant));
                          win.document.close(); setTimeout(() => win.print(), 400);
                        }}>↓ PDF</button>
                      )}
                      <button className="secondary-action" style={{ fontSize:11, padding:'5px 10px', background:'#0d1117', color:'white', borderColor:'transparent' }}
                        onClick={() => { const pk2=getPeriodKey(tpl.frequency,today); setKioskForm({ template:tpl, record:getRecord(tpl,pk2), periodKey:pk2 }); }}>
                        📱 Tablet
                      </button>
                      <button className="primary-action" style={{ fontSize:12, padding:'6px 14px', background:isValidated?'var(--green)':`linear-gradient(135deg,${meta.color},${meta.color}cc)` }}
                        onClick={() => { const pk2=getPeriodKey(tpl.frequency,today); setFilling({ template:tpl, record:getRecord(tpl,pk2), periodKey:pk2 }); }}>
                        {isDone?'Ver / editar':isDraft?'Continuar':'Preencher'}
                      </button>
                    </div>
                  </div>

                  {histId===tpl.id && (
                    <div style={{ marginTop:12, borderTop:'1px solid var(--border-subtle)', paddingTop:12 }}>
                      <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--text-secondary)', marginBottom:8 }}>Histórico</div>
                      {history.length===0
                        ? <p style={{ fontSize:12, color:'var(--text-secondary)' }}>Sem registros anteriores.</p>
                        : history.map((r) => (
                          <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border-subtle)' }}>
                            <div>
                              <div style={{ fontSize:12, fontWeight:600 }}>{formatPeriodLabel(tpl.frequency, r.periodKey)}</div>
                              <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{r.user} · {new Date(r.updatedAt).toLocaleDateString('pt-BR')}</div>
                            </div>
                            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                              {r.validation && <span className="badge ok" style={{ fontSize:10 }}>RT ✓</span>}
                              <span className={`badge ${r.status==='submitted'?'subtle':'warn'}`} style={{ fontSize:10 }}>
                                {r.status==='submitted'?'Concluído':'Rascunho'}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
