import { describe, it, expect } from 'vitest';
import {
  computeReadiness, computeVerdict, countByStatus, byWorstStatus,
  productDaysLeft, popMatchesRequirement, missingRequiredPOPs, recurrentCriticalEquipment,
  READINESS_DEFAULTS, REQUIRED_POPS, VERDICT_LABEL,
} from './readiness';

const NOW = new Date('2026-08-15T14:30:00').getTime();
const dia = (n) => NOW - n * 86400000;
const iso = (n) => new Date(dia(n)).toISOString();

// Loja hipoteticamente perfeita: tudo que o grupo A cobra, respondido. Serve
// de base — cada teste estraga UMA coisa e olha o veredito.
const lojaOk = (over = {}) => ({
  tenant: { id: 'swiss', name: 'Swiss' },
  now: NOW,
  pendingNc: [],
  products: [{ name: 'Queijo', expiryDate: '2026-12-01' }],
  turnAlerts: [],
  catalog: [{ label: 'Freezer 1' }],
  temperatureRecords: [{ equipment: 'Freezer 1', value: -20, min: -25, max: -18, createdAt: iso(1) }],
  staff: [{ name: 'Ana', status: 'Ativo' }],
  trainingSessions: [{ status: 'closed', date: '2026-08-01', participants: [{ name: 'Ana', confirmed: true }] }],
  trainingValidityMonths: 12,
  formTemplates: [{ id: 'ded', category: 'dedetizacao', title: 'Controle de Dedetização' }],
  formRecords: [{ id: 'r1', formId: 'ded', status: 'submitted', validation: { at: iso(10) }, updatedAt: iso(10), createdAt: iso(10) }],
  pendingForms: [],
  pops: REQUIRED_POPS.map((r) => ({ title: r.label, category: r.categories[0] ?? 'outros' })),
  companyProfile: { rtNome: 'Ana Paula', rtCrn: 'CRN-1 12345', alvara: '123/2026' },
  controlsByType: {},
  sync: { enabled: true, lastSync: iso(1), queueLength: 0 },
  localOnly: { pops: 0, training: 0, maintenance: 0 },
  ...over,
});

const check = (r, id) => r.groups.flatMap((g) => g.checks).find((c) => c.id === id);

describe('computeVerdict', () => {
  const g = (id, ...statuses) => ({ id, title: id, checks: statuses.map((status, i) => ({ id: `${id}${i}`, status })) });

  it('FAIL no grupo A ⇒ EM RISCO', () => {
    expect(computeVerdict([g('A', 'fail', 'ok'), g('B', 'ok')])).toBe('risk');
  });

  it('fail/warn em B ou C ⇒ apenas RESSALVAS, nunca risco', () => {
    expect(computeVerdict([g('A', 'ok'), g('B', 'fail'), g('C', 'ok')])).toBe('attention');
    expect(computeVerdict([g('A', 'ok'), g('B', 'ok'), g('C', 'warn')])).toBe('attention');
  });

  it('unknown no grupo A ⇒ RESSALVAS — ausência de dado NÃO é conformidade', () => {
    expect(computeVerdict([g('A', 'unknown', 'ok'), g('B', 'ok')])).toBe('attention');
  });

  // A regra que mais importa defender na frente do dono: sem dado é sem dado,
  // não é infração comprovada.
  it('unknown NUNCA vira EM RISCO, nem com o grupo A inteiro sem dado', () => {
    expect(computeVerdict([g('A', 'unknown', 'unknown', 'unknown'), g('B', 'unknown')])).toBe('attention');
  });

  it('unknown fora do grupo A não puxa o veredito sozinho', () => {
    expect(computeVerdict([g('A', 'ok'), g('B', 'unknown'), g('C', 'unknown')])).toBe('ready');
  });

  it('tudo ok ⇒ PRONTA', () => {
    expect(computeVerdict([g('A', 'ok', 'ok'), g('B', 'ok')])).toBe('ready');
  });
});

