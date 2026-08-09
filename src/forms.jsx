import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FormKioskApp } from './kiosk';
import { pushFormRecord } from './repository';

// Read company profile from localStorage
function getProfile(tenantId) {
  try { const r = localStorage.getItem(`nutriops.company.profile.${tenantId}`); return r ? JSON.parse(r) : {}; } catch { return {}; }
}

// ─── Storage ───────────────────────────────────────────────────────────────

const tplKey = (id) => `nutriops.forms.templates.${id}`;
const recKey = (id) => `nutriops.forms.records.${id}`;

const fl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const fs = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Planilhas da loja = cache local + as do seed que ainda não chegaram nele.
// Antes era `if (cache) return cache`, com dois furos que só apareciam depois:
//   1. `[]` é TRUTHY. O syncModule grava [] quando a nuvem ainda não tem
//      nenhuma planilha (loja nova, ou pull que veio vazio), e a partir daí o
//      seed nunca mais rodava — a loja ficava com ZERO planilhas pra sempre.
//   2. Planilha NOVA no seed nunca alcançava quem já tinha cache. As 21 de
//      higienização da CASA DOCE (Fase D) chegaram depois das 11 primeiras:
//      sem o merge, a loja continuaria vendo só as 11.
// Merge por id (os ids do seed são FIXOS — é essa a razão da convenção) e só
// ACRESCENTA: edição local de uma planilha existente é preservada. Não há
// exclusão de planilha na UI, então não há risco de ressuscitar algo apagado
// de propósito — se um dia houver, isto precisa de tombstone.
export const readFormTemplates = (tenant) => {
  const cache = fl(tplKey(tenant.id), null);
  const seed  = seedTemplates(tenant);
  if (!Array.isArray(cache)) { fs(tplKey(tenant.id), seed); return seed; }

  const porId = new Map(cache.map((t) => [t.id, t]));
  let mudou = false;
  for (const s of seed) {
    const atual = porId.get(s.id);
    if (!atual) { porId.set(s.id, s); mudou = true; continue; }
    // Planilha do seed que MUDOU DE VERSÃO (campo novo, rótulo corrigido):
    // substitui a definição. Sem isto, só planilha NOVA chegava — quem já
    // rodava ficava preso na versão antiga pra sempre. Foi o que aconteceria
    // com os ajustes que a nutricionista pediu em 07/08 (data, responsável,
    // setor): nada apareceria pra ela.
    //
    // O carimbo updatedAt é essencial: o sync funde local↔nuvem por mergeByKey,
    // que escolhe o mais RECENTE. Sem ele o seed vale epoch e qualquer linha
    // velha da nuvem desfaria a atualização no boot seguinte.
    // `custom` = a RT editou as tarefas. Não sobrescreve: o ajuste dela vale
    // mais que o meu seed, e sobrescrever apagaria equipamento que ela mesma
    // cadastrou na planilha.
    if (atual.custom) continue;
    if ((s.v ?? 0) > (atual.v ?? 0)) {
      porId.set(s.id, { ...s, updatedAt: new Date().toISOString() });
      mudou = true;
    }
  }
  if (!mudou) return cache;
  const merged = [...porId.values()];
  fs(tplKey(tenant.id), merged);
  return merged;
};
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

// "Minha lista de hoje" (item 4 da revisão de produto) — o app cobra o
// colaborador por temperatura mas nunca por planilha; essa informação só
// existia dentro do relatório BPF, pra RT. Mesmo cálculo de período que
// FormsView já usa por card, só que devolvendo direto a lista do que falta —
// sem RT, sem UI, testável sozinho.
export function pendingFormsForPeriod(templates, records, now = new Date()) {
  return (templates ?? [])
    .map((tpl) => {
      const periodKey = getPeriodKey(tpl.frequency, now);
      const rec = (records ?? []).find((r) => r.formId === tpl.id && r.periodKey === periodKey);
      return {
        id: tpl.id, title: tpl.title, category: tpl.category, periodKey,
        periodLabel: formatPeriodLabel(tpl.frequency, periodKey),
        status: rec?.status ?? 'missing',
      };
    })
    .filter((f) => f.status !== 'submitted');
}

function uid() { return crypto.randomUUID(); }
const f = (label, type='cnc', hint=null) => ({ id:uid(), label, type, hint });

// ─── Foto de evidência ─────────────────────────────────────────────────────
// Reduz no APARELHO antes de enviar: foto de celular vem com 3-4 MB e 4000px,
// resolução que não acrescenta nada pra provar uma unha comprida ou um uniforme
// sujo. 1280px/JPEG 0.72 dá ~120 KB — sobe rápido no 4G da loja e não estoura a
// franquia de armazenamento. O original nunca sai do aparelho.
export async function reduzirFoto(file, maxLado = 1280, qualidade = 0.72) {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * escala), h = Math.round(bitmap.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Não consegui processar a imagem.');
  return blob;
}

// value = { path, at } — só o CAMINHO no Storage; o arquivo não entra no
// registro (ver o comentário do bucket em repository.js).
function PhotoField({ value, onChange, tenantId, formId, periodKey, fieldId }) {
  const [erro, setErro]   = useState('');
  const [subindo, setSub] = useState(false);
  const [url, setUrl]     = useState(null);

  useEffect(() => {
    let cancelado = false;
    if (!value?.path) { setUrl(null); return; }
    // Bucket privado → cada exibição pede um link temporário.
    import('./repository').then(m => m.signedPhotoUrl(tenantId, value.path))
      .then(u => { if (!cancelado) setUrl(u); }).catch(() => {});
    return () => { cancelado = true; };
  }, [value?.path, tenantId]);

  const escolher = async (file) => {
    if (!file) return;
    setErro(''); setSub(true);
    try {
      const m = await import('./repository');
      const blob = await reduzirFoto(file);
      const path = await m.uploadFormPhoto(tenantId, blob, { formId, periodKey, fieldId });
      onChange({ path, at: new Date().toISOString() });
    } catch (e) {
      setErro(e.message ?? 'Não consegui anexar a foto.');
    }
    setSub(false);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'flex-start' }}>
      {value?.path ? (
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {url
            ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Evidência" style={{ width:88, height:88, objectFit:'cover', borderRadius:'var(--r)', border:'1px solid var(--border)' }} /></a>
            : <div style={{ width:88, height:88, borderRadius:'var(--r)', border:'1px dashed var(--border)', display:'grid', placeItems:'center', fontSize:11, color:'var(--text-secondary)' }}>abrindo…</div>}
          <button className="ghost-action danger" style={{ fontSize:11 }} onClick={() => onChange(null)}>Remover</button>
        </div>
      ) : (
        // `capture` faz o celular abrir a câmera direto, sem passar pela galeria.
        <label className="secondary-action" style={{ fontSize:12, padding:'7px 12px', cursor: subindo ? 'wait' : 'pointer' }}>
          {subindo ? 'Enviando…' : '📷 Anexar foto'}
          <input type="file" accept="image/*" capture="environment" disabled={subindo}
            onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ''; }}
            style={{ display:'none' }} />
        </label>
      )}
      {erro && <span style={{ fontSize:11, color:'var(--red)', fontWeight:600 }}>{erro}</span>}
    </div>
  );
}

