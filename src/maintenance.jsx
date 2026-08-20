import React, { useEffect, useMemo, useState } from 'react';
import { dedupeCatalog } from './limits';
// 16/08: manutenção era o ÚLTIMO módulo local-only da auditoria RDC (§3.15).
// Limpar o aparelho apagava o histórico que a RDC 216 §4.1 manda manter.
import { pushEquipAsset, pushMaintLog, pushWorkOrder, deleteMaintenanceItem , lw as gravarLocal } from './repository';
import { gravarMesclando, SYNC_EVENT } from './lista-local';

// ─── Storage ───────────────────────────────────────────────────────────────

const sk = (k, id) => `nutriops.${k}.${id}`;
const sl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
// Grava pelo `lw` do repositório em vez de engolir a falha: quando o
// localStorage enche, o setItem estoura e o app inteiro segue confirmando
// sucesso. O `lw` loga e levanta a bandeira que o banner de "armazenamento
// cheio" lê (v1.9.158) — este arquivo tinha a própria cópia muda do helper,
// e a bandeira nunca chegava aqui. Achado da auditoria (18/08).
const ss = (k, v) => gravarLocal(k, v);

// Filtra lixo sem nome — antes da v1.9.60, syncEquipmentCatalog gravava o
// catálogo de temperatura (shape {label,...}, sem `name`) nessa MESMA chave
// por um bug de EQ_KEY errado (ver repository.js). Devices que sincronizaram
// nessa janela ficaram com entradas fantasma (sem nome) que dobravam a
// contagem no merge com o catálogo — auto-repara ao ler, sem precisar de
// intervenção manual em cada device afetado.
export const readEquipments     = (id) => sl(sk('equip_assets', id), []).filter((e) => e && e.name);
export const writeEquipments    = (id, v) => ss(sk('equip_assets', id), v);
// Catálogo de temperatura (mesmo que a tela "Equipamentos" usa). A Manutenção
// mescla ele na lista pra você não recadastrar tudo — ver mergedEquipments.
export const readCatalog        = (t) => dedupeCatalog(sl(sk('equipment.catalog', t.id), t.equipmentCatalog ?? []));
// ⚠️ ORDENAR ANTES DE CORTAR. Estas listas crescem por APPEND
// (setLogs/setOrders fazem [...prev, novo]), então `slice(0, N)` guardava os
// MAIS VELHOS e descartava os novos — inclusive o que o sync acabou de trazer
// da nuvem. Terceira vez que este padrão aparece no projeto: o cache de
// temperatura teve o mesmo defeito nos dois ramos (v1.9.151 e v1.9.155).
// Achado da auditoria (18/08).
const maisNovoPrimeiro = (a, b) =>
  new Date(b?.createdAt ?? b?.executedAt ?? 0) - new Date(a?.createdAt ?? a?.executedAt ?? 0);
const cortarMantendoRecentes = (lista, teto) =>
  [...(Array.isArray(lista) ? lista : [])].sort(maisNovoPrimeiro).slice(0, teto);

export const readMaintenanceLogs = (id) => sl(sk('maint_logs', id), []);
export const writeMaintenanceLogs = (id, v) => ss(sk('maint_logs', id), cortarMantendoRecentes(v, 500));
export const readWorkOrders     = (id) => sl(sk('work_orders', id), []);
export const writeWorkOrders    = (id, v) => ss(sk('work_orders', id), cortarMantendoRecentes(v, 200));

function uid() { return crypto.randomUUID(); }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return '—'; } }
function fmtDT(iso)   { try { return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch { return '—'; } }

function addDays(iso, days) {
  const d = new Date(iso || new Date());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - new Date().setHours(0,0,0,0)) / 86400000);
}

function dueTone(days) {
  if (days === null) return 'neutral';
  if (days < 0)  return 'expired';
  if (days <= 7)  return 'danger';
  if (days <= 30) return 'warn';
  return 'ok';
}

function dueLabel(days) {
  if (days === null)  return '—';
  if (days < 0)       return `Atrasado ${Math.abs(days)}d`;
  if (days === 0)     return 'Vence hoje';
  if (days === 1)     return 'Amanhã';
  return `${days} dias`;
}

// Conta por PLANO (tarefa preventiva), não por equipamento — um equipamento
// com 4 tarefas vencidas é 4 aqui, não 1. É o mesmo critério que
// maintAlertCount (pages.jsx, badge do menu lateral) já usa somando planos
// com `days <= 7`; contar por equipamento fazia o card "Manutenções
// atrasadas" (badge, KPI "Atrasados/críticos" e badge da aba) mostrar "1" em
// cima de uma lista com 4 linhas, e discordar do "4" do menu lateral ao
// lado — dois números pra mesma coisa na mesma tela. Achado da auditoria
// (19/08).
export function countPlansByTone(equipmentsWithDue, tones) {
  return (equipmentsWithDue ?? []).reduce(
    (n, e) => n + (e.plans ?? []).filter((p) => tones.includes(p.tone)).length,
    0
  );
}

// Histórico e PDF de manutenção mostram por ordem de EXECUÇÃO, mais recente
// primeiro — não a ordem de inserção no array. O log local entra por prepend
// (mais novo no início — ver os onSave mais abaixo), mas o que o sync traz
// da nuvem é anexado no FIM (syncModule → mergeByKey([...local, ...remoto]),
// repository.js) sem reordenar por data. Sem este sort, uma execução feita
// HOJE em outro aparelho cai no fim da lista/do PDF, atrás de registros de
// meses atrás — quem confere pelo topo conclui que a equipe não registrou
// nada. Achado da auditoria (19/08).
export function sortLogsByExecution(logs) {
  return [...(Array.isArray(logs) ? logs : [])].sort(
    (a, b) => new Date(b?.executedAt ?? 0) - new Date(a?.executedAt ?? 0)
  );
}

