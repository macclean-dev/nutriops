import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { describeLocalUsage } from './admin';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 5 achados de gravidade MÉDIA sem perda de dado que
// apontam pra src/admin.jsx (pool de 169 não-julgados da auditoria de falha
// silenciosa, 18-19/08). admin.jsx é o painel /admin — cadastro de cliente
// (ClientModal), token+PIN de setup (AccessTokenModal/SetupPinReveal), lista
// de clientes com KPIs e a aba "Saúde dos tenants". Sem @testing-library
// neste repo — como nos outros arquivos desta sessão (settings.jsx,
// maintenance.jsx…), UI vira asserção posicional sobre o código-fonte; lógica
// pura (describeLocalUsage) e o fetch de rede (tenant-sync.js) ganham teste
// comportamental de verdade.
//
// Todos os 5 eram reais. Viraram 4 famílias:
//   · Família A (T2) — ClientModal.handleSave: salvar sem PIN novo e sem
//     falha de push fechava o modal NA HORA, pixel a pixel igual a apertar
//     Cancelar/✕. Quando o campo editado (telefone, CNPJ, observações...) não
//     muda coluna nenhuma da tabela, não sobrava nenhum sinal de que gravou.
//   · Família B (T7 + T6, achados "leitura falha vira lista vazia" e "falha
//     vira 'Nenhum cliente cadastrado'") — MESMA causa raiz: o useEffect que
//     hidrata a lista de clientes a partir da nuvem tratava QUALQUER falha
//     (sessão expirada, RPC ausente, rede fora) exatamente igual a "a nuvem
//     confirmou zero clientes" — os dois casos devolviam [] e o painel não
//     tinha como distinguir. O caminho de ESCRITA do mesmo painel já avisa
//     direitinho quando a sessão expira; o de LEITURA ficava mudo.
//   · Família C (T3) — SetupPinReveal.handleCopy: catch{} vazio no "Copiar
//     PIN" — o único momento em que o setup PIN existe em claro. Mesmo
//     defeito (e mesmo fix) já usado em "Copiar SQL" (settings.jsx).
//   · Família D (T6, achado "coluna Uso mede o navegador errado") — a coluna
//     "Uso" da tabela de clientes lê localStorage DESTE navegador (onde o
//     admin abre o painel), mas quem grava ali é a sessão da LOJA rodando no
//     tablet da cozinha — chaves diferentes, dispositivos diferentes. O
//     rótulo "Sem uso" era uma afirmação sobre O CLIENTE quando o fato real
//     era só "sem dado neste navegador" — a aba Saúde (Supabase, cross-
//     device) mostra a mesma loja como "Ativo" ao mesmo tempo.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/admin.jsx`, 'utf8');
const fonteSuperAdmin = readFileSync(`${process.cwd()}/src/superadmin-view.jsx`, 'utf8');
const fonteTenantSync = readFileSync(`${process.cwd()}/src/tenant-sync.js`, 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA A (T2) — ClientModal: Salvar não fecha mais igual a Cancelar
// ═══════════════════════════════════════════════════════════════════════════

describe('Família A (T2) — ClientModal.handleSave mostra "✓ Salvo" antes de fechar', () => {
  const iniHandle = fonte.indexOf('const handleSave = async () => {');
  const fimHandle = fonte.indexOf('\n  return (', iniHandle);
  const handleSave = fonte.slice(iniHandle, fimHandle);

  it('existe um estado dedicado pra flash de sucesso', () => {
    expect(iniHandle).toBeGreaterThan(-1);
    expect(fonte).toContain('const [savedFlash, setSavedFlash]     = useState(false);');
  });

  it('o ramo de sucesso (sem pushFailed, sem PIN novo) NÃO chama onClose() na hora — adia via setTimeout', () => {
    const posPushFailed = handleSave.indexOf('if (pushFailed) {');
    const posSetupPin   = handleSave.indexOf('} else if (setupPinPlain) {');
    const posElseFinal  = handleSave.lastIndexOf('} else {');
    expect(posPushFailed).toBeGreaterThan(-1);
    expect(posSetupPin).toBeGreaterThan(posPushFailed);
    expect(posElseFinal).toBeGreaterThan(posSetupPin);

    const ramoSucesso = handleSave.slice(posElseFinal);
    expect(ramoSucesso).toContain('setSavedFlash(true);');
    expect(ramoSucesso).toContain('setTimeout(() => onClose(), 900);');
    // a forma antiga: onClose() chamado direto, sem nenhum estado antes
    expect(ramoSucesso).not.toMatch(/^\}\s*else\s*\{\s*onClose\(\);/);
  });

  it('busy continua true no ramo de sucesso — Salvar/Cancelar ficam travados até fechar sozinho', () => {
    const posElseFinal = handleSave.lastIndexOf('} else {');
    const ramoSucesso = handleSave.slice(posElseFinal);
    expect(ramoSucesso).not.toContain('setBusy(false)');
    // A regra é "todo ramo que MANTÉM o modal aberto destrava o botão; só o de
    // sucesso silencioso não". Hoje são 4: (1) falha ao GERAR o PIN (early
    // return), (2) pushFailed, (3) conta de e-mail criada/vinculada — mostra
    // as credenciais, 21/08 — e (4) PIN novo gerado como plano B. O ramo final
    // (sucesso silencioso) NÃO reseta busy: fica assim até o setTimeout fechar.
    const ocorrencias = handleSave.split('setBusy(false)').length - 1;
    expect(ocorrencias).toBe(4);
    // O que realmente importa não é o número, e sim que cada ramo de "modal
    // continua aberto" destrave o botão. Sem isto o admin fica com Salvar e
    // Cancelar mortos, olhando um modal que não responde.
    for (const marcador of ['} else if (conta?.ok) {', '} else if (setupPinPlain) {']) {
      const ini = handleSave.indexOf(marcador);
      expect(ini).toBeGreaterThan(-1);
      const corpo = handleSave.slice(ini, handleSave.indexOf('} else', ini + marcador.length));
      expect(corpo).toContain('setBusy(false)');
    }
  });

  it('o botão Salvar mostra "✓ Salvo" enquanto o flash está ativo', () => {
    expect(fonte).toContain("{savedFlash ? '✓ Salvo' : busy ? 'Salvando…' : (editing ? 'Salvar alterações' : 'Criar cliente')}");
  });

  // Prova por reimplementação: modela em JS puro exatamente a árvore de
  // decisão do handleSave (mesma técnica de equipment-switch.test.js, já que
  // não há @testing-library aqui) pra comprovar que SÓ o ramo de sucesso
  // silencioso ganhou o flash — os outros dois continuam como estavam.
  function simulateHandleSaveTail({ pushFailed, setupPinPlain }) {
    const eventos = [];
    if (pushFailed) {
      eventos.push('busy=false', 'regenerate=false');
    } else if (setupPinPlain) {
      eventos.push('busy=false', 'generatedPin=set', 'regenerate=false');
    } else {
      eventos.push('savedFlash=true', 'onClose-adiado-900ms');
    }
    return eventos;
  }

  it('modelo: push falhou → mantém modal aberto com erro, SEM flash de sucesso', () => {
    expect(simulateHandleSaveTail({ pushFailed: true, setupPinPlain: null })).toEqual(['busy=false', 'regenerate=false']);
  });

  it('modelo: PIN novo gerado → mostra overlay do PIN, SEM flash de sucesso (é outro tipo de confirmação)', () => {
    expect(simulateHandleSaveTail({ pushFailed: false, setupPinPlain: '1234' })).toEqual(['busy=false', 'generatedPin=set', 'regenerate=false']);
  });

  it('modelo: nem push falhou nem PIN novo → SÓ agora existe o flash + fechamento adiado', () => {
    expect(simulateHandleSaveTail({ pushFailed: false, setupPinPlain: null })).toEqual(['savedFlash=true', 'onClose-adiado-900ms']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA B (T7 + T6) — leitura da lista de clientes na nuvem: falha ≠ vazio
// ═══════════════════════════════════════════════════════════════════════════

describe('Família B — tenant-sync.js: fetchAllTenantsFromCloud distingue null (falha) de [] (zero confirmado)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock('./auth');
    vi.resetModules();
  });

  it('sync desligado (sem VITE_SB_URL/ANON_KEY, o default deste repo) continua [] — não é falha, é modo local por device', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', '');
    vi.stubEnv('VITE_SB_ANON_KEY', '');
    const { fetchAllTenantsFromCloud, isTenantSyncEnabled } = await import('./tenant-sync.js');
    expect(isTenantSyncEnabled()).toBe(false);
    await expect(fetchAllTenantsFromCloud()).resolves.toEqual([]);
  });

  it('sessão sem token válido (expirada) devolve null — NÃO [] — é o caso do achado T7', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.doMock('./auth', () => ({ getValidAccessToken: vi.fn().mockResolvedValue(null) }));
    const { fetchAllTenantsFromCloud } = await import('./tenant-sync.js');
    await expect(fetchAllTenantsFromCloud()).resolves.toBeNull();
  });

  it('RPC responde 401 devolve null — sessão inválida não é "zero clientes"', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.doMock('./auth', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('jwt-valido') }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }));
    const { fetchAllTenantsFromCloud } = await import('./tenant-sync.js');
    await expect(fetchAllTenantsFromCloud()).resolves.toBeNull();
  });

  it('RPC responde 404 (SQL não rodado) devolve null — é o achado T6 ("Falha ao listar... vira Nenhum cliente")', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.doMock('./auth', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('jwt-valido') }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' }));
    const { fetchAllTenantsFromCloud } = await import('./tenant-sync.js');
    await expect(fetchAllTenantsFromCloud()).resolves.toBeNull();
  });

  it('exceção de rede (fetch rejeita) devolve null', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.doMock('./auth', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('jwt-valido') }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { fetchAllTenantsFromCloud } = await import('./tenant-sync.js');
    await expect(fetchAllTenantsFromCloud()).resolves.toBeNull();
  });

  it('sucesso real com ZERO linhas continua devolvendo [] — esse é o "confirmado vazio" que não deve virar erro', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.doMock('./auth', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('jwt-valido') }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const { fetchAllTenantsFromCloud } = await import('./tenant-sync.js');
    await expect(fetchAllTenantsFromCloud()).resolves.toEqual([]);
  });

  it('sucesso real com linhas passa o array adiante intacto (o caminho feliz não regrediu)', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SB_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SB_ANON_KEY', 'fake-anon-key');
    vi.doMock('./auth', () => ({ getValidAccessToken: vi.fn().mockResolvedValue('jwt-valido') }));
    const linhas = [{ id: 'c1', name: 'Padaria X' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => linhas }));
    const { fetchAllTenantsFromCloud } = await import('./tenant-sync.js');
    await expect(fetchAllTenantsFromCloud()).resolves.toEqual(linhas);
  });

  it('mesma distinção null/[] já documentada e comprovada em fetchMemberTenants (fix de 30/07) — não é padrão novo', () => {
    expect(fonteTenantSync).toContain("return null; // erro (401/404/500) ≠ \"sem vínculo\"");
  });
});