// ─── Editor de tarefas de uma planilha de higienização ─────────────────────
// A RT cadastra equipamento novo (temperatura) mas não conseguia incluí-lo na
// planilha de higienização do setor — pedido dela em 07/08. Mexe SÓ na seção
// de tarefas; o cabeçalho e o bloco de não conformidade ficam intactos.
//
// Planilha editada vira `custom:true` e para de receber atualização automática
// do seed (readFormTemplates pula), senão o próximo ajuste meu apagaria o que
// ela cadastrou. É a troca certa: quem edita assume o conteúdo.
export function TaskEditorModal({ template, onSave, onClose }) {
  const secId  = template.sections.find((s) => s.id.endsWith('-t'))?.id ?? template.sections[0]?.id;
  const secIdx = template.sections.findIndex((s) => s.id === secId);
  const [tarefas, setTarefas] = useState(() => template.sections[secIdx]?.fields ?? []);
  const [nome, setNome] = useState('');
  const [per,  setPer]  = useState('semanal');

  const add = () => {
    const t = nome.trim();
    if (!t) return;
    // id único e estável: sufixo do timestamp evita colidir com os do seed
    // (cd-hig-padaria-0..13) quando ela adicionar e remover várias vezes.
    setTarefas((prev) => [...prev, { id:`${secId}-x${prev.length}-${Date.now().toString(36)}`, label:`${t} (${per})`, type:'date_sig' }]);
    setNome('');
  };
  const remover = (id) => setTarefas((prev) => prev.filter((f) => f.id !== id));

  const salvar = () => {
    const sections = template.sections.map((s, i) => i === secIdx ? { ...s, fields: tarefas } : s);
    onSave({ ...template, sections, custom:true, updatedAt:new Date().toISOString() });
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:24 }}>
      <div className="management-card" style={{ width:'100%', maxWidth:560, maxHeight:'85vh', display:'flex', flexDirection:'column' }}>
        <div className="card-head">
          <div><span className="eyebrow">Editar tarefas</span><h2>{template.title}</h2></div>
          <span className="badge neutral">{tarefas.length}</span>
        </div>
        <div className="capture-fields" style={{ borderBottom:'1px solid var(--border-subtle)', paddingBottom:14 }}>
          <label>Nova tarefa / equipamento
            <input value={nome} onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
              placeholder="Ex.: Refrigerador vertical R.20" />
          </label>
          <div className="grid-2">
            <label>Período
              <select value={per} onChange={(e) => setPer(e.target.value)}>
                {['diária','semanal','quinzenal','mensal'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <div style={{ display:'flex', alignItems:'flex-end' }}>
              <button className="primary-action" onClick={add} disabled={!nome.trim()} style={{ width:'100%' }}>Adicionar</button>
            </div>
          </div>
        </div>
        <div className="equipment-maintenance-list" style={{ overflowY:'auto', flex:1, minHeight:0 }}>
          {tarefas.length === 0
            ? <p className="muted" style={{ padding:'16px 20px' }}>Nenhuma tarefa. Adicione ao menos uma.</p>
            : tarefas.map((f) => (
              <div key={f.id} className="equipment-maintenance-row">
                <div><strong>{f.label}</strong></div>
                <button className="ghost-action danger" style={{ fontSize:11 }} onClick={() => remover(f.id)}>Remover</button>
              </div>
            ))}
        </div>
        <p className="muted" style={{ fontSize:11, padding:'10px 0 0' }}>
          Ao salvar, esta planilha passa a ser sua: deixa de receber atualizações automáticas do NutriOPS.
        </p>
        <div className="actions-row">
          <button className="secondary-action" onClick={onClose}>Cancelar</button>
          <button className="primary-action" onClick={salvar}>Salvar planilha</button>
        </div>
      </div>
    </div>
  );
}

// ─── Category metadata ─────────────────────────────────────────────────────

const CAT = {
  higiene_pessoal: { label:'Higiene Pessoal',  color:'#00684a', bg:'rgba(29,78,137,.10)' },
  vetores_pragas:  { label:'Vetores e Pragas', color:'#9a3412', bg:'#fff7ed' },
  dedetizacao:     { label:'Dedetização',      color:'#6b21a8', bg:'#faf5ff' },
  faxina:          { label:'Faxina',           color:'#065f46', bg:'#ecfdf5' },
  higienizacao:    { label:'Higienização',     color:'#00684a', bg:'#ecfdf5' },
  potabilidade:    { label:'Potabilidade',     color:'#1e40af', bg:'#eff6ff' },
  manutencao:      { label:'Manutenção',       color:'#92400e', bg:'#fffbeb' },
  recebimento:     { label:'Recebimento',      color:'#374151', bg:'#f9fafb' },
  residuos:        { label:'Resíduos',          color:'#3f6212', bg:'#f7fee7' },
  custom:          { label:'Personalizado',    color:'#374151', bg:'#f9fafb' },
};
export function catMeta(cat) { return CAT[cat] ?? CAT.custom; }

// ─── Completion helpers ────────────────────────────────────────────────────

// Carimbo de 1 toque do date_sig — hoje + quem está registrando. O sistema já
// sabe as duas coisas (é o mesmo texto que `record.user`/`createdAt` já
// carimbam sozinhos); antes disso o colaborador digitava as duas de novo, à
// mão, uma vez por tarefa — 14 a 30 vezes numa planilha de higienização.
export function quickSign(currentName) {
  return { date: getPeriodKey('daily'), sig: (currentName ?? '').trim() };
}

export function completionPct(template, record) {
  if (!record) return 0;
  let total=0, filled=0;
  for (const sec of template.sections) {
    for (const field of sec.fields) {
      // text e photo não entram no percentual: observação e evidência são
      // opcionais por natureza. Contar a foto deixaria a planilha eternamente
      // "incompleta" nos dias em que não houve nada pra fotografar.
      if (field.type==='text' || field.type==='photo') continue;
      total++;
      const v = record.responses?.[field.id];
      if (field.type==='checkbox') { if (v===true) filled++; continue; } // só marcado conta
      if (v!==undefined && v!==null && v!=='') { if (typeof v==='object' ? (v.date||v.sig||v.detected!==undefined) : v!=='') filled++; }
    }
  }
  return total>0 ? Math.round((filled/total)*100) : 0;
}

// Uma NC escrita numa planilha ficava só ali dentro — a Central de
// Não-Conformidades precisa achá-las sem conhecer cada template na mão.
// Convenção usada em TODAS as seções de NC (Banheiros, Hortifrutícolas, as 21
// de Higienização): a seção termina em "-nc" e tem 3 campos de texto com
// sufixo -ncdesc/-ncacao/-ncresp. Genérico de propósito — funciona pra
// qualquer template futuro que siga a mesma convenção, sem precisar listar ids.
export function extractNonConformities(template, record) {
  if (!record?.responses) return [];
  const out = [];
  for (const sec of template.sections ?? []) {
    if (!sec.id?.endsWith('-nc')) continue;
    const descField = sec.fields.find((f) => f.id.endsWith('ncdesc'));
    if (!descField) continue;
    const description = record.responses[descField.id];
    if (!description || !String(description).trim()) continue; // só conta se tem o quê
    const acaoField = sec.fields.find((f) => f.id.endsWith('ncacao'));
    const respField = sec.fields.find((f) => f.id.endsWith('ncresp'));
    out.push({
      sectionId: sec.id,
      description: String(description).trim(),
      action: acaoField ? (record.responses[acaoField.id] ?? null) : null,
      responsible: respField ? (record.responses[respField.id] ?? null) : null,
    });
  }
  return out;
}

// ─── PDF generator for forms ───────────────────────────────────────────────

