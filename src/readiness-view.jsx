// ─────────────────────────────────────────────────────────────────────────────
// Prontidão para Fiscalização — a tela (Fatia 1, 15/08).
//
// Mesma divisão de trabalho do Dossiê (dossie-view.jsx:15-63): a view só
// ORQUESTRA — lê localStorage e puxa os chunks pesados por import dinâmico —,
// e quem decide qualquer coisa é o módulo puro `readiness.js`. Nenhuma regra
// de conformidade mora aqui dentro.
//
// Os imports dinâmicos (`forms`/`controls`/`extras`/`maintenance`/`validity`/
// `settings`/`training`) NÃO são preciosismo: são os chunks pesados de UI, e
// importá-los estaticamente puxaria todos eles pro bundle principal só por
// causa desta tela (mesmo motivo documentado em nonconformities.js:66-69).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { resolveRecordTone as resolveTemperatureTone } from './limits';
import { readTurns } from './turns';
import { canAccess } from './permissions';
import { computeTurnAlertsPure } from './turn-alerts';
import { isSupabaseEnabled, getSyncStatus, getOfflineQueue, getTemperatureRepository } from './repository';
import {
  computeReadiness, byWorstStatus, READINESS_DEFAULTS,
  VERDICT_LABEL, VERDICT_TONE, STATUS_LABEL, STATUS_TONE,
} from './readiness';

const readLocal = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const readActions   = (id) => readLocal(`nutriops.corrective_actions.${id}`, []);
const readReceiving = (id) => readLocal(`nutriops.receiving.${id}`, []);
// Equipe: não há reader exportado — mesma leitura que reports.jsx:260 faz.
const readStaff     = (tenant) => readLocal(`nutriops.users.${tenant.id}`, null) ?? tenant.usersList ?? [];
// ASO + Manual de BP (Fatia 2b). Chave própria, sem reader exportado — a
// captura vive em training.jsx (ASO) e settings.jsx (Manual), dois chunks
// pesados que não vale puxar só por causa de uma leitura.
const readCompliance = (id) => readLocal(`nutriops.compliance.${id}`, []);

// Temperaturas DESTA loja. A prop `records` do App não serve sozinha: quando a
// sessão não é de admin global — o caso da RT com 3 unidades, que é justamente
// pra quem esta tela existe — `refreshRecords` só carrega a loja ATIVA
// (pages.jsx), enquanto `visibleTenants` traz todas. Usar a prop crua fazia as
// outras unidades serem avaliadas com zero leituras e nascerem "EM RISCO" sem
// nenhuma evidência disso. Buscamos por loja, na mesma janela de 90 dias que o
// App usa, e a prop vira só o fallback quando a busca falha (offline).
async function readTenantTemperatures(tenant, records) {
  const daProp = records.filter((r) => r.tenantId === tenant.id);
  try {
    const doRepo = await getTemperatureRepository().list({ tenantId: tenant.id, days: 90 });
    // Une as duas fontes: o repositório Supabase devolve só o que veio da
    // nuvem, e o que ainda está na fila offline vive só na prop.
    const porId = new Map(doRepo.map((r) => [r.id, r]));
    for (const r of daProp) if (!porId.has(r.id)) porId.set(r.id, r);
    return [...porId.values()];
  } catch {
    return daProp;   // rede caiu: melhor o que o App já tinha do que nada
  }
}

