import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormKioskApp } from './kiosk';
import { pushFormRecord, lw as gravarLocal } from './repository';
import { ImportTemplateModal } from './import-template-modal';
import { isFieldDue, dueFields } from './field-frequency';
import { gravarMesclando, SYNC_EVENT } from './lista-local';
import { prefsFromProfile, profileWithPrefs, catLabelFor, podeMoverPara, podeEditarTitulo, applyCategoryPrefs, enxugarPrefs, CATEGORIA_COM_COMPORTAMENTO, FREQUENCIAS } from './form-prefs';
import { readCompanyProfile, saveCompanyProfile } from './settings';

// Read company profile from localStorage
function getProfile(tenantId) {
  try { const r = localStorage.getItem(`nutriops.company.profile.${tenantId}`); return r ? JSON.parse(r) : {}; } catch { return {}; }
}

// ─── Storage ───────────────────────────────────────────────────────────────

const tplKey = (id) => `nutriops.forms.templates.${id}`;
const recKey = (id) => `nutriops.forms.records.${id}`;

const fl = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };
// Grava pelo `lw` do repositório em vez de engolir a falha: quando o
// localStorage enche, o setItem estoura e o app inteiro segue confirmando
// sucesso. O `lw` loga e levanta a bandeira que o banner de "armazenamento
// cheio" lê (v1.9.158) — este arquivo tinha a própria cópia muda do helper,
// e a bandeira nunca chegava aqui. Achado da auditoria (18/08).
const fs = (k, v) => gravarLocal(k, v);

// Planilhas da loja = cache local + as do seed que ainda não chegaram nele.
// Antes era `if (cache) return cache`, com dois furos que só apareciam depois:
//   1. `[]` é TRUTHY. O syncModule grava [] quando a nuvem ainda não tem
//      nenhuma planilha (loja nova, ou pull que veio vazio), e a partir daí o
//      seed nunca mais rodava — a loja ficava com ZERO planilhas pra sempre.
//   2. Planilha NOVA no seed nunca alcançava quem já tinha cache. As 21 de
//      higienização da CASA DOCE (Fase D) chegaram depois das 11 primeiras:
//      sem o merge, a loja continuaria vendo só as 11.
// Merge por id (os ids do seed DEVERIAM ser fixos — é essa a razão da
// convenção) e só ACRESCENTA: edição local de uma planilha existente é
// preservada. Não há exclusão de planilha na UI, então não há risco de
// ressuscitar algo apagado de propósito — se um dia houver, isto precisa de
// tombstone.
//
// ⚠️ SEGUNDA CHAVE, por categoria+título (v1.9.133, 15/08). Os seeds de
// Swiss/Bäckerei/DBK usam `id: uid()` e portanto sorteiam um UUID NOVO a cada
// execução — o merge por id nunca reconhecia o que já estava no cache e
// anexava as planilhas de novo. Medido: 4 → 8 → 12 em três leituras, e são 11
// call sites (Planilhas, Dossiê, Relatórios, Painel RT, Prontidão…), então
// cada tela aberta multiplicava. A CASA DOCE escapou porque os ids dela são
// fixos. Bug vivo desde a v1.9.93 (f3d1aa9), quando este merge nasceu.
//
// A chave secundária estanca sem tocar em dado: o seed sorteado casa com a
// cópia que já existe e nada é acrescentado. As duplicatas JÁ criadas
// continuam lá de propósito — limpar exige decidir o que fazer com os
// registros presos em cada cópia (cada um aponta pro formId em que foi
// preenchido), e isso é conversa à parte.
const chaveTitulo = (t) => `${t?.category ?? ''}::${String(t?.title ?? '').trim().toLowerCase()}`;

export const readFormTemplates = (tenant) => {
  const cache = fl(tplKey(tenant.id), null);
  const seed  = seedTemplates(tenant);
  if (!Array.isArray(cache)) { fs(tplKey(tenant.id), seed); return seed; }

  const porId = new Map(cache.map((t) => [t.id, t]));
  // 1ª ocorrência vence: é a cópia mais antiga, aquela pra onde os registros
  // históricos apontam.
  const porTitulo = new Map();
  for (const t of cache) if (!porTitulo.has(chaveTitulo(t))) porTitulo.set(chaveTitulo(t), t);

  let mudou = false;
  for (const s of seed) {
    const atual = porId.get(s.id) ?? porTitulo.get(chaveTitulo(s));
    if (!atual) { porId.set(s.id, s); porTitulo.set(chaveTitulo(s), s); mudou = true; continue; }
    // Planilha do seed que MUDOU DE VERSÃO (campo novo, rótulo corrigido):
    // substitui a definição. Sem isto, só planilha NOVA chegava — quem já
    // rodava ficava preso na versão antiga pra sempre. Foi o que aconteceria
    // com os ajustes que a nutricionista pediu em 07/08 (data, responsável,
    // setor): nada apareceria pra ela.
    //
    // O carimbo updatedAt é essencial: o sync funde local↔nuvem por mergeByKey,
    // que escolhe o mais RECENTE. Sem ele o seed vale epoch e qualquer linha
    // velha da nuvem desfaria a atualização no boot seguinte.
    // `custom` = a RT editou as tarefas. Não sobrescreve: o ajuste dela vale
    // mais que o meu seed, e sobrescrever apagaria equipamento que ela mesma
    // cadastrou na planilha.
    if (atual.custom) continue;
    if ((s.v ?? 0) > (atual.v ?? 0)) {
      // Mantém o ID DE QUEM JÁ ESTAVA, não o do seed: quando o casamento veio
      // pelo título (seeds de id sorteado), gravar em `s.id` criaria uma
      // entrada nova em vez de atualizar — a duplicação outra vez, agora por
      // outro caminho. E os registros já preenchidos apontam pro id antigo:
      // trocá-lo órfãos todo o histórico daquela planilha.
      porId.set(atual.id, { ...s, id: atual.id, updatedAt: new Date().toISOString() });
      mudou = true;
    }
  }
  if (!mudou) return cache;
  const merged = [...porId.values()];
  fs(tplKey(tenant.id), merged);
  return merged;
};
export const writeFormTemplates = (id, v)  => fs(tplKey(id), v);
export const readFormRecords    = (id)     => fl(recKey(id), []);
export const writeFormRecords   = (id, v)  => fs(recKey(id), v);

// ─── Period helpers ────────────────────────────────────────────────────────

export function getPeriodKey(frequency, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (frequency === 'daily')    return `${y}-${m}-${d}`;
  if (frequency === 'weekly')   { const j = new Date(y,0,1); const w = Math.ceil(((date-j)/86400000+j.getDay()+1)/7); return `${y}-W${String(w).padStart(2,'0')}`; }
  if (frequency === 'biweekly') return `${y}-${m}-${date.getDate()<=15?'A':'B'}`;
  if (frequency === 'monthly')  return `${y}-${m}`;
  // Semestral (v1.9.134): a RDC 216 §4.4 exige higienização do reservatório em
  // intervalo máximo de 6 MESES, e não havia frequência de planilha que
  // representasse isso — mensal cobraria 6× a mais e mancharia a tela de
  // Prontidão de pendência falsa.
  if (frequency === 'semiannual') return `${y}-S${date.getMonth() < 6 ? 1 : 2}`;
  return `${y}-${m}-${d}`;
}

// Item 15 da revisão: "Semana 2026 W33" não diz nada pro colaborador sem
// decifrar o número da semana. Reconstrói o intervalo de datas real da
// semana chamando getPeriodKey de novo (não reimplementa a conta) — evita
// duas fórmulas de semana divergindo se o algoritmo mudar um dia.
function weekRangeFromKey(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  let start = null, end = null;
  for (let i = 0; i < 380; i++) {
    const cur = new Date(year, 0, 1 + i);
    if (getPeriodKey('weekly', cur) === key) {
      if (!start) start = cur;
      end = cur;
    } else if (start) {
      break;
    }
  }
  return start ? { start, end } : null;
}

// ─── Escopo por setor dentro do mesmo período ──────────────────────────────
// Pergunta da nutricionista (18/08): "na Higienização de Hortifrutícolas só
// consigo preencher 1 setor por dia?". Sim — e pior: a segunda equipe
// SOBRESCREVIA a primeira. O registro é chaveado por (formId, periodKey) e o
// periodKey era só a data; o "Setor" é conteúdo do formulário, não entra na
// chave. Confeitaria e Café no mesmo dia disputavam a mesma linha, e o save
// troca `responses` e `user` inteiros — o registro anterior sumia sem aviso.
//
// A planilha de Higienização (por ÁREA) nunca teve esse problema porque usa um
// template por setor (ver templateSector). As de EQUIPE usam um template só com
// campo "Setor", e é aí que a chave precisa do setor junto.
//
// Formato: "2026-08-18::Confeitaria". Registro antigo (chave sem "::") continua
// válido e legível — nada do que já existe é reescrito.
const SEP_ESCOPO = '::';

// Campo que divide a planilha em vias independentes. Explícito no template
// (`scopeBy`) em vez de adivinhado pelo label: adivinhar erraria numa planilha
// futura que tenha um select "Setor" só informativo.
export function scopeFieldOf(template) {
  if (!template?.scopeBy) return null;
  for (const sec of template.sections ?? []) {
    for (const f of sec.fields ?? []) if (f.id === template.scopeBy) return f;
  }
  return null;
}

export function makePeriodKey(frequency, date, scopeValue) {
  const base = getPeriodKey(frequency, date);
  const v = String(scopeValue ?? '').trim();
  return v ? `${base}${SEP_ESCOPO}${v}` : base;
}

export function splitPeriodKey(key) {
  const i = String(key ?? '').indexOf(SEP_ESCOPO);
  return i < 0
    ? { base: String(key ?? ''), scope: null }
    : { base: key.slice(0, i), scope: key.slice(i + SEP_ESCOPO.length) };
}

export function formatPeriodLabel(frequency, key) {
  // Chave com escopo: formata só a parte da data e devolve o setor junto,
  // senão `new Date('2026-08-18::Confeitaria')` vira "Invalid Date" e a tela
  // mostra a chave crua pro colaborador.
  const { base, scope } = splitPeriodKey(key);
  if (scope) return `${formatPeriodLabel(frequency, base)} · ${scope}`;
  key = base;
  try {
    if (frequency === 'daily')    return new Date(key+'T12:00').toLocaleDateString('pt-BR',{weekday:'short',day:'numeric',month:'short'});
    if (frequency === 'weekly') {
      const range = weekRangeFromKey(key);
      if (!range) return `Semana ${key.replace('-',' ')}`;
      const { start, end } = range;
      const sameMonth = start.getMonth() === end.getMonth();
      if (sameMonth) return `${start.getDate()}–${end.getDate()} de ${end.toLocaleDateString('pt-BR',{month:'long'})}`;
      const shortMonth = (d) => d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','');
      return `${start.getDate()} ${shortMonth(start)} – ${end.getDate()} ${shortMonth(end)}`;
    }
    if (frequency === 'biweekly') { const [y,mo,h]=key.split('-'); const mn=new Date(`${y}-${mo}-01T12:00`).toLocaleDateString('pt-BR',{month:'long'}); return `${h==='A'?'1ª quinzena':'2ª quinzena'} de ${mn}`; }
    if (frequency === 'monthly')  return new Date(key+'-01T12:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    if (frequency === 'semiannual') { const [y,s]=key.split('-S'); return `${s==='1'?'1º':'2º'} semestre de ${y}`; }
  } catch { /**/ }
  return key;
}

export function freqLabel(f) { return {daily:'Diária',weekly:'Semanal',biweekly:'Quinzenal',monthly:'Mensal',semiannual:'Semestral'}[f]??f; }

// Histórico do card. Nas 3 planilhas com escopo por setor (Higiene Pessoal,
// Hortifrutícolas, Vetores e Pragas — CD_SETORES_EQUIPE, até 12 setores) um
// corte fixo de REGISTROS tinha viés: o desempate de mesma data é o próprio
// nome do setor (sufixo da chave, "2026-08-18::Confeitaria"), e slice(0,8)
// descartava sempre os setores alfabeticamente PRIMEIROS — todo dia, pra
// sempre, mesmo tendo preenchido (achado da auditoria, 18/08). O corte de 8
// nasceu quando havia 1 registro por dia (=8 dias de histórico); hoje pode
// haver até N por dia (N = opções do campo de escopo). Multiplicar o limite
// por N preserva "N dias de histórico" como intenção original — um dia nunca
// tem mais que N registros, então o corte nunca cai NO MEIO de um dia.
export function templateHistory(records, tpl, campoEscopo, limit = 8) {
  const porPeriodo = campoEscopo?.options?.length || 1;
  return records
    .filter((r) => r.formId === tpl.id)
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
    .slice(0, limit * porPeriodo);
}

// Progresso agregado de uma planilha com escopo por setor, pra quando NENHUM
// setor foi escolhido ainda no card. Sem isto, badge/barra liam sempre a
// chave-base (pkBase) — que nenhum registro passa a usar depois do fix de
// v1.9.133, porque os botões de ação ficam disabled até escolher um setor —
// e o card mostrava "Pendente"/0% pra sempre, mesmo com todos os setores
// concluídos no dia (achado da auditoria, 18/08).
export function scopedSectorProgress(tpl, records, today, campoEscopo) {
  const options = campoEscopo?.options ?? [];
  if (options.length === 0) return { total: 0, done: 0, validated: 0, pct: 0 };
  let done = 0, validated = 0;
  for (const o of options) {
    const pk = makePeriodKey(tpl.frequency, today, o);
    const rec = records.find((r) => r.formId === tpl.id && r.periodKey === pk);
    if (rec?.status === 'submitted') {
      done++;
      if (rec.validation) validated++;
    }
  }
  return { total: options.length, done, validated, pct: Math.round((done / options.length) * 100) };
}

// "Minha lista de hoje" (item 4 da revisão de produto) — o app cobra o
// colaborador por temperatura mas nunca por planilha; essa informação só
// existia dentro do relatório BPF, pra RT. Mesmo cálculo de período que
// FormsView já usa por card, só que devolvendo direto a lista do que falta —
// sem RT, sem UI, testável sozinho.
export function pendingFormsForPeriod(templates, records, now = new Date()) {
  return (templates ?? [])
    .map((tpl) => {
      const periodKey = getPeriodKey(tpl.frequency, now);
      // Planilha com escopo por setor: conta como feita se QUALQUER setor
      // registrou no período. Exigir todos os setores marcaria pendência
      // eterna — nem toda equipe higieniza hortifruti todo dia.
      const rec = (records ?? []).find((r) =>
        r.formId === tpl.id &&
        (r.periodKey === periodKey || splitPeriodKey(r.periodKey).base === periodKey));
      return {
        id: tpl.id, title: tpl.title, category: tpl.category, periodKey,
        periodLabel: formatPeriodLabel(tpl.frequency, periodKey),
        status: rec?.status ?? 'missing',
      };
    })
    .filter((f) => f.status !== 'submitted');
}

function uid() { return crypto.randomUUID(); }
// frequency (opcional, item 13): sobrepõe a frequência da planilha só pra
// essa tarefa — ex.: 'quarterly' pra "Paredes (trimestral)" numa planilha
// weekly. Sem isso, a tarefa segue a frequência da planilha, como sempre.
const f = (label, type='cnc', hint=null, frequency=null) => ({ id:uid(), label, type, hint, frequency });

// ─── Foto de evidência ─────────────────────────────────────────────────────
// Reduz no APARELHO antes de enviar: foto de celular vem com 3-4 MB e 4000px,
// resolução que não acrescenta nada pra provar uma unha comprida ou um uniforme
// sujo. 1280px/JPEG 0.72 dá ~120 KB — sobe rápido no 4G da loja e não estoura a
// franquia de armazenamento. O original nunca sai do aparelho.
export async function reduzirFoto(file, maxLado = 1280, qualidade = 0.72) {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * escala), h = Math.round(bitmap.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Não consegui processar a imagem.');
  return blob;
}

// value = { path, at } — só o CAMINHO no Storage; o arquivo não entra no
// registro (ver o comentário do bucket em repository.js).
function PhotoField({ value, onChange, tenantId, formId, periodKey, fieldId }) {
  const [erro, setErro]   = useState('');
  const [subindo, setSub] = useState(false);
  const [url, setUrl]     = useState(null);
  // Distingue "ainda buscando o link assinado" de "busquei e não consegui" —
  // sem isto as duas telas eram IDÊNTICAS ("abrindo…" pra sempre): offline,
  // sessão sem permissão pra essa loja e falha ao assinar o link devolvem
  // `null` por caminhos diferentes em signedPhotoUrl, e o quadrado tracejado
  // nunca saía do estado de carregando — a leitura natural virava "a foto
  // quebrou", e o único botão ao lado ("Remover") descarta de vez o caminho
  // da evidência no registro. Achado da auditoria (19/08).
  const [carregandoUrl, setCarregandoUrl] = useState(Boolean(value?.path));

  useEffect(() => {
    let cancelado = false;
    if (!value?.path) { setUrl(null); setCarregandoUrl(false); return; }
    setCarregandoUrl(true);
    // Bucket privado → cada exibição pede um link temporário.
    import('./repository').then(m => m.signedPhotoUrl(tenantId, value.path))
      .then(u => { if (!cancelado) setUrl(u); })
      .catch(() => { if (!cancelado) setUrl(null); })
      .finally(() => { if (!cancelado) setCarregandoUrl(false); });
    return () => { cancelado = true; };
  }, [value?.path, tenantId]);

  const escolher = async (file) => {
    if (!file) return;
    setErro(''); setSub(true);
    try {
      const m = await import('./repository');
      const blob = await reduzirFoto(file);
      const path = await m.uploadFormPhoto(tenantId, blob, { formId, periodKey, fieldId });
      onChange({ path, at: new Date().toISOString() });
    } catch (e) {
      setErro(e.message ?? 'Não consegui anexar a foto.');
    }
    setSub(false);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'flex-start' }}>
      {value?.path ? (
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {url
            ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Evidência" style={{ width:88, height:88, objectFit:'cover', borderRadius:'var(--r)', border:'1px solid var(--border)' }} /></a>
            : carregandoUrl
              ? <div style={{ width:88, height:88, borderRadius:'var(--r)', border:'1px dashed var(--border)', display:'grid', placeItems:'center', fontSize:11, color:'var(--text-secondary)' }}>abrindo…</div>
              : <div title="Não consegui carregar a foto agora — pode ser falta de internet ou de permissão. Tente sair e voltar nesta planilha." style={{ width:88, height:88, borderRadius:'var(--r)', border:'1px dashed var(--red)', display:'grid', placeItems:'center', fontSize:11, color:'var(--red)', textAlign:'center', padding:4 }}>falha ao abrir</div>}
          <button className="ghost-action danger" style={{ fontSize:11 }} onClick={() => onChange(null)}>Remover</button>
        </div>
      ) : (
        // `capture` faz o celular abrir a câmera direto, sem passar pela galeria.
        <label className="secondary-action" style={{ fontSize:12, padding:'7px 12px', cursor: subindo ? 'wait' : 'pointer' }}>
          {subindo ? 'Enviando…' : '📷 Anexar foto'}
          <input type="file" accept="image/*" capture="environment" disabled={subindo}
            onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ''; }}
            style={{ display:'none' }} />
        </label>
      )}
      {erro && <span style={{ fontSize:11, color:'var(--red)', fontWeight:600 }}>{erro}</span>}
    </div>
  );
}

