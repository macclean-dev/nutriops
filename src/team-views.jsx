import React, { useState, useEffect } from 'react';
import { loginHandle } from './user-match';
import { writePinOverride, isWeakPin } from './pin';
import { isSupabaseEnabled as supabaseEnabled } from './repository';
import { isGlobalAdmin } from './permissions';
import { readTurns, writeTurns } from './turns';

const catalogKey = (id) => `nutriops.equipment.catalog.${id}`;
const usersKey   = (id) => `nutriops.users.${id}`;
const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

const readEquipmentCatalog = (t) => load(catalogKey(t.id), t.equipmentCatalog ?? []);
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

export function UsersView({ activeTenant, allTenants, onTenantChange, session }) {
  const [users, setUsers]                 = useState(() => readUsers(activeTenant));
  const [nameInput, setNameInput]         = useState('');
  const [roleInput, setRoleInput]         = useState('Colaborador');
  const [locationInput, setLocationInput] = useState('');
  const [statusInput, setStatusInput]     = useState('Ativo');
  const [editingIndex, setEditingIndex]   = useState(null);
  const [search, setSearch]               = useState('');
  const [roleFilter, setRoleFilter]       = useState('Todos');
  const [pinInput, setPinInput] = useState('0000');
  // Convite por e-mail (Fase 3) — cria conta com senha inicial via Edge Function.
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName]   = useState('');
  const [invPwd, setInvPwd]     = useState('');
  const [invRole, setInvRole]   = useState('Colaborador');
  const [invStoreAccount, setInvStoreAccount] = useState(false);
  const [invMsg, setInvMsg]     = useState(null);
  const [inviting, setInviting] = useState(false);
  // Só quem administra a loja convida; e só faz sentido com o Supabase ligado.
  const canInvite = supabaseEnabled() && ['Administrador','Super-admin','Nutricionista RT'].includes(session?.user?.role);
  // "Conta de loja" (Fase 4 — operador por registro) é decisão estrutural, não
  // um convite comum — só o admin da PLATAFORMA cria. Um tenant_admin convida
  // pessoas normalmente; a conta compartilhada do balcão nasce uma vez, com
  // supervisão de quem enxerga todas as lojas.
  const canCreateStoreAccount = isGlobalAdmin(session);
  // Loja do modelo E-MAIL (nuvem/membership) — ex.: CASA DOCE. Aqui o acesso é
  // por e-mail/senha, então o cadastro por PIN e o handle "nome@id" não fazem
  // sentido (o id da loja é feio: nome@bf245c3b-2f9). Seeds (Swiss/Bäckerei/DBK)
  // não têm essas flags → seguem com PIN até a Fase 4.
  const emailModel = Boolean(activeTenant?._fromMembership || activeTenant?._fromCloud);
  // Modelo e-mail: a "lista de usuários" são os MEMBROS da nuvem (tenant_members
  // + auth), não a lista local de PINs. Convidados por e-mail vivem lá.
  // Carrega pra QUALQUER tenant com convite habilitado — não só emailModel
  // (CASA DOCE): loja-seed (Swiss/Bäckerei/DBK) também ganha membros por
  // e-mail desde a Fase 4 (conta de loja + Fran/Ana Paula multi-loja), e sem
  // isso não existe UI pra redefinir a senha delas depois de criadas.
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const loadMembers = () => {
    if (!canInvite) return;
    setLoadingMembers(true);
    import('./tenant-sync')
      .then(m => m.fetchTenantMembers(activeTenant.id))
      .then(list => { setMembers(Array.isArray(list) ? list : []); setLoadingMembers(false); })
      .catch(() => setLoadingMembers(false));
  };
  useEffect(() => { setMembers([]); loadMembers(); /* eslint-disable-next-line */ }, [canInvite, activeTenant.id]);

  const handleInvite = async () => {
    setInvMsg(null);
    const email = invEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setInvMsg({ tone:'danger', text:'E-mail inválido.' }); return; }
    if (invPwd.length < 8) { setInvMsg({ tone:'danger', text:'A senha inicial precisa de no mínimo 8 caracteres.' }); return; }
    setInviting(true);
    try {
      const { inviteCollaborator } = await import('./auth');
      const isStoreAccount = canCreateStoreAccount && invStoreAccount;
      await inviteCollaborator({ email, name: invName.trim(), role: invRole, tenantId: activeTenant.id, password: invPwd, isStoreAccount });
      setInvMsg({ tone:'ok', text: isStoreAccount
        ? `✓ Conta de loja "${invName.trim() || activeTenant.name}" criada. Quem for registrar entra com este e-mail e escolhe o próprio nome na hora.`
        : `✓ ${email} convidado. Entra com o e-mail + a senha inicial e troca depois.` });
      setInvEmail(''); setInvName(''); setInvPwd(''); setInvStoreAccount(false);
      loadMembers(); // recarrega a lista pra o convidado aparecer na hora
    } catch (e) {
      setInvMsg({ tone:'danger', text: e.message });
    }
    setInviting(false);
  };
  const [resettingId, setResettingId] = useState(null);
  const resetPasswordFor = async (m) => {
    const newPwd = window.prompt(`Nova senha para ${m.name} (mín. 8 caracteres):`);
    if (newPwd === null) return; // cancelou
    if (newPwd.length < 8) { alert('A senha precisa de no mínimo 8 caracteres.'); return; }
    setResettingId(m.userId);
    try {
      const { resetCollaboratorPassword } = await import('./auth');
      await resetCollaboratorPassword({ userId: m.userId, tenantId: activeTenant.id, password: newPwd });
      alert(`Senha de ${m.name} redefinida. Combine a nova senha com a pessoa por um canal separado (WhatsApp/pessoalmente).`);
    } catch (e) {
      alert(e.message);
    }
    setResettingId(null);
  };
  const roles = ['Colaborador', 'Supervisor', 'Nutricionista RT', 'Administrador'];
  // De QUAL loja é a lista em memória. Sem esta marcação, o efeito de escrita
  // (que tem activeTenant.id nas deps) rodava no render da TROCA de empresa —
  // id novo, `users` ainda da loja anterior — e gravava a equipe (com PIN!) de
  // uma loja sob a chave da outra. Mesma classe do bug do catálogo de
  // equipamentos (v1.9.71), e agora mais grave: esta lista sincroniza pra
  // nuvem, então a contaminação sairia do aparelho. Precisa ser state, não ref
  // (com ref o efeito leria o valor já atualizado e a checagem passaria).
  const [usersTenant, setUsersTenant] = useState(activeTenant.id);
  useEffect(() => {
    setUsers(readUsers(activeTenant)); setUsersTenant(activeTenant.id);
    setEditingIndex(null); setNameInput(''); setRoleInput('Colaborador'); setLocationInput(''); setStatusInput('Ativo'); setPinInput('0000');
  }, [activeTenant.id]);
  useEffect(() => {
    if (usersTenant !== activeTenant.id) return; // troca de loja em andamento
    writeUsers(activeTenant.id, users);
  }, [activeTenant.id, usersTenant, users]);
  // Na edição o campo PIN começa VAZIO = "manter o atual" — não prefill com o
  // pin de fábrica (que não é o PIN real de quem já resetou no 1º login) pra não
  // sobrescrever sem querer ao salvar outra coisa.
  const startEdit = (i) => { const u = users[i]; setEditingIndex(i); setNameInput(u.name); setRoleInput(u.role); setLocationInput(u.location ?? ''); setStatusInput(u.status ?? 'Ativo'); setPinInput(''); };
  const cancelEdit = () => { setEditingIndex(null); setNameInput(''); setRoleInput('Colaborador'); setLocationInput(''); setStatusInput('Ativo'); setPinInput('0000'); };
  const saveUser = () => {
    if (!nameInput.trim()) return;
    const isEditing = editingIndex !== null;
    const trimmedName = nameInput.trim();
    // Novo usuário: pinInput é o PIN de FÁBRICA (troca obrigatória no 1º login),
    // então 0000 é aceitável de propósito. Edição com campo preenchido = reset
    // explícito → vai pro OVERRIDE (o que o login lê), com veto a PIN fraco.
    if (isEditing && pinInput) {
      if (!/^\d{4,6}$/.test(pinInput)) { alert('PIN inválido. Use 4 a 6 dígitos.'); return; }
      if (isWeakPin(pinInput)) { alert('PIN muito fácil (ex.: 0000, 1234). Escolha outra combinação.'); return; }
    }
    const factoryPin = isEditing ? (users[editingIndex].pin ?? '0000') : (pinInput || '0000');
    const user = { name: trimmedName, role: roleInput, location: locationInput.trim(), status: statusInput, pin: factoryPin };
    setUsers((prev) => isEditing ? prev.map((u, i) => i === editingIndex ? user : u) : [...prev, user]);
    if (isEditing && pinInput) writePinOverride(activeTenant.id, trimmedName, pinInput);
    // Sobe pra nuvem (sem o PIN — ver staffToRow) pra o tablet da loja enxergar
    // quem o gerente cadastrou aqui. Se editou e mudou o nome, a linha antiga
    // fica órfã na nuvem (chave é tenant_id+name) → apaga a anterior.
    const nomeAntigo = isEditing ? users[editingIndex]?.name : null;
    import('./repository').then(m => {
      if (nomeAntigo && nomeAntigo !== trimmedName) m.deleteStaffMember(activeTenant.id, nomeAntigo).catch(() => {});
      m.pushStaffMember(activeTenant.id, user);
    }).catch(() => {});
    cancelEdit();
  };
  const removeUser = (i) => {
    const alvo = users[i];
    if (!window.confirm(`Remover "${alvo?.name}"?`)) return;
    setUsers((prev) => prev.filter((_, idx) => idx !== i));
    if (editingIndex === i) cancelEdit();
    if (alvo?.name) import('./repository').then(m => m.deleteStaffMember(activeTenant.id, alvo.name)).catch(() => {});
  };
  const filtered = users.filter((u) => { const q = search.toLowerCase(); return (!q || u.name.toLowerCase().includes(q) || (u.location ?? '').toLowerCase().includes(q)) && (roleFilter === 'Todos' || u.role === roleFilter); }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Cadastro</span><h1>Usuários</h1><p className="muted">Gerencie os usuários por empresa. Aparecem no login e na trilha de auditoria.</p></div><div className="page-actions"><span className="badge subtle">{activeTenant.name}</span></div></div>

      {canInvite && (
        <article className="management-card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div><span className="eyebrow">Acesso por e-mail</span><h2>Convidar colaborador</h2></div></div>
          <div className="capture-fields">
            <p className="muted" style={{ fontSize:12 }}>
              O colaborador entra com o <strong>e-mail + esta senha</strong> e pode trocá-la depois.
              Cada pessoa com login próprio = quem registrou fica identificado (rastreabilidade RDC 216).
            </p>
            <label>E-mail<input type="email" value={invEmail} onChange={(e)=>setInvEmail(e.target.value)} placeholder="email@colaborador.com" /></label>
            <label>Nome (opcional)<input value={invName} onChange={(e)=>setInvName(e.target.value)} placeholder="Nome do colaborador" /></label>
            <label>Senha inicial (mín. 8 caracteres)<input type="text" value={invPwd} onChange={(e)=>setInvPwd(e.target.value)} placeholder="senha provisória" autoComplete="off" /></label>
            <label>Perfil<select value={invRole} onChange={(e)=>setInvRole(e.target.value)}>
              <option value="Colaborador">Colaborador</option>
              <option value="Supervisor">Supervisor</option>
              <option value="Nutricionista RT">Nutricionista RT</option>
              <option value="tenant_admin">Administrador da loja</option>
            </select></label>
            {canCreateStoreAccount && (
              <label style={{ flexDirection:'row', alignItems:'flex-start', gap:8 }}>
                <input type="checkbox" checked={invStoreAccount} onChange={(e)=>setInvStoreAccount(e.target.checked)} style={{ marginTop:3 }} />
                <span>
                  <strong>É conta de loja</strong> (login compartilhado do aparelho do balcão)
                  <br /><span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                    Sem operador fixo — cada pessoa toca no próprio nome pra registrar. Use "Nome" pro nome da loja (ex.: "{activeTenant.name}").
                  </span>
                </span>
              </label>
            )}
            {invMsg && <p style={{ fontSize:13, fontWeight:600, color: invMsg.tone==='ok' ? 'var(--green)' : 'var(--red)' }}>{invMsg.text}</p>}
            <div className="actions-row">
              <button className="primary-action" onClick={handleInvite} disabled={inviting || !invEmail || !invPwd}>{inviting ? 'Convidando…' : 'Adicionar colaborador'}</button>
            </div>
          </div>
        </article>
      )}
      <div className="audit-stats" style={{ marginBottom: 16 }}>{roles.map((r) => (<div key={r} className="audit-stat"><span>{r}</span><strong>{users.filter((u) => u.role === r).length}</strong></div>))}</div>
      <div className="management-grid">
        {/* Esta lista serve a DOIS propósitos e por isso vale pra TODA loja:
            (1) login por PIN, só nas lojas-seed; (2) os nomes da tela "Quem
            está registrando?" (Fase 4), que existe em qualquer loja com conta
            compartilhada — inclusive as do modelo e-mail.
            Estava escondida quando emailModel, então na CASA DOCE não havia
            NENHUM jeito de cadastrar a equipe e o seletor de operador abria
            vazio. O que é específico de PIN (campo do PIN, handle nome@id,
            botão de reset) segue oculto ali — só o cadastro de NOME é comum. */}
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">{editingIndex === null ? 'Novo' : 'Editando'}</span><h2>{editingIndex === null ? 'Cadastrar pessoa da equipe' : users[editingIndex]?.name}</h2></div><span className="badge neutral">{users.length}</span></div>
          <div className="capture-fields">
            {emailModel && (
              <p className="muted" style={{ fontSize:12, margin:0 }}>
                Estes nomes aparecem na tela <strong>“Quem está registrando?”</strong> — quem abre o aparelho toca no próprio nome e fica identificado em cada registro. Não é login: quem precisa entrar sozinho recebe convite por e-mail acima.
              </p>
            )}
            <label>Empresa<select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)}>{allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Nome completo<input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Nome do usuário" />
              {!emailModel && loginHandle(nameInput, activeTenant.id) && (
                <span style={{ fontSize:12, color:'var(--text-secondary)', marginTop:4, display:'block' }}>
                  Vai logar como: <strong style={{ fontFamily:'var(--mono)', color:'var(--primary)' }}>{loginHandle(nameInput, activeTenant.id)}</strong> + PIN
                </span>
              )}
            </label>
            <label>Perfil<select value={roleInput} onChange={(e) => setRoleInput(e.target.value)}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label>Localização / unidade<input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder="Ex.: Padaria, Confeitaria" /></label>
            <label>Status<select value={statusInput} onChange={(e) => setStatusInput(e.target.value)}><option value="Ativo">Ativo</option><option value="Inativo">Inativo</option><option value="Pendente">Pendente</option></select></label>
            {!emailModel && (
              <label>{editingIndex === null ? 'PIN de acesso (4–6 dígitos)' : 'Novo PIN (deixe em branco para manter)'}
                <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder={editingIndex === null ? '0000' : '••••'} inputMode="numeric" style={{ letterSpacing:'0.2em', fontFamily:'var(--mono)' }} />
              </label>
            )}
            <div className="actions-row">
              {editingIndex !== null && <button className="secondary-action" onClick={cancelEdit}>Cancelar</button>}
              <button className="primary-action" onClick={saveUser}>{editingIndex === null ? 'Adicionar' : 'Salvar alteração'}</button>
            </div>
          </div>
        </article>
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Lista</span><h2>Equipe cadastrada</h2></div><span className="badge neutral">{`${filtered.length}/${users.length}`}</span></div>
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
                    {!emailModel && <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-secondary)', display:'block', marginTop:2 }}>{handle}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${u.status === 'Ativo' ? 'ok' : u.status === 'Pendente' ? 'warn' : 'neutral'}`}>{u.status}</span>
                    <div className="equipment-row-actions">
                      {!emailModel && <button className="ghost-action" style={{ fontSize:11 }} onClick={() => {
                        const newPin = window.prompt(`Novo PIN para ${u.name} (4-6 dígitos):`);
                        if (!newPin || !/^\d{4,6}$/.test(newPin)) { if (newPin !== null) alert('PIN inválido. Use 4 a 6 dígitos numéricos.'); return; }
                        if (isWeakPin(newPin)) { alert('PIN muito fácil (ex.: 0000, 1234). Escolha outra combinação.'); return; }
                        // Grava o OVERRIDE — é o que o login lê (getEffectivePin).
                        // Antes gravava users[].pin (o PIN de fábrica), que o login
                        // ignora quando já existe override: reset silenciosamente
                        // sem efeito pra quem já logou uma vez.
                        writePinOverride(activeTenant.id, u.name, newPin);
                        setUsers(prev => prev.map((usr, idx) => idx === ri ? { ...usr, pin: newPin } : usr));
                        alert(`PIN de ${u.name} redefinido. Já vale no próximo login.`);
                      }}>🔑 PIN</button>}
                      <button className="ghost-action" onClick={() => startEdit(ri)}>Editar</button>
                      <button className="ghost-action danger" onClick={() => removeUser(ri)}>Remover</button>
                    </div>
                  </div>
                </div>
              ); })}
          </div>
        </article>
      </div>
      {/* Colaboradores por e-mail — pra QUALQUER tenant (loja-seed inclusive,
          desde a Fase 4: conta de loja + Fran/Ana Paula multi-loja). Sem este
          card não existe UI pra ver/redefinir a senha dessas contas depois de
          criadas — o convite acima só cria, não gerencia. */}
      {canInvite && (
        <article className="management-card" style={{ marginTop: 16 }}>
          <div className="card-head"><div><span className="eyebrow">Acesso por e-mail</span><h2>Colaboradores por e-mail</h2></div><span className="badge neutral">{members.length}</span></div>
          <div className="equipment-maintenance-list">
            {loadingMembers ? <p className="muted" style={{ padding:'16px 20px' }}>Carregando…</p>
              : members.length === 0 ? <p className="muted" style={{ padding:'16px 20px' }}>Nenhum colaborador convidado ainda. Use "Convidar colaborador" acima.</p>
              : members.map((m) => (
                <div key={m.userId} className="equipment-maintenance-row user-row">
                  <div>
                    <strong>{m.name}</strong>
                    <span>{m.role} · {m.email}</span>
                    <span style={{ fontSize:11, color:'var(--text-secondary)', display:'block', marginTop:2 }}>
                      {m.lastSignInAt ? `Último acesso: ${new Date(m.lastSignInAt).toLocaleString('pt-BR')}` : 'convidado — ainda não entrou'}
                    </span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className="badge ok">Ativo</span>
                    <button className="ghost-action" style={{ fontSize:11 }} disabled={resettingId === m.userId}
                      title="Define uma nova senha pra essa pessoa (esqueceu a atual, por exemplo)."
                      onClick={() => resetPasswordFor(m)}>
                      {resettingId === m.userId ? 'Redefinindo…' : 'Redefinir senha'}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </article>
      )}
    </section>
  );
}
