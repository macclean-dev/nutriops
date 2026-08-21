// Tenants públicos — metadata SEM users/PINs. Pode commitar à vontade.
// data.js (gitignored) importa daqui e adiciona usersList + PINs.
//
// Supabase config é injetado em runtime a partir de import.meta.env
// (Vercel env vars: VITE_SB_URL, VITE_SB_ANON_KEY). Veja .env.example.

const SB_URL = import.meta.env.VITE_SB_URL || '';
const SB_KEY = import.meta.env.VITE_SB_ANON_KEY || '';
const HAS_SB = Boolean(SB_URL && SB_KEY);
const SUPABASE = HAS_SB ? { url: SB_URL, anonKey: SB_KEY } : null;

export const tenantsBase = [
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
    modules: ["Temperatura","Higiene Pessoal","Vetores e Pragas","Faxina","Dedetização"],
    audit: [], forms: [], alertsList: [],
    supabase: SUPABASE,
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
    // Espelha o catálogo REAL da nuvem depois da consolidação de 21/08 — o seed
    // só é usado quando a nuvem está vazia, e antes ele ressuscitaria três
    // erros de uma vez:
    //   · "Cozinha" não existe na Bäckerei (confirmado pelo dono, 21/08). A
    //     loja é toda Salão. Esse setor fantasma estava no seed desde sempre e
    //     foi o que a tela mostrou quando perguntei em qual setor ficava —
    //     ou seja, o código respondeu pela loja e eu propaguei o erro pra nuvem.
    //   · "Balcão Refrigerado" não é outro equipamento: é o mesmo Refrigerador
    //     da Bancada com nome antigo (55 das 75 leituras vieram assim). Vira
    //     apelido, não linha própria — duas linhas geram dois cards e dividem
    //     o histórico.
    //   · "Máquina de Gelo" saiu de propósito: não tem visor de temperatura,
    //     então não é equipamento monitorável. As 11 leituras antigas dela
    //     continuam no banco (evidência não se apaga), só não têm cadastro.
    equipmentCatalog: [
      { label: "Refrigerador da Bancada", aliases: ["Balcão Refrigerado","Balcão Refrigerado Horizontal","refrigerador bancada","geladeira bancada"], location: "Salão", minTemp: 0, maxTemp: 9 },
      { label: "Vitrine Confeitaria",     aliases: ["vitrine","vitrine confeitaria","expositor"],                                                     location: "Salão", minTemp: 0, maxTemp: 9 },
    ],
    modules: ["Temperatura","Higiene Pessoal","Vetores e Pragas","Faxina","Dedetização","Potabilidade"],
    audit: [], forms: [], alertsList: [],
    supabase: SUPABASE,
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
    modules: ["Temperatura","Faxina","Manutenção de Equipamentos","Vetores e Pragas"],
    audit: [], forms: [], alertsList: [],
    supabase: SUPABASE,
  },
];
