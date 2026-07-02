import React, { useState, useEffect } from 'react';
import { loginHandle } from './user-match';

const catalogKey = (id) => `nutriops.equipment.catalog.${id}`;
const turnsKey   = (id) => `nutriops.turns.${id}`;
const usersKey   = (id) => `nutriops.users.${id}`;
const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

const DEFAULT_TURNS = [
  { id: 'manha', name: 'Manhã',  start: '06:00', end: '11:59' },
  { id: 'tarde', name: 'Tarde',  start: '12:00', end: '17:59' },
  { id: 'noite', name: 'Noite',  start: '18:00', end: '23:59' },
];

const readEquipmentCatalog = (t) => load(catalogKey(t.id), t.equipmentCatalog ?? []);
const readTurns  = (t)     => load(turnsKey(t.id), DEFAULT_TURNS);
const writeTurns = (id, v) => save(turnsKey(id), v);
const readUsers  = (t)     => load(usersKey(t.id), t.usersList ?? []);
const writeUsers = (id, v) => save(usersKey(id), v);

export function TurnsView({ activeTenant, allTenants, onTenantChange, records }) {
  const [turns, setTurns]           = useState(() => readTurns(activeTenant));
  const [editingId, setEditingId]   = useState(null);
  const [nameInput, setNameInput]   = useState('');
  const [startInput, setStartInput] = useState('06:00');
  const [endInput, setEndInput]     = useState('12:00');
  useEffect(() => { setTurns(readTurns(activeTenant)); setEditingId(null); }, [activeTenant.id]);
  useEffect(() => { writeTurns(activeTenant.id, turns); }, [activeTenant.id, turns]);

  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes(), catalog = readEquipmentCatalog(activeTenant);
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const isActive = (turn) => nowMin >= toMin(turn.start) && nowMin <= toMin(turn.end);
  const turnRecs = (turn) => {
    const sm = toMin(turn.start), em = toMin(turn.end), tStr = now.toDateString();
    return records.filter((r) => { if (r.tenantId !== activeTenant.id) return false; const rd = new Date(r.createdAt); if (rd.toDateString() !== tStr) return false; const rm = rd.getHours() * 60 + rd.getMinutes(); return rm >= sm && rm <= em; });
  };
  const startEdit = (turn) => { setEditingId(turn.id); setNameInput(turn.name); setStartInput(turn.start); setEndInput(turn.end); };
  const cancelEdit = () => { setEditingId(null); setNameInput(''); setStartInput('06:00'); setEndInput('12:00'); };
  const saveTurn = () => {
    if (!nameInput.trim()) return;
    const entry = { name: nameInput.trim(), start: startInput, end: endInput };
    setTurns((prev) => editingId ? prev.map((t) => t.id === editingId ? { ...t, ...entry } : t) : [...prev, { id: crypto.randomUUID(), ...entry }]);
    cancelEdit();
  };
  const removeTurn = (id) => { if (!window.confirm('Remover este turno?')) return; setTurns((prev) => prev.filter((t) => t.id !== id)); };
  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Operação</span><h1>Turnos</h1><p className="muted">Configure as janelas de registro. Alertas são gerados com base nos turnos ativos.</p></div><div className="page-actions"><span className="badge subtle">{activeTenant.name}</span></div></div>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">{editingId ? 'Editando' : 'Novo turno'}</span><h2>{editingId ? turns.find((t) => t.id === editingId)?.name ?? '' : 'Cadastrar turno'}</h2></div></div>
          <div className="capture-fields">
            <label>Empresa<select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)}>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Nome do turno<input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Ex.: Manhã, Tarde, Noite" /></label>
            <div className="grid-2">
              <label>Início<input type="time" value={startInput} onChange={(e) => setStartInput(e.target.value)} /></label>
              <label>Fim<input type="time" value={endInput} onChange={(e) => setEndInput(e.target.value)} /></label>
            </div>
            <div className="actions-row">
              {editingId && <button className="secondary-action" onClick={cancelEdit}>Cancelar</button>}
              <button className="primary-action" onClick={saveTurn}>{editingId ? 'Salvar' : 'Adicionar turno'}</button>
            </div>
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Hoje</span><h2>Status dos turnos</h2></div><span className="badge neutral">{turns.length} turnos</span></div>
          <div className="equipment-maintenance-list">
            {turns.map((turn) => { const active = isActive(turn), recs = turnRecs(turn), pct = catalog.length > 0 ? Math.round((Math.min(recs.length, catalog.length) / catalog.length) * 100) : 0; return (
              <div key={turn.id} className={`equipment-maintenance-row ${editingId === turn.id ? 'editing' : ''}`}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong>{turn.name}</strong>{active && <span className="badge ok">Ativo agora</span>}</div>
                  <span>{turn.start} – {turn.end}</span>
                  <span>{recs.length} registro{recs.length !== 1 ? 's' : ''} hoje · {pct}% coberto</span>
                </div>
                <div className="equipment-row-actions">
                  <button className="ghost-action" onClick={() => startEdit(turn)}>Editar</button>
                  <button className="ghost-action danger" onClick={() => removeTurn(turn.id)}>Remover</button>
                </div>
              </div>
            ); })}
          </div>
        </article>
      </div>
    </section>
  );
}