export function generateFormPDF(template, record, tenant) {
  const p       = getProfile(tenant?.id);
  const period  = formatPeriodLabel(template.frequency, record.periodKey);
  const filledAt = new Date(record.updatedAt).toLocaleString('pt-BR');
  const meta     = catMeta(template.category);
  const validated = record.validation;

  // Company header block
  const companyHeader = `
    <div class="company-header">
      <div>
        <div class="company-name">${p.razaoSocial || tenant?.name || ''}</div>
        ${p.cnpj ? `<div class="company-detail">CNPJ: ${p.cnpj}</div>` : ''}
        ${p.endereco ? `<div class="company-detail">${p.endereco}</div>` : ''}
        ${p.telefone ? `<div class="company-detail">Tel.: ${p.telefone}</div>` : ''}
        ${p.alvara ? `<div class="company-detail">Alvará: ${p.alvara}</div>` : ''}
      </div>
      ${p.atividade ? `<div class="activity-badge">${p.atividade}</div>` : ''}
    </div>
  `;

  const renderValue = (field, val) => {
    if (!val && val !== false) return '<span style="color:#9198a1">—</span>';
    if (field.type==='cnc') return val==='C'
      ? '<span style="color:#00a35c;font-weight:700">✓ CONFORME</span>'
      : val==='NC' ? '<span style="color:#c0392b;font-weight:700">✗ NÃO CONFORME</span>'
      : '<span style="color:#9198a1">—</span>';
    if (field.type==='presence') {
      if (typeof val==='object') return val.detected
        ? `<span style="color:#c0392b;font-weight:700">DETECTADO</span>${val.location ? ` — ${val.location}` : ''}`
        : '<span style="color:#00a35c;font-weight:700">SEM OCORRÊNCIA</span>';
      return String(val);
    }
    if (field.type==='date_sig' && typeof val==='object')
      return `${val.date||'—'} · Resp.: <strong>${val.sig||'—'}</strong>`;
    if (field.type==='date') return String(val).split('-').reverse().join('/'); // AAAA-MM-DD → DD/MM/AAAA
    if (field.type==='checkbox') return val===true
      ? '<span style="color:#00a35c;font-weight:700">✓ SIM</span>'
      : '<span style="color:#9198a1">—</span>';
    // Foto: o PDF é impresso na hora e o link assinado expira em 1h — imprimir
    // uma URL que morre no mesmo dia seria pior que não imprimir. Registra que
    // existe evidência e quando; a imagem se vê no app.
    if (field.type==='photo') {
      if (!val?.path) return '<span style="color:#9198a1">—</span>';
      const q = val.at ? new Date(val.at).toLocaleString('pt-BR') : '';
      return `<span style="color:#00a35c;font-weight:700">📷 Foto anexada</span>${q ? ` <span style="color:#5c6c7a">(${q})</span>` : ''}`;
    }
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

  const rtName = p.rtNome || 'Nutricionista RT';
  const rtCrn  = p.rtCrn  || '';

  const validationHtml = validated ? `
    <div class="validation-stamp">
      <div class="stamp-header">✓ VALIDADO PELO RESPONSÁVEL TÉCNICO</div>
      <div><strong>${validated.by}</strong> · ${validated.role}${rtCrn ? ` · ${rtCrn}` : ''}</div>
      <div>${new Date(validated.at).toLocaleString('pt-BR')}</div>
      ${validated.note ? `<div class="stamp-note">${validated.note}</div>` : ''}
    </div>
  ` : `
    <div class="sign-block">
      <div class="sign-line"></div>
      <div>${rtName}${rtCrn ? ` · ${rtCrn}` : ''} · Data: ___/___/______</div>
    </div>
  `;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>${template.title} — ${period}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#001e2b;padding:24px}
    .company-header{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 14px;background:#f9fbfa;border:1px solid #c1ccd6;border-radius:6px;margin-bottom:14px}
    .company-name{font-size:14px;font-weight:800;color:#001e2b;margin-bottom:3px}
    .company-detail{font-size:10px;color:#5c6c7a;margin-top:1px}
    .activity-badge{padding:4px 10px;background:rgba(29,78,137,.10);color:#00684a;border:1px solid rgba(29,78,137,.4);border-radius:12px;font-size:10px;font-weight:700;white-space:nowrap;align-self:center}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #c1ccd6}
    .header-left h1{font-size:15px;font-weight:800;margin-bottom:4px}
    .header-left .period{font-size:11px;color:#5c6c7a}
    .meta-table{border-collapse:collapse;width:100%;margin-bottom:14px}
    .meta-table td{padding:4px 8px;border:1px solid #c1ccd6;font-size:10px}
    .meta-table td:first-child{font-weight:700;background:#f9fbfa;width:140px}
    .cat-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}44}
    .sec-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#5c6c7a;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #eaeef2}
    .fields-table{width:100%;border-collapse:collapse;margin-bottom:8px}
    .fields-table td{padding:7px 10px;border:1px solid #eaeef2;vertical-align:top}
    .field-label{width:55%;font-weight:600;background:#fafafa}
    .field-hint{font-size:9px;color:#5c6c7a;font-weight:400;margin-top:2px}
    .field-value{font-size:11px}
    .validation-stamp{margin-top:20px;padding:12px 16px;background:#dafbe1;border:2px solid #4ac26b;border-radius:6px}
    .stamp-header{font-size:12px;font-weight:800;color:#00a35c;margin-bottom:4px}
    .stamp-note{font-style:italic;margin-top:6px;color:#065f46}
    .sign-block{margin-top:28px;padding-top:16px;border-top:1px solid #c1ccd6;text-align:center;color:#5c6c7a;font-size:10px}
    .sign-line{width:280px;border-bottom:1px solid #5c6c7a;margin:0 auto 6px}
    .footer{margin-top:20px;padding-top:10px;border-top:1px solid #eaeef2;font-size:9px;color:#9198a1;display:flex;justify-content:space-between}
    @page{size:A4;margin:16mm}
  </style></head><body>
  ${companyHeader}
  <div class="header">
    <div class="header-left">
      <h1>${template.title}</h1>
      <div class="period">${period} · <span class="cat-badge">${meta.label} · ${freqLabel(template.frequency)}</span></div>
    </div>
  </div>
  <table class="meta-table">
    <tr><td>Preenchido por</td><td>${record.user} · ${record.role}</td><td>Data/hora</td><td>${filledAt}</td></tr>
    <tr><td>Estabelecimento</td><td>${p.razaoSocial || tenant?.name || ''}</td><td>Status</td><td>${record.status==='submitted'?'✓ Confirmado':'Rascunho'}</td></tr>
    ${p.cnpj ? `<tr><td>CNPJ</td><td colspan="3">${p.cnpj}</td></tr>` : ''}
  </table>
  ${sectionsHtml}
  ${validationHtml}
  <div class="footer">
    <span>NutriOPS · RDC 216/2004</span>
    <span>${p.rtNome ? `RT: ${p.rtNome}${p.rtCrn ? ` · ${p.rtCrn}` : ''}` : 'Responsável Técnico'}</span>
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

// CASA DOCE — planilha "FP.HIG.001". Ids FIXOS (não uid()) pra bater com a linha
// da nuvem (form_templates) no merge por id — sem duplicar. Novos templates da
// CASA DOCE (Fase B) entram aqui conforme a nutricionista confirma os detalhes.
const TPL_CASADOCE_BANHEIROS = () => ({
  id:'c61acf39-5ff8-404e-8fae-f9f68734f1b2', category:'faxina', frequency:'daily', v:2,
  title:'Controle de Higienização de Banheiros',
  description:'Registro diário. Marque a atividade realizada e o horário; quem preenche fica identificado (assinatura digital). Ref.: FP.HIG.001.',
  sections:[
    // Sem isto o registro dizia "banheiro limpo" sem dizer QUAL nem POR QUEM —
    // inútil numa fiscalização (pedido da nutricionista, 07/08).
    { id:'cd-ban-cab', title:'Identificação', fields:[
      { id:'cd-ban-local', label:'Qual banheiro', type:'select',
        options:['Masculino — clientes','Feminino — clientes','Acessível / PCD','Masculino — colaboradores','Feminino — colaboradores','Vestiário'] },
      { id:'cd-ban-resp',  label:'Responsável pela limpeza', type:'text' },
    ]},
    { id:'cd-ban-lg', title:'Limpeza Geral', fields:[
      { id:'cd-ban-lg-feito', label:'Realizada', type:'checkbox', hint:'Limpeza geral do banheiro' },
      { id:'cd-ban-lg-hora',  label:'Horário',  type:'text', hint:'Hora em que foi feita' },
    ]},
    { id:'cd-ban-mn', title:'Manutenção', fields:[
      { id:'cd-ban-mn-feito', label:'Realizada', type:'checkbox', hint:'Reposição de papel, sabonete, etc.' },
      { id:'cd-ban-mn-hora',  label:'Horário',  type:'text', hint:'Hora em que foi feita' },
      { id:'cd-ban-obs',      label:'Observações', type:'text' },
    ]},
    { id:'cd-ban-nc', title:'Não conformidade (se houver)', fields:[
      { id:'cd-ban-ncdesc', label:'Não conformidade', type:'text' },
      { id:'cd-ban-ncacao', label:'Ação corretiva', type:'text' },
      { id:'cd-ban-ncresp', label:'Responsável pela correção', type:'text' },
    ]},
  ],
});

// ── CASA DOCE · Fase B — demais planilhas BPF (rascunhos das planilhas reais da
// nutricionista). Ids FIXOS pra bater com a nuvem no merge. Frequências marcadas
// "a confirmar" nas descrições — trocar 1 valor + re-rodar o SQL se ela ajustar.

const TPL_CD_HORTIFRUTI = () => ({
  id:'f565a332-b2a1-401d-b1f4-5e70825aafec', category:'faxina', frequency:'daily', v:2,
  title:'Higienização de Hortifrutícolas',
  description:'Registro da higienização de hortifrutícolas (imersão em solução sanitizante). Frequência: diária (a confirmar com a RT).',
  sections:[
    { id:'cd-hf-reg', title:'Registro', fields:[
      { id:'cd-hf-data', label:'Data', type:'date_sig' },
      // Setor de quem higienizou (pedido 07/08) — a mesma solução roda em mais
      // de uma área e a RT precisa saber de qual veio o registro.
      { id:'cd-hf-setor', label:'Setor', type:'select', options: CD_SETORES_EQUIPE },
      { id:'cd-hf-item', label:'Hortifrutícola', type:'text', hint:'Ex.: alface, morango' },
      { id:'cd-hf-sol',  label:'Solução utilizada', type:'text', hint:'Ex.: hipoclorito 200 ppm' },
      { id:'cd-hf-tempo',label:'Tempo de imersão (min)', type:'number' },
    ]},
    { id:'cd-hf-nc', title:'Não conformidade (se houver)', fields:[
      { id:'cd-hf-ncdesc', label:'Não conformidade', type:'text' },
      { id:'cd-hf-ncacao', label:'Ação corretiva', type:'text' },
      { id:'cd-hf-ncresp', label:'Responsável pela correção', type:'text' },
    ]},
  ],
});

const TPL_CD_FILTRO_CAFE = () => ({
  id:'aca18344-2856-4931-9f29-372d36132824', category:'faxina', frequency:'daily',
  title:'Lavagem do Filtro de Café',
  description:'Registro da lavagem do filtro de café. Frequência: diária (a confirmar com a RT).',
  sections:[
    { id:'cd-fc-reg', title:'Registro de lavagem', fields:[
      { id:'cd-fc-data', label:'Data', type:'date_sig' },
      { id:'cd-fc-prod', label:'Produto utilizado', type:'text' },
      { id:'cd-fc-qtd',  label:'Quantidade', type:'number' },
    ]},
  ],
});

const TPL_CD_RESIDUOS = () => ({
  id:'1197f2fd-682b-47a0-8912-d23bbe69c708', category:'residuos', frequency:'daily', v:2,
  title:'Controle de Saída de Resíduos',
  description:'Pesagem/volume diário dos resíduos por categoria.',
  sections:[
    { id:'cd-res-dia', title:'Saída do dia', fields:[
      { id:'cd-res-data', label:'Data', type:'date' },
      { id:'cd-res-resp', label:'Responsável', type:'text' },
      { id:'cd-res-rec-kg', label:'Reciclável — Kg', type:'number' },
      { id:'cd-res-rec-l',  label:'Reciclável — Litros', type:'number' },
      { id:'cd-res-rej-kg', label:'Rejeito — Kg', type:'number' },
      { id:'cd-res-rej-l',  label:'Rejeito — Litros', type:'number' },
      { id:'cd-res-org-kg', label:'Orgânico — Kg', type:'number' },
      { id:'cd-res-org-l',  label:'Orgânico — Litros', type:'number' },
      { id:'cd-res-vid-l',  label:'Vidros — Litros', type:'number' },
      { id:'cd-res-oleo-l', label:'Óleo — Litros', type:'number' },
      { id:'cd-res-obs',    label:'Observações', type:'text' },
    ]},
  ],
});

// Higienização dos Carrinhos — a nutricionista esclareceu (29/07): NÃO é
// registro obrigatório da Anvisa, é só controle interno de limpeza. Na
// prática todos os carrinhos são higienizados no MESMO DIA (não um por vez
// em datas diferentes) — o modelo antigo pedia data+assinatura por carrinho
// (32x), gerando a fricção que ela relatou ("sempre esquecem de preencher").
// Redesenhado: 1 data + 1 responsável pro lote inteiro, e um checklist leve
// (checkbox) de quais carrinhos foram feitos nesse dia.
const TPL_CD_CARRINHOS = () => {
  const codes = ['T1','T2','T3','T4','T5','T6','T7','E1','E2','B1','B2','B3','C1','C2','C3','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','A1','A2','A3','A4','A5'];
  return {
    id:'0be8daac-24a5-461b-af6c-f438edcf5f48', category:'faxina', frequency:'biweekly',
    title:'Higienização dos Carrinhos',
    description:'Controle interno de limpeza (não é registro obrigatório da Anvisa). Higienização quinzenal, feita no mesmo dia para todos os carrinhos — registre a data/responsável uma vez e marque os que foram higienizados.',
    sections:[
      { id:'cd-carr-reg', title:'Registro', fields:[
        { id:'cd-carr-data', label:'Data da higienização', type:'date' },
        { id:'cd-carr-resp', label:'Responsável', type:'text' },
      ]},
      { id:'cd-carr-lav', title:'Carrinhos higienizados', fields:
        codes.map(c => ({ id:`cd-carr-${c}`, label:`Carrinho ${c}`, type:'checkbox' }))
      },
      { id:'cd-carr-obs', title:'Observações', fields:[
        { id:'cd-carr-obs-t', label:'Observações', type:'text' },
      ]},
    ],
  };
};

const TPL_CD_CLIMATIZACAO = () => ({
  id:'bb60649e-c14d-4c61-b115-ac16238fa010', category:'manutencao', frequency:'monthly',
  title:'Limpeza e Troca de Filtro — Climatização',
  description:'Registro de limpeza/troca de filtro dos equipamentos de climatização. Frequência: mensal/por evento (a confirmar com a RT).',
  sections:[
    { id:'cd-cl-reg', title:'Registro', fields:[
      { id:'cd-cl-data', label:'Data', type:'date' },
      { id:'cd-cl-eq',   label:'Identificação do equipamento', type:'text' },
      { id:'cd-cl-troca',label:'Troca de filtro', type:'checkbox' },
      { id:'cd-cl-limp', label:'Limpeza', type:'checkbox' },
      { id:'cd-cl-resp', label:'Responsável', type:'text' },
      { id:'cd-cl-prox', label:'Previsão da próxima manutenção', type:'date' },
      { id:'cd-cl-obs',  label:'Observações (falhas / anomalias)', type:'text' },
    ]},
  ],
});

const TPL_CD_MANUT_PROG = () => ({
  id:'637fcd48-4eb2-4a4c-adfe-0318a304a775', category:'manutencao', frequency:'monthly',
  title:'Manutenção Programada e Periódica',
  description:'Registro de manutenção preventiva/corretiva de equipamentos. Frequência: por evento (a confirmar com a RT).',
  sections:[
    { id:'cd-mp-reg', title:'Registro', fields:[
      { id:'cd-mp-data', label:'Data', type:'date' },
      { id:'cd-mp-eq',   label:'Identificação do equipamento', type:'text' },
      { id:'cd-mp-prev', label:'Preventiva', type:'checkbox' },
      { id:'cd-mp-corr', label:'Corretiva', type:'checkbox' },
      { id:'cd-mp-info', label:'Informações complementares', type:'text' },
      { id:'cd-mp-resp', label:'Responsável / executante', type:'text' },
      { id:'cd-mp-prox', label:'Data da próxima manutenção', type:'date' },
    ]},
  ],
});

// CASA DOCE — Higiene Pessoal / Vetores / Dedetização (Fase C, 29/07). Mesmo
// conteúdo dos templates genéricos (TPL_HIGIENE_PESSOAL/TPL_DEDETIZACAO), mas
// com ids FIXOS (convenção TPL_CD_*) pra bater com a nuvem. Vetores é
// customizado: a nutricionista respondeu (29/07) que usa a mesma planilha em
// todos os setores, mas quer o setor de destinação anotado (Padaria/Café/
// Gelateria/Confeitaria); Pombo sai da lista (controle já feito à parte por
// fora), Abelha entra (já estava no genérico).
// Setores da CASA DOCE pra os campos de seleção. Lista dada pela nutricionista
// (07/08) — é a divisão de EQUIPE, por isso não bate 1:1 com os 21 setores de
// higienização (que são de ÁREA FÍSICA: Câmaras, Fornos, Área de Lavagem…).
const CD_SETORES_EQUIPE = [
  'Gelateria', 'Padaria', 'Confeitaria', 'Café / Atendimento', 'Ilha',
  'Bistrô', 'Salgados', 'Serviços gerais', 'Estoque', 'Garçons',
  'Encomendas', 'Caixas',
];

const TPL_CD_HIGIENE = () => ({
  id:'c1e7838e-1cac-4a76-a0c3-296e1bebbfdb', category:'higiene_pessoal', frequency:'daily', v:3,
  title:'Higiene Pessoal dos Colaboradores',
  description:'Verificação por SETOR: escolha o setor, registre data e quem verificou. C=conforme / NC=não conforme. Ex.: toda segunda e terça o checklist da Padaria.',
  sections:[
    // Cabeçalho pedido pela nutricionista (07/08): sem data/responsável/setor
    // não dava pra saber quando, quem verificou nem qual equipe foi avaliada.
    { id:'cd-hig-cab', title:'Identificação', fields:[
      { id:'cd-hig-data',  label:'Data da verificação', type:'date' },
      { id:'cd-hig-setor', label:'Setor', type:'select', options: CD_SETORES_EQUIPE },
      { id:'cd-hig-resp',  label:'Responsável pela verificação', type:'text' },
    ]},
    { id:'cd-hig-ver', title:'Verificação', fields:[
      // "Uniforme" e "Avental" eram dois campos; a nutricionista pediu juntos
      // ("avental/uniforme"). Mantido o id cd-hig-uniforme pra não perder o
      // histórico já registrado; cd-hig-avental sai.
      { id:'cd-hig-uniforme', label:'Avental / uniforme', type:'cnc' },
      { id:'cd-hig-sapato',   label:'Sapato fechado e antiderrapante', type:'cnc' },
      { id:'cd-hig-cabelo',   label:'Cabelo', type:'cnc' },
      { id:'cd-hig-barba',    label:'Barba', type:'cnc' },
      { id:'cd-hig-unha',     label:'Unhas limpas, sem esmalte ou base', type:'cnc' },
      { id:'cd-hig-adorno',   label:'Adorno', type:'cnc', hint:'Remover brincos, anéis, pulseiras, colares' },
      { id:'cd-hig-comport',  label:'Comportamento', type:'cnc', hint:'Atitudes higiênicas, não manipular objetos fora da atividade' },
      { id:'cd-hig-perfume',  label:'Perfume', type:'cnc', hint:'Ausência de perfume forte' },
      { id:'cd-hig-ferim',    label:'Ferimento', type:'cnc', hint:'Ferimentos devidamente cobertos' },
      { id:'cd-hig-maos',     label:'Lavar Mãos', type:'cnc', hint:'Ao iniciar, usar banheiro, trocar atividade, colocar luvas' },
      { id:'cd-hig-obs',      label:'Observações', type:'text', hint:'Ex.: colaboradora com unha grande — orientada e registrada' },
      { id:'cd-hig-foto',     label:'Foto (opcional)', type:'photo', hint:'Evidência de não conformidade — ex.: unha comprida, uniforme sujo' },
    ]},
  ],
});

const TPL_CD_VETORES = () => ({
  id:'96496ddc-a938-4b90-9aa5-fd5710a54fb0', category:'vetores_pragas', frequency:'daily', v:2,
  title:'Controle Integrado de Vetores e Pragas',
  description:'Verificação diária. Registrar tipo de praga e o setor onde foi feito o controle. Anexar comprovante de dedetização.',
  sections:[
    { id:'cd-vet-cab', title:'Identificação', fields:[
      { id:'cd-vet-data',  label:'Data', type:'date' },
      { id:'cd-vet-setor', label:'Setor verificado', type:'select', options: CD_SETORES_EQUIPE },
      { id:'cd-vet-resp',  label:'Responsável pela verificação', type:'text' },
    ]},
    { id:'cd-vet-ocorr', title:'Ocorrências do dia', fields:[
      // O hint de setor saiu daqui: agora o setor é campo próprio no cabeçalho.
      // O "local" do presence continua servindo pro ponto exato da ocorrência.
      { id:'cd-vet-abelha',  label:'Abelha (A)',           type:'presence' },
      { id:'cd-vet-barata',  label:'Barata (B)',           type:'presence' },
      { id:'cd-vet-formiga', label:'Formiga (F)',          type:'presence' },
      { id:'cd-vet-mosca',   label:'Mosca / Mosquito (M)', type:'presence' },
      { id:'cd-vet-roedor',  label:'Roedor (R)',           type:'presence' },
      { id:'cd-vet-acao',    label:'Ação tomada', type:'text' },
      { id:'cd-vet-obs',     label:'Observações',  type:'text' },
    ]},
  ],
});

const TPL_CD_DEDETIZACAO = () => ({
  id:'17ce4089-0e51-48a7-991a-bdde090a33e9', category:'dedetizacao', frequency:'monthly',
  title:'Controle de Dedetização',
  description:'Registrar empresa, data, serviço e produto. Anexar comprovante.',
  sections:[{ id:'cd-ded-reg', title:'Registro do serviço', fields:[
    { id:'cd-ded-emp',  label:'Empresa executora', type:'text' },
    { id:'cd-ded-data', label:'Data do serviço', type:'text' },
    { id:'cd-ded-serv', label:'Serviço executado', type:'text' },
    { id:'cd-ded-prod', label:'Produto utilizado', type:'text' },
    { id:'cd-ded-cert', label:'Número do certificado', type:'text' },
    { id:'cd-ded-obs',  label:'Observações', type:'text' },
  ]}],
});

const TPL_CD_CALIBRACAO = () => ({
  id:'f4d07b4c-7e7d-4a1f-8e05-fe3c474c37d8', category:'manutencao', frequency:'monthly',
  title:'Calibração de Instrumentos de Medição',
  description:'Registro de calibração de termômetros, balanças, etc. Frequência: conforme validade da calibração (a confirmar com a RT).',
  sections:[
    { id:'cd-cal-reg', title:'Registro', fields:[
      { id:'cd-cal-data', label:'Data', type:'date' },
      { id:'cd-cal-eq',   label:'Identificação do equipamento', type:'text' },
      { id:'cd-cal-apto', label:'Equipamento apto?', type:'cnc', hint:'C = SIM (apto) · NC = NÃO' },
      { id:'cd-cal-emp',  label:'Empresa responsável', type:'text' },
      { id:'cd-cal-prox', label:'Data da próxima calibração', type:'date' },
    ]},
  ],
});

// ── CASA DOCE · Fase D — Higienização por SETOR (21 folhas do papel) ────────
// Cada folha vira uma planilha própria: a equipe da Padaria abre só a da
// Padaria. As colunas "Semana 1..5" do papel viram um preenchimento POR SEMANA
// (frequency:'weekly') — por isso TODAS são semanais mesmo quando a tarefa é
// mensal/quinzenal/diária: o período de cada tarefa vai no nome dela, igual à
// coluna "Período" da folha. É o mesmo compromisso que o papel já faz (lá
// também há uma coluna por semana pra tarefa diária).
//
// ⚠️ O SETOR é derivado do TÍTULO em templateSector() ("Higienização — Padaria"
// → "Padaria"). form_templates não tem coluna `sector` (id/tenant_id/category/
// frequency/title/description/sections) e um campo solto no objeto NÃO
// sobreviveria ao round-trip da nuvem. Mudou o formato do título? Ajuste lá.
const PER = { S:'semanal', M:'mensal', Q:'quinzenal', D:'diária', X:'frequência a definir' };

const higSetor = (uuid, slug, setor, tarefas) => () => ({
  id:uuid, category:'higienizacao', frequency:'weekly', v:2,
  title:`Higienização — ${setor}`,
  description:`Higienização do setor ${setor}. Registre data e assinatura de cada tarefa concluída — o período esperado está no nome. Uma folha por semana, como no papel.`,
  sections:[
    // Cabeçalho "Responsável / Mês-Ano" do papel. Cada tarefa já tem a sua
    // data+assinatura, mas a nutricionista pediu também o responsável da FOLHA
    // — é quem responde pelo setor naquela semana, mesmo que várias pessoas
    // tenham executado tarefas diferentes.
    { id:`cd-hig-${slug}-cab`, title:'Identificação', fields:[
      { id:`cd-hig-${slug}-resp`, label:'Responsável pelo setor', type:'text' },
      { id:`cd-hig-${slug}-mes`,  label:'Mês / ano de referência', type:'date' },
    ]},
    { id:`cd-hig-${slug}-t`, title:'Tarefas', fields:tarefas.map(([nome, per], i) => (
      { id:`cd-hig-${slug}-${i}`, label:`${nome} (${PER[per]})`, type:'date_sig' }
    ))},
    { id:`cd-hig-${slug}-nc`, title:'Não conformidade (se houver)', fields:[
      { id:`cd-hig-${slug}-ncdesc`, label:'Não conformidade', type:'text' },
      { id:`cd-hig-${slug}-ncacao`, label:'Ação corretiva', type:'text' },
      { id:`cd-hig-${slug}-ncresp`, label:'Responsável pela correção', type:'text' },
    ]},
  ],
});

// Setor de uma planilha de higienização — ver o aviso do bloco acima.
export function templateSector(tpl) {
  if (tpl?.category !== 'higienizacao') return null;
  const i = (tpl.title ?? '').indexOf('—');
  return i < 0 ? null : tpl.title.slice(i + 1).trim() || null;
}

const TPL_CD_HIG = [
  higSetor('7fc7a778-49ee-4a67-a4a0-0f9f5889ba59','camaras','Câmaras',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Prateleiras','S'],['Portas','M'],
    ['Tela milimétrica','S'],['Ultracongelador U.1','S'],['Climática C.1','S'],
    ['Câmara de refrigeração C.1','S'],['Câmara de congelamento C.2','S'],
  ]),
  higSetor('567dee3b-f84d-4454-908f-4728e38a852c','fornos','Fornos',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Coifa','S'],
    ['Forno 01','S'],['Forno 02','S'],['Forno 03','S'],['Forno 04','S'],
    ['Fogão','S'],['Bancada de apoio','S'],['Carrinho de apoio','S'],
    ['Pasto chef 01','S'],['Pasto chef 02','S'],['Liquidificador','S'],
    ['Pia de apoio','S'],['Janela','Q'],['Tela milimétrica','S'],['Climática','S'],
    ['iVario (panela rational)','S'],
  ]),
  higSetor('77f9f2d2-77b4-4fec-a392-763e7b91b9ea','padaria','Padaria',[
    ['Bancada refrigerada R.1','S'],['Refrigerador R.2','S'],['Ultra U.1','S'],
    ['Modeladora / Divisoras','S'],['Laminadora','S'],['Boleadora / Prensa','S'],
    ['Carrinho de farinha','S'],['Bancada de apoio 01','S'],['Bancada de apoio 02','S'],
    ['Bancada de apoio 03','S'],['Climática C.2','S'],['Climática C.3','S'],
    ['Prateleiras','S'],['Batedeiras','S'],
  ]),
  higSetor('73022bc1-033d-4b6e-8fd4-7a64e22646aa','confeitaria','Confeitaria',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Prateleira','S'],['Carrinho de apoio','S'],
    ['Bancadas','S'],['Batedeiras industriais','S'],['Carrinho de farinha','S'],
    ['Carrinho de açúcar','S'],['Balança 01','S'],['Balança 02','S'],
    ['Liquidificadores','S'],['Micro-ondas','S'],['Batedeiras','S'],
    ['Máquina de gomo','S'],['Pia de apoio','S'],['Ar condicionado','S'],['Pia','S'],
    ['Sifão','S'],['Portas','M'],['Freezer F.1','Q'],['Ultracongelador U.2','S'],
    ['Refrigerador vertical R.2','S'],['Refrigerador vertical R.3','S'],
    ['Refrigerador vertical 2 portas R.4','S'],['Refrigerador vertical 2 portas R.5','S'],
    ['Bancada refrigerada R.6','S'],['Bancada refrigerada R.7','S'],
  ]),
  higSetor('05eeeb97-375a-444b-8fec-14352d31a5b0','embalagens','Embalagens',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Bancada','S'],['Balança','S'],
    ['Prateleira','S'],['Bancada de apoio','S'],
  ]),
  higSetor('1faa3e5f-453b-46e1-a414-584401a64c2d','salgados','Salgados',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Luminária','M'],['Porta','M'],
    ['Cilindro','S'],['Ralo','S'],['Ar condicionado','S'],['Freezer F.8','Q'],
    ['Refrigerador R.12','S'],['Bancada refrigerada R.13','S'],
  ]),
  higSetor('0b7ffa18-d2dd-4b90-9da9-93a411825f61','sanduiches','Sanduíches',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Porta','M'],['Fatiadora','S'],
    ['Lixeira','D'],['Prateleiras','D'],
  ]),
  higSetor('e6ea58dd-2155-4c24-aaff-be5ea7c78fc7','hig-producao','Higienização Produção',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Luminárias','M'],['Rodapé','S'],
    ['Ralos','S'],['Portas','S'],['Prateleiras','S'],['Lavar louças','S'],['Carrinhos','S'],
  ]),
  higSetor('d87793a8-06a5-48e2-8b3e-a9505688a506','gelateria','Gelateria',[
    ['Piso','S'],['Parede','S'],['Teto','S'],['Micro-ondas','S'],['Maturação','S'],
    ['Pasteurização','S'],['Prateleiras','S'],['Balança','S'],['Janela','M'],
    ['Tela milimétrica','S'],['Pia','S'],['Bancadas','S'],['Lixeira','S'],['Ralo','S'],
    ['Banho maria','S'],['Produtora pro 4 (bater os gelatos)','S'],
    ['Ultracongelador U.3','S'],['Congelador vertical F.3','Q'],
    ['Bancada congelada F.4','Q'],['Bancada refrigerada R.10','S'],
  ]),
  higSetor('7178f54b-6064-4cc0-a97f-f0c207283452','picoles','Produção de Picolés',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Produtora','S'],['Banho maria','S'],
    ['Turbo 8','S'],['Prateleiras','S'],['Ralo','S'],['Lixeira','S'],['Pias','S'],
    ['Ar condicionado','S'],['Freezer horizontal F.5','Q'],['Freezer horizontal F.6','Q'],
    ['Freezer 2 portas vertical F.7','Q'],
  ]),
  higSetor('7ba47f37-24af-47ef-9bfc-68d2ab003371','atend-gelatos','Atendimento Gelatos',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Expositor','S'],['Armários','S'],
    ['Vitrine congelada V.3','S'],['Vitrine congelada V.4','S'],
    ['Cascata chocomix CM.1','S'],['Cascata chocomix CM.2','S'],
  ]),
  higSetor('4b7b2863-57e6-4122-ae7e-8ab1fb9b9b27','ilha-sobremesas','Ilha de Sobremesas',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Expositor','S'],['Lixeira','S'],
    ['Prateleiras','S'],['Porta vai e vem','M'],['Armários','S'],['Balança','S'],
    ['Vitrine refrigerada V.5','S'],['Vitrine refrigerada V.6','S'],
    ['Vitrine refrigerada V.7','S'],['Vitrine refrigerada V.8','S'],
  ]),
  higSetor('83f2ef8d-6344-4d44-848d-072a8352893e','paes-cafe','Atendimento Pães e Café',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Forno de salgados 1','S'],
    ['Forno de pizzas','S'],['Carrinho','S'],['Máquina de fatiar pão','S'],
    ['Balanças','S'],['Armários','S'],['Prateleiras','S'],['Bancadas','S'],
    ['Utensílios','S'],['Porta vai e vem','M'],['Cafeteira','S'],
    ['Forno de salgados 2','S'],['Lixeiras','S'],['Máquina de lavar','S'],
    ['Vitrine refrigerada V.1','S'],['Vitrine aquecida V.2','S'],
    ['Bancada refrigerada R.8','S'],['Bancada refrigerada R.9','S'],
    ['Bancada congelada F.2','Q'],['Máquina de laranja','S'],
  ]),
  higSetor('fe7e72f0-2d33-47f8-a7a5-782061185116','encomendas','Encomendas',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Lixeira','S'],['Prateleiras','S'],
    ['Porta de correr','M'],['Armários','S'],['Balança','S'],
    ['Refrigerador 3 portas R.11','S'],
  ]),
  higSetor('7e17b24b-2c06-4046-b50d-ca656e8cbda8','bistro','Bistrô',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Fogões','S'],['Chapas','S'],
    ['Fritadeira 01','S'],['Fritadeira 02','S'],['Forno combinado','S'],
    ['iVario (panela rational)','S'],['Pia de apoio','S'],['Forno','S'],
    ['Char broiller','S'],['Prateleira','S'],['Bancada','S'],
    ['Elevador','S'],['Laminadora','S'],['Batedeira','S'],['Forno 01','S'],['Forno 02','S'],
    ['Refrigerador vertical 2 portas R.14','S'],['Refrigerador vertical R.15','S'],
    ['Freezer vertical 2 portas F.9','Q'],['Freezer vertical 2 portas F.10','Q'],
    ['Refrigerador vertical 2 portas R.16','S'],['Refrigerador vertical 4 portas R.17','S'],
    ['Ultracongelador U.4','S'],['Bancada refrigerada R.18','S'],
    ['Bancada refrigerada R.19','S'],['Pista fria P.1','S'],['Pista fria P.2','S'],
  ]),
  higSetor('1868768c-721a-4cec-b062-37ea6f8f9955','refeitorio','Refeitório',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Geladeira R.12','S'],['Banho maria BM.1','S'],
  ]),
  higSetor('979e3f8a-41e5-495e-9519-63597a28d78f','lavagem','Área de Lavagem',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Pia','S'],['Ralo','S'],['Lixeiras','S'],
    ['Prateleiras','S'],['Bancada Sifão','S'],['Máquina de lavar louça','S'],
    ['Carrinhos','S'],['Batedeira','S'],['Pia de higienização de mãos','S'],['Portas','S'],
  ]),
  higSetor('73463e76-cb88-424a-90bd-5b6443046576','lavagem-bistro','Área de Lavagem — Bistrô',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Pia de lavagem 01','D'],
    ['Pia de lavagem 02','D'],['Lixeira','D'],['Bancada','D'],
    ['Máquina de lavar louça','D'],['Sifão','S'],['Caixa de gordura','X'],
  ]),
  higSetor('0859145f-11b0-419e-add3-b2ee25b079d4','lixeiras','Lixeiras, Escadas e Vidraças',[
    ['Lixeiras de rejeito','S'],['Lixeiras de orgânico','S'],
    ['Lixeiras de recicláveis','Q'],['Lixeiras inox','Q'],['Vidraças / corrimão','Q'],
    ['Escadas / rodapé 1','S'],['Escadas / rodapé 2','S'],
    ['Cadeiras plásticas colaboradores','M'],['Bancos plásticos colaboradores','M'],
  ]),
  higSetor('fd001de5-2b6a-41cb-9a80-7704ecd427f5','vestiario','Vestiário / DML',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Ralos','S'],['Armários','S'],
    ['Tanque','S'],['Mops','S'],['Portas','S'],
  ]),
  higSetor('9291bdc9-bf1a-4a26-a919-6a19e7bcee3f','estoque-seco','Estoque Seco',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Prateleiras','S'],['Ralos','S'],
    ['Carrinho de farinha','S'],['Luminária','M'],['Ar condicionado','S'],
  ]),
];