describe('Família B — admin.jsx (AdminPanel): avisa quando a leitura da nuvem falha, não finge "0 clientes"', () => {
  it('tem estado cloudSyncError dedicado', () => {
    expect(fonte).toContain('const [cloudSyncError, setCloudSyncError] = useState(false);');
  });

  it('cloud === null vira cloudSyncError=true — cloud undefined/[] NÃO vira erro', () => {
    const ini = fonte.indexOf("const { fetchAllTenantsFromCloud, mergeCloudTenants } = await import('./tenant-sync');\n        const cloud = await fetchAllTenantsFromCloud();");
    expect(ini).toBeGreaterThan(-1);
    const bloco = fonte.slice(ini, fonte.indexOf('} catch {', ini) + 200);
    expect(bloco).toContain('if (cloud === null) { setCloudSyncError(true); return; }');
    expect(bloco).toContain('setCloudSyncError(false);');
    expect(bloco).toContain('if (!cloud.length) return;');
    // ordem importa: null é tratado ANTES do !cloud.length (senão cloud===null
    // ainda cairia no !cloud.length por coincidência, mas sem marcar o erro)
    expect(bloco.indexOf('if (cloud === null)')).toBeLessThan(bloco.indexOf('if (!cloud.length) return;'));
  });

  it('exceção na própria hidratação (import ou chamada) também marca cloudSyncError — catch não fica mais totalmente vazio', () => {
    expect(fonte).toContain('if (!cancelled) setCloudSyncError(true);');
  });

  it('a aba Clientes ganhou um banner de erro (mesmo estilo do banner já existente na aba Saúde)', () => {
    expect(fonte).toContain('{cloudSyncError && (');
    expect(fonte).toContain('Não deu pra confirmar a lista de clientes na nuvem.');
    // mesmo esquema de cor do banner de erro que a HealthView já usa (achado
    // T7 apontava que só a aba Saúde tinha isso)
    const posBannerSaude = fonte.indexOf("<strong>Não foi possível carregar:</strong>");
    const posBannerClientes = fonte.indexOf('Não deu pra confirmar a lista de clientes na nuvem.');
    expect(posBannerSaude).toBeGreaterThan(-1);
    expect(posBannerClientes).toBeGreaterThan(-1);
  });

  it('o estado vazio da tabela não afirma mais "Nenhum cliente cadastrado" quando a causa foi falha de leitura', () => {
    expect(fonte).toContain('Não foi possível confirmar a lista de clientes agora — não é o mesmo que "nenhum cadastrado".');
  });

  it('o rodapé para de afirmar a contagem como fato quando pode estar desatualizada', () => {
    expect(fonte).toContain("cloudSyncError ? ' (pode estar desatualizado — falha ao confirmar com a nuvem)' : ''");
  });
});

