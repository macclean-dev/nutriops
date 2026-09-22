// ─────────────────────────────────────────────────────────────────────────────
// Carimbo de 1 toque: "✓ Feito agora - Nome" grava a data de hoje + quem está
// preenchendo, sem digitar nada. "Outra pessoa / outro dia" abre os campos
// crus pra exceção real: tarefa feita por outra pessoa, ou preenchimento
// retroativo (outro dia). Nasceu em forms.jsx pras planilhas de higienização
// (14-30 tarefas por planilha, cada uma pedindo as duas coisas à mão) e virou
// pedido em outras telas, extraído pra módulo próprio (22/09) pra pages.jsx
// poder usar sem puxar forms.jsx inteiro.
//
// Valor: `{ date: 'YYYY-MM-DD', sig: 'Nome' }`.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';

// Mesmo formato que getPeriodKey('daily', date) em forms.jsx (YYYY-MM-DD,
// data local). Reimplementado aqui (não importado de forms.jsx) porque
// forms.jsx também consome este módulo; importar de lá criaria ciclo.
function hojeYMD(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function quickSign(currentName) {
  return { date: hojeYMD(), sig: (currentName ?? '').trim() };
}

export function DateSigField({ value = {}, onChange, currentName }) {
  const [editing, setEditing] = useState(false);
  const done = Boolean(value?.date || value?.sig);

  if (done && !editing) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:20, background:'#dafbe1', border:'1px solid #4ac26b', color:'#00a35c', fontSize:12, fontWeight:700 }}>
          ✓ {value.date ? value.date.split('-').reverse().join('/') : '—'} · {value.sig || '—'}
        </span>
        <button type="button" onClick={() => setEditing(true)} className="ghost-action" style={{ fontSize:11, padding:'2px 8px' }}>Editar</button>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <button type="button" onClick={() => { onChange(quickSign(currentName)); setEditing(false); }}
          style={{ padding:'6px 14px', borderRadius:8, border:'1.5px solid #4ac26b', background:'#dafbe1', color:'#00a35c', fontWeight:700, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
          ✓ Feito agora{currentName ? ` — ${currentName}` : ''}
        </button>
        {!editing && <button type="button" onClick={() => setEditing(true)} className="ghost-action" style={{ fontSize:11 }}>Outra pessoa / outro dia</button>}
        {editing && <button type="button" onClick={() => setEditing(false)} className="ghost-action" style={{ fontSize:11 }}>Fechar</button>}
      </div>
      {editing && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <input type="date" value={value?.date??''} onChange={(e) => onChange({ ...value, date:e.target.value })}
            style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #c1ccd6', fontSize:12, fontFamily:'inherit' }} />
          <input value={value?.sig??''} onChange={(e) => onChange({ ...value, sig:e.target.value })}
            placeholder="Responsável" style={{ flex:1, minWidth:120, padding:'5px 8px', borderRadius:6, border:'1px solid #c1ccd6', fontSize:12, fontFamily:'inherit' }} />
        </div>
      )}
    </div>
  );
}
