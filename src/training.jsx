import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { employeeTrainingStatus } from './training-status';
// Fatia 3 (15/08): sessões e config sobem pra nuvem — antes viviam só no
// localStorage do device da RT, e um wipe apagava os comprovantes de
// capacitação da rede inteira (auditoria RDC §3.5).
import { pushTrainingSession, pushTrainingConfig, pushComplianceDoc, deleteComplianceDoc, lw as gravarLocal } from './repository';
// ASO mora aqui e não numa tela própria porque a RDC 216 trata capacitação e
// controle de saúde no MESMO §4.6 — pra RT são as duas metades da mesma
// pergunta ("este manipulador está apto?").
import { DOC_TYPES, COMPLIANCE_DEFAULTS, ASO_STATUS_LABEL, LEAVE_TYPE_LABEL, teamAsoSummary, currentLeave, validadeEfetiva, hojeISO, descreverAfastamento } from './compliance';
import { consumeTrainingPendingTab } from './nav';

// ─── Storage ───────────────────────────────────────────────────────────────

function getProfile(tenantId) {
  try { const r = localStorage.getItem(`nutriops.company.profile.${tenantId}`); return r ? JSON.parse(r) : {}; } catch { return {}; }
}

// ─── Storage ───────────────────────────────────────────────────────────────

const sessionsKey = (id) => `nutriops.training.sessions.${id}`;
const configKey   = (id) => `nutriops.training.config.${id}`;
const usersKey    = (id) => `nutriops.users.${id}`;

const tl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
// Grava pelo `lw` do repositório em vez de engolir a falha: quando o
// localStorage enche, o setItem estoura e o app inteiro segue confirmando
// sucesso. O `lw` loga e levanta a bandeira que o banner de "armazenamento
// cheio" lê (v1.9.158) — este arquivo tinha a própria cópia muda do helper,
// e a bandeira nunca chegava aqui. Achado da auditoria (18/08).
const ts = (k, v) => gravarLocal(k, v);

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

// Classificação canônica movida pra training-status.js (item 7 da revisão de
// produto) — outras telas (algumas lazy-loaded, não podem importar este
// arquivo pesado) também precisavam dela e reimplementavam cada uma a sua
// conta, três delas divergentes da configuração real da loja.
const STATUS_LABEL = { ok: 'Em dia', warn: 'Renovação próxima', expired: 'Vencido', never: 'Nunca capacitado' };

// ─── Certificate PDF ───────────────────────────────────────────────────────