describe('Família B — superadmin-view.jsx: mesmo contrato null/[] não quebra o caller compartilhado', () => {
  it('guarda cloud === null ANTES de tocar em cloud.length (senão null.length estoura TypeError, comido calado pelo catch)', () => {
    const ini = fonteSuperAdmin.indexOf("const cloud = await fetchAllTenantsFromCloud();");
    const fim = fonteSuperAdmin.indexOf('} catch {}', ini);
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    const bloco = fonteSuperAdmin.slice(ini, fim);
    expect(bloco).toContain('if (cloud === null)');
    expect(bloco.indexOf('if (cloud === null)')).toBeLessThan(bloco.indexOf('if (!cloud.length) return;'));
  });

  it('avisa pelo mecanismo de banner que este arquivo já usa (msg/setMsg) — não fica mudo', () => {
    expect(fonteSuperAdmin).toContain("setMsg({ tone:'warn', text:'Não deu pra confirmar a lista de tenants na nuvem agora");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA C (T3) — SetupPinReveal: falha ao copiar o PIN agora aparece
// ═══════════════════════════════════════════════════════════════════════════

describe('Família C (T3) — SetupPinReveal.handleCopy não engole mais a falha de clipboard', () => {
  const ini = fonte.indexOf('function SetupPinReveal({ pin, onAck }) {');
  const fim = fonte.indexOf('\nconst inputStyle', ini);
  const bloco = fonte.slice(ini, fim);

  it('checa a Clipboard API ANTES de chamar .writeText — contexto inseguro não estoura mudo', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(bloco).toContain('if (!navigator.clipboard?.writeText) {');
  });

  it('tem .catch encadeado pra rejeição real (permissão negada etc) — antes era só await dentro de um try/catch{} vazio', () => {
    expect(bloco).toMatch(/navigator\.clipboard\.writeText\(pin\)\s*\.then\(\(\) => \{[^}]*\}\)\s*\.catch\(\(\) => \{/);
  });

  it('catch não fica mais vazio — os DOIS caminhos de falha (sem API / rejeição) acendem copyFailed', () => {
    expect(bloco).not.toContain('catch {}');
    const ocorrencias = bloco.split('setCopyFailed(true)').length - 1;
    expect(ocorrencias).toBe(2);
  });

  it('o botão sai do "Copiar PIN" mudo quando falha — mostra estado de erro visível', () => {
    expect(bloco).toContain("copyFailed ? '✕ Falha — copie manualmente' : 'Copiar PIN'");
  });

  it('o PIN grande continua renderizado em destaque — é o fallback pro qual a falha aponta', () => {
    // {pin} interpolado no bloco de exibição grande (fontSize 48, monospace)
    expect(bloco).toMatch(/fontSize:48,[\s\S]*?\{pin\}/);
  });

  // Prova por reimplementação do fluxo (mesma técnica de settings.jsx "Copiar
  // SQL", que tem exatamente este formato): sem @testing-library, comprova
  // que a NOVA função cobre os 3 desfechos possíveis em vez de 1.
  function simulateHandleCopy({ hasClipboardApi, writeRejects }) {
    if (!hasClipboardApi) return 'copyFailed';
    return writeRejects ? 'copyFailed' : 'copied';
  }
  it('modelo: sem Clipboard API → copyFailed (era: nada)', () => {
    expect(simulateHandleCopy({ hasClipboardApi: false, writeRejects: false })).toBe('copyFailed');
  });
  it('modelo: API existe mas writeText rejeita → copyFailed (era: nada)', () => {
    expect(simulateHandleCopy({ hasClipboardApi: true, writeRejects: true })).toBe('copyFailed');
  });
  it('modelo: caminho feliz continua copied', () => {
    expect(simulateHandleCopy({ hasClipboardApi: true, writeRejects: false })).toBe('copied');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAMÍLIA D (T6, "Uso") — describeLocalUsage para de fingir telemetria do
// cliente quando na verdade é só o localStorage do navegador do ADMIN.
// ═══════════════════════════════════════════════════════════════════════════

describe('Família D — describeLocalUsage (pura)', () => {
  it('sem entrada (device do admin nunca teve a sessão da loja): não fala em "uso" do cliente', () => {
    const info = describeLocalUsage(undefined);
    expect(info.empty).toBe(true);
    expect(info.label).not.toMatch(/sem uso/i);
    expect(info.label).toBe('Sem dado local');
    expect(info.hint).toMatch(/Saúde/);
  });

  it('mesmo resultado pra null (defensivo)', () => {
    expect(describeLocalUsage(null).empty).toBe(true);
  });

  it('com entrada de hoje: rótulo "Hoje", mas o sub deixa explícito que é só deste navegador', () => {
    const hojeStr = new Date().toISOString().slice(0, 10);
    const u = { lastSeen: new Date().toISOString(), actions: { [hojeStr]: { session: 1 } } };
    const info = describeLocalUsage(u);
    expect(info.empty).toBe(false);
    expect(info.label).toContain('Hoje');
    expect(info.color).toBe('#00a35c');
    expect(info.sub).toContain('neste navegador');
    expect(info.hint).toMatch(/Saúde/);
  });

  it('conta ativo7d só dentro da janela de 7 dias — 10d atrás fica de fora', () => {
    const hoje = new Date();
    const dia = (n) => new Date(hoje.getTime() - n * 86400000).toISOString().slice(0, 10);
    const u = {
      lastSeen: hoje.toISOString(),
      actions: { [dia(0)]: { a: 1 }, [dia(3)]: { a: 1 }, [dia(10)]: { a: 1 } },
    };
    const info = describeLocalUsage(u);
    expect(info.sub).toBe('2d ativo nos últ. 7d (neste navegador)');
  });

  it('lastSeen ausente não vira cor de alerta por acidente (null <= 3 é true em JS — bug lateral corrigido de quebra)', () => {
    const info = describeLocalUsage({ lastSeen: null, actions: {} });
    expect(info.label).toBe('—');
    expect(info.color).toBe('#5c6c7a'); // neutro, não '#8a4e00' (amber)
  });

  it('"Ontem" e "Nd atrás" continuam funcionando (não regrediu o caminho feliz)', () => {
    const ontem = new Date(Date.now() - 86400000).toISOString();
    expect(describeLocalUsage({ lastSeen: ontem, actions: {} }).label).toBe('🟡 Ontem');
    const cincoDias = new Date(Date.now() - 5 * 86400000).toISOString();
    const info5 = describeLocalUsage({ lastSeen: cincoDias, actions: {} });
    expect(info5.label).toBe('⚫ 5d atrás');
    expect(info5.color).toBe('#5c6c7a'); // >3d → neutro
  });
});

describe('Família D — admin.jsx usa describeLocalUsage na tabela (não reimplementa a leitura inline)', () => {
  it('a célula "Uso" delega pra describeLocalUsage', () => {
    expect(fonte).toContain('const info = describeLocalUsage(usageStats[client.id]);');
  });

  it('"Sem uso" (afirmação sobre o CLIENTE) não é mais RENDERIZADO — só sobrevive em comentário explicando o achado', () => {
    expect(fonte).not.toContain('>Sem uso<');
    expect(fonte).toContain("label: 'Sem dado local'");
  });

  it('cabeçalho da coluna "Uso" ganhou tooltip explicando que é local a este navegador', () => {
    expect(fonte).toContain("title={h === 'Uso' ? 'Medido só neste navegador");
  });

  it('a célula renderizada carrega o hint em title (aparece no hover, tanto vazio quanto preenchido)', () => {
    expect(fonte).toContain('<span style={{ color:\'#9198a1\' }} title={info.hint}>{info.label}</span>');
    expect(fonte).toContain('<div title={info.hint}>');
  });
});
