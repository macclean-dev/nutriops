import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isGlobalAdmin } from './permissions';
import { pendingTemperatureItems, excludeWithAction } from './nonconformities';
import { resolveRecordTone } from './limits';

// ─────────────────────────────────────────────────────────────────────────────
// 1ª rodada da tier "alta / sem perda de dado" — categoria nova, nunca triada
// até esta sessão (35 achados; ficou invisível por um erro de contagem
// anterior). Pool: os 7 achados desta tier que apontam pra src/pages.jsx.
//
// Numeração abaixo = ordem em que os achados saíram do filtro do JSON de
// pendências (data_achados_pendentes_19-08.json), 1-indexado pra leitura.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
// Achado 1/7 — "✓ Registro salvo" aparece com ZERO registros gravados
// (TemperatureCapture, dentro de OverviewView)
// ═══════════════════════════════════════════════════════════════════════════
//
// JÁ CORRIGIDO antes desta sessão: commit 6b340a5 (v1.9.159, madrugada de
// 19/08) introduziu `rascunhosGravaveis` como fonte única de pendingDrafts/
// toSave — exatamente o defeito que este achado descreve ("pendingDrafts=2,
// toSave=[], e a tela mostra '✓ Registro salvo' mesmo assim"). Coberto a
// fundo por captura-rascunhos.test.js; aqui só um travamento curto pra este
// pool específico, MAIS a correção de uma conclusão daquele commit.
describe('achado 1/7 — TemperatureCapture: pendingDrafts e toSave não podem mais divergir', () => {
  it('rascunhosGravaveis é fonte única — o contador do botão e o laço de gravação usam a MESMA lista', () => {
    expect(fonte).toContain('const rascunhosGravaveis = useMemo(');
    expect(fonte).toContain('const pendingDrafts = rascunhosGravaveis.length;');
    expect(fonte).toContain('const toSave = rascunhosGravaveis;');
  });

  it('handleSaveAll sai ANTES de qualquer "saved" quando não há nada pra gravar', () => {
    expect(fonte).toContain('const handleSaveAll = async () => {\n    if (pendingDrafts === 0) return;');
  });

  it('o botão fica disabled com pendingDrafts=0 — não dá pra clicar "Registrar" com a lista vazia', () => {
    expect(fonte).toContain("disabled={pendingDrafts === 0 || submissionState === 'saving'}");
  });
});

// ⚠️ CORREÇÃO DE ALCANCE — o commit 6b340a5 registrou esta tela como
// "alcance zero", checando só nav.js (o menu) e o BetaBar (botão "← visão
// antiga" dentro de OverviewV2, nunca renderizado). Mas existe uma TERCEIRA
// porta que aquela análise não checou: o Cmd+K (commands.js) tem um comando
// de navegação direta "Ir pra Visão Geral v2" → view 'overview-v2' — mesmo
// setActiveView que o BetaBar usaria, sem passar por ele. 'overview-v2' está
// no `nav` de TODO perfil em permissions.js, então canAccess nunca barra o
// comando, e o listener de Cmd+K é incondicional (nenhuma checagem de role).
// Ou seja: a tela NÃO é código morto — está a um atalho de teclado de
// distância pra qualquer usuário logado. Isto não muda o veredito deste
// achado (o bug já estava corrigido de qualquer forma), mas muda o risco: as
// correções do cluster TemperatureCapture importavam de verdade, e a
// classificação de "dead code" desse cluster (usada em pages-medios-
// triagem.test.js e captura-rascunhos.test.js) merece ser revisitada.
describe('achado 1/7 — correção de alcance: o Cmd+K é uma porta pra overview-v2 que o BetaBar não é', () => {
  const commands = readFileSync(`${process.cwd()}/src/commands.js`, 'utf8');
  const perms = readFileSync(`${process.cwd()}/src/permissions.js`, 'utf8');

  it('o catálogo de comandos do Cmd+K tem "Ir pra Visão Geral v2" apontando pra view overview-v2', () => {
    expect(commands).toContain("{ view: 'overview-v2', label: 'Ir pra Visão Geral v2'");
  });

  it('todo item de navegação do Cmd+K chama onNavigate(view) direto — sem depender do BetaBar', () => {
    expect(commands).toContain('run: () => { callbacks.onNavigate?.(it.view); callbacks.onClose?.(); },');
  });

  it("'overview-v2' está no nav de TODOS os perfis — Colaborador, Supervisor e RT explicitamente, Administrador/Super-admin via ALL_VIEWS", () => {
    const ocorrencias = (perms.match(/'overview-v2'/g) ?? []).length;
    // ALL_VIEWS + Colaborador + Supervisor + Nutricionista RT = 4 citações
    // literais; Administrador/Super-admin herdam de ALL_VIEWS sem repetir.
    expect(ocorrencias).toBe(4);
  });

  it('o Cmd+K abre com um atalho de teclado incondicional — nenhuma checagem de role/tenant antes de setShowSearch(true)', () => {
    expect(fonte).toContain("if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true); }");
  });

  it('GlobalSearch (o componente por trás do Cmd+K) está de fato montado no App, não só definido', () => {
    expect(fonte).toContain('<GlobalSearch');
    expect(fonte).toContain("onNavigate={setActiveView}");
  });
});

