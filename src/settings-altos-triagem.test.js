import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  saveSupabaseConfig, getSupabaseConfig, supabaseRepository,
  migrateAllToSupabase, shouldAutoConfigSupabase,
} from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 4 achados de gravidade ALTA sem perda de dado que apontam
// pra src/settings.jsx (pool de 169 não-julgados da auditoria de falha
// silenciosa, 18-19/08 — data_achados_pendentes_19-08.json, filtro
// gravidade=='alta' && perdaDeDado==false && arquivo termina em settings.jsx).
// Rodada 1 desta tier foi pages.jsx (c8a947e, v1.9.175), rodada 2 repository.js
// (b9a81bc, v1.9.176). settings.jsx já tinha recebido 4 fixes na tier "média
// sem perda" (162b126, v1.9.169) — nenhum dos 4 achados abaixo repete aqueles.
//
// Os 4 acabaram em 3 famílias:
//
//   · Família A (achados 1 e 4) — MESMA causa raiz por duas lentes do mesmo
//     agente/rodada de auditoria: "Limpar duplicatas" grava o resultado
//     (setResultado(out)) e, na linha seguinte, chama calcular() — que
//     começava com setResultado(null). As duas chamadas caem no mesmo lote de
//     atualização do React (a continuação da promise de aplicar() não cede ao
//     browser antes de calcular() chegar no PRÓPRIO await), e a mensagem de
//     resultado nunca chega a aparecer — inclusive o único aviso que manda a
//     pessoa rodar de novo com internet quando cópias não saíram da nuvem.
//     REAL, corrigido nesta rodada.
//
//   · Família B (achado 3) — "Testar conexão" gravava a config do Supabase
//     (enabled:true fixo, ignorando o checkbox; source:'manual') ANTES de
//     testar, e nunca desfazia quando o teste falhava. source:'manual' trava
//     shouldAutoConfigSupabase PRA SEMPRE (é assim que protege configuração
//     dedicada de projeto) — então um teste com credencial errada deixava o
//     aparelho com Supabase ligado e chave podre, sem o auto-config de login
//     pra se curar sozinho. Git blame confirma que handleTest grava em
//     localStorage desde o commit inicial (pré-source:'manual'), e que
//     5ae766d (que introduziu source:'manual' pra proteger handleSave)
//     aplicou o mesmo carimbo a handleTest sem revisar a consequência —
//     efeito colateral, não decisão deliberada. REAL, corrigido nesta rodada:
//     testConnection agora aceita url/anonKey candidatos e testa SEM gravar
//     nada; handleSave (o botão "Salvar configurações") continua sendo o
//     único caminho de persistência, sem mudança de comportamento.
//
//   · Família C (achado 2) — "Migrar registros locais" offline anunciava "✓
//     undefined registros migrados. Todos os módulos sincronizados." JÁ
//     CORRIGIDO antes desta sessão (49d2a11, v1.9.168) — mesmo achado
//     catalogado por duas lentes (pool de repository.js na tier média, e este
//     pool de settings.jsx na tier alta). Cobertura completa já existe em
//     settings-medios-triagem.test.js; aqui só a confirmação pontual, mesmo
//     padrão usado no resto desta auditoria pros achados já fechados.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/settings.jsx`, 'utf8');