function seedTemplates(tenant) {
  const id = (tenant.id ?? '').toLowerCase();
  const name = (tenant.name ?? '').toLowerCase();
  if (id.includes('swiss'))                          return [TPL_HIGIENE_PESSOAL(), TPL_VETORES('C=Cozinha D=Distribuição S=Salão E=Externa'), TPL_DEDETIZACAO(), TPL_FAXINA_SWISS()];
  if (id.includes('backerei')||id.includes('bäck')) return [TPL_HIGIENE_PESSOAL(), TPL_VETORES(), TPL_DEDETIZACAO(), TPL_FAXINA_BACKEREI(), TPL_POTABILIDADE()];
  if (id.includes('dbk'))                            return [TPL_FAXINA_DBK(), TPL_MANUTENCAO_DBK(), TPL_VETORES()];
  if (id.includes('bf245c3b') || name.includes('casa doce')) return [
    TPL_CASADOCE_BANHEIROS(), TPL_CD_HORTIFRUTI(), TPL_CD_FILTRO_CAFE(), TPL_CD_RESIDUOS(),
    TPL_CD_CARRINHOS(), TPL_CD_CLIMATIZACAO(), TPL_CD_MANUT_PROG(), TPL_CD_CALIBRACAO(),
    TPL_CD_HIGIENE(), TPL_CD_VETORES(), TPL_CD_DEDETIZACAO(),
    ...TPL_CD_HIG.map((mk) => mk()),
  ];
  return [TPL_HIGIENE_PESSOAL(), TPL_VETORES(), TPL_DEDETIZACAO()];
}

