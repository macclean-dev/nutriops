// Roles mapped to NutriOPS profiles
// Funcionário → basic access (own company only)
// Supervisor  → + alerts + audit (own company)
// Nutricionista RT → all companies, validate, training, reports
// Administrador → everything

export const tenants = [
  {
    id: "swiss",
    name: "Swiss",
    segment: "Confeitaria",
    plan: "Pro",
    brandColor: "#b91c1c",
    brandSoft: "rgba(185,28,28,.10)",
    localityType: "Loja",
    stores: ["Swiss - Brasília Shopping"],
    equipmentCatalog: [
      { label: "Freezer", aliases: ["freezer", "câmara congelada", "congelador"] },
      { label: "Refrigerador", aliases: ["refrigerador", "geladeira", "frigorífico"] },
      { label: "Vitrine Refrigerada", aliases: ["vitrine", "vitrine refrigerada", "expositor"] }
    ],
    users: 18,
    usersList: [
      { name: "Ana Souza",   role: "Funcionário",      status: "Ativo",   location: "Confeitaria",      pin: "0000" },
      { name: "Bruno Lima",  role: "Supervisor",        status: "Ativo",   location: "Brasília Shopping", pin: "0000" },
      { name: "Carla Nunes", role: "Nutricionista RT",  status: "Ativo",   location: "Acesso geral",      pin: "1234" }
    ],
    formsToday: 42, alerts: 3, compliance: 91,
    modules: ["Temperatura", "Higienização", "Capacitação", "Auditoria"],
    audit: [
      { label: "Temperaturas no prazo", value: "38/42", status: "ok" },
      { label: "Pendências abertas",    value: "3",     status: "warn" },
      { label: "Última inspeção",       value: "Hoje, 09:20", status: "ok" }
    ],
    forms: [
      { name: "Temperatura do freezer",      frequency: "Diário",  owner: "Funcionário", requirement: "Faixa: -18°C",             status: "ok" },
      { name: "Higienização de equipamentos", frequency: "Semanal", owner: "Supervisor",  requirement: "Assinatura obrigatória",    status: "warn" },
      { name: "Capacitação de planilhas",     frequency: "Eventual",owner: "RT",          requirement: "Lista de presença",         status: "ok" }
    ],
    alertsList: [
      { title: "Temperatura da vitrine acima do limite", detail: "Brasília Shopping - Confeitaria", level: "danger" },
      { title: "Faxina semanal pendente",                detail: "Asa Sul - produção",              level: "warn" },
      { title: "Treinamento próximo do vencimento",      detail: "Equipe noturna",                  level: "warn" }
    ]
  },
  {
    id: "backerei",
    name: "Bäckerei",
    segment: "Padaria",
    plan: "Enterprise",
    brandColor: "#d4a017",
    brandSoft: "rgba(212,160,23,.12)",
    localityType: "Loja",
    stores: ["Bäckerei - Brasília Shopping", "Bäckerei - Shopping 2"],
    equipmentCatalog: [
      { label: "Refrigerador",    aliases: ["refrigerador", "geladeira", "frigorífico"] },
      { label: "Câmara Congelada",aliases: ["câmara congelada", "freezer", "congelador"] },
      { label: "Forno",           aliases: ["forno", "forno turbo"] },
      { label: "Masseira",        aliases: ["masseira", "misturador"] }
    ],
    users: 34,
    usersList: [
      { name: "Diego Rocha",    role: "Funcionário",      status: "Ativo",   location: "Padaria 1",    pin: "0000" },
      { name: "Fernanda Alves", role: "Supervisor",        status: "Ativo",   location: "Padaria 2",    pin: "0000" },
      { name: "Mariana Costa",  role: "Nutricionista RT",  status: "Ativo",   location: "Acesso geral", pin: "1234" },
      { name: "Paulo Santos",   role: "Funcionário",       status: "Pendente",location: "Produção",     pin: "0000" }
    ],
    formsToday: 61, alerts: 5, compliance: 94,
    modules: ["Temperatura", "Higiene Pessoal", "Dedetização", "Manutenção"],
    audit: [
      { label: "Registros do mês",   value: "1.248", status: "ok" },
      { label: "Não conformidades",  value: "5",     status: "warn" },
      { label: "Histórico disponível",value: "3 meses",status: "ok" }
    ],
    forms: [
      { name: "Higiene pessoal", frequency: "Diário",  owner: "Supervisor", requirement: "Checklist por turno",    status: "ok" },
      { name: "Dedetização",     frequency: "Mensal",  owner: "RT",         requirement: "Comprovante anexo",      status: "ok" },
      { name: "Calibração",      frequency: "Anual",   owner: "RT",         requirement: "Laudo obrigatório",      status: "danger" }
    ],
    alertsList: [
      { title: "Laudo de calibração ausente",         detail: "Geladeira confeitaria", level: "danger" },
      { title: "Checklist de higiene pessoal incompleto",detail: "Turno manhã",        level: "warn" },
      { title: "Auditoria fiscal em 7 dias",          detail: "Preparar exportação PDF",level: "ok" }
    ]
  },
  {
    id: "dbk-producao",
    name: "DBK Produção",
    segment: "Produção",
    plan: "Enterprise",
    brandColor: "#1e7a43",
    brandSoft: "rgba(30,122,67,.10)",
    localityType: "Produção",
    stores: ["DBK - Produção Central"],
    equipmentCatalog: [
      { label: "Câmara Refrigerada", aliases: ["câmara refrigerada", "geladeira", "refrigerador"] },
      { label: "Câmara Congelada",   aliases: ["câmara congelada", "freezer", "congelador"] },
      { label: "Balança",            aliases: ["balança", "balanca"] }
    ],
    users: 22,
    usersList: [
      { name: "Rafael Vieira", role: "Funcionário",      status: "Ativo", location: "Produção central", pin: "0000" },
      { name: "Tatiana Melo",  role: "Supervisor",        status: "Ativo", location: "Expedição",        pin: "0000" },
      { name: "Vera Martins",  role: "Nutricionista RT",  status: "Ativo", location: "Acesso geral",     pin: "1234" }
    ],
    formsToday: 48, alerts: 2, compliance: 96,
    modules: ["Temperatura", "Produção", "Higienização", "Expedição", "Auditoria"],
    audit: [
      { label: "Lotes produzidos",       value: "126",        status: "ok" },
      { label: "Pendências de produção", value: "2",          status: "warn" },
      { label: "Aferição do dia",        value: "Hoje, 06:40",status: "ok" }
    ],
    forms: [
      { name: "Temperatura da câmara",   frequency: "Diário",   owner: "Supervisor", requirement: "Faixa: 0°C a 4°C",          status: "ok" },
      { name: "Checklist de produção",   frequency: "Por lote", owner: "Funcionário",requirement: "Sequência obrigatória",      status: "ok" },
      { name: "Higienização da área",    frequency: "Diário",   owner: "Supervisor", requirement: "Assinatura por turno",       status: "warn" }
    ],
    alertsList: [
      { title: "Lote aguardando conferência",      detail: "Produção central", level: "warn" },
      { title: "Higienização da área úmida pendente",detail: "Turno da tarde", level: "warn" }
    ]
  }
];

// Global admin user (acesso a todas as empresas)
export const globalAdmin = {
  id:       'admin-global',
  name:     'Administrador',
  role:     'Administrador',
  location: 'Acesso global',
  pin:      '9999',
  tenantId: null, // sees all tenants
};