const okJson = (body = []) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const nega = (status, body = '') => Promise.resolve({ ok: false, status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// Família A (achados 1 e 4) — "Limpar duplicatas": calcular() apagava o
// resultado antes de qualquer render mostrar
// ═══════════════════════════════════════════════════════════════════════════
describe('Família A (achados 1 e 4) — "Limpar duplicatas": resultado apagado por calcular() antes do render', () => {
  it('fonte: calcular() não zera mais `resultado` — só `erro`', () => {
    const ini = fonte.indexOf('const calcular = useCallback(async () => {');
    const fim = fonte.indexOf('}, [montarPlano]);', ini);
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('setErro(null);');
    expect(corpo).not.toContain('setResultado(null)');
  });

  it('fonte: a troca de tenant (mount) continua zerando resultado explicitamente — não perdeu essa limpeza', () => {
    expect(fonte).toContain("useEffect(() => { setPlano(null); setResultado(null); calcular(); }, [calcular]);");
  });

  it('fonte: aplicar() grava o resultado real ANTES de chamar calcular() pra recalcular o plano', () => {
    const ini = fonte.indexOf('const aplicar = async () => {');
    const fim = fonte.indexOf('const r = plano?.resumo;', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonte.slice(ini, fim);
    const posResultado = corpo.indexOf('setResultado(out);');
    const posCalcular = corpo.indexOf('await calcular();');
    expect(posResultado).toBeGreaterThan(-1);
    expect(posCalcular).toBeGreaterThan(posResultado);
  });

  // Mecanismo, comprovado revertendo a correção localmente (recolocando
  // `setResultado(null)` no topo de calcular() e rodando os dois testes
  // abaixo — o de "forma ANTIGA" já cobre exatamente essa reversão). Reproduz
  // a MESMA forma assíncrona do componente: calcular() só cede no primeiro
  // `await`, que é dentro de montarPlano — e montarPlano em si não tem
  // prefixo síncrono, porque começa com `await Promise.all(...)` (os dois
  // dynamic import()). Um "setState" fake grava só o ÚLTIMO valor, que é o
  // que qualquer render eventual do React acaba mostrando — nada volta a
  // setar `resultado` depois que calcular() roda.
  describe('mecanismo — a mesma forma assíncrona do componente, isolada', () => {
    const montarPlanoSim = async () => { await Promise.resolve(); return { resumo: {} }; };

    // zeraResultado=true reproduz o código de ANTES desta correção.
    const façaCalcular = (state, zeraResultado) => async () => {
      state.erro = null;
      if (zeraResultado) state.resultado = null;
      state.plano = await montarPlanoSim();
    };

    const aplicarSim = async (state, calcularFn) => {
      // como aplicarLimpezaFormularios devolvendo o pior caso: 0 apagados, 3
      // falharam — é o aviso que MAIS precisa aparecer (manda rodar de novo
      // com internet).
      const out = await Promise.resolve({ apagados: 0, subidos: 2, falhasApagar: 3 });
      state.resultado = out;          // setResultado(out)
      await calcularFn();             // await calcular()
    };

    it('forma ANTIGA (calcular zera resultado): mensagem final é null — o bug, comprovado', async () => {
      const state = { erro: null, plano: null, resultado: null };
      await aplicarSim(state, façaCalcular(state, true));
      expect(state.resultado).toBeNull();
    });

    it('forma NOVA (calcular não toca resultado): mensagem final é o resultado real, aviso incluso', async () => {
      const state = { erro: null, plano: null, resultado: null };
      await aplicarSim(state, façaCalcular(state, false));
      expect(state.resultado).toEqual({ apagados: 0, subidos: 2, falhasApagar: 3 });
      expect(state.resultado.falhasApagar).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Família B (achado 3) — "Testar conexão" gravava a config do Supabase antes
// de testar, e não desfazia quando o teste falhava
// ═══════════════════════════════════════════════════════════════════════════
describe('Família B (achado 3) — "Testar conexão" não grava mais config antes de testar', () => {
  it('fonte: handleTest não chama mais saveSupabaseConfig', () => {
    const ini = fonte.indexOf('const handleTest = async () => {');
    const fim = fonte.indexOf('const testMessage = () => {', ini);
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).not.toContain('saveSupabaseConfig');
    expect(corpo).toContain('testConnection({ url: url.trim(), anonKey: anonKey.trim() })');
  });

  it('fonte: handleSave (botão "Salvar configurações") continua sendo o único a persistir, com o `enabled` real do checkbox', () => {
    const ini = fonte.indexOf('const handleSave = () => {');
    const fim = fonte.indexOf('const handleTest = async () => {', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain("saveSupabaseConfig({ url: url.trim(), anonKey: anonKey.trim(), enabled, source: 'manual' });");
  });

  it('testConnection(override) testa a URL/chave CANDIDATAS, não a config salva', async () => {
    saveSupabaseConfig({ url: 'https://salvo-antigo.test', anonKey: 'chave-salva-antiga', enabled: true, source: 'manual' });
    const fetchMock = vi.fn(() => okJson([]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await supabaseRepository.testConnection({ url: 'https://candidata.test', anonKey: 'chave-nova-digitada' });

    expect(result).toEqual({ ok: true });
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('https://candidata.test/rest/v1/temperature_records');
    expect(String(calledUrl)).not.toContain('salvo-antigo');
    expect(calledOpts.headers.apikey).toBe('chave-nova-digitada');
  });

  it('testConnection(override): credencial ERRADA (401) não grava NADA em localStorage', async () => {
    expect(getSupabaseConfig()).toEqual({ url: '', anonKey: '', enabled: false }); // nada salvo no início
    vi.stubGlobal('fetch', vi.fn(() => nega(401, 'invalid key')));

    const result = await supabaseRepository.testConnection({ url: 'https://candidata.test', anonKey: 'chave-errada' });

    expect(result).toEqual({ ok: false, reason: 'auth_error' });
    // O teste falhou — e como handleTest (settings.jsx) não chama mais
    // saveSupabaseConfig, a config continua vazia. ANTES desta correção, o
    // MERO clique em "Testar conexão" já tinha deixado enabled:true +
    // source:'manual' gravados no localStorage, mesmo com o teste dando
    // errado — e sem nada pra desfazer isso.
    expect(getSupabaseConfig()).toEqual({ url: '', anonKey: '', enabled: false });
  });

  it('sem override, testConnection() continua lendo a config salva — comportamento antigo preservado', async () => {
    saveSupabaseConfig({ url: 'https://salvo.test', anonKey: 'chave-salva', enabled: true, source: 'manual' });
    const fetchMock = vi.fn(() => okJson([]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await supabaseRepository.testConnection();

    expect(result).toEqual({ ok: true });
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('https://salvo.test/rest/v1/temperature_records');
    expect(calledOpts.headers.apikey).toBe('chave-salva');
  });

  // Por que isto era "alta": a mesma marca source:'manual' que handleSave
  // grava de propósito (projeto dedicado, protegido do auto-config) TRAVA o
  // auto-config do tenant no login PRA SEMPRE (shouldAutoConfigSupabase).
  // Gravar isso a partir de um botão de TESTE — sem o usuário nunca ter
  // confirmado "Salvar configurações" — bloqueava a auto-cura do aparelho já
  // na primeira tentativa de teste com credencial errada.
  it('mecanismo: source:"manual" com credencial errada bloquearia o auto-config pra sempre — por isso handleTest não pode mais gravar isso', () => {
    const configComoFicariaAntesDoFix = { url: 'https://candidata.test', anonKey: 'chave-errada', enabled: true, source: 'manual' };
    const tenantSupabase = { url: 'https://seed-correto.test', anonKey: 'chave-seed-boa' };
    const decisao = shouldAutoConfigSupabase(configComoFicariaAntesDoFix, tenantSupabase);
    expect(decisao).toEqual({ apply: false, reason: 'config manual protegida' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Família C (achado 2) — "Migrar registros locais" offline anunciava sucesso
// falso ("✓ undefined registros migrados")
// ═══════════════════════════════════════════════════════════════════════════
describe('Família C (achado 2) — "Migrar registros locais" offline não finge mais sucesso (JÁ CORRIGIDO antes desta sessão)', () => {
  it('migrateAllToSupabase com Supabase habilitado mas offline devolve pushed:0/failed:0 explícitos — nunca undefined', async () => {
    saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const out = await migrateAllToSupabase([{ id: 'swiss' }]);
    expect(out).toEqual({ ok: false, reason: 'offline_or_disabled', pushed: 0, failed: 0 });
    expect(out.pushed).not.toBeUndefined();
    expect(out.failed).not.toBeUndefined();
  });

  it('fonte: handleMigrate checa result.ok ANTES de formatar "✓ N migrados" — não confia em pushed/failed cru', () => {
    const ini = fonte.indexOf('const handleMigrate = async () => {');
    const fim = fonte.indexOf('const handleChangePin = ()', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonte.slice(ini, fim);
    const posCheck = corpo.indexOf('if (!result.ok) {');
    const posPushed = corpo.indexOf('${result.pushed} registros migrados');
    expect(posCheck).toBeGreaterThan(-1);
    expect(posPushed).toBeGreaterThan(posCheck);
    expect(corpo).toContain('Sem internet no momento — nada foi migrado. Tente de novo quando reconectar.');
  });
});
