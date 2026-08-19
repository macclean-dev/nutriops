import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isFieldDue, dueFields } from './field-frequency';
import { completionPct, recentlyValidated, templateHistory, scopedSectorProgress, saveFlashMessage } from './forms';

const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Triagem manual dos 6 achados de gravidade MÉDIA sem perda de dado que
// apontam pra src/forms.jsx (pool de 169 não-julgados da auditoria de falha
// silenciosa, 18-19/08).
//
// Um já estava RESOLVIDO por um commit ANTERIOR desta mesma sessão (v1.9.158,
// achado nº1 daquela rodada), antes deste pool de 169 existir:
//   · "Foto de evidência presa em 'abrindo…' pra sempre" — PhotoField já tem
//     `carregandoUrl` separado da URL resolvida e mostra "falha ao abrir"
//     quando signedPhotoUrl devolve null por falha real. Coberto por
//     repository-medios-triagem.test.js (Família 6) — não duplicado aqui,
//     só uma trava leve de rastreabilidade.
//
// Os outros 5 têm bug real e viram 5 famílias:
//   · "Salvar rascunho"/"Confirmar preenchimento" fecham a tela sem nenhum
//     sinal — resultado visual idêntico ao de "← Voltar" descartando.
//   · "Recentemente validadas pelo RT" cortava os 10 PRIMEIROS do array
//     (posição), não os 10 mais recentes (data) — a assinatura que a RT
//     ACABOU de fazer nunca aparecia com 10+ validações no acervo.
//   · Histórico do card cortava em 8 REGISTROS; nas 3 planilhas com escopo
//     por setor isso não cobre nem 1 dia, e o desempate alfabético da chave
//     derrubava sempre os MESMOS setores.
//   · dueFields/completionPct comparavam contra "agora" em vez da data de
//     criação do registro — tarefa mensal/quinzenal já respondida sumia da
//     tela (e o percentual regredia) no meio da MESMA folha semanal, dias
//     depois de aberta.
//   · Card com escopo por setor ficava "Pendente"/0% pra sempre quando
//     nenhum setor tinha sido escolhido no <select> — mesmo com todos os
//     setores concluídos, porque badge/barra liam a chave-base, que nenhum
//     registro usa mais desde o fix de v1.9.133.
// ─────────────────────────────────────────────────────────────────────────────

describe('Achado já resolvido (rodada anterior, v1.9.158) — PhotoField "abrindo…" eterno', () => {
  it('continua com o state de carregamento separado — trava de rastreabilidade, teste completo em repository-medios-triagem.test.js', () => {
    expect(fonte).toContain('const [carregandoUrl, setCarregandoUrl] = useState(Boolean(value?.path));');
    expect(fonte).toContain('falha ao abrir');
  });
});

describe('Família 1 — "Salvar rascunho"/"Confirmar preenchimento" avisam que salvaram (achado T2, linha 1520)', () => {
  it('saveFlashMessage distingue rascunho de confirmação, e cita o título da planilha', () => {
    const confirmado = saveFlashMessage('Higienização — Confeitaria', 'submitted');
    const rascunho = saveFlashMessage('Higienização — Confeitaria', 'draft');
    expect(confirmado).toContain('Higienização — Confeitaria');
    expect(rascunho).toContain('Higienização — Confeitaria');
    expect(confirmado).not.toBe(rascunho); // as duas mensagens têm que ser diferentes
    expect(confirmado.toLowerCase()).toContain('confirmada');
    expect(rascunho.toLowerCase()).toContain('rascunho');
  });

  it('o handleSave do preenchimento normal seta o flash antes de fechar a tela', () => {
    const ini = fonte.indexOf('const handleSave = useCallback(({ responses, status }) => {');
    const fim = fonte.indexOf('const handleValidate = useCallback');
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('setFilling(null);');
    expect(corpo).toContain('setFlash({ text: saveFlashMessage(template.title, status), at: Date.now() });');
    // o flash é setado DEPOIS de fechar — não impede o fechamento, só avisa
    expect(corpo.indexOf('setFilling(null);')).toBeLessThan(corpo.indexOf('setFlash({ text: saveFlashMessage'));
  });

  it('o modo quiosque ("Continuar depois" → onSave + onExit) também seta o flash — mesmo bug citado no caminho do usuário do achado', () => {
    const ini = fonte.indexOf("onSave={async (responses, status = 'submitted') => {");
    const fim = fonte.indexOf('}}\n      />', ini);
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    const corpo = fonte.slice(ini, fim);
    expect(corpo).toContain('setFlash({ text: saveFlashMessage(template.title, status), at: Date.now() });');
  });

  it('as duas chamadas de setFlash usam saveFlashMessage (normal + quiosque) — não duas mensagens divergentes', () => {
    const ocorrencias = fonte.match(/setFlash\(\{ text: saveFlashMessage\(template\.title, status\), at: Date\.now\(\) \}\);/g) ?? [];
    expect(ocorrencias.length).toBe(2);
  });

  it('a grade renderiza o aviso com role="status", lendo flash.text', () => {
    const ini = fonte.indexOf('{/* Aviso de "salvei"');
    const fim = fonte.indexOf('{/* Tab bar */}');
    const corpo = fonte.slice(ini, fim);
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain('<div role="status"');
    expect(corpo).toContain('{flash.text}');
  });

  it('o flash é limpo ao trocar de loja — não sobra aviso da loja anterior', () => {
    expect(fonte).toContain('setFilling(null); setHistId(null); setFlash(null);');
  });

  it('o flash autolimpa sozinho (não precisa de botão de fechar)', () => {
    expect(fonte).toContain('const t = setTimeout(() => setFlash(null), 5000);');
  });
});