describe('productDaysLeft', () => {
  it('usa a validade pós-abertura quando o produto foi aberto', () => {
    const p = { expiryDate: '2026-12-01', openedUntil: '2026-08-18T10:00:00.000Z' };
    expect(productDaysLeft(p, NOW)).toBe(3);
  });

  it('produto vencido devolve negativo', () => {
    expect(productDaysLeft({ expiryDate: '2026-08-10' }, NOW)).toBe(-5);
  });

  it('sem data devolve null, NÃO zero — é ausência de dado', () => {
    expect(productDaysLeft({ name: 'sem validade' }, NOW)).toBeNull();
  });
});

describe('missingRequiredPOPs', () => {
  it('casa por categoria do módulo de POPs', () => {
    const pops = [{ title: 'Qualquer coisa', category: 'pragas' }];
    expect(missingRequiredPOPs(pops).map((p) => p.id)).not.toContain('pragas');
  });

  it('casa por palavra do título quando não há categoria equivalente (reservatório)', () => {
    const pops = [{ title: 'Higienização do reservatório de água', category: 'outros' }];
    expect(missingRequiredPOPs(pops).map((p) => p.id)).not.toContain('reservatorio');
  });

  it('sem nenhum POP, os 4 obrigatórios faltam', () => {
    expect(missingRequiredPOPs([])).toHaveLength(4);
  });

  it('popMatchesRequirement ignora caixa e acento na categoria', () => {
    expect(popMatchesRequirement({ category: 'PRAGAS' }, REQUIRED_POPS[1])).toBe(true);
  });
});

describe('recurrentCriticalEquipment', () => {
  const leitura = (equipment, value) => ({ equipment, value, min: -25, max: -18 });

  it('agrupa por equipamento e só acusa quem repetiu o crítico', () => {
    const out = recurrentCriticalEquipment([
      leitura('Freezer 1', 30), leitura('Freezer 1', 28),
      leitura('Freezer 2', 30), leitura('Freezer 2', -20),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].equipment).toBe('Freezer 1');
    expect(out[0].danger).toBe(2);
  });

  it('desvio leve (dentro dos 3° de tolerância) não é crítico', () => {
    expect(recurrentCriticalEquipment([leitura('Freezer 1', -16), leitura('Freezer 1', -16)])).toHaveLength(0);
  });
});

