import { describe, it, expect } from 'vitest';
import {
  chaveGrupo, contarPreenchidos, escolherSobrevivente, escolherRegistro,
  planejarDedupe, aplicarDedupe,
} from './forms-dedupe';

// Limpeza das planilhas BPF duplicadas (Swiss/Bäckerei/DBK). O que estes
// testes protegem, acima de tudo: NENHUM registro pode sumir. Cada form_record
// aponta pro formId da cópia em que foi preenchido, e órfão é invisível na
// Central de Não-Conformidades — apagar cópia sem remapear destrói evidência
// sanitária.

const tpl = (id, over = {}) => ({
  id, category: 'dedetizacao', title: 'Controle de Dedetização',
  updatedAt: '2026-08-01T10:00:00.000Z', ...over,
});
const rec = (id, formId, periodKey, over = {}) => ({
  id, formId, periodKey, status: 'submitted', responses: { a: 'x' },
  updatedAt: '2026-08-01T10:00:00.000Z', ...over,
});

describe('chaveGrupo', () => {
  it('mesma categoria + mesmo título = mesma planilha, ignorando caixa e espaço', () => {
    expect(chaveGrupo(tpl('a'))).toBe(chaveGrupo(tpl('b', { title: '  CONTROLE DE DEDETIZAÇÃO ' })));
  });

  it('títulos diferentes na mesma categoria são planilhas diferentes', () => {
    expect(chaveGrupo(tpl('a'))).not.toBe(chaveGrupo(tpl('b', { title: 'Outra coisa' })));
  });
});

describe('escolherSobrevivente', () => {
  it('a cópia que a RT editou (custom) ganha de todas — perder isso é perder o trabalho dela', () => {
    const registros = new Map([['b', [rec('r1', 'b', '2026-01'), rec('r2', 'b', '2026-02')]]]);
    const s = escolherSobrevivente([tpl('a', { custom: true }), tpl('b')], registros);
    expect(s.id).toBe('a');           // mesmo 'b' tendo mais registros
  });

  it('sem custom, ganha a que tem mais registros — menos remapeamento', () => {
    const registros = new Map([['b', [rec('r1', 'b', '2026-01')]]]);
    expect(escolherSobrevivente([tpl('a'), tpl('b')], registros).id).toBe('b');
  });

  it('empate resolve determinístico — o plano tem que ser reprodutível', () => {
    const vazio = new Map();
    const s1 = escolherSobrevivente([tpl('a'), tpl('b')], vazio);
    const s2 = escolherSobrevivente([tpl('b'), tpl('a')], vazio);
    expect(s1.id).toBe(s2.id);
  });
});

describe('escolherRegistro — quando dois períodos colidem', () => {
  it('entregue vence rascunho', () => {
    const entregue = rec('r1', 'f', '2026-01', { status: 'submitted' });
    const rascunho = rec('r2', 'f', '2026-01', { status: 'draft', responses: { a:1,b:2,c:3 } });
    expect(escolherRegistro(rascunho, entregue).id).toBe('r1');
  });

  it('validado pela RT vence não validado', () => {
    const validado = rec('r1', 'f', '2026-01', { validation: { at: 'x' } });
    const cru      = rec('r2', 'f', '2026-01');
    expect(escolherRegistro(cru, validado).id).toBe('r1');
  });

  it('empatados no status, vence o mais completo', () => {
    const magro = rec('r1', 'f', '2026-01', { responses: { a: 'x' } });
    const gordo = rec('r2', 'f', '2026-01', { responses: { a:'x', b:'y', c:'z' } });
    expect(escolherRegistro(magro, gordo).id).toBe('r2');
  });
});

describe('contarPreenchidos', () => {
  it('conta só o que a pessoa realmente respondeu', () => {
    expect(contarPreenchidos({ responses: { a:'x', b:'', c:null, d:false, e:0, f:'y' } })).toBe(3);
  });
  it('sem responses não quebra', () => {
    expect(contarPreenchidos({})).toBe(0);
    expect(contarPreenchidos(null)).toBe(0);
  });
});

