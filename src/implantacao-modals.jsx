import React, { useEffect, useState } from 'react';
import { PERIODICIDADES, problemasDaNovaPlanilha } from './implantacao';
import { FREQUENCIAS } from './form-prefs';

// ─────────────────────────────────────────────────────────────────────────────
// Telas da implantação sem desenvolvedor (implantacao.js, 10/10). Só montam o
// pedido e chamam quem grava; a regra mora no módulo puro.
// ─────────────────────────────────────────────────────────────────────────────

const fundo = { position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:16 };
const caixa = { width:'100%', maxWidth:560, maxHeight:'88vh', display:'flex', flexDirection:'column' };

// ─── Nova planilha ──────────────────────────────────────────────────────────
// `abas`: [[id, rótulo]] das abas desta loja. `setores`: setores que já
// existem na Higienização (dá para digitar um novo).
export function NovaPlanilhaModal({ abas, setores = [], onCriar, onClose }) {
  const [titulo, setTitulo] = useState('');
  const [aba, setAba] = useState(abas[0]?.[0] ?? '');
  const [setor, setSetor] = useState('');
  const [frequencia, setFrequencia] = useState('weekly');
  const [tarefas, setTarefas] = useState([]);
  const [nome, setNome] = useState('');
  const [per, setPer] = useState('weekly');
  const [tentou, setTentou] = useState(false);

  const problemas = problemasDaNovaPlanilha({ titulo, aba, setor, tarefas });
  const add = () => {
    const t = nome.trim();
    if (!t) return;
    setTarefas((prev) => [...prev, { nome: t, per }]);
    setNome('');
  };
  const temAlgo = Boolean(titulo.trim() || tarefas.length);
  const cancelar = () => {
    if (temAlgo && !window.confirm('Sair sem criar? O que foi preenchido será perdido.')) return;
    onClose();
  };
  const criar = () => {
    setTentou(true);
    if (problemas.length) return;
    onCriar({ titulo, aba, setor, frequencia, tarefas });
  };

  return (
    <div style={fundo}>
      <div className="management-card" style={caixa}>
        <div className="card-head"><div><span className="eyebrow">Planilhas BPF</span><h2>Nova planilha</h2></div></div>
        <div className="capture-fields" style={{ overflowY:'auto', flex:1, minHeight:0 }}>
          <label>Nome da planilha
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Limpeza da câmara fria" />
          </label>
          <div className="grid-2">
            <label>Aba
              <select value={aba} onChange={(e) => setAba(e.target.value)}>
                {abas.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
              </select>
            </label>
            <label>Uma folha por
              <select value={frequencia} onChange={(e) => setFrequencia(e.target.value)}>
                {FREQUENCIAS.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
              </select>
            </label>
          </div>
          {aba === 'higienizacao' && (
            <label>Setor
              <input list="nova-planilha-setores" value={setor} onChange={(e) => setSetor(e.target.value)} placeholder="Escolha ou digite o setor" />
              <datalist id="nova-planilha-setores">{setores.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
          )}
          <div style={{ borderTop:'1px solid var(--border-subtle)', paddingTop:12 }}>
            <strong style={{ fontSize:13 }}>Tarefas</strong>
            <p className="muted" style={{ fontSize:12, margin:'4px 0 8px' }}>Cada tarefa é registrada com data e assinatura de quem fez.</p>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <input aria-label="Nova tarefa" value={nome} onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                placeholder="Ex.: Paredes e piso" style={{ flex:'1 1 200px', minWidth:0 }} />
              <select aria-label="Periodicidade da tarefa" value={per} onChange={(e) => setPer(e.target.value)} style={{ width:'auto' }}>
                {PERIODICIDADES.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
              </select>
              <button className="secondary-action" onClick={add} disabled={!nome.trim()}>Adicionar</button>
            </div>
            {tarefas.length > 0 && (
              <div className="equipment-maintenance-list" style={{ marginTop:8 }}>
                {tarefas.map((t, i) => (
                  <div key={`${t.nome}-${i}`} className="equipment-maintenance-row">
                    <span>{t.nome} <span className="muted">({PERIODICIDADES.find(([id]) => id === t.per)?.[1]})</span></span>
                    <button className="ghost-action danger" style={{ fontSize:11 }} onClick={() => setTarefas((prev) => prev.filter((_, j) => j !== i))}>Remover</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="muted" style={{ fontSize:12 }}>A planilha já sai com o bloco de não conformidade, que alimenta a Central de NC.</p>
          {tentou && problemas.length > 0 && (
            <div role="alert" className="submission" style={{ background:'var(--amber-light)', borderColor:'var(--amber-border)', color:'var(--amber)', fontSize:12 }}>
              {problemas.map((p) => <div key={p}>{p}</div>)}
            </div>
          )}
        </div>
        <div className="actions-row" style={{ padding:'12px 20px' }}>
          <button className="secondary-action" onClick={cancelar}>Cancelar</button>
          <button className="primary-action attention" onClick={criar}>Criar planilha</button>
        </div>
      </div>
    </div>
  );
}

// ─── Copiar de outra loja ───────────────────────────────────────────────────
// Serve para planilhas e para equipamentos. `carregar(loja)` busca a lista da
// loja de origem (nuvem, senão o aparelho) e devolve
// { itens: [{ id, titulo, detalhe, repetido }] }. `onCopiar(loja, ids)` grava.
export function CopiarDeOutraLojaModal({ titulo, lojas, carregar, onCopiar, onClose, rotuloItem = 'item' }) {
  const [loja, setLoja] = useState(lojas[0]?.id ?? '');
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState(null);
  const [marcados, setMarcados] = useState(() => new Set());
  const [copiando, setCopiando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setItens(null); setErro(null); setMarcados(new Set());
    const alvo = lojas.find((l) => l.id === loja);
    if (!alvo) return undefined;
    carregar(alvo)
      .then((r) => { if (vivo) { setItens(r.itens); setMarcados(new Set(r.itens.filter((i) => !i.repetido).map((i) => i.id))); } })
      .catch((e) => { if (vivo) setErro(e?.message ?? 'Não consegui carregar.'); });
    return () => { vivo = false; };
  }, [loja]);

  const alternar = (id) => setMarcados((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const copiar = async () => {
    const alvo = lojas.find((l) => l.id === loja);
    if (!alvo || marcados.size === 0) return;
    setCopiando(true);
    try { await onCopiar(alvo, [...marcados]); } finally { setCopiando(false); }
  };

  return (
    <div style={fundo}>
      <div className="management-card" style={caixa}>
        <div className="card-head"><div><span className="eyebrow">Implantação</span><h2>{titulo}</h2></div></div>
        <div className="capture-fields" style={{ overflowY:'auto', flex:1, minHeight:0 }}>
          <label>Copiar de
            <select value={loja} onChange={(e) => setLoja(e.target.value)}>
              {lojas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          {erro && <div role="alert" className="submission" style={{ fontSize:12 }}>{erro}</div>}
          {!erro && itens === null && <p className="muted">Carregando…</p>}
          {itens && itens.length === 0 && <p className="muted">Essa loja não tem nada para copiar.</p>}
          {itens && itens.length > 0 && (
            <div className="equipment-maintenance-list">
              {itens.map((i) => (
                <label key={i.id} className="equipment-maintenance-row" style={{ cursor: i.repetido ? 'default' : 'pointer', opacity: i.repetido ? 0.6 : 1 }}>
                  <span style={{ display:'flex', gap:10, alignItems:'center' }}>
                    <input type="checkbox" checked={marcados.has(i.id)} disabled={i.repetido} onChange={() => alternar(i.id)} />
                    <span style={{ display:'flex', flexDirection:'column' }}>
                      <strong style={{ fontSize:13 }}>{i.titulo}</strong>
                      {i.detalhe && <span className="muted" style={{ fontSize:12 }}>{i.detalhe}</span>}
                    </span>
                  </span>
                  {i.repetido && <span className="badge neutral">Já existe aqui</span>}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="actions-row" style={{ padding:'12px 20px' }}>
          <button className="secondary-action" onClick={onClose} disabled={copiando}>Cancelar</button>
          <button className="primary-action attention" onClick={copiar} disabled={copiando || marcados.size === 0}>
            {copiando ? 'Copiando…' : `Copiar ${marcados.size} ${rotuloItem}${marcados.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