describe('computeReadiness — grupo A manda no veredito', () => {
  it('NC sem ação corretiva ⇒ EM RISCO', () => {
    const r = computeReadiness(lojaOk({ pendingNc: [{ source: 'temperature', sourceId: '1' }] }));
    expect(r.verdict).toBe('risk');
    expect(check(r, 'a1-nc-sem-acao').status).toBe('fail');
    expect(check(r, 'a1-nc-sem-acao').navTarget).toBe('actions');
  });

  it('produto vencido no estoque ⇒ EM RISCO', () => {
    const r = computeReadiness(lojaOk({ products: [{ name: 'Presunto', expiryDate: '2026-08-10' }] }));
    expect(r.verdict).toBe('risk');
    expect(check(r, 'a2-vencidos').detail).toContain('Presunto');
  });

  it('estoque vazio é "sem dado", não "em ordem"', () => {
    const r = computeReadiness(lojaOk({ products: [] }));
    expect(check(r, 'a2-vencidos').status).toBe('unknown');
    expect(r.verdict).toBe('attention');
  });

  it('turno encerrado sem registro ⇒ fail; só turno em andamento ⇒ warn', () => {
    const atrasado = computeReadiness(lojaOk({ turnAlerts: [{ level: 'danger', equipment: 'Freezer 1' }] }));
    expect(check(atrasado, 'a3-turno').status).toBe('fail');
    expect(atrasado.verdict).toBe('risk');

    const pendente = computeReadiness(lojaOk({ turnAlerts: [{ level: 'warn', equipment: 'Freezer 1' }] }));
    expect(check(pendente, 'a3-turno').status).toBe('warn');
    expect(pendente.verdict).toBe('attention');
  });

  // `turnAlerts` tem um item por par turno×equipamento: contar o array cru
  // dizia "20 equipamentos" numa loja de 10, porque o mesmo freezer conta uma
  // vez por turno vencido.
  it('A3 conta EQUIPAMENTOS distintos, não pares turno×equipamento', () => {
    const r = computeReadiness(lojaOk({
      catalog: [{ label: 'Freezer 1' }, { label: 'Geladeira 2' }],
      turnAlerts: [
        { level: 'danger', equipment: 'Freezer 1' }, { level: 'danger', equipment: 'Freezer 1' },
        { level: 'danger', equipment: 'Geladeira 2' },
      ],
    }));
    expect(check(r, 'a3-turno').detail).toContain('2 equipamentos ficaram');
    expect(check(r, 'a3-turno').detail).not.toContain('3 equipamentos');
  });

  it('equipamento atrasado E pendente no turno atual não é contado duas vezes', () => {
    const r = computeReadiness(lojaOk({
      turnAlerts: [
        { level: 'danger', equipment: 'Freezer 1' },
        { level: 'warn',   equipment: 'Freezer 1' },
        { level: 'warn',   equipment: 'Geladeira 2' },
      ],
    }));
    expect(check(r, 'a3-turno').detail).toContain('1 equipamento ficou');
    expect(check(r, 'a3-turno').detail).toContain('mais 1 está(ão) pendente(s)');
  });

  it('catálogo vazio ⇒ "sem dado", nunca "todos os turnos em ordem"', () => {
    const r = computeReadiness(lojaOk({ catalog: [] }));
    expect(check(r, 'a3-turno').status).toBe('unknown');
    expect(check(r, 'a3-turno').navTarget).toBe('equipment');
  });

  it('loja em implantação não é cobrada por turno (CASA DOCE)', () => {
    const r = computeReadiness(lojaOk({
      tenant: { id: 'casadoce', name: 'CASA DOCE', implantacao: true },
      turnAlerts: [],
    }));
    expect(check(r, 'a3-turno').status).toBe('ok');
    expect(check(r, 'a3-turno').detail).toContain('implantação');
  });

  it('desvio crítico repetido no mesmo equipamento ⇒ EM RISCO', () => {
    const fora = (n) => ({ equipment: 'Freezer 1', value: 30, min: -25, max: -18, createdAt: iso(n) });
    const r = computeReadiness(lojaOk({ temperatureRecords: [fora(1), fora(2)] }));
    expect(check(r, 'a3-desvio').status).toBe('fail');
    expect(r.verdict).toBe('risk');
  });

  it('sem leitura nenhuma na janela ⇒ "sem dado", não 100% de conformidade', () => {
    const r = computeReadiness(lojaOk({ temperatureRecords: [] }));
    expect(check(r, 'a3-desvio').status).toBe('unknown');
  });

  it('colaborador ativo nunca capacitado ⇒ EM RISCO, com aviso de dado local', () => {
    const r = computeReadiness(lojaOk({ trainingSessions: [] }));
    expect(check(r, 'a4-capacitacao').status).toBe('fail');
    expect(check(r, 'a4-capacitacao').detail).toContain('localStorage');
    expect(r.verdict).toBe('risk');
  });

  it('colaborador inativo não conta como pendência de capacitação', () => {
    const r = computeReadiness(lojaOk({
      staff: [{ name: 'Ana', status: 'Ativo' }, { name: 'Fantasma', status: 'Inativo' }],
    }));
    expect(check(r, 'a4-capacitacao').status).toBe('ok');
  });

  // A tela Equipe tem TRÊS status, e "Pendente" loga e registra igual — o
  // filtro estrito por 'Ativo' escondia um manipulador sem capacitação nenhuma.
  it('colaborador "Pendente" É cobrado — ele opera na loja como qualquer outro', () => {
    const r = computeReadiness(lojaOk({
      staff: [{ name: 'Ana', status: 'Ativo' }, { name: 'Novato', status: 'Pendente' }],
    }));
    expect(check(r, 'a4-capacitacao').status).toBe('fail');
    expect(check(r, 'a4-capacitacao').detail).toContain('Novato');
    expect(r.verdict).toBe('risk');
  });

  it('dedetização mais velha que a régua de 6 meses ⇒ EM RISCO', () => {
    const velha = { id: 'r1', formId: 'ded', status: 'submitted', updatedAt: iso(200), createdAt: iso(200) };
    const r = computeReadiness(lojaOk({ formRecords: [velha] }));
    expect(check(r, 'a5-dedetizacao').status).toBe('fail');
    expect(check(r, 'a5-dedetizacao').detail).toContain(`${READINESS_DEFAULTS.dedetizacaoMeses} meses`);
  });

  // A RT validar a planilha reescreve `updatedAt` sem mudar o conteúdo — uma
  // dedetização de 8 meses atrás não pode "rejuvenescer" por causa disso.
  it('validação da RT hoje NÃO rejuvenesce uma dedetização vencida', () => {
    const vencidaMasValidadaHoje = {
      id: 'r1', formId: 'ded', status: 'submitted',
      createdAt: iso(240), updatedAt: iso(0), validation: { at: iso(0) },
    };
    const r = computeReadiness(lojaOk({ formRecords: [vencidaMasValidadaHoje] }));
    expect(check(r, 'a5-dedetizacao').status).toBe('fail');
    expect(check(r, 'a5-dedetizacao').detail).toContain('240 dias');
  });

  it('planilha de dedetização nunca preenchida é "sem dado", não pendência', () => {
    const r = computeReadiness(lojaOk({ formRecords: [] }));
    expect(check(r, 'a5-dedetizacao').status).toBe('unknown');
    expect(r.verdict).toBe('attention');
  });

  it('rascunho de dedetização não conta como comprovante', () => {
    const rascunho = { id: 'r1', formId: 'ded', status: 'draft', updatedAt: iso(1), createdAt: iso(1) };
    const r = computeReadiness(lojaOk({ formRecords: [rascunho] }));
    expect(check(r, 'a5-dedetizacao').status).toBe('unknown');
  });

  // Fatia 1 lê só o que já existe — estes dois não têm captura nenhuma ainda.
  it('reservatório e ASO são sempre "sem dado" nesta fatia, com o caminho pra Fatia 2', () => {
    const r = computeReadiness(lojaOk());
    for (const id of ['a6-reservatorio', 'a7-aso']) {
      expect(check(r, id).status).toBe('unknown');
      expect(check(r, id).detail).toContain('Fatia 2');
      expect(check(r, id).navTarget).toBeNull();
    }
  });

  // Consequência assumida da regra acima — vale um teste pra ninguém "consertar"
  // isso por engano depois.
  it('enquanto reservatório/ASO não tiverem captura, nenhuma loja lê PRONTA', () => {
    const r = computeReadiness(lojaOk());
    expect(r.verdict).toBe('attention');
    expect(VERDICT_LABEL[r.verdict]).toBe('PRONTA COM RESSALVAS');
  });
});