// ─── Autonomia da RT pra editar a própria planilha ──────────────────────────
// Duas coisas independentes que uma planilha pode precisar: (1) lista de
// tarefas/equipamentos (seção "-t", ex.: higienização por setor) e (2) opções
// de um campo tipo lista suspensa (ex.: "Qual banheiro"). Puras e testáveis
// sem React — o modal só monta a UI em cima delas.
export function hasEditableTaskSection(template) {
  return (template.sections ?? []).some((s) => s.id.endsWith('-t'));
}

export function extractSelectFields(template) {
  const result = [];
  (template.sections ?? []).forEach((sec, sIdx) => {
    (sec.fields ?? []).forEach((f, fIdx) => {
      if (f.type === 'select') result.push({ sIdx, fIdx, id: f.id, label: f.label, options: [...(f.options ?? [])] });
    });
  });
  return result;
}

export function isTemplateEditable(template) {
  return hasEditableTaskSection(template) || extractSelectFields(template).length > 0;
}

export function applySelectFieldEdits(sections, edits) {
  return edits.reduce((secs, edit) => secs.map((s, i) => i !== edit.sIdx ? s : {
    ...s, fields: s.fields.map((f, j) => j !== edit.fIdx ? f : { ...f, options: edit.options }),
  }), sections);
}