describe('planejarDedupe', () => {
  it('planilha sem cópia não entra no plano — nada a fazer', () => {
    const p = planejarDedupe([tpl('a')], [rec('r1', 'a', '2026-01')]);
    expect(p.grupos).toHaveLength(0);
    expect(p.apagar).toHaveLength(0);
  });

  it('3 cópias viram 1, e os registros das mortas são remapeados', () => {
    const templates = [tpl('a'), tpl('b'), tpl('c')];
    const records = [rec('r1','a','2026-01'), rec('r2','b','2026-02'), rec('r3','c','2026-03')];
    const p = planejarDedupe(templates, records);

    expect(p.resumo.copiasExcedentes).toBe(2);
    expect(p.resumo.templatesDepois).toBe(1);
    expect(p.remapear).toHaveLength(2);              // r2 e r3 mudam de formId
    expect(p.colisoes).toHaveLength(0);              // períodos diferentes
  });

  it('mesmo período em cópias diferentes vira colisão declarada, não perda silenciosa', () => {
    const templates = [tpl('a'), tpl('b')];
    const records = [
      rec('r1','a','2026-01', { status: 'draft' }),
      rec('r2','b','2026-01', { status: 'submitted' }),
    ];
    const p = planejarDedupe(templates, records);
    expect(p.colisoes).toHaveLength(1);
    expect(p.colisoes[0].fica).toBe('r2');           // entregue vence
    expect(p.colisoes[0].motivo).toBe('entregue vence rascunho');
  });

  it('planilhas de títulos diferentes não são agrupadas por engano', () => {
    const p = planejarDedupe(
      [tpl('a'), tpl('b', { title: 'Higiene Pessoal', category: 'higiene_pessoal' })],
      [],
    );
    expect(p.grupos).toHaveLength(0);
  });

  it('o plano é reprodutível — mesma entrada, mesmo resultado', () => {
    const templates = [tpl('a'), tpl('b'), tpl('c')];
    const records = [rec('r1','b','2026-01')];
    expect(planejarDedupe(templates, records)).toEqual(planejarDedupe(templates, records));
  });
});

