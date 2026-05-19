import React, { useMemo, useState } from 'react';
import { tenants } from './data';

const statusClass = (status) => (status === 'danger' ? 'danger' : status === 'warn' ? 'warn' : 'ok');

function AppShell({ children }) {
  return (
    <main className="shell">
      {children}
    </main>
  );
}

function Sidebar({ tenant, view, setView }) {
  return (
    <aside className="sidebar">
      <div>
        <div className="brand">NutriOPS</div>
        <p className="brand-sub">SaaS multi-tenant para POPs, controles e auditoria</p>
      </div>
      <nav className="nav">
        {[
          ['dashboard', 'Dashboard'],
          ['templates', 'POPs e Planilhas'],
          ['audit', 'Auditoria'],
          ['alerts', 'Alertas']
        ].map(([key, label]) => (
          <button key={key} className={`nav-item ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="tenant-card">
        <div className="badge">Tenant ativo</div>
        <h3 style={{ margin: '12px 0 6px' }}>{tenant.name}</h3>
        <p className="muted" style={{ margin: '0 0 14px' }}>{tenant.segment} · Plano {tenant.plan}</p>
        <div className="kpi"><span>Lojas</span><strong>{tenant.stores.length}</strong></div>
        <div className="kpi"><span>Usuários</span><strong>{tenant.users}</strong></div>
        <div className="kpi"><span>Conformidade</span><strong>{tenant.compliance}%</strong></div>
      </div>
    </aside>
  );
}

function Hero({ tenant }) {
  return (
    <header className="hero">
      <div>
        <span className="eyebrow">Operação digital com rastreabilidade</span>
        <h1>Controle sanitário com visão comercial, multi-tenant e pronto para escalar.</h1>
        <p>
          A base do produto já nasce como um SaaS para múltiplas empresas, com dados isolados,
          dashboards por unidade e controles operacionais inspirados nas planilhas reais.
        </p>
        <div className="hero-actions">
          <button className="primary-action">Criar formulário</button>
          <button className="secondary-action">Exportar PDF fiscal</button>
        </div>
      </div>
      <div className="hero-metrics">
        <div className="metric"><span className="muted">Formulários hoje</span><strong>{tenant.formsToday}</strong></div>
        <div className="metric"><span className="muted">Alertas ativos</span><strong>{tenant.alerts}</strong></div>
        <div className="metric"><span className="muted">Conformidade média</span><strong>{tenant.compliance}%</strong></div>
      </div>
    </header>
  );
}

function Filters({ tenant, currentStore, currentModule, onTenant, onStore, onModule }) {
  return (
    <section className="filters">
      <label>
        Tenant ativo
        <select value={tenant.id} onChange={(e) => onTenant(e.target.value)}>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label>
        Loja
        <select value={currentStore} onChange={(e) => onStore(e.target.value)}>
          {['Todas', ...tenant.stores].map((store) => <option key={store} value={store}>{store}</option>)}
        </select>
      </label>
      <label>
        Módulo
        <select value={currentModule} onChange={(e) => onModule(e.target.value)}>
          {['Todos', ...tenant.modules].map((module) => <option key={module} value={module}>{module}</option>)}
        </select>
      </label>
    </section>
  );
}

function Dashboard({ tenant, currentModule, setCurrentModule }) {
  return (
    <div className="grid">
      <article className="card span-4 highlight-card">
        <div className="card-head">
          <div>
            <span className="eyebrow">Painel RT</span>
            <h2>Visão executiva</h2>
          </div>
          <span className="badge subtle">Atualizado agora</span>
        </div>
        <div className="metric-stack">
          {tenant.audit.map((item) => (
            <div className="metric-row" key={item.label}>
              <div>
                <div className="muted">{item.label}</div>
                <strong>{item.value}</strong>
              </div>
              <span className={`status ${statusClass(item.status)}`}>{item.status.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </article>
      <article className="card span-8">
        <div className="card-head">
          <div>
            <span className="eyebrow">Operação</span>
            <h2>Módulos prioritários</h2>
          </div>
          <button className="ghost-action">Ver cobertura</button>
        </div>
        <div className="pill-row">
          {tenant.modules.map((module) => (
            <button
              key={module}
              className={`pill ${currentModule === module ? 'active' : ''}`}
              onClick={() => setCurrentModule(module)}
            >
              {module}
            </button>
          ))}
        </div>
        <table className="table">
          <thead>
            <tr><th>Controle</th><th>Frequência</th><th>Responsável</th><th>Exigência</th><th>Status</th></tr>
          </thead>
          <tbody>
            {tenant.forms.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.frequency}</td>
                <td>{row.owner}</td>
                <td>{row.requirement}</td>
                <td className={`status ${statusClass(row.status)}`}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}

function Templates({ tenant }) {
  return (
    <div className="grid">
      <article className="card span-6 feature-card">
        <div className="card-head">
          <div>
            <span className="eyebrow">Conteúdo</span>
            <h2>Biblioteca de POPs</h2>
          </div>
          <span className="badge subtle">{tenant.segment}</span>
        </div>
        <p className="muted">Próximo passo do produto: templates por tipo, com campos configuráveis e versão PDF com QR.</p>
        <div className="feature-list">
          <div className="feature-item">Higienização de ambientes e equipamentos</div>
          <div className="feature-item">Controle de temperatura por turno</div>
          <div className="feature-item">Recebimento de insumos e prazos</div>
        </div>
      </article>
      <article className="card span-6 feature-card">
        <div className="card-head">
          <div>
            <span className="eyebrow">Motor</span>
            <h2>Campos do formulário</h2>
          </div>
          <span className="badge subtle">Dinâmico</span>
        </div>
        <div className="info-grid">
          <div className="info-box"><span>Tenant</span><strong>{tenant.name}</strong></div>
          <div className="info-box"><span>Loja padrão</span><strong>{tenant.stores[0]}</strong></div>
          <div className="info-box"><span>Modelo</span><strong>Checklist operacional</strong></div>
          <div className="info-box"><span>Status</span><strong>Pronto para Supabase</strong></div>
        </div>
      </article>
    </div>
  );
}

function Audit({ tenant }) {
  return (
    <div className="grid">
      <article className="card span-12">
        <h2>Auditoria e evidências</h2>
        <p className="muted">Aqui entra a consulta dos últimos 3 meses, exportação PDF/Excel e a tela fiscal simplificada.</p>
        <table className="table">
          <thead><tr><th>Evento</th><th>Usuário</th><th>Quando</th><th>Contexto</th></tr></thead>
          <tbody>
            <tr><td>Fechou temperatura do freezer</td><td>Funcionário 03</td><td>Hoje, 07:14</td><td>Brasília Shopping</td></tr>
            <tr><td>Aprovou checklist de faxina</td><td>Supervisor 01</td><td>Hoje, 08:02</td><td>Confeitaria</td></tr>
            <tr><td>Gerou PDF fiscal</td><td>RT</td><td>Ontem, 18:40</td><td>Tenant {tenant.name}</td></tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}

function Alerts({ tenant }) {
  return (
    <div className="grid">
      <article className="card span-12 feature-card">
        <div className="card-head">
          <div>
            <span className="eyebrow">Risco</span>
            <h2>Alertas e notificações</h2>
          </div>
          <span className="badge subtle">{tenant.alerts} ativos</span>
        </div>
        {tenant.alertsList.map((alert) => (
          <div className="alert-row" key={alert.title}>
            <div>
              <strong>{alert.title}</strong>
              <div className="muted">{alert.detail}</div>
            </div>
            <span className={`status ${statusClass(alert.level)}`}>{alert.level}</span>
          </div>
        ))}
      </article>
    </div>
  );
}

export function App() {
  const [tenantId, setTenantId] = useState(tenants[0].id);
  const [currentStore, setCurrentStore] = useState('Todas');
  const [currentModule, setCurrentModule] = useState('Todos');
  const [view, setView] = useState('dashboard');

  const tenant = useMemo(() => tenants.find((item) => item.id === tenantId) ?? tenants[0], [tenantId]);

  return (
    <AppShell>
      <div className="bg-grid" />
      <Sidebar tenant={tenant} view={view} setView={setView} />
      <section className="content">
        <Hero tenant={tenant} />
        <Filters
          tenant={tenant}
          currentStore={currentStore}
          currentModule={currentModule}
          onTenant={(id) => { setTenantId(id); setCurrentStore('Todas'); setCurrentModule('Todos'); }}
          onStore={setCurrentStore}
          onModule={setCurrentModule}
        />
        <section id="viewRoot">
          {view === 'dashboard' && <Dashboard tenant={tenant} currentModule={currentModule} setCurrentModule={setCurrentModule} />}
          {view === 'templates' && <Templates tenant={tenant} />}
          {view === 'audit' && <Audit tenant={tenant} />}
          {view === 'alerts' && <Alerts tenant={tenant} />}
        </section>
      </section>
    </AppShell>
  );
}