describe('Família 2 — "Recentemente validadas pelo RT" ordena por data, não por posição no array (achado T6, linha 1537)', () => {
  const v = (id, at) => ({
    id, formId: 'tpl1', formTitle: `Registro ${id}`, category: 'faxina', frequency: 'daily',
    periodKey: `2026-07-${id}`, status: 'submitted',
    validation: { by: 'Fran', role: 'Nutricionista RT', at, note: '' },
  });

  it('documenta o defeito original: slice(0,10) cru nunca inclui a 11ª posição do array', () => {
    const antigas = Array.from({ length: 10 }, (_, i) => v(String(i).padStart(2, '0'), `2026-07-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`));
    const recemAssinada = v('nova', '2026-08-19T09:00:00.000Z'); // handleValidate entra no FIM: [...prev, up]
    const records = [...antigas, recemAssinada];
    const cortAntigo = records.filter((r) => r.validation).slice(0, 10);
    expect(cortAntigo.some((r) => r.id === 'nova')).toBe(false);
  });

  it('recentlyValidated corrige: a assinatura mais recente aparece primeiro mesmo entrando no fim do array', () => {
    const antigas = Array.from({ length: 10 }, (_, i) => v(String(i).padStart(2, '0'), `2026-07-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`));
    const recemAssinada = v('nova', '2026-08-19T09:00:00.000Z');
    const records = [...antigas, recemAssinada];
    const out = recentlyValidated(records);
    expect(out).toHaveLength(10);
    expect(out[0].id).toBe('nova');
  });

  it('aparelho recém-sincronizado (ordem created_at.desc da nuvem) dá a MESMA lista que o aparelho que assinou local', () => {
    const local = [v('x', '2026-08-10T00:00:00.000Z'), v('y', '2026-08-19T00:00:00.000Z')];
    const sincronizadoDaNuvem = [v('y', '2026-08-19T00:00:00.000Z'), v('x', '2026-08-10T00:00:00.000Z')]; // ordem invertida
    expect(recentlyValidated(local)).toEqual(recentlyValidated(sincronizadoDaNuvem));
  });

  it('registros sem validação não entram, e o limite é configurável', () => {
    const records = [v('a', '2026-08-01T00:00:00.000Z'), { id: 'b', validation: null }];
    expect(recentlyValidated(records, 1)).toHaveLength(1);
    expect(recentlyValidated(records, 1)[0].id).toBe('a');
  });

  it('a tela usa recentlyValidated — não mais o slice(0,10) cru sem ordenar', () => {
    expect(fonte).toContain('const validated = recentlyValidated(records);');
    expect(fonte).not.toContain('records.filter((r) => r.validation).slice(0,10)');
  });
});

