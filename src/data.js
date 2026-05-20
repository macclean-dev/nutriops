export const tenants = [
  {
    id: "swiss",
    name: "Swiss",
    segment: "Confeitaria",
    plan: "Pro",
    brandColor: "#b91c1c",
    brandSoft: "rgba(185,28,28,.10)",
    localityType: "Loja",
    multiStore: false,
    stores: [{ id: "swiss-bsb", name: "Swiss — Brasília Shopping", location: "Brasília Shopping" }],
    equipmentCatalog: [
      { label: "Freezer",             aliases: ["freezer","câmara congelada","congelador"], location: "Cozinha" },
      { label: "Refrigerador",        aliases: ["refrigerador","geladeira"],                location: "Cozinha" },
      { label: "Vitrine Refrigerada", aliases: ["vitrine","vitrine refrigerada","expositor"],location: "Salão"  },
      { label: "Cervejeiro",          aliases: ["cervejeiro","adega"],                       location: "Salão"  },
      { label: "Máquina de Gelo",     aliases: ["máquina de gelo"],                         location: "Cozinha"},
    ],
    usersList: [
      { name: "Emmilyn Barbosa",  role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
      { name: "Adiel Pinheiro",   role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
      { name: "Antonio Sergio",   role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
      { name: "Laura Isabely",    role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
      { name: "Meyany Irany",     role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
      { name: "Mikael Silva",     role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
      { name: "Shayane Oliveira", role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
      { name: "Fran",             role: "Supervisor",       status: "Ativo", location: "Swiss / Bäckerei", storeId: null,  pin: "6270" },
      { name: "Ana Paula Saraiva",role: "Nutricionista RT", status: "Ativo", location: "Acesso geral",     storeId: null,  pin: "8771" },
    ],
    modules: ["Temperatura","Higiene Pessoal","Vetores e Pragas","Faxina","Dedetização"],
    audit: [], forms: [], alertsList: []
  },
  {
    id: "backerei",
    name: "Bäckerei",
    segment: "Padaria",
    plan: "Enterprise",
    brandColor: "#d4a017",
    brandSoft: "rgba(212,160,23,.12)",
    localityType: "Loja",
    multiStore: false,
    stores: [{ id: "back-bsb", name: "Bäckerei — Brasília Shopping", location: "Brasília Shopping" }],
    equipmentCatalog: [
      { label: "Balcão Refrigerado",      aliases: ["balcão refrigerado","balcão","refrigerador"], location: "Salão"   },
      { label: "Vitrine Confeitaria",      aliases: ["vitrine","vitrine confeitaria","expositor"],  location: "Salão"   },
      { label: "Refrigerador da Bancada",  aliases: ["refrigerador bancada","geladeira bancada"],  location: "Cozinha" },
      { label: "Máquina de Gelo",          aliases: ["máquina de gelo"],                           location: "Cozinha" },
    ],
    usersList: [
      { name: "Sila",              role: "Colaborador",     status: "Ativo", location: "Bäckerei — BSB", storeId: "back-bsb", pin: "0000" },
      { name: "Iuana Silva",       role: "Colaborador",     status: "Ativo", location: "Bäckerei — BSB", storeId: "back-bsb", pin: "0000" },
      { name: "Micaely Medeiros",  role: "Colaborador",     status: "Ativo", location: "Bäckerei — BSB", storeId: "back-bsb", pin: "0000" },
      { name: "Zenilma Cardoso",   role: "Colaborador",     status: "Ativo", location: "Bäckerei — BSB", storeId: "back-bsb", pin: "0000" },
      { name: "Fran",              role: "Supervisor",       status: "Ativo", location: "Swiss / Bäckerei", storeId: null,     pin: "6270" },
      { name: "Ana Paula Saraiva", role: "Nutricionista RT", status: "Ativo", location: "Acesso geral",     storeId: null,     pin: "8771" },
    ],
    modules: ["Temperatura","Higiene Pessoal","Vetores e Pragas","Faxina","Dedetização","Potabilidade"],
    audit: [], forms: [], alertsList: []
  },
  {
    id: "dbk-producao",
    name: "DBK Produção",
    segment: "Produção",
    plan: "Enterprise",
    brandColor: "#1e7a43",
    brandSoft: "rgba(30,122,67,.10)",
    localityType: "Produção",
    multiStore: false,
    stores: [{ id: "dbk-main", name: "DBK — Produção Central", location: "Produção Central" }],
    equipmentCatalog: [
      { label: "Câmara Refrigerada",       aliases: ["câmara refrigerada","câmara fria"],            location: "Estoque"     },
      { label: "Câmara Congelada",         aliases: ["câmara congelada","câmara fria congelada"],     location: "Estoque"     },
      { label: "Refrigerador Confeitaria", aliases: ["refrigerador confeitaria","geladeira confeit"], location: "Confeitaria" },
      { label: "Congelador Confeitaria",   aliases: ["congelador confeitaria","freezer confeitaria"], location: "Confeitaria" },
      { label: "Refrigerador Padaria",     aliases: ["refrigerador padaria","geladeira padaria"],     location: "Padaria"     },
      { label: "Geladeira Dupla Padaria",  aliases: ["geladeira dupla padaria"],                      location: "Padaria"     },
      { label: "Geladeira Dupla Corredor", aliases: ["geladeira dupla corredor","geladeira corredor"],location: "Corredor"    },
    ],
    usersList: [
      { name: "Mateus Portela",    role: "Colaborador",     status: "Ativo", location: "DBK Produção", storeId: "dbk-main", pin: "0000" },
      { name: "Stephanie Barbosa", role: "Colaborador",     status: "Ativo", location: "DBK Produção", storeId: "dbk-main", pin: "0000" },
      { name: "Dominique Ganster", role: "Supervisor",       status: "Ativo", location: "DBK Produção", storeId: "dbk-main", pin: "0000" },
      { name: "Ana Paula Saraiva", role: "Nutricionista RT", status: "Ativo", location: "Acesso geral", storeId: null,       pin: "8771" },
    ],
    modules: ["Temperatura","Faxina","Manutenção de Equipamentos","Vetores e Pragas"],
    audit: [], forms: [], alertsList: []
  }
];

export const globalAdmin = {
  id: 'admin-global', name: 'Administrador', role: 'Administrador',
  location: 'Acesso global', pin: '9999', tenantId: null,
};
