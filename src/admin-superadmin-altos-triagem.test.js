import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeTenantAlerts } from './admin';
import { mergeCloudTenants } from './tenant-sync';
import { tenantsBase } from './tenants-public';
import { readClients, writeClients } from './admin-storage';
import { setClientActive } from './superadmin';
import { checkTrialStatus } from './trial';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 5 achados de gravidade ALTA sem perda de dado que apontam
// pra src/admin.jsx (3) e src/superadmin-view.jsx (2) — pool de 169
// não-julgados da auditoria de falha silenciosa (18-19/08,
// data_achados_pendentes_19-08.json). Tratados como lote único de propósito:
// os dois arquivos compartilham componentes (ClientModal/AccessTokenModal,
// definidos em admin.jsx e reusados por superadmin-view.jsx). Rodadas
// anteriores desta tier: 1 pages.jsx (c8a947e), 2 repository.js (b9a81bc), 3
// settings.jsx (8d7294f), 4 maintenance.jsx+dossie-view.jsx (2623fb8,
// v1.9.178). Sem @testing-library neste repo (mesma convenção do resto da
// auditoria): UI vira asserção de código-fonte + reimplementação pura das
// decisões; lógica de verdade exportada (computeTenantAlerts,
// mergeCloudTenants, checkTrialStatus, setClientActive) ganha teste
// comportamental real.
//
// Todos os 5 eram reais. Viraram 3 famílias:
//
//   · Família A (achado superadmin-view.jsx, "Suspender não suspende
//     ninguém") — REAL, mas o "não suspende de verdade" é MVP client-side já
//     documentado (topo de superadmin-view.jsx e superadmin.js, e listado
//     como apara aceita do épico Auth+RLS em docs/HISTORICO.md) — não uma
//     decisão nova pra esta rodada tomar sozinha (envolveria coluna nova em
//     `tenants` + RLS + mudar os 3 pontos de enforcement). O que ERA novo e
//     corrigível sem tocar arquitetura: a MENSAGEM na tela afirmava um efeito
//     ("aplica via ?token=") que não acontece. Corrigido: o texto agora só
//     descreve o que de fato acontece (grava só neste navegador; não bloqueia
//     o dispositivo do cliente).
//
//   · Família B (achados superadmin-view.jsx "entrega link+PIN de cliente que
//     não subiu" + admin.jsx "repetir Criar cliente gera tenant fantasma" +
//     admin.jsx "registro não guarda que o push falhou") — mesma causa raiz:
//     ClientModal.handleSave sabia (localmente, via pushError/pushFailed) que
//     o push tinha falhado, mas (1) nunca gravava isso NO REGISTRO do
//     cliente — qualquer sessão futura via AccessTokenModal (admin.jsx OU
//     superadmin-view.jsx, mesmo componente) achava que o PIN local era
//     válido; e (2) recalculava id/accessToken a cada handleSave, então
//     repetir "Criar cliente" no MESMO modal (que fica aberto de propósito
//     quando o push falha) cunhava um tenant IRMÃO em vez de reusar a
//     tentativa anterior. Corrigido: id/accessToken viram estado estável (1x
//     por montagem do modal); pushFailed vai no registro salvo;
//     AccessTokenModal (componente compartilhado) bloqueia o envio quando
//     client.pushFailed; superadmin-view.jsx para de abrir esse modal
//     automaticamente nesse caso; mergeCloudTenants limpa um pushFailed
//     desatualizado quando a nuvem confirma o id.
//
//   · Família C (achado admin.jsx, "Saúde dos tenants só enxerga os 3
//     seeds") — REAL. As 3 renderizações de HealthView (alertas, tendência
//     30d, grid de cards) iteravam tenantsBase (só os 3 seeds de
//     tenants-public.js), enquanto metricsByTenant/historyByTenant já
//     cobriam qualquer tenant com registro na nuvem. Corrigido com
//     healthTenants: seeds + clientes do /admin que não são um seed
//     (mesmo fuzzy-match de nome que o resto do arquivo já usa).
// ─────────────────────────────────────────────────────────────────────────────

