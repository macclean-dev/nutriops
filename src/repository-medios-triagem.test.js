import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ls, lw, getOfflineQueue, clearOfflineQueue, saveSupabaseConfig,
  deletePOPCloud, deleteComplianceDoc, deleteStaffMember, deleteProductCloud,
  migrateAllToSupabase, valorTemperaturaValido,
  pushReceivingRecord,
  pushSpecialControl, syncSpecialControls,
  mergeByKey,
} from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 13 achados de gravidade MÉDIA sem perda de dado que
// apontam pra src/repository.js (pool de 169 não-julgados da auditoria de
// falha silenciosa, 18-19/08). Agrupados por família — a causa raiz repete
// por várias lentes em vários achados.
//
// Dois achados (renomear equipamento cria linha órfã / o sync devolve o nome
// velho — mesmo trecho, dois números) já estavam RESOLVIDOS por um commit
// anterior ao de hoje (pages.jsx saveItem chama deleteEquipmentItem no
// rename; ver src/equipamento-renomear.test.js e
// src/pages-medios-triagem.test.js). Não duplicados aqui.
// ─────────────────────────────────────────────────────────────────────────────

const okJson = (body) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const online = () => {
  saveSupabaseConfig({ url: 'https://x.test', anonKey: 'anon123', enabled: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
};
const offline = () => { vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); };

beforeEach(() => { localStorage.clear(); clearOfflineQueue(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
// FAMÍLIA 1 — "Remover" (equipamento/POP/ASO/ativo/colaborador) sem internet,
// ou com falha real, some da tela e ninguém avisa. deleteEquipmentItem já
// tinha sido corrigido numa rodada anterior (pages.jsx removeItem/saveItem —
// ver pages-medios-triagem.test.js); os OUTROS 4 caminhos com o MESMO padrão
// (POPs, ASO, ativo de manutenção, colaborador) ainda descartavam o retorno
// com `.catch(() => {})`. 2 achados do pool (equipamento+POP+ASO+ativo;
// colaborador no rename) — mesma causa raiz.
// ─────────────────────────────────────────────────────────────────────────────
describe('Família 1 — deletes que o chamador ignorava agora dizem por quê falharam', () => {
  it('deletePOPCloud offline devolve reason:offline_or_disabled (antes era {ok:false} pelado)', async () => {
    offline();
    expect(await deletePOPCloud('swiss', 'p1')).toEqual({ ok: false, reason: 'offline_or_disabled' });
  });

  it('deleteComplianceDoc offline devolve reason:offline_or_disabled', async () => {
    offline();
    expect(await deleteComplianceDoc('swiss', 'd1')).toEqual({ ok: false, reason: 'offline_or_disabled' });
  });

  it('deleteStaffMember offline devolve reason:offline_or_disabled', async () => {
    offline();
    expect(await deleteStaffMember('swiss', 'Ana')).toEqual({ ok: false, reason: 'offline_or_disabled' });
  });

  it('controls.jsx: deletePOP aguarda deletePOPCloud e só avisa em falha REAL (não offline)', () => {
    const fonte = readFileSync(`${process.cwd()}/src/controls.jsx`, 'utf8');
    expect(fonte).toContain('const deletePOP = async (id) => {');
    expect(fonte).toContain('const r = await deletePOPCloud(activeTenant.id, id);');
    expect(fonte).toContain("if (!r.ok && r.reason !== 'offline_or_disabled') {");
    expect(fonte).not.toContain('deletePOPCloud(activeTenant.id, id);\n    if (selected');
  });

  it('training.jsx: remover (ASO) aguarda deleteComplianceDoc e só avisa em falha REAL', () => {
    const fonte = readFileSync(`${process.cwd()}/src/training.jsx`, 'utf8');
    expect(fonte).toContain('const remover = async (docId) => {');
    expect(fonte).toContain('const r = await deleteComplianceDoc(tenant.id, docId);');
    expect(fonte).toContain("if (!r.ok && r.reason !== 'offline_or_disabled') {");
  });

  it('maintenance.jsx: onDelete do ativo aguarda deleteMaintenanceItem e só avisa em falha REAL', () => {
    const fonte = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');
    expect(fonte).toContain("onDelete={async (id) => {");
    expect(fonte).toContain("const r = await deleteMaintenanceItem('equip_assets', activeTenant.id, id);");
    expect(fonte).toContain("if (!r.ok && r.reason !== 'offline_or_disabled') {");
  });

  it('team-views.jsx: renomear colaborador aguarda o delete do nome antigo e avisa em falha REAL', () => {
    const fonte = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');
    expect(fonte).toContain('const r = await m.deleteStaffMember(activeTenant.id, nomeAntigo);');
    expect(fonte).toContain("if (!r.ok && r.reason !== 'offline_or_disabled') {");
  });

  it('team-views.jsx: removeUser (remoção direta) também aguarda e avisa em falha REAL', () => {
    const fonte = readFileSync(`${process.cwd()}/src/team-views.jsx`, 'utf8');
    expect(fonte).toContain('const r = await m.deleteStaffMember(activeTenant.id, alvo.name);');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAMÍLIA 2 — "Migrar registros locais" offline devolve {ok:false} pelado;
// settings.jsx nunca checava `ok`, só `pushed`/`failed` (undefined), e
// montava "✓ undefined registros migrados. Todos os módulos sincronizados."
// — um sucesso falso. 2 achados do pool (T1 e T3, mesmo trecho).
// ─────────────────────────────────────────────────────────────────────────────
describe('Família 2 — migrateAllToSupabase offline não finge sucesso', () => {
  it('offline devolve pushed:0/failed:0 explícitos, não undefined', async () => {
    offline();
    const out = await migrateAllToSupabase([{ id: 'swiss' }]);
    expect(out).toEqual({ ok: false, reason: 'offline_or_disabled', pushed: 0, failed: 0 });
  });

  it('settings.jsx checa result.ok ANTES de montar a frase de "✓ N registros migrados"', () => {
    const fonte = readFileSync(`${process.cwd()}/src/settings.jsx`, 'utf8');
    expect(fonte).toContain('if (!result.ok) {');
    expect(fonte).toContain('Sem internet no momento — nada foi migrado. Tente de novo quando reconectar.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAMÍLIA 3 — syncSpecialControls corta em 200 um merge NÃO-ordenado: como
// mergeByKey devolve local-primeiro/remoto-anexado-no-fim (ordem de
// inserção, não de data), um aparelho com o cache local já cheio nunca
// deixava ENTRAR nada registrado em outro aparelho — o slice cru cortava
// exatamente os remotos. Mesmo defeito já corrigido pra temperatura
// (supabaseRepository.list, "ORDENAR ANTES DE CORTAR"). 2 achados do pool
// (mesmo trecho, duas lentes). O teto também estava capenga: 200 aqui vs 300
// na HandwashView (extras.jsx) — "Total geral" caía sozinho depois de
// qualquer sync em segundo plano.
// ─────────────────────────────────────────────────────────────────────────────
describe('Família 3 — syncSpecialControls ordena antes de cortar, e o teto bate com a UI', () => {
  const linha = (id, diasAtras) => ({ id, resultado: 'conforme', createdAt: new Date(Date.now() - diasAtras * 86400000).toISOString() });
  const rowRemoto = (id, diasAtras) => ({
    id, tenant_id: 'swiss', control_type: 'oil',
    data: { id, resultado: 'conforme' }, resultado: 'conforme', user_name: 'Ana',
    created_at: new Date(Date.now() - diasAtras * 86400000).toISOString(),
  });

  it('registro de OUTRO aparelho (mais novo) sobrevive ao corte mesmo com o cache local cheio', async () => {
    online();
    // 300 registros locais antigos (encheriam o teto velho de 200 sozinhos)
    lw('nutriops.oil.swiss', Array.from({ length: 300 }, (_, i) => linha(`local-${i}`, 60)));
    // 80 registros vindos de OUTRO aparelho, mais recentes
    const remoto = Array.from({ length: 80 }, (_, i) => rowRemoto(`remoto-${i}`, 1));
    vi.stubGlobal('fetch', vi.fn(() => okJson(remoto)));

    await syncSpecialControls('oil', 'swiss');
    const local = ls('nutriops.oil.swiss', []);
    const sobreviventesRemotos = local.filter((r) => r.id.startsWith('remoto-'));
    expect(sobreviventesRemotos).toHaveLength(80);       // ✅ nenhum remoto descartado
    expect(local.length).toBeLessThanOrEqual(300);        // teto continua valendo
  });

  it('o que sobra do corte são os mais ANTIGOS, não os que vieram do outro aparelho', async () => {
    online();
    lw('nutriops.oil.swiss', Array.from({ length: 300 }, (_, i) => linha(`local-${i}`, 60)));
    const remoto = Array.from({ length: 80 }, (_, i) => rowRemoto(`remoto-${i}`, 1));
    vi.stubGlobal('fetch', vi.fn(() => okJson(remoto)));

    await syncSpecialControls('oil', 'swiss');
    const local = ls('nutriops.oil.swiss', []);
    expect(local[0].id).toContain('remoto-');   // mais recente primeiro
  });

  it('pushSpecialControl guarda até 300 (não 200) — mesmo teto que a HandwashView já usava', async () => {
    offline();
    lw('nutriops.handwash.swiss', Array.from({ length: 250 }, (_, i) => linha(`velho-${i}`, 10)));
    await pushSpecialControl('handwash', 'swiss', { id: 'novo', resultado: 'conforme', createdAt: new Date().toISOString() });
    expect(ls('nutriops.handwash.swiss', [])).toHaveLength(251);   // 250+1, nada cortado a 200
  });

  // O teto de repository.js virou 300, mas óleo/descongelamento/resfriamento/
  // tratamento térmico (controls.jsx) recortavam o PRÓPRIO state em
  // setRecords(...).slice(0, 200) — um número mágico duplicado, não corrigido
  // pela mudança acima. Não é um dos 13 achados do pool (achado original só
  // citava HandwashView vs. repository.js); encontrado ao revisar o fix desta
  // família e fechado na mesma rodada, exportando SPECIAL_CONTROLS_CAP pra
  // não deixar o mesmo número duplicado divergir de novo.
  it('controls.jsx e extras.jsx importam SPECIAL_CONTROLS_CAP em vez de repetir 200/300 solto', () => {
    const controls = readFileSync(`${process.cwd()}/src/controls.jsx`, 'utf8');
    const extras   = readFileSync(`${process.cwd()}/src/extras.jsx`, 'utf8');
    expect(controls).toContain('SPECIAL_CONTROLS_CAP');
    expect(extras).toContain('SPECIAL_CONTROLS_CAP');
    // nenhum dos 5 setRecords(...).slice ao adicionar registro deve sobrar com 200/300 cru
    expect(controls).not.toMatch(/setRecords\(prev => \[[^\]]*\.\.\.\s*prev\]\.slice\(0,\s*200\)\)/);
    expect(extras).not.toMatch(/setRecords\(prev => \[[^\]]*\.\.\.\s*prev\]\.slice\(0,\s*300\)\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAMÍLIA 4 — Registrar um recebimento decepa o histórico que o sync tinha
// acabado de puxar da nuvem: syncReceiving/syncModule grava até 1000 itens
// SEM teto (local-primeiro-depois-remoto, sem ordenar); pushReceivingRecord
// corta em 300 por POSIÇÃO, não por data — se o dispositivo já tem 300+
// locais, o corte apaga sistematicamente os que vieram do OUTRO aparelho.
// 1 achado, mas o próprio achado avisa que o mesmo corte se repete em
// pages.jsx (RecebimentoView) — os dois precisam da correção.
// ─────────────────────────────────────────────────────────────────────────────
describe('Família 4 — pushReceivingRecord ordena antes de cortar; a tela mescla em vez de sobrescrever', () => {
  const recebimento = (id, minutosAtras) => ({ id, fornecedor: 'Fornecedor X', resultado: 'aceito', createdAt: new Date(Date.now() - minutosAtras * 60000).toISOString() });

  it('recebimentos de OUTRO aparelho sobrevivem ao corte de 300 mesmo com o local cheio', async () => {
    offline(); // caminho local roda igual — o corte é ANTES do branch online/offline
    const locais  = Array.from({ length: 300 }, (_, i) => recebimento(`local-${i}`, 100000 + i));   // bem antigos
    const remotos = Array.from({ length: 30 },  (_, i) => recebimento(`remoto-${i}`, 1000 + i));    // mais recentes que os locais
    lw('nutriops.receiving.swiss', [...locais, ...remotos]);   // ordem que syncModule grava: local-primeiro, remoto-no-fim

    await pushReceivingRecord('swiss', recebimento('novo', 0));   // o mais recente de todos

    const salvos = ls('nutriops.receiving.swiss', []);
    expect(salvos).toHaveLength(300);
    expect(salvos.filter((r) => r.id.startsWith('remoto-'))).toHaveLength(30);   // ✅ nenhum descartado
    expect(salvos[0].id).toBe('novo');   // mais recente primeiro
  });

  it('pages.jsx: RecebimentoView relê no sync e grava MESCLANDO (mesmo padrão de Oil/Thaw/Cool/Thermal/Handwash)', () => {
    const fonte = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
    expect(fonte).toContain("import { notificarSyncAplicado, gravarMesclando, SYNC_EVENT } from './lista-local';");
    expect(fonte).toContain('gravarMesclando(recLoad, recSave, activeTenant.id, items);');
    expect(fonte).toContain("window.addEventListener(SYNC_EVENT, reler);");
    // o padrão antigo (lê 1x no mount, regrava tudo a cada mudança) não pode sobrar
    expect(fonte).not.toContain('useEffect(() => { setItems(recLoad(activeTenant.id)); }, [activeTenant.id]);');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAMÍLIA 5 — "Remover produto" (Validades e Estoque) não tinha NENHUM
// caminho de delete na nuvem — nem online-only. syncProducts faz merge
// local+remoto por id, então o produto apagado voltava no sync seguinte.
// 1 achado.
// ─────────────────────────────────────────────────────────────────────────────
describe('Família 5 — deleteProductCloud: "Remover produto" agora tem caminho na nuvem', () => {
  it('a função existe e é exportada (não existia antes)', () => {
    expect(typeof deleteProductCloud).toBe('function');
  });

  it('offline: online-only, não enfileira (mesmo motivo do deleteEquipmentItem)', async () => {
    offline();
    const out = await deleteProductCloud('swiss', 'prod1');
    expect(out).toEqual({ ok: false, reason: 'offline_or_disabled' });
    expect(getOfflineQueue()).toHaveLength(0);
  });

  it('online: manda DELETE filtrado por tenant_id E id', async () => {
    online();
    const fetchMock = vi.fn(() => okJson(null));
    vi.stubGlobal('fetch', fetchMock);
    const out = await deleteProductCloud('swiss', 'prod1');
    expect(out).toEqual({ ok: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('DELETE');
    expect(url).toContain('/rest/v1/products');
    expect(url).toContain('tenant_id=eq.swiss');
    expect(url).toContain('id=eq.prod1');
  });

  it('falha real (online, servidor recusa) devolve reason com a mensagem', async () => {
    online();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('erro interno') })));
    const out = await deleteProductCloud('swiss', 'prod1');
    expect(out.ok).toBe(false);
    expect(out.reason).toBeTruthy();
  });

  it('validity.jsx: deleteProduct chama deleteProductCloud com await e avisa em falha real', () => {
    const fonte = readFileSync(`${process.cwd()}/src/validity.jsx`, 'utf8');
    expect(fonte).toContain("import { pushProduct, deleteProductCloud, pushValidityRules, syncValidityRules");
    expect(fonte).toContain('const deleteProduct = async (id) => {');
    expect(fonte).toContain('const r = await deleteProductCloud(activeTenant.id, id);');
    expect(fonte).toContain("if (!r.ok && r.reason !== 'offline_or_disabled') {");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAMÍLIA 6 — Foto de evidência: signedPhotoUrl devolve `null` em QUALQUER
// falha (offline, RLS, link recusado) — indistinguível de "ainda carregando"
// pro PhotoField, que renderizava o MESMO quadrado "abrindo…" pros dois
// casos, pra sempre. 1 achado.
// ─────────────────────────────────────────────────────────────────────────────
describe('Família 6 — PhotoField distingue "carregando" de "falhou"', () => {
  it('forms.jsx tem um state de carregamento separado da URL resolvida', () => {
    const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
    expect(fonte).toContain('const [carregandoUrl, setCarregandoUrl] = useState(Boolean(value?.path));');
    expect(fonte).toContain('setCarregandoUrl(true);');
    expect(fonte).toContain(".finally(() => { if (!cancelado) setCarregandoUrl(false); });");
  });

  it('o quadrado tracejado mostra um estado de falha diferente de "abrindo…"', () => {
    const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
    expect(fonte).toContain('falha ao abrir');
    // o ternário antigo (só url ? foto : "abrindo…", sem 3º estado) não pode sobrar
    expect(fonte).not.toContain("{url\n            ? <a href={url} target=\"_blank\" rel=\"noreferrer\"><img src={url} alt=\"Evidência\" style={{ width:88, height:88, objectFit:'cover', borderRadius:'var(--r)', border:'1px solid var(--border)' }} /></a>\n            : <div style={{ width:88, height:88, borderRadius:'var(--r)', border:'1px dashed var(--border)', display:'grid', placeItems:'center', fontSize:11, color:'var(--text-secondary)' }}>abrindo…</div>}");
  });

  it('signedPhotoUrl loga o motivo real da falha (offline/RLS/erro) — antes era mudo até no console', async () => {
    online();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('') })));
    const { signedPhotoUrl } = await import('./repository');
    const out = await signedPhotoUrl('swiss', 'swiss/f1/2026-08/foto-abc.jpg');
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAMÍLIA 7 — migrateAllToSupabase empurra o cache de temperatura sem a
// mesma guarda de valor não-finito que já existe pra fila (purgarFilaEnvenenada):
// um registro com value:NaN/null nunca é aceito pelo Postgres (23502), conta
// como `failed` PARA SEMPRE, e o auto-backfill (que só fecha com failed:0)
// refaz TODOS os módulos a cada boot, sem parar. 1 achado.
// ─────────────────────────────────────────────────────────────────────────────
describe('Família 7 — migrateAllToSupabase pula temperatura envenenada em vez de falhar pra sempre', () => {
  it('valorTemperaturaValido: mesma régua de purgarFilaEnvenenada (null/undefined/NaN/texto reprovam; 0 passa)', () => {
    expect(valorTemperaturaValido(null)).toBe(false);
    expect(valorTemperaturaValido(undefined)).toBe(false);
    expect(valorTemperaturaValido(NaN)).toBe(false);
    expect(valorTemperaturaValido('abc')).toBe(false);
    expect(valorTemperaturaValido(0)).toBe(true);
    expect(valorTemperaturaValido(-18)).toBe(true);
  });

  it('registro com value:null (o NaN depois de passar por JSON) é pulado — não conta como failed, não tenta o POST', async () => {
    online();
    localStorage.setItem('nutriops.temperature.records', JSON.stringify([
      { id: 'bom', tenantId: 'swiss', value: -18, createdAt: '2026-08-17T10:00:00.000Z' },
      { id: 'envenenado', tenantId: 'swiss', value: null, createdAt: '2026-08-17T10:05:00.000Z' },
    ]));
    // Simula o Postgres de verdade: `value numeric not null` recusa QUALQUER
    // POST com value:null com 23502 — em toda tentativa, pra sempre. Um mock
    // que sempre diz "ok" não reproduz o incidente (a fila giraria fingindo
    // sucesso); a guarda tem que evitar a TENTATIVA, não só tolerar a falha.
    const fetchMock = vi.fn((url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (url.includes('temperature_records') && body.value === null) {
        return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('{"code":"23502","message":"null value in column \\"value\\""}') });
      }
      return okJson(null);
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await migrateAllToSupabase([{ id: 'swiss' }]);
    expect(out.pushed).toBe(1);
    expect(out.failed).toBe(0);   // ✅ não fica preso em failed>0 pra sempre
    const postsDeTemperatura = fetchMock.mock.calls.filter(([url]) => url.includes('temperature_records'));
    expect(postsDeTemperatura).toHaveLength(1);   // só o bom tentou subir
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAMÍLIA 8 — workOrderToRow guarda o objeto inteiro em `data`; "✓ Concluir"
// não bumpava updatedAt, então em caso de conclusão OFFLINE seguida de sync
// (pull antes do push da fila), o empate em mergeByKey (>=) deixava o
// REMOTO (ainda "aberta", processado por último no array) vencer — a OS
// concluída voltava a aparecer aberta, contradizendo o próprio Histórico
// (que já mostra a execução). 1 achado.
// ─────────────────────────────────────────────────────────────────────────────
describe('Família 8 — "✓ Concluir" bumpa updatedAt, senão o pull reabre a OS concluída', () => {
  it('mergeByKey: empate de updatedAt deixa o item processado DEPOIS vencer (é o mecanismo do bug)', () => {
    const local  = { id: 'os1', status: 'concluida', updatedAt: '2026-08-10T10:00:00.000Z' };
    const remoto = { id: 'os1', status: 'aberta',    updatedAt: '2026-08-10T10:00:00.000Z' };
    // syncModule sempre monta [...local, ...remoto] — local primeiro
    const [out] = mergeByKey([local, remoto], 'id');
    expect(out.status).toBe('aberta');   // reproduz o defeito sem o bump
  });

  it('mergeByKey: updatedAt bumpado (mais novo que o remoto) faz "concluida" sobreviver ao pull', () => {
    const local  = { id: 'os1', status: 'concluida', updatedAt: '2026-08-10T10:05:00.000Z' };
    const remoto = { id: 'os1', status: 'aberta',    updatedAt: '2026-08-10T10:00:00.000Z' };
    const [out] = mergeByKey([local, remoto], 'id');
    expect(out.status).toBe('concluida');   // ✅ é o que o bump garante
  });

  it('maintenance.jsx: o clique em "✓ Concluir" carimba updatedAt novo no objeto', () => {
    const fonte = readFileSync(`${process.cwd()}/src/maintenance.jsx`, 'utf8');
    expect(fonte).toContain(
      "const updated = { ...o, status:'concluida', completedAt:new Date().toISOString(), completedBy:session?.user?.name, updatedAt:new Date().toISOString() };"
    );
  });
});