// Reprodução puramente lógica do que a peça de permissions.js decide — sem
// tocar em pages.jsx — pra provar que NENHUM perfil fica de fora do comando.
describe('achado 1/7 — canAccess nunca barra overview-v2, pra nenhum perfil', () => {
  it('Colaborador, Supervisor, Nutricionista RT, Administrador e Super-admin passam todos em canAccess', async () => {
    const { canAccess } = await import('./permissions');
    for (const role of ['Colaborador', 'Supervisor', 'Nutricionista RT', 'Administrador', 'Super-admin']) {
      expect(canAccess(role, 'overview-v2'), `${role} deveria ver o comando`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 2/7 — Tela da RT só carrega registros da unidade ativa, mas exibe
// todas as unidades — as outras aparecem zeradas (refreshRecords)
// ═══════════════════════════════════════════════════════════════════════════
//
// Real e ainda aberto antes desta rodada. `refreshRecords` usava
// `seesAllTenants ? activeTenants : [activeTenant]` — e seesAllTenants é
// isGlobalAdmin(session), que devolve FALSE pra qualquer sessão com
// memberTenants (permissions.js:51-55), exatamente o caso da RT/supervisora
// com 2-3 unidades. Ela via só a unidade ativa carregada, com as outras
// zeradas no dashboard (RTDashboard), mesmo com dado real no Supabase.
// CORREÇÃO: refreshRecords passou a usar `visibleTenants` — o mesmo helper
// que já resolvia isto certo pro <select> de empresas (linha ~2812).

// Reproduz visibleTenants fiel ao pages.jsx (linhas ~2807-2822), usando o
// isGlobalAdmin REAL de permissions.js — não uma versão fake.
function computeVisibleTenants(session, activeTenants, activeTenant) {
  const seesAllTenants = isGlobalAdmin(session);
  if (seesAllTenants) return activeTenants;
  if (session?.memberTenants?.length > 0) {
    const ids = new Set(session.memberTenants.map((m) => m.id));
    const mine = activeTenants.filter((t) => ids.has(t.id));
    if (mine.length > 0) return mine;
  }
  const own = activeTenants.filter((t) => t.id === session?.tenantId);
  return own.length > 0 ? own : [activeTenant];
}

const activeTenantsFixture = [{ id: 'swiss', stores: [] }, { id: 'backerei', stores: [] }, { id: 'dbk', stores: [] }];
const rtSessionFixture = {
  accessToken: 'jwt-da-rt', isPlatformAdmin: false,
  tenantId: 'swiss', memberTenants: [{ id: 'swiss' }, { id: 'backerei' }, { id: 'dbk' }],
  user: { role: 'Nutricionista RT' },
};

describe('achado 2/7 — refreshRecords carrega TODAS as unidades visíveis, não só a ativa', () => {
  it('a sessão da RT multi-unidade não é isGlobalAdmin (isGlobalAdmin real de permissions.js) — é exatamente o caso que travava', () => {
    expect(isGlobalAdmin(rtSessionFixture)).toBe(false);
  });

  it('a REGRA VELHA (seesAllTenants ? activeTenants : [activeTenant]) só carregaria a unidade ativa — 1 de 3', () => {
    const seesAllTenants = isGlobalAdmin(rtSessionFixture);
    const activeTenant = activeTenantsFixture[0];
    const tenantsToLoadVelho = seesAllTenants ? activeTenantsFixture : [activeTenant];
    expect(tenantsToLoadVelho.map((t) => t.id)).toEqual(['swiss']); // era o bug: só a ativa
  });

  it('visibleTenants (a regra nova) carrega as 3 unidades da RT', () => {
    const visible = computeVisibleTenants(rtSessionFixture, activeTenantsFixture, activeTenantsFixture[0]);
    expect(visible.map((t) => t.id)).toEqual(['swiss', 'backerei', 'dbk']);
  });

  it('sessão de conta única (sem memberTenants) continua vendo só a própria loja — sem regressão', () => {
    const soloSession = { tenantId: 'swiss', user: { role: 'Supervisor' } };
    const visible = computeVisibleTenants(soloSession, activeTenantsFixture, activeTenantsFixture[0]);
    expect(visible.map((t) => t.id)).toEqual(['swiss']);
  });

  it('admin global continua vendo todas — sem regressão', () => {
    const adminSession = { accessToken: 'jwt', isPlatformAdmin: true, tenantId: null, user: { role: 'Administrador' } };
    const visible = computeVisibleTenants(adminSession, activeTenantsFixture, activeTenantsFixture[0]);
    expect(visible.map((t) => t.id)).toEqual(['swiss', 'backerei', 'dbk']);
  });

  it('pages.jsx: refreshRecords usa visibleTenants — o tenantsToLoad velho não existe mais', () => {
    expect(fonte).toContain(
      'const all = await Promise.all(visibleTenants.map(async (t) => { const items = await repository.list({ tenantId: t.id, days: 90 }); return items.map((r) => ({ ...r, tenantName: r.tenantName ?? t.name })); }));'
    );
    expect(fonte).not.toContain('const tenantsToLoad = seesAllTenants ? activeTenants : [activeTenant];');
  });

  it('a dependência do useCallback é [repository, visibleTenants] — não referencia mais activeTenant/activeTenants direto', () => {
    expect(fonte).toContain('}, [repository, visibleTenants]);');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 3/7 — "Criar ação corretiva" não faz nada quando a descrição vem
// vazia — sem aviso e sem campo em destaque
// ═══════════════════════════════════════════════════════════════════════════
//
// Real e ainda aberto antes desta rodada. Uma NC de temperatura com desvio
// LEVE (tom 'warn') ou controle especial sem obs anotada abre a descrição
// vazia (defaultDescriptionFor), e saveAction recusava em silêncio — sem
// disabled, sem foco, sem mensagem. O padrão correto já existia no mesmo
// arquivo (RecebimentoView: disabled amarrado às obrigatoriedades).
describe('achado 3/7 — "Criar ação corretiva" não faz mais nada em silêncio com descrição vazia', () => {
  it('o botão fica disabled quando a descrição está em branco — mesmo padrão do RecebimentoView', () => {
    expect(fonte).toContain('<button className="primary-action" onClick={saveAction} disabled={!description.trim()}>Criar ação corretiva</button>');
  });

  it('saveAction continua recusando descrição vazia (defesa em profundidade — o disabled não é a única barreira)', () => {
    expect(fonte).toContain('if (!description.trim() || !creating) return;');
  });

  it('RecebimentoView (o padrão citado pelo achado) também amarra disabled às obrigatoriedades — confirma que é o mesmo idioma usado em duas telas agora', () => {
    expect(fonte).toContain("disabled={!fornecedor.trim() || !produto.trim() || !resultado || (motivoObrigatorio && !motivoRejeicao.trim()) || saving}");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 4/7 — Seletor de empresa não troca de loja para RT/supervisora com
// mais de uma unidade — handleTenantChange sai no primeiro if
// ═══════════════════════════════════════════════════════════════════════════
//
// Real e ainda aberto antes desta rodada. Mesma causa-raiz do achado 2/7:
// handleTenantChange usava `if (!seesAllTenants) return;` — bloqueando
// qualquer sessão que não fosse admin global, inclusive a RT/supervisora com
// memberTenants. Todos os <select> de empresa (Alertas, NC, Recebimento,
// Equipamentos, CompanyCards, MobileDrawer) chamam este handler com um id
// vindo de `visibleTenants` (a mesma lista que preenche as opções) — então o
// select "voltava sozinho" pra loja anterior, sem aviso.
describe('achado 4/7 — seletor de empresa troca de loja pra RT/supervisora com memberTenants', () => {
  it('a REGRA VELHA (if (!seesAllTenants) return) travava a troca pra ela — reproduzido com isGlobalAdmin real', () => {
    const seesAllTenants = isGlobalAdmin(rtSessionFixture);
    const wouldBailOut = !seesAllTenants;
    expect(wouldBailOut).toBe(true); // saía sem chamar setActiveTenantId — era o bug
  });

  it('a REGRA NOVA (visibleTenants.some) deixa passar pra qualquer unidade DELA...', () => {
    const visible = computeVisibleTenants(rtSessionFixture, activeTenantsFixture, activeTenantsFixture[0]);
    expect(visible.some((t) => t.id === 'backerei')).toBe(true);
    expect(visible.some((t) => t.id === 'dbk')).toBe(true);
  });

  it('...mas continua recusando um id de fora do vínculo dela — não virou um "qualquer id passa"', () => {
    const visible = computeVisibleTenants(rtSessionFixture, activeTenantsFixture, activeTenantsFixture[0]);
    expect(visible.some((t) => t.id === 'loja-que-ela-nao-tem-vinculo')).toBe(false);
  });

  it('conta de loja única: a troca continua virando no-op (só 1 tenant em visibleTenants) — sem regressão de segurança', () => {
    const soloSession = { tenantId: 'swiss', user: { role: 'Colaborador' } };
    const visible = computeVisibleTenants(soloSession, activeTenantsFixture, activeTenantsFixture[0]);
    expect(visible.some((t) => t.id === 'backerei')).toBe(false);
  });

  it('pages.jsx: handleTenantChange checa visibleTenants.some(...), não seesAllTenants sozinho', () => {
    expect(fonte).toContain('if (!visibleTenants.some((t) => t.id === id)) return;');
    expect(fonte).not.toContain('if (!seesAllTenants) return;\n    setActiveTenantId(id);');
  });

  it('a dependência do useCallback é [visibleTenants, activeTenants]', () => {
    expect(fonte).toContain('}, [visibleTenants, activeTenants]);');
  });

  it('os 6 <select> de empresa citados pelo achado continuam todos ligados a handleTenantChange (via sharedProps ou prop direta)', () => {
    // sharedProps.onTenantChange = handleTenantChange cobre Alertas, NC,
    // Recebimento e Equipamentos (view genérica) + CompanyCards; MobileDrawer
    // recebe onTenantChange={handleTenantChange} direto.
    expect(fonte).toContain('const sharedProps = { activeTenant, allTenants: visibleTenants, onTenantChange: handleTenantChange, activeStore };');
    expect(fonte).toContain('onTenantChange={handleTenantChange} onLogout={handleLogout}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 5/7 — Central de NC: import dinâmico sem catch some com as NC de
// planilha e de controles especiais
// ═══════════════════════════════════════════════════════════════════════════
//
// Real e ainda aberto antes desta rodada. O IIFE assíncrona que carrega
// controls.jsx/extras.jsx/forms.jsx (chunks pesados, sob demanda) não tinha
// try/catch nem .catch() — offline com bundle antigo em cache (sw.js só
// pré-cacheia '/' e '/index.html') faz o import() rejeitar, a rejeição
// sumia, e otherPending.controls/forms ficavam [] pra sempre naquela sessão,
// sem spinner nem aviso. Pior caso: se não houver NC de temperatura/
// recebimento pendente, o card inteiro não renderiza e a tela parece dizer
// "está tudo em ordem".
describe('achado 5/7 — Central de NC: import dinâmico agora tem catch, estado de erro e retry', () => {
  it('o IIFE assíncrona tem try/catch em volta da leitura dos 3 chunks pesados', () => {
    expect(fonte).toContain('    (async () => {\n      try {\n        const [controlsMod, extrasMod, formsMod] = await Promise.all([import(\'./controls\'), import(\'./extras\'), import(\'./forms\')]);');
    expect(fonte).toContain('      } catch (e) {');
  });

  it('o catch marca um estado de erro visível (não só console.warn)', () => {
    expect(fonte).toContain('console.warn(\'[NutriOPS] carregar NC de controles/planilhas falhou:\', e?.message ?? e);');
    expect(fonte).toContain('setOtherPendingError(true);');
  });

  it('existe estado de erro + retryTick, e o efeito reroda quando o retry é acionado', () => {
    expect(fonte).toContain('const [otherPendingError, setOtherPendingError] = useState(false);');
    expect(fonte).toContain('const [otherPendingRetryTick, setOtherPendingRetryTick] = useState(0);');
    expect(fonte).toContain('}, [activeTenant.id, otherPendingRetryTick]);');
  });

  it('o efeito zera o erro no início de cada tentativa (senão um retry bem-sucedido deixaria o aviso preso)', () => {
    expect(fonte).toContain('let vivo = true;\n    setOtherPendingError(false);');
  });

  it('o aviso aparece ANTES do card de pendências — não fica preso a pending.length > 0 (o pior caso do achado)', () => {
    const idxAviso = fonte.indexOf('{otherPendingError && (');
    const idxCard = fonte.indexOf('{pending.length > 0 && (');
    expect(idxAviso).toBeGreaterThan(-1);
    expect(idxCard).toBeGreaterThan(-1);
    expect(idxAviso).toBeLessThan(idxCard);
  });

  it('o botão "Tentar de novo" incrementa o retryTick, reabrindo a tentativa', () => {
    expect(fonte).toContain('onClick={() => setOtherPendingRetryTick((t) => t + 1)}');
    expect(fonte).toContain('Tentar de novo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 6/7 — Tela de Equipamentos fica presa no catálogo do primeiro
// render — o banner "Tentar de novo" some, mas a lista não muda
// ═══════════════════════════════════════════════════════════════════════════
//
// Real e ainda aberto antes desta rodada. EquipmentView mantém o PRÓPRIO
// state `catalog`, lido de readEquipmentCatalog só no mount/troca de
// empresa. Nem o retry manual (CatalogStaleBanner → retryCatalogSync) nem o
// auto-sync de boot avisavam esta tela quando o catálogo mudava por baixo —
// só bumpavam `catalogVersion` (App-level), que EquipmentView nunca recebe
// (nem por prop, nem por SYNC_EVENT). O banner desaparecia (deu certo!) mas
// a lista continuava com os 4 genéricos de fábrica.
describe('achado 6/7 — tela de Equipamentos relê o catálogo quando o sync termina depois do 1º render', () => {
  // Isola o corpo de EquipmentView (até a próxima função de nível superior)
  // pra não colidir com o mesmo texto em outras views.
  const inicioFn = fonte.indexOf('function EquipmentView({');
  const fimFn = fonte.indexOf('\nfunction ', inicioFn + 10);
  const corpoEquipmentView = fonte.slice(inicioFn, fimFn);

  it('EquipmentView existe e a fatia isolada não está vazia (guarda contra o teste ficar mudo)', () => {
    expect(inicioFn).toBeGreaterThan(-1);
    expect(fimFn).toBeGreaterThan(inicioFn);
    expect(corpoEquipmentView.length).toBeGreaterThan(500);
  });

  it('EquipmentView escuta SYNC_EVENT e relê readEquipmentCatalog', () => {
    expect(corpoEquipmentView).toContain('window.addEventListener(SYNC_EVENT, reler);');
    expect(corpoEquipmentView).toContain('const reler = () => setCatalog(readEquipmentCatalog(activeTenant));');
  });

  it('não relê com uma edição em andamento (editingIndex) — não troca a lista sob os pés de quem está editando', () => {
    expect(corpoEquipmentView).toContain('if (editingIndex !== null) return;\n    const reler = () => setCatalog(readEquipmentCatalog(activeTenant));');
  });

  it('retryCatalogSync (o botão "Tentar de novo" do banner) agora avisa outras telas, não só o catalogVersion do App', () => {
    expect(fonte).toContain("notificarSyncAplicado({ tenantId: session.tenantId, trigger: 'retry-catalogo' });");
  });

  it('a auto-cura do boot TAMBÉM avisa — 2º disparo, depois que o catálogo já está de fato fresco', () => {
    expect(fonte).toContain("notificarSyncAplicado({ tenantId: session.tenantId, trigger: 'auto-cura-catalogo' });");
  });

  it('SYNC_EVENT já está importado em pages.jsx (não precisou de import novo)', () => {
    expect(fonte).toContain("import { notificarSyncAplicado, gravarMesclando, SYNC_EVENT } from './lista-local';");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 7/7 — Badge "Não conformidades" do menu conta ações abertas, não
// NCs pendentes — fica apagado justamente quando ninguém agiu
// ═══════════════════════════════════════════════════════════════════════════
//
// Real e ainda aberto antes desta rodada. actionCount lia só
// corrective_actions (as AÇÕES criadas) — nunca a lista `pending` que a
// própria Central de NC calcula. Sinal invertido: N desvios sem NENHUMA ação
// = badge apagado; criar a 1ª ação ACENDIA o badge (1); resolver as ações
// apaga de novo, mesmo com NC pendente atrás.
//
// CORREÇÃO ESCOLHIDA (escopo deliberadamente parcial — ver nota abaixo):
// actionCount passou a contar NC de temperatura + recebimento sem ação,
// usando excludeWithAction (a mesma função que a Central usa). NÃO inclui NC
// de controles especiais/planilhas: essas exigem os chunks pesados de
// controls/extras/forms.jsx, carregados sob demanda só quando a Central de
// NC abre — replicar isso aqui rodaria em TODO boot só pra alimentar um
// badge, contrariando uma decisão de performance já tomada de propósito no
// mesmo arquivo (comentário logo acima de `otherPending`, achado 5/7). Ainda
// assim corrige o defeito relatado — o sinal para de ficar invertido pras
// duas fontes mais frequentes de NC. Undercount residual (planilha/controle
// especial) fica documentado no relatório final, não decidido em silêncio.
describe('achado 7/7 — badge do menu conta NC pendente, não ação aberta (fonte)', () => {
  it('actionCount não é mais um filtro puro sobre corrective_actions', () => {
    expect(fonte).not.toContain("const actionCount = useMemo(() => readActions(activeTenant.id).filter((a) => a.status !== 'resolvida').length, [records, activeTenant.id]);");
  });

  it('usa a mesma fonte que a Central de NC (pendingTemperatureItems + pendingReceivingItems + excludeWithAction)', () => {
    const inicio = fonte.indexOf('const actionCount = useMemo(() => {');
    expect(inicio).toBeGreaterThan(-1);
    const trecho = fonte.slice(inicio, inicio + 500);
    expect(trecho).toContain('const tempPending = pendingTemperatureItems(records, activeTenant.id, resolveTemperatureTone);');
    expect(trecho).toContain('const recPending = pendingReceivingItems(load(recStorageKey(activeTenant.id), []));');
    expect(trecho).toContain('return excludeWithAction([...tempPending, ...recPending], acts).length;');
  });

  it('a dependência do useMemo continua [records, activeTenant.id] — mesma reatividade de antes', () => {
    expect(fonte).toContain('return excludeWithAction([...tempPending, ...recPending], acts).length;\n  }, [records, activeTenant.id]);');
  });
});

// Comprova o comportamento com as funções REAIS de nonconformities.js e
// limits.js — não só o texto-fonte. Modela os dois lados (regra velha vs.
// nova) com o MESMO conjunto de registros, pra deixar a inversão de sinal
// impossível de simular errado.
describe('achado 7/7 — comportamento real: o sinal não fica mais invertido', () => {
  const tenantId = 't1';
  const records = [
    // Fora da faixa (min -22/max -18, valor 10) → 'danger', conta como pendente.
    { id: 'r1', tenantId, equipment: 'Freezer',      value: 10, min: -22, max: -18, createdAt: '2026-08-18T10:00:00.000Z' },
    // Fora da faixa (min 2/max 8, valor 12) → 'danger', conta como pendente.
    { id: 'r2', tenantId, equipment: 'Refrigerador', value: 12, min: 2,   max: 8,   createdAt: '2026-08-18T11:00:00.000Z' },
    // Dentro da faixa → 'ok', NÃO deve contar em nenhuma das duas regras.
    { id: 'r3', tenantId, equipment: 'Vitrine',      value: 5,  min: 2,   max: 8,   createdAt: '2026-08-18T12:00:00.000Z' },
  ];

  it('2 desvios reais, ZERO ações: a regra velha (ações abertas) mostrava 0 — a nova mostra 2', () => {
    const acoesVelhas = []; // ninguém agiu ainda
    const badgeVelho = acoesVelhas.filter((a) => a.status !== 'resolvida').length;
    expect(badgeVelho).toBe(0); // era o menu "limpo" com 2 desvios reais escondidos

    const tempPending = pendingTemperatureItems(records, tenantId, resolveRecordTone);
    const badgeNovo = excludeWithAction(tempPending, acoesVelhas).length;
    expect(badgeNovo).toBe(2); // os 2 desvios aparecem — o registro 'ok' não conta
  });

  it('ao criar a 1ª ação: a regra velha SOBE (0→1, sinal invertido) — a nova CAI (2→1, sinal certo)', () => {
    const tempPending = pendingTemperatureItems(records, tenantId, resolveRecordTone);
    const acaoParaR1 = { source: 'temperature', sourceId: 'r1', status: 'aberta' };

    const badgeVelhoAntes  = [].filter((a) => a.status !== 'resolvida').length;
    const badgeVelhoDepois = [acaoParaR1].filter((a) => a.status !== 'resolvida').length;
    expect(badgeVelhoDepois).toBeGreaterThan(badgeVelhoAntes); // 0 → 1: sobe quando alguém FAZ a coisa certa — o defeito

    const badgeNovoAntes  = excludeWithAction(tempPending, []).length;
    const badgeNovoDepois = excludeWithAction(tempPending, [acaoParaR1]).length;
    expect(badgeNovoDepois).toBeLessThan(badgeNovoAntes); // 2 → 1: cai quando alguém trata — o sinal certo
  });

  it('ao tratar os 2 desvios, a regra nova zera — "tudo em ordem" volta a significar isso', () => {
    const tempPending = pendingTemperatureItems(records, tenantId, resolveRecordTone);
    const acoes = [
      { source: 'temperature', sourceId: 'r1', status: 'aberta' },
      { source: 'temperature', sourceId: 'r2', status: 'resolvida' },
    ];
    expect(excludeWithAction(tempPending, acoes).length).toBe(0);
  });
});
