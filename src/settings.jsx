import React, { useCallback, useState, useEffect } from 'react';
import { APP_VERSION } from './brand';
import { getEffectivePin, writePinOverride, isWeakPin } from './pin';
import { isGlobalAdmin } from './permissions';
import {
  getSupabaseConfig, saveSupabaseConfig, isSupabaseEnabled,
  supabaseRepository, SUPABASE_SQL, migrateAllToSupabase,
  getOfflineQueue, getSyncStatus, pushCompanyProfile, pushComplianceDoc,
} from './repository';
import { DOC_TYPES, latestManualBp } from './compliance';

const COMPANY_PROFILE_KEY = (tenantId) => `nutriops.company.profile.${tenantId}`;

// ─────────────────────────────────────────────────────────────────────────────
// O que entra e o que sai do arquivo de backup.
//
// O filtro era `k.includes(tenantId) || k.includes('nutriops.')` — o segundo
// termo tornava o primeiro inútil e levava TUDO: o "backup da Swiss" carregava
// também CASA DOCE, Bäckerei e DBK, e restaurar sobrescrevia as quatro lojas.
// Achado da auditoria (18/08).
//
// E levava junto credencial: `nutriops.auth.session` (JWT + refresh token),
// `nutriops.supabase.config` e `nutriops.pin.overrides.*` — que o CLAUDE.md diz
// explicitamente que não pode sair do aparelho. Um backup é um arquivo que a
// pessoa manda por e-mail.
//
// Denylist explícita em vez de heurística: chave nova sensível que apareça
// depois entra aqui, e o teste cobra.
const CHAVES_SENSIVEIS = [
  'nutriops.auth.session',
  'nutriops.session',
  'nutriops.supabase.config',
  'nutriops.supabase.auth_error',
  'nutriops.pin.overrides',
  'nutriops.admin.auth',
  'nutriops.operator',
];

export function ehChaveSensivel(k) {
  return CHAVES_SENSIVEIS.some((p) => String(k).startsWith(p));
}

// Uma chave pertence à loja se termina com o id dela. As globais (fila offline,
// cache de temperatura das 4 lojas) NÃO entram: restaurar um backup de uma loja
// não pode reescrever dado das outras.
export function chavesDoBackup(todasAsChaves, tenantId) {
  if (!tenantId) return [];
  return todasAsChaves.filter((k) =>
    String(k).startsWith('nutriops.') && String(k).endsWith(tenantId) && !ehChaveSensivel(k));
}

export function readCompanyProfile(tenantId) {
  try { const r = localStorage.getItem(COMPANY_PROFILE_KEY(tenantId)); return r ? JSON.parse(r) : {}; } catch { return {}; }
}

export function saveCompanyProfile(tenantId, profile) {
  try { localStorage.setItem(COMPANY_PROFILE_KEY(tenantId), JSON.stringify(profile)); } catch {}
}

// ─── Manual de Boas Práticas (Fatia 2b) ────────────────────────────────────
// O app NÃO guarda o arquivo — guarda o ATESTADO de que ele existe (versão,
// data, quem elaborou). Era um dos 5 DESCOBERTOS da auditoria (§3.18): o
// fiscal aceita o manual impresso, o que faltava era o app saber que existe,
// pra parar de responder "sem dado" na tela de Prontidão.
const COMPLIANCE_KEY = (tenantId) => `nutriops.compliance.${tenantId}`;
const lerDocs = (tenantId) => { try { const r = localStorage.getItem(COMPLIANCE_KEY(tenantId)); return r ? JSON.parse(r) : []; } catch { return []; } };