describe('computeReadiness — grupos B, C e D', () => {
  it('RT/CRN vazios ⇒ fail, mas sem virar EM RISCO (é grupo B)', () => {
    const r = computeReadiness(lojaOk({ companyProfile: { alvara: '1' } }));
    expect(check(r, 'b1-rt-crn').status).toBe('fail');
    expect(r.verdict).toBe('attention');
  });

  it('alvará preenchido é ok COM a ressalva de que a validade não é rastreada', () => {
    const r = computeReadiness(lojaOk());
    expect(check(r, 'b2-alvara').status).toBe('ok');
    expect(check(r, 'b2-alvara').detail).toContain('VALIDADE');
  });

  it('POP faltando é ressalva, não pendência — o POP pode existir em papel', () => {
    const r = computeReadiness(lojaOk({ pops: [] }));
    expect(check(r, 'b3-pops').status).toBe('warn');
  });

  it('planilhas do período em aberto ⇒ ressalva com os títulos', () => {
    const r = computeReadiness(lojaOk({ pendingForms: [{ title: 'Higiene Pessoal' }] }));
    expect(check(r, 'c1-planilhas').status).toBe('warn');
    expect(check(r, 'c1-planilhas').detail).toContain('Higiene Pessoal');
  });

  it('planilha entregue sem validação da RT ⇒ ressalva', () => {
    const semValidacao = { id: 'r2', formId: 'ded', status: 'submitted', updatedAt: iso(1), createdAt: iso(1) };
    const r = computeReadiness(lojaOk({ formRecords: [semValidacao] }));
    expect(check(r, 'c2-validacao-rt').status).toBe('warn');
  });

  it('sem fritadeira no catálogo, controle de óleo é "sem dado" — nunca pendência', () => {
    const r = computeReadiness(lojaOk());
    expect(check(r, 'c3-controles').status).toBe('unknown');
  });

  it('com fritadeira e nenhum teste no ciclo ⇒ ressalva', () => {
    const r = computeReadiness(lojaOk({ catalog: [{ label: 'Fritadeira 1' }], controlsByType: { oil: [] } }));
    expect(check(r, 'c3-controles').status).toBe('warn');
    expect(check(r, 'c3-controles').navTarget).toBe('oil');
  });

  it('com fritadeira e teste dentro do ciclo ⇒ ok', () => {
    const r = computeReadiness(lojaOk({
      catalog: [{ label: 'Fritadeira 1' }],
      controlsByType: { oil: [{ createdAt: iso(3) }] },
    }));
    expect(check(r, 'c3-controles').status).toBe('ok');
  });

  it('Supabase desligado ⇒ fail no grupo D (evidência não sobrevive), sem virar risco', () => {
    const r = computeReadiness(lojaOk({ sync: { enabled: false, lastSync: null, queueLength: 0 } }));
    expect(check(r, 'd1-sync').status).toBe('fail');
    expect(r.verdict).toBe('attention');
  });

  it('fila offline com item ⇒ ressalva', () => {
    const r = computeReadiness(lojaOk({ sync: { enabled: true, lastSync: iso(1), queueLength: 3 } }));
    expect(check(r, 'd2-fila').status).toBe('warn');
    expect(check(r, 'd2-fila').detail).toContain('3 registros');
  });

  it('POPs/capacitação/manutenção presentes ⇒ aviso de "existe só neste aparelho"', () => {
    const r = computeReadiness(lojaOk({ localOnly: { pops: 4, training: 2, maintenance: 0 } }));
    expect(check(r, 'd3-local-only').status).toBe('warn');
    expect(check(r, 'd3-local-only').detail).toContain('4 POPs');
    expect(check(r, 'd3-local-only').detail).not.toContain('manutenção');
  });
});