describe('Família 3 — histórico do card não corta mais no meio de um dia com escopo por setor (achado T6, linha 1858)', () => {
  const tpl = { id: 'higiene-pessoal', frequency: 'daily' };
  // Mesmas 12 opções do achado original (CD_SETORES_EQUIPE) — a ordem
  // alfabética descendente real (verificada) derruba Bistrô/Caixas/Café por
  // Atendimento/Confeitaria do corte de 8, sempre.
  const campoEscopo = { id: 'setor', options: ['Bistrô', 'Caixas', 'Café / Atendimento', 'Confeitaria', 'Cozinha Quente', 'Cozinha Fria', 'Estoque Seco', 'Estoque Frio', 'Padaria', 'Recepção', 'Serviços gerais', 'Vestiário'] };

  const registrosDoDia = (dia, setores) => setores.map((s) => ({
    id: `${dia}-${s}`, formId: tpl.id, periodKey: `2026-08-${dia}::${s}`,
    status: 'submitted', user: s, updatedAt: `2026-08-${dia}T12:00:00.000Z`,
  }));

  it('documenta o defeito original: slice(0,8) cru derruba sempre os mesmos 4 setores (os alfabeticamente primeiros)', () => {
    const hoje = registrosDoDia('18', campoEscopo.options);
    const cortAntigo = hoje.slice().sort((a, b) => b.periodKey.localeCompare(a.periodKey)).slice(0, 8);
    for (const setor of ['Bistrô', 'Caixas', 'Café / Atendimento', 'Confeitaria']) {
      expect(cortAntigo.some((r) => r.user === setor)).toBe(false);
    }
  });

  it('templateHistory cobre o dia inteiro (12 setores) sem derrubar nenhum', () => {
    const hoje = registrosDoDia('18', campoEscopo.options);
    const out = templateHistory(hoje, tpl, campoEscopo);
    expect(out).toHaveLength(12);
    for (const setor of campoEscopo.options) {
      expect(out.some((r) => r.user === setor)).toBe(true);
    }
  });

  it('continua cobrindo pelo menos 8 dias distintos quando o volume por dia é o máximo (12 setores × 8 dias = 96 registros)', () => {
    const dias = ['11', '12', '13', '14', '15', '16', '17', '18'];
    const registros = dias.flatMap((d) => registrosDoDia(d, campoEscopo.options));
    const out = templateHistory(registros, tpl, campoEscopo);
    const diasNoHistorico = new Set(out.map((r) => r.periodKey.slice(0, 10)));
    expect(out).toHaveLength(96);
    expect(diasNoHistorico.size).toBe(8);
  });

  it('planilha SEM escopo continua idêntica a antes — 8 registros (1 por dia)', () => {
    const tplSemEscopo = { id: 'faxina-simples', frequency: 'daily' };
    const registros = Array.from({ length: 15 }, (_, i) => ({
      id: `r${i}`, formId: tplSemEscopo.id, periodKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
      status: 'submitted', user: 'Ana', updatedAt: '2026-08-01T12:00:00.000Z',
    }));
    expect(templateHistory(registros, tplSemEscopo, null)).toHaveLength(8);
  });

  it('a tela usa templateHistory — não mais o slice(0,8) cru sem escala por setor', () => {
    expect(fonte).toContain('const history = templateHistory(records, tpl, campoEscopo);');
    expect(fonte).not.toContain('records.filter((r) => r.formId===tpl.id).sort((a,b) => b.periodKey.localeCompare(a.periodKey)).slice(0,8)');
  });
});

