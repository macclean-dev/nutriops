// ─────────────────────────────────────────────────────────────────────────────
// Importar planilha de papel por foto/PDF via IA — item 11 da revisão de
// produto (09/08). Sobe a foto/PDF pra /api/extract-template (Anthropic com
// visão, server-side — a chave nunca chega no client), e a RT revisa/edita
// o rascunho ANTES de publicar. Nunca publica sozinho.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { catMeta, freqLabel, reduzirFoto } from './forms';
import { fileToBase64, validateDraft, draftToTemplate } from './import-template';

const CATEGORY_OPTIONS = ['custom', 'higienizacao', 'higiene_pessoal', 'vetores_pragas', 'dedetizacao', 'faxina', 'potabilidade', 'manutencao', 'recebimento', 'residuos'];
const FREQUENCY_OPTIONS = ['daily', 'weekly', 'biweekly', 'monthly'];
const FIELD_TYPE_LABEL = { cnc: 'Conforme / não conforme', text: 'Observação livre', presence: 'Marcação de ocorrência' };

export function ImportTemplateModal({ onSave, onClose }) {
  const [step, setStep] = useState('upload'); // upload | loading | review
  const [error, setError] = useState('');
  const [tpl, setTpl] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setStep('loading');
    setError('');
    try {
      const isPdf = file.type === 'application/pdf';
      const toSend = isPdf ? file : await reduzirFoto(file);
      const mediaType = isPdf ? 'application/pdf' : 'image/jpeg';
      const imageBase64 = await fileToBase64(toSend);

      const res = await fetch('/api/extract-template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64, mediaType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha ao consultar a IA.');

      const draftErrors = validateDraft(data.draft);
      if (draftErrors.length) throw new Error(draftErrors.join(' '));

      setTpl(draftToTemplate(data.draft));
      setStep('review');
    } catch (err) {
      setError(err?.message ?? 'Erro inesperado ao processar o arquivo.');
      setStep('upload');
    }
  };

  const updateField = (secIdx, fieldIdx, patch) => {
    setTpl((prev) => ({
      ...prev,
      sections: prev.sections.map((s, i) => i !== secIdx ? s : {
        ...s, fields: s.fields.map((f, j) => j !== fieldIdx ? f : { ...f, ...patch }),
      }),
    }));
  };
  const removeField = (secIdx, fieldIdx) => {
    setTpl((prev) => ({
      ...prev,
      sections: prev.sections.map((s, i) => i !== secIdx ? s : { ...s, fields: s.fields.filter((_, j) => j !== fieldIdx) }),
    }));
  };

  const publicar = () => {
    const errors = validateDraft({ title: tpl.title, sections: tpl.sections });
    if (errors.length) { setError(errors.join(' ')); return; }
    onSave(tpl);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 24 }}>
      <div className="management-card" style={{ width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="card-head">
          <div><span className="eyebrow">Importar por IA</span><h2>Planilha por foto ou PDF</h2></div>
        </div>

        {step === 'upload' && (
          <div className="capture-fields">
            <p className="muted">Tire uma foto (ou envie um PDF) da planilha de papel. A IA extrai título, tarefas e frequência — você revisa tudo antes de publicar.</p>
            <label>Arquivo (foto ou PDF)
              <input type="file" accept="image/*,application/pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
            </label>
            {error && <div className="submission danger">✕ {error}</div>}
          </div>
        )}

        {step === 'loading' && (
          <div className="capture-fields" style={{ alignItems: 'center', padding: '32px 0' }}>
            <p className="muted">Lendo a planilha com IA — isso leva alguns segundos…</p>
          </div>
        )}

        {step === 'review' && tpl && (
          <>
            <div className="capture-fields" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14 }}>
              <label>Título da planilha
                <input value={tpl.title} onChange={(e) => setTpl((p) => ({ ...p, title: e.target.value }))} />
              </label>
              <div className="grid-2">
                <label>Categoria
                  <select value={tpl.category} onChange={(e) => setTpl((p) => ({ ...p, category: e.target.value }))}>
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{catMeta(c).label}</option>)}
                  </select>
                </label>
                <label>Frequência
                  <select value={tpl.frequency} onChange={(e) => setTpl((p) => ({ ...p, frequency: e.target.value }))}>
                    {FREQUENCY_OPTIONS.map((f) => <option key={f} value={f}>{freqLabel(f)}</option>)}
                  </select>
                </label>
              </div>
              <p className="muted" style={{ fontSize: 11 }}>Extraído por IA — confira se as tarefas batem com a planilha original antes de publicar.</p>
            </div>
            <div className="equipment-maintenance-list" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {tpl.sections.map((s, secIdx) => (
                <div key={s.id}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-secondary)', padding: '10px 20px 4px' }}>{s.title}</div>
                  {s.fields.map((f, fieldIdx) => (
                    <div key={f.id} className="equipment-maintenance-row">
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input value={f.label} onChange={(e) => updateField(secIdx, fieldIdx, { label: e.target.value })} style={{ fontWeight: 600 }} />
                        <select value={f.type} onChange={(e) => updateField(secIdx, fieldIdx, { type: e.target.value })} style={{ width: 'auto', fontSize: 11 }}>
                          {Object.entries(FIELD_TYPE_LABEL).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                        </select>
                      </div>
                      <button className="ghost-action danger" style={{ fontSize: 11 }} onClick={() => removeField(secIdx, fieldIdx)}>Remover</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {error && <div className="submission danger">✕ {error}</div>}
            <p className="muted" style={{ fontSize: 11, padding: '10px 0 0' }}>
              Ao publicar, esta planilha passa a valer pra loja — edite quantas tarefas precisar antes.
            </p>
          </>
        )}

        <div className="actions-row">
          <button className="secondary-action" onClick={onClose}>Cancelar</button>
          {step === 'review' && <button className="primary-action" onClick={publicar}>Publicar planilha</button>}
        </div>
      </div>
    </div>
  );
}