describe('estrutura do retorno', () => {
  it('devolve 4 grupos identificados de A a D', () => {
    const r = computeReadiness(lojaOk());
    expect(r.groups.map((g) => g.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(r.tenantName).toBe('Swiss');
  });

  it('todo check tem os 6 campos do contrato', () => {
    const r = computeReadiness(lojaOk());
    for (const c of r.groups.flatMap((g) => g.checks)) {
      expect(Object.keys(c).sort()).toEqual(['detail', 'id', 'label', 'navTarget', 'severity', 'status'].sort());
      expect(['ok', 'warn', 'fail', 'unknown']).toContain(c.status);
    }
  });

  it('countByStatus soma exatamente o número de checks', () => {
    const r = computeReadiness(lojaOk());
    const total = r.groups.reduce((n, g) => n + g.checks.length, 0);
    const c = countByStatus(r.groups);
    expect(c.ok + c.warn + c.fail + c.unknown).toBe(total);
    expect(c).toEqual(r.counts);
  });

  it('byWorstStatus ordena pendência → ressalva → sem dado → em ordem', () => {
    const lista = [{ status: 'ok' }, { status: 'unknown' }, { status: 'fail' }, { status: 'warn' }];
    expect([...lista].sort(byWorstStatus).map((c) => c.status)).toEqual(['fail', 'warn', 'unknown', 'ok']);
  });

  it('não quebra com inputs vazios (loja recém-criada)', () => {
    const r = computeReadiness({ tenant: { id: 'nova', name: 'Nova' }, now: NOW });
    expect(r.verdict).toBe('attention');
    expect(r.groups.flatMap((g) => g.checks).length).toBeGreaterThan(10);
  });
});