// ─── Field components ──────────────────────────────────────────────────────

function CNCButton({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:6 }}>
      {['C','NC',''].map((opt) => {
        const on = value===opt;
        const [bg,color,border] = opt==='C' ? ['#dafbe1','#00a35c','#4ac26b'] : opt==='NC' ? ['#ffebe9','#c0392b','#ff8182'] : ['#f9fbfa','#5c6c7a','#c1ccd6'];
        return (
          <button key={opt||'x'} onClick={() => onChange(on?'':opt)}
            style={{ padding:'5px 14px', borderRadius:6, border:`1.5px solid ${on?border:'#c1ccd6'}`, background:on?bg:'white', color:on?color:'#5c6c7a', fontWeight:on?700:500, fontSize:12, cursor:'pointer', transition:'all .12s' }}>
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
        style={{ padding:'5px 14px', borderRadius:6, border:`1.5px solid ${detected?'#ff8182':'#4ac26b'}`, background:detected?'#ffebe9':'#dafbe1', color:detected?'#c0392b':'#00a35c', fontWeight:700, fontSize:12, cursor:'pointer' }}>
        {detected ? 'Detectado' : 'Sem ocorrência'}
      </button>
      {detected && (
        <input value={value?.location??''} onChange={(e) => onChange({ ...value, location:e.target.value })}
          placeholder="Local" style={{ width:130, padding:'5px 8px', borderRadius:6, border:'1px solid #c1ccd6', fontSize:12, fontFamily:'inherit' }} />
      )}
    </div>
  );
}

// 1 toque carimba hoje + quem está registrando (quickSign) — o caso comum.
// "Editar" abre os campos crus pra exceção real: tarefa feita por outra
// pessoa, ou em outro dia (preenchimento retroativo).
function DateSigField({ value={}, onChange, currentName }) {
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

// ─── Form Fill ─────────────────────────────────────────────────────────────

function FormFill({ template, record, onSave, onBack, session, tenant }) {
  const [responses, setResponses] = useState(() => record?.responses ?? {});
  const [saving, setSaving] = useState(false);
  const pct = completionPct(template, { responses });

  const setField = (id, val) => setResponses((prev) => ({ ...prev, [id]:val }));

  const handleSave = async (status) => {
    // Antes dava pra "Confirmar preenchimento" com 7% e o card virava
    // Concluído verde na grade — o pct exige só >0, não 100. Rascunho não
    // pede confirmação: é exatamente pra deixar pela metade mesmo.
    if (status === 'submitted' && pct < 100) {
      const proceed = window.confirm(`A planilha está ${pct}% preenchida. Confirmar mesmo assim?`);
      if (!proceed) return;
    }
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
                  {field.type==='date_sig' && <DateSigField value={responses[field.id]} onChange={(v) => setField(field.id,v)} currentName={session?.user?.name} />}
                  {field.type==='date'     && <input type="date" value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)} style={{ padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit' }} />}
                  {field.type==='number'   && <input type="number" inputMode="decimal" value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)} placeholder="0" style={{ width:120, padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit', fontVariantNumeric:'tabular-nums' }} />}
                  {field.type==='checkbox' && <label style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}><input type="checkbox" checked={responses[field.id]===true} onChange={(e) => setField(field.id,e.target.checked)} style={{ width:18, height:18, accentColor:'var(--primary)' }} /> Marcar</label>}
                  {field.type==='text'     && <textarea value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)} placeholder="Observações…" style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit', resize:'vertical', minHeight:54 }} />}
                  {/* Lista fechada (setor, qual banheiro…). Texto livre aqui
                      geraria "Padaria"/"padaria"/"Padria" e inviabilizaria
                      filtrar o histórico por setor depois. */}
                  {field.type==='select'   && (
                    <select value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)}
                      style={{ padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit', minWidth:200 }}>
                      <option value="">Selecione…</option>
                      {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                  {field.type==='photo'    && (
                    <PhotoField value={responses[field.id]} onChange={(v) => setField(field.id,v)}
                      tenantId={tenant?.id} formId={template.id} periodKey={record?.periodKey ?? 'sem-periodo'} fieldId={field.id} />
                  )}
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
  // Setor só existe dentro de Higienização (21 planilhas, uma por setor). Fica
  // em state separado e é ZERADO ao trocar de categoria — senão o filtro aponta
  // pra um setor que não existe na categoria nova e a grade some sem explicação
  // (mesma armadilha do filtro de setor dos equipamentos).
  const [sectorFilter, setSectorFilter] = useState('all');
  const pickCategory = (cat) => { setCatFilter(cat); setSectorFilter('all'); };
  const [histId,    setHistId]    = useState(null);
  const [tab,       setTab]       = useState('forms'); // 'forms' | 'validation'
  const [editingTpl, setEditingTpl] = useState(null);

  // Salva a planilha editada pela RT: state → localStorage (pelo efeito) e
  // nuvem. O push é o que faz a mudança chegar nos OUTROS aparelhos da loja —
  // até aqui pushFormTemplate existia no repository mas nunca era chamado, ou
  // seja, planilha nunca saía do device onde foi editada.
  const salvarTemplate = useCallback((novo) => {
    setTemplates((prev) => prev.map((t) => t.id === novo.id ? novo : t));
    setEditingTpl(null);
    import('./repository').then(m => m.pushFormTemplate(activeTenant.id, novo)).catch(() => {});
  }, [activeTenant.id]);

  // De QUAL loja são os dados em memória. Sem esta marcação, os efeitos de
  // escrita abaixo (que têm activeTenant.id nas deps) rodavam no render da
  // TROCA de empresa — id JÁ é o novo, `templates`/`records` AINDA são da loja
  // anterior — e gravavam as planilhas de uma loja sob a chave da outra.
  // Terceira vez que esta classe de bug aparece (catálogo v1.9.71, equipe
  // v1.9.81); aqui contamina planilha E registro preenchido. Precisa ser state,
  // não ref: com ref o efeito leria o valor já atualizado e a checagem passaria.
  const [formsTenant, setFormsTenant] = useState(activeTenant.id);
  useEffect(() => {
    setTemplates(readFormTemplates(activeTenant));
    setRecords(readFormRecords(activeTenant.id));
    setFormsTenant(activeTenant.id);
    setFilling(null); setHistId(null);
    pickCategory('all');
  }, [activeTenant.id]);

  useEffect(() => {
    if (formsTenant !== activeTenant.id) return;   // troca de loja em andamento
    writeFormRecords(activeTenant.id, records);
  }, [activeTenant.id, formsTenant, records]);
  useEffect(() => {
    if (formsTenant !== activeTenant.id) return;
    writeFormTemplates(activeTenant.id, templates);
  }, [activeTenant.id, formsTenant, templates]);

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
  const byCategory = catFilter==='all' ? templates : templates.filter((t) => t.category===catFilter);
  const filteredTemplates = sectorFilter==='all'
    ? byCategory
    : byCategory.filter((t) => templateSector(t) === sectorFilter);
  const categories = [...new Set(templates.map((t) => t.category))];
  // Setores da categoria em foco (só Higienização tem). Ordena em pt-BR pra
  // "Área de Lavagem" e "Câmaras" não caírem depois de "Vestiário" por acento.
  const sectors = [...new Set(byCategory.map(templateSector).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity:'base' }));

  if (kioskForm) {
    const { template, record, periodKey } = kioskForm;
    return (
      <FormKioskApp
        template={template}
        tenantId={activeTenant.id}
        tenantName={activeTenant.name}
        userName={session?.user?.name ?? '—'}
        userRole={session?.user?.role ?? ''}
        // `record` era lido aqui e nunca usado: o modo tablet sempre abria em
        // branco, e como o save faz upsert por (formId, periodKey) trocando
        // `responses` inteiro, abrir "📱 Tablet" numa planilha que já tinha
        // rascunho/preenchimento e confirmar APAGAVA o que existia — perda de
        // dado silenciosa numa folha semanal preenchida por várias pessoas.
        initialResponses={record?.responses}
        onExit={() => setKioskForm(null)}
        onSave={async (responses, status = 'submitted') => {
          const existing = records.find(r => r.formId === template.id && r.periodKey === periodKey);
          const updated = {
            id: existing?.id ?? crypto.randomUUID(),
            tenantId: activeTenant.id, formId: template.id, formTitle: template.title,
            category: template.category, frequency: template.frequency, periodKey,
            responses, status,
            user: session?.user?.name ?? '—', role: session?.user?.role ?? '',
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          // Sobe pro Supabase (enfileira se offline) — o handleSave normal já
          // faz isto (linha 649). Sem esta linha, a planilha BPF preenchida no
          // quiosque ficava SÓ no localStorage e sumia ao limpar o device:
          // perda silenciosa de registro de conformidade RDC 216.
          pushFormRecord(activeTenant.id, updated);
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
      {editingTpl && (
        <TaskEditorModal template={editingTpl} onSave={salvarTemplate} onClose={() => setEditingTpl(null)} />
      )}
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
          <div className="chip-row" style={{ marginBottom: sectors.length > 1 ? 10 : 16 }}>
            <button className={`quick-chip ${catFilter==='all'?'active':''}`} onClick={() => pickCategory('all')}>
              <strong>Todas</strong><span>{templates.length} planilhas</span>
            </button>
            {categories.map((cat) => {
              const meta = catMeta(cat);
              return (
                <button key={cat} className={`quick-chip ${catFilter===cat?'active':''}`} onClick={() => pickCategory(cat)}>
                  <strong>{meta.label}</strong><span>{templates.filter((t) => t.category===cat).length}</span>
                </button>
              );
            })}
          </div>

          {/* Segundo nível: setor. Só aparece quando a categoria em foco tem
              setores (Higienização) — pra Faxina/Dedetização/etc. seria uma
              fileira de botões vazia. */}
          {sectors.length > 1 && (
            <div className="chip-row" style={{ marginBottom:16 }}>
              <button className={`quick-chip ${sectorFilter==='all'?'active':''}`} onClick={() => setSectorFilter('all')}>
                <strong>Todos os setores</strong><span>{sectors.length}</span>
              </button>
              {sectors.map((s) => (
                <button key={s} className={`quick-chip ${sectorFilter===s?'active':''}`} onClick={() => setSectorFilter(s)}>
                  <strong>{s}</strong>
                </button>
              ))}
            </div>
          )}

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
                      {/* Só higienização: são as planilhas cuja lista é de
                          equipamentos/áreas e muda quando entra equipamento
                          novo. As de checklist fixo (higiene pessoal, vetores)
                          têm conteúdo normativo e não se editam por aqui. */}
                      {isRT && tpl.category === 'higienizacao' && (
                        <button className="ghost-action" style={{ fontSize:11 }}
                          title="Adicionar ou remover equipamentos desta planilha"
                          onClick={() => setEditingTpl(tpl)}>Editar</button>
                      )}
                      {isDone && (
                        <button className="secondary-action" style={{ fontSize:11, padding:'5px 10px' }} onClick={() => {
                          const win = window.open('','_blank');
                          win.document.write(generateFormPDF(tpl, rec, activeTenant));
                          win.document.close(); setTimeout(() => win.print(), 400);
                        }}>↓ PDF</button>
                      )}
                      <button className="secondary-action" style={{ fontSize:11, padding:'5px 10px', background:'#001e2b', color:'white', borderColor:'transparent' }}
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