describe('Família 4 — tarefa mensal/quinzenal não some mais no meio da MESMA folha semanal (achado T6, linha 1482)', () => {
  const campoMensal = { id: 'parede', label: 'Parede', type: 'cnc', frequency: 'monthly' };
  const template = {
    frequency: 'weekly',
    sections: [{
      id: 's1',
      fields: [
        { id: 'chao', label: 'Chão', type: 'cnc' },
        { id: 'bancada', label: 'Bancada', type: 'cnc' },
        { id: 'geladeira', label: 'Geladeira', type: 'cnc' },
        { id: 'freezer', label: 'Freezer', type: 'cnc' },
        campoMensal,
      ],
    }],
  };
  // Semana 2026-W37: 05–11/09. Cenário exato do achado: a tarefa mensal é
  // devida em 05, 06, 07 e deixa de ser devida em 08…11 — DENTRO do mesmo
  // registro semanal.
  const domingoAbertura = new Date('2026-09-05T09:00:00');
  const tercaReabertura = new Date('2026-09-08T09:00:00');

  it('documenta o mecanismo: isFieldDue muda de ideia dentro da MESMA semana se "agora" for recalculado a cada dia (não é bug do isFieldDue em si — o bug era o caller nunca travar a data)', () => {
    expect(isFieldDue(campoMensal, 'weekly', new Date('2026-09-05T10:00:00'))).toBe(true);
    expect(isFieldDue(campoMensal, 'weekly', new Date('2026-09-06T10:00:00'))).toBe(true);
    expect(isFieldDue(campoMensal, 'weekly', new Date('2026-09-07T10:00:00'))).toBe(true);
    expect(isFieldDue(campoMensal, 'weekly', new Date('2026-09-08T10:00:00'))).toBe(false);
    expect(isFieldDue(campoMensal, 'weekly', new Date('2026-09-11T10:00:00'))).toBe(false);
  });

  it('sem âncora, o campo "Parede (mensal)" desaparece da lista visível ao reabrir na terça', () => {
    const camposDomingo = dueFields(template.sections[0].fields, template.frequency, domingoAbertura);
    const camposTercaSemAncora = dueFields(template.sections[0].fields, template.frequency, tercaReabertura);
    expect(camposDomingo.map((f) => f.id)).toContain('parede');
    expect(camposTercaSemAncora.map((f) => f.id)).not.toContain('parede'); // documenta o bug
  });

  it('com a âncora do registro (domingo, data de criação), "Parede" continua na lista mesmo reaberta na terça', () => {
    const camposComAncora = dueFields(template.sections[0].fields, template.frequency, domingoAbertura);
    expect(camposComAncora.map((f) => f.id)).toEqual(['chao', 'bancada', 'geladeira', 'freezer', 'parede']);
  });

  it('sem âncora, o percentual anda pra TRÁS ao reabrir dias depois — o campo sai do numerador E do denominador ao mesmo tempo', () => {
    const responses = { chao: 'C', bancada: 'C', parede: 'C' }; // geladeira/freezer ainda vazios
    const pctDomingo = completionPct(template, { responses }, domingoAbertura);
    const pctTercaSemAncora = completionPct(template, { responses }, tercaReabertura); // bug antigo: "agora" cru
    expect(pctDomingo).toBe(60); // 3 de 5 (parede devida)
    expect(pctTercaSemAncora).toBe(50); // 2 de 4 (parede sumiu dos dois lados) — regrediu
  });

  it('com a âncora de record.createdAt, o percentual NÃO regride ao reabrir na terça — fica estável pela vida do registro', () => {
    const responses = { chao: 'C', bancada: 'C', parede: 'C' };
    const pctComAncora = completionPct(template, { responses }, domingoAbertura); // mesma âncora usada nas duas sessões
    expect(pctComAncora).toBe(60);
  });

  it('FormFill computa anchorNow a partir de record?.createdAt (não "agora" cru) e usa a MESMA âncora em completionPct e dueFields', () => {
    const ini = fonte.indexOf('function FormFill(');
    const fim = fonte.indexOf('function RTValidationPanel(');
    const corpo = fonte.slice(ini, fim);
    expect(ini).toBeGreaterThan(-1);
    expect(corpo).toContain('const anchorNow = record?.createdAt ? new Date(record.createdAt) : new Date();');
    expect(corpo).toContain('const pct = completionPct(template, { responses }, anchorNow);');
    expect(corpo).toContain('dueFields(sec.fields, template.frequency, anchorNow)');
  });

  it('reproduz a expressão real de anchorNow: registro novo (sem createdAt) cai no fallback "agora"; registro existente ancora em createdAt', () => {
    const anchorDe = (record) => record?.createdAt ? new Date(record.createdAt) : new Date('2026-09-08T09:00:00');
    // Planilha nunca aberta neste período: `filling.record` é null — sem nada
    // pra ancorar, o fallback é o próprio "agora" da chamada (aqui, terça).
    expect(anchorDe(null).toISOString()).toBe(new Date('2026-09-08T09:00:00').toISOString());
    // Planilha reaberta (rascunho já existe): ancora na criação, não em "agora".
    expect(anchorDe({ createdAt: '2026-09-05T09:00:00' }).toISOString()).toBe(new Date('2026-09-05T09:00:00').toISOString());
  });

  it('o card da grade usa a MESMA âncora (rec?.createdAt) pro percentual — sem isto o card e a tela de preenchimento mostrariam números diferentes', () => {
    expect(fonte).toContain('const pct    = completionPct(tpl, rec, rec?.createdAt ? new Date(rec.createdAt) : today);');
  });
});