export function UsersView({ activeTenant, allTenants, onTenantChange }) {
  const [users, setUsers]                 = useState(() => readUsers(activeTenant));
  const [nameInput, setNameInput]         = useState('');
  const [roleInput, setRoleInput]         = useState('Colaborador');
  const [locationInput, setLocationInput] = useState('');
  const [statusInput, setStatusInput]     = useState('Ativo');
  const [editingIndex, setEditingIndex]   = useState(null);
  const [search, setSearch]               = useState('');
  const [roleFilter, setRoleFilter]       = useState('Todos');
  const [pinInput, setPinInput] = useState('0000');
  const roles = ['Colaborador', 'Supervisor', 'Nutricionista RT', 'Administrador'];
  useEffect(() => { setUsers(readUsers(activeTenant)); setEditingIndex(null); setNameInput(''); setRoleInput('Colaborador'); setLocationInput(''); setStatusInput('Ativo'); setPinInput('0000'); }, [activeTenant.id]);
  useEffect(() => { writeUsers(activeTenant.id, users); }, [activeTenant.id, users]);
  const startEdit = (i) => { const u = users[i]; setEditingIndex(i); setNameInput(u.name); setRoleInput(u.role); setLocationInput(u.location ?? ''); setStatusInput(u.status ?? 'Ativo'); setPinInput(u.pin ?? '0000'); };
  const cancelEdit = () => { setEditingIndex(null); setNameInput(''); setRoleInput('Colaborador'); setLocationInput(''); setStatusInput('Ativo'); setPinInput('0000'); };
  const saveUser = () => {
    if (!nameInput.trim()) return;
    const user = { name: nameInput.trim(), role: roleInput, location: locationInput.trim(), status: statusInput, pin: pinInput || '0000' };
    setUsers((prev) => editingIndex === null ? [...prev, user] : prev.map((u, i) => i === editingIndex ? user : u));
    cancelEdit();
  };
  const removeUser = (i) => { if (!window.confirm(`Remover "${users[i]?.name}"?`)) return; setUsers((prev) => prev.filter((_, idx) => idx !== i)); if (editingIndex === i) cancelEdit(); };
  const filtered = users.filter((u) => { const q = search.toLowerCase(); return (!q || u.name.toLowerCase().includes(q) || (u.location ?? '').toLowerCase().includes(q)) && (roleFilter === 'Todos' || u.role === roleFilter); }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Cadastro</span><h1>Usuários</h1><p className="muted">Gerencie os usuários por empresa. Aparecem no login e na trilha de auditoria.</p></div><div className="page-actions"><span className="badge subtle">{activeTenant.name}</span></div></div>
      <div className="audit-stats" style={{ marginBottom: 16 }}>{roles.map((r) => (<div key={r} className="audit-stat"><span>{r}</span><strong>{users.filter((u) => u.role === r).length}</strong></div>))}</div>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">{editingIndex === null ? 'Novo' : 'Editando'}</span><h2>{editingIndex === null ? 'Cadastrar usuário' : users[editingIndex]?.name}</h2></div><span className="badge neutral">{users.length}</span></div>
          <div className="capture-fields">
            <label>Empresa<select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)}>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Nome completo<input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Nome do usuário" />
              {loginHandle(nameInput, activeTenant.id) && (
                <span style={{ fontSize:12, color:'var(--text-secondary)', marginTop:4, display:'block' }}>
                  Vai logar como: <strong style={{ fontFamily:'var(--mono)', color:'var(--primary)' }}>{loginHandle(nameInput, activeTenant.id)}</strong> + PIN
                </span>
              )}
            </label>
            <label>Perfil<select value={roleInput} onChange={(e) => setRoleInput(e.target.value)}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label>Localização / unidade<input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder="Ex.: Loja 1, Produção" /></label>
            <label>Status<select value={statusInput} onChange={(e) => setStatusInput(e.target.value)}><option value="Ativo">Ativo</option><option value="Inativo">Inativo</option><option value="Pendente">Pendente</option></select></label>
            <label>PIN de acesso (4–6 dígitos)
              <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="0000" inputMode="numeric" style={{ letterSpacing:'0.2em', fontFamily:'var(--mono)' }} />
            </label>
            <div className="actions-row">
              {editingIndex !== null && <button className="secondary-action" onClick={cancelEdit}>Cancelar</button>}
              <button className="primary-action" onClick={saveUser}>{editingIndex === null ? 'Adicionar' : 'Salvar alteração'}</button>
            </div>
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Lista</span><h2>Usuários cadastrados</h2></div><span className="badge neutral">{filtered.length}/{users.length}</span></div>
          <div className="capture-fields equipment-filters">
            <label>Buscar<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou localização" /></label>
            <label>Perfil<select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>{['Todos', ...roles].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          </div>
          <div className="equipment-maintenance-list">
            {filtered.length === 0 ? <p className="muted" style={{ padding: '16px 20px' }}>Nenhum usuário encontrado.</p>
              : filtered.map((u) => { const ri = users.indexOf(u);
                  // Handle de login (primeiro nome sem acento @ id do tenant) —
                  // é o que o cliente digita pra entrar. Ex.: iuana@backerei.
                  const handle = loginHandle(u.name, activeTenant.id);
                  return (
                <div key={`${u.name}-${ri}`} className={`equipment-maintenance-row user-row ${editingIndex === ri ? 'editing' : ''}`}>
                  <div>
                    <strong>{u.name}</strong>
                    <span>{u.role} · {u.location || 'Sem localização'}</span>
                    <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-secondary)', display:'block', marginTop:2 }}>{handle}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${u.status === 'Ativo' ? 'ok' : u.status === 'Pendente' ? 'warn' : 'neutral'}`}>{u.status}</span>
                    <div className="equipment-row-actions">
                      <button className="ghost-action" style={{ fontSize:11 }} onClick={() => {
                        const newPin = window.prompt(`Novo PIN para ${u.name} (4-6 dígitos):`);
                        if (!newPin || !/^\d{4,6}$/.test(newPin)) { if (newPin !== null) alert('PIN inválido. Use 4 a 6 dígitos numéricos.'); return; }
                        setUsers(prev => prev.map((usr, idx) => idx === ri ? { ...usr, pin: newPin } : usr));
                      }}>🔑 PIN</button>
                      <button className="ghost-action" onClick={() => startEdit(ri)}>Editar</button>
                      <button className="ghost-action danger" onClick={() => removeUser(ri)}>Remover</button>
                    </div>
                  </div>
                </div>
              ); })}
          </div>
        </article>
      </div>
    </section>
  );
}