export function printMaintenanceReport(activeTenant, equipments, logs, orders) {
  const p = (() => { try { const r = localStorage.getItem(`nutriops.company.profile.${activeTenant?.id}`); return r ? JSON.parse(r) : {}; } catch { return {}; } })();
  const date = new Date().toLocaleString('pt-BR');

  const equipRows = equipments.map(eq => {
    const plans = eq.maintenancePlans ?? [];
    const lastLog = logs.filter(l => l.equipmentId === eq.id).sort((a,b) => new Date(b.executedAt)-new Date(a.executedAt))[0];
    return `<tr>
      <td>${eq.name}</td>
      <td>${eq.location||'—'}</td>
      <td>${eq.brand||'—'} ${eq.model||''}</td>
      <td>${eq.status}</td>
      <td>${plans.length} tarefa${plans.length!==1?'s':''}</td>
      <td>${lastLog ? fmtDate(lastLog.executedAt) : 'Nunca'}</td>
    </tr>`;
  }).join('');

  // Corte em 100 pra não gerar um PDF gigante — mas precisa DIZER que cortou.
  // O cabeçalho (linha abaixo) anuncia `${logs.length} registros` (o TOTAL),
  // e sem aviso nenhum na seção a tabela para em 100 silenciosamente: um
  // relatório que diz "340 registros" e lista 100 linhas, sem "primeiros 100
  // de 340" em lugar nenhum. É o documento que vai pro fiscal. Achado da
  // auditoria (19/08).
  const logsOrdenados = sortLogsByExecution(logs);
  const logsTruncados = logsOrdenados.length > 100;
  const logRows = logsOrdenados.slice(0,100).map(l => {
    const eq = equipments.find(e=>e.id===l.equipmentId);
    const mt = MAINTENANCE_TYPES.find(t=>t.id===l.type);
    return `<tr><td>${fmtDate(l.executedAt)}</td><td>${eq?.name||'—'}</td><td>${mt?.label||l.type}</td><td>${l.title}</td><td>${l.executedBy}</td></tr>`;
  }).join('');

  const win = window.open('', '_blank');
  // window.open devolve null com pop-up bloqueado (padrão no Safari/iOS,
  // webview de app tipo WhatsApp/Instagram, tablet com bloqueador) — sem a
  // guarda, o write seguinte estourava TypeError dentro do onClick, sem
  // try/catch nem error boundary que pegue: o único sinal era o console
  // (ninguém olha isso num tablet), e pro usuário o botão "não fazia nada".
  // Mesma guarda que reports-views.jsx (printDashboard/exportPDF) e
  // dossie-view.jsx já usam. Achado da auditoria (19/08).
  if (!win) {
    window.alert('Não foi possível abrir a janela de impressão — o navegador pode estar bloqueando pop-ups. Libere pop-ups para este site e toque em "Exportar PDF" de novo.');
    return;
  }
  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>Relatório de Manutenção — ${activeTenant.name}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#1c2128;padding:20px}
  .company-header{display:flex;justify-content:space-between;padding:8px 12px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:4px;margin-bottom:12px}
  .company-name{font-size:13px;font-weight:800}.company-detail{font-size:9px;color:#656d76}
  h1{font-size:16px;font-weight:800;margin-bottom:4px}h2{font-size:12px;font-weight:700;margin:14px 0 6px;color:#0969da;padding-bottom:4px;border-bottom:1px solid #d0d7de}
  .meta{color:#656d76;font-size:9px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #d0d7de}
  table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#f6f8fa;padding:5px 8px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #d0d7de;color:#656d76}
  td{padding:5px 8px;border-bottom:1px solid #eaeef2;font-size:9px}
  .footer{margin-top:14px;padding-top:8px;border-top:1px solid #d0d7de;font-size:8px;color:#9198a1;display:flex;justify-content:space-between}
  @page{size:A4;margin:12mm}</style></head><body>
  <div class="company-header">
    <div><div class="company-name">${p.razaoSocial||activeTenant.name}</div>
    ${p.cnpj?`<div class="company-detail">CNPJ: ${p.cnpj}</div>`:''}
    ${p.endereco?`<div class="company-detail">${p.endereco}</div>`:''}</div>
    ${p.atividade?`<div style="font-size:10px;font-weight:700;color:#0969da">${p.atividade}</div>`:''}
  </div>
  <h1>Relatório de Manutenção de Equipamentos</h1>
  <p class="meta">${activeTenant.name} · Gerado em ${date} · ${equipments.length} equipamentos · ${logs.length} registros</p>
  <h2>Equipamentos cadastrados</h2>
  <table><thead><tr><th>Equipamento</th><th>Local</th><th>Marca/Modelo</th><th>Status</th><th>Planos</th><th>Última manutenção</th></tr></thead>
  <tbody>${equipRows||'<tr><td colspan="6">Nenhum equipamento</td></tr>'}</tbody></table>
  <h2>Histórico de execuções${logsTruncados ? ` — mostrando as 100 mais recentes de ${logs.length}` : ''}</h2>
  <table><thead><tr><th>Data</th><th>Equipamento</th><th>Tipo</th><th>Tarefa</th><th>Executado por</th></tr></thead>
  <tbody>${logRows||'<tr><td colspan="5">Sem registros</td></tr>'}</tbody></table>
  ${logsTruncados ? `<p style="font-size:9px;color:#9198a1;margin:-4px 0 8px">As demais ${logs.length-100} execuções não couberam neste PDF — consulte o histórico completo no app se precisar delas.</p>` : ''}
  <div class="footer"><span>NutriOPS · RDC 216/2004 · ${p.razaoSocial||activeTenant.name}</span>${p.rtNome?`<span>RT: ${p.rtNome}${p.rtCrn?` · ${p.rtCrn}`:''}</span>`:''}<span>${date}</span></div>
  </body></html>`);
  win.document.close();
  win.print();
}

const MAINTENANCE_TYPES = [
  { id: 'limpeza',      label: 'Limpeza',               icon: '🧹', color: '#0969da' },
  { id: 'inspecao',     label: 'Inspeção',              icon: '🔍', color: '#1a7f37' },
  { id: 'calibracao',   label: 'Calibração',            icon: '⚖️', color: '#9a6700' },
  { id: 'lubrificacao', label: 'Lubrificação',          icon: '🛢️', color: '#cf222e' },
  { id: 'troca',        label: 'Troca de componente',   icon: '🔧', color: '#7c3aed' },
  { id: 'preventiva',   label: 'Preventiva geral',      icon: '🔩', color: '#0891b2' },
  { id: 'corretiva',    label: 'Corretiva',             icon: '🚨', color: '#cf222e' },
  { id: 'outro',        label: 'Outro',                 icon: '📋', color: '#656d76' },
];

const FREQUENCY_OPTIONS = [
  { value: 7,   label: 'Semanal (7 dias)' },
  { value: 15,  label: 'Quinzenal (15 dias)' },
  { value: 30,  label: 'Mensal (30 dias)' },
  { value: 60,  label: 'Bimestral (60 dias)' },
  { value: 90,  label: 'Trimestral (90 dias)' },
  { value: 180, label: 'Semestral (180 dias)' },
  { value: 365, label: 'Anual (365 dias)' },
];

const EQUIPMENT_STATUS = ['Operacional', 'Em manutenção', 'Inativo', 'Aguardando peça'];

// 'cancelada' não é 'aberta'. O filtro velho só excluía 'concluida', então
// "OS abertas" (KPI, badge da aba, card do Painel) nunca baixava ao
// cancelar — o único jeito de sumir do contador era clicar "✓ Concluir", que
// grava uma execução como se o serviço tivesse sido FEITO (ver o auto-log
// logo abaixo) pra um serviço que na verdade foi cancelado: evidência falsa
// no histórico da RDC só pra "zerar" o contador. Achado da auditoria
// (19/08).
export const isOrderOpen = (o) => o.status !== 'concluida' && o.status !== 'cancelada';

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════

export function MaintenanceView({ activeTenant, allTenants, onTenantChange, session }) {
  const [equipments, setEquipments]   = useState(() => readEquipments(activeTenant.id));
  const [catalog, setCatalog]         = useState(() => readCatalog(activeTenant));
  const [logs, setLogs]               = useState(() => readMaintenanceLogs(activeTenant.id));
  const [orders, setOrders]           = useState(() => readWorkOrders(activeTenant.id));
  const [tab, setTab]                 = useState('dashboard');
  const [editEquip, setEditEquip]     = useState(null);  // null | {} | equipment
  const [editOrder, setEditOrder]     = useState(null);
  const [showLogModal, setShowLogModal] = useState(null); // equipment to log

  const isManager = ['Supervisor','Nutricionista RT','Administrador','Super-admin'].includes(session?.user?.role);

  useEffect(() => { setEquipments(readEquipments(activeTenant.id)); setCatalog(readCatalog(activeTenant)); setLogs(readMaintenanceLogs(activeTenant.id)); setOrders(readWorkOrders(activeTenant.id)); setTab('dashboard'); }, [activeTenant.id]);
  // Relê quando o sync avisa que terminou — mesma correção já aplicada aos 5
  // controles especiais, às planilhas e ao catálogo de temperatura (v1.9.154 e
  // 18/08). Sem isto, um aparelho novo ou recém-limpo (o caso da DBK Produção)
  // mostra "Nenhum equipamento cadastrado" / "Nenhuma ordem de serviço" /
  // "Nenhum registro ainda" nos primeiros segundos após o boot: o
  // doSync('boot') já gravou o acervo da nuvem no localStorage, mas esta tela
  // só lê no mount/troca de empresa e nunca relia depois. Não relê com um
  // modal aberto (equipamento, OS ou execução), pro sync não trocar a lista
  // sob os pés de quem está cadastrando. Achado da auditoria (19/08).
  useEffect(() => {
    if (editEquip !== null || editOrder !== null || showLogModal !== null) return;
    const reler = () => {
      setEquipments(readEquipments(activeTenant.id));
      setCatalog(readCatalog(activeTenant));
      setLogs(readMaintenanceLogs(activeTenant.id));
      setOrders(readWorkOrders(activeTenant.id));
    };
    window.addEventListener(SYNC_EVENT, reler);
    return () => window.removeEventListener(SYNC_EVENT, reler);
  }, [activeTenant, editEquip, editOrder, showLogModal]);
  useEffect(() => { writeEquipments(activeTenant.id, equipments); }, [activeTenant.id, equipments]);
  // Logs e OS gravam MESCLANDO com o que está no storage (não substituindo):
  // se a tela partiu de um retrato vazio/antigo (lido antes do sync
  // terminar), sobrescrever a lista inteira nesse instante apagaria o que o
  // sync acabou de trazer — mesma doença corrigida em controls.jsx/forms.jsx/
  // extras.jsx (lista-local.js). Só vale pra estas duas: equip_assets tem
  // exclusão pela UI (onDelete, abaixo) e a mescla ressuscitaria um ativo
  // removido, então esse continua com write direto.
  useEffect(() => { gravarMesclando(readMaintenanceLogs, writeMaintenanceLogs, activeTenant.id, logs); }, [activeTenant.id, logs]);
  useEffect(() => { gravarMesclando(readWorkOrders, writeWorkOrders, activeTenant.id, orders); }, [activeTenant.id, orders]);

  // Mescla os ativos de manutenção com o catálogo de temperatura: mostra os
  // equipamentos já cadastrados (Freezer, Refrigerador…) sem duplicar por nome.
  // Itens só-do-catálogo entram como "virtuais" (id cat-<label>, sem plano) e
  // viram ativo real quando você edita/salva. Ver onSave do EquipmentModal.
  const mergedEquipments = useMemo(() => {
    const norm = (s) => String(s ?? '').trim().toLowerCase();
    const assetNames = new Set(equipments.map((e) => norm(e.name)));
    const catalogOnly = catalog
      .filter((c) => c.label && !assetNames.has(norm(c.label)))
      .map((c) => ({ id: `cat-${c.label}`, name: c.label, location: c.location ?? '', status: 'Operacional', maintenancePlans: [], _fromCatalog: true }));
    return [...equipments, ...catalogOnly];
  }, [equipments, catalog]);

  // Compute next due dates from maintenance plans
  const equipmentsWithDue = useMemo(() => mergedEquipments.map(eq => {
    const plans = (eq.maintenancePlans ?? []).map(plan => {
      // Find last log for this plan
      const lastLog = logs
        .filter(l => l.equipmentId === eq.id && l.planId === plan.id)
        .sort((a,b) => new Date(b.executedAt) - new Date(a.executedAt))[0];
      const nextDue = lastLog
        ? addDays(lastLog.executedAt, plan.frequencyDays)
        : plan.nextDue ?? addDays(new Date().toISOString(), plan.frequencyDays);
      const days = daysUntil(nextDue);
      return { ...plan, nextDue, lastLog, days, tone: dueTone(days) };
    });
    const urgentPlan = plans.sort((a,b) => (a.days??999) - (b.days??999))[0];
    return { ...eq, plans, urgentPlan };
  }), [mergedEquipments, logs]);

  // KPIs
  const overdue  = countPlansByTone(equipmentsWithDue, ['expired', 'danger']);
  const due30    = countPlansByTone(equipmentsWithDue, ['warn']);
  const openOrders = orders.filter(isOrderOpen).length;

  // ── Dashboard ──────────────────────────────────────────────────────────

  const renderDashboard = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div className="audit-stats">
        <div className="audit-stat"><span>Equipamentos</span><strong>{mergedEquipments.length}</strong></div>
        <div className={`audit-stat ${overdue>0?'danger':'ok'}`}><span>Atrasados / críticos</span><strong>{overdue}</strong></div>
        <div className={`audit-stat ${due30>0?'warn':'ok'}`}><span>Vencem em 30 dias</span><strong>{due30}</strong></div>
        <div className={`audit-stat ${openOrders>0?'warn':'ok'}`}><span>OS abertas</span><strong>{openOrders}</strong></div>
      </div>

      {/* Urgent items */}
      {overdue > 0 && (
        <article className="management-card" style={{ borderColor:'var(--red-border)' }}>
          <div className="card-head" style={{ background:'var(--red-light)', borderBottomColor:'var(--red-border)' }}>
            <div><span className="eyebrow" style={{ color:'var(--red)' }}>Ação imediata</span><h2>Manutenções atrasadas ou vencendo em até 7 dias</h2></div>
            <span className="badge danger">{overdue}</span>
          </div>
          <div className="equipment-maintenance-list">
            {equipmentsWithDue.filter(e=>e.plans.some(p=>p.tone==='expired'||p.tone==='danger')).map(eq => (
              eq.plans.filter(p=>p.tone==='expired'||p.tone==='danger').map(plan => (
                <div key={`${eq.id}-${plan.id}`} className="equipment-maintenance-row" style={{ borderLeft:'3px solid var(--red-border)' }}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <strong>{eq.name}</strong>
                      <span className="badge neutral" style={{ fontSize:10 }}>{eq.location}</span>
                    </div>
                    <span>{MAINTENANCE_TYPES.find(t=>t.id===plan.type)?.icon} {plan.title}</span>
                    <span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                      Última execução: {plan.lastLog ? fmtDate(plan.lastLog.executedAt) : 'Nunca'}
                    </span>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:14, fontWeight:800, color:'var(--red)', fontFamily:'var(--mono)' }}>{dueLabel(plan.days)}</div>
                    <div style={{ display:'flex', gap:6, marginTop:4, justifyContent:'flex-end' }}>
                      <button className="primary-action" style={{ fontSize:11, padding:'4px 10px' }}
                        title="Marca essa manutenção como feita hoje e reinicia a contagem pro próximo vencimento."
                        onClick={() => setShowLogModal({ equipment: eq, plan })}>
                        ✓ Registrar
                      </button>
                      <button className="secondary-action" style={{ fontSize:11, padding:'4px 10px' }}
                        title="Abre uma ordem de serviço pra esse equipamento (ex.: chamar o técnico)."
                        onClick={() => setEditOrder({ equipmentId: eq.id })}>
                        + OS
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ))}
          </div>
        </article>
      )}

      {/* Upcoming 30 days */}
      {due30 > 0 && (
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Próximos 30 dias</span><h2>Manutenções programadas</h2></div></div>
          <div className="equipment-maintenance-list">
            {equipmentsWithDue.filter(e=>e.plans.some(p=>p.tone==='warn')).map(eq => (
              eq.plans.filter(p=>p.tone==='warn').map(plan => (
                <div key={`${eq.id}-${plan.id}`} className="equipment-maintenance-row">
                  <div>
                    <strong>{eq.name}</strong>
                    <span>{MAINTENANCE_TYPES.find(t=>t.id===plan.type)?.icon} {plan.title}</span>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <span style={{ fontSize:13, fontWeight:700, color:'var(--amber)', fontFamily:'var(--mono)' }}>{dueLabel(plan.days)}</span>
                    <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{fmtDate(plan.nextDue)}</div>
                  </div>
                </div>
              ))
            ))}
          </div>
        </article>
      )}

      {/* Open work orders */}
      {openOrders > 0 && (
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Ordens de serviço</span><h2>OS abertas</h2></div><span className="badge warn">{openOrders}</span></div>
          <div className="equipment-maintenance-list">
            {orders.filter(isOrderOpen).map(o => (
              <div key={o.id} className="equipment-maintenance-row">
                <div>
                  <strong>{o.title}</strong>
                  <span>{mergedEquipments.find(e=>e.id===o.equipmentId)?.name ?? '—'} · {o.type}</span>
                  <span style={{ fontSize:11, color:'var(--text-secondary)' }}>Aberta em {fmtDate(o.createdAt)} · {o.requestedBy}</span>
                </div>
                <div style={{ display:'flex', gap:6, flexDirection:'column', alignItems:'flex-end' }}>
                  <span className={`badge ${o.priority==='alta'?'danger':o.priority==='media'?'warn':'neutral'}`}>{o.priority}</span>
                  <span className="badge neutral" style={{ fontSize:10 }}>{o.status}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      )}

      {mergedEquipments.length === 0 && (
        <article className="management-card">
          <div style={{ padding:'40px 24px', textAlign:'center' }}>
            <p style={{ fontSize:32, marginBottom:12 }}>🔧</p>
            <h3 style={{ marginBottom:8 }}>Nenhum equipamento cadastrado</h3>
            <p className="muted" style={{ marginBottom:20 }}>Cadastre seus equipamentos para criar planos preventivos e ordens de serviço.</p>
            <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
              {isManager && <button className="primary-action" onClick={() => { setEditEquip({}); setTab('equipments'); }}>+ Cadastrar equipamento</button>}
              <button className="secondary-action" onClick={() => { setEditOrder({}); setTab('orders'); }}>📋 Abrir ordem de serviço</button>
            </div>
          </div>
        </article>
      )}
    </div>
  );

  // ── Equipment list ─────────────────────────────────────────────────────

  const renderEquipments = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {isManager && (
        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button className="primary-action" onClick={() => setEditEquip({})}>+ Novo equipamento</button>
        </div>
      )}
      {equipmentsWithDue.length === 0
        ? <article className="management-card"><p className="muted" style={{ padding:'24px' }}>Nenhum equipamento cadastrado.</p></article>
        : equipmentsWithDue.map(eq => {
          const urgentDays = eq.urgentPlan?.days;
          const tone = eq.urgentPlan ? dueTone(urgentDays) : 'ok';
          return (
            <article key={eq.id} className="management-card" style={{ borderLeft:`4px solid ${tone==='ok'?'var(--green)':tone==='expired'||tone==='danger'?'var(--red)':tone==='warn'?'var(--amber)':'var(--border)'}` }}>
              <div className="card-head">
                <div>
                  <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4 }}>
                    <h2 style={{ fontSize:16 }}>{eq.name}</h2>
                    <span className={`badge ${eq.status==='Operacional'?'ok':eq.status==='Em manutenção'?'warn':'neutral'}`} style={{ fontSize:10 }}>{eq.status}</span>
                    {eq._fromCatalog && <span className="badge neutral" style={{ fontSize:10 }} title="Veio do catálogo de temperatura. Edite pra criar um plano de manutenção.">do catálogo · sem plano</span>}
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-secondary)', display:'flex', gap:12 }}>
                    {eq.location && <span>📍 {eq.location}</span>}
                    {eq.brand && <span>🏭 {eq.brand} {eq.model}</span>}
                    {eq.serialNumber && <span>🔢 {eq.serialNumber}</span>}
                  </div>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <button className="secondary-action" style={{ fontSize:11 }}
                    title="Registra que a manutenção desse equipamento foi executada agora."
                    onClick={() => setShowLogModal({ equipment: eq })}>
                    ✓ Registrar
                  </button>
                  <button className="secondary-action" style={{ fontSize:11 }}
                    title="Abre uma ordem de serviço pra esse equipamento (ex.: chamar o técnico)."
                    onClick={() => setEditOrder({ equipmentId: eq.id })}>
                    + Abrir OS
                  </button>
                  {isManager && <button className="ghost-action" style={{ fontSize:11 }}
                    title="Edita dados do equipamento (local, marca, plano de manutenção)."
                    onClick={() => setEditEquip(eq)}>Editar</button>}
                </div>
              </div>
              {eq.plans.length > 0 && (
                <div style={{ padding:'10px 20px 14px' }}>
                  <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', marginBottom:8 }}>Plano de manutenção</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {eq.plans.map(plan => {
                      const t  = plan.tone;
                      const mt = MAINTENANCE_TYPES.find(m=>m.id===plan.type);
                      return (
                        <div key={plan.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', borderRadius:'var(--r)', background:`${mt?.color}10`, border:`1px solid ${mt?.color}30` }}>
                          <div>
                            <span style={{ fontWeight:600, fontSize:13 }}>{mt?.icon} {plan.title}</span>
                            <span style={{ fontSize:11, color:'var(--text-secondary)', marginLeft:8 }}>a cada {plan.frequencyDays}d</span>
                          </div>
                          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                            {plan.lastLog && <span style={{ fontSize:11, color:'var(--text-secondary)' }}>Último: {fmtDate(plan.lastLog.executedAt)}</span>}
                            <span style={{ padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700, background:t==='ok'?'var(--green-light)':t==='expired'||t==='danger'?'var(--red-light)':t==='warn'?'var(--amber-light)':'var(--surface-muted)', color:t==='ok'?'var(--green)':t==='expired'||t==='danger'?'var(--red)':t==='warn'?'var(--amber)':'var(--text-secondary)' }}>
                              {dueLabel(plan.days)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          );
        })}
    </div>
  );

  // ── Work orders ────────────────────────────────────────────────────────

  const renderOrders = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <button className="primary-action" onClick={() => setEditOrder({})}>+ Nova OS</button>
      </div>
      {orders.length === 0
        ? <article className="management-card"><p className="muted" style={{ padding:'24px' }}>Nenhuma ordem de serviço.</p></article>
        : orders.map(o => {
          const eq = mergedEquipments.find(e=>e.id===o.equipmentId);
          const statusColor = { pendente:'warn', 'em_andamento':'blue', concluida:'ok', cancelada:'neutral' }[o.status] ?? 'neutral';
          return (
            <article key={o.id} className="management-card">
              <div className="card-head">
                <div>
                  <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4 }}>
                    <h3 style={{ fontSize:15, fontWeight:700 }}>{o.title}</h3>
                    <span className={`badge ${o.priority==='alta'?'danger':o.priority==='media'?'warn':'neutral'}`} style={{ fontSize:10 }}>Prioridade {o.priority}</span>
                    <span className={`badge ${statusColor}`} style={{ fontSize:10 }}>{o.status?.replace('_',' ')}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
                    {eq && <span>🔧 {eq.name} · </span>}
                    <span>Solicitado por {o.requestedBy} em {fmtDate(o.createdAt)}</span>
                  </div>
                  {o.description && <p style={{ fontSize:13, marginTop:6 }}>{o.description}</p>}
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  {isOrderOpen(o) && (
                    <button className="primary-action" style={{ fontSize:11 }} onClick={() => {
                      // updatedAt PRECISA bumpar aqui — é o campo que
                      // mergeByKey usa pra decidir quem vence o sync (fica
                      // dentro de `data`, o jsonb; a coluna solta updated_at
                      // não volta em workOrderFromRow). Sem isto, "concluir"
                      // fica com o MESMO carimbo de quando a OS foi criada; se
                      // o clique aconteceu offline, syncWorkOrders (pull) roda
                      // antes de syncQueue (push) no próximo boot, o empate
                      // some pro `>=` de mergeByKey (o remoto, que entra
                      // depois no array, vence) e a OS concluída volta a
                      // aparecer aberta — mesmo com o registro de execução já
                      // no Histórico. O modal de editar/criar (onSave, abaixo)
                      // já bumpa; só este caminho de mutação não bumpava.
                      // Achado da auditoria (19/08).
                      const updated = { ...o, status:'concluida', completedAt:new Date().toISOString(), completedBy:session?.user?.name, updatedAt:new Date().toISOString() };
                      setOrders(prev => prev.map(x => x.id===o.id ? updated : x));
                      pushWorkOrder(activeTenant.id, updated);
                      // Auto-log maintenance
                      if (o.equipmentId) {
                        const autoLog = { id:uid(), equipmentId:o.equipmentId, planId:o.planId??null, type:o.maintenanceType??'corretiva', title:o.title, notes:o.description??'', executedBy:session?.user?.name??'—', executedAt:new Date().toISOString().slice(0,10), workOrderId:o.id };
                        setLogs(prev => [autoLog, ...prev]);
                        pushMaintLog(activeTenant.id, autoLog);
                      }
                    }}>✓ Concluir</button>
                  )}
                  <button className="ghost-action" style={{ fontSize:11 }} onClick={() => setEditOrder(o)}>Editar</button>
                </div>
              </div>
            </article>
          );
        })}
    </div>
  );

  // ── History ────────────────────────────────────────────────────────────

  const renderHistory = () => (
    <article className="management-card">
      <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Registros de manutenção</h2></div><span className="badge neutral">{logs.length}</span></div>
      <div className="equipment-maintenance-list">
        {logs.length === 0
          ? <p className="muted" style={{ padding:'24px' }}>Nenhum registro ainda.</p>
          // Ordena por data de EXECUÇÃO, mais recente primeiro — ver
          // sortLogsByExecution. Sem isto, o registro que chegou de outro
          // aparelho no último sync cai no fim (a nuvem é anexada no fim do
          // merge, não misturada por data). Achado da auditoria (19/08).
          : sortLogsByExecution(logs).map(l => {
            const eq = mergedEquipments.find(e=>e.id===l.equipmentId);
            const mt = MAINTENANCE_TYPES.find(t=>t.id===l.type);
            return (
              <div key={l.id} className="equipment-maintenance-row" style={{ borderLeft:`3px solid ${mt?.color}44` }}>
                <div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <strong>{eq?.name ?? '—'}</strong>
                    <span style={{ fontSize:12, color: mt?.color }}>{mt?.icon} {mt?.label}</span>
                  </div>
                  <span>{l.title}</span>
                  <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{fmtDate(l.executedAt)} · {l.executedBy}</span>
                  {l.notes && <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{l.notes}</span>}
                </div>
                <span className="badge ok" style={{ fontSize:10 }}>Executado</span>
              </div>
            );
          })}
      </div>
    </article>
  );

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Gestão de ativos</span>
          <h1>Manutenção de Equipamentos</h1>
          <p className="muted">Planos preventivos, ordens de serviço e histórico completo.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-action" onClick={() => { setEditOrder({}); setTab('orders'); }}>
            📋 + Nova OS
          </button>
          <button className="secondary-action" onClick={() => printMaintenanceReport(activeTenant, mergedEquipments, logs, orders)}>
            🖨️ Exportar PDF
          </button>
          <select value={activeTenant.id} onChange={e=>onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs — mesmo visual do HubTabs do design system */}
      <div style={{
        display:'flex', gap:4, padding:4, marginBottom:16,
        background:'var(--surface-muted)', border:'1px solid var(--border-subtle)',
        borderRadius:'var(--r-lg)', overflowX:'auto',
      }}>
        {[['dashboard','Painel'],['equipments','Equipamentos'],['orders','Ordens de serviço'],['history','Histórico']].map(([key,label]) => {
          const isActive = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)}
              style={{
                display:'flex', alignItems:'center', gap:7, padding:'7px 12px',
                borderRadius:'var(--r)', border:'none', cursor:'pointer',
                fontFamily:'var(--font)', fontSize:13,
                fontWeight: isActive ? 600 : 500,
                background: isActive ? 'var(--surface)' : 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                boxShadow: isActive ? '0 1px 3px rgba(20,20,19,.06)' : 'none',
                transition:'all .15s', whiteSpace:'nowrap',
              }}>
              <span>{label}</span>
              {key==='dashboard' && overdue > 0 && <span style={{ background:'var(--red)', color:'white', borderRadius:10, padding:'1px 6px', fontSize:10, fontWeight:700, lineHeight:1.4 }}>{overdue}</span>}
              {key==='orders' && openOrders > 0 && <span style={{ background:'var(--amber)', color:'white', borderRadius:10, padding:'1px 6px', fontSize:10, fontWeight:700, lineHeight:1.4 }}>{openOrders}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'dashboard'   && renderDashboard()}
      {tab === 'equipments'  && renderEquipments()}
      {tab === 'orders'      && renderOrders()}
      {tab === 'history'     && renderHistory()}

      {/* Equipment modal */}
      {editEquip !== null && (
        <EquipmentModal
          equipment={editEquip.id ? editEquip : null}
          existentes={mergedEquipments}
          onSave={(eq) => {
            // Converter um item virtual do catálogo gera id novo (uuid de
            // verdade — v1.9.153, senão não sincroniza). Só que execuções e
            // ordens de serviço já criadas apontam pro id sintético
            // "cat-<label>": sem religar, o ativo nasce sem histórico e as OS
            // passam a mostrar "—" no equipamento. Ninguém é avisado.
            // Eu introduzi este risco ao consertar o id; a auditoria de 18/08
            // (achado nº1 dos não-julgados) pegou. Religa antes de gravar.
            const idAntigo = editEquip?._fromCatalog ? editEquip.id : null;
            if (idAntigo && idAntigo !== eq.id) {
              setLogs(prev => prev.map(l => l.equipmentId === idAntigo ? { ...l, equipmentId: eq.id } : l));
              setOrders(prev => prev.map(o => o.equipmentId === idAntigo ? { ...o, equipmentId: eq.id } : o));
              // Religar só no state local não bastava: maint_logs não carrega
              // updatedAt na linha da nuvem (maintLogToRow só manda
              // created_at), então o registro religado e a cópia velha que já
              // estava na nuvem (equipmentId ainda "cat-<label>") empatam no
              // desempate do mergeByKey — e o `>=` favorece quem entra por
              // ÚLTIMO no array, que é sempre o remoto (repository.js,
              // syncModule: [...local, ...remoteRecords]). No próximo sync
              // (deste aparelho ou de QUALQUER outro da loja) a cópia velha
              // da nuvem ganha e desfaz o religamento em silêncio — o
              // Histórico volta a mostrar "—" depois de já ter parecido
              // corrigido. Empurra os mesmos registros religados de volta pra
              // nuvem — OS bumpa updatedAt pra vencer o desempate mesmo antes
              // do push chegar (workOrderToRow manda updated_at; mesmo padrão
              // do "✓ Concluir" logo abaixo). Achado da auditoria (19/08).
              logs.filter(l => l.equipmentId === idAntigo)
                .forEach(l => pushMaintLog(activeTenant.id, { ...l, equipmentId: eq.id }));
              orders.filter(o => o.equipmentId === idAntigo)
                .forEach(o => pushWorkOrder(activeTenant.id, { ...o, equipmentId: eq.id, updatedAt: new Date().toISOString() }));
            }
            setEquipments(prev => prev.some(e=>e.id===eq.id) ? prev.map(e=>e.id===eq.id?eq:e) : [...prev, eq]);
            pushEquipAsset(activeTenant.id, eq);
            setEditEquip(null);
          }}
          onDelete={async (id) => {
            setEquipments(prev => prev.filter(e=>e.id!==id));
            setEditEquip(null);
            // Offline o delete não propaga (a fila replayaria como upsert e
            // ressuscitaria o ativo) — remover online apaga em todo lugar.
            // deleteMaintenanceItem NUNCA lança — devolve {ok:false, reason}.
            // Offline é esperado (é o comentário acima); falha REAL com
            // internet presente precisa avisar, senão o ativo volta sozinho
            // no próximo sync e parece que a remoção nunca aconteceu. Mesmo
            // padrão de removeItem/removeAction (pages.jsx). Achado da
            // auditoria (19/08).
            const r = await deleteMaintenanceItem('equip_assets', activeTenant.id, id);
            if (!r.ok && r.reason !== 'offline_or_disabled') {
              window.alert('Não foi possível remover este equipamento na nuvem agora. Ele pode reaparecer na próxima sincronização — tente remover de novo.');
            }
          }}
          onClose={() => setEditEquip(null)}
        />
      )}

      {/* Work order modal — equipments é mergedEquipments (catálogo de
          temperatura + ativos reais), não o `equipments` cru. Esse era o bug:
          uma loja que nunca cadastrou nada em Manutenção → Equipamentos tem
          `equipments` vazio, mesmo com Freezer/Refrigerador já monitorados na
          Visão Geral. O dropdown ficava sem opção nenhuma pra escolher. */}
      {editOrder !== null && (
        <WorkOrderModal
          order={editOrder.id ? editOrder : null}
          equipments={mergedEquipments}
          session={session}
          onSave={(o) => { setOrders(prev => editOrder.id ? prev.map(x=>x.id===o.id?o:x) : [...prev, o]); pushWorkOrder(activeTenant.id, o); setEditOrder(null); }}
          onClose={() => setEditOrder(null)}
        />
      )}

      {/* Log execution modal */}
      {showLogModal && (
        <LogExecutionModal
          equipment={showLogModal.equipment}
          plan={showLogModal.plan}
          session={session}
          onSave={(log) => { setLogs(prev => [log, ...prev]); pushMaintLog(activeTenant.id, log); setShowLogModal(null); }}
          onClose={() => setShowLogModal(null)}
        />
      )}
    </section>
  );
}

// ─── Equipment modal ───────────────────────────────────────────────────────

function EquipmentModal({ equipment, onSave, onDelete, onClose, existentes = [] }) {
  const [name, setName]             = useState(equipment?.name ?? '');
  const [location, setLocation]     = useState(equipment?.location ?? '');
  const [brand, setBrand]           = useState(equipment?.brand ?? '');
  const [model, setModel]           = useState(equipment?.model ?? '');
  const [serialNumber, setSerial]   = useState(equipment?.serialNumber ?? '');
  const [purchaseDate, setPurchase] = useState(equipment?.purchaseDate ?? '');
  const [status, setStatus]         = useState(equipment?.status ?? 'Operacional');
  const [notes, setNotes]           = useState(equipment?.notes ?? '');
  const [plans, setPlans]           = useState(equipment?.maintenancePlans ?? []);

  const addPlan = () => setPlans(prev => [...prev, { id: uid(), type:'preventiva', title:'', frequencyDays:30, nextDue:addDays(new Date().toISOString(), 30) }]);
  const updatePlan = (id, field, value) => setPlans(prev => prev.map(p => p.id===id ? { ...p, [field]:value } : p));
  const removePlan = (id) => setPlans(prev => prev.filter(p => p.id!==id));

  const handleSave = () => {
    if (!name.trim()) return;
    // Nome que já existe na lista faz o OUTRO sumir: mergedEquipments esconde
    // o item do catálogo cujo nome bate com um ativo cadastrado. As OS e
    // execuções que apontavam pro virtual "cat-<label>" viram órfãs e passam a
    // mostrar "—" no equipamento. Achado da auditoria (18/08).
    // Aponto a ação certa: pra dar plano preventivo a um equipamento do
    // catálogo, é EDITAR o card dele (que religa o histórico — v1.9.153), não
    // cadastrar um homônimo.
    const norm = (v) => String(v ?? '').trim().toLowerCase();
    const conflito = existentes.find((e) => e.id !== equipment?.id && norm(e.name) === norm(name));
    if (conflito) {
      window.alert(
        `Já existe "${conflito.name}" nesta lista.\n\n` +
        (conflito._fromCatalog
          ? `Ele vem do catálogo de temperatura. Para dar plano de manutenção a ele, use o botão "Editar" no card dele — assim o histórico já registrado continua ligado.`
          : `Use um nome que os diferencie (ex.: "${name.trim()} — Padaria").`)
      );
      return;
    }
    // Converter um item virtual do catálogo (_fromCatalog, id sintético
    // "cat-<label>") em ativo real precisa de um id de VERDADE — a coluna em
    // equip_assets é uuid. Reusar o id virtual (equipment?.id ?? uid() sempre
    // manteria "cat-Freezer") faria esse ativo falhar pra sempre no push, 22P02
    // invalid uuid syntax — a mesma doença do ativo sem id (v1.9.148), só que
    // com id inválido em vez de ausente, e passando batido por garantirIds
    // porque "cat-Freezer" é truthy.
    const id = equipment?._fromCatalog ? uid() : (equipment?.id ?? uid());
    onSave({ id, name:name.trim(), location:location.trim(), brand:brand.trim(), model:model.trim(), serialNumber:serialNumber.trim(), purchaseDate, status, notes:notes.trim(), maintenancePlans:plans, createdAt: equipment?.createdAt ?? new Date().toISOString(), updatedAt:new Date().toISOString() });
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:24, overflowY:'auto' }}>
      <div style={{ background:'var(--surface)', borderRadius:16, padding:28, width:'100%', maxWidth:580, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ fontSize:18, fontWeight:800 }}>{equipment ? 'Editar equipamento' : 'Novo equipamento'}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--text-secondary)' }}>✕</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div className="grid-2">
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Nome *<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Câmara Frigorífica 1" autoFocus /></label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Localização<input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Ex.: Estoque, Cozinha" /></label>
          </div>
          <div className="grid-2">
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Marca<input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="Ex.: Elgin, Metalfrio" /></label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Modelo<input value={model} onChange={e=>setModel(e.target.value)} placeholder="Modelo" /></label>
          </div>
          <div className="grid-2">
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Número de série<input value={serialNumber} onChange={e=>setSerial(e.target.value)} placeholder="S/N" /></label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Data de compra<input type="date" value={purchaseDate} onChange={e=>setPurchase(e.target.value)} /></label>
          </div>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Status
            <select value={status} onChange={e=>setStatus(e.target.value)}>
              {EQUIPMENT_STATUS.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          {/* Maintenance plans */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)' }}>Plano de manutenção preventiva</div>
              <button className="secondary-action" style={{ fontSize:11 }} onClick={addPlan}>+ Adicionar tarefa</button>
            </div>
            {plans.length === 0 && <p style={{ fontSize:13, color:'var(--text-secondary)', padding:'8px 0' }}>Nenhuma tarefa preventiva. Clique em "+ Adicionar" para criar.</p>}
            {plans.map(plan => (
              <div key={plan.id} style={{ display:'flex', gap:8, marginBottom:8, padding:'10px 12px', borderRadius:'var(--r)', border:'1px solid var(--border)', background:'var(--surface-muted)' }}>
                <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
                  <div className="grid-2">
                    <select value={plan.type} onChange={e=>updatePlan(plan.id,'type',e.target.value)} style={{ fontSize:12 }}>
                      {MAINTENANCE_TYPES.map(t=><option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
                    </select>
                    <select value={plan.frequencyDays} onChange={e=>updatePlan(plan.id,'frequencyDays',Number(e.target.value))} style={{ fontSize:12 }}>
                      {FREQUENCY_OPTIONS.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                  <input value={plan.title} onChange={e=>updatePlan(plan.id,'title',e.target.value)} placeholder="Descrição da tarefa (ex.: Limpeza dos filtros, Calibração do termômetro)" style={{ fontSize:12 }} />
                </div>
                <button onClick={() => removePlan(plan.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--red)', fontSize:16, alignSelf:'center' }}>✕</button>
              </div>
            ))}
          </div>

          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Observações<textarea value={notes} onChange={e=>setNotes(e.target.value)} style={{ minHeight:48 }} /></label>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          {equipment && !equipment._fromCatalog && <button onClick={() => { if(window.confirm('Remover equipamento?')) onDelete(equipment.id); }} style={{ padding:'10px', borderRadius:8, border:'none', background:'var(--red-light)', color:'var(--red)', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'var(--font)' }}>Remover</button>}
          <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'var(--font)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={!name.trim()} style={{ flex:2, padding:'10px', borderRadius:8, border:'none', background:name.trim()?'var(--blue)':'var(--border)', color:'white', cursor:name.trim()?'pointer':'not-allowed', fontSize:14, fontWeight:700, fontFamily:'var(--font)' }}>
            {equipment ? 'Salvar' : 'Cadastrar equipamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Log execution modal ───────────────────────────────────────────────────

function LogExecutionModal({ equipment, plan, session, onSave, onClose }) {
  const [type, setType]       = useState(plan?.type ?? 'preventiva');
  const [title, setTitle]     = useState(plan?.title ?? '');
  const [executedAt, setDate] = useState(new Date().toISOString().slice(0,10));
  const [notes, setNotes]     = useState('');
  const [executedBy, setBy]   = useState(session?.user?.name ?? '');

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({ id:uid(), equipmentId:equipment.id, planId:plan?.id??null, type, title:title.trim(), notes:notes.trim(), executedBy:executedBy.trim()||session?.user?.name||'—', executedAt, createdAt:new Date().toISOString() });
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:24 }}>
      <div style={{ background:'var(--surface)', borderRadius:16, padding:28, width:'100%', maxWidth:460, boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <h2 style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>Registrar execução</h2>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:20 }}>{equipment.name}</p>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Tipo
            <select value={type} onChange={e=>setType(e.target.value)}>
              {MAINTENANCE_TYPES.map(t=><option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
            </select>
          </label>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Tarefa executada *<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Descreva o que foi feito" autoFocus /></label>
          <div className="grid-2">
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Data de execução<input type="date" value={executedAt} onChange={e=>setDate(e.target.value)} /></label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Executado por<input value={executedBy} onChange={e=>setBy(e.target.value)} /></label>
          </div>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Observações<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Peças trocadas, condições encontradas, próximas ações…" style={{ minHeight:60 }} /></label>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'var(--font)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={!title.trim()} style={{ flex:2, padding:'10px', borderRadius:8, border:'none', background:title.trim()?'var(--green)':'var(--border)', color:'white', cursor:title.trim()?'pointer':'not-allowed', fontSize:14, fontWeight:700, fontFamily:'var(--font)' }}>
            ✓ Confirmar execução
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Work order modal ──────────────────────────────────────────────────────

function WorkOrderModal({ order, equipments, session, onSave, onClose }) {
  const [title, setTitle]         = useState(order?.title ?? '');
  const [equipmentId, setEquipId] = useState(order?.equipmentId ?? '');
  const [type, setType]           = useState(order?.maintenanceType ?? 'corretiva');
  const [priority, setPriority]   = useState(order?.priority ?? 'media');
  const [description, setDesc]    = useState(order?.description ?? '');
  const [status, setStatus]       = useState(order?.status ?? 'pendente');

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({ id:order?.id??uid(), title:title.trim(), equipmentId, maintenanceType:type, priority, description:description.trim(), status, requestedBy:order?.requestedBy??session?.user?.name??'—', createdAt:order?.createdAt??new Date().toISOString(), updatedAt:new Date().toISOString() });
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:24 }}>
      <div style={{ background:'var(--surface)', borderRadius:16, padding:28, width:'100%', maxWidth:480, boxShadow:'0 24px 64px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ fontSize:18, fontWeight:800 }}>{order ? 'Editar OS' : 'Nova ordem de serviço'}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Título *<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Descreva o serviço" autoFocus /></label>
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Equipamento
            <select value={equipmentId} onChange={e=>setEquipId(e.target.value)}>
              <option value="">Selecione…</option>
              {equipments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <div className="grid-2">
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Tipo
              <select value={type} onChange={e=>setType(e.target.value)}>
                {MAINTENANCE_TYPES.map(t=><option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </select>
            </label>
            <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Prioridade
              <select value={priority} onChange={e=>setPriority(e.target.value)}>
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
              </select>
            </label>
          </div>
          {order && <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Status
            <select value={status} onChange={e=>setStatus(e.target.value)}>
              <option value="pendente">Pendente</option>
              <option value="em_andamento">Em andamento</option>
              <option value="concluida">Concluída</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </label>}
          <label style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Descrição<textarea value={description} onChange={e=>setDesc(e.target.value)} style={{ minHeight:60 }} /></label>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'var(--font)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={!title.trim()} style={{ flex:2, padding:'10px', borderRadius:8, border:'none', background:title.trim()?'var(--blue)':'var(--border)', color:'white', cursor:title.trim()?'pointer':'not-allowed', fontSize:14, fontWeight:700, fontFamily:'var(--font)' }}>
            {order ? 'Salvar' : 'Criar OS'}
          </button>
        </div>
      </div>
    </div>
  );
}