export function generateCertificatePDF(session, participant, tenant, config) {
  const p         = getProfile(tenant?.id);
  const date      = new Date(session.date).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const issuedAt  = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const topicList = session.topics.map((t) => `<li>${t}</li>`).join('');
  const validUntil = new Date(new Date(session.date).getTime() + (config?.validityMonths ?? 12) * 30 * 86400000)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const rtNome = p.rtNome || session.rtSignature?.by || session.instructor || 'Nutricionista RT';
  const rtCrn  = p.rtCrn  || config?.crnNumber || '';
  const companyName = p.razaoSocial || tenant?.name || '';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>Certificado — ${participant.name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,serif;color:#1c2128;background:white}
    .page{width:210mm;min-height:148mm;padding:16mm 20mm;display:flex;flex-direction:column;border:8px double #c8a96e;margin:8mm auto}
    .header{text-align:center;margin-bottom:10mm;border-bottom:1px solid #c8a96e;padding-bottom:8mm}
    .company{font-size:14pt;font-weight:bold;letter-spacing:.05em;margin-bottom:2mm}
    .company-detail{font-size:8pt;color:#656d76;margin-top:1mm}
    .cert-title{font-size:22pt;font-weight:bold;letter-spacing:.12em;color:#1a1a1a;margin:4mm 0 3mm}
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
      <div class="company">${companyName}</div>
      ${p.cnpj ? `<div class="company-detail">CNPJ: ${p.cnpj}</div>` : ''}
      ${p.endereco ? `<div class="company-detail">${p.endereco}</div>` : ''}
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
        <span>📍 ${session.location || companyName}</span>
      </div>
    </div>
    <div class="footer">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-name">${rtNome}</div>
        <div class="sig-role">Nutricionista RT${rtCrn ? ` · ${rtCrn}` : ''}</div>
        ${session.rtSignature ? `<div class="sig-role">Assinado em ${new Date(session.rtSignature.at).toLocaleDateString('pt-BR')}</div>` : ''}
      </div>
      <div class="validity">
        <div>Emitido em ${issuedAt}</div>
        <strong>Válido até ${validUntil}</strong>
        <div style="margin-top:2mm;font-size:7pt;color:#9ca3af">RDC 216/2004 · MBPF</div>
      </div>
    </div>
    <div class="watermark">NUTRIOPS · CONFORMIDADE SANITÁRIA DIGITAL · ${Math.random().toString(36).slice(2,10).toUpperCase()}</div>
  </div></body></html>`;
}

// ─── Components ────────────────────────────────────────────────────────────

function TopicEditor({ topics, onChange }) {
  const [input, setInput] = useState('');
  // Achado da auditoria (19/08, tier baixa): quando o texto já estava na
  // lista, `add` só dava `return` — o botão nunca ficava disabled (parecia
  // clicável) e o Enter caía no mesmo `return` mudo. Fácil de disparar: os 5
  // tópicos padrão do MBPF são frases longas, e "Restaurar padrão MBPF"
  // enche a lista de novo, então colar um que já existe é comum. Sem
  // feedback a pessoa só via o campo intacto e nada de novo na lista.
  // `dup` dá o aviso pro caminho do Enter; `disabled` (idem
  // .secondary-action:disabled já coberto em styles.css) cobre o clique.
  const [dup, setDup] = useState(false);
  const isDuplicate = (t) => topics.includes(t);
  const add = () => {
    const t = input.trim();
    if (!t) return;
    if (isDuplicate(t)) { setDup(true); return; }
    onChange([...topics, t]); setInput(''); setDup(false);
  };
  const remove = (i) => onChange(topics.filter((_, idx) => idx !== i));
  const reset  = () => onChange([...DEFAULT_TOPICS]);
  const trimmedInput = input.trim();
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
        <input value={input} onChange={(e) => { setInput(e.target.value); setDup(false); }} placeholder="Adicionar tópico personalizado…"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit' }} />
        <button className="secondary-action" onClick={add} disabled={!trimmedInput || isDuplicate(trimmedInput)} style={{ fontSize: 12 }}>Adicionar</button>
      </div>
      {dup && <span style={{ fontSize: 11, color: 'var(--red)' }}>Esse tópico já está na lista.</span>}
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
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar colaborador…"
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

// Confirma presença pelo ÍNDICE na lista, não pelo nome: participante nasce
// sem id (só name/role — ParticipantSelector, acima), e duas colaboradoras
// homônimas na mesma loja (nenhuma guarda contra nome duplicado em
// team-views.jsx) geram duas linhas com o MESMO name. Casar por
// `p.name === name` confirmava as DUAS de uma vez — inclusive a que não foi
// ao treinamento — e o certificado assinado pela RT saía pra ela também.
// Pura (extraída pra testar sem precisar montar o componente — sem
// @testing-library neste repo). Achado da auditoria de 18/08 (T4).
export function confirmParticipantAt(participants, index, confirmedAt = new Date().toISOString()) {
  return participants.map((p, i) => i === index ? { ...p, confirmed: true, confirmedAt } : p);
}

function SessionDetail({ session, onBack, onUpdate, session: _s, tenant, config, sessionIndex }) {
  const [rtNote, setRtNote]         = useState('');
  const [signingRT, setSigningRT]   = useState(false);
  const [confirmingIndex, setConfirmingIndex] = useState(null);

  const isClosed = session.status === 'closed';

  const confirmParticipant = (index) => {
    const updated = { ...session, participants: confirmParticipantAt(session.participants, index), updatedAt: new Date().toISOString() };
    onUpdate(updated);
    setConfirmingIndex(null);
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
          {session.participants.map((p, i) => (
            <div key={`${p.name}-${i}`} className="equipment-maintenance-row">
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
                    : confirmingIndex === i
                      ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="primary-action attention" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => confirmParticipant(i)}>
                            ✓ Confirmar presença
                          </button>
                          <button className="secondary-action" style={{ fontSize: 12 }} onClick={() => setConfirmingIndex(null)}>Cancelar</button>
                        </div>
                      )
                      : (
                        <button className="secondary-action" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setConfirmingIndex(i)}>
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
              {session.participants.map((p, i) => ({ p, i })).filter(({ p }) => p.confirmed).map(({ p, i }) => (
                <button key={`${p.name}-${i}`} className="secondary-action" style={{ fontSize: 12 }} onClick={() => printCertificate(p)}>
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

// ─── ASO — controle de saúde dos manipuladores (Fatia 2b) ─────────────────
// Era um dos 5 DESCOBERTOS da auditoria (§3.4): item de autuação clássico e o
// app não tinha nem onde anotar. Guarda o ATESTADO (data, validade, resultado)
// — não o arquivo do exame.
const complianceKey = (id) => `nutriops.compliance.${id}`;
const lerCompliance = (id) => tl(complianceKey(id), []);

function AsoPanel({ tenant, allUsers }) {
  const [docs, setDocs]   = useState(() => lerCompliance(tenant.id));
  const [editando, setEditando] = useState(null);   // nome do colaborador
  const [emissao, setEmissao]   = useState('');
  const [validade, setValidade] = useState('');
  const [resultado, setResultado] = useState('apto');
  const [obs, setObs] = useState('');

  useEffect(() => { setDocs(lerCompliance(tenant.id)); setEditando(null); }, [tenant.id]);

  const resumo = teamAsoSummary(allUsers, docs, COMPLIANCE_DEFAULTS.asoValidadeMeses);

  const abrir = (nome) => {
    const atual = docs.filter((d) => d.docType === DOC_TYPES.ASO && d.subject === nome)
      .sort((a, b) => new Date(b.issuedAt ?? 0) - new Date(a.issuedAt ?? 0))[0];
    setEditando(nome);
    setEmissao(atual?.issuedAt ?? '');
    setValidade(atual?.validUntil ?? '');
    setResultado(atual?.resultado ?? 'apto');
    setObs(atual?.obs ?? '');
  };

  const salvar = () => {
    if (!emissao) return;
    const doc = {
      id: uid(), docType: DOC_TYPES.ASO, subject: editando,
      issuedAt: emissao,
      // Validade em branco = deriva de emissão + a régua (12 meses). Guardar
      // a data derivada em vez de recalcular toda hora deixa explícito na
      // nuvem até quando aquele exame vale.
      validUntil: validade || validadeEfetiva({ issuedAt: emissao }, COMPLIANCE_DEFAULTS.asoValidadeMeses),
      resultado, obs: obs.trim(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const proximos = [doc, ...docs];
    setDocs(proximos);
    ts(complianceKey(tenant.id), proximos);
    pushComplianceDoc(tenant.id, doc);
    setEditando(null);
  };

  const remover = async (docId) => {
    if (!window.confirm('Remover este registro de ASO?')) return;
    const proximos = docs.filter((d) => d.id !== docId);
    setDocs(proximos);
    ts(complianceKey(tenant.id), proximos);
    // deleteComplianceDoc NUNCA lança — devolve {ok:false, reason}. Offline é
    // esperado (delete é online-only de propósito: enfileirar seria replayado
    // como upsert e ressuscitaria o registro); falha REAL com internet
    // presente precisa avisar, senão o ASO volta sozinho no próximo sync e
    // parece que a remoção nunca aconteceu. Mesmo padrão de
    // removeItem/removeAction (pages.jsx). Achado da auditoria (19/08).
    const r = await deleteComplianceDoc(tenant.id, docId);
    if (!r.ok && r.reason !== 'offline_or_disabled') {
      window.alert('Não foi possível remover este registro na nuvem agora. Ele pode reaparecer na próxima sincronização — tente remover de novo.');
    }
  };

  // Afastamento (23/08) — não é resultado de exame, é a situação da pessoa.
  // Mesmo `docs`, doc_type próprio (DOC_TYPES.LEAVE). "Voltou ao trabalho" é
  // modelado como AUSÊNCIA do doc (currentLeave trata leaveType null/ausente
  // do mesmo jeito) — por isso aqui é sempre um delete-then-maybe-insert: sem
  // isso, cada troca de status deixaria uma linha nova pra sempre na nuvem
  // (compliance_docs não tem unique em tenant+subject+tipo).
  // `startedAt` undefined = "não mexe na data" (usado quando só o TIPO muda);
  // string = data explícita, vinda do campo. Tipo novo sem data nenhuma
  // assume hoje — a RT quase sempre registra no dia, e um campo vazio ali
  // viraria afastamento sem data, que é o que ela pediu pra resolver.
  const mudarAfastamento = async (nome, leaveType, startedAt) => {
    const anterior = docs.find((d) => d.docType === DOC_TYPES.LEAVE && d.subject === nome);
    let proximos = anterior ? docs.filter((d) => d.id !== anterior.id) : docs;
    if (leaveType) {
      const data = startedAt !== undefined ? startedAt
        : (anterior?.startedAt ?? hojeISO());
      proximos = [{
        id: uid(), docType: DOC_TYPES.LEAVE, subject: nome, leaveType,
        startedAt: data || null,
        createdAt: anterior?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, ...proximos];
    }
    // Local primeiro, sempre — mesmo padrão de `remover()` logo acima. A 1ª
    // versão gatiava o `setDocs` atrás do `await deleteComplianceDoc`: se a
    // nuvem recusasse por qualquer motivo real (não só offline), a função
    // dava `return` ANTES de tocar o estado local, e a tela ficava presa
    // mostrando a licença antiga pra sempre — mesmo a pessoa já tendo
    // voltado ao trabalho. Pego no teste manual no navegador (24/08).
    setDocs(proximos);
    ts(complianceKey(tenant.id), proximos);
    if (leaveType) pushComplianceDoc(tenant.id, proximos[0]);
    if (anterior) {
      const r = await deleteComplianceDoc(tenant.id, anterior.id);
      if (!r.ok && r.reason !== 'offline_or_disabled') {
        window.alert('A situação foi atualizada aqui, mas o registro anterior pode reaparecer na próxima sincronização — tente de novo com internet.');
      }
    }
  };

  const tone = { ok:'ok', warn:'warn', expired:'danger', never:'neutral' };

  return (
    <article className="management-card">
      <div className="card-head">
        <div><span className="eyebrow">RDC 216 · §4.6</span><h2>Controle de saúde (ASO) por colaborador</h2></div>
        <span className="badge neutral">Validade padrão: {COMPLIANCE_DEFAULTS.asoValidadeMeses} meses</span>
      </div>
      <div style={{ display:'flex', borderBottom:'1px solid var(--border-subtle)' }}>
        {[['ok','Em dia',resumo.ok],['warn','Vence em breve',resumo.warn],['expired','Vencido',resumo.expired],['never','Sem ASO',resumo.never],['leave','Afastada(o)',resumo.leave]].map(([key,label,count]) => (
          <div key={key} style={{ flex:1, padding:'10px 16px', textAlign:'center', borderRight:'1px solid var(--border-subtle)' }}>
            <div style={{ fontSize:22, fontWeight:800, fontFamily:'var(--mono)', color: key==='ok'?'var(--green)':key==='warn'?'var(--amber)':key==='expired'?'var(--red)':'var(--text-secondary)' }}>{count}</div>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)', marginTop:2 }}>{label}</div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ padding:'10px 20px 0' }}>
        O NutriOPS registra que o exame existe e até quando vale — o documento em si continua com a loja. Deixar a validade em branco assume {COMPLIANCE_DEFAULTS.asoValidadeMeses} meses a partir da emissão (padrão PCMSO), mas o que vale é a data que o médico definiu.
      </p>
      <div className="equipment-maintenance-list">
        {resumo.situacoes.length === 0 && <p className="muted" style={{ padding:'20px' }}>Nenhum colaborador ativo cadastrado nesta loja.</p>}
        {resumo.situacoes.map((s) => (
          <div key={s.name} className="equipment-maintenance-row" style={editando === s.name ? { flexDirection:'column', gap:10, alignItems:'stretch' } : undefined}>
            {/* O `.equipment-maintenance-row > div` do styles.css empilha os
                filhos, mas só no PRIMEIRO nível — aqui há um wrapper no meio
                (pra linha virar coluna ao editar), então a coluna vai no
                inline. Sem isso, nome/cargo/status saíam colados numa linha. */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', width:'100%', gap:8 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                <strong>{s.name}</strong>
                <span>{s.role}</span>
                <span>
                  {/* Enquanto afastada, o texto principal é a licença — não o
                      ASO, que pode até estar vencido sem que isso signifique
                      nada (ela não está trabalhando). O status real do exame
                      some da linha de cima, mas continua editável abaixo. */}
                  {s.leaveType ? descreverAfastamento(s.leaveType, s.leaveStartedAt)
                    : s.status === 'never' ? 'Nenhum ASO registrado'
                    : s.status === 'expired' ? `Venceu há ${Math.abs(s.diasRestantes)} dia(s)`
                    : `Vence em ${s.diasRestantes} dia(s) · ${new Date(`${s.doc._validade}T12:00`).toLocaleDateString('pt-BR')}`}
                </span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                <select value={s.leaveType ?? ''} onChange={(e) => mudarAfastamento(s.name, e.target.value || null)}
                  style={{ fontSize:11, padding:'4px 6px', borderRadius:6, border:'1px solid var(--border-subtle)', background:'var(--surface)', color:'var(--text)' }}
                  aria-label={`Situação de ${s.name}`}>
                  <option value="">Ativa</option>
                  {Object.entries(LEAVE_TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                {/* Só aparece quando há afastamento — pedido da RT (24/08).
                    Nasce com hoje (mudarAfastamento), e fica editável porque
                    ela costuma registrar dias depois do início real. */}
                {s.leaveType && (
                  <input type="date" value={s.leaveStartedAt ?? ''}
                    onChange={(e) => mudarAfastamento(s.name, s.leaveType, e.target.value)}
                    aria-label={`Início do afastamento de ${s.name}`}
                    style={{ fontSize:11, padding:'4px 6px', borderRadius:6, border:'1px solid var(--border-subtle)', background:'var(--surface)', color:'var(--text)' }} />
                )}
                <span className={`badge ${s.leaveType ? 'neutral' : tone[s.status]}`}>{s.leaveType ? LEAVE_TYPE_LABEL[s.leaveType] : ASO_STATUS_LABEL[s.status]}</span>
                <button className="ghost-action" style={{ fontSize:11 }} onClick={() => abrir(s.name)}>
                  {s.status === 'never' ? 'Registrar' : 'Atualizar'}
                </button>
                {s.doc && <button className="ghost-action danger" style={{ fontSize:11 }} onClick={() => remover(s.doc.id)}>Remover</button>}
              </div>
            </div>
            {editando === s.name && (
              <div className="capture-fields" style={{ padding:0, width:'100%' }}>
                <div className="grid-2">
                  <label>Data do exame<input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} /></label>
                  <label>Válido até (opcional)<input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></label>
                </div>
                <div className="grid-2">
                  <label>Resultado
                    <select value={resultado} onChange={(e) => setResultado(e.target.value)}>
                      <option value="apto">Apto</option>
                      <option value="apto_restricao">Apto com restrição</option>
                      <option value="inapto">Inapto</option>
                    </select>
                  </label>
                  <label>Observações<input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: restrição para manipulação a frio" /></label>
                </div>
                <div className="actions-row" style={{ justifyContent:'flex-end' }}>
                  <button className="secondary-action" onClick={() => setEditando(null)}>Cancelar</button>
                  <button className="primary-action" onClick={salvar} disabled={!emissao}>Salvar ASO</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function EmployeeStatusPanel({ allUsers, sessions, config }) {
  const validity = config?.validityMonths ?? 12;
  const statuses = allUsers.map((u) => {
    const r = employeeTrainingStatus(u.name, sessions, validity);
    return { ...u, status: r.status, daysAgo: r.daysAgo, lastDate: r.session?.date ?? null, label: STATUS_LABEL[r.status] };
  });

  const counts = {
    ok:      statuses.filter((s) => s.status === 'ok').length,
    warn:    statuses.filter((s) => s.status === 'warn').length,
    expired: statuses.filter((s) => s.status === 'expired').length,
    never:   statuses.filter((s) => s.status === 'never').length,
  };

  return (
    <article className="management-card">
      <div className="card-head">
        <div><span className="eyebrow">Situação da equipe</span><h2>Capacitação por colaborador</h2></div>
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
  // Cmd+K "Ir pra Saúde (ASO)" grava um pedido de uma vez só (nav.js) antes
  // de navegar — sem isso, chegar em Capacitação sempre abria na aba
  // Sessões, e quem buscasse "aso" não tinha como cair direto na aba certa.
  const [tab, setTab]             = useState(() =>
    consumeTrainingPendingTab(typeof localStorage !== 'undefined' ? localStorage : null) ?? 'sessions'); // sessions | status | aso | settings

  const allUsers = readUsers(activeTenant);

  useEffect(() => { setSessions(readSessions(activeTenant.id)); setConfig(readTrainConfig(activeTenant.id)); setView('list'); setDetailSession(null); }, [activeTenant.id]);
  useEffect(() => { writeSessions(activeTenant.id, sessions); }, [activeTenant.id, sessions]);
  useEffect(() => { writeTrainConfig(activeTenant.id, config); }, [activeTenant.id, config]);

  const handleCreate = useCallback((data) => {
    const newSession = { id:uid(), tenantId:activeTenant.id, status:'open', participants:data.participants, rtSignature:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), ...data };
    setSessions((prev) => [newSession, ...prev]);
    pushTrainingSession(activeTenant.id, newSession); // nuvem (ou fila offline)
    setDetailSession(newSession);
    setView('detail');
  }, [activeTenant.id]);

  const handleUpdate = useCallback((updated) => {
    setSessions((prev) => prev.map((s) => s.id === updated.id ? updated : s));
    // Toda mutação (presença confirmada, encerramento, assinatura RT) passa
    // por aqui — um push cobre tudo. Upsert por id, pode repetir à vontade.
    pushTrainingSession(updated.tenantId ?? activeTenant.id, updated);
    setDetailSession(updated);
  }, [activeTenant.id]);

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
        {[['sessions','Sessões de treinamento'],['status','Situação da equipe'],['aso','Saúde (ASO)'],['settings','Configurações']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding:'7px 16px', borderRadius:8, border:'1px solid var(--border)', background:tab===key?'var(--text)':'var(--surface)', color:tab===key?'white':'var(--text)', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'status' && <EmployeeStatusPanel allUsers={allUsers} sessions={sessions} config={config} />}

      {tab === 'aso' && <AsoPanel tenant={activeTenant} allUsers={allUsers} />}

      {tab === 'settings' && (
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Parâmetros</span><h2>Configurações de capacitação</h2></div></div>
          <div className="capture-fields" style={{ maxWidth: 400 }}>
            {/* Push no blur, não a cada tecla: digitar "24" dispararia dois
                upserts; sair do campo dispara um. O localStorage continua
                sendo escrito a cada tecla pelo effect de cima. */}
            <label>Validade do treinamento (meses)
              <input type="number" min="1" max="60" value={config.validityMonths} onChange={(e) => setConfig((c) => ({ ...c, validityMonths: Number(e.target.value) }))} onBlur={() => pushTrainingConfig(activeTenant.id, config)} style={{ width: '100%' }} />
            </label>
            <label>CRN da nutricionista (para certificados)
              <input value={config.crnNumber} onChange={(e) => setConfig((c) => ({ ...c, crnNumber: e.target.value }))} onBlur={() => pushTrainingConfig(activeTenant.id, config)} placeholder="Ex.: 1-12345" />
            </label>
            <div className="submission ok" style={{ fontSize: 12 }}>Configurações salvas automaticamente — neste aparelho e na nuvem.</div>
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