// ─── Editor de tarefas + opções de lista suspensa ───────────────────────────
// A RT cadastra equipamento novo (temperatura) mas não conseguia incluí-lo na
// planilha de higienização do setor — pedido dela em 07/08. Depois (10/08),
// pediu pra ajustar sozinha as opções de "Qual banheiro" sem precisar de mim
// pra trocar uma palavra — mesma ideia, alcance maior: qualquer campo `select`
// do template, não só a lista de tarefas.
//
// Planilha editada vira `custom:true` e para de receber atualização automática
// do seed (readFormTemplates pula), senão o próximo ajuste meu apagaria o que
// ela cadastrou. É a troca certa: quem edita assume o conteúdo.
export function TaskEditorModal({ template, onSave, onClose }) {
  const secId  = template.sections.find((s) => s.id.endsWith('-t'))?.id ?? null;
  const secIdx = secId ? template.sections.findIndex((s) => s.id === secId) : -1;
  const hasTaskSection = secIdx !== -1;
  const [tarefas, setTarefas] = useState(() => hasTaskSection ? template.sections[secIdx].fields : []);
  const [nome, setNome] = useState('');
  const [per,  setPer]  = useState('semanal');

  const [selectFields, setSelectFields] = useState(() => extractSelectFields(template));
  const [novaOpcao, setNovaOpcao] = useState({});

  // "Cancelar" descartava tarefas e opções digitadas sem aviso — e como o
  // "Salvar planilha" também fecha o modal, as duas ações terminavam na MESMA
  // tela. Não havia como saber se o que ela cadastrou foi gravado.
  // Achado da auditoria (18/08); mesma família do "← Voltar" do preenchimento
  // (v1.9.158) e do registro rápido sem confirmação (v1.9.146).
  const inicial = useRef({ tarefas, selectFields });
  const temAlteracao =
    JSON.stringify(tarefas) !== JSON.stringify(inicial.current.tarefas) ||
    JSON.stringify(selectFields) !== JSON.stringify(inicial.current.selectFields);
  const cancelar = () => {
    if (temAlteracao && !window.confirm('Sair sem salvar? As alterações nesta planilha serão perdidas.')) return;
    onClose();
  };

  const add = () => {
    const t = nome.trim();
    if (!t) return;
    // id único e estável: sufixo do timestamp evita colidir com os do seed
    // (cd-hig-padaria-0..13) quando ela adicionar e remover várias vezes.
    setTarefas((prev) => [...prev, { id:`${secId}-x${prev.length}-${Date.now().toString(36)}`, label:`${t} (${per})`, type:'date_sig' }]);
    setNome('');
  };
  const remover = (id) => setTarefas((prev) => prev.filter((f) => f.id !== id));

  const updateOption = (fieldId, idx, value) => setSelectFields((prev) => prev.map((sf) => sf.id !== fieldId ? sf : { ...sf, options: sf.options.map((o, i) => i === idx ? value : o) }));
  const removeOption = (fieldId, idx) => setSelectFields((prev) => prev.map((sf) => sf.id !== fieldId ? sf : { ...sf, options: sf.options.filter((_, i) => i !== idx) }));
  const addOption = (fieldId) => {
    const texto = (novaOpcao[fieldId] ?? '').trim();
    if (!texto) return;
    setSelectFields((prev) => prev.map((sf) => sf.id !== fieldId ? sf : { ...sf, options: [...sf.options, texto] }));
    setNovaOpcao((prev) => ({ ...prev, [fieldId]: '' }));
  };

  const semOpcoes = selectFields.some((sf) => sf.options.length === 0);

  const salvar = () => {
    if (semOpcoes) return;
    let sections = hasTaskSection
      ? template.sections.map((s, i) => i === secIdx ? { ...s, fields: tarefas } : s)
      : template.sections;
    sections = applySelectFieldEdits(sections, selectFields);
    onSave({ ...template, sections, custom:true, v:(template.v ?? 0) + 1, updatedAt:new Date().toISOString() });
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:24 }}>
      <div className="management-card" style={{ width:'100%', maxWidth:560, maxHeight:'85vh', display:'flex', flexDirection:'column' }}>
        <div className="card-head">
          <div><span className="eyebrow">Editar planilha</span><h2>{template.title}</h2></div>
          {hasTaskSection && <span className="badge neutral">{tarefas.length}</span>}
        </div>
        <div style={{ overflowY:'auto', flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
          {hasTaskSection && (
            <>
              <div className="capture-fields" style={{ borderBottom:'1px solid var(--border-subtle)', paddingBottom:14 }}>
                <label>Nova tarefa / equipamento
                  <input value={nome} onChange={(e) => setNome(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                    placeholder="Ex.: Refrigerador vertical R.20" />
                </label>
                <div className="grid-2">
                  <label>Período
                    <select value={per} onChange={(e) => setPer(e.target.value)}>
                      {['diária','semanal','quinzenal','mensal'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                  <div style={{ display:'flex', alignItems:'flex-end' }}>
                    <button className="primary-action" onClick={add} disabled={!nome.trim()} style={{ width:'100%' }}>Adicionar</button>
                  </div>
                </div>
              </div>
              <div className="equipment-maintenance-list">
                {tarefas.length === 0
                  ? <p className="muted" style={{ padding:'16px 20px' }}>Nenhuma tarefa. Adicione ao menos uma.</p>
                  : tarefas.filter((f) => f.type === 'date_sig').map((f) => (
                    <div key={f.id} className="equipment-maintenance-row">
                      <div><strong>{f.label}</strong></div>
                      <button className="ghost-action danger" style={{ fontSize:11 }} onClick={() => remover(f.id)}>Remover</button>
                    </div>
                  ))}
              </div>
            </>
          )}
          {selectFields.map((sf) => (
            <div key={sf.id} className="capture-fields" style={{ borderTop:'1px solid var(--border-subtle)', paddingTop:14 }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-secondary)' }}>Opções — {sf.label}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {sf.options.map((opt, idx) => (
                  <div key={idx} style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <input value={opt} onChange={(e) => updateOption(sf.id, idx, e.target.value)} style={{ flex:1 }} />
                    <button className="ghost-action danger" style={{ fontSize:11 }} onClick={() => removeOption(sf.id, idx)}>Remover</button>
                  </div>
                ))}
                {sf.options.length === 0 && <p className="muted" style={{ fontSize:11 }}>Nenhuma opção — adicione ao menos uma antes de salvar.</p>}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <input value={novaOpcao[sf.id] ?? ''} onChange={(e) => setNovaOpcao((prev) => ({ ...prev, [sf.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(sf.id); } }}
                  placeholder="Nova opção" style={{ flex:1 }} />
                <button className="secondary-action" onClick={() => addOption(sf.id)} disabled={!(novaOpcao[sf.id] ?? '').trim()}>Adicionar</button>
              </div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize:11, padding:'10px 0 0' }}>
          Ao salvar, esta planilha passa a ser sua: deixa de receber atualizações automáticas do NutriOPS.
        </p>
        <div className="actions-row">
          <button className="secondary-action" onClick={cancelar}>Cancelar</button>
          <button className="primary-action" onClick={salvar} disabled={semOpcoes}>Salvar planilha</button>
        </div>
      </div>
    </div>
  );
}

// ─── Category metadata ─────────────────────────────────────────────────────

const CAT = {
  higiene_pessoal: { label:'Higiene Pessoal',  color:'#00684a', bg:'rgba(29,78,137,.10)' },
  vetores_pragas:  { label:'Vetores e Pragas', color:'#9a3412', bg:'#fff7ed' },
  dedetizacao:     { label:'Dedetização',      color:'#6b21a8', bg:'#faf5ff' },
  faxina:          { label:'Faxina',           color:'#065f46', bg:'#ecfdf5' },
  higienizacao:    { label:'Higienização',     color:'#00684a', bg:'#ecfdf5' },
  potabilidade:    { label:'Potabilidade',     color:'#1e40af', bg:'#eff6ff' },
  manutencao:      { label:'Manutenção',       color:'#92400e', bg:'#fffbeb' },
  recebimento:     { label:'Recebimento',      color:'#374151', bg:'#f9fafb' },
  residuos:        { label:'Resíduos',          color:'#3f6212', bg:'#f7fee7' },
  custom:          { label:'Personalizado',    color:'#374151', bg:'#f9fafb' },
};
export function catMeta(cat) { return CAT[cat] ?? CAT.custom; }

// ─── Completion helpers ────────────────────────────────────────────────────

// Carimbo de 1 toque do date_sig — hoje + quem está registrando. O sistema já
// sabe as duas coisas (é o mesmo texto que `record.user`/`createdAt` já
// carimbam sozinhos); antes disso o colaborador digitava as duas de novo, à
// mão, uma vez por tarefa — 14 a 30 vezes numa planilha de higienização.
export function quickSign(currentName) {
  return { date: getPeriodKey('daily'), sig: (currentName ?? '').trim() };
}

export function completionPct(template, record, now = new Date()) {
  if (!record) return 0;
  let total=0, filled=0;
  for (const sec of template.sections) {
    for (const field of sec.fields) {
      // text e photo não entram no percentual: observação e evidência são
      // opcionais por natureza. Contar a foto deixaria a planilha eternamente
      // "incompleta" nos dias em que não houve nada pra fotografar.
      if (field.type==='text' || field.type==='photo') continue;
      // Tarefa com frequência própria mais espaçada (item 13) — "Paredes
      // (trimestral)" numa planilha semanal não conta contra o total nas
      // semanas em que não é devida, senão a planilha nunca bateria 100%.
      if (!isFieldDue(field, template.frequency, now)) continue;
      total++;
      const v = record.responses?.[field.id];
      if (field.type==='checkbox') { if (v===true) filled++; continue; } // só marcado conta
      if (v!==undefined && v!==null && v!=='') { if (typeof v==='object' ? (v.date||v.sig||v.detected!==undefined) : v!=='') filled++; }
    }
  }
  return total>0 ? Math.round((filled/total)*100) : 0;
}

// Uma NC escrita numa planilha ficava só ali dentro — a Central de
// Não-Conformidades precisa achá-las sem conhecer cada template na mão.
// Convenção usada em TODAS as seções de NC (Banheiros, Hortifrutícolas, as 21
// de Higienização): a seção termina em "-nc" e tem 3 campos de texto com
// sufixo -ncdesc/-ncacao/-ncresp. Genérico de propósito — funciona pra
// qualquer template futuro que siga a mesma convenção, sem precisar listar ids.
export function extractNonConformities(template, record) {
  if (!record?.responses) return [];
  const out = [];
  for (const sec of template.sections ?? []) {
    if (!sec.id?.endsWith('-nc')) continue;
    const descField = sec.fields.find((f) => f.id.endsWith('ncdesc'));
    if (!descField) continue;
    const description = record.responses[descField.id];
    if (!description || !String(description).trim()) continue; // só conta se tem o quê
    const acaoField = sec.fields.find((f) => f.id.endsWith('ncacao'));
    const respField = sec.fields.find((f) => f.id.endsWith('ncresp'));
    out.push({
      sectionId: sec.id,
      description: String(description).trim(),
      action: acaoField ? (record.responses[acaoField.id] ?? null) : null,
      responsible: respField ? (record.responses[respField.id] ?? null) : null,
    });
  }
  return out;
}

// ─── PDF generator for forms ───────────────────────────────────────────────

export function generateFormPDF(template, record, tenant, rotuloCategoria) {
  const p       = getProfile(tenant?.id);
  const period  = formatPeriodLabel(template.frequency, record.periodKey);
  const filledAt = new Date(record.updatedAt).toLocaleString('pt-BR');
  const meta     = catMeta(template.category);
  const validated = record.validation;

  // Company header block
  const companyHeader = `
    <div class="company-header">
      <div>
        <div class="company-name">${p.razaoSocial || tenant?.name || ''}</div>
        ${p.cnpj ? `<div class="company-detail">CNPJ: ${p.cnpj}</div>` : ''}
        ${p.endereco ? `<div class="company-detail">${p.endereco}</div>` : ''}
        ${p.telefone ? `<div class="company-detail">Tel.: ${p.telefone}</div>` : ''}
        ${p.alvara ? `<div class="company-detail">Alvará: ${p.alvara}</div>` : ''}
      </div>
      ${p.atividade ? `<div class="activity-badge">${p.atividade}</div>` : ''}
    </div>
  `;

  const renderValue = (field, val) => {
    if (!val && val !== false) return '<span style="color:#9198a1">—</span>';
    if (field.type==='cnc') return val==='C'
      ? '<span style="color:#00a35c;font-weight:700">✓ CONFORME</span>'
      : val==='NC' ? '<span style="color:#c0392b;font-weight:700">✗ NÃO CONFORME</span>'
      : '<span style="color:#9198a1">—</span>';
    if (field.type==='presence') {
      if (typeof val==='object') return val.detected
        ? `<span style="color:#c0392b;font-weight:700">DETECTADO</span>${val.location ? ` — ${val.location}` : ''}`
        : '<span style="color:#00a35c;font-weight:700">SEM OCORRÊNCIA</span>';
      return String(val);
    }
    if (field.type==='date_sig' && typeof val==='object')
      return `${val.date||'—'} · Resp.: <strong>${val.sig||'—'}</strong>`;
    if (field.type==='date') return String(val).split('-').reverse().join('/'); // AAAA-MM-DD → DD/MM/AAAA
    if (field.type==='checkbox') return val===true
      ? '<span style="color:#00a35c;font-weight:700">✓ SIM</span>'
      : '<span style="color:#9198a1">—</span>';
    // Foto: o PDF é impresso na hora e o link assinado expira em 1h — imprimir
    // uma URL que morre no mesmo dia seria pior que não imprimir. Registra que
    // existe evidência e quando; a imagem se vê no app.
    if (field.type==='photo') {
      if (!val?.path) return '<span style="color:#9198a1">—</span>';
      const q = val.at ? new Date(val.at).toLocaleString('pt-BR') : '';
      return `<span style="color:#00a35c;font-weight:700">📷 Foto anexada</span>${q ? ` <span style="color:#5c6c7a">(${q})</span>` : ''}`;
    }
    return String(val);
  };

  const sectionsHtml = template.sections.map(sec => `
    ${template.sections.length>1 ? `<div class="sec-title">${sec.title}</div>` : ''}
    <table class="fields-table">
      ${sec.fields.map(field => `
        <tr>
          <td class="field-label">${field.label}${field.hint?`<div class="field-hint">${field.hint}</div>`:''}</td>
          <td class="field-value">${renderValue(field, record.responses?.[field.id])}</td>
        </tr>
      `).join('')}
    </table>
  `).join('');

  const rtName = p.rtNome || 'Nutricionista RT';
  const rtCrn  = p.rtCrn  || '';

  const validationHtml = validated ? `
    <div class="validation-stamp">
      <div class="stamp-header">✓ VALIDADO PELO RESPONSÁVEL TÉCNICO</div>
      <div><strong>${validated.by}</strong> · ${validated.role}${rtCrn ? ` · ${rtCrn}` : ''}</div>
      <div>${new Date(validated.at).toLocaleString('pt-BR')}</div>
      ${validated.note ? `<div class="stamp-note">${validated.note}</div>` : ''}
    </div>
  ` : `
    <div class="sign-block">
      <div class="sign-line"></div>
      <div>${rtName}${rtCrn ? ` · ${rtCrn}` : ''} · Data: ___/___/______</div>
    </div>
  `;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
  <title>${template.title} — ${period}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#001e2b;padding:24px}
    .company-header{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 14px;background:#f9fbfa;border:1px solid #c1ccd6;border-radius:6px;margin-bottom:14px}
    .company-name{font-size:14px;font-weight:800;color:#001e2b;margin-bottom:3px}
    .company-detail{font-size:10px;color:#5c6c7a;margin-top:1px}
    .activity-badge{padding:4px 10px;background:rgba(29,78,137,.10);color:#00684a;border:1px solid rgba(29,78,137,.4);border-radius:12px;font-size:10px;font-weight:700;white-space:nowrap;align-self:center}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #c1ccd6}
    .header-left h1{font-size:15px;font-weight:800;margin-bottom:4px}
    .header-left .period{font-size:11px;color:#5c6c7a}
    .meta-table{border-collapse:collapse;width:100%;margin-bottom:14px}
    .meta-table td{padding:4px 8px;border:1px solid #c1ccd6;font-size:10px}
    .meta-table td:first-child{font-weight:700;background:#f9fbfa;width:140px}
    .cat-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}44}
    .sec-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#5c6c7a;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #eaeef2}
    .fields-table{width:100%;border-collapse:collapse;margin-bottom:8px}
    .fields-table td{padding:7px 10px;border:1px solid #eaeef2;vertical-align:top}
    .field-label{width:55%;font-weight:600;background:#fafafa}
    .field-hint{font-size:9px;color:#5c6c7a;font-weight:400;margin-top:2px}
    .field-value{font-size:11px}
    .validation-stamp{margin-top:20px;padding:12px 16px;background:#dafbe1;border:2px solid #4ac26b;border-radius:6px}
    .stamp-header{font-size:12px;font-weight:800;color:#00a35c;margin-bottom:4px}
    .stamp-note{font-style:italic;margin-top:6px;color:#065f46}
    .sign-block{margin-top:28px;padding-top:16px;border-top:1px solid #c1ccd6;text-align:center;color:#5c6c7a;font-size:10px}
    .sign-line{width:280px;border-bottom:1px solid #5c6c7a;margin:0 auto 6px}
    .footer{margin-top:20px;padding-top:10px;border-top:1px solid #eaeef2;font-size:9px;color:#9198a1;display:flex;justify-content:space-between}
    @page{size:A4;margin:16mm}
  </style></head><body>
  ${companyHeader}
  <div class="header">
    <div class="header-left">
      <h1>${template.title}</h1>
      <div class="period">${period} · <span class="cat-badge">${rotuloCategoria ?? meta.label} · ${freqLabel(template.frequency)}</span></div>
    </div>
  </div>
  <table class="meta-table">
    <tr><td>Preenchido por</td><td>${record.user} · ${record.role}</td><td>Data/hora</td><td>${filledAt}</td></tr>
    <tr><td>Estabelecimento</td><td>${p.razaoSocial || tenant?.name || ''}</td><td>Status</td><td>${record.status==='submitted'?'✓ Confirmado':'Rascunho'}</td></tr>
    ${p.cnpj ? `<tr><td>CNPJ</td><td colspan="3">${p.cnpj}</td></tr>` : ''}
  </table>
  ${sectionsHtml}
  ${validationHtml}
  <div class="footer">
    <span>NutriOPS · RDC 216/2004</span>
    <span>${p.rtNome ? `RT: ${p.rtNome}${p.rtCrn ? ` · ${p.rtCrn}` : ''}` : 'Responsável Técnico'}</span>
    <span>Gerado em ${new Date().toLocaleString('pt-BR')}</span>
  </div>
  </body></html>`;
}

// ─── Pre-built templates ───────────────────────────────────────────────────

const TPL_HIGIENE_PESSOAL = () => ({
  id:uid(), category:'higiene_pessoal', frequency:'daily',
  title:'Higiene Pessoal dos Colaboradors',
  description:'Verificação diária de higiene, uniforme, comportamento e EPI. C=conforme / NC=não conforme.',
  sections:[{ id:uid(), title:'Verificação',
    fields:[
      f('Uniforme'),
      f('Sapato'),
      f('Cabelo'),
      f('Barba'),
      f('Unha'),
      f('Adorno','cnc','Remover brincos, anéis, pulseiras, colares'),
      f('Comportamento','cnc','Atitudes higiênicas, não manipular objetos fora da atividade'),
      f('Avental'),
      f('Perfume','cnc','Ausência de perfume forte'),
      f('Ferimento','cnc','Ferimentos devidamente cobertos'),
      f('Lavar Mãos','cnc','Ao iniciar, usar banheiro, trocar atividade, colocar luvas'),
      f('Observações','text'),
    ],
  }],
});

const TPL_VETORES = (areas='D=Distribuição S=Salão E=Externa') => ({
  id:uid(), category:'vetores_pragas', frequency:'daily',
  title:'Controle Integrado de Vetores e Pragas',
  description:'Verificação diária. Registrar tipo de praga e local. Anexar comprovante de dedetização.',
  sections:[{ id:uid(), title:'Ocorrências do dia',
    fields:[
      f('Abelha (A)',           'presence', areas),
      f('Barata (B)',           'presence', areas),
      f('Formiga (F)',          'presence', areas),
      f('Mosca / Mosquito (M)', 'presence', areas),
      f('Pombo (P)',            'presence', areas),
      f('Roedor (R)',           'presence', areas),
      f('Ação tomada', 'text'),
      f('Observações',  'text'),
    ],
  }],
});

// v:1 (Fatia 2a) — ganhou o campo de FOTO do comprovante. A auditoria já
// apontava: a planilha pedia "anexar comprovante" na descrição, mas só tinha
// campo de texto; o laudo em si nunca era anexado. O v-bump é o que faz o
// campo novo alcançar quem já roda (readFormTemplates), preservando o id da
// planilha existente e, com ele, todo o histórico já preenchido.
const TPL_DEDETIZACAO = () => ({
  id:uid(), category:'dedetizacao', frequency:'monthly', v:1,
  title:'Controle de Dedetização',
  description:'Registrar empresa, data, serviço e produto. Anexar comprovante.',
  sections:[{ id:uid(), title:'Registro do serviço',
    fields:[
      f('Empresa executora','text'),
      f('Data do serviço','text'),
      f('Serviço executado','text'),
      f('Produto utilizado','text'),
      f('Número do certificado','text'),
      f('Comprovante de dedetização (foto ou PDF)','photo'),
      f('Observações','text'),
    ],
  }],
});

const TPL_POTABILIDADE = () => ({
  id:uid(), category:'potabilidade', frequency:'biweekly',
  title:'Controle da Potabilidade da Água',
  description:'Verificação quinzenal da troca de filtros e higienização do reservatório.',
  sections:[{ id:uid(), title:'Filtros',
    fields:[
      f('Filtro Pia — troca realizada?'),
      f('Filtro Máquina de Gelo — troca realizada?'),
      f('Data da troca','text'),
      f('Empresa / responsável','text'),
      f('Observações','text'),
    ],
  }],
});

// Higienização semestral do reservatório — RDC 216 §4.4 (Fatia 2a, 15/08).
// Era um dos 5 DESCOBERTOS da auditoria: exigência clássica de fiscalização
// sem NENHUMA captura no app. O check A6 da tela de Prontidão respondia
// "sem dado" desde a Fatia 1 justamente esperando por isto.
//
// IDS FIXOS, não uid(): a v1.9.133 estancou a duplicação causada por seeds de
// id sorteado, e uma planilha nova nascendo com uid() reabriria o buraco.
// Vale pra qualquer seed daqui pra frente.
//
// `photo` no comprovante porque é o que o fiscal pede de verdade — o laudo da
// empresa executora. O motor de planilhas já suporta o tipo desde a v1.9.x.
// ─────────────────────────────────────────────────────────────────────────────
// Id de seed determinístico POR LOJA.
//
// `form_templates` tem `id uuid primary key` — `tenant_id` é só coluna
// indexada. Um template com id FIXO servido a mais de uma loja faz as linhas
// dessas lojas COLIDIREM na nuvem: quando a RT da Swiss salva a planilha do
// Reservatório, o upsert (que resolve por id) sobrescreve a linha da CASA
// DOCE, trocando inclusive o tenant_id. A outra loja para de achar a dela no
// pull e cai de volta no seed — a customização some. Achado da auditoria de
// 18/08, e só o Reservatório está nessa situação: os outros 4 templates
// compartilhados usam uid().
//
// `uid()` NÃO resolve: id aleatório por device recria a duplicação de planilhas
// que a v1.9.139 passou a limpar (dois aparelhos da mesma loja gerariam ids
// diferentes pro mesmo template). Precisa ser estável DENTRO da loja e distinto
// ENTRE lojas — daí o hash do tenantId no último grupo do uuid base.
// ─────────────────────────────────────────────────────────────────────────────
export function idSeedPorTenant(base, tenantId) {
  let h = 0x811c9dc5;                     // FNV-1a, 32 bits
  const t = String(tenantId ?? '');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return base.slice(0, 24) + h.toString(16).padStart(8, '0') + base.slice(32);
}

const TPL_RESERVATORIO = (tenantId) => ({
  id: idSeedPorTenant('8f2b1c04-6d3a-4e57-9b18-2a7c5e0d4f91', tenantId), category:'potabilidade', frequency:'semiannual', v:1,
  title:'Higienização do Reservatório de Água',
  description:'Obrigatória a cada 6 meses (RDC 216). Registrar empresa executora, data e anexar o comprovante/laudo.',
  sections:[{ id:'res-servico', title:'Registro da higienização', fields:[
    { id:'res-data',   label:'Data da higienização', type:'date' },
    { id:'res-emp',    label:'Empresa executora / responsável', type:'text' },
    { id:'res-metodo', label:'Produto e método utilizados', type:'text' },
    { id:'res-cert',   label:'Número do certificado / laudo', type:'text' },
    { id:'res-lacre',  label:'Reservatório tampado e lacrado após o serviço?', type:'cnc' },
    { id:'res-foto',   label:'Comprovante / laudo (foto ou PDF)', type:'photo' },
    { id:'res-obs',    label:'Observações', type:'text' },
  ]}],
});

const TPL_FAXINA_BACKEREI = () => ({
  id:uid(), category:'faxina', frequency:'weekly',
  title:'Controle de Faxina — Bäckerei',
  description:'Verificação semanal de higienização. Registrar data e responsável.',
  sections:[
    { id:uid(), title:'Interna', fields:[
      f('Vitrine Refrigerada: acrílico, inox, vidro, filtro motor','date_sig'),
      f('Mesa Caixa: armário e gaveta','date_sig'),
      f('Refrigerador: grades, borracha da porta','date_sig'),
      f('Vitrine de Folheados: interna e externa','date_sig'),
      f('Vitrine de Pães: interna, externa e armário','date_sig'),
      f('Máquina de Café / Bancada','date_sig'),
      f('Armário Horizontal 1 e 2','date_sig'),
      f('Armário Vertical 1 e 2','date_sig'),
      f('Estufa: interna e externa','date_sig'),
      f('Máquina de Lavar Louça','date_sig'),
      f('Forno: interna e externa','date_sig'),
      f('Pia / Armário Pia','date_sig'),
      f('Caixa de Gordura','date_sig'),
    ]},
    { id:uid(), title:'Externa', fields:[
      f('Mesas / Suplat: superfície e apoio','date_sig'),
      f('Cadeiras: couro','date_sig'),
      f('Vidros: dois lados / Piso','date_sig'),
      f('Máquina de Gelo','date_sig'),
      f('Mármore / Luminárias (trimestral)','date_sig',null,'quarterly'),
      f('Toldo (anual)','date_sig',null,'annual'),
    ]},
  ],
});

const TPL_FAXINA_SWISS = () => ({
  id:uid(), category:'faxina', frequency:'weekly',
  title:'Controle de Faxina — Swiss',
  description:'Verificação semanal de higienização. Registrar data e responsável.',
  sections:[
    { id:uid(), title:'Interna', fields:[
      f('Prateleiras 1 e 3','date_sig'), f('Prateleiras 2 e 4','date_sig'),
      f('Bancada','date_sig'), f('Refrigerador 1 e 2','date_sig'), f('Refrigerador 3 e 4','date_sig'),
      f('Micro-ondas','date_sig'), f('Forno','date_sig'), f('Carrinho','date_sig'),
      f('Bancada de Apoio','date_sig'), f('Freezer','date_sig'),
      f('Prateleiras Pia','date_sig'), f('Máquina de Lavar Louça','date_sig'),
      f('Pia Lavabo','date_sig'), f('Caixa de Gordura','date_sig'),
      f('Lixeiras','date_sig'), f('Máquina de Gelo','date_sig'), f('Adega','date_sig'),
    ]},
    { id:uid(), title:'Externa', fields:[
      f('Máquina de Café','date_sig'), f('Refrigerador 1','date_sig'),
      f('Vitrine de Pães','date_sig'), f('Prateleira Suspensa 1 e 2','date_sig'),
      f('Armário Limpeza','date_sig'), f('Armário Alimentos','date_sig'),
      f('Nichos 17','date_sig'), f('Vitrine Refrigerada','date_sig'),
      f('Refrigerador Expositor','date_sig'), f('Armário 1 e 2','date_sig'),
      f('Prateleiras 1/2 e 3/4','date_sig'), f('Luminárias','date_sig'),
      f('Mesas / Suplat','date_sig'), f('Toldo (anual)','date_sig',null,'annual'),
    ]},
    { id:uid(), title:'Estoque', fields:[
      f('Geladeira: grades e contentores','date_sig'), f('Freezer: grades e contentores','date_sig'),
      f('Estante / Estrado (bimestral)','date_sig',null,'bimonthly'), f('Piso / Lixeiras','date_sig'),
      f('Paredes (trimestral)','date_sig',null,'quarterly'), f('Luminárias (trimestral)','date_sig',null,'quarterly'),
    ]},
  ],
});

const TPL_FAXINA_DBK = () => ({
  id:uid(), category:'faxina', frequency:'weekly',
  title:'Controle de Faxina — DBK Serviços Gerais',
  description:'Verificação semanal por área. Registrar data e assinatura do responsável.',
  sections:[
    { id:uid(), title:'Área de Recebimento', fields:[
      f('Elevador / Escada','date_sig'), f('Parede / Janela','date_sig'),
      f('Lavatório / Dispenser','date_sig'), f('Geladeira 1 e 2','date_sig'),
      f('Estante 1 e 2','date_sig'), f('Carrinho de recebimento','date_sig'),
      f('Telas / Luminárias','date_sig'),
    ]},
    { id:uid(), title:'Vestiário', fields:[
      f('Banheiro Feminino: janela, parede, box, pia, sanitário, piso','date_sig'),
      f('Banheiro Masculino: janela, parede, box, pia, sanitário, piso','date_sig'),
      f('Cadeiras / Paredes / Janelas / Portas','date_sig'),
      f('Telas / Luminárias','date_sig'),
    ]},
    { id:uid(), title:'Refeitório', fields:[
      f('Mesa / Cadeiras','date_sig'), f('Pia / Filtro','date_sig'),
      f('Caixa de Gordura','date_sig'), f('Paredes / Janelas / Portas','date_sig'),
      f('Telas / Luminárias','date_sig'),
    ]},
    { id:uid(), title:'DML / Estoque / Escritório', fields:[
      f('Estante / Parede / Porta — DML','date_sig'),
      f('Estantes / Estrados — Estoque','date_sig'), f('Parede / Porta — Estoque','date_sig'),
      f('Banheiro Escritório','date_sig'), f('Mesa / Cadeiras — Escritório','date_sig'),
      f('Paredes / Janelas / Portas — Escritório','date_sig'),
      f('Telas / Luminárias — Escritório','date_sig'),
    ]},
    { id:uid(), title:'Confeitaria e Padaria', fields:[
      f('Caixa de Gordura — Confeitaria','date_sig'),
      f('Paredes / Janelas / Portas — Padaria','date_sig'),
      f('Bancada e Estante 1 e 2 — Padaria','date_sig'),
      f('Telas / Luminárias — Padaria','date_sig'),
      f('Telas / Luminárias — Confeitaria','date_sig'),
    ]},
  ],
});

const TPL_MANUTENCAO_DBK = () => ({
  id:uid(), category:'manutencao', frequency:'monthly',
  title:'Controle de Manutenção dos Equipamentos — DBK',
  description:'Registrar data e empresa de manutenção de cada equipamento.',
  sections:[{ id:uid(), title:'Equipamentos', fields:[
    f('Câmara Congelada','date_sig'), f('Câmara Refrigerada','date_sig'),
    f('Refrigerador Bancada Confeitaria','date_sig'), f('Congelador Bancada Confeitaria','date_sig'),
    f('Refrigerador Bancada Panificação','date_sig'),
    f('Ar Condicionado Confeitaria','date_sig'), f('Ar Condicionado Escritório','date_sig'),
    f('Ar Condicionado Estoque','date_sig'),
    f('Geladeira Dupla Padaria','date_sig'), f('Geladeira Dupla Corredor','date_sig'),
  ]}],
});

// CASA DOCE — planilha "FP.HIG.001". Ids FIXOS (não uid()) pra bater com a linha
// da nuvem (form_templates) no merge por id — sem duplicar. Novos templates da
// CASA DOCE (Fase B) entram aqui conforme a nutricionista confirma os detalhes.
const TPL_CASADOCE_BANHEIROS = () => ({
  id:'c61acf39-5ff8-404e-8fae-f9f68734f1b2', category:'faxina', frequency:'daily', v:3,
  title:'Controle de Higienização de Banheiros',
  description:'Registro diário. Marque a atividade realizada e o horário; quem preenche fica identificado (assinatura digital). Ref.: FP.HIG.001.',
  sections:[
    // Sem isto o registro dizia "banheiro limpo" sem dizer QUAL nem POR QUEM —
    // inútil numa fiscalização (pedido da nutricionista, 07/08).
    { id:'cd-ban-cab', title:'Identificação', fields:[
      { id:'cd-ban-local', label:'Qual banheiro', type:'select',
        options:['Masculino — clientes','Feminino — clientes','Acessível / PCD','Masculino — colaboradores','Feminino — colaboradores','Unissex 1º andar'] },
      { id:'cd-ban-resp',  label:'Responsável pela limpeza', type:'text' },
    ]},
    { id:'cd-ban-lg', title:'Limpeza Geral', fields:[
      { id:'cd-ban-lg-feito', label:'Realizada', type:'checkbox', hint:'Limpeza geral do banheiro' },
      { id:'cd-ban-lg-hora',  label:'Horário',  type:'text', hint:'Hora em que foi feita' },
    ]},
    { id:'cd-ban-mn', title:'Manutenção', fields:[
      { id:'cd-ban-mn-feito', label:'Realizada', type:'checkbox', hint:'Reposição de papel, sabonete, etc.' },
      { id:'cd-ban-mn-hora',  label:'Horário',  type:'text', hint:'Hora em que foi feita' },
      { id:'cd-ban-obs',      label:'Observações', type:'text' },
    ]},
    { id:'cd-ban-nc', title:'Não conformidade (se houver)', fields:[
      { id:'cd-ban-ncdesc', label:'Não conformidade', type:'text' },
      { id:'cd-ban-ncacao', label:'Ação corretiva', type:'text' },
      { id:'cd-ban-ncresp', label:'Responsável pela correção', type:'text' },
    ]},
  ],
});

// ── CASA DOCE · Fase B — demais planilhas BPF (rascunhos das planilhas reais da
// nutricionista). Ids FIXOS pra bater com a nuvem no merge. Frequências marcadas
// "a confirmar" nas descrições — trocar 1 valor + re-rodar o SQL se ela ajustar.

const TPL_CD_HORTIFRUTI = () => ({
  id:'f565a332-b2a1-401d-b1f4-5e70825aafec', category:'faxina', frequency:'daily', v:3, scopeBy:'cd-hf-setor',
  title:'Higienização de Hortifrutícolas',
  description:'Registro da higienização de hortifrutícolas (imersão em solução sanitizante). Frequência: diária (a confirmar com a RT).',
  sections:[
    { id:'cd-hf-reg', title:'Registro', fields:[
      { id:'cd-hf-data', label:'Data', type:'date_sig' },
      // Setor de quem higienizou (pedido 07/08) — a mesma solução roda em mais
      // de uma área e a RT precisa saber de qual veio o registro.
      { id:'cd-hf-setor', label:'Setor', type:'select', options: CD_SETORES_EQUIPE },
      { id:'cd-hf-item', label:'Hortifrutícola', type:'text', hint:'Ex.: alface, morango' },
      { id:'cd-hf-sol',  label:'Solução utilizada', type:'text', hint:'Ex.: hipoclorito 200 ppm' },
      { id:'cd-hf-tempo',label:'Tempo de imersão (min)', type:'number' },
    ]},
    { id:'cd-hf-nc', title:'Não conformidade (se houver)', fields:[
      { id:'cd-hf-ncdesc', label:'Não conformidade', type:'text' },
      { id:'cd-hf-ncacao', label:'Ação corretiva', type:'text' },
      { id:'cd-hf-ncresp', label:'Responsável pela correção', type:'text' },
    ]},
  ],
});

const TPL_CD_FILTRO_CAFE = () => ({
  id:'aca18344-2856-4931-9f29-372d36132824', category:'faxina', frequency:'daily',
  title:'Lavagem do Filtro de Café',
  description:'Registro da lavagem do filtro de café. Frequência: diária (a confirmar com a RT).',
  sections:[
    { id:'cd-fc-reg', title:'Registro de lavagem', fields:[
      { id:'cd-fc-data', label:'Data', type:'date_sig' },
      { id:'cd-fc-prod', label:'Produto utilizado', type:'text' },
      { id:'cd-fc-qtd',  label:'Quantidade', type:'number' },
    ]},
  ],
});

const TPL_CD_RESIDUOS = () => ({
  id:'1197f2fd-682b-47a0-8912-d23bbe69c708', category:'residuos', frequency:'daily', v:2,
  title:'Controle de Saída de Resíduos',
  description:'Pesagem/volume diário dos resíduos por categoria.',
  sections:[
    { id:'cd-res-dia', title:'Saída do dia', fields:[
      { id:'cd-res-data', label:'Data', type:'date' },
      { id:'cd-res-resp', label:'Responsável', type:'text' },
      { id:'cd-res-rec-kg', label:'Reciclável — Kg', type:'number' },
      { id:'cd-res-rec-l',  label:'Reciclável — Litros', type:'number' },
      { id:'cd-res-rej-kg', label:'Rejeito — Kg', type:'number' },
      { id:'cd-res-rej-l',  label:'Rejeito — Litros', type:'number' },
      { id:'cd-res-org-kg', label:'Orgânico — Kg', type:'number' },
      { id:'cd-res-org-l',  label:'Orgânico — Litros', type:'number' },
      { id:'cd-res-vid-l',  label:'Vidros — Litros', type:'number' },
      { id:'cd-res-oleo-l', label:'Óleo — Litros', type:'number' },
      { id:'cd-res-obs',    label:'Observações', type:'text' },
    ]},
  ],
});

// Higienização dos Carrinhos — a nutricionista esclareceu (29/07): NÃO é
// registro obrigatório da Anvisa, é só controle interno de limpeza. Na
// prática todos os carrinhos são higienizados no MESMO DIA (não um por vez
// em datas diferentes) — o modelo antigo pedia data+assinatura por carrinho
// (32x), gerando a fricção que ela relatou ("sempre esquecem de preencher").
// Redesenhado: 1 data + 1 responsável pro lote inteiro, e um checklist leve
// (checkbox) de quais carrinhos foram feitos nesse dia.
const TPL_CD_CARRINHOS = () => {
  const codes = ['T1','T2','T3','T4','T5','T6','T7','E1','E2','B1','B2','B3','C1','C2','C3','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','A1','A2','A3','A4','A5'];
  return {
    id:'0be8daac-24a5-461b-af6c-f438edcf5f48', category:'faxina', frequency:'biweekly',
    title:'Higienização dos Carrinhos',
    description:'Controle interno de limpeza (não é registro obrigatório da Anvisa). Higienização quinzenal, feita no mesmo dia para todos os carrinhos — registre a data/responsável uma vez e marque os que foram higienizados.',
    sections:[
      { id:'cd-carr-reg', title:'Registro', fields:[
        { id:'cd-carr-data', label:'Data da higienização', type:'date' },
        { id:'cd-carr-resp', label:'Responsável', type:'text' },
      ]},
      { id:'cd-carr-lav', title:'Carrinhos higienizados', fields:
        codes.map(c => ({ id:`cd-carr-${c}`, label:`Carrinho ${c}`, type:'checkbox' }))
      },
      { id:'cd-carr-obs', title:'Observações', fields:[
        { id:'cd-carr-obs-t', label:'Observações', type:'text' },
      ]},
    ],
  };
};

const TPL_CD_CLIMATIZACAO = () => ({
  id:'bb60649e-c14d-4c61-b115-ac16238fa010', category:'manutencao', frequency:'monthly',
  title:'Limpeza e Troca de Filtro — Climatização',
  description:'Registro de limpeza/troca de filtro dos equipamentos de climatização. Frequência: mensal/por evento (a confirmar com a RT).',
  sections:[
    { id:'cd-cl-reg', title:'Registro', fields:[
      { id:'cd-cl-data', label:'Data', type:'date' },
      { id:'cd-cl-eq',   label:'Identificação do equipamento', type:'text' },
      { id:'cd-cl-troca',label:'Troca de filtro', type:'checkbox' },
      { id:'cd-cl-limp', label:'Limpeza', type:'checkbox' },
      { id:'cd-cl-resp', label:'Responsável', type:'text' },
      { id:'cd-cl-prox', label:'Previsão da próxima manutenção', type:'date' },
      { id:'cd-cl-obs',  label:'Observações (falhas / anomalias)', type:'text' },
    ]},
  ],
});

const TPL_CD_MANUT_PROG = () => ({
  id:'637fcd48-4eb2-4a4c-adfe-0318a304a775', category:'manutencao', frequency:'monthly',
  title:'Manutenção Programada e Periódica',
  description:'Registro de manutenção preventiva/corretiva de equipamentos. Frequência: por evento (a confirmar com a RT).',
  sections:[
    { id:'cd-mp-reg', title:'Registro', fields:[
      { id:'cd-mp-data', label:'Data', type:'date' },
      { id:'cd-mp-eq',   label:'Identificação do equipamento', type:'text' },
      { id:'cd-mp-prev', label:'Preventiva', type:'checkbox' },
      { id:'cd-mp-corr', label:'Corretiva', type:'checkbox' },
      { id:'cd-mp-info', label:'Informações complementares', type:'text' },
      { id:'cd-mp-resp', label:'Responsável / executante', type:'text' },
      { id:'cd-mp-prox', label:'Data da próxima manutenção', type:'date' },
    ]},
  ],
});

// CASA DOCE — Higiene Pessoal / Vetores / Dedetização (Fase C, 29/07). Mesmo
// conteúdo dos templates genéricos (TPL_HIGIENE_PESSOAL/TPL_DEDETIZACAO), mas
// com ids FIXOS (convenção TPL_CD_*) pra bater com a nuvem. Vetores é
// customizado: a nutricionista respondeu (29/07) que usa a mesma planilha em
// todos os setores, mas quer o setor de destinação anotado (Padaria/Café/
// Gelateria/Confeitaria); Pombo sai da lista (controle já feito à parte por
// fora), Abelha entra (já estava no genérico).
// Setores da CASA DOCE pra os campos de seleção. Lista dada pela nutricionista
// (07/08) — é a divisão de EQUIPE, por isso não bate 1:1 com os 21 setores de
// higienização (que são de ÁREA FÍSICA: Câmaras, Fornos, Área de Lavagem…).
const CD_SETORES_EQUIPE = [
  'Gelateria', 'Padaria', 'Confeitaria', 'Café / Atendimento', 'Ilha',
  'Bistrô', 'Salgados', 'Serviços gerais', 'Estoque', 'Garçons',
  'Encomendas', 'Caixas',
];

const TPL_CD_HIGIENE = () => ({
  id:'c1e7838e-1cac-4a76-a0c3-296e1bebbfdb', category:'higiene_pessoal', frequency:'daily', v:4, scopeBy:'cd-hig-setor',
  title:'Higiene Pessoal dos Colaboradores',
  description:'Verificação por SETOR: escolha o setor, registre data e quem verificou. C=conforme / NC=não conforme. Ex.: toda segunda e terça o checklist da Padaria.',
  sections:[
    // Cabeçalho pedido pela nutricionista (07/08): sem data/responsável/setor
    // não dava pra saber quando, quem verificou nem qual equipe foi avaliada.
    { id:'cd-hig-cab', title:'Identificação', fields:[
      { id:'cd-hig-data',  label:'Data da verificação', type:'date' },
      { id:'cd-hig-setor', label:'Setor', type:'select', options: CD_SETORES_EQUIPE },
      { id:'cd-hig-resp',  label:'Responsável pela verificação', type:'text' },
    ]},
    { id:'cd-hig-ver', title:'Verificação', fields:[
      // "Uniforme" e "Avental" eram dois campos; a nutricionista pediu juntos
      // ("avental/uniforme"). Mantido o id cd-hig-uniforme pra não perder o
      // histórico já registrado; cd-hig-avental sai.
      { id:'cd-hig-uniforme', label:'Avental / uniforme', type:'cnc' },
      { id:'cd-hig-sapato',   label:'Sapato fechado e antiderrapante', type:'cnc' },
      { id:'cd-hig-cabelo',   label:'Cabelo', type:'cnc' },
      { id:'cd-hig-barba',    label:'Barba', type:'cnc' },
      { id:'cd-hig-unha',     label:'Unhas limpas, sem esmalte ou base', type:'cnc' },
      { id:'cd-hig-adorno',   label:'Adorno', type:'cnc', hint:'Remover brincos, anéis, pulseiras, colares' },
      { id:'cd-hig-comport',  label:'Comportamento', type:'cnc', hint:'Atitudes higiênicas, não manipular objetos fora da atividade' },
      { id:'cd-hig-perfume',  label:'Perfume', type:'cnc', hint:'Ausência de perfume forte' },
      { id:'cd-hig-ferim',    label:'Ferimento', type:'cnc', hint:'Ferimentos devidamente cobertos' },
      { id:'cd-hig-maos',     label:'Lavar Mãos', type:'cnc', hint:'Ao iniciar, usar banheiro, trocar atividade, colocar luvas' },
      { id:'cd-hig-obs',      label:'Observações', type:'text', hint:'Ex.: colaboradora com unha grande — orientada e registrada' },
      { id:'cd-hig-foto',     label:'Foto (opcional)', type:'photo', hint:'Evidência de não conformidade — ex.: unha comprida, uniforme sujo' },
    ]},
  ],
});

const TPL_CD_VETORES = () => ({
  id:'96496ddc-a938-4b90-9aa5-fd5710a54fb0', category:'vetores_pragas', frequency:'daily', v:3, scopeBy:'cd-vet-setor',
  title:'Controle Integrado de Vetores e Pragas',
  description:'Verificação diária. Registrar tipo de praga e o setor onde foi feito o controle. Anexar comprovante de dedetização.',
  sections:[
    { id:'cd-vet-cab', title:'Identificação', fields:[
      { id:'cd-vet-data',  label:'Data', type:'date' },
      { id:'cd-vet-setor', label:'Setor verificado', type:'select', options: CD_SETORES_EQUIPE },
      { id:'cd-vet-resp',  label:'Responsável pela verificação', type:'text' },
    ]},
    { id:'cd-vet-ocorr', title:'Ocorrências do dia', fields:[
      // O hint de setor saiu daqui: agora o setor é campo próprio no cabeçalho.
      // O "local" do presence continua servindo pro ponto exato da ocorrência.
      { id:'cd-vet-abelha',  label:'Abelha (A)',           type:'presence' },
      { id:'cd-vet-barata',  label:'Barata (B)',           type:'presence' },
      { id:'cd-vet-formiga', label:'Formiga (F)',          type:'presence' },
      { id:'cd-vet-mosca',   label:'Mosca / Mosquito (M)', type:'presence' },
      { id:'cd-vet-roedor',  label:'Roedor (R)',           type:'presence' },
      { id:'cd-vet-acao',    label:'Ação tomada', type:'text' },
      { id:'cd-vet-obs',     label:'Observações',  type:'text' },
    ]},
  ],
});

const TPL_CD_DEDETIZACAO = () => ({
  id:'17ce4089-0e51-48a7-991a-bdde090a33e9', category:'dedetizacao', frequency:'monthly', v:1,
  title:'Controle de Dedetização',
  description:'Registrar empresa, data, serviço e produto. Anexar comprovante.',
  sections:[{ id:'cd-ded-reg', title:'Registro do serviço', fields:[
    { id:'cd-ded-emp',  label:'Empresa executora', type:'text' },
    { id:'cd-ded-data', label:'Data do serviço', type:'text' },
    { id:'cd-ded-serv', label:'Serviço executado', type:'text' },
    { id:'cd-ded-prod', label:'Produto utilizado', type:'text' },
    { id:'cd-ded-cert', label:'Número do certificado', type:'text' },
    { id:'cd-ded-foto', label:'Comprovante de dedetização (foto ou PDF)', type:'photo' },
    { id:'cd-ded-obs',  label:'Observações', type:'text' },
  ]}],
});

const TPL_CD_CALIBRACAO = () => ({
  id:'f4d07b4c-7e7d-4a1f-8e05-fe3c474c37d8', category:'manutencao', frequency:'monthly',
  title:'Calibração de Instrumentos de Medição',
  description:'Registro de calibração de termômetros, balanças, etc. Frequência: conforme validade da calibração (a confirmar com a RT).',
  sections:[
    { id:'cd-cal-reg', title:'Registro', fields:[
      { id:'cd-cal-data', label:'Data', type:'date' },
      { id:'cd-cal-eq',   label:'Identificação do equipamento', type:'text' },
      { id:'cd-cal-apto', label:'Equipamento apto?', type:'cnc', hint:'C = SIM (apto) · NC = NÃO' },
      { id:'cd-cal-emp',  label:'Empresa responsável', type:'text' },
      { id:'cd-cal-prox', label:'Data da próxima calibração', type:'date' },
    ]},
  ],
});

// ── CASA DOCE · Fase D — Higienização por SETOR (21 folhas do papel) ────────
// Cada folha vira uma planilha própria: a equipe da Padaria abre só a da
// Padaria. As colunas "Semana 1..5" do papel viram um preenchimento POR SEMANA
// (frequency:'weekly') — por isso TODAS são semanais mesmo quando a tarefa é
// mensal/quinzenal/diária: o período de cada tarefa vai no nome dela, igual à
// coluna "Período" da folha. É o mesmo compromisso que o papel já faz (lá
// também há uma coluna por semana pra tarefa diária).
//
// ⚠️ O SETOR é derivado do TÍTULO em templateSector() ("Higienização — Padaria"
// → "Padaria"). form_templates não tem coluna `sector` (id/tenant_id/category/
// frequency/title/description/sections) e um campo solto no objeto NÃO
// sobreviveria ao round-trip da nuvem. Mudou o formato do título? Ajuste lá.
const PER = { S:'semanal', M:'mensal', Q:'quinzenal', D:'diária', X:'frequência a definir' };
// Item 13 da revisão: até aqui o `per` de cada tarefa só virava texto no
// rótulo (linha abaixo) — a folha inteira cobrava toda semana mesmo pras
// tarefas M/Q. Agora vira `frequency` estruturado de verdade (field-frequency.js
// decide se é devida nesta semana). X ("a definir") fica sem frequência
// própria — não sabemos o ciclo real, então segue sempre devida, como antes.
const PER_TO_FREQUENCY = { S:'weekly', D:'daily', Q:'biweekly', M:'monthly', X:null };

const higSetor = (uuid, slug, setor, tarefas) => () => ({
  id:uuid, category:'higienizacao', frequency:'weekly', v:3,
  title:`Higienização — ${setor}`,
  description:`Higienização do setor ${setor}. Registre data e assinatura de cada tarefa concluída — o período esperado está no nome. Uma folha por semana, como no papel.`,
  sections:[
    // Cabeçalho "Responsável / Mês-Ano" do papel. Cada tarefa já tem a sua
    // data+assinatura, mas a nutricionista pediu também o responsável da FOLHA
    // — é quem responde pelo setor naquela semana, mesmo que várias pessoas
    // tenham executado tarefas diferentes.
    { id:`cd-hig-${slug}-cab`, title:'Identificação', fields:[
      { id:`cd-hig-${slug}-resp`, label:'Responsável pelo setor', type:'text' },
      { id:`cd-hig-${slug}-mes`,  label:'Mês / ano de referência', type:'date' },
    ]},
    { id:`cd-hig-${slug}-t`, title:'Tarefas', fields:tarefas.map(([nome, per], i) => (
      { id:`cd-hig-${slug}-${i}`, label:`${nome} (${PER[per]})`, type:'date_sig', frequency: PER_TO_FREQUENCY[per] ?? null }
    ))},
    { id:`cd-hig-${slug}-nc`, title:'Não conformidade (se houver)', fields:[
      { id:`cd-hig-${slug}-ncdesc`, label:'Não conformidade', type:'text' },
      { id:`cd-hig-${slug}-ncacao`, label:'Ação corretiva', type:'text' },
      { id:`cd-hig-${slug}-ncresp`, label:'Responsável pela correção', type:'text' },
    ]},
  ],
});

// Setor de uma planilha de higienização — ver o aviso do bloco acima.

// ─────────────────────────────────────────────────────────────────────────────
// Organizar planilhas — pedido da RT da CASA DOCE (18/08): renomear a aba
// "Faxina" pra "Serviços gerais" e tirar dali duas planilhas. Terceiro pedido
// dessa natureza em um mês (setores 07/08, tarefas 10/08), então virou edição
// em vez de hardcode. Tudo POR LOJA: "Faxina" também é a aba da Swiss, da
// Bäckerei e da DBK, que não pediram nada.
//
// Uma tela só com as duas coisas, porque o pedido dela é uma reorganização —
// não um ajuste pontual.
// ─────────────────────────────────────────────────────────────────────────────
function OrganizarPlanilhasModal({ templates, prefs, onSave, onClose, error }) {
  const [labels, setLabels] = useState(() => ({ ...(prefs?.categoryLabels ?? {}) }));
  const [cats, setCats]     = useState(() => ({ ...(prefs?.templateCategory ?? {}) }));
  const [meta, setMeta]     = useState(() => ({ ...(prefs?.templateMeta ?? {}) }));
  const [setores, setSetores] = useState(() => ({ ...(prefs?.templateSector ?? {}) }));
  // Ids em modo "digitar aba nova" — separado de `setores` porque a pessoa
  // escolhe "criar nova" ANTES de ter digitado o nome, e nesse intervalo o
  // valor ainda é vazio (não dá pra inferir o modo só pelo valor).
  const [criandoAba, setCriandoAba] = useState(() => new Set());

  // Categorias presentes na loja + as que ela já renomeou (pra poder desfazer
  // mesmo que a última planilha daquela aba tenha saído).
  const catsPresentes = useMemo(() => {
    const set = new Set(templates.map((t) => t.category).filter(Boolean));
    for (const k of Object.keys(labels)) set.add(k);
    return [...set].sort((a, b) => catMeta(a).label.localeCompare(catMeta(b).label, 'pt-BR'));
  }, [templates, labels]);

  // Higienização ENTRA na lista de destinos (v1.9.189): agora dá pra mover uma
  // planilha pra lá, desde que escolhendo o setor. Só as 21 nativas seguem
  // sem poder sair.
  const destinos = catsPresentes;

  const ordenadas = useMemo(
    () => [...templates].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
    [templates]);

  // Setores que já existem na loja — vêm das 21 folhas nativas (título) e de
  // qualquer planilha que a RT já tenha movido pra cá antes.
  const setoresExistentes = useMemo(
    () => [...new Set(templates.map(templateSector).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity:'base' })),
    [templates]);

  // Planilha mandada pra Higienização sem setor escolhido: o save fica travado
  // até resolver, senão ela sumiria de todos os filtros (é a razão original da
  // trava que este recurso está afrouxando).
  const semSetor = ordenadas.filter((t) => {
    if (t.category === CATEGORIA_COM_COMPORTAMENTO) return false;
    return (cats[t.id] ?? t.category) === CATEGORIA_COM_COMPORTAMENTO
      && !String(setores[t.id] ?? '').trim();
  });

  const escolherSetor = (id, valor) => {
    if (valor === '__nova__') {
      setCriandoAba((s) => new Set(s).add(id));
      setSetores((p) => ({ ...p, [id]: '' }));
      return;
    }
    setCriandoAba((s) => { const n = new Set(s); n.delete(id); return n; });
    setSetores((p) => ({ ...p, [id]: valor }));
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(20,20,19,.55)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background:'var(--surface)', borderRadius:'var(--r-xl)', width:'100%', maxWidth:640, boxShadow:'var(--shadow-lg)', padding:24, display:'flex', flexDirection:'column', gap:18, maxHeight:'calc(100dvh - 48px)', overflowY:'auto' }}>
        <div>
          <span className="eyebrow">Boas práticas de fabricação</span>
          <h2 style={{ fontFamily:'var(--serif)', fontSize:24, fontWeight:400, margin:0 }}>Organizar planilhas</h2>
          <p style={{ fontSize:12, color:'var(--text-secondary)', marginTop:4, marginBottom:0 }}>
            Vale só para esta empresa. As outras continuam como estão.
          </p>
        </div>

        <section>
          <h3 style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', marginBottom:8 }}>Nome das abas</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {/* flexDirection explícito: styles.css põe todo `label` em coluna
                (linha 111), e sem isto o nome da aba cai em cima do campo. */}
            {catsPresentes.map((cat) => (
              <label key={cat} style={{ display:'flex', flexDirection:'row', alignItems:'center', gap:10, fontSize:13 }}>
                <span style={{ width:150, flexShrink:0, color:'var(--text-secondary)' }}>{catMeta(cat).label}</span>
                <input value={labels[cat] ?? ''} placeholder={catMeta(cat).label}
                  onChange={(e) => setLabels((p) => ({ ...p, [cat]: e.target.value }))}
                  style={{ flex:1, minWidth:0, padding:'7px 10px', fontSize:13 }} />
              </label>
            ))}
          </div>
          <p style={{ fontSize:11, color:'var(--text-secondary)', marginTop:6, marginBottom:0 }}>
            Deixe em branco para voltar ao nome original.
          </p>
        </section>

        <section>
          <h3 style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', marginBottom:8 }}>Em qual aba cada planilha aparece</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {ordenadas.map((tpl) => {
              const atual = cats[tpl.id] ?? tpl.category;
              const ehHigienizacao = tpl.category === CATEGORIA_COM_COMPORTAMENTO;
              const travada = podeMoverPara(tpl, destinos.find((d) => d !== tpl.category) ?? tpl.category);
              const vaiPraHigienizacao = !ehHigienizacao && atual === CATEGORIA_COM_COMPORTAMENTO;
              const setorAtual = String(setores[tpl.id] ?? '').trim();
              const modoNova = criandoAba.has(tpl.id) || (setorAtual !== '' && !setoresExistentes.includes(setorAtual));
              return (
                <div key={tpl.id} style={{ display:'flex', flexDirection:'column', gap:6, fontSize:13, padding:'6px 0', borderBottom:'1px solid var(--border-subtle)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tpl.title}</span>
                    {ehHigienizacao ? (
                      <span title={travada.motivo} style={{ fontSize:11, color:'var(--text-secondary)', fontStyle:'italic', flexShrink:0, maxWidth:230, textAlign:'right' }}>
                        fixa em {catMeta(CATEGORIA_COM_COMPORTAMENTO).label} — organizada por setor
                      </span>
                    ) : (
                      <select value={atual} onChange={(e) => setCats((p) => ({ ...p, [tpl.id]: e.target.value }))}
                        style={{ width:190, flexShrink:0, fontSize:12, padding:'5px 8px' }}>
                        {destinos.map((c) => (
                          <option key={c} value={c}>{labels[c]?.trim() || catMeta(c).label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {/* Segunda linha só pra quem está sendo movido PRA Higienização:
                      lá a aba é o SETOR, não a categoria — sem escolher um, a
                      planilha ficaria fora de todos os filtros. */}
                  {vaiPraHigienizacao && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, paddingLeft:12 }}>
                      <span style={{ fontSize:11, color:'var(--text-secondary)', flexShrink:0 }}>↳ em qual setor:</span>
                      <select value={modoNova ? '__nova__' : setorAtual}
                        onChange={(e) => escolherSetor(tpl.id, e.target.value)}
                        style={{ width:190, flexShrink:0, fontSize:12, padding:'5px 8px' }}>
                        <option value="">Escolha o setor…</option>
                        {setoresExistentes.map((s) => <option key={s} value={s}>{s}</option>)}
                        <option value="__nova__">+ Criar aba nova…</option>
                      </select>
                      {modoNova && (
                        <input value={setorAtual} placeholder="Nome da aba nova"
                          onChange={(e) => setSetores((p) => ({ ...p, [tpl.id]: e.target.value }))}
                          style={{ flex:1, minWidth:0, fontSize:12, padding:'5px 8px' }} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize:11, color:'var(--text-secondary)', marginTop:6, marginBottom:0 }}>
            As 21 planilhas que já nascem em {catMeta(CATEGORIA_COM_COMPORTAMENTO).label} não mudam de aba: o setor de cada uma vem do título dela, e fora dessa aba o filtro por setor deixaria de funcionar. Qualquer outra planilha pode ir pra lá — basta dizer em qual setor ela entra (ou criar uma aba nova pra ela).
          </p>
        </section>

        <section>
          <h3 style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', marginBottom:8 }}>Nome, frequência e descrição de cada planilha</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {ordenadas.map((tpl) => {
              const m = meta[tpl.id] ?? {};
              const tituloTravado = podeEditarTitulo(tpl);
              const freqAtual = m.frequency ?? tpl.frequency;
              const mudouFreq = freqAtual !== tpl.frequency;
              return (
                <div key={tpl.id} style={{ display:'flex', flexDirection:'column', gap:5, paddingBottom:10, borderBottom:'1px solid var(--border-subtle)' }}>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {tituloTravado.ok ? (
                      <input value={m.title ?? ''} placeholder={tpl.title}
                        onChange={(e) => setMeta((p) => ({ ...p, [tpl.id]: { ...(p[tpl.id] ?? {}), title: e.target.value } }))}
                        style={{ flex:1, minWidth:0, padding:'7px 10px', fontSize:13, fontWeight:600 }} />
                    ) : (
                      <span title={tituloTravado.motivo} style={{ flex:1, minWidth:0, fontSize:13, fontWeight:600, color:'var(--text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {tpl.title} <span style={{ fontSize:10, fontStyle:'italic' }}>· nome fixo</span>
                      </span>
                    )}
                    <select value={freqAtual}
                      onChange={(e) => setMeta((p) => ({ ...p, [tpl.id]: { ...(p[tpl.id] ?? {}), frequency: e.target.value } }))}
                      style={{ width:130, flexShrink:0, fontSize:12, padding:'6px 8px' }}>
                      {FREQUENCIAS.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
                    </select>
                  </div>
                  <input value={m.description ?? ''} placeholder={tpl.description || 'Descrição (opcional)'}
                    onChange={(e) => setMeta((p) => ({ ...p, [tpl.id]: { ...(p[tpl.id] ?? {}), description: e.target.value } }))}
                    style={{ width:'100%', padding:'6px 10px', fontSize:12, color:'var(--text-secondary)' }} />
                  {mudouFreq && (
                    <span style={{ fontSize:11, color:'var(--amber)' }}>
                      Muda o período a partir de agora. O que já foi preenchido continua no histórico com a frequência antiga.
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize:11, color:'var(--text-secondary)', marginTop:6, marginBottom:0 }}>
            Deixe em branco para voltar ao texto original. As planilhas de {catMeta(CATEGORIA_COM_COMPORTAMENTO).label} têm o nome fixo — o setor de cada uma vem dele — mas frequência e descrição você pode ajustar.
          </p>
        </section>

        {/* Fica ACIMA dos botões (não some junto com o modal): quando a
            gravação local falha, `onSave` não fecha mais o modal — a pessoa
            continua vendo o que escolheu, com o motivo à vista, em vez de a
            reorganização desaparecer em silêncio no próximo reload. */}
        {error && (
          <div role="alert" className="submission danger" style={{ marginBottom:10, fontSize:12 }}>
            ✕ {error}
          </div>
        )}

        {/* Trava explícita em vez de deixar salvar e a planilha sumir: sem
            setor ela não entra em nenhum filtro da aba de Higienização. */}
        {semSetor.length > 0 && (
          <div role="alert" className="submission warn" style={{ marginBottom:10, fontSize:12 }}>
            Escolha o setor de {semSetor.length === 1 ? '"' + semSetor[0].title + '"' : semSetor.length + ' planilhas'} antes de salvar — sem isso {semSetor.length === 1 ? 'ela ficaria' : 'elas ficariam'} fora de todos os filtros da aba {catMeta(CATEGORIA_COM_COMPORTAMENTO).label}.
          </div>
        )}

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:'var(--r)', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'var(--font)' }}>Cancelar</button>
          <button onClick={() => onSave({ categoryLabels: labels, templateCategory: cats, templateMeta: meta, templateSector: setores })}
            disabled={semSetor.length > 0}
            style={{ flex:2, padding:'10px', borderRadius:'var(--r)', border:'none', background: semSetor.length > 0 ? 'var(--border)' : 'var(--primary)', color:'white', cursor: semSetor.length > 0 ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:700, fontFamily:'var(--font)' }}>
            Salvar organização
          </button>
        </div>
      </div>
    </div>
  );
}

export function templateSector(tpl) {
  if (tpl?.category !== 'higienizacao') return null;
  // Setor escolhido à mão vence o título (v1.9.189): é assim que uma planilha
  // que não segue o padrão de nome "Higienização — X" — ex.: "Lavagem do
  // Filtro de Café" — consegue aparecer numa aba de setor sem ser renomeada.
  // `setorPref` é posto por applyCategoryPrefs a partir das prefs da loja.
  const escolhido = String(tpl?.setorPref ?? '').trim();
  if (escolhido) return escolhido;
  const i = (tpl.title ?? '').indexOf('—');
  return i < 0 ? null : tpl.title.slice(i + 1).trim() || null;
}

const TPL_CD_HIG = [
  higSetor('7fc7a778-49ee-4a67-a4a0-0f9f5889ba59','camaras','Câmaras',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Prateleiras','S'],['Portas','M'],
    ['Tela milimétrica','S'],['Ultracongelador U.1','S'],['Climática C.1','S'],
    ['Câmara de refrigeração C.1','S'],['Câmara de congelamento C.2','S'],
  ]),
  higSetor('567dee3b-f84d-4454-908f-4728e38a852c','fornos','Fornos',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Coifa','S'],
    ['Forno 01','S'],['Forno 02','S'],['Forno 03','S'],['Forno 04','S'],
    ['Fogão','S'],['Bancada de apoio','S'],['Carrinho de apoio','S'],
    ['Pasto chef 01','S'],['Pasto chef 02','S'],['Liquidificador','S'],
    ['Pia de apoio','S'],['Janela','Q'],['Tela milimétrica','S'],['Climática','S'],
    ['iVario (panela rational)','S'],
  ]),
  higSetor('77f9f2d2-77b4-4fec-a392-763e7b91b9ea','padaria','Padaria',[
    ['Bancada refrigerada R.1','S'],['Refrigerador R.2','S'],['Ultra U.1','S'],
    ['Modeladora / Divisoras','S'],['Laminadora','S'],['Boleadora / Prensa','S'],
    ['Carrinho de farinha','S'],['Bancada de apoio 01','S'],['Bancada de apoio 02','S'],
    ['Bancada de apoio 03','S'],['Climática C.2','S'],['Climática C.3','S'],
    ['Prateleiras','S'],['Batedeiras','S'],
  ]),
  higSetor('73022bc1-033d-4b6e-8fd4-7a64e22646aa','confeitaria','Confeitaria',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Prateleira','S'],['Carrinho de apoio','S'],
    ['Bancadas','S'],['Batedeiras industriais','S'],['Carrinho de farinha','S'],
    ['Carrinho de açúcar','S'],['Balança 01','S'],['Balança 02','S'],
    ['Liquidificadores','S'],['Micro-ondas','S'],['Batedeiras','S'],
    ['Máquina de gomo','S'],['Pia de apoio','S'],['Ar condicionado','S'],['Pia','S'],
    ['Sifão','S'],['Portas','M'],['Freezer F.1','Q'],['Ultracongelador U.2','S'],
    ['Refrigerador vertical R.2','S'],['Refrigerador vertical R.3','S'],
    ['Refrigerador vertical 2 portas R.4','S'],['Refrigerador vertical 2 portas R.5','S'],
    ['Bancada refrigerada R.6','S'],['Bancada refrigerada R.7','S'],
  ]),
  higSetor('05eeeb97-375a-444b-8fec-14352d31a5b0','embalagens','Embalagens',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Bancada','S'],['Balança','S'],
    ['Prateleira','S'],['Bancada de apoio','S'],
  ]),
  higSetor('1faa3e5f-453b-46e1-a414-584401a64c2d','salgados','Salgados',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Luminária','M'],['Porta','M'],
    ['Cilindro','S'],['Ralo','S'],['Ar condicionado','S'],['Freezer F.8','Q'],
    ['Refrigerador R.12','S'],['Bancada refrigerada R.13','S'],
  ]),
  higSetor('0b7ffa18-d2dd-4b90-9da9-93a411825f61','sanduiches','Sanduíches',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Porta','M'],['Fatiadora','S'],
    ['Lixeira','D'],['Prateleiras','D'],
  ]),
  higSetor('e6ea58dd-2155-4c24-aaff-be5ea7c78fc7','hig-producao','Higienização Produção',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Luminárias','M'],['Rodapé','S'],
    ['Ralos','S'],['Portas','S'],['Prateleiras','S'],['Lavar louças','S'],['Carrinhos','S'],
  ]),
  higSetor('d87793a8-06a5-48e2-8b3e-a9505688a506','gelateria','Gelateria',[
    ['Piso','S'],['Parede','S'],['Teto','S'],['Micro-ondas','S'],['Maturação','S'],
    ['Pasteurização','S'],['Prateleiras','S'],['Balança','S'],['Janela','M'],
    ['Tela milimétrica','S'],['Pia','S'],['Bancadas','S'],['Lixeira','S'],['Ralo','S'],
    ['Banho maria','S'],['Produtora pro 4 (bater os gelatos)','S'],
    ['Ultracongelador U.3','S'],['Congelador vertical F.3','Q'],
    ['Bancada congelada F.4','Q'],['Bancada refrigerada R.10','S'],
  ]),
  higSetor('7178f54b-6064-4cc0-a97f-f0c207283452','picoles','Produção de Picolés',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Produtora','S'],['Banho maria','S'],
    ['Turbo 8','S'],['Prateleiras','S'],['Ralo','S'],['Lixeira','S'],['Pias','S'],
    ['Ar condicionado','S'],['Freezer horizontal F.5','Q'],['Freezer horizontal F.6','Q'],
    ['Freezer 2 portas vertical F.7','Q'],
  ]),
  higSetor('7ba47f37-24af-47ef-9bfc-68d2ab003371','atend-gelatos','Atendimento Gelatos',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Expositor','S'],['Armários','S'],
    ['Vitrine congelada V.3','S'],['Vitrine congelada V.4','S'],
    ['Cascata chocomix CM.1','S'],['Cascata chocomix CM.2','S'],
  ]),
  higSetor('4b7b2863-57e6-4122-ae7e-8ab1fb9b9b27','ilha-sobremesas','Ilha de Sobremesas',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Expositor','S'],['Lixeira','S'],
    ['Prateleiras','S'],['Porta vai e vem','M'],['Armários','S'],['Balança','S'],
    ['Vitrine refrigerada V.5','S'],['Vitrine refrigerada V.6','S'],
    ['Vitrine refrigerada V.7','S'],['Vitrine refrigerada V.8','S'],
  ]),
  higSetor('83f2ef8d-6344-4d44-848d-072a8352893e','paes-cafe','Atendimento Pães e Café',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Forno de salgados 1','S'],
    ['Forno de pizzas','S'],['Carrinho','S'],['Máquina de fatiar pão','S'],
    ['Balanças','S'],['Armários','S'],['Prateleiras','S'],['Bancadas','S'],
    ['Utensílios','S'],['Porta vai e vem','M'],['Cafeteira','S'],
    ['Forno de salgados 2','S'],['Lixeiras','S'],['Máquina de lavar','S'],
    ['Vitrine refrigerada V.1','S'],['Vitrine aquecida V.2','S'],
    ['Bancada refrigerada R.8','S'],['Bancada refrigerada R.9','S'],
    ['Bancada congelada F.2','Q'],['Máquina de laranja','S'],
  ]),
  higSetor('fe7e72f0-2d33-47f8-a7a5-782061185116','encomendas','Encomendas',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Lixeira','S'],['Prateleiras','S'],
    ['Porta de correr','M'],['Armários','S'],['Balança','S'],
    ['Refrigerador 3 portas R.11','S'],
  ]),
  higSetor('7e17b24b-2c06-4046-b50d-ca656e8cbda8','bistro','Bistrô',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Fogões','S'],['Chapas','S'],
    ['Fritadeira 01','S'],['Fritadeira 02','S'],['Forno combinado','S'],
    ['iVario (panela rational)','S'],['Pia de apoio','S'],['Forno','S'],
    ['Char broiller','S'],['Prateleira','S'],['Bancada','S'],
    ['Elevador','S'],['Laminadora','S'],['Batedeira','S'],['Forno 01','S'],['Forno 02','S'],
    ['Refrigerador vertical 2 portas R.14','S'],['Refrigerador vertical R.15','S'],
    ['Freezer vertical 2 portas F.9','Q'],['Freezer vertical 2 portas F.10','Q'],
    ['Refrigerador vertical 2 portas R.16','S'],['Refrigerador vertical 4 portas R.17','S'],
    ['Ultracongelador U.4','S'],['Bancada refrigerada R.18','S'],
    ['Bancada refrigerada R.19','S'],['Pista fria P.1','S'],['Pista fria P.2','S'],
  ]),
  higSetor('1868768c-721a-4cec-b062-37ea6f8f9955','refeitorio','Refeitório',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Geladeira R.12','S'],['Banho maria BM.1','S'],
  ]),
  higSetor('979e3f8a-41e5-495e-9519-63597a28d78f','lavagem','Área de Lavagem',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Pia','S'],['Ralo','S'],['Lixeiras','S'],
    ['Prateleiras','S'],['Bancada Sifão','S'],['Máquina de lavar louça','S'],
    ['Carrinhos','S'],['Batedeira','S'],['Pia de higienização de mãos','S'],['Portas','S'],
  ]),
  higSetor('73463e76-cb88-424a-90bd-5b6443046576','lavagem-bistro','Área de Lavagem — Bistrô',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Pia de lavagem 01','D'],
    ['Pia de lavagem 02','D'],['Lixeira','D'],['Bancada','D'],
    ['Máquina de lavar louça','D'],['Sifão','S'],['Caixa de gordura','X'],
  ]),
  higSetor('0859145f-11b0-419e-add3-b2ee25b079d4','lixeiras','Lixeiras, Escadas e Vidraças',[
    ['Lixeiras de rejeito','S'],['Lixeiras de orgânico','S'],
    ['Lixeiras de recicláveis','Q'],['Lixeiras inox','Q'],['Vidraças / corrimão','Q'],
    ['Escadas / rodapé 1','S'],['Escadas / rodapé 2','S'],
    ['Cadeiras plásticas colaboradores','M'],['Bancos plásticos colaboradores','M'],
  ]),
  higSetor('fd001de5-2b6a-41cb-9a80-7704ecd427f5','vestiario','Vestiário / DML',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Ralos','S'],['Armários','S'],
    ['Tanque','S'],['Mops','S'],['Portas','S'],
  ]),
  higSetor('9291bdc9-bf1a-4a26-a919-6a19e7bcee3f','estoque-seco','Estoque Seco',[
    ['Piso','S'],['Parede','M'],['Teto','M'],['Prateleiras','S'],['Ralos','S'],
    ['Carrinho de farinha','S'],['Luminária','M'],['Ar condicionado','S'],
  ]),
];

function seedTemplates(tenant) {
  const id = (tenant.id ?? '').toLowerCase();
  const name = (tenant.name ?? '').toLowerCase();
  // TPL_RESERVATORIO vai pra TODAS as lojas: a exigência da RDC 216 §4.4 não
  // depende do segmento — quem tem reservatório de água precisa comprovar a
  // higienização semestral, e isso é toda cozinha industrial.
  if (id.includes('swiss'))                          return [TPL_HIGIENE_PESSOAL(), TPL_VETORES('C=Cozinha D=Distribuição S=Salão E=Externa'), TPL_DEDETIZACAO(), TPL_FAXINA_SWISS(), TPL_RESERVATORIO(tenant.id)];
  if (id.includes('backerei')||id.includes('bäck')) return [TPL_HIGIENE_PESSOAL(), TPL_VETORES(), TPL_DEDETIZACAO(), TPL_FAXINA_BACKEREI(), TPL_POTABILIDADE(), TPL_RESERVATORIO(tenant.id)];
  if (id.includes('dbk'))                            return [TPL_FAXINA_DBK(), TPL_MANUTENCAO_DBK(), TPL_VETORES(), TPL_RESERVATORIO(tenant.id)];
  if (id.includes('bf245c3b') || name.includes('casa doce')) return [
    TPL_CASADOCE_BANHEIROS(), TPL_CD_HORTIFRUTI(), TPL_CD_FILTRO_CAFE(), TPL_CD_RESIDUOS(),
    TPL_CD_CARRINHOS(), TPL_CD_CLIMATIZACAO(), TPL_CD_MANUT_PROG(), TPL_CD_CALIBRACAO(),
    TPL_CD_HIGIENE(), TPL_CD_VETORES(), TPL_CD_DEDETIZACAO(), TPL_RESERVATORIO(tenant.id),
    ...TPL_CD_HIG.map((mk) => mk()),
  ];
  return [TPL_HIGIENE_PESSOAL(), TPL_VETORES(), TPL_DEDETIZACAO(), TPL_RESERVATORIO(tenant.id)];
}

// ─── Field components ──────────────────────────────────────────────────────

function CNCButton({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:6 }}>
      {['C','NC',''].map((opt) => {
        const on = value===opt;
        const [bg,color,border] = opt==='C' ? ['#dafbe1','#00a35c','#4ac26b'] : opt==='NC' ? ['#ffebe9','#c0392b','#ff8182'] : ['#f9fbfa','#5c6c7a','#c1ccd6'];
        return (
          <button key={opt||'x'} onClick={() => onChange(on?'':opt)}
            style={{ padding:'5px 14px', borderRadius:6, border:`1.5px solid ${on?border:'#c1ccd6'}`, background:on?bg:'white', color:on?color:'#5c6c7a', fontWeight:on?700:500, fontSize:12, cursor:'pointer', transition:'all .12s' }}>
            {opt||'—'}
          </button>
        );
      })}
    </div>
  );
}

// Bug real de produção (CASA DOCE, 10/08): com `value={}` de default, o botão
// mostrava "Sem ocorrência" já com a cara de "respondido" ANTES de qualquer
// toque — completionPct ficava em 0%/57% mesmo com a planilha "toda
// preenchida" na tela, porque `responses[field.id]` continuava `undefined`.
// `isPresenceAnswered` distingue "nunca tocado" de "respondido: sem
// ocorrência" — os dois botões ficam neutros até um clique real escolher um.
export function isPresenceAnswered(value) {
  return value !== undefined && value !== null;
}

function PresenceField({ value, onChange }) {
  const answered = isPresenceAnswered(value);
  const detected = value?.detected ?? false;
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
      <button onClick={() => onChange({ ...value, detected:false })}
        style={{ padding:'5px 14px', borderRadius:6, border:`1.5px solid ${answered && !detected?'#4ac26b':'#c1ccd6'}`, background:answered && !detected?'#dafbe1':'white', color:answered && !detected?'#00a35c':'#5c6c7a', fontWeight:answered && !detected?700:500, fontSize:12, cursor:'pointer' }}>
        ✓ Sem ocorrência
      </button>
      <button onClick={() => onChange({ ...value, detected:true })}
        style={{ padding:'5px 14px', borderRadius:6, border:`1.5px solid ${answered && detected?'#ff8182':'#c1ccd6'}`, background:answered && detected?'#ffebe9':'white', color:answered && detected?'#c0392b':'#5c6c7a', fontWeight:answered && detected?700:500, fontSize:12, cursor:'pointer' }}>
        ✕ Detectado
      </button>
      {answered && detected && (
        <input value={value?.location??''} onChange={(e) => onChange({ ...value, location:e.target.value })}
          placeholder="Local" style={{ width:130, padding:'5px 8px', borderRadius:6, border:'1px solid #c1ccd6', fontSize:12, fontFamily:'inherit' }} />
      )}
    </div>
  );
}

// 1 toque carimba hoje + quem está registrando (quickSign) — o caso comum.
// "Editar" abre os campos crus pra exceção real: tarefa feita por outra
// pessoa, ou em outro dia (preenchimento retroativo).
function DateSigField({ value={}, onChange, currentName }) {
  const [editing, setEditing] = useState(false);
  const done = Boolean(value?.date || value?.sig);

  if (done && !editing) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:20, background:'#dafbe1', border:'1px solid #4ac26b', color:'#00a35c', fontSize:12, fontWeight:700 }}>
          ✓ {value.date ? value.date.split('-').reverse().join('/') : '—'} · {value.sig || '—'}
        </span>
        <button type="button" onClick={() => setEditing(true)} className="ghost-action" style={{ fontSize:11, padding:'2px 8px' }}>Editar</button>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <button type="button" onClick={() => { onChange(quickSign(currentName)); setEditing(false); }}
          style={{ padding:'6px 14px', borderRadius:8, border:'1.5px solid #4ac26b', background:'#dafbe1', color:'#00a35c', fontWeight:700, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
          ✓ Feito agora{currentName ? ` — ${currentName}` : ''}
        </button>
        {!editing && <button type="button" onClick={() => setEditing(true)} className="ghost-action" style={{ fontSize:11 }}>Outra pessoa / outro dia</button>}
        {editing && <button type="button" onClick={() => setEditing(false)} className="ghost-action" style={{ fontSize:11 }}>Fechar</button>}
      </div>
      {editing && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <input type="date" value={value?.date??''} onChange={(e) => onChange({ ...value, date:e.target.value })}
            style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #c1ccd6', fontSize:12, fontFamily:'inherit' }} />
          <input value={value?.sig??''} onChange={(e) => onChange({ ...value, sig:e.target.value })}
            placeholder="Responsável" style={{ flex:1, minWidth:120, padding:'5px 8px', borderRadius:6, border:'1px solid #c1ccd6', fontSize:12, fontFamily:'inherit' }} />
        </div>
      )}
    </div>
  );
}

// ─── Form Fill ─────────────────────────────────────────────────────────────

function FormFill({ template, record, onSave, onBack, session, tenant, rotuloCategoria }) {
  const respostasIniciais = useRef(record?.responses ?? {});
  const [responses, setResponses] = useState(() => respostasIniciais.current);
  const [saving, setSaving] = useState(false);
  // Ancorado na criação do registro, não em "agora": sem isto, isFieldDue
  // muda de ideia conforme os dias passam com a MESMA folha ainda aberta —
  // quem preenche domingo e volta terça pra continuar (mesmo periodKey, mesmo
  // registro) via a tarefa mensal/quinzenal já respondida SUMIR da tela, e o
  // percentual andar pra TRÁS (o campo sai do numerador e do denominador ao
  // mesmo tempo). O valor em si não se perde — continua em `responses`,
  // salvo e no PDF — só a lista visível ficava instável. Registro novo
  // (`record` ainda null, primeiro acesso ao período) não tem o que ancorar:
  // usa "agora" mesmo, idêntico ao comportamento de sempre. Achado da
  // auditoria (18/08).
  const anchorNow = record?.createdAt ? new Date(record.createdAt) : new Date();
  const pct = completionPct(template, { responses }, anchorNow);

  const setField = (id, val) => setResponses((prev) => ({ ...prev, [id]:val }));

  // "← Voltar" e "Confirmar preenchimento" terminam na MESMA tela (a lista) —
  // handleSave também chama setFilling(null). Sem aviso, voltar por reflexo
  // no meio do preenchimento é indistinguível de ter salvado: nenhuma tela
  // denuncia que a planilha inteira (evidência RDC) acabou de ser descartada.
  // Achado da auditoria de 18/08. `window.confirm` é o padrão já usado nesta
  // mesma função pra "menos de 100%" — não é UI nova.
  const temAlteracaoNaoSalva = JSON.stringify(responses) !== JSON.stringify(respostasIniciais.current);
  const voltar = () => {
    if (temAlteracaoNaoSalva && !window.confirm('Sair sem salvar? O que foi preenchido nesta planilha será perdido.')) return;
    onBack();
  };

  const handleSave = async (status) => {
    // Antes dava pra "Confirmar preenchimento" com 7% e o card virava
    // Concluído verde na grade — o pct exige só >0, não 100. Rascunho não
    // pede confirmação: é exatamente pra deixar pela metade mesmo.
    if (status === 'submitted' && pct < 100) {
      const proceed = window.confirm(`A planilha está ${pct}% preenchida. Confirmar mesmo assim?`);
      if (!proceed) return;
    }
    setSaving(true);
    await onSave({ responses, status });
    setSaving(false);
  };

  const handlePDF = () => {
    const rec = { ...record, responses, updatedAt:new Date().toISOString(), user:session?.user?.name??'—', role:session?.user?.role??'' };
    const win = window.open('','_blank');
    // window.open devolve null com pop-up bloqueado (padrão no Safari/iOS, PWA
    // em modo standalone) — sem a guarda, o write seguinte estourava TypeError
    // dentro do onClick, sem error boundary que pegue: o toque não fazia nada
    // visível. Mesma guarda que reports-views.jsx/maintenance.jsx já usam.
    // Achado da auditoria (19/08).
    if (!win) {
      window.alert('Não foi possível abrir a janela de impressão — o navegador pode estar bloqueando pop-ups. Libere pop-ups para este site e toque em "↓ Exportar PDF" de novo.');
      return;
    }
    win.document.write(generateFormPDF(template, rec, tenant, rotuloCategoria));
    win.document.close();
    setTimeout(() => win.print(), 400);
  };

  return (
    <div className="form-fill-view">
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button className="ghost-action" onClick={voltar} style={{ padding:'6px 10px' }}>← Voltar</button>
        <div style={{ flex:1 }}>
          <span className="eyebrow">{freqLabel(template.frequency)} · {rotuloCategoria ?? catMeta(template.category).label}</span>
          <h2 style={{ fontSize:18, fontWeight:800, letterSpacing:'-.03em', marginTop:2 }}>{template.title}</h2>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:24, fontWeight:800, fontFamily:'var(--mono)', color:pct===100?'var(--green)':'var(--text)' }}>{pct}%</div>
          <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'.05em' }}>preenchido</div>
        </div>
      </div>

      <div style={{ height:4, background:'var(--border-subtle)', borderRadius:2, marginBottom:24, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:pct===100?'var(--green)':'var(--blue)', borderRadius:2, transition:'width .3s' }} />
      </div>

      {template.sections.map((sec) => (
        <div key={sec.id} style={{ marginBottom:24 }}>
          {template.sections.length>1 && (
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--text-secondary)', marginBottom:12, paddingBottom:8, borderBottom:'1px solid var(--border-subtle)' }}>{sec.title}</div>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {dueFields(sec.fields, template.frequency, anchorNow).map((field) => (
              <div key={field.id} className="form-field-row">
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{field.label}</div>
                  {field.hint && <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>{field.hint}</div>}
                </div>
                <div>
                  {field.type==='cnc'      && <CNCButton value={responses[field.id]??''} onChange={(v) => setField(field.id,v)} />}
                  {field.type==='presence' && <PresenceField value={responses[field.id]} onChange={(v) => setField(field.id,v)} />}
                  {field.type==='date_sig' && <DateSigField value={responses[field.id]} onChange={(v) => setField(field.id,v)} currentName={session?.user?.name} />}
                  {field.type==='date'     && <input type="date" value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)} style={{ padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit' }} />}
                  {field.type==='number'   && <input type="number" inputMode="decimal" value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)} placeholder="0" style={{ width:120, padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit', fontVariantNumeric:'tabular-nums' }} />}
                  {field.type==='checkbox' && <label style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}><input type="checkbox" checked={responses[field.id]===true} onChange={(e) => setField(field.id,e.target.checked)} style={{ width:18, height:18, accentColor:'var(--primary)' }} /> Marcar</label>}
                  {field.type==='text'     && <textarea value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)} placeholder="Observações…" style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit', resize:'vertical', minHeight:54 }} />}
                  {/* Lista fechada (setor, qual banheiro…). Texto livre aqui
                      geraria "Padaria"/"padaria"/"Padria" e inviabilizaria
                      filtrar o histórico por setor depois. */}
                  {field.type==='select'   && (
                    <select value={responses[field.id]??''} onChange={(e) => setField(field.id,e.target.value)}
                      style={{ padding:'7px 10px', borderRadius:8, border:'1px solid var(--border)', fontSize:13, fontFamily:'inherit', minWidth:200 }}>
                      <option value="">Selecione…</option>
                      {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                  {field.type==='photo'    && (
                    <PhotoField value={responses[field.id]} onChange={(v) => setField(field.id,v)}
                      tenantId={tenant?.id} formId={template.id} periodKey={record?.periodKey ?? 'sem-periodo'} fieldId={field.id} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ display:'flex', gap:8, paddingTop:16, borderTop:'1px solid var(--border-subtle)', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap' }}>
        <button className="secondary-action" onClick={handlePDF} style={{ fontSize:12 }}>↓ Exportar PDF</button>
        <div style={{ display:'flex', gap:8 }}>
          <button className="secondary-action" onClick={() => handleSave('draft')} disabled={saving}>Salvar rascunho</button>
          <button className={`primary-action${pct>0?' attention':''}`} onClick={() => handleSave('submitted')} disabled={saving||pct===0}>
            {saving?'Salvando…':'Confirmar preenchimento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RT Validation Panel ───────────────────────────────────────────────────

// "Recentemente validadas pelo RT": sem ordenar por r.validation.at, um
// slice(0,10) cru pegava os 10 PRIMEIROS na ordem do array — que não é ordem
// de validação nem de data. `handleValidate` usa `.map` (preserva posição) e
// registro novo entra no FIM (`[...prev, up]`); num aparelho recém-
// sincronizado a ordem vem de `created_at.desc` do Supabase. Com 10+
// validações no acervo, a assinatura que a RT ACABOU de fazer nunca entrava
// nesse card — e a MESMA loja mostrava listas diferentes em devices
// diferentes. Achado da auditoria (18/08).
export function recentlyValidated(records, limit = 10) {
  return records
    .filter((r) => r.validation)
    .slice()
    .sort((a, b) => new Date(b.validation.at) - new Date(a.validation.at))
    .slice(0, limit);
}

function RTValidationPanel({ records, templates, onValidate, session }) {
  const [validatingId, setValidatingId] = useState(null);
  const [note, setNote] = useState('');

  const pending = records.filter((r) => r.status==='submitted' && !r.validation);
  const validated = recentlyValidated(records);

  const confirm = (record) => {
    onValidate(record.id, {
      by:   session?.user?.name ?? 'RT',
      role: session?.user?.role ?? 'Nutricionista RT',
      at:   new Date().toISOString(),
      note: note.trim(),
    });
    setValidatingId(null); setNote('');
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <article className="management-card">
        <div className="card-head">
          <div><span className="eyebrow">Aguardando RT</span><h2>Planilhas para validar</h2></div>
          {pending.length>0 && <span className="badge warn">{pending.length}</span>}
        </div>
        <div className="equipment-maintenance-list">
          {pending.length===0
            ? <p className="muted" style={{ padding:'20px' }}>✓ Nenhuma planilha aguardando validação.</p>
            : pending.map((rec) => {
              const tpl = templates.find((t) => t.id===rec.formId);
              const meta = catMeta(rec.category);
              return (
                <div key={rec.id} style={{ padding:'12px 20px', borderBottom:'1px solid var(--border-subtle)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
                    <div>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                        <strong style={{ fontSize:13 }}>{rec.formTitle}</strong>
                        <span className="badge subtle" style={{ background:meta.bg, color:meta.color, borderColor:'transparent' }}>{meta.label}</span>
                      </div>
                      <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
                        {formatPeriodLabel(rec.frequency, rec.periodKey)} · Preenchido por {rec.user} · {new Date(rec.updatedAt).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <button className="primary-action" style={{ fontSize:12, padding:'6px 12px' }} onClick={() => setValidatingId(validatingId===rec.id?null:rec.id)}>
                      {validatingId===rec.id ? 'Cancelar' : 'Validar'}
                    </button>
                  </div>
                  {validatingId===rec.id && (
                    <div style={{ marginTop:10, display:'flex', gap:8, alignItems:'flex-end' }}>
                      <label style={{ flex:1 }}>Observação (opcional)
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comentário do RT…" style={{ minHeight:48, marginTop:4, padding:'6px 8px', borderRadius:8, border:'1px solid var(--border)', fontSize:12, fontFamily:'inherit', width:'100%', resize:'vertical' }} />
                      </label>
                      <button className="primary-action attention" onClick={() => confirm(rec)} style={{ fontSize:12, padding:'8px 16px', whiteSpace:'nowrap' }}>✓ Assinar e validar</button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </article>

      {validated.length>0 && (
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Histórico</span><h2>Recentemente validadas pelo RT</h2></div></div>
          <div className="equipment-maintenance-list">
            {validated.map((rec) => {
              const meta = catMeta(rec.category);
              return (
                <div key={rec.id} className="equipment-maintenance-row">
                  <div>
                    <strong>{rec.formTitle}</strong>
                    <span>{formatPeriodLabel(rec.frequency, rec.periodKey)} · {rec.user}</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                    <span className="badge ok">✓ Validado por {rec.validation.by}</span>
                    <span style={{ fontSize:10, color:'var(--text-secondary)' }}>{new Date(rec.validation.at).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}
    </div>
  );
}

// Aviso rápido depois de "Salvar rascunho"/"Confirmar preenchimento". Sem
// ele, as duas ações fechavam a tela e chegavam na MESMA grade que "←
// Voltar" descartando chegaria — zero toast, zero faixa verde. Numa grade de
// 36 cards (CASA DOCE) a única pista de que salvou era o badge do card
// certo, que exige achar o card entre os 36 depois de a página voltar pro
// topo. Achado da auditoria (18/08) — vale pro preenchimento normal e pro
// modo quiosque (kiosk.jsx "Continuar depois" chama onSave e depois onExit).
export function saveFlashMessage(templateTitle, status) {
  return status === 'submitted'
    ? `✓ "${templateTitle}" confirmada.`
    : `Rascunho de "${templateTitle}" salvo — continue quando quiser.`;
}

// ─── Main Forms View ───────────────────────────────────────────────────────

export function FormsView({ activeTenant, allTenants, onTenantChange, session }) {
  const isRT = ['Nutricionista RT','Administrador','Super-admin'].includes(session?.user?.role);

  const [templates, setTemplates] = useState(() => readFormTemplates(activeTenant));
  const [records,   setRecords]   = useState(() => readFormRecords(activeTenant.id));
  const [filling,   setFilling]   = useState(null);
  const [kioskForm, setKioskForm] = useState(null); // tablet mode for a specific form
  const [catFilter, setCatFilter] = useState('all');
  // Setor só existe dentro de Higienização (21 planilhas, uma por setor). Fica
  // em state separado e é ZERADO ao trocar de categoria — senão o filtro aponta
  // pra um setor que não existe na categoria nova e a grade some sem explicação
  // (mesma armadilha do filtro de setor dos equipamentos).
  const [sectorFilter, setSectorFilter] = useState('all');
  const pickCategory = (cat) => { setCatFilter(cat); setSectorFilter('all'); };
  const [histId,    setHistId]    = useState(null);
  const [tab,       setTab]       = useState('forms'); // 'forms' | 'validation'
  const [editingTpl, setEditingTpl] = useState(null);
  // Aviso de "salvei" depois de fechar o preenchimento — ver saveFlashMessage.
  // Autolimpa sozinho; não precisa de botão de fechar.
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  // Salva a planilha editada pela RT: state → localStorage (pelo efeito) e
  // nuvem. O push é o que faz a mudança chegar nos OUTROS aparelhos da loja —
  // até aqui pushFormTemplate existia no repository mas nunca era chamado, ou
  // seja, planilha nunca saía do device onde foi editada.
  const salvarTemplate = useCallback((novo) => {
    setTemplates((prev) => prev.map((t) => t.id === novo.id ? novo : t));
    setEditingTpl(null);
    import('./repository').then(m => m.pushFormTemplate(activeTenant.id, novo)).catch(() => {});
  }, [activeTenant.id]);

  const [importOpen, setImportOpen] = useState(false);
  // Planilha nova (não edição) — pushFormTemplate já trata insert vs update
  // pelo id não existir ainda em `existing` (repository.js).
  const criarTemplate = useCallback((novo) => {
    setTemplates((prev) => [novo, ...prev]);
    setImportOpen(false);
    // Publicar com um filtro de categoria/setor diferente do da planilha nova
    // fazia o card sumir da grade — sem erro, sem toast — igual a ter tocado
    // "Cancelar". A RT concluía que a importação falhou e publicava de novo,
    // duplicando (cada publicação gera id novo, sem dedupe). Salta pro filtro
    // de onde a planilha está — mesmo fallback que salvarOrganizacao já usa
    // pra não deixar o filtro apontar pra um vazio. Achado da auditoria (19/08).
    pickCategory(novo.category);
    import('./repository').then(m => m.pushFormTemplate(activeTenant.id, novo)).catch(() => {});
  }, [activeTenant.id]);

  // De QUAL loja são os dados em memória. Sem esta marcação, os efeitos de
  // escrita abaixo (que têm activeTenant.id nas deps) rodavam no render da
  // TROCA de empresa — id JÁ é o novo, `templates`/`records` AINDA são da loja
  // anterior — e gravavam as planilhas de uma loja sob a chave da outra.
  // Terceira vez que esta classe de bug aparece (catálogo v1.9.71, equipe
  // v1.9.81); aqui contamina planilha E registro preenchido. Precisa ser state,
  // não ref: com ref o efeito leria o valor já atualizado e a checagem passaria.
  // Setor escolhido por card, pra planilhas com `scopeBy`. Fica na tela (não
  // persiste): é a via que a pessoa está preenchendo agora, não preferência.
  const [scopeSel, setScopeSel] = useState({});
  // Preferências de organização por loja (rótulo das abas + em qual aba cada
  // planilha aparece). Moram no blob do perfil, que já sincroniza.
  const [prefs, setPrefs] = useState(() => prefsFromProfile(readCompanyProfile(activeTenant.id)));
  const [organizando, setOrganizando] = useState(false);
  const [organizarError, setOrganizarError] = useState(null);
  const [formsTenant, setFormsTenant] = useState(activeTenant.id);
  useEffect(() => {
    setTemplates(readFormTemplates(activeTenant));
    setRecords(readFormRecords(activeTenant.id));
    setPrefs(prefsFromProfile(readCompanyProfile(activeTenant.id)));
    setFormsTenant(activeTenant.id);
    setFilling(null); setHistId(null); setFlash(null);
    pickCategory('all');
  }, [activeTenant.id]);

  // Relê quando o sync avisa — mesma correção dos 5 controles especiais
  // (v1.9.154). Sem isto a tela mostra o retrato do momento em que montou, e a
  // planilha preenchida em outro aparelho não aparece.
  //
  // NÃO relê enquanto alguém está preenchendo (`filling`): o sync chegando no
  // meio do preenchimento trocaria a lista sob os pés de quem digita.
  useEffect(() => {
    if (filling) return;
    const reler = () => {
      setTemplates(readFormTemplates(activeTenant));
      setRecords(readFormRecords(activeTenant.id));
      setPrefs(prefsFromProfile(readCompanyProfile(activeTenant.id)));
    };
    window.addEventListener(SYNC_EVENT, reler);
    return () => window.removeEventListener(SYNC_EVENT, reler);
  }, [activeTenant, filling]);

  useEffect(() => {
    if (formsTenant !== activeTenant.id) return;   // troca de loja em andamento
    // Mescla, não sobrescreve: o registro que o sync trouxe entre a montagem e
    // este "Confirmar preenchimento" era apagado do aparelho. Seguro aqui
    // porque registro de planilha só nasce ou é atualizado (upsert por
    // formId+periodKey) — esta tela nunca apaga nenhum.
    gravarMesclando(readFormRecords, writeFormRecords, activeTenant.id, records);
  }, [activeTenant.id, formsTenant, records]);
  useEffect(() => {
    if (formsTenant !== activeTenant.id) return;
    // Templates NÃO mesclam, de propósito. A limpeza de planilhas duplicadas
    // (Configurações → "Planilhas BPF duplicadas", v1.9.139) APAGA templates;
    // mesclar aqui ressuscitaria as cópias que ela acabou de remover. É a
    // mesma razão que deixou POPs de fora da correção dos controles.
    // O risco oposto — sobrescrever um template novo vindo do sync — se cura
    // no sync seguinte, porque syncModule funde nuvem→local por id.
    writeFormTemplates(activeTenant.id, templates);
  }, [activeTenant.id, formsTenant, templates]);

  const today = new Date();
  const getRecord = (tpl, pk) => records.find((r) => r.formId===tpl.id && r.periodKey===pk) ?? null;

  const handleSave = useCallback(({ responses, status }) => {
    if (!filling) return;
    const { template, periodKey } = filling;
    // O periodKey é capturado quando a planilha ABRE e nunca recalculado. Quem
    // começa 23:58 e confirma 00:03 gravava na folha de ONTEM — e como o save
    // faz upsert por (formId, periodKey), sobrescrevia a folha de ontem que já
    // estava preenchida. A DBK é unidade de produção e vira a noite.
    // Achado da auditoria (18/08).
    //
    // Não troco em silêncio: quem preencheu à meia-noite pode estar registrando
    // o turno que ACABOU. Pergunto, com os dois períodos escritos por extenso.
    const escopo = filling.escopo ?? null;
    const pkAgora = escopo
      ? makePeriodKey(template.frequency, new Date(), escopo)
      : getPeriodKey(template.frequency, new Date());
    let periodoFinal = periodKey;
    if (pkAgora !== periodKey) {
      const usarAgora = window.confirm(
        `A data virou enquanto você preenchia.\n\n` +
        `Esta planilha foi aberta em "${formatPeriodLabel(template.frequency, periodKey)}" ` +
        `e agora estamos em "${formatPeriodLabel(template.frequency, pkAgora)}".\n\n` +
        `OK = registrar no período ATUAL.\n` +
        `Cancelar = manter no período em que foi aberta.`
      );
      if (usarAgora) periodoFinal = pkAgora;
    }
    setRecords((prev) => {
      const ex = prev.find((r) => r.formId===template.id && r.periodKey===periodoFinal);
    const up = {
        id: ex?.id ?? uid(),
        tenantId: activeTenant.id, formId: template.id, formTitle: template.title,
        category: template.category, frequency: template.frequency, periodKey: periodoFinal,
        responses, status,
        user: session?.user?.name ?? 'Usuário', role: session?.user?.role ?? '',
        createdAt: ex?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      // Push to Supabase
      pushFormRecord(activeTenant.id, up);
      return ex ? prev.map((r) => r.id===ex.id?up:r) : [...prev, up];
    });
    setFilling(null);
    // "Salvar rascunho"/"Confirmar preenchimento" chegam na MESMA grade que
    // "← Voltar" descartando chegaria — sem isto, salvar e perder eram
    // visualmente idênticos. Ver saveFlashMessage.
    setFlash({ text: saveFlashMessage(template.title, status), at: Date.now() });
  }, [filling, activeTenant.id, session]);

  const handleValidate = useCallback((recordId, validation) => {
    setRecords((prev) => prev.map((r) => r.id===recordId ? { ...r, validation, updatedAt:new Date().toISOString() } : r));
  }, []);

  const pendingValidation = records.filter((r) => r.status==='submitted' && !r.validation).length;
  // As preferências entram AQUI, sobre a lista já lida do seed/cache — não
  // gravadas no template. Assim a planilha continua recebendo correções minhas
  // (o seed sobe de versão) sem perder a aba que a RT escolheu, e sem precisar
  // marcá-la como `custom`, que congelaria o conteúdo dela pra sempre.
  const templatesOrganizados = useMemo(() => applyCategoryPrefs(templates, prefs), [templates, prefs]);
  const byCategory = catFilter==='all' ? templatesOrganizados : templatesOrganizados.filter((t) => t.category===catFilter);
  const filteredTemplates = sectorFilter==='all'
    ? byCategory
    : byCategory.filter((t) => templateSector(t) === sectorFilter);
  const categories = [...new Set(templatesOrganizados.map((t) => t.category))];
  const rotuloCat = (cat) => catLabelFor(cat, prefs, catMeta(cat).label);

  const salvarOrganizacao = (novas) => {
    const padroes = Object.fromEntries(categories.map((c) => [c, catMeta(c).label]));
    const enxutas = enxugarPrefs(novas, padroes, templates);
    // Grava no blob do perfil (local + nuvem). readCompanyProfile devolve o
    // objeto inteiro, então CNPJ/alvará/resto seguem intactos — há teste disso
    // em form-prefs.test.js.
    const perfil = profileWithPrefs(readCompanyProfile(activeTenant.id), enxutas);
    // saveCompanyProfile devolve se a gravação local REALMENTE aconteceu (lw,
    // repository.js) — igual ao mesmo achado já corrigido em
    // settings.jsx/handleSaveProfile (auditoria, tier baixa, 19/08). Aqui
    // ficou de fora na hora: o retorno era descartado, `setPrefs`/fechar o
    // modal rodavam incondicionalmente. Com o storage cheio, a tela mostrava
    // a reorganização na hora (só estado do React) mas ela nunca chegava no
    // localStorage — reabrir "Organizar" (que relê do storage) trazia de
    // volta o valor antigo, sem nenhum aviso do motivo. Achado real de
    // cliente (RT da CASA DOCE, 20/08): duas planilhas presas em "Faxina"
    // sem conseguir mover, sintoma idêntico a este bug.
    const salvou = saveCompanyProfile(activeTenant.id, perfil);
    if (!salvou) {
      setOrganizarError('Não consegui salvar agora (armazenamento do aparelho cheio). A organização acima NÃO foi salva — libere espaço ou tente em outro aparelho antes de tentar de novo.');
      return;
    }
    setPrefs(enxutas);
    import('./repository').then((m) => m.pushCompanyProfile(activeTenant.id, perfil)).catch(() => {});
    setOrganizarError(null);
    setOrganizando(false);
    if (catFilter !== 'all' && !categories.includes(catFilter)) pickCategory('all');
  };
  // Setores da categoria em foco (só Higienização tem). Ordena em pt-BR pra
  // "Área de Lavagem" e "Câmaras" não caírem depois de "Vestiário" por acento.
  const sectors = [...new Set(byCategory.map(templateSector).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity:'base' }));

  if (kioskForm) {
    const { template, record, periodKey } = kioskForm;
    return (
      <FormKioskApp
        template={template}
        tenantId={activeTenant.id}
        tenantName={activeTenant.name}
        userName={session?.user?.name ?? '—'}
        userRole={session?.user?.role ?? ''}
        // `record` era lido aqui e nunca usado: o modo tablet sempre abria em
        // branco, e como o save faz upsert por (formId, periodKey) trocando
        // `responses` inteiro, abrir "📱 Tablet" numa planilha que já tinha
        // rascunho/preenchimento e confirmar APAGAVA o que existia — perda de
        // dado silenciosa numa folha semanal preenchida por várias pessoas.
        initialResponses={record?.responses}
        onExit={() => setKioskForm(null)}
        onSave={async (responses, status = 'submitted') => {
          const existing = records.find(r => r.formId === template.id && r.periodKey === periodKey);
          const updated = {
            id: existing?.id ?? crypto.randomUUID(),
            tenantId: activeTenant.id, formId: template.id, formTitle: template.title,
            category: template.category, frequency: template.frequency, periodKey,
            responses, status,
            user: session?.user?.name ?? '—', role: session?.user?.role ?? '',
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          // Sobe pro Supabase (enfileira se offline) — o handleSave normal já
          // faz isto (linha 649). Sem esta linha, a planilha BPF preenchida no
          // quiosque ficava SÓ no localStorage e sumia ao limpar o device:
          // perda silenciosa de registro de conformidade RDC 216.
          pushFormRecord(activeTenant.id, updated);
          setRecords(prev => existing ? prev.map(r => r.id === existing.id ? updated : r) : [...prev, updated]);
          // Mesmo aviso do preenchimento normal — "Continuar depois" do
          // quiosque chama isto e depois onExit(); sem o flash, o retorno pra
          // grade era idêntico a sair sem salvar (achado da auditoria, 18/08).
          setFlash({ text: saveFlashMessage(template.title, status), at: Date.now() });
        }}
      />
    );
  }

  if (filling) {
    return (
      <div className="management-page">
        <FormFill template={filling.template} record={filling.record}
          onSave={handleSave} onBack={() => setFilling(null)} session={session} tenant={activeTenant}
          rotuloCategoria={rotuloCat(filling.template.category)} />
      </div>
    );
  }

  return (
    <section className="management-page">
      {editingTpl && (
        <TaskEditorModal template={editingTpl} onSave={salvarTemplate} onClose={() => setEditingTpl(null)} />
      )}
      {importOpen && (
        <ImportTemplateModal onSave={criarTemplate} onClose={() => setImportOpen(false)} />
      )}
      {organizando && (
        <OrganizarPlanilhasModal
          templates={templatesOrganizados}
          prefs={prefs}
          onSave={salvarOrganizacao}
          onClose={() => setOrganizando(false)}
          error={organizarError} />
      )}
      <div className="page-header">
        <div>
          <span className="eyebrow">Boas Práticas de Fabricação</span>
          <h1>Planilhas de Controle</h1>
          <p className="muted">Formulários digitais do MBPF. Preencha o controle do período atual.</p>
        </div>
        <div className="page-actions">
          <select value={activeTenant.id} onChange={(e) => onTenantChange(e.target.value)} style={{ width:'auto' }}>
            {allTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {isRT && <button className="secondary-action" style={{ fontSize:12 }} onClick={() => { setOrganizarError(null); setOrganizando(true); }}>Organizar</button>}
          {isRT && <button className="secondary-action" style={{ fontSize:12 }} onClick={() => setImportOpen(true)}>Importar por IA</button>}
        </div>
      </div>

      {/* Aviso de "salvei" — chega exatamente onde a pessoa pousa depois de
          "Salvar rascunho"/"Confirmar preenchimento" (ou do quiosque), no
          topo da grade. Sem isto essa tela era idêntica à de "← Voltar"
          descartando. Autolimpa sozinho (ver o useEffect do `flash`). */}
      {flash && (
        <div role="status" style={{
          display:'flex', alignItems:'center', gap:8, padding:'10px 16px', marginBottom:16,
          background:'var(--green-light)', border:'1px solid var(--green-border)',
          borderRadius:'var(--r-lg)', color:'var(--green)', fontSize:13, fontWeight:600,
        }}>
          {flash.text}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display:'flex', gap:6, marginBottom:20 }}>
        {[['forms','Planilhas'],['validation','Validação RT']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding:'7px 16px', borderRadius:8, border:'1px solid var(--border)', background:tab===key?'var(--text)':'var(--surface)', color:tab===key?'white':'var(--text)', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'var(--font)', display:'flex', alignItems:'center', gap:8 }}>
            {label}
            {key==='validation' && pendingValidation>0 && (
              <span style={{ background:'var(--amber)', color:'white', borderRadius:10, fontSize:10, fontWeight:800, padding:'1px 6px' }}>{pendingValidation}</span>
            )}
          </button>
        ))}
      </div>

      {tab==='validation' && (
        <RTValidationPanel records={records} templates={templates} onValidate={handleValidate} session={session} />
      )}

      {tab==='forms' && (
        <>
          <div className="chip-row" style={{ marginBottom: sectors.length > 1 ? 10 : 16 }}>
            <button className={`quick-chip ${catFilter==='all'?'active':''}`} onClick={() => pickCategory('all')}>
              <strong>Todas</strong><span>{templates.length} planilhas</span>
            </button>
            {categories.map((cat) => (
              <button key={cat} className={`quick-chip ${catFilter===cat?'active':''}`} onClick={() => pickCategory(cat)}>
                <strong>{rotuloCat(cat)}</strong><span>{templatesOrganizados.filter((t) => t.category===cat).length}</span>
              </button>
            ))}
          </div>

          {/* Segundo nível: setor. Só aparece quando a categoria em foco tem
              setores (Higienização) — pra Faxina/Dedetização/etc. seria uma
              fileira de botões vazia. */}
          {sectors.length > 1 && (
            <div className="chip-row" style={{ marginBottom:16 }}>
              <button className={`quick-chip ${sectorFilter==='all'?'active':''}`} onClick={() => setSectorFilter('all')}>
                <strong>Todos os setores</strong><span>{sectors.length}</span>
              </button>
              {sectors.map((s) => (
                <button key={s} className={`quick-chip ${sectorFilter===s?'active':''}`} onClick={() => setSectorFilter(s)}>
                  <strong>{s}</strong>
                </button>
              ))}
            </div>
          )}

          <div className="forms-grid">
            {filteredTemplates.map((tpl) => {
              const pkBase = getPeriodKey(tpl.frequency, today);
              // Planilha com escopo: a via aberta depende do setor escolhido no
              // card. Sem setor escolhido ainda, `pk` é a chave-base — que é
              // exatamente o registro legado (pré-18/08), então histórico
              // antigo continua abrindo normalmente.
              const campoEscopo = scopeFieldOf(tpl);
              const setorSel    = campoEscopo ? (scopeSel[tpl.id] ?? '') : '';
              const pk     = campoEscopo ? makePeriodKey(tpl.frequency, today, setorSel) : pkBase;
              const escopoPendente = Boolean(campoEscopo) && !setorSel;
              const rec    = getRecord(tpl, pk);
              // Mesma âncora do FormFill (achado da auditoria, 18/08): sem
              // isto, o card de uma folha semanal com tarefa mensal/quinzenal
              // ia mostrando um percentual DIFERENTE dia a dia, mesmo sem
              // ninguém tocar em nada — porque completionPct comparava contra
              // "agora" em vez da data em que o registro nasceu.
              const pct    = completionPct(tpl, rec, rec?.createdAt ? new Date(rec.createdAt) : today);
              const meta   = catMeta(tpl.category);
              const isDone = rec?.status==='submitted';
              const isDraft= rec?.status==='draft';
              const isValidated = Boolean(rec?.validation);
              const history = templateHistory(records, tpl, campoEscopo);
              // Sem setor escolhido ainda, não existe UM registro pra badge/
              // barra lerem — existem até N (um por setor). Antes disso elas
              // liam sempre `rec` (chave-base, que fica pra sempre null nas
              // planilhas com escopo — os botões de ação ficam disabled até
              // escolher um setor), e o card mostrava "Pendente"/0% eterno
              // mesmo com todos os setores concluídos. Achado da auditoria
              // (18/08). Fora do caso "pendente de escolha", nada muda.
              const scoped = escopoPendente ? scopedSectorProgress(tpl, records, today, campoEscopo) : null;
              const cardPct         = scoped ? scoped.pct : pct;
              const cardIsDone      = scoped ? (scoped.total>0 && scoped.done===scoped.total) : isDone;
              const cardIsDraft     = scoped ? scoped.done>0 && !cardIsDone : isDraft;
              const cardIsValidated = scoped ? (scoped.total>0 && scoped.validated===scoped.total) : isValidated;

              return (
                <article key={tpl.id} className="form-card" style={{ borderTopColor:meta.color }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                    <div>
                      {/* rotuloCat, não meta.label: o "Organizar" (v1.9.153)
                          renomeia a aba por loja, e o card precisa seguir —
                          senão a aba diz "Serviços gerais" e todo card embaixo
                          dela continua dizendo "FAXINA". */}
                      <span className="eyebrow" style={{ color:meta.color }}>{rotuloCat(tpl.category)} · {freqLabel(tpl.frequency)}</span>
                      <h3 style={{ fontSize:14, fontWeight:700, marginTop:3, marginBottom:0 }}>{tpl.title}</h3>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                      {cardIsValidated
                        ? <span className="badge ok">✓ RT validado</span>
                        : cardIsDone ? <span className="badge subtle">✓ Concluído</span>
                        : cardIsDraft ? <span className="badge warn">{scoped ? `${scoped.done}/${scoped.total} setores` : 'Rascunho'}</span>
                        : <span className="badge neutral">Pendente</span>}
                    </div>
                  </div>
                  <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:10, lineHeight:1.5 }}>{tpl.description}</p>
                  <div style={{ fontSize:11, color:'var(--text-secondary)', marginBottom:10 }}>
                    Período: <strong style={{ color:'var(--text)' }}>{formatPeriodLabel(tpl.frequency, pk)}</strong>
                  </div>
                  {/* Cada setor tem sua própria via no mesmo dia. Sem isto, a
                      segunda equipe abria o registro da primeira e o salvava
                      por cima — o nome e as respostas da primeira sumiam. */}
                  {campoEscopo && (
                    <div style={{ marginBottom:10 }}>
                      <label style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-secondary)', display:'block', marginBottom:4 }}>
                        {campoEscopo.label} — cada um preenche o seu
                      </label>
                      <select value={setorSel} style={{ width:'100%', fontSize:12, padding:'6px 8px' }}
                        onChange={(e) => setScopeSel((prev) => ({ ...prev, [tpl.id]: e.target.value }))}>
                        <option value="">Escolha o {String(campoEscopo.label).toLowerCase()}…</option>
                        {(campoEscopo.options ?? []).map((o) => {
                          const feito = records.some((r) => r.formId===tpl.id && r.periodKey===makePeriodKey(tpl.frequency, today, o) && r.status==='submitted');
                          return <option key={o} value={o}>{feito ? `✓ ${o}` : o}</option>;
                        })}
                      </select>
                    </div>
                  )}
                  <div style={{ height:4, background:'var(--border-subtle)', borderRadius:2, marginBottom:12, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${cardPct}%`, background:cardIsValidated?'var(--green)':cardIsDone?meta.color:meta.color, borderRadius:2, transition:'width .3s', opacity:cardIsDone?1:0.6 }} />
                  </div>
                  <div style={{ display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
                    <button className="ghost-action" style={{ fontSize:11 }} onClick={() => setHistId(histId===tpl.id?null:tpl.id)}>
                      {histId===tpl.id?'Fechar':'Histórico'}
                    </button>
                    <div style={{ display:'flex', gap:6 }}>
                      {/* Higienização: lista de equipamentos/áreas que muda
                          quando entra equipamento novo. Ou qualquer planilha
                          com campo de lista suspensa (ex.: "Qual banheiro",
                          "Setor") — pedido da nutricionista (10/08) pra
                          ajustar essas opções sozinha, sem precisar de
                          mudança de código. Planilha sem nenhum dos dois
                          (checklist 100% fixo) não tem o que editar por aqui. */}
                      {isRT && isTemplateEditable(tpl) && (
                        <button className="ghost-action" style={{ fontSize:11 }}
                          title="Ajustar tarefas ou opções desta planilha"
                          onClick={() => setEditingTpl(tpl)}>Editar</button>
                      )}
                      {isDone && (
                        <button className="secondary-action" style={{ fontSize:11, padding:'5px 10px' }} onClick={() => {
                          const win = window.open('','_blank');
                          // Mesma guarda de handlePDF acima — window.open devolve null
                          // com pop-up bloqueado e o write seguinte estourava TypeError
                          // sem nenhum sinal pra quem tocou o botão. Achado da
                          // auditoria (19/08).
                          if (!win) {
                            window.alert('Não foi possível abrir a janela de impressão — o navegador pode estar bloqueando pop-ups. Libere pop-ups para este site e toque em "↓ PDF" de novo.');
                            return;
                          }
                          win.document.write(generateFormPDF(tpl, rec, activeTenant, rotuloCat(tpl.category)));
                          win.document.close(); setTimeout(() => win.print(), 400);
                        }}>↓ PDF</button>
                      )}
                      {/* `pk` já carrega o setor escolhido — recalcular com
                          getPeriodKey aqui reintroduziria a colisão. */}
                      <button className="secondary-action" disabled={escopoPendente}
                        title={escopoPendente ? `Escolha o ${String(campoEscopo.label).toLowerCase()} primeiro` : undefined}
                        style={{ fontSize:11, padding:'5px 10px', background: escopoPendente ? 'var(--border)' : '#001e2b', color:'white', borderColor:'transparent', cursor: escopoPendente ? 'not-allowed' : 'pointer' }}
                        onClick={() => setKioskForm({ template:tpl, record:rec, periodKey:pk })}>
                        📱 Tablet
                      </button>
                      <button className="primary-action" disabled={escopoPendente}
                        style={{ fontSize:12, padding:'6px 14px', background: escopoPendente ? 'var(--border)' : (isValidated?'var(--green)':`linear-gradient(135deg,${meta.color},${meta.color}cc)`), cursor: escopoPendente ? 'not-allowed' : 'pointer' }}
                        onClick={() => setFilling({ template:tpl, record:rec, periodKey:pk, escopo: campoEscopo ? setorSel : null })}>
                        {escopoPendente ? `Escolha o ${String(campoEscopo.label).toLowerCase()}` : isDone?'Ver / editar':isDraft?'Continuar':'Preencher'}
                      </button>
                    </div>
                  </div>

                  {histId===tpl.id && (
                    <div style={{ marginTop:12, borderTop:'1px solid var(--border-subtle)', paddingTop:12 }}>
                      <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--text-secondary)', marginBottom:8 }}>Histórico</div>
                      {history.length===0
                        ? <p style={{ fontSize:12, color:'var(--text-secondary)' }}>Sem registros anteriores.</p>
                        : history.map((r) => (
                          <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border-subtle)' }}>
                            <div>
                              <div style={{ fontSize:12, fontWeight:600 }}>{formatPeriodLabel(tpl.frequency, r.periodKey)}</div>
                              <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{r.user} · {new Date(r.updatedAt).toLocaleDateString('pt-BR')}</div>
                            </div>
                            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                              {r.validation && <span className="badge ok" style={{ fontSize:10 }}>RT ✓</span>}
                              <span className={`badge ${r.status==='submitted'?'subtle':'warn'}`} style={{ fontSize:10 }}>
                                {r.status==='submitted'?'Concluído':'Rascunho'}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