describe('aplicarDedupe — a garantia que mais importa: nada se perde', () => {
  it('remapeia os registros e nenhum vira órfão', () => {
    const templates = [tpl('a'), tpl('b'), tpl('c')];
    const records = [rec('r1','a','2026-01'), rec('r2','b','2026-02'), rec('r3','c','2026-03')];
    const plano = planejarDedupe(templates, records);
    const out = aplicarDedupe(templates, records, plano);

    expect(out.templates).toHaveLength(1);
    expect(out.records).toHaveLength(3);                       // nenhum sumiu
    const idsVivos = new Set(out.templates.map((t) => t.id));
    for (const r of out.records) {
      expect(idsVivos.has(r.formId)).toBe(true);               // ✅ zero órfãos
    }
  });

  it('o registro perdedor de uma colisão é PRESERVADO dentro do vencedor', () => {
    const templates = [tpl('a'), tpl('b')];
    const records = [
      rec('r1','a','2026-01', { status: 'draft', responses: { nc: 'piso rachado' } }),
      rec('r2','b','2026-01', { status: 'submitted' }),
    ];
    const plano = planejarDedupe(templates, records);
    const out = aplicarDedupe(templates, records, plano);

    expect(out.records).toHaveLength(1);
    const vencedor = out.records[0];
    expect(vencedor.id).toBe('r2');
    // a evidência do perdedor continua auditável, não foi destruída
    expect(vencedor._duplicatasMescladas).toHaveLength(1);
    expect(vencedor._duplicatasMescladas[0].responses.nc).toBe('piso rachado');
  });

  it('não gera dois registros com o mesmo (formId, periodKey) — a trava da nuvem', () => {
    const templates = [tpl('a'), tpl('b'), tpl('c')];
    const records = [
      rec('r1','a','2026-01'), rec('r2','b','2026-01'), rec('r3','c','2026-01'),
    ];
    const plano = planejarDedupe(templates, records);
    const out = aplicarDedupe(templates, records, plano);

    const chaves = out.records.map((r) => `${r.formId}::${r.periodKey}`);
    expect(new Set(chaves).size).toBe(chaves.length);          // ✅ sem colisão
  });

  it('preserva a definição editada pela RT quando ela é a sobrevivente', () => {
    const editada = tpl('a', { custom: true, sections: [{ id: 's', title: 'Do jeito dela', fields: [] }] });
    const templates = [editada, tpl('b')];
    const plano = planejarDedupe(templates, []);
    const out = aplicarDedupe(templates, [], plano);
    expect(out.templates[0].sections[0].title).toBe('Do jeito dela');
  });

  it('sem duplicata, aplicar é no-op', () => {
    const templates = [tpl('a')];
    const records = [rec('r1','a','2026-01')];
    const out = aplicarDedupe(templates, records, planejarDedupe(templates, records));
    expect(out.templates).toEqual(templates);
    expect(out.records).toEqual(records);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recuperação de órfãos — o achado da medição de 16/08: 35 dos 41 registros da
// Swiss apontavam pra template que não existe mais, ou seja, JÁ estavam
// invisíveis na Central de Não-Conformidades. Não é risco futuro, é dano
// presente — e dá pra desfazer, porque o registro carrega formTitle+category.
// ─────────────────────────────────────────────────────────────────────────────
describe('recuperação de órfãos', () => {
  const orfao = (id, periodKey, over = {}) => rec(id, 'template-que-sumiu', periodKey, {
    formTitle: 'Controle de Dedetização', category: 'dedetizacao', ...over,
  });

  it('reconecta o órfão à planilha certa pelo título+categoria que ele carrega', () => {
    const templates = [tpl('vivo')];
    const records = [orfao('r1', '2026-01')];
    const plano = planejarDedupe(templates, records);

    expect(plano.resumo.orfaosRecuperados).toBe(1);
    const out = aplicarDedupe(templates, records, plano);
    expect(out.records[0].formId).toBe('vivo');          // ✅ voltou a ser visível
  });

  it('recupera órfão MESMO quando não há duplicata nenhuma pra limpar', () => {
    // O caso da Swiss: o estrago dos órfãos independe de ainda haver cópias.
    const plano = planejarDedupe([tpl('vivo')], [orfao('r1', '2026-01')]);
    expect(plano.grupos).toHaveLength(0);                // nada a deduplicar
    expect(plano.resumo.orfaosRecuperados).toBe(1);      // mas há o que recuperar
  });

  it('órfão sem planilha correspondente NÃO é apagado — é reportado', () => {
    const records = [orfao('r1', '2026-01', { formTitle: 'Planilha que saiu do seed' })];
    const plano = planejarDedupe([tpl('vivo')], records);

    expect(plano.resumo.orfaosRecuperados).toBe(0);
    expect(plano.orfaosSemDestino).toHaveLength(1);
    const out = aplicarDedupe([tpl('vivo')], records, plano);
    expect(out.records).toHaveLength(1);                 // ✅ continua existindo
    expect(out.records[0].formId).toBe('template-que-sumiu');   // intocado
  });

  it('órfão vai pra sobrevivente do grupo, não pra uma cópia que vai morrer', () => {
    const templates = [tpl('a'), tpl('b')];
    const records = [rec('r0','b','2026-05'), orfao('r1', '2026-01')];
    const plano = planejarDedupe(templates, records);
    const out = aplicarDedupe(templates, records, plano);

    const sobrevivente = out.templates[0].id;
    expect(sobrevivente).toBe('b');                       // 'b' tem mais registros
    for (const r of out.records) expect(r.formId).toBe(sobrevivente);
  });

  it('órfão que colide de período com registro vivo não quebra a trava da nuvem', () => {
    const templates = [tpl('vivo')];
    const records = [
      rec('r-vivo', 'vivo', '2026-01', { status: 'submitted' }),
      orfao('r-orfao', '2026-01', { status: 'draft' }),
    ];
    const plano = planejarDedupe(templates, records);
    const out = aplicarDedupe(templates, records, plano);

    const chaves = out.records.map((r) => `${r.formId}::${r.periodKey}`);
    expect(new Set(chaves).size).toBe(chaves.length);      // sem colisão
    // e o órfão perdedor foi preservado, não descartado
    const vencedor = out.records.find((r) => r.id === 'r-vivo');
    expect(vencedor._duplicatasMescladas.map((d) => d.id)).toContain('r-orfao');
  });

  it('cenário Swiss: 5 cópias + maioria dos registros órfãos → tudo visível no fim', () => {
    const templates = ['t1','t2','t3','t4','t5'].map((id) => tpl(id));
    const records = [
      rec('vivo1', 't3', '2026-07'),
      ...Array.from({ length: 8 }, (_, i) => orfao(`o${i}`, `2026-${String(i + 1).padStart(2, '0')}`)),
    ];
    const plano = planejarDedupe(templates, records);
    const out = aplicarDedupe(templates, records, plano);

    expect(out.templates).toHaveLength(1);                 // 5 cópias → 1

    // Nada perdido: um dos órfãos cai no mesmo período do registro vivo
    // ('2026-07') e é MESCLADO dentro dele — some da lista de topo, não do
    // acervo. A conta que vale é topo + mesclados.
    const mesclados = out.records.reduce((n, r) => n + (r._duplicatasMescladas?.length ?? 0), 0);
    expect(out.records.length + mesclados).toBe(9);        // ✅ nenhum registro perdido
    expect(mesclados).toBe(1);

    const idsVivos = new Set(out.templates.map((t) => t.id));
    for (const r of out.records) expect(idsVivos.has(r.formId)).toBe(true);  // ✅ zero órfãos
  });

  // Invariante geral, independente do cenário: o acervo nunca encolhe.
  it('INVARIANTE: topo + mesclados == total de entrada, sempre', () => {
    const templates = [tpl('a'), tpl('b'), tpl('c')];
    const records = [
      rec('r1','a','2026-01'), rec('r2','b','2026-01'), rec('r3','c','2026-01'),
      rec('r4','a','2026-02'), orfao('r5','2026-02'), orfao('r6','2026-09'),
    ];
    const plano = planejarDedupe(templates, records);
    const out = aplicarDedupe(templates, records, plano);
    const mesclados = out.records.reduce((n, r) => n + (r._duplicatasMescladas?.length ?? 0), 0);
    expect(out.records.length + mesclados).toBe(records.length);
  });
});