describe('Família 5 — card com escopo por setor não fica mais "Pendente"/0% eterno (achado T6, linha 1852)', () => {
  const tpl = { id: 'higiene-pessoal', frequency: 'daily' };
  const campoEscopo = { id: 'setor', options: ['Confeitaria', 'Bistrô', 'Cozinha'] };
  const today = new Date('2026-08-19T15:00:00');

  const submittedRec = (setor, extra = {}) => ({
    id: `r-${setor}`, formId: tpl.id, periodKey: `2026-08-19::${setor}`, status: 'submitted', ...extra,
  });

  it('nenhum setor preenchido ainda: 0/3, 0%, sem validação', () => {
    expect(scopedSectorProgress(tpl, [], today, campoEscopo)).toEqual({ total: 3, done: 0, validated: 0, pct: 0 });
  });

  it('os 3 setores concluídos hoje: 3/3, 100% — não fica mais preso em "Pendente"/0%', () => {
    const records = campoEscopo.options.map((s) => submittedRec(s));
    expect(scopedSectorProgress(tpl, records, today, campoEscopo)).toEqual({ total: 3, done: 3, validated: 0, pct: 100 });
  });

  it('parcial (1 de 3) fica em 33%, não em 0%', () => {
    const out = scopedSectorProgress(tpl, [submittedRec('Confeitaria')], today, campoEscopo);
    expect(out.done).toBe(1);
    expect(out.pct).toBe(33);
  });

  it('só conta "validado" quando TODOS os setores concluídos estão com validação do RT', () => {
    const records = [
      submittedRec('Confeitaria', { validation: { by: 'Fran', at: '2026-08-19T16:00:00Z' } }),
      submittedRec('Bistrô'), // sem validação
      submittedRec('Cozinha', { validation: { by: 'Fran', at: '2026-08-19T16:00:00Z' } }),
    ];
    expect(scopedSectorProgress(tpl, records, today, campoEscopo)).toEqual({ total: 3, done: 3, validated: 2, pct: 100 });
  });

  it('registro de outro dia ou ainda em rascunho não conta como concluído', () => {
    const records = [
      { id: 'r1', formId: tpl.id, periodKey: '2026-08-18::Confeitaria', status: 'submitted' }, // ontem
      { id: 'r2', formId: tpl.id, periodKey: '2026-08-19::Bistrô', status: 'draft' }, // rascunho
    ];
    expect(scopedSectorProgress(tpl, records, today, campoEscopo).done).toBe(0);
  });

  it('campo de escopo sem opções não quebra — devolve zero em vez de dividir por zero', () => {
    expect(scopedSectorProgress(tpl, [], today, { id: 'setor', options: [] })).toEqual({ total: 0, done: 0, validated: 0, pct: 0 });
  });

  it('a tela só usa o agregado quando NENHUM setor foi escolhido ainda (escopoPendente) — com um setor escolhido, volta a ler o registro daquela via', () => {
    expect(fonte).toContain('const scoped = escopoPendente ? scopedSectorProgress(tpl, records, today, campoEscopo) : null;');
    expect(fonte).toContain('const cardPct         = scoped ? scoped.pct : pct;');
    expect(fonte).toContain('const cardIsDone      = scoped ? (scoped.total>0 && scoped.done===scoped.total) : isDone;');
    expect(fonte).toContain('const cardIsValidated = scoped ? (scoped.total>0 && scoped.validated===scoped.total) : isValidated;');
  });

  it('o badge mostra "X/Y setores" em vez de travar em "Pendente" quando parcialmente concluído', () => {
    expect(fonte).toContain('cardIsDraft ? <span className="badge warn">{scoped ? `${scoped.done}/${scoped.total} setores` : \'Rascunho\'}</span>');
  });

  it('badge e barra de progresso da grade usam as variáveis cardIsValidated/cardIsDone/cardPct, não mais isValidated/isDone/pct crus', () => {
    expect(fonte).toContain("width:`${cardPct}%`, background:cardIsValidated?'var(--green)':cardIsDone?meta.color:meta.color");
  });
});
