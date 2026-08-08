// ─────────────────────────────────────────────────────────────────────────────
// Seletor de operador — "quem está registrando agora".
//
// Usado pela conta de LOJA (aparelho compartilhado do balcão). A pessoa toca no
// próprio nome e todos os registros seguintes saem carimbados com ele, até
// expirar (ver operator.js) ou alguém trocar. É a atribuição que a RDC 216
// espera; a autenticação fica por conta da sessão da loja.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { readOperator, writeOperator, storeLabel } from './operator';

const usersKey = (id) => `nutriops.users.${id}`;

// Lista de nomes da equipe da loja. Sem credencial: entrou alguém = mais um
// nome; saiu = tira o nome. É o que mata a dor de rotatividade.
export function readStaff(tenant) {
  try {
    const raw = localStorage.getItem(usersKey(tenant?.id));
    const list = raw ? JSON.parse(raw) : (tenant?.usersList ?? []);
    return (Array.isArray(list) ? list : [])
      .filter((u) => u?.name && u.status !== 'Inativo')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  } catch { return []; }
}

// `required` = trava a tela (abertura do turno). Sem ele, é troca voluntária e
// dá pra cancelar.
export function OperatorPicker({ tenant, onPick, onCancel, required = false }) {
  const staff = useMemo(() => readStaff(tenant), [tenant]);
  const [busca, setBusca] = useState('');
  const [manual, setManual] = useState('');   // saída quando a equipe não está cadastrada
  const filtrados = busca.trim()
    ? staff.filter((u) => u.name.toLowerCase().includes(busca.trim().toLowerCase()))
    : staff;

  const escolher = (nome) => { writeOperator(tenant.id, nome); onPick?.(nome); };

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:1200,
      background:'rgba(0,30,43,.72)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
    }}>
      <div style={{
        background:'var(--surface)', borderRadius:'var(--r-xl)', width:'100%', maxWidth:520,
        maxHeight:'86vh', display:'flex', flexDirection:'column',
        boxShadow:'var(--shadow-lg)', padding:24,
      }}>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--text-secondary)' }}>
            {storeLabel({ storeName: tenant?.name })}
          </div>
          <h2 style={{ fontFamily:'var(--serif)', fontSize:26, fontWeight:400, letterSpacing:'-.02em', color:'var(--text)', margin:'2px 0 4px' }}>
            Quem está registrando?
          </h2>
          <p style={{ fontSize:13, color:'var(--text-secondary)' }}>
            Toque no seu nome. Ele fica identificado em cada registro que você fizer.
          </p>
        </div>

        {staff.length > 8 && (
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome…"
            style={{ marginBottom:12, padding:'10px 14px', borderRadius:'var(--r)', border:'1px solid var(--border)', fontSize:15, fontFamily:'var(--font)' }} />
        )}

        <div style={{ flex:1, minHeight:0, overflowY:'auto', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:10 }}>
          {filtrados.length === 0 ? (
            // Lista vazia com `required` era uma tela SEM SAÍDA: o gate exige
            // operador, não há nome pra tocar e não existe Cancelar. O turno
            // não abria. Digitar o nome destrava — a atribuição da RDC 216
            // continua garantida, e a lista se enche depois pelo cadastro.
            <div style={{ gridColumn:'1/-1', padding:'12px 0' }}>
              <p className="muted" style={{ fontSize:13, marginBottom:12 }}>
                {staff.length === 0
                  ? 'A equipe desta loja ainda não foi cadastrada. Digite seu nome pra continuar — o responsável cadastra a equipe depois em Equipe › Usuários.'
                  : 'Nenhum nome encontrado. Confira a busca ou digite seu nome completo.'}
              </p>
              <input value={manual} onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) escolher(manual.trim()); }}
                placeholder="Seu nome completo"
                style={{ width:'100%', padding:'12px 14px', borderRadius:'var(--r)', border:'1px solid var(--border)', fontSize:15, fontFamily:'var(--font)', marginBottom:10 }} />
              <button className="primary-action" disabled={!manual.trim()} style={{ width:'100%' }}
                onClick={() => escolher(manual.trim())}>Continuar como {manual.trim() || '…'}</button>
            </div>
          ) : filtrados.map((u) => (
            <button key={u.name} onClick={() => escolher(u.name)}
              style={{
                padding:'16px 14px', borderRadius:'var(--r-lg)',
                border:'1px solid var(--border)', background:'var(--surface)',
                cursor:'pointer', fontFamily:'var(--font)', textAlign:'left',
                display:'flex', flexDirection:'column', gap:3, transition:'all .12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'var(--surface-muted)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}>
              <span style={{ fontSize:15, fontWeight:600, color:'var(--text)' }}>{u.name}</span>
              <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{u.role}</span>
            </button>
          ))}
        </div>

        {!required && (
          <div style={{ marginTop:16, display:'flex', justifyContent:'flex-end' }}>
            <button onClick={onCancel}
              style={{ padding:'10px 18px', borderRadius:'var(--r)', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'var(--font)' }}>
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Chip no rail: mostra quem está registrando e troca em 1 toque.
export function OperatorChip({ tenantId, onChange }) {
  const atual = readOperator(tenantId);
  return (
    <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--rail-border)' }}>
      <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--rail-muted)', marginBottom:4 }}>
        Registrando como
      </div>
      <button onClick={onChange}
        style={{
          width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
          padding:'8px 10px', borderRadius:8, cursor:'pointer', fontFamily:'var(--font)',
          border:`1px solid ${atual ? 'var(--accent)' : 'var(--red-border, #ff8182)'}`,
          background: atual ? 'rgba(0,237,100,.10)' : 'rgba(255,129,130,.12)',
          color: atual ? 'var(--rail-text)' : '#ffd7d7',
        }}>
        <span style={{ fontSize:13, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {atual?.name ?? 'Escolher quem está registrando'}
        </span>
        <span style={{ fontSize:11, opacity:.75, flexShrink:0 }}>trocar</span>
      </button>
    </div>
  );
}
