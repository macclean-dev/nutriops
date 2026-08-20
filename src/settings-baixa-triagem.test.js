import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { saveCompanyProfile, readCompanyProfile } from './settings';
import { getStorageFull, clearStorageFull } from './repository';
import { planejarDedupe } from './forms-dedupe';
import { extractNonConformities } from './forms';

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 5 achados de gravidade BAIXA que apontam pra
// src/settings.jsx (pool de 169 não-julgados da auditoria de falha silenciosa,
// 18-19/08 — data_achados_pendentes_19-08.json, filtro gravidade=='baixa' &&
// arquivo termina em settings.jsx). Fecha a tier "baixa" — a última.
//
// 4 são SEM perda de dado, 1 é COM perda de dado (Achado 0). settings.jsx já
// tinha recebido fixes em duas tiers anteriores: média (162b126, v1.9.169 —
// input de backup resetando value, "Copiar SQL" com guarda de Clipboard,
// ManualBpCard com latestManualBp, Planilhas BPF recalculando no clique) e
// alta (8d7294f, v1.9.177 — "Limpar duplicatas" não apaga mais a própria
// mensagem, "Testar conexão" não grava mais config antes de testar). Nenhum
// dos 5 achados abaixo repete esses — todos são pontos novos do arquivo.
//
//   · Achado 0 (COM perda de dado) — "Salvar dados do estabelecimento":
//     saveCompanyProfile tinha um try/catch PRÓPRIO vazio (não usava o `lw`
//     compartilhado de repository.js) e handleSaveProfile confirmava "✓ Dados
//     salvos" incondicional. Com armazenamento cheio, o CNPJ/RT/validade do
//     alvará digitados nunca chegavam a existir em disco, e a pessoa não
//     tinha como saber — só descobria ao recarregar e ver os campos vazios de
//     novo. REAL, corrigido: saveCompanyProfile agora delega pro `lw`
//     (mesmo helper que toda outra gravação local do app usa desde o achado
//     nº15 da auditoria original) e devolve o resultado; handleSaveProfile só
//     mostra sucesso quando ele é true, e mostra uma mensagem de falha real
//     (submission danger) quando não é.
//
//   · Achado 1 — botão .secondary-action/.ghost-action desabilitado era
//     visualmente IDÊNTICO a um habilitado (cursor de mão + hover reagindo):
//     só .primary-action tinha tratamento de :disabled em styles.css. Achado
//     nasceu em "Testar conexão" sem Anon Key, mas o defeito é da FOLHA DE
//     ESTILO — vale pra "Recalcular", "↓ Exportar backup completo" e todo
//     outro botão desabilitado do app. REAL, corrigido em styles.css (regra
//     :disabled comum aos três tipos + guarda :not(:disabled) nos hovers,
//     claro e escuro).
//
//   · Achado 2 — "Exportar backup completo": handler 100% síncrono, então
//     "⏳ Exportando…" nunca chegava a renderizar (os dois setState caíam no
//     mesmo lote) e não existia NENHUMA confirmação de sucesso — só a barra
//     de download do navegador, ausente em PWA instalado. REAL, corrigido:
//     o trabalho pesado roda dentro de um setTimeout(0) (cede um tick pro
//     React pintar "Exportando…") e SEMPRE fecha com uma mensagem real na
//     tela (sucesso ou falha, com try/catch de verdade agora).
//
//   · Achado 3 — "Restaurar backup": FileReader sem onerror. Uma falha de
//     LEITURA (NotReadableError — arquivo só na nuvem, tipo iCloud Drive sem
//     cópia local) dispara onerror, não onload — nem o try/catch nem o alert
//     de dentro de onload entravam em cena, e a tela ficava parecendo
//     travada. REAL, corrigido: reader.onerror agora avisa com alert().
//
//   · Achado 4 — o contador "órfãos recuperados" promete "voltam a aparecer
//     na Central de Não-conformidades", mas conta TODO órfão reconectado —
//     a Central só lista quem tem uma seção "-nc" com descrição preenchida
//     (extractNonConformities, forms.jsx). Medido na Swiss (16/08): 35
//     órfãos recuperados, a maioria sem NC nenhuma relatada — a pessoa
//     conferia a Central, achava quase nada, e concluía (errado) que a
//     limpeza não tinha funcionado. REAL, corrigido: montarPlano agora
//     recalcula com o MESMO extractNonConformities que a Central usa de
//     verdade (ncRecuperadas), e a mensagem + o confirm() só prometem a
//     Central quando esse número é > 0.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/settings.jsx`, 'utf8');
const css   = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

