import React, { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Storage ───────────────────────────────────────────────────────────────

const sessionsKey = (id) => `nutriops.training.sessions.${id}`;
const configKey   = (id) => `nutriops.training.config.${id}`;
const usersKey    = (id) => `nutriops.users.${id}`;

const tl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
const ts = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const readSessions    = (id)    => tl(sessionsKey(id), []);
export const writeSessions   = (id, v) => ts(sessionsKey(id), v);
export const readTrainConfig = (id)    => tl(configKey(id),   { validityMonths: 12, crnNumber: '' });
export const writeTrainConfig = (id, v) => ts(configKey(id), v);

// Reuse users from pages storage
const readUsers = (tenant) => tl(usersKey(tenant.id), tenant.usersList ?? []);

function uid() { return crypto.randomUUID(); }

// Default topics from the actual MBPF PDFs
export const DEFAULT_TOPICS = [
  'O que é o Manual de Boas Práticas de Fabricação (MBPF)',
  'Importância do MBPF na produção de alimentos',
  'O que são e quais são os POPs',
  'Periodicidade, responsável e preenchimento das planilhas',
  'Verificação do cumprimento da higienização correta',
];

// ─── Validity helpers ──────────────────────────────────────────────────────

function employeeTrainingStatus(employeeName, sessions, validityMonths) {
  const completed = sessions
    .filter((s) => s.status === 'closed' && s.participants.some((p) => p.name === employeeName && p.confirmed))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (completed.length === 0) return { status: 'never', label: 'Nunca capacitado', lastDate: null, daysAgo: null };

  const last = completed[0];
  const daysAgo = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000);
  const limitDays = validityMonths * 30;

  if (daysAgo <= limitDays * 0.85)  return { status: 'ok',      label: 'Em dia',          lastDate: last.date, daysAgo, session: last };
  if (daysAgo <= limitDays)         return { status: 'warn',    label: 'Renovação próxima', lastDate: last.date, daysAgo, session: last };
  return                                   { status: 'expired', label: 'Vencido',            lastDate: last.date, daysAgo, session: last };
}

// ─── Certificate PDF ───────────────────────────────────────────────────────