async function loadTenantReadiness({ tenant, records, now }) {
  const [
    { readFormTemplates, readFormRecords, pendingFormsForPeriod, extractNonConformities },
    { readOil, readThaw, readCool, readThermal, readPOPs },
    { readHandwash },
    { readCatalog, readMaintenanceLogs },
    { readProducts },
    { readCompanyProfile },
    { readSessions, readTrainConfig },
    nc,
    { filterByPeriod },
  ] = await Promise.all([
    import('./forms'), import('./controls'), import('./extras'), import('./maintenance'),
    import('./validity'), import('./settings'), import('./training'),
    import('./nonconformities'), import('./dossier'),
  ]);

  const tenantRecords  = await readTenantTemperatures(tenant, records);
  const templates      = readFormTemplates(tenant);
  const formRecords    = readFormRecords(tenant.id);
  const receiving      = readReceiving(tenant.id);
  const controlsByType = {
    oil: readOil(tenant.id), thaw: readThaw(tenant.id), cool: readCool(tenant.id),
    thermal: readThermal(tenant.id), handwash: readHandwash(tenant.id),
  };

  // NC das 4 origens, recortadas no período e tirando as que já têm ação —
  // exatamente o mesmo encadeamento do dossiê (dossie-view.jsx:40-45).
  const periodStart = now - READINESS_DEFAULTS.ncWindowDays * 86400000;
  const ncNoPeriodo = filterByPeriod([
    ...nc.pendingTemperatureItems(tenantRecords, tenant.id, resolveTemperatureTone),
    ...nc.pendingReceivingItems(receiving),
    ...Object.keys(nc.CONTROL_TYPES).flatMap((type) => nc.pendingControlItems(type, controlsByType[type])),
    ...nc.pendingFormItems(templates, formRecords, extractNonConformities),
  ], periodStart, 'at');
  const pendingNc = nc.excludeWithAction(ncNoPeriodo, readActions(tenant.id));

  const catalog  = readCatalog(tenant);   // já dedupado lá dentro
  const pops     = readPOPs(tenant.id);
  const sessions = readSessions(tenant.id);
  const maintLogs = readMaintenanceLogs(tenant.id);

  return computeReadiness({
    tenant, now,
    pendingNc,
    products: readProducts(tenant.id),
    // `Pure` de propósito, não o wrapper: "dar ciência" num alerta (tela
    // Alertas) só diz "eu vi", não registra temperatura nenhuma. Com o
    // wrapper, dispensar os alertas fazia esta tela afirmar "nenhum
    // equipamento pendente" com zero leituras no dia — a única mentira que
    // uma tela de prontidão não pode contar. Ciência é gestão de ruído; aqui
    // vale a evidência.
    turnAlerts: computeTurnAlertsPure(readTurns(tenant), tenantRecords, catalog, tenant.id, tenant.implantacao === true),
    catalog,
    temperatureRecords: tenantRecords,
    staff: readStaff(tenant),
    trainingSessions: sessions,
    trainingValidityMonths: readTrainConfig(tenant.id).validityMonths ?? 12,
    formTemplates: templates,
    formRecords,
    pendingForms: pendingFormsForPeriod(templates, formRecords, new Date(now)),
    pops,
    companyProfile: readCompanyProfile(tenant.id),
    complianceDocs: readCompliance(tenant.id),
    controlsByType,
    sync: { enabled: isSupabaseEnabled(), lastSync: getSyncStatus().lastSync, queueLength: getOfflineQueue().length },
    // POPs/capacitação saíram daqui na Fatia 3 (sincronizam agora); só
    // manutenção segue local-only.
    localOnly: { maintenance: maintLogs.length },
  });
}

function CheckRow({ check, role, onNavigate }) {
  const podeIr = check.navTarget && canAccess(role, check.navTarget);
  return (
    <div className="equipment-maintenance-row">
      <div>
        <strong>{check.label}</strong>
        <span>{check.detail}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span className={`badge ${STATUS_TONE[check.status]}`}>{STATUS_LABEL[check.status]}</span>
        {podeIr && (
          <button className="ghost-action" style={{ fontSize: 11 }} onClick={() => onNavigate?.(check.navTarget)}>
            Resolver →
          </button>
        )}
      </div>
    </div>
  );
}