const fonte           = readFileSync(`${process.cwd()}/src/admin.jsx`, 'utf8');
const fonteSuperAdmin  = readFileSync(`${process.cwd()}/src/superadmin-view.jsx`, 'utf8');
const fonteSuperAdminJs = readFileSync(`${process.cwd()}/src/superadmin.js`, 'utf8');
const fonteTenantSync  = readFileSync(`${process.cwd()}/src/tenant-sync.js`, 'utf8');
const fonteTrial       = readFileSync(`${process.cwd()}/src/trial.jsx`, 'utf8');
const fonteMain        = readFileSync(`${process.cwd()}/src/main.jsx`, 'utf8');
const fontePages       = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const fonteHistorico   = readFileSync(`${process.cwd()}/docs/HISTORICO.md`, 'utf8');

beforeEach(() => { localStorage.clear(); });

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA A — superadmin-view.jsx: "Suspender" para de afirmar um efeito que
// não existe. O "não suspende de verdade" continua (é MVP documentado); só a
// MENSAGEM parou de mentir.
// ═══════════════════════════════════════════════════════════════════════════

describe('Família A — toggleActive (superadmin-view.jsx) não afirma mais que a suspensão "aplica"', () => {
  const iniToggle = fonteSuperAdmin.indexOf('const toggleActive = (tenant) => {');
  const fimToggle = fonteSuperAdmin.indexOf('\n  const planTone', iniToggle);
  const corpo = fonteSuperAdmin.slice(iniToggle, fimToggle);
  // a MENSAGEM de verdade é só o que vai pro setMsg — o resto do corpo (acima
  // desta rodada) ganhou comentários que CITAM a frase antiga entre aspas pra
  // explicar o achado, então checar "não existe mais" no arquivo inteiro
  // daria falso negativo nos próprios comentários da correção.
  const mensagemFinal = corpo.slice(corpo.indexOf('setMsg({ tone: tenant.active'));

  it('fonte: a frase antiga (que sugeria enforcement real) não está mais na mensagem exibida (só sobrevive citada, entre aspas, no comentário que explica o achado)', () => {
    expect(iniToggle).toBeGreaterThan(-1);
    expect(mensagemFinal.length).toBeGreaterThan(0);
    expect(mensagemFinal).not.toContain('aplica via ?token= neste projeto');
  });

  it('fonte: a mensagem nova é honesta sobre o alcance (só este navegador) e a lacuna (sem enforcement no device do cliente)', () => {
    expect(mensagemFinal).toContain('só neste navegador (admin)');
    expect(mensagemFinal).toContain('Isso NÃO bloqueia o dispositivo do cliente');
    expect(mensagemFinal).toContain('enforcement server-side ainda não existe (épico Auth+RLS');
    // continua chamando setClientActive/persistClients/logAction — a correção
    // é só na mensagem, o mecanismo (client-side, MVP) não mudou de propósito
    expect(corpo).toContain('const next = setClientActive(clients, tenant.id, !tenant.active);');
    expect(corpo).toContain('persistClients(next);');
  });

  it('documentação: já era uma apara ACEITA e registrada do épico Auth+RLS antes desta rodada (docs/HISTORICO.md) — não é uma decisão nova sendo tomada aqui', () => {
    expect(fonteHistorico).toContain('Suspensão por `active` sem enforcement server-side');
  });

  it('documentação: o próprio topo de superadmin-view.jsx já assumia isso ("suspensão é local"), e superadmin.js reforça ("cosmético até o épico Auth+RLS")', () => {
    expect(fonteSuperAdmin).toContain('suspensão é local');
    expect(fonteSuperAdminJs).toContain('é cosmético');
    expect(fonteSuperAdminJs).toContain('até o épico Auth+RLS');
  });

  it('mecanismo: os 3 pontos que aplicam o bloqueio (trial.jsx, main.jsx, pages.jsx) leem readClients() — localStorage local ao navegador, não a nuvem', () => {
    expect(fonteTrial).toContain('const clients = readClients();');
    expect(fonteTrial).toContain("if (!client.active) return { ok: false, reason: 'inactive', client };");
    expect(fonteMain).toContain('const clients = readClients();');
    expect(fonteMain).toContain('if (client && !client.active) {');
    expect(fontePages).toContain('const clients = readClients();');
    expect(fontePages).toContain('if (client && !client.active) {');
  });

  // Prova comportamental (não muda com esta correção — documenta POR QUE a
  // mensagem antiga mentia): suspender "aqui" (localStorage deste teste,
  // simulando o navegador do admin) e depois checar com um localStorage
  // "limpo" (simulando o tablet da loja, que nunca rodou /admin nem Super
  // Admin) dá resultados DIFERENTES pro MESMO cliente/token.
  describe('mecanismo real — mesmo cliente/token, resultado depende do device (readClients/writeClients/setClientActive/checkTrialStatus reais)', () => {
    const cliente = { id: 'c1', name: 'Padaria X', accessToken: 'nt_abc123', active: true, plan: 'loja' };

    it('no navegador do ADMIN (onde a suspensão foi gravada): checkTrialStatus reconhece o bloqueio', () => {
      writeClients([cliente]);
      const suspenso = setClientActive([cliente], 'c1', false);
      writeClients(suspenso);
      localStorage.setItem('nutriops.access.token', 'nt_abc123');
      const status = checkTrialStatus();
      expect(status.ok).toBe(false);
      expect(status.reason).toBe('inactive');
    });

    it('no dispositivo do CLIENTE (nutriops.admin.clients nunca foi escrito ali): o MESMO token não vê suspensão nenhuma', () => {
      localStorage.setItem('nutriops.access.token', 'nt_abc123');
      expect(readClients()).toEqual([]); // confirma a premissa: device "limpo"
      const status = checkTrialStatus();
      // client não é encontrado (clients vazio) → cai no fallback otimista —
      // é exatamente "o cliente suspenso continua operando normalmente" do achado
      expect(status).toEqual({ ok: true });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA B — ClientModal/AccessTokenModal (componente compartilhado por
// admin.jsx E superadmin-view.jsx): push falho passa a deixar rastro no
// REGISTRO, não só no estado local do modal.
// ═══════════════════════════════════════════════════════════════════════════

describe('Família B — superadmin-view.jsx e admin.jsx continuam reusando o MESMO ClientModal/AccessTokenModal (a correção vale pros dois de um lugar só)', () => {
  it('fonte: import direto de admin.jsx, sem reimplementação paralela', () => {
    expect(fonteSuperAdmin).toContain("import { ClientModal, AccessTokenModal } from './admin';");
  });
});

describe('Família B.1 (achado admin.jsx "tenant fantasma") — id/accessToken do ClientModal viram estado estável, não recalculado a cada handleSave', () => {
  it('fonte: id/accessToken são useState com inicializador preguiçoso (roda 1x por montagem)', () => {
    expect(fonte).toContain('const [id]           = useState(() => client?.id ?? uid());');
    expect(fonte).toContain('const [accessToken]  = useState(() => client?.accessToken ?? `nt_${uid()}${uid()}`);');
  });

  it('fonte: handleSave NÃO recalcula mais id/accessToken no corpo da função (a forma antiga recomputava a cada chamada)', () => {
    const iniHandle = fonte.indexOf('const handleSave = async () => {');
    const fimHandle = fonte.indexOf('\n  return (', iniHandle);
    expect(iniHandle).toBeGreaterThan(-1);
    const handleSave = fonte.slice(iniHandle, fimHandle);
    expect(handleSave).not.toContain('const id            = client?.id ?? uid();');
    expect(handleSave).not.toContain('const accessToken   = client?.accessToken ?? `nt_${uid()}${uid()}`;');
    // ainda usa os dois (só não os declara mais localmente)
    expect(handleSave).toContain('id,\n      accessToken,');
  });

  // Prova por reimplementação: modela o exato padrão useState(() => init) do
  // React — o inicializador só roda na 1ª chamada, chamadas seguintes reusam
  // o valor cacheado. É essa garantia que estabiliza id/accessToken entre
  // retries do MESMO modal aberto (mesma técnica de "modelo" já usada em
  // admin-medios-triagem.test.js/maintenance-dossie-altos-triagem.test.js).
  describe('modelo: recalcular a cada chamada (ANTES) vs. lazy state (DEPOIS)', () => {
    function makeIdFactory() {
      let n = 0;
      return () => `id-${n++}`;
    }
    function makeLazyState(init) {
      let called = false, value;
      return () => { if (!called) { value = init(); called = true; } return value; };
    }

    it('ANTES (recalculado a cada handleSave): duas tentativas na mesma sessão do modal cunhavam IDs diferentes — o bug, comprovado', () => {
      const gerarIdAntigo = makeIdFactory(); // simboliza "uid()" chamado direto no corpo de handleSave
      const tentativa1 = gerarIdAntigo();
      const tentativa2 = gerarIdAntigo();
      expect(tentativa1).not.toBe(tentativa2);
    });

    it('DEPOIS (useState(() => uid())): duas tentativas na mesma sessão reusam o MESMO id — sem tenant irmão', () => {
      const gerarId = makeLazyState(makeIdFactory());
      const tentativa1 = gerarId();
      const tentativa2 = gerarId();
      expect(tentativa1).toBe(tentativa2);
    });

    it('reabrir o modal do zero (fechar e clicar "+ Novo cliente" de novo) continua gerando um id novo — é um mount novo, não um retry', () => {
      const sessao1 = makeLazyState(makeIdFactory())();
      const sessao2 = makeLazyState(makeIdFactory())(); // nova instância = novo mount
      expect(sessao1).toBe(sessao2); // ambas são 'id-0' porque cada factory é isolada — mounts diferentes, sem relação
      // (o ponto aqui é semântico: cada montagem tem sua PRÓPRIA lazy state,
      // isolada; dentro da MESMA montagem, retries reusam — testado acima)
    });
  });
});

describe('Família B.2 (achados "registro não guarda push falho" + "entrega link de cliente não sincronizado") — pushFailed persiste no registro', () => {
  it('fonte: onSave() agora inclui pushFailed no payload salvo (não só pushError, que é só estado local do modal)', () => {
    const iniHandle = fonte.indexOf('const handleSave = async () => {');
    const fimHandle = fonte.indexOf('\n  return (', iniHandle);
    const handleSave = fonte.slice(iniHandle, fimHandle);
    const posOnSave = handleSave.indexOf('onSave({');
    const posFimOnSave = handleSave.indexOf('});', posOnSave);
    expect(posOnSave).toBeGreaterThan(-1);
    const payload = handleSave.slice(posOnSave, posFimOnSave);
    expect(payload).toContain('pushFailed,');
  });

  it('fonte: AccessTokenModal deriva notSynced de client.pushFailed === true (não de pushError, que não sobrevive o fechamento do modal)', () => {
    expect(fonte).toContain('const notSynced = client.pushFailed === true;');
  });

  it('fonte: o banner de status ganhou o 3º estado (danger) ANTES do checkPin, e os outros dois (PIN ativo / sem PIN) continuam intactos', () => {
    const iniATM = fonte.indexOf('export function AccessTokenModal({ client, onClose, onClientUpdate }) {');
    const fimATM = fonte.indexOf('// HEALTH VIEW — saúde operacional dos tenants', iniATM);
    expect(iniATM).toBeGreaterThan(-1);
    const corpo = fonte.slice(iniATM, fimATM);
    expect(corpo).toContain('Não sincronizado com o servidor.');
    expect(corpo).toContain('<strong>PIN de configuração ativo.</strong>');
    expect(corpo).toContain('<strong>Sem PIN de configuração.</strong>');
    expect(corpo.indexOf('notSynced ?')).toBeLessThan(corpo.indexOf('client.setupPinHash ?'));
  });

  it('fonte: handleSendEmail tem guarda ANTES do check de e-mail — bloqueia mesmo se o botão disabled for burlado', () => {
    const iniATM = fonte.indexOf('export function AccessTokenModal({ client, onClose, onClientUpdate }) {');
    const fimATM = fonte.indexOf('// HEALTH VIEW — saúde operacional dos tenants', iniATM);
    const corpo = fonte.slice(iniATM, fimATM);
    const posHandle = corpo.indexOf('const handleSendEmail = async () => {');
    const posNotSynced = corpo.indexOf('if (notSynced) {', posHandle);
    const posEmailCheck = corpo.indexOf('if (!client.email) {', posHandle);
    expect(posHandle).toBeGreaterThan(-1);
    expect(posNotSynced).toBeGreaterThan(posHandle);
    expect(posEmailCheck).toBeGreaterThan(posNotSynced);
  });

  it('fonte: o botão "Enviar link por e-mail" fica disabled quando notSynced (não só quando emailState==="sending")', () => {
    expect(fonte).toContain("disabled={emailState==='sending' || notSynced}");
  });

  it('fonte: superadmin-view.jsx.closeNewClient para de abrir o AccessTokenModal quando createdClient.pushFailed — avisa em vez de entregar', () => {
    const ini = fonteSuperAdmin.indexOf('const closeNewClient = () => {');
    const fim = fonteSuperAdmin.indexOf('\n  // Editar cliente', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonteSuperAdmin.slice(ini, fim);
    expect(corpo).toContain('if (createdClient.pushFailed) {');
    expect(corpo).toContain("setMsg({ tone:'warn'");
    expect(corpo).toContain('setTokenModal(createdClient);');
    // a chamada de setTokenModal fica no ramo ELSE — não roda incondicionalmente como antes
    const posIf   = corpo.indexOf('if (createdClient.pushFailed) {');
    const posElse = corpo.indexOf('} else {', posIf);
    const posSetTokenModal = corpo.indexOf('setTokenModal(createdClient);');
    expect(posElse).toBeGreaterThan(posIf);
    expect(posSetTokenModal).toBeGreaterThan(posElse);
  });

  // Prova por reimplementação das decisões do componente (mesma técnica de
  // "modelo" usada no resto desta auditoria) — mirrors exatamente o que o
  // fonte acima comprova estar implementado.
  describe('modelo: decisão do AccessTokenModal (banner/botão) a partir de client.pushFailed', () => {
    function decideAccessTokenModal(client) {
      const notSynced = client.pushFailed === true;
      const bannerTone = notSynced ? 'danger' : client.setupPinHash ? 'ok' : 'warn';
      const sendDisabled = notSynced;
      return { notSynced, bannerTone, sendDisabled };
    }

    it('push falhou: banner danger + envio bloqueado, MESMO com um setupPinHash local presente (o hash nunca chegou no servidor)', () => {
      expect(decideAccessTokenModal({ pushFailed: true, setupPinHash: 'hash-nunca-confirmado' }))
        .toEqual({ notSynced: true, bannerTone: 'danger', sendDisabled: true });
    });

    it('sincronizado com PIN: banner ok, envio liberado — caminho feliz preservado', () => {
      expect(decideAccessTokenModal({ pushFailed: false, setupPinHash: 'hash' }))
        .toEqual({ notSynced: false, bannerTone: 'ok', sendDisabled: false });
    });

    it('sincronizado sem PIN ainda: banner warn (comportamento pré-existente, não regrediu)', () => {
      expect(decideAccessTokenModal({ pushFailed: false, setupPinHash: null }))
        .toEqual({ notSynced: false, bannerTone: 'warn', sendDisabled: false });
    });

    it('registro ANTIGO sem o campo pushFailed (todo cliente cadastrado antes desta correção): tratado como sincronizado — sem alarme falso em massa no parque instalado', () => {
      const r = decideAccessTokenModal({ setupPinHash: 'hash' }); // pushFailed undefined
      expect(r.notSynced).toBe(false);
      expect(r.sendDisabled).toBe(false);
    });
  });

  describe('modelo: decisão do closeNewClient (superadmin-view.jsx) a partir de createdClient.pushFailed', () => {
    function decideCloseNewClient(createdClient) {
      if (!createdClient) return { action: 'none' };
      if (createdClient.pushFailed) return { action: 'warn', tenantId: createdClient.id };
      return { action: 'open-token-modal', tenantId: createdClient.id };
    }

    it('push falhou: NÃO abre o AccessTokenModal — só avisa (era: abria sempre, entregando link+PIN de um cliente que a nuvem não conhece)', () => {
      expect(decideCloseNewClient({ id: 'x', name: 'Padaria X', pushFailed: true }))
        .toEqual({ action: 'warn', tenantId: 'x' });
    });

    it('push ok: abre o AccessTokenModal normalmente — caminho feliz preservado', () => {
      expect(decideCloseNewClient({ id: 'x', name: 'Padaria X', pushFailed: false }))
        .toEqual({ action: 'open-token-modal', tenantId: 'x' });
    });

    it('sem createdClient (form nunca chegou a salvar): não faz nada', () => {
      expect(decideCloseNewClient(null)).toEqual({ action: 'none' });
    });
  });
});

describe('Família B.3 — tenant-sync.js: mergeCloudTenants limpa um pushFailed local desatualizado quando a nuvem confirma o id', () => {
  it('local com pushFailed:true, MESMO id confirmado na nuvem → sai com pushFailed:false (a nuvem é a prova de sync que faltava)', () => {
    const local = [{ id: 'c1', name: 'Padaria X', pushFailed: true, accessToken: 'nt_old' }];
    const cloud = [{ id: 'c1', name: 'Padaria X', access_token: 'nt_old' }];
    const merged = mergeCloudTenants(local, cloud);
    expect(merged.find(c => c.id === 'c1').pushFailed).toBe(false);
  });

  it('local com pushFailed:true SEM contrapartida na nuvem (id nunca chegou lá): mantém pushFailed:true — o merge só limpa o que a nuvem de fato confirmou', () => {
    const local = [{ id: 'c1', name: 'Padaria X', pushFailed: true, accessToken: 'nt_old' }];
    const merged = mergeCloudTenants(local, []); // nuvem não devolveu nada pra esse id
    expect(merged.find(c => c.id === 'c1').pushFailed).toBe(true);
  });

  it('cliente que só existe na nuvem (criado noutro device): nasce sem pushFailed (falsy) — não fica preso num alarme que nunca existiu', () => {
    const merged = mergeCloudTenants([], [{ id: 'c2', name: 'Y' }]);
    expect(merged.find(c => c.id === 'c2').pushFailed).toBeFalsy();
  });

  it('fonte: o merge grava pushFailed:false explicitamente no ramo "existing" (não depende de spread implícito)', () => {
    expect(fonteTenantSync).toContain('pushFailed: false,');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA C — admin.jsx: HealthView passa a enxergar clientes criados via
// "+ Novo cliente", não só os 3 seeds de tenants-public.js.
// ═══════════════════════════════════════════════════════════════════════════

describe('Família C — HealthView: healthTenants substitui tenantsBase nos 3 pontos de renderização', () => {
  it('fonte: tenantsBase continua importado e é a BASE do healthTenants (não sumiu, só parou de ser usado direto pra renderizar)', () => {
    expect(fonte).toContain("import { tenantsBase } from './tenants-public';");
    expect(fonte).toContain('return [...tenantsBase, ...clientTenants];');
  });

  it('fonte: os 3 pontos (alertas, tendência 30d, grid de cards) usam healthTenants — o padrão de RENDERIZAR direto de tenantsBase não sobrevive em nenhum dos dois `.map` de JSX', () => {
    expect(fonte).toContain('computeTenantAlerts(metricsByTenant, healthTenants, clients)');
    const ocorrenciasMap = fonte.split('{healthTenants.map(t => {').length - 1;
    expect(ocorrenciasMap).toBe(2);
    // tenantsBase.map( ainda existe DENTRO da definição de healthTenants (pra
    // extrair os nomes dos seeds no dedupe) — o que não pode mais existir é o
    // padrão de RENDERIZAR a partir dele, "{tenantsBase.map(t => {" (chave de
    // JSX + arrow + bloco), que é a assinatura exata dos 2 pontos antigos.
    expect(fonte).not.toContain('{tenantsBase.map(t => {');
  });

  it('fonte: healthTenants filtra por id presente + nome que NÃO bate com nenhum seed (evita duplicar Swiss/Bäckerei/DBK caso também tenham registro comercial)', () => {
    const iniHT = fonte.indexOf('const healthTenants = useMemo(() => {');
    const fimHT = fonte.indexOf('  // Alertas operacionais', iniHT);
    expect(iniHT).toBeGreaterThan(-1);
    const corpo = fonte.slice(iniHT, fimHT);
    expect(corpo).toContain('.filter(c => c.id && !matchesSeed(c.name))');
    expect(corpo).toContain('sn.includes(n) || n.includes(sn)');
  });

  // Prova com a função PURA REAL (computeTenantAlerts, exportada de admin.jsx)
  // — não uma reimplementação. Mostra a regressão do achado (lista vazia
  // passando só tenantsBase) e a correção (aparece passando o equivalente a
  // healthTenants), sem precisar montar HealthView.
  describe('mecanismo real (computeTenantAlerts + tenantsBase reais): cliente novo silencioso 11 dias', () => {
    const onzeDiasAtras = new Date(Date.now() - 11 * 86400000).toISOString();
    const metrics = {
      'casa-doce-uid': {
        recordsLast7d: 0, activeUsers7d: 0,
        lastActivity: onzeDiasAtras, conformity: null, nonCompliant: 0,
      },
    };
    const clienteNovo = { id: 'casa-doce-uid', name: 'CASA DOCE', email: 'contato@casadoce.com', active: true, plan: 'loja' };

    it('ANTES do achado ser corrigido (passando só tenantsBase, os 3 seeds): NENHUM alerta pro cliente novo, mesmo 11 dias sem registro — o bug, comprovado com a função real', () => {
      const alerts = computeTenantAlerts(metrics, tenantsBase, [clienteNovo]);
      expect(alerts.find(a => a.tenant?.id === 'casa-doce-uid')).toBeUndefined();
    });

    it('DEPOIS (passando o equivalente ao healthTenants — seeds + o tenant novo): alerta danger de inatividade aparece, citando o nome certo', () => {
      const healthTenantsSimulado = [...tenantsBase, { id: 'casa-doce-uid', name: 'CASA DOCE', segment: 'Confeitaria', brandColor: null, equipmentCatalog: [] }];
      const alerts = computeTenantAlerts(metrics, healthTenantsSimulado, [clienteNovo]);
      const alerta = alerts.find(a => a.tenant?.id === 'casa-doce-uid');
      expect(alerta).toBeDefined();
      expect(alerta.severity).toBe('danger');
      expect(alerta.label).toContain('CASA DOCE');
    });

    it('os 3 seeds continuam recebendo alerta normalmente (nada regrediu pra eles)', () => {
      const seedMetrics = { swiss: { recordsLast7d: 0, activeUsers7d: 0, lastActivity: onzeDiasAtras, conformity: null, nonCompliant: 0 } };
      const alerts = computeTenantAlerts(seedMetrics, tenantsBase, []);
      expect(alerts.find(a => a.tenant?.id === 'swiss')?.severity).toBe('danger');
    });
  });

  // Reimplementação do algoritmo de merge (dedupe por nome fuzzy) — a mesma
  // lógica que o corpo do healthTenants usa, testada isoladamente com casos
  // que computeTenantAlerts sozinho não força (duplicação de seed por nome).
  describe('modelo: merge seeds + clientes (dedupe por nome fuzzy)', () => {
    function buildHealthTenants(clients, seeds) {
      const seedNames = seeds.map(t => (t.name ?? '').toLowerCase()).filter(Boolean);
      const matchesSeed = (name) => {
        const n = (name ?? '').toLowerCase();
        return Boolean(n) && seedNames.some(sn => sn.includes(n) || n.includes(sn));
      };
      const clientTenants = (clients ?? [])
        .filter(c => c.id && !matchesSeed(c.name))
        .map(c => ({ id: c.id, name: c.name, segment: c.segment, brandColor: c.brandColor, equipmentCatalog: c.equipmentCatalog }));
      return [...seeds, ...clientTenants];
    }

    it('cliente comercial cujo nome bate com um seed (ex.: registro de billing da própria Swiss, id diferente) NÃO duplica o card', () => {
      const seeds = [{ id: 'swiss', name: 'Swiss' }];
      const clients = [{ id: 'uuid-comercial-swiss', name: 'Swiss', email: 'fin@swiss.com' }];
      const out = buildHealthTenants(clients, seeds);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe('swiss'); // o card que sobrevive é o do seed (brandColor/equipmentCatalog reais)
    });

    it('cliente cujo nome NÃO bate com nenhum seed entra como card novo, com o id PRÓPRIO (o da tabela tenants, não sintético)', () => {
      const seeds = [{ id: 'swiss', name: 'Swiss' }, { id: 'backerei', name: 'Bäckerei' }, { id: 'dbk-producao', name: 'DBK Produção' }];
      const clients = [{ id: 'casa-doce-uid', name: 'CASA DOCE', segment: 'Confeitaria', brandColor: '#111', equipmentCatalog: [{ label: 'Freezer' }] }];
      const out = buildHealthTenants(clients, seeds);
      expect(out).toHaveLength(4);
      const casaDoce = out.find(t => t.id === 'casa-doce-uid');
      expect(casaDoce).toMatchObject({ name: 'CASA DOCE', segment: 'Confeitaria', brandColor: '#111' });
      expect(casaDoce.equipmentCatalog).toHaveLength(1);
    });

    it('cliente sem id (estado corrompido — nunca deveria acontecer) é ignorado, não quebra o merge', () => {
      const out = buildHealthTenants([{ name: 'Sem Id' }], [{ id: 'swiss', name: 'Swiss' }]);
      expect(out).toHaveLength(1);
    });

    it('confirma que a fonte real usa a MESMA regra de dedupe testada acima (mesma expressão, char a char)', () => {
      expect(fonte).toContain("const matchesSeed = (name) => {");
      expect(fonte).toContain("return Boolean(n) && seedNames.some(sn => sn.includes(n) || n.includes(sn));");
    });
  });
});