export function generateCertificatePDF(session, participant, tenant, config) {
  const date      = new Date(session.date).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const issuedAt  = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const topicList = session.topics.map((t) => `<li>${t}</li>`).join('');
  const validUntil = new Date(new Date(session.date).getTime() + (config?.validityMonths ?? 12) * 30 * 86400000)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>Certificado — ${participant.name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,serif;color:#1c2128;background:white}
    .page{width:210mm;min-height:148mm;padding:16mm 20mm;display:flex;flex-direction:column;border:8px double #c8a96e;margin:8mm auto}
    .header{text-align:center;margin-bottom:10mm;border-bottom:1px solid #c8a96e;padding-bottom:8mm}
    .company{font-size:14pt;font-weight:bold;letter-spacing:.05em;margin-bottom:3mm}
    .cert-title{font-size:22pt;font-weight:bold;letter-spacing:.12em;color:#1a1a1a;margin-bottom:3mm}
    .cert-sub{font-size:10pt;color:#656d76;letter-spacing:.08em}
    .body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6mm}
    .declares{font-size:11pt;color:#656d76}
    .name{font-size:24pt;font-weight:bold;letter-spacing:-.02em;color:#0f172a;border-bottom:1px solid #c8a96e;padding-bottom:2mm;margin:0 auto}
    .course{font-size:13pt;font-style:italic;color:#374151}
    .topics{text-align:left;background:#f9f9f7;border-left:3px solid #c8a96e;padding:4mm 6mm;border-radius:2mm;max-width:140mm}
    .topics p{font-size:9pt;color:#656d76;margin-bottom:2mm;font-weight:bold;letter-spacing:.05em}
    .topics ul{list-style:none;padding:0}
    .topics li{font-size:9pt;color:#374151;padding:1mm 0;padding-left:3mm}
    .topics li::before{content:"✓ ";color:#c8a96e}
    .meta{font-size:9pt;color:#656d76;display:flex;gap:8mm;justify-content:center}
    .footer{margin-top:8mm;padding-top:6mm;border-top:1px solid #c8a96e;display:grid;grid-template-columns:1fr 1fr;gap:8mm;align-items:end}
    .sig-block{text-align:center}
    .sig-line{border-bottom:1px solid #374151;margin-bottom:2mm;width:60mm;margin:0 auto 2mm}
    .sig-name{font-size:9pt;font-weight:bold;color:#1c2128}
    .sig-role{font-size:8pt;color:#656d76}
    .validity{text-align:right;font-size:8pt;color:#656d76}
    .validity strong{display:block;font-size:9pt;color:#374151}
    .watermark{font-size:8pt;color:#c8a96e;text-align:center;margin-top:4mm;letter-spacing:.08em}
    @page{size:A5 landscape;margin:0}
    @media print{body{margin:0}.page{margin:0;border:8px double #c8a96e}}
  </style></head>
  <body><div class="page">
    <div class="header">
      <div class="company">${tenant?.name ?? 'NutriOPS'}</div>
      <div class="cert-title">CERTIFICADO</div>
      <div class="cert-sub">DE CAPACITAÇÃO EM BOAS PRÁTICAS</div>
    </div>
    <div class="body">
      <div class="declares">Certificamos que</div>
      <div class="name">${participant.name}</div>
      <div class="declares">participou com êxito do treinamento</div>
      <div class="course">${session.title}</div>
      <div class="topics">
        <p>CONTEÚDO PROGRAMÁTICO</p>
        <ul>${topicList}</ul>
      </div>
      <div class="meta">
        <span>📅 ${date}</span>
        <span>⏱ ${session.duration}h de treinamento</span>
        <span>📍 ${session.location || tenant?.name || ''}</span>
      </div>
    </div>
    <div class="footer">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-name">${session.rtSignature?.by ?? session.instructor}</div>
        <div class="sig-role">Nutricionista RT${config?.crnNumber ? ` · CRN ${config.crnNumber}` : ''}</div>
        ${session.rtSignature ? `<div class="sig-role">Assinado em ${new Date(session.rtSignature.at).toLocaleDateString('pt-BR')}</div>` : ''}
      </div>
      <div class="validity">
        <div>Emitido em ${issuedAt}</div>
        <strong>Válido até ${validUntil}</strong>
        <div style="margin-top:2mm;font-size:7pt;color:#9ca3af">RDC 216/2004 · MBPF</div>
      </div>
    </div>
    <div class="watermark">NUTRIOPS · CONFORMIDADE SANITÁRIA DIGITAL · ${uid().slice(0,8).toUpperCase()}</div>
  </div></body></html>`;
}

// ─── Components ────────────────────────────────────────────────────────────

function TopicEditor({ topics, onChange }) {
  const [input, setInput] = useState('');
  const add = () => { const t = input.trim(); if (!t || topics.includes(t)) return; onChange([...topics, t]); setInput(''); };
  const remove = (i) => onChange(topics.filter((_, idx) => idx !== i));
  const reset  = () => onChange([...DEFAULT_TOPICS]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Conteúdo abordado</span>
        <button className="ghost-action" style={{ fontSize: 11 }} onClick={reset}>Restaurar padrão MBPF</button>
      </div>
      {topics.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--surface-muted)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>✓</span>
          <span style={{ flex: 1, fontSize: 13 }}>{t}</span>
          <button className="ghost-action danger" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Adicionar tópico personalizado…"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit' }} />
        <button className="secondary-action" onClick={add} style={{ fontSize: 12 }}>Adicionar</button>
      </div>
    </div>
  );
}

function ParticipantSelector({ allUsers, selected, onChange }) {
  const [search, setSearch] = useState('');
  const filtered = allUsers.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()));
  const toggle = (user) => {
    const exists = selected.find((p) => p.name === user.name);
    if (exists) onChange(selected.filter((p) => p.name !== user.name));
    else onChange([...selected, { name: user.name, role: user.role, confirmed: false, confirmedAt: null }]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Participantes ({selected.length})</span>
        <button className="ghost-action" style={{ fontSize: 11 }} onClick={() => onChange(allUsers.map((u) => ({ name: u.name, role: u.role, confirmed: false, confirmedAt: null })))}>
          Selecionar todos
        </button>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar funcionário…"
        style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit' }} />
      <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map((u) => {
          const sel = Boolean(selected.find((p) => p.name === u.name));
          return (
            <div key={u.name} onClick={() => toggle(u)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: sel ? 'var(--green-light)' : 'var(--surface-muted)', border: `1px solid ${sel ? 'var(--green-border)' : 'var(--border-subtle)'}`, transition: 'all .12s' }}>
              <span style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${sel ? 'var(--green)' : 'var(--border)'}`, background: sel ? 'var(--green)' : 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {sel && <span style={{ color: 'white', fontSize: 11, fontWeight: 800 }}>✓</span>}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{u.role} · {u.location || '—'}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Session Form ──────────────────────────────────────────────────────────

function SessionForm({ session, allUsers, onSave, onCancel, tenant }) {
  const [title,       setTitle]       = useState(session?.title ?? 'Capacitação em Boas Práticas de Fabricação');
  const [date,        setDate]        = useState(session?.date ?? new Date().toISOString().slice(0,10));
  const [duration,    setDuration]    = useState(session?.duration ?? 2);
  const [location,    setLocation]    = useState(session?.location ?? tenant?.name ?? '');
  const [instructor,  setInstructor]  = useState(session?.instructor ?? '');
  const [topics,      setTopics]      = useState(session?.topics ?? [...DEFAULT_TOPICS]);
  const [participants,setParticipants]= useState(session?.participants ?? []);
  const [obs,         setObs]         = useState(session?.obs ?? '');

  const handleSave = () => {
    if (!title.trim() || !date || participants.length === 0) return;
    onSave({ title:title.trim(), date, duration:Number(duration), location:location.trim(), instructor:instructor.trim(), topics, participants, obs:obs.trim() });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <button className="ghost-action" onClick={onCancel} style={{ padding: '6px 10px' }}>← Voltar</button>
        <div>
          <span className="eyebrow">Sessão de treinamento</span>
          <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.03em', marginTop: 2 }}>
            {session ? 'Editar sessão' : 'Nova sessão'}
          </h2>
        </div>
      </div>

      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Dados</span><h2>Informações do treinamento</h2></div></div>
          <div className="capture-fields">
            <label>Título do treinamento<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Capacitação em Boas Práticas de Fabricação" /></label>
            <div className="grid-2">
              <label>Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label>Duração (horas)<input type="number" min="0.5" step="0.5" value={duration} onChange={(e) => setDuration(e.target.value)} style={{ width: '100%' }} /></label>
            </div>
            <label>Local<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: Bäckerei Brasília Shopping" /></label>
            <label>Ministrante / Instrutor<input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Nome da nutricionista RT" /></label>
            <label>Observações (opcional)<textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observações sobre o treinamento…" style={{ minHeight: 54 }} /></label>
          </div>
        </article>

        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Participantes</span><h2>Quem participou</h2></div></div>
          <div className="capture-fields">
            <ParticipantSelector allUsers={allUsers} selected={participants} onChange={setParticipants} />
          </div>
        </article>
      </div>

      <article className="management-card">
        <div className="card-head"><div><span className="eyebrow">Conteúdo</span><h2>Tópicos abordados no treinamento</h2></div></div>
        <div className="capture-fields">
          <TopicEditor topics={topics} onChange={setTopics} />
        </div>
      </article>

      <div className="actions-row" style={{ justifyContent: 'flex-end' }}>
        <button className="secondary-action" onClick={onCancel}>Cancelar</button>
        <button className="primary-action attention" onClick={handleSave} disabled={!title.trim() || !date || participants.length === 0}>
          {session ? 'Salvar alterações' : 'Criar sessão'}
        </button>
      </div>
    </div>
  );
}

// ─── Session Detail ────────────────────────────────────────────────────────

function SessionDetail({ session, onBack, onUpdate, session: _s, tenant, config, sessionIndex }) {
  const [rtNote, setRtNote]         = useState('');
  const [signingRT, setSigningRT]   = useState(false);
  const [confirmingName, setConfirmingName] = useState(null);

  const isClosed = session.status === 'closed';

  const confirmParticipant = (name) => {
    const updated = { ...session, participants: session.participants.map((p) => p.name === name ? { ...p, confirmed: true, confirmedAt: new Date().toISOString() } : p), updatedAt: new Date().toISOString() };
    onUpdate(updated);
    setConfirmingName(null);
  };

  const signAndClose = (rtUser) => {
    const updated = {
      ...session, status: 'closed',
      rtSignature: { by: rtUser, role: 'Nutricionista RT', at: new Date().toISOString(), note: rtNote.trim() },
      updatedAt: new Date().toISOString(),
    };
    onUpdate(updated);
    setSigningRT(false); setRtNote('');
  };

  const printCertificate = (participant) => {
    const win = window.open('', '_blank');
    win.document.write(generateCertificatePDF(session, participant, tenant, config));
    win.document.close(); setTimeout(() => win.print(), 400);
  };

  const confirmedCount = session.participants.filter((p) => p.confirmed).length;
  const total          = session.participants.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <button className="ghost-action" onClick={onBack} style={{ padding: '6px 10px', flexShrink: 0, marginTop: 4 }}>← Voltar</button>
        <div style={{ flex: 1 }}>
          <span className="eyebrow">{new Date(session.date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {session.duration}h</span>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.04em', marginTop: 3 }}>{session.title}</h2>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {session.location && <span>📍 {session.location} · </span>}
            {session.instructor && <span>👩‍🏫 {session.instructor}</span>}
          </div>
        </div>
        <span className={`badge ${isClosed ? 'ok' : 'warn'}`}>{isClosed ? '✓ Encerrada e assinada' : 'Aberta'}</span>
      </div>

      {/* Topics */}
      <article className="management-card">
        <div className="card-head"><div><span className="eyebrow">Conteúdo</span><h2>Tópicos abordados</h2></div></div>
        <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {session.topics.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <span style={{ color: 'var(--green)', fontWeight: 700, flexShrink: 0 }}>✓</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </article>

      {/* Participants */}
      <article className="management-card">
        <div className="card-head">
          <div><span className="eyebrow">Lista de presença</span><h2>Participantes</h2></div>
          <span className={`badge ${confirmedCount === total ? 'ok' : 'warn'}`}>{confirmedCount}/{total} confirmados</span>
        </div>
        <div className="equipment-maintenance-list">
          {session.participants.map((p) => (
            <div key={p.name} className="equipment-maintenance-row">
              <div>
                <strong>{p.name}</strong>
                <span>{p.role}</span>
                {p.confirmed && p.confirmedAt && (
                  <span style={{ fontSize: 11, color: 'var(--green)' }}>
                    ✓ Confirmado em {new Date(p.confirmedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {isClosed && p.confirmed && (
                  <button className="secondary-action" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => printCertificate(p)}>
                    📄 Certificado
                  </button>
                )}
                {!isClosed && (
                  p.confirmed
                    ? <span className="badge ok">✓ Presente</span>
                    : confirmingName === p.name
                      ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="primary-action attention" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => confirmParticipant(p.name)}>
                            ✓ Confirmar presença
                          </button>
                          <button className="secondary-action" style={{ fontSize: 12 }} onClick={() => setConfirmingName(null)}>Cancelar</button>
                        </div>
                      )
                      : (
                        <button className="secondary-action" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setConfirmingName(p.name)}>
                          Confirmar presença
                        </button>
                      )
                )}
              </div>
            </div>
          ))}
        </div>
      </article>

      {/* RT Signature */}
      {!isClosed && (
        <article className="management-card" style={{ borderColor: 'var(--blue-border)' }}>
          <div className="card-head" style={{ background: 'var(--blue-light)', borderBottomColor: 'var(--blue-border)' }}>
            <div><span className="eyebrow" style={{ color: 'var(--blue)' }}>Assinatura RT</span><h2>Encerrar e assinar sessão</h2></div>
            {!signingRT && <button className="primary-action" style={{ fontSize: 12 }} onClick={() => setSigningRT(true)}>Assinar e encerrar</button>}
          </div>
          {signingRT && (
            <div className="capture-fields">
              <p className="muted">Ao assinar, a sessão será encerrada e os certificados ficam disponíveis para download.</p>
              <label>Observação da RT (opcional)
                <textarea value={rtNote} onChange={(e) => setRtNote(e.target.value)} placeholder="Observações sobre o treinamento…" style={{ minHeight: 54 }} />
              </label>
              <div className="actions-row">
                <button className="secondary-action" onClick={() => setSigningRT(false)}>Cancelar</button>
                <button className="primary-action attention" onClick={() => signAndClose(session.instructor || 'RT')}>
                  ✓ Confirmar assinatura e encerrar
                </button>
              </div>
            </div>
          )}
          {isClosed && session.rtSignature && (
            <div style={{ padding: '12px 20px', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="badge ok">✓ Assinado por {session.rtSignature.by}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{new Date(session.rtSignature.at).toLocaleString('pt-BR')}</span>
            </div>
          )}
        </article>
      )}

      {isClosed && (
        <article className="management-card" style={{ borderColor: 'var(--green-border)' }}>
          <div className="card-head" style={{ background: 'var(--green-light)', borderBottomColor: 'var(--green-border)' }}>
            <div><span className="eyebrow" style={{ color: 'var(--green)' }}>Concluído</span><h2>Sessão encerrada · Certificados disponíveis</h2></div>
          </div>
          <div style={{ padding: '12px 20px' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {session.participants.filter((p) => p.confirmed).map((p) => (
                <button key={p.name} className="secondary-action" style={{ fontSize: 12 }} onClick={() => printCertificate(p)}>
                  📄 {p.name}
                </button>
              ))}
            </div>
            {session.rtSignature && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12 }}>
                Assinado por <strong>{session.rtSignature.by}</strong> em {new Date(session.rtSignature.at).toLocaleDateString('pt-BR')}
                {session.rtSignature.note ? ` · "${session.rtSignature.note}"` : ''}
              </p>
            )}
          </div>
        </article>
      )}
    </div>
  );
}

// ─── Employee Status Overview ──────────────────────────────────────────────

function EmployeeStatusPanel({ allUsers, sessions, config }) {
  const validity = config?.validityMonths ?? 12;
  const statuses = allUsers.map((u) => ({
    ...u,
    ...employeeTrainingStatus(u.name, sessions, validity),
  }));

  const counts = {
    ok:      statuses.filter((s) => s.status === 'ok').length,
    warn:    statuses.filter((s) => s.status === 'warn').length,
    expired: statuses.filter((s) => s.status === 'expired').length,
    never:   statuses.filter((s) => s.status === 'never').length,
  };

  return (
    <article className="management-card">
      <div className="card-head">
        <div><span className="eyebrow">Situação da equipe</span><h2>Capacitação por funcionário</h2></div>
        <span className="badge neutral">Validade: {validity} meses</span>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
        {[['ok','Em dia',counts.ok],['warn','Renovar em breve',counts.warn],['expired','Vencido',counts.expired],['never','Nunca capacitado',counts.never]].map(([key,label,count]) => (
          <div key={key} style={{ flex:1, padding:'10px 16px', textAlign:'center', borderRight:'1px solid var(--border-subtle)' }}>
            <div style={{ fontSize:22, fontWeight:800, fontFamily:'var(--mono)', color: key==='ok'?'var(--green)':key==='warn'?'var(--amber)':'var(--red)' }}>{count}</div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginTop:2 }}>{label}</div>
          </div>
        ))}
      </div>
      <div className="equipment-maintenance-list">
        {statuses.map((s) => (
          <div key={s.name} className="equipment-maintenance-row">
            <div>
              <strong>{s.name}</strong>
              <span>{s.role} · {s.location || '—'}</span>
              {s.lastDate && <span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                Último treinamento: {new Date(s.lastDate+'T12:00').toLocaleDateString('pt-BR')} ({s.daysAgo}d atrás)
              </span>}
            </div>
            <span className={`badge ${s.status==='ok'?'ok':s.status==='warn'?'warn':'danger'}`}>{s.label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

// ─── Main Training View ────────────────────────────────────────────────────

export function TrainingView({ activeTenant, allTenants, onTenantChange, session }) {
  const [sessions, setSessions]   = useState(() => readSessions(activeTenant.id));
  const [config, setConfig]       = useState(() => readTrainConfig(activeTenant.id));
  const [view, setView]           = useState('list'); // list | new | detail
  const [detailSession, setDetailSession] = useState(null);
  const [tab, setTab]             = useState('sessions'); // sessions | status | settings

  const allUsers = readUsers(activeTenant);

  useEffect(() => { setSessions(readSessions(activeTenant.id)); setConfig(readTrainConfig(activeTenant.id)); setView('list'); setDetailSession(null); }, [activeTenant.id]);
  useEffect(() => { writeSessions(activeTenant.id, sessions); }, [activeTenant.id, sessions]);
  useEffect(() => { writeTrainConfig(activeTenant.id, config); }, [activeTenant.id, config]);

  const handleCreate = useCallback((data) => {
    const newSession = { id:uid(), tenantId:activeTenant.id, status:'open', participants:data.participants, rtSignature:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), ...data };
    setSessions((prev) => [newSession, ...prev]);
    setDetailSession(newSession);
    setView('detail');
  }, [activeTenant.id]);

  const handleUpdate = useCallback((updated) => {
    setSessions((prev) => prev.map((s) => s.id === updated.id ? updated : s));
    setDetailSession(updated);
  }, []);

  if (view === 'new') {
    return (
      <section className="management-page">
        <SessionForm allUsers={allUsers} onSave={handleCreate} onCancel={() => setView('list')} tenant={activeTenant} />
      </section>
    );
  }

  if (view === 'detail' && detailSession) {
    const live = sessions.find((s) => s.id === detailSession.id) ?? detailSession;
    return (
      <section className="management-page">
        <SessionDetail session={live} onBack={() => setView('list')} onUpdate={handleUpdate} tenant={activeTenant} config={config} />
      </section>
    );
  }

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Boas Práticas de Fabricação</span>
          <h1>Capacitação</h1>
          <p className="muted">Registro de treinamentos, confirmação de presença e emissão de certificados digitais.</p>
        </div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {tab === 'sessions' && <button className="primary-action" onClick={() => setView('new')}>+ Nova sessão</button>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:20 }}>
        {[['sessions','Sessões de treinamento'],['status','Situação da equipe'],['settings','Configurações']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding:'7px 16px', borderRadius:8, border:'1px solid var(--border)', background:tab===key?'var(--text)':'var(--surface)', color:tab===key?'white':'var(--text)', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'status' && <EmployeeStatusPanel allUsers={allUsers} sessions={sessions} config={config} />}

      {tab === 'settings' && (
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Parâmetros</span><h2>Configurações de capacitação</h2></div></div>
          <div className="capture-fields" style={{ maxWidth: 400 }}>
            <label>Validade do treinamento (meses)
              <input type="number" min="1" max="60" value={config.validityMonths} onChange={(e) => setConfig((c) => ({ ...c, validityMonths: Number(e.target.value) }))} style={{ width: '100%' }} />
            </label>
            <label>CRN da nutricionista (para certificados)
              <input value={config.crnNumber} onChange={(e) => setConfig((c) => ({ ...c, crnNumber: e.target.value }))} placeholder="Ex.: 1-12345" />
            </label>
            <div className="submission ok" style={{ fontSize: 12 }}>Configurações salvas automaticamente.</div>
          </div>
        </article>
      )}

      {tab === 'sessions' && (
        <>
          {sessions.length === 0 ? (
            <article className="management-card">
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <p className="muted" style={{ marginBottom: 16 }}>Nenhuma sessão de treinamento registrada ainda.</p>
                <button className="primary-action" onClick={() => setView('new')}>+ Criar primeira sessão</button>
              </div>
            </article>
          ) : (
            <div className="forms-grid">
              {sessions.map((s) => {
                const confirmed = s.participants.filter((p) => p.confirmed).length;
                const total     = s.participants.length;
                const isClosed  = s.status === 'closed';
                return (
                  <article key={s.id} className="form-card" style={{ borderTopColor: isClosed ? 'var(--green)' : 'var(--blue)', cursor: 'pointer' }} onClick={() => { setDetailSession(s); setView('detail'); }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                      <div>
                        <span className="eyebrow">{new Date(s.date+'T12:00').toLocaleDateString('pt-BR',{day:'numeric',month:'short',year:'numeric'})} · {s.duration}h</span>
                        <h3 style={{ fontSize:14, fontWeight:700, marginTop:3 }}>{s.title}</h3>
                      </div>
                      <span className={`badge ${isClosed?'ok':'warn'}`}>{isClosed?'✓ Concluída':'Em aberto'}</span>
                    </div>
                    {s.location && <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:8 }}>📍 {s.location}</p>}
                    <div style={{ height:4, background:'var(--border-subtle)', borderRadius:2, marginBottom:10, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${total>0?(confirmed/total)*100:0}%`, background:isClosed?'var(--green)':'var(--blue)', borderRadius:2 }} />
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text-secondary)' }}>
                      <span>{confirmed}/{total} presença{total!==1?'s':''} confirmada{total!==1?'s':''}</span>
                      {isClosed && <span style={{ color:'var(--green)', fontWeight:700 }}>📄 {confirmed} certificado{confirmed!==1?'s':''}</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