function TenantCard({ result, role, onNavigate }) {
  // Padrão é mostrar só o que falta: com 4 lojas × 16 checks, a lista completa
  // esconde o problema em vez de mostrar. O "em ordem" fica a um clique.
  const [showAll, setShowAll] = useState(false);
  const { counts, verdict } = result;

  const groups = result.groups
    .map((g) => ({ ...g, checks: [...g.checks].sort(byWorstStatus).filter((c) => showAll || c.status !== 'ok') }))
    .filter((g) => g.checks.length > 0);

  return (
    <article className="management-card">
      {/* flexWrap: no celular o veredito ficava espremido em duas linhas pra
          caber ao lado dos badges; quebrando, ele fica inteiro numa linha só. */}
      <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span className="eyebrow">{result.tenantName}</span>
          <h2 style={{ whiteSpace: 'nowrap', color: verdict === 'risk' ? 'var(--red)' : verdict === 'attention' ? 'var(--amber)' : 'var(--green)' }}>
            {VERDICT_LABEL[verdict]}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {counts.fail > 0    && <span className="badge danger">{counts.fail} pendente(s)</span>}
          {counts.warn > 0    && <span className="badge warn">{counts.warn} ressalva(s)</span>}
          {counts.unknown > 0 && <span className="badge neutral">{counts.unknown} sem dado</span>}
          <span className="badge ok">{counts.ok} em ordem</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="muted" style={{ padding: '20px' }}>✓ Nada pendente — tudo desta loja está em ordem.</p>
      ) : groups.map((group) => (
        <div key={group.id}>
          <div style={{ padding: '10px 20px 6px', borderTop: '1px solid var(--border-subtle)' }}>
            <span className="eyebrow">{group.id} · {group.title}</span>
          </div>
          <div className="equipment-maintenance-list">
            {group.checks.map((check) => (
              <CheckRow key={check.id} check={check} role={role} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}

      <div className="actions-row" style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)' }}>
        <button className="secondary-action" style={{ fontSize: 12 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Mostrar só o que falta' : `Mostrar tudo (${counts.ok} em ordem)`}
        </button>
        {canAccess(role, 'dossie') && (
          <button className="primary-action" style={{ fontSize: 12 }} onClick={() => onNavigate?.('dossie')}>
            Gerar dossiê
          </button>
        )}
      </div>
    </article>
  );
}

export function ReadinessView({ allTenants = [], records = [], session, onNavigate }) {
  const [tenantFilter, setTenantFilter] = useState('all');
  const [results, setResults] = useState(null);
  const [erro, setErro] = useState(null);
  const [tick, setTick] = useState(0);   // botão "Atualizar" força recálculo
  const role = session?.user?.role;

  // `cancelado` evita que um cálculo antigo (a RT trocou de filtro, ou o sync
  // trouxe registros novos no meio) sobrescreva o resultado mais recente.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setResults(null);
      setErro(null);
      try {
        const now = Date.now();
        const out = [];
        for (const tenant of allTenants) out.push(await loadTenantReadiness({ tenant, records, now }));
        if (!cancelado) setResults(out);
      } catch (e) {
        if (!cancelado) { setErro(e?.message ?? 'Não consegui calcular a prontidão.'); setResults([]); }
      }
    })();
    return () => { cancelado = true; };
  }, [allTenants, records, tick]);

  const visiveis = (results ?? []).filter((r) => tenantFilter === 'all' || r.tenantId === tenantFilter);
  const emRisco  = (results ?? []).filter((r) => r.verdict === 'risk').length;

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Fiscalização</span>
          <h1>Prontidão</h1>
          <p className="muted">
            Se a vigilância chegasse agora, cada loja passaria? Veredito ao vivo por gravidade, com o caminho pra resolver cada pendência.
            Onde o app ainda não captura o dado, a resposta é "sem dado" — nunca "em ordem".
          </p>
        </div>
        <div className="page-actions">
          {allTenants.length > 1 && (
            <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">Todas as empresas</option>
              {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button className="secondary-action" style={{ fontSize: 12 }} onClick={() => setTick((t) => t + 1)}>Atualizar</button>
        </div>
      </div>

      {erro && <div className="submission danger">✕ {erro}</div>}

      {results === null && <p className="muted" style={{ padding: '20px' }}>Calculando a prontidão de cada loja…</p>}

      {results !== null && emRisco > 0 && (
        <div className="submission danger">
          ✕ {emRisco} {emRisco === 1 ? 'loja está' : 'lojas estão'} EM RISCO — há pendência do grupo A, que é o que gera auto de infração na hora.
        </div>
      )}

      {visiveis.map((result) => (
        <TenantCard key={result.tenantId} result={result} role={role} onNavigate={onNavigate} />
      ))}

      {results !== null && visiveis.length === 0 && !erro && (
        <p className="muted" style={{ padding: '20px' }}>Nenhuma empresa para avaliar.</p>
      )}
    </section>
  );
}