beforeEach(() => { localStorage.clear(); clearStorageFull(); });
afterEach(() => { vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// Achado 0 (COM PERDA DE DADO) — "Salvar dados do estabelecimento"
// ═══════════════════════════════════════════════════════════════════════════
describe('Achado 0 (COM perda de dado) — saveCompanyProfile não finge mais sucesso', () => {
  it('fonte: saveCompanyProfile delega pro `lw` compartilhado — não tem mais catch vazio próprio', () => {
    const ini = fonte.indexOf('export function saveCompanyProfile(tenantId, profile) {');
    const fim = fonte.indexOf('\n}', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('return lw(COMPANY_PROFILE_KEY(tenantId), profile);');
    expect(corpo).not.toContain('try { localStorage.setItem');
    expect(corpo).not.toContain('catch {}');
  });

  it('fonte: handleSaveProfile só confirma "Dados salvos" quando a gravação local teve sucesso', () => {
    const ini = fonte.indexOf('const handleSaveProfile = () => {');
    const fim = fonte.indexOf('const handleSave = () => {', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('const salvou = saveCompanyProfile(id, mesclado);');
    const posSalvou = corpo.indexOf('const salvou = saveCompanyProfile(id, mesclado);');
    const posIf = corpo.indexOf('if (salvou) {');
    expect(posIf).toBeGreaterThan(posSalvou);
    expect(corpo).toContain('setProfileSaveFailed(!salvou);');
  });

  it('fonte: existe uma mensagem de falha real na tela — antes só existia o "✓ Dados salvos" incondicional', () => {
    expect(fonte).toContain('const [profileSaveFailed, setProfileSaveFailed] = useState(false);');
    expect(fonte).toContain('{profileSaveFailed && <div className="submission danger">');
  });

  // ─── Mecanismo real (não simulado) — a prova de perda de dado de verdade ──
  describe('mecanismo real: armazenamento cheio no momento de salvar o perfil', () => {
    const TENANT = 'triagem-perfil-cheio';
    const KEY = `nutriops.company.profile.${TENANT}`;

    it('saveCompanyProfile devolve false e o dado NOVO nunca chega a existir — o velho continua intacto', () => {
      // Perfil salvo de verdade primeiro (sem mock) — é o que a pessoa via na
      // tela antes de editar de novo (CNPJ e razão social já preenchidos).
      saveCompanyProfile(TENANT, { razaoSocial: 'Padaria Antiga', cnpj: '00.000.000/0001-00' });
      expect(readCompanyProfile(TENANT).razaoSocial).toBe('Padaria Antiga');

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const original = Storage.prototype.setItem;
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key === KEY) {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return original.call(this, key, value);
      });

      // A RT preenche CNPJ, RT/CRN e a validade do alvará — exatamente o
      // caso concreto do achado (Fatia 2b) — e toca "Salvar".
      const salvou = saveCompanyProfile(TENANT, {
        razaoSocial: 'Padaria Nova', cnpj: '11.111.111/0001-11', alvaraValidade: '2026-12-31',
      });
      expect(salvou).toBe(false); // não finge sucesso

      spy.mockRestore();
      const depois = readCompanyProfile(TENANT);
      // A PROVA da perda real: o dado antigo não mudou, o novo NUNCA existiu.
      // É exatamente o que a pessoa NÃO teria como saber se a tela confirmasse
      // "✓ Dados salvos" de qualquer jeito — só descobriria ao recarregar e
      // ver os campos vazios de volta.
      expect(depois.razaoSocial).toBe('Padaria Antiga');
      expect(depois.cnpj).toBe('00.000.000/0001-00');
      expect(depois.alvaraValidade).toBeUndefined();
      errSpy.mockRestore();
    });

    it('a mesma falha liga o banner global "armazenamento cheio" — bônus de reaproveitar o `lw`', () => {
      expect(getStorageFull()).toBeNull();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const original = Storage.prototype.setItem;
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key === KEY) {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return original.call(this, key, value);
      });

      saveCompanyProfile(TENANT, { razaoSocial: 'Padaria Nova' });
      spy.mockRestore();

      const full = getStorageFull();
      expect(full).not.toBeNull();
      expect(full.chave).toBe(KEY);
      errSpy.mockRestore();
    });

    it('sem falha nenhuma, saveCompanyProfile devolve true e o dado persiste normalmente', () => {
      const salvou = saveCompanyProfile(TENANT, { razaoSocial: 'Padaria Comum' });
      expect(salvou).toBe(true);
      expect(readCompanyProfile(TENANT).razaoSocial).toBe('Padaria Comum');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 1 — botão .secondary-action/.ghost-action desabilitado idêntico ao
// habilitado (styles.css)
// ═══════════════════════════════════════════════════════════════════════════
describe('Achado 1 — botão desabilitado agora PARECE desabilitado (styles.css)', () => {
  it('existe uma regra :disabled comum aos três tipos de botão — antes só .primary-action tinha', () => {
    expect(css).toContain('.primary-action:disabled, .secondary-action:disabled, .ghost-action:disabled {');
  });

  it('a regra desabilitada reduz opacidade e troca o cursor pra not-allowed', () => {
    const ini = css.indexOf('.primary-action:disabled, .secondary-action:disabled, .ghost-action:disabled {');
    const fim = css.indexOf('}', ini);
    expect(ini).toBeGreaterThan(-1);
    const bloco = css.slice(ini, fim);
    expect(bloco).toContain('opacity: .4;');
    expect(bloco).toContain('cursor: not-allowed;');
  });

  it('hover de .secondary-action/.ghost-action agora tem guarda :not(:disabled) — antes reagia mesmo desabilitado', () => {
    expect(css).toContain('.secondary-action:hover:not(:disabled) { background: var(--surface-muted); border-color: var(--blue-border); }');
    expect(css).toContain('.ghost-action:hover:not(:disabled) { background: var(--surface-muted); color: var(--text); border-color: var(--border); }');
    expect(css).toContain('.ghost-action.danger:hover:not(:disabled) { background: var(--red-light); border-color: transparent; }');
    // as formas antigas, sem guarda, não existem mais como seletor
    expect(css).not.toContain('.secondary-action:hover {');
    expect(css).not.toContain('.ghost-action:hover {');
    expect(css).not.toContain('.ghost-action.danger:hover {');
  });

  it('dark mode: mesma guarda nos hovers de secondary/ghost, senão o defeito volta no tema escuro', () => {
    expect(css).toContain('[data-theme="dark"] .secondary-action:hover:not(:disabled) {');
    expect(css).toContain('[data-theme="dark"] .ghost-action:hover:not(:disabled) {');
    expect(css).not.toContain('[data-theme="dark"] .secondary-action:hover {');
    expect(css).not.toContain('[data-theme="dark"] .ghost-action:hover {');
  });

  // Mecanismo: prova que ANTES da correção, um .secondary-action com
  // `disabled` batia na regra de hover mesmo assim (nenhuma regra reservava
  // :disabled pra ele) — é a mesma lógica de cascata CSS que um navegador
  // real aplicaria, só que reproduzida aqui sem precisar de browser.
  describe('mecanismo — cascata CSS reproduzida (mesma especificidade que um browser real aplicaria)', () => {
    // Reimplementação mínima: dado um conjunto de regras (seletor -> props) e
    // um elemento (classes + disabled?), decide se o hover "pega". Especifi-
    // cidade de classe é igual pra .foo:hover e .foo:hover:not(:disabled) —
    // MAS o segundo só casa quando o elemento NÃO está disabled.
    const hoverAplica = (temRegraGuardada, disabled) => {
      if (!disabled) return true;               // sempre aplica quando habilitado
      return temRegraGuardada ? false : true;    // só NÃO aplica se a regra tiver o :not(:disabled)
    };

    it('forma ANTIGA (.secondary-action:hover, sem guarda): hover aplica mesmo com disabled=true — o bug, comprovado', () => {
      expect(hoverAplica(/* temRegraGuardada */ false, /* disabled */ true)).toBe(true);
    });

    it('forma NOVA (.secondary-action:hover:not(:disabled)): hover NÃO aplica com disabled=true — o fix, comprovado', () => {
      expect(hoverAplica(/* temRegraGuardada */ true, /* disabled */ true)).toBe(false);
    });

    it('nos dois casos, um botão HABILITADO continua reagindo ao hover normalmente — nada regride', () => {
      expect(hoverAplica(false, false)).toBe(true);
      expect(hoverAplica(true, false)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 2 — "Exportar backup completo" sem confirmação e "⏳ Exportando…"
// morto
// ═══════════════════════════════════════════════════════════════════════════
describe('Achado 2 — "Exportar backup completo": agora confirma e o estado de carregamento é real', () => {
  it('fonte: o trabalho pesado roda dentro de setTimeout(0) — não mais direto no clique', () => {
    const ini = fonte.indexOf('const handleExportBackup = () => {');
    const fim = fonte.indexOf('const handleImportBackup = (e) => {', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('setTimeout(() => {');
    expect(corpo).toContain('}, 0);');
    const posSetExporting = corpo.indexOf('setExporting(true);');
    const posSetTimeout = corpo.indexOf('setTimeout(() => {');
    expect(posSetTimeout).toBeGreaterThan(posSetExporting); // cede o tick DEPOIS de já ter marcado "exportando"
  });

  it('fonte: agora tem catch de verdade (antes era só try/finally, sem tratar erro nenhum)', () => {
    const ini = fonte.indexOf('const handleExportBackup = () => {');
    const fim = fonte.indexOf('const handleImportBackup = (e) => {', ini);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toMatch(/\}\s*catch \(e\) \{\s*setExportMsg\(\{ tone:'danger'/);
  });

  it('fonte: fecha SEMPRE com uma mensagem real na tela — sucesso ou falha, nunca mudo', () => {
    expect(fonte).toContain("const [exportMsg, setExportMsg] = useState(null);");
    expect(fonte).toContain("setExportMsg({ tone:'ok', text:");
    expect(fonte).toContain("setExportMsg({ tone:'danger', text:");
    expect(fonte).toContain('{exportMsg && <div className={`submission ${exportMsg.tone}`}>{exportMsg.text}</div>}');
  });

  // Mecanismo — a mesma forma assíncrona do componente, isolada (mesmo estilo
  // usado em settings-altos-triagem.test.js pra "Limpar duplicatas"): prova
  // que a forma ANTIGA (100% síncrona) nunca produz um commit intermediário
  // com "exporting:true", e a forma NOVA (setTimeout 0) produz.
  describe('mecanismo — forma síncrona (bug) vs. setTimeout(0) (fix), isolada', () => {
    const renderizador = () => {
      const renders = [];
      let estado = { exporting: false, msg: null };
      return {
        renders,
        commit: () => renders.push({ ...estado }),
        setExporting: (v) => { estado = { ...estado, exporting: v }; },
        setMsg: (m) => { estado = { ...estado, msg: m }; },
      };
    };

    it('forma ANTIGA: setExporting(true) e setExporting(false) síncronos — só existe UM commit possível, e "Exportando…" nunca aparece nele', () => {
      const { renders, commit, setExporting } = renderizador();
      setExporting(true);
      // trabalho síncrono (JSON.stringify, Blob, a.click()...) — nada cede o
      // event loop aqui, então não há como o React pintar entre os dois sets
      setExporting(false);
      commit(); // o único commit que um render real poderia produzir
      expect(renders).toHaveLength(1);
      expect(renders[0].exporting).toBe(false); // "Exportando…" nunca foi visível
      expect(renders[0].msg).toBeNull();          // e nenhuma confirmação nunca existiu
    });

    it('forma NOVA: existe um commit real com exporting:true ANTES do resultado — "Exportando…" tem onde renderizar, e fecha com msg', async () => {
      const { renders, commit, setExporting, setMsg } = renderizador();
      setExporting(true);
      commit();                                    // 1º commit: React PODE pintar "⏳ Exportando…" aqui
      await new Promise((resolve) => setTimeout(() => {
        setMsg({ tone: 'ok', text: '✓ Backup exportado' });
        setExporting(false);
        commit();                                   // 2º commit: resultado real
        resolve();
      }, 0));
      expect(renders).toHaveLength(2);
      expect(renders[0]).toEqual({ exporting: true, msg: null });
      expect(renders[1]).toEqual({ exporting: false, msg: { tone: 'ok', text: '✓ Backup exportado' } });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 3 — "Restaurar backup": FileReader sem onerror
// ═══════════════════════════════════════════════════════════════════════════
describe('Achado 3 — "Restaurar backup": FileReader agora trata falha de LEITURA (onerror)', () => {
  it('fonte: onerror é atribuído entre a criação do reader e onload, antes de readAsText', () => {
    const ini = fonte.indexOf('const handleImportBackup = (e) => {');
    const fim = fonte.indexOf('const handleMigrate = async', ini);
    expect(ini).toBeGreaterThan(-1);
    const handler = fonte.slice(ini, fim);
    const posReaderNew = handler.indexOf('new FileReader()');
    const posOnError = handler.indexOf('reader.onerror');
    const posOnLoad = handler.indexOf('reader.onload');
    const posReadAsText = handler.indexOf('reader.readAsText(file)');
    expect(posReaderNew).toBeGreaterThan(-1);
    expect(posOnError).toBeGreaterThan(posReaderNew);
    expect(posOnLoad).toBeGreaterThan(posOnError);
    expect(posReadAsText).toBeGreaterThan(posOnLoad);
  });

  it('fonte: onerror avisa a pessoa (alert) — não fica mudo', () => {
    const ini = fonte.indexOf('reader.onerror = () => {');
    const fim = fonte.indexOf('reader.onload = (ev)', ini);
    expect(ini).toBeGreaterThan(-1);
    const trecho = fonte.slice(ini, fim);
    expect(trecho).toContain('alert(');
  });

  // Mecanismo: reconstrução mínima da diferença real entre "antes" (só
  // onload atribuído) e "depois" (onerror também atribuído), disparando
  // exatamente o evento que o browser dispara pra NotReadableError — onerror,
  // NUNCA onload.
  describe('mecanismo — reconstrução da falha de leitura (NotReadableError dispara onerror, não onload)', () => {
    it('forma ANTIGA (sem onerror): a falha não aciona NADA — nem onload, nem alert — o bug, comprovado', () => {
      const avisos = [];
      const reader = {};
      reader.onload = () => { avisos.push('onload rodou'); }; // nunca chamado nesta simulação
      // reader.onerror nunca foi atribuído — é o estado de ANTES da correção.
      reader.onerror?.({ target: { error: new Error('NotReadableError') } });
      expect(avisos).toEqual([]);
    });

    it('forma NOVA (com onerror): a mesma falha aciona o alert — o fix, comprovado', () => {
      const avisos = [];
      const reader = {};
      reader.onload = () => { avisos.push('onload rodou'); };
      reader.onerror = () => { avisos.push('Não consegui ler o arquivo de backup...'); };
      reader.onerror?.({ target: { error: new Error('NotReadableError') } });
      expect(avisos).toEqual(['Não consegui ler o arquivo de backup...']);
      expect(avisos).not.toContain('onload rodou'); // onerror e onload são mutuamente exclusivos no browser real
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Achado 4 — contador de órfãos promete Central de Não-conformidades, mas
// mede reconexão, não NC descrita
// ═══════════════════════════════════════════════════════════════════════════
describe('Achado 4 — "Planilhas BPF duplicadas": a promessa da Central agora bate com o que ela mostra de verdade', () => {
  it('fonte: montarPlano importa extractNonConformities e calcula ncRecuperadas com o MESMO motor da Central', () => {
    const ini = fonte.indexOf('const montarPlano = useCallback(async () => {');
    const fim = fonte.indexOf('}, [tenantId, tenantNome]);', ini);
    expect(ini).toBeGreaterThan(-1);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('extractNonConformities');
    expect(corpo).toContain('const ncRecuperadas = plano.orfaosRecuperados.filter((o) => {');
    expect(corpo).toContain('resumo: { ...plano.resumo, ncRecuperadas }');
  });

  it('fonte: a mensagem de sucesso só promete Central de Não-conformidades quando ncRecuperadas > 0', () => {
    const ini = fonte.indexOf('{r.orfaosRecuperados > 0 && (');
    const fim = fonte.indexOf('{r.orfaosSemDestino > 0 && (', ini);
    expect(ini).toBeGreaterThan(-1);
    const trecho = fonte.slice(ini, fim);
    expect(trecho).toContain('r.ncRecuperadas > 0');
    expect(trecho).toContain('Central de Não-conformidades');
    expect(trecho).toContain('Nenhum tem não-conformidade descrita');
  });

  it('fonte: o confirm() também condiciona a promessa da Central a ncRecuperadas, não só a orfaosRecuperados', () => {
    const ini = fonte.indexOf('const ok = window.confirm(');
    const fim = fonte.indexOf('if (!ok) return;', ini);
    expect(ini).toBeGreaterThan(-1);
    const trecho = fonte.slice(ini, fim);
    expect(trecho).toContain('r.ncRecuperadas > 0');
  });

  // ─── Mecanismo real (não simulado) ────────────────────────────────────────
  // As MESMAS funções puras que LimpezaPlanilhasCard usa de verdade:
  // planejarDedupe (forms-dedupe.js) + extractNonConformities (forms.jsx, o
  // motor que a própria Central de Não-Conformidades usa pra decidir o que
  // listar). Reproduz o cálculo exatamente como montarPlano faz.
  describe('mecanismo real: planejarDedupe + extractNonConformities — a mesma dupla que a Central usa', () => {
    const templateComNc = {
      id: 'tpl-viva', category: 'limpeza', title: 'Higienização de Bancada',
      updatedAt: '2026-08-01T00:00:00.000Z',
      sections: [{ id: 'sec1-nc', fields: [{ id: 'sec1-ncdesc' }, { id: 'sec1-ncacao' }, { id: 'sec1-ncresp' }] }],
    };
    const orfao = (id, periodKey, responses) => ({
      id, formId: 'copia-que-sumiu', formTitle: 'Higienização de Bancada', category: 'limpeza',
      periodKey, status: 'submitted', updatedAt: '2026-08-10T00:00:00.000Z', responses,
    });
    const calcularNcRecuperadas = (templates, records, plano) => {
      const templatesPorId = new Map(templates.map((t) => [t.id, t]));
      const recordsPorId   = new Map(records.map((r) => [r.id, r]));
      return plano.orfaosRecuperados.filter((o) => {
        const tpl = templatesPorId.get(o.para);
        const rec = recordsPorId.get(o.recordId);
        return tpl && rec && extractNonConformities(tpl, rec).length > 0;
      }).length;
    };

    it('caso misto (o caso da Swiss): 2 órfãos reconectam, só 1 tem NC descrita — orfaosRecuperados superestima a Central', () => {
      const templates = [templateComNc];
      const records = [
        orfao('rec-com-nc', '2026-08-10', { 'sec1-ncdesc': 'Bancada com resíduo de gordura visível' }),
        orfao('rec-sem-nc', '2026-08-11', { 'sec1-ncdesc': '' }), // preencheu a planilha, não relatou NC nenhuma
      ];
      const plano = planejarDedupe(templates, records);
      expect(plano.resumo.orfaosRecuperados).toBe(2); // os DOIS reconectam a uma planilha viva

      const ncRecuperadas = calcularNcRecuperadas(templates, records, plano);
      expect(ncRecuperadas).toBe(1); // só 1 vai aparecer na Central de verdade
      // a prova do achado: o número que a mensagem ANTIGA usava
      // (orfaosRecuperados) não bate com o que a Central realmente mostra
      expect(ncRecuperadas).toBeLessThan(plano.resumo.orfaosRecuperados);
    });

    it('nenhum órfão tem NC descrita — ncRecuperadas fica 0 mesmo com orfaosRecuperados > 0 (o caso medido na Swiss: 35 recuperados, quase nenhum na Central)', () => {
      const templates = [templateComNc];
      const records = [
        orfao('r1', '2026-08-10', { 'sec1-ncdesc': '' }),
        orfao('r2', '2026-08-11', {}), // nem preencheu o campo
      ];
      const plano = planejarDedupe(templates, records);
      expect(plano.resumo.orfaosRecuperados).toBe(2);

      const ncRecuperadas = calcularNcRecuperadas(templates, records, plano);
      expect(ncRecuperadas).toBe(0); // a mensagem antiga prometeria "2 voltam à Central" — nenhum volta
    });

    it('todos os órfãos têm NC descrita — ncRecuperadas bate com orfaosRecuperados, mensagem antiga não estava errada nesse caso', () => {
      const templates = [templateComNc];
      const records = [
        orfao('r1', '2026-08-10', { 'sec1-ncdesc': 'Vazamento na tubulação' }),
        orfao('r2', '2026-08-11', { 'sec1-ncdesc': 'Piso com infiltração' }),
      ];
      const plano = planejarDedupe(templates, records);
      const ncRecuperadas = calcularNcRecuperadas(templates, records, plano);
      expect(ncRecuperadas).toBe(plano.resumo.orfaosRecuperados);
      expect(ncRecuperadas).toBe(2);
    });
  });
});