function ManualBpCard({ tenantId }) {
  const [docs, setDocs] = useState(() => lerDocs(tenantId));
  const [salvo, setSalvo] = useState(false);
  useEffect(() => { setDocs(lerDocs(tenantId)); }, [tenantId]);

  // latestManualBp, não .find(): ver compliance.js — duas lojas offline podem
  // ter criado duas linhas manual_bp sem nunca sincronizar entre si, e
  // .find() prendia esta tela na versão do PRÓPRIO aparelho pra sempre.
  const manual = latestManualBp(docs);
  const [versao, setVersao]   = useState(manual?.versao ?? '');
  const [data, setData]       = useState(manual?.issuedAt ?? '');
  const [autor, setAutor]     = useState(manual?.autor ?? '');
  useEffect(() => {
    const m = latestManualBp(lerDocs(tenantId));
    setVersao(m?.versao ?? ''); setData(m?.issuedAt ?? ''); setAutor(m?.autor ?? '');
  }, [tenantId]);

  const salvar = () => {
    // `docs` é a foto de quando o card montou (ou trocou de loja) — mas
    // `nutriops.compliance.{tenantId}` é uma chave COMPARTILHADA com os ASOs
    // (training.jsx) e com o sync (syncComplianceDocs), que grava por baixo
    // deste componente sem avisá-lo (doSync roda em pages.jsx). Relê AGORA em
    // vez de confiar no `docs` do state: a gravação abaixo troca a chave
    // INTEIRA, e escrever por cima do snapshot velho apagaria qualquer ASO
    // que tenha chegado via sync depois da montagem. Achados nº5/nº6 da
    // triagem da auditoria (19/08).
    const atual = lerDocs(tenantId);
    const manualAtual = latestManualBp(atual);
    const atualizado = {
      id: manualAtual?.id ?? crypto.randomUUID(),
      docType: DOC_TYPES.MANUAL_BP, subject: null,
      issuedAt: data || null, validUntil: null,
      versao: versao.trim(), autor: autor.trim(),
      createdAt: manualAtual?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Tira TODAS as entradas manual_bp da lista (não só a de mesmo id): se
    // sobrou duplicata de uma corrida antiga entre dois aparelhos (achado
    // nº4), este salvamento já autocura o aparelho local pra uma linha só.
    const proximos = [atualizado, ...atual.filter((d) => d.docType !== DOC_TYPES.MANUAL_BP)];
    setDocs(proximos);
    try { localStorage.setItem(COMPLIANCE_KEY(tenantId), JSON.stringify(proximos)); } catch {}
    pushComplianceDoc(tenantId, atualizado);
    setSalvo(true); setTimeout(() => setSalvo(false), 2500);
  };

  return (
    <article className="management-card">
      <div className="card-head">
        <div><span className="eyebrow">RDC 216 · §4.11</span><h2>Manual de Boas Práticas</h2></div>
        {manual?.issuedAt ? <span className="badge ok">Atestado</span> : <span className="badge neutral">Sem registro</span>}
      </div>
      <div className="capture-fields">
        <p className="muted">
          O NutriOPS não guarda o arquivo do manual — guarda o registro de que ele existe. O fiscal aceita o manual impresso; o que faltava era a tela de Prontidão saber que ele existe em vez de responder "sem dado".
        </p>
        <div className="grid-2">
          <label>Versão / revisão
            <input value={versao} onChange={(e) => setVersao(e.target.value)} placeholder="Ex.: 3ª revisão" />
          </label>
          <label>Data da versão
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
        </div>
        <label>Elaborado / revisado por
          <input value={autor} onChange={(e) => setAutor(e.target.value)} placeholder="Nome do responsável técnico" />
        </label>
        <div className="actions-row" style={{ justifyContent:'flex-end' }}>
          <button className="primary-action attention" onClick={salvar} disabled={!data}>Registrar manual</button>
        </div>
        {salvo && <div className="submission ok">✓ Manual registrado. A tela de Prontidão já reconhece.</div>}
      </div>
    </article>
  );
}

// ─── Limpeza das planilhas BPF duplicadas ──────────────────────────────────
// Até a v1.9.133 os seeds de Swiss/Bäckerei/DBK sorteavam id novo a cada
// leitura e as planilhas se multiplicavam. A v1.9.133 estancou; este card
// limpa o que já ficou pra trás.
//
// MOSTRA O PLANO ANTES DE APLICAR — de propósito. Cada form_record aponta pro
// formId da cópia em que foi preenchido; apagar cópia sem reconectar deixa o
// registro órfão, e órfão é INVISÍVEL na Central de Não-Conformidades. Numa
// ferramenta de conformidade sanitária isso é destruir evidência, então quem
// aperta o botão vê antes o que vai acontecer.
function LimpezaPlanilhasCard({ tenantId, tenantNome }) {
  const [plano, setPlano] = useState(null);
  const [erro, setErro] = useState(null);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);

  // Única porta de entrada pra montar o plano — lê templates/records DO
  // STORAGE nesse instante. Usada tanto pelo cálculo de exibição (mount e
  // "Recalcular") quanto, agora, pelo instante do clique em "Limpar
  // duplicatas": ver o comentário em `aplicar` sobre por que reusar o plano
  // do state ali era o bug.
  const montarPlano = useCallback(async () => {
    const [{ planejarDedupe }, { readFormTemplates, readFormRecords }] = await Promise.all([
      import('./forms-dedupe'), import('./forms'),
    ]);
    const templates = readFormTemplates({ id: tenantId, name: tenantNome });
    const records = readFormRecords(tenantId);
    return { ...planejarDedupe(templates, records), templates, records };
  }, [tenantId, tenantNome]);

  const calcular = useCallback(async () => {
    // NÃO zera `resultado` aqui. calcular() é chamado de 3 lugares: o efeito
    // de troca de tenant (abaixo, que já zera resultado explicitamente antes
    // de chamar), o botão "Recalcular" (ok manter o último resultado à
    // vista), e de DENTRO de `aplicar()` logo depois de gravar o resultado —
    // esse é o caso que quebrava. A continuação da promise de `aplicar()`
    // roda tudo síncrono até o próximo `await` (que é o de dentro de
    // montarPlano), então gravar o resultado seguido de zerá-lo de novo aqui
    // cai no MESMO lote de atualização do React: nenhum render intermediário
    // chega a mostrar o resultado real, e a tela nunca exibe nem o "✓ limpeza
    // aplicada" nem — o pior caso — o aviso de que cópias NÃO saíram da nuvem
    // (falhasApagar), o único sinal que mandaria a pessoa rodar de novo com
    // internet. Confirmado em vitest+jsdom: sequência de renders era
    // [null, null]. Achado alta-sem-perda da auditoria (19/08).
    setErro(null);
    try { setPlano(await montarPlano()); }
    catch (e) { setErro(e?.message ?? 'Não consegui montar o plano.'); }
  }, [montarPlano]);

  useEffect(() => { setPlano(null); setResultado(null); calcular(); }, [calcular]);

  const aplicar = async () => {
    setErro(null);
    // `plano` (state) pode ter sido montado no mount ou no último
    // "Recalcular" — segundos ou minutos atrás. Nesse intervalo o doSync
    // (boot, ou volta de wi-fi via 'online-event') pode ter trazido registro
    // novo pra nutriops.forms.records.{tenantId}. aplicarLimpezaFormularios
    // REGRAVA A CHAVE INTEIRA (repository.js `lw` = substituição, não merge):
    // aplicar o plano velho apagaria do aparelho tudo que chegou depois do
    // cálculo — o oposto do que o confirm() abaixo promete ("nenhum é
    // apagado"). Recalcula na hora do clique, antes de mostrar o confirm, e
    // usa ESSE plano fresco (não o `plano` do state) pra aplicar.
    // Achado da triagem da auditoria (19/08).
    let planoAtual;
    try { planoAtual = await montarPlano(); }
    catch (e) { setErro(e?.message ?? 'Não consegui montar o plano.'); return; }

    const r = planoAtual.resumo;
    if (r.colisoesDePeriodo > 0) {
      // Colisão nova que não existia no plano exibido — mesma trava do botão
      // (disabled por temColisao), só que reconferida agora com dado fresco.
      setPlano(planoAtual);
      setErro('Apareceu registro novo com colisão de período desde o último cálculo. Confira o plano de novo antes de aplicar.');
      return;
    }
    if (!(r.copiasExcedentes > 0 || r.orfaosRecuperados > 0)) {
      setPlano(planoAtual);
      setErro('Nada para limpar agora — outra sessão já deve ter aplicado a limpeza.');
      return;
    }

    const ok = window.confirm(
      `Limpar as planilhas de ${tenantNome}?\n\n`
      + `• ${r.templatesAntes} planilhas viram ${r.templatesDepois}\n`
      + `• ${r.orfaosRecuperados} registro(s) voltam a aparecer na Central de Não-conformidades\n`
      + `• ${r.registrosPreservados} registros preservados — nenhum é apagado\n\n`
      + 'Pode ser feito de novo se algo ficar pra trás.'
    );
    if (!ok) return;
    setAplicando(true); setErro(null);
    try {
      const [{ aplicarDedupe }, { aplicarLimpezaFormularios }] = await Promise.all([
        import('./forms-dedupe'), import('./repository'),
      ]);
      const limpo = aplicarDedupe(planoAtual.templates, planoAtual.records, planoAtual);
      const out = await aplicarLimpezaFormularios(tenantId, {
        templates: limpo.templates, records: limpo.records,
        apagar: planoAtual.apagar, remapear: planoAtual.remapear,
      });
      setResultado(out);
      await calcular();                       // recalcula: deve sobrar nada
    } catch (e) { setErro(e?.message ?? 'Falha ao aplicar a limpeza.'); }
    finally { setAplicando(false); }
  };

  const r = plano?.resumo;
  const temTrabalho = r && (r.copiasExcedentes > 0 || r.orfaosRecuperados > 0);
  const temColisao = r && r.colisoesDePeriodo > 0;

  return (
    <article className="management-card">
      <div className="card-head">
        <div><span className="eyebrow">Manutenção de dados</span><h2>Planilhas BPF duplicadas</h2></div>
        {r && <span className={`badge ${temTrabalho ? 'warn' : 'ok'}`}>{temTrabalho ? 'Há o que limpar' : 'Limpo'}</span>}
      </div>
      <div className="capture-fields">
        {!plano && !erro && <p className="muted">Analisando as planilhas de {tenantNome}…</p>}
        {erro && <div className="submission danger">✕ {erro}</div>}

        {r && (
          <>
            <div className="grid-2">
              <div className="info-box"><span>Planilhas</span><strong>{r.templatesAntes} → {r.templatesDepois}</strong></div>
              <div className="info-box"><span>Registros preservados</span><strong>{r.registrosPreservados}</strong></div>
            </div>
            {r.orfaosRecuperados > 0 && (
              <div className="submission ok" style={{ fontSize: 12 }}>
                ✓ {r.orfaosRecuperados} registro(s) estão hoje INVISÍVEIS na Central de Não-conformidades (apontam pra uma cópia que não existe mais) e voltam a aparecer com a limpeza.
              </div>
            )}
            {r.orfaosSemDestino > 0 && (
              <p className="muted" style={{ fontSize: 11 }}>
                {r.orfaosSemDestino} registro(s) são de planilha que não existe mais no sistema — ficam como estão, nenhum é apagado.
              </p>
            )}
            {temColisao && (
              <div className="submission danger" style={{ fontSize: 12 }}>
                ✕ {r.colisoesDePeriodo} registro(s) do mesmo período em cópias diferentes. A limpeza automática está bloqueada aqui pra não escolher sozinha qual vale — me chame antes de seguir.
              </div>
            )}
            {!temTrabalho && <p className="muted">Nada duplicado nesta empresa. Nenhuma ação necessária.</p>}
          </>
        )}

        {resultado && (
          <div className="submission ok">
            ✓ Limpeza aplicada. {resultado.apagados} cópia(s) removida(s) da nuvem, {resultado.subidos} registro(s) reconectado(s).
            {resultado.falhasApagar > 0 && ` ${resultado.falhasApagar} cópia(s) não puderam ser removidas da nuvem — rode de novo com internet.`}
          </div>
        )}

        <div className="actions-row" style={{ justifyContent:'flex-end' }}>
          <button className="secondary-action" onClick={calcular} disabled={aplicando}>Recalcular</button>
          <button className="primary-action attention" onClick={aplicar}
            disabled={!temTrabalho || temColisao || aplicando}>
            {aplicando ? 'Limpando…' : 'Limpar duplicatas'}
          </button>
        </div>
      </div>
    </article>
  );
}

export function SettingsView({ session, activeTenant, activeTenants, tenants }) {
  // Infra (Supabase, Anon Key, SQL, migração, backup) é só pro SUPER ADMIN —
  // não faz sentido (e assusta) pro dono de loja, que não é de TI. A anon key é
  // pública por design (o RLS protege), mas não há motivo de exibi-la ao cliente.
  const isSuper = isGlobalAdmin(session);
  // Loja modelo e-mail não usa PIN → esconde "Alterar meu PIN".
  const emailModel = Boolean(activeTenant?._fromMembership || activeTenant?._fromCloud);
  const cfg = getSupabaseConfig();
  const [url,     setUrl]     = useState(cfg.url ?? '');
  const [anonKey, setAnonKey] = useState(cfg.anonKey ?? '');
  const [enabled, setEnabled] = useState(cfg.enabled ?? false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [copied,  setCopied]  = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [migrating, setMigrating]     = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin,     setNewPin]     = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMsg,     setPinMsg]     = useState(null);
  const [profile, setProfile] = useState(() => readCompanyProfile(activeTenant?.id ?? 'global'));
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    setProfile(readCompanyProfile(activeTenant?.id ?? 'global'));
  }, [activeTenant?.id]);

  const setProfileField = (field, value) => setProfile(prev => ({ ...prev, [field]: value }));

  const handleSaveProfile = () => {
    const id = activeTenant?.id ?? 'global';
    // `profile` é o retrato de quando a tela abriu. Se o sync gravou uma versão
    // mais nova depois disso, salvar o retrato velho a apagava — e como
    // pushCompanyProfile carimba updatedAt=agora, a versão velha passava a
    // VENCER na nuvem pra sempre (syncCompanyProfile compara timestamps).
    //
    // O caso concreto: as preferências de organização das planilhas da RT
    // (formPrefs, v1.9.153) moram neste blob. Ela renomeia as abas num
    // aparelho; alguém abre Configurações noutro que ainda não tinha
    // sincronizado, salva o CNPJ, e a organização dela evapora.
    //
    // Mesclar sobre o que está gravado AGORA: os campos deste formulário
    // valem (a pessoa está olhando pra eles), e tudo que o formulário não
    // conhece é preservado. Achado nº7/9 da auditoria de 18/08.
    const atual = readCompanyProfile(id);
    const mesclado = { ...atual, ...profile };
    saveCompanyProfile(id, mesclado);
    // Fatia 2b: o perfil era local-only (auditoria §3.21) — a validade do
    // alvará nasceria evaporando junto com o aparelho. pushCompanyProfile
    // regrava local com o carimbo e sobe (ou enfileira offline).
    pushCompanyProfile(id, mesclado);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2500);
  };

  const handleSave = () => {
    // source:'manual' protege essa config de ser sobrescrita pelo auto-config
    // do tenant no login (handleLogin em pages.jsx) — caso de projeto dedicado.
    saveSupabaseConfig({ url: url.trim(), anonKey: anonKey.trim(), enabled, source: 'manual' });
    window.location.reload();
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    // NÃO grava em localStorage aqui — "Testar conexão" é uma consulta, não
    // uma gravação. Salvar antes de testar (como era) tinha dois problemas:
    // (1) com enabled:true fixo, ignorava o checkbox marcado/desmarcado na
    // tela; (2) com source:'manual', um teste com credencial ERRADA travava
    // shouldAutoConfigSupabase (repository.js) pra sempre — o aparelho ficava
    // com Supabase ligado e chave podre, sem o auto-config de login pra se
    // curar sozinho, e sem desfazer nada quando o teste falhava (quem saía da
    // tela sem tocar "Salvar" achava que não tinha mexido em nada). testConnection
    // agora aceita url/anonKey candidatos — "Salvar configurações" (handleSave,
    // abaixo) continua sendo o único jeito de persistir. Achado alta-sem-perda
    // da auditoria (19/08).
    const result = await supabaseRepository.testConnection({ url: url.trim(), anonKey: anonKey.trim() });
    setTestResult(result); setTesting(false);
  };

  const testMessage = () => {
    if (!testResult) return null;
    if (testResult.ok) return { tone:'ok', text:'✓ Conexão estabelecida! Tabela encontrada.' };
    if (testResult.reason==='table_missing') return { tone:'warn', text:'⚠ Supabase conectado, mas a tabela não existe. Copie e execute o SQL abaixo.' };
    if (testResult.reason==='auth_error')    return { tone:'danger', text:'✕ Chave inválida. Verifique o Anon Key.' };
    if (testResult.reason==='network_error') return { tone:'danger', text:'✕ Não foi possível conectar. Verifique a URL.' };
    return { tone:'danger', text:`✕ Erro (${testResult.reason}).` };
  };
  const msg = testMessage();
  const tableMissing = testResult?.reason === 'table_missing';

  // Dois jeitos de falhar em silêncio que o achado da auditoria (19/08)
  // apontou: (a) fora de contexto seguro (dev server pelo IP da rede da
  // loja) `navigator.clipboard` é undefined — chamar .writeText nele
  // estourava TypeError síncrono dentro do onClick; (b) contexto seguro mas
  // writeText() rejeita (sem foco, permissão negada) — o .then nunca corria e
  // não havia .catch, virava unhandled rejection só no console. Nos dois
  // casos o botão continuava dizendo "Copiar SQL" sem nenhum aviso, e quem
  // colasse no SQL Editor colava o conteúdo antigo da área de transferência.
  const copySql = () => {
    if (!navigator.clipboard?.writeText) {
      setCopyFailed(true); setTimeout(() => setCopyFailed(false), 4000);
      return;
    }
    navigator.clipboard.writeText(SUPABASE_SQL)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => { setCopyFailed(true); setTimeout(() => setCopyFailed(false), 4000); });
  };

  const [exporting, setExporting] = useState(false);

  const handleExportBackup = () => {
    setExporting(true);
    try {
      const backup = {
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        tenantId: activeTenant?.id,
        tenantName: activeTenant?.name,
        data: {},
      };

      const tenantId = activeTenant?.id;
      const keys = chavesDoBackup(Object.keys(localStorage), tenantId);

      keys.forEach(key => {
        try { backup.data[key] = JSON.parse(localStorage.getItem(key)); } catch { backup.data[key] = localStorage.getItem(key); }
      });

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `nutriops-backup-${tenantId}-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleImportBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Sem isto, escolher o MESMO arquivo de novo (ex.: cancelou o confirm
    // abaixo e tentou de novo) não dispara onChange — o <input type="file">
    // só reage quando o value muda, e reselecionar o mesmo arquivo mantém o
    // value igual. `file` já foi capturado acima, então resetar aqui não
    // afeta a leitura que já vai começar. Achado nº1 da triagem da auditoria
    // (19/08).
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (!backup.data) { alert('Arquivo de backup inválido.'); return; }
        if (!window.confirm(`Restaurar backup de ${backup.tenantName} (${backup.exportedAt?.slice(0,10)})?\n\nIsso vai sobrescrever os dados locais.`)) return;
        // Cada chave que falhava era engolida por um catch vazio e o alerta
        // dizia "✓ Backup restaurado!" mesmo assim. Restaurar backup é o
        // último recurso de quem já perdeu dado — confirmar sucesso sem ter
        // restaurado é a pior mentira possível aqui. A falha real é
        // localStorage cheio (QuotaExceeded): as primeiras chaves entram, as
        // últimas não, e a pessoa segue achando que recuperou tudo.
        // Achado nº5 da triagem da auditoria (18/08).
        // Restaura só o que é DESTA loja. Backup antigo (gerado antes da
        // correção) carrega chave das outras — ignorar é o certo: a pessoa
        // pediu pra restaurar uma loja, não pra reescrever as quatro.
        const doTenant = new Set(chavesDoBackup(Object.keys(backup.data), backup.tenantId ?? activeTenant?.id));
        const ignoradas = Object.keys(backup.data).filter((k) => !doTenant.has(k));
        const falharam = [];
        Object.entries(backup.data).filter(([key]) => doTenant.has(key)).forEach(([key, value]) => {
          try { localStorage.setItem(key, JSON.stringify(value)); }
          catch (e) { falharam.push(key); console.warn(`[backup] não restaurou ${key}:`, e?.message); }
        });
        if (falharam.length) {
          alert(
            `⚠ Backup restaurado PARCIALMENTE.\n\n` +
            `${falharam.length} de ${Object.keys(backup.data).length} itens NÃO foram restaurados — ` +
            `o armazenamento do navegador provavelmente está cheio.\n\n` +
            `Não restaurados: ${falharam.join(', ')}\n\n` +
            `Libere espaço (ou use outro aparelho) e restaure de novo antes de confiar nestes dados.`
          );
        } else if (ignoradas.length) {
          alert(
            `✓ Backup restaurado.\n\n` +
            `${ignoradas.length} itens do arquivo foram IGNORADOS por não pertencerem a esta empresa ` +
            `(ou por serem credenciais, que backup não deve carregar). Isso é esperado em backups antigos.`
          );
        } else {
          alert('✓ Backup restaurado! A página será recarregada.');
        }
        window.location.reload();
      } catch { alert('Erro ao ler o arquivo de backup.'); }
    };
    reader.readAsText(file);
  };

  const handleMigrate = async () => {
    if (!isSupabaseEnabled()) { setMigrateResult({ tone:'warn', text:'Habilite o Supabase primeiro.' }); return; }
    setMigrating(true); setMigrateResult(null);
    try {
      const result = await migrateAllToSupabase(activeTenants);
      // O botão só desabilita por `!isSupabaseEnabled()` (linha abaixo) —
      // nunca por navigator.onLine. Sem checar `result.ok`, o aparelho sem
      // internet no momento do clique caía no early-return de
      // migrateAllToSupabase (sem `pushed`/`failed`) e a tela montava "✓
      // undefined registros migrados. Todos os módulos sincronizados." — um
      // sucesso falso pro botão que existe justamente pra resgatar backlog
      // local. Achado da auditoria (19/08).
      if (!result.ok) {
        setMigrateResult({ tone:'warn', text:'Sem internet no momento — nada foi migrado. Tente de novo quando reconectar.' });
      } else {
        setMigrateResult({ tone: result.failed===0?'ok':'warn', text:`✓ ${result.pushed} registros migrados${result.failed>0?` · ${result.failed} falha(s)`:''}. Todos os módulos sincronizados.` });
      }
    } catch (e) {
      setMigrateResult({ tone:'danger', text:`Erro na migração: ${e.message}` });
    }
    setMigrating(false);
  };

  // ⚠️ Mesma correção do "Meu perfil" (extras.jsx): validar e gravar pelo
  // override, que é o que o login lê. Gravar em `users[].pin` não alterava o
  // PIN de login — só mentia um "✓ alterado com sucesso" pro usuário.
  const handleChangePin = () => {
    setPinMsg(null);
    if (!session?.user) return;
    if (newPin.length < 4) { setPinMsg({ tone:'danger', text:'PIN deve ter no mínimo 4 dígitos.' }); return; }
    if (newPin !== confirmPin) { setPinMsg({ tone:'danger', text:'Os PINs não coincidem.' }); return; }
    if (isWeakPin(newPin)) { setPinMsg({ tone:'danger', text:'PIN muito fácil. Escolha outra combinação.' }); return; }
    const tenantId = session.tenantId;
    const users = JSON.parse(localStorage.getItem(`nutriops.users.${tenantId}`) ?? 'null') ??
      (tenants.find(t=>t.id===tenantId)?.usersList ?? []);
    const me = users.find(u=>u.name===session.user.name) ?? { name: session.user.name };
    if (currentPin !== getEffectivePin(tenantId, me)) {
      setPinMsg({ tone:'danger', text:'PIN atual incorreto.' }); return;
    }
    writePinOverride(tenantId, session.user.name, newPin);
    setCurrentPin(''); setNewPin(''); setConfirmPin('');
    setPinMsg({ tone:'ok', text:'✓ PIN alterado com sucesso!' });
  };

  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Infraestrutura</span><h1>Configurações</h1><p className="muted">Dados do estabelecimento, Supabase, migração e segurança de acesso.</p></div></div>

      <article className="management-card" style={{ marginBottom:16 }}>
        <div className="card-head">
          <div><span className="eyebrow">Identificação</span><h2>Dados do estabelecimento</h2></div>
          <span className="badge neutral">{activeTenant?.name}</span>
        </div>
        <div className="capture-fields">
          <p className="muted" style={{ fontSize:12 }}>Estes dados aparecem em todos os PDFs gerados — planilhas, relatórios, certificados e controles. Exigidos pela RDC 216/2004 para fins de fiscalização.</p>
          <div className="grid-2">
            <label>Razão social / Nome do estabelecimento
              <input value={profile.razaoSocial ?? activeTenant?.name ?? ''} onChange={e=>setProfileField('razaoSocial', e.target.value)} placeholder={activeTenant?.name} />
            </label>
            <label>CNPJ
              <input value={profile.cnpj ?? ''} onChange={e=>setProfileField('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
            </label>
          </div>
          <label>Endereço completo
            <input value={profile.endereco ?? ''} onChange={e=>setProfileField('endereco', e.target.value)} placeholder="Rua, nº, Bairro, Cidade - UF, CEP" />
          </label>
          <div className="grid-2">
            <label>Telefone
              <input value={profile.telefone ?? ''} onChange={e=>setProfileField('telefone', e.target.value)} placeholder="(61) 9xxxx-xxxx" />
            </label>
            <label>E-mail de contato
              <input value={profile.email ?? ''} onChange={e=>setProfileField('email', e.target.value)} placeholder="contato@empresa.com.br" />
            </label>
          </div>
          <div className="grid-2">
            <label>Responsável Técnico (RT)
              <input value={profile.rtNome ?? ''} onChange={e=>setProfileField('rtNome', e.target.value)} placeholder="Nome completo da nutricionista" />
            </label>
            <label>CRN do Responsável Técnico
              <input value={profile.rtCrn ?? ''} onChange={e=>setProfileField('rtCrn', e.target.value)} placeholder="Ex.: CRN-1 12345" />
            </label>
          </div>
          <div className="grid-2">
            <label>Tipo de atividade
              <input value={profile.atividade ?? activeTenant?.segment ?? ''} onChange={e=>setProfileField('atividade', e.target.value)} placeholder="Ex.: Padaria, Confeitaria, Produção de alimentos" />
            </label>
            <label>Alvará sanitário / Licença
              <input value={profile.alvara ?? ''} onChange={e=>setProfileField('alvara', e.target.value)} placeholder="Número do alvará" />
            </label>
          </div>
          {/* Fatia 2b: até aqui o app guardava só o NÚMERO do alvará, então a
              tela de Prontidão não tinha como avisar que ele venceu — a
              ressalva vivia no texto do check. */}
          <div className="grid-2">
            <label>Validade do alvará
              <input type="date" value={profile.alvaraValidade ?? ''} onChange={e=>setProfileField('alvaraValidade', e.target.value)} />
            </label>
          </div>
          {/* Fatia 2a: a RDC não fixa prazo de dedetização — quem manda é o
              contrato da loja e a VISA do município. Antes eram 6 meses
              cravados no código; agora a régua da tela de Prontidão é daqui. */}
          <div className="grid-2">
            <label>Validade da dedetização (meses)
              <input type="number" min="1" max="36" value={profile.dedetizacaoMeses ?? 6}
                onChange={e=>setProfileField('dedetizacaoMeses', Number(e.target.value))} />
            </label>
          </div>
          <p className="muted" style={{ fontSize:11 }}>
            A tela de Prontidão usa esse prazo pra avisar quando a dedetização está vencendo. O padrão de 6 meses é o contrato típico — ajuste conforme o contrato da loja e a exigência da vigilância local.
          </p>
          <div className="actions-row" style={{ justifyContent:'flex-end' }}>
            <button className="primary-action attention" onClick={handleSaveProfile}>Salvar dados do estabelecimento</button>
          </div>
          {profileSaved && <div className="submission ok">✓ Dados salvos. Todos os PDFs usarão essas informações.</div>}
        </div>
      </article>

      <ManualBpCard tenantId={activeTenant?.id ?? 'global'} />

      {/* Só admin: mexe no acervo de planilhas da loja inteira. */}
      {isSuper && activeTenant?.id && (
        <LimpezaPlanilhasCard tenantId={activeTenant.id} tenantNome={activeTenant.name ?? activeTenant.id} />
      )}

      {isSuper && (<>
      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Backend</span><h2>Supabase</h2></div>
            <span className={`badge ${isSupabaseEnabled()?'ok':'neutral'}`}>{isSupabaseEnabled()?'Conectado':'Modo local'}</span>
          </div>
          <div className="capture-fields">
            <label>Project URL<input value={url} onChange={(e)=>setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></label>
            <label>Anon Key<textarea value={anonKey} onChange={(e)=>setAnonKey(e.target.value)} placeholder="eyJ…" style={{ minHeight:72, fontFamily:'var(--mono)', fontSize:12 }} /></label>
            <label style={{ flexDirection:'row', alignItems:'center', gap:10, cursor:'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={(e)=>setEnabled(e.target.checked)} />
              <span style={{ color:'var(--text)', fontWeight:600 }}>Usar Supabase como banco de dados</span>
            </label>
            <div className="actions-row">
              <button className="secondary-action" onClick={handleTest} disabled={testing||!url||!anonKey}>{testing?'Testando…':'Testar conexão'}</button>
              <button className="primary-action" onClick={handleSave}>Salvar configurações</button>
            </div>
            {msg && <div className={`submission ${msg.tone}`}>{msg.text}</div>}
          </div>
        </article>

        <article className="management-card" style={tableMissing?{borderColor:'var(--amber-border)',boxShadow:'0 0 0 3px rgba(154,103,0,.1)'}:{}}>
          <div className="card-head">
            <div><span className="eyebrow">SQL</span><h2>Schema do banco de dados</h2>
              {tableMissing && <p style={{ fontSize:12, color:'var(--amber)', fontWeight:600, marginTop:4 }}>👆 Execute este SQL no Supabase</p>}
            </div>
            <button className="secondary-action" style={{ fontSize:12 }} onClick={copySql}>{copied?'✓ Copiado!':copyFailed?'✕ Falha — selecione e copie manualmente':'Copiar SQL'}</button>
          </div>
          <div style={{ padding:'12px 16px' }}>
            <p className="muted" style={{ marginBottom:12 }}>Cole no Supabase → SQL Editor → New query → Run.</p>
            <pre style={{ fontFamily:'var(--mono)', fontSize:11, background:'var(--rail-bg)', color:'#e6edf3', padding:16, borderRadius:'var(--r)', overflow:'auto', lineHeight:1.6, maxHeight:280 }}>{SUPABASE_SQL}</pre>
          </div>
        </article>
      </div>

      <article className="management-card" style={{ marginTop:16 }}>
        <div className="card-head">
          <div><span className="eyebrow">Migração</span><h2>Transferir dados locais para o Supabase</h2></div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <span className="badge neutral">{(() => { try { return JSON.parse(localStorage.getItem('nutriops.temperature.records')||'[]').length; } catch { return 0; } })()} temperaturas</span>
            <span className="badge neutral">{getOfflineQueue().length} na fila</span>
            <span className="badge neutral" style={{ fontSize:10 }}>{(() => { const s = getSyncStatus(); return s?.lastSync ? `sync ${new Date(s.lastSync).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}` : 'sem sync'; })()}</span>
          </div>
        </div>
        <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column', gap:12 }}>
          <p className="muted">Envia todos os dados locais para o Supabase: temperatura, planilhas BPF, recebimento, produtos, controles especiais e movimentações de estoque. Execute apenas uma vez após configurar o Supabase.</p>
          {!isSupabaseEnabled() && getOfflineQueue().length > 0 && (
            <div className="submission warn">
              ⚠ Há {getOfflineQueue().length} registros aguardando sincronização. Eles serão enviados automaticamente assim que o Supabase for habilitado e a página recarregar.
            </div>
          )}
          <div className="actions-row">
            <button className="primary-action" onClick={handleMigrate} disabled={migrating||!isSupabaseEnabled()}>
              {migrating ? '⏳ Migrando…' : '↑ Migrar registros locais para Supabase'}
            </button>
          </div>
          {migrateResult && <div className={`submission ${migrateResult.tone}`}>{migrateResult.text}</div>}
        </div>
      </article>

      <article className="management-card" style={{ marginTop:16 }}>
        <div className="card-head">
          <div><span className="eyebrow">Dados</span><h2>Backup e restauração</h2></div>
        </div>
        <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column', gap:12 }}>
          <p className="muted">Exporte todos os dados da empresa para um arquivo JSON. Use para backup ou para migrar para outro dispositivo.</p>
          <div className="actions-row">
            <button className="secondary-action" onClick={handleExportBackup} disabled={exporting}>
              {exporting ? '⏳ Exportando…' : '↓ Exportar backup completo'}
            </button>
            <label style={{ cursor:'pointer' }}>
              <span className="secondary-action" style={{ display:'inline-block' }}>↑ Restaurar backup</span>
              <input type="file" accept=".json" onChange={handleImportBackup} style={{ display:'none' }} />
            </label>
          </div>
          <div style={{ padding:'10px 12px', background:'var(--amber-light)', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', fontSize:12, color:'var(--amber)' }}>
            ⚠ Restaurar substitui os dados locais. Faça um backup antes.
          </div>
        </div>
      </article>
      </>)}
      {!emailModel && !isSuper && (
      <article className="management-card" style={{ marginTop:16 }}>
        <div className="card-head"><div><span className="eyebrow">Segurança</span><h2>Alterar meu PIN</h2></div>
          <span className="badge neutral">{session?.user?.name}</span>
        </div>
        <div className="capture-fields" style={{ maxWidth:360 }}>
          <label>PIN atual
            <input type="password" inputMode="numeric" maxLength={6} value={currentPin} onChange={(e)=>setCurrentPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }} />
          </label>
          <label>Novo PIN (4–6 dígitos)
            <input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={(e)=>setNewPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }} />
          </label>
          <label>Confirmar novo PIN
            <input type="password" inputMode="numeric" maxLength={6} value={confirmPin} onChange={(e)=>setConfirmPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }}
              onKeyDown={(e)=>{ if(e.key==='Enter') handleChangePin(); }} />
          </label>
          <button className="primary-action" onClick={handleChangePin} disabled={!currentPin||!newPin||!confirmPin}>Alterar PIN</button>
          {pinMsg && <div className={`submission ${pinMsg.tone}`}>{pinMsg.text}</div>}
        </div>
      </article>
      )}
    </section>
  );
}
