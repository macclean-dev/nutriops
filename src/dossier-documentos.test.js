import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sectionDocuments, sectionAso, buildDossierHtml } from './dossier';

// ─────────────────────────────────────────────────────────────────────────────
// Candidata 3 da pesquisa de 03/10: o Dossiê Fiscal tinha 9 seções e nenhuma
// mostrava os documentos que o próprio app já controla (alvará, RT, Manual de
// BP, dedetização, reservatório, ASO). A Prontidão calculava tudo isso; o PDF
// que vai pra mão do fiscal não levava nada.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-03T12:00:00').getTime();
const diasAtras = (n) => new Date(NOW - n * 86400000).toISOString();

const TPL_DEDET = { id: 't-dedet', category: 'dedetizacao', frequency: 'monthly' };
const TPL_RESERV = { id: 't-res', category: 'potabilidade', frequency: 'semiannual' };
const TPL_FILTRO = { id: 't-filtro', category: 'potabilidade', frequency: 'biweekly' };
const comprovante = (formId, dias) => ({ id: `r-${formId}-${dias}`, formId, status: 'submitted', createdAt: diasAtras(dias) });

const linhas = (html) => html.split('</tr>').filter((l) => l.includes('<td'));
const linhaDe = (html, documento) => linhas(html).find((l) => l.includes(documento)) ?? '';

describe('sectionDocuments: loja em dia', () => {
  const sec = sectionDocuments({
    companyProfile: { alvara: '123/2026', alvaraValidade: '2027-06-30', rtNome: 'Ana Paula', rtCrn: '1234' },
    complianceDocs: [{ docType: 'manual_bp', versao: '3', issuedAt: '2026-01-10', autor: 'Ana Paula', updatedAt: diasAtras(200) }],
    formTemplates: [TPL_DEDET, TPL_RESERV],
    formRecords: [comprovante('t-dedet', 40), comprovante('t-res', 60)],
    now: NOW,
  });

  it('tem as 5 linhas, na ordem em que o fiscal pede', () => {
    const docs = linhas(sec.rowsHtml).map((l) => l.match(/<td>([^<]*)<\/td>/)[1]);
    expect(docs).toEqual([
      'Alvará sanitário', 'Responsável técnico', 'Manual de Boas Práticas',
      'Dedetização (empresa especializada)', 'Higienização do reservatório de água',
    ]);
  });

  it('alvará mostra número e validade', () => {
    expect(linhaDe(sec.rowsHtml, 'Alvará')).toContain('Válido');
    expect(linhaDe(sec.rowsHtml, 'Alvará')).toContain('Nº 123/2026 · válido até 30/06/2027');
  });

  it('RT com nome e CRN', () => {
    expect(linhaDe(sec.rowsHtml, 'Responsável técnico')).toContain('Ana Paula · CRN 1234');
  });

  it('Manual com versão, data e autor', () => {
    expect(linhaDe(sec.rowsHtml, 'Manual')).toContain('Versão 3, de 10/01/2026, elaborado por Ana Paula');
  });

  it('dedetização e reservatório em dia', () => {
    expect(linhaDe(sec.rowsHtml, 'Dedetização')).toContain('Em dia');
    expect(linhaDe(sec.rowsHtml, 'reservatório')).toContain('Em dia');
  });
});

describe('sectionDocuments: ausência é dita, nunca vira "ok" nem linha vazia', () => {
  const sec = sectionDocuments({ companyProfile: {}, complianceDocs: [], formTemplates: [], formRecords: [], now: NOW });

  it('sem alvará, sem RT, sem Manual', () => {
    expect(linhaDe(sec.rowsHtml, 'Alvará')).toContain('Não informado');
    expect(linhaDe(sec.rowsHtml, 'Responsável técnico')).toContain('Incompleto');
    expect(linhaDe(sec.rowsHtml, 'Manual')).toContain('Não registrado');
  });

  it('loja sem planilha de dedetização (caso da DBK) diz isso, não "em dia"', () => {
    expect(linhaDe(sec.rowsHtml, 'Dedetização')).toContain('Sem planilha');
    expect(linhaDe(sec.rowsHtml, 'Dedetização')).not.toContain('Em dia');
  });

  it('planilha existe mas nunca foi entregue', () => {
    const s = sectionDocuments({ companyProfile: {}, complianceDocs: [], formTemplates: [TPL_RESERV], formRecords: [], now: NOW });
    expect(linhaDe(s.rowsHtml, 'reservatório')).toContain('Nenhum comprovante');
  });
});

describe('sectionDocuments: vencimentos usam a mesma régua da Prontidão', () => {
  it('dedetização passa do prazo configurado pela loja', () => {
    const s = sectionDocuments({
      companyProfile: { dedetizacaoMeses: 3 }, complianceDocs: [],
      formTemplates: [TPL_DEDET], formRecords: [comprovante('t-dedet', 100)], now: NOW,
    });
    expect(linhaDe(s.rowsHtml, 'Dedetização')).toContain('Vencido');
    expect(linhaDe(s.rowsHtml, 'Dedetização')).toContain('prazo de 3 meses');
  });

  it('reservatório perto de vencer avisa os dias que faltam (6 meses = 180 dias)', () => {
    const s = sectionDocuments({
      companyProfile: {}, complianceDocs: [],
      formTemplates: [TPL_RESERV], formRecords: [comprovante('t-res', 170)], now: NOW,
    });
    expect(linhaDe(s.rowsHtml, 'reservatório')).toContain('Vence em 10 dia(s)');
  });

  it('troca de filtro quinzenal NÃO conta como reservatório (precisa ser semestral)', () => {
    const s = sectionDocuments({
      companyProfile: {}, complianceDocs: [],
      formTemplates: [TPL_FILTRO], formRecords: [comprovante('t-filtro', 5)], now: NOW,
    });
    expect(linhaDe(s.rowsHtml, 'reservatório')).toContain('Sem planilha');
  });

  it('alvará vencido diz há quantos dias', () => {
    const s = sectionDocuments({ companyProfile: { alvara: '9', alvaraValidade: '2026-09-23' }, complianceDocs: [], formTemplates: [], formRecords: [], now: NOW });
    expect(linhaDe(s.rowsHtml, 'Alvará')).toContain('Vencido há 10 dia(s)');
  });

  it('alvará sem validade é ressalva, não "válido"', () => {
    const s = sectionDocuments({ companyProfile: { alvara: '9' }, complianceDocs: [], formTemplates: [], formRecords: [], now: NOW });
    expect(linhaDe(s.rowsHtml, 'Alvará')).toContain('Sem validade informada');
  });
});

describe('sectionAso: uma linha por colaborador', () => {
  const staff = [
    { name: 'Maria', role: 'Colaborador' },
    { name: 'João', role: 'Colaborador' },
    { name: 'Rita', role: 'Colaborador' },
    { name: 'Bia', role: 'Colaborador' },
    { name: 'Inativo Silva', role: 'Colaborador', status: 'Inativo' },
    { name: 'Externo', role: 'Colaborador', asoExterno: true },
  ];
  const docs = [
    { docType: 'aso', subject: 'Maria', issuedAt: '2026-03-01', validUntil: '2027-03-01', resultado: 'apto' },
    { docType: 'aso', subject: 'João', issuedAt: '2026-03-01', validUntil: '2027-03-01', resultado: 'inapto' },
    { docType: 'aso', subject: 'Bia', issuedAt: '2025-01-01', validUntil: '2026-01-01', resultado: 'apto' },
    { docType: 'leave_status', subject: 'Bia', leaveType: 'licenca_maternidade', startedAt: '2026-08-01', updatedAt: diasAtras(60) },
  ];
  const sec = sectionAso({ staff, complianceDocs: docs, now: NOW });

  it('inativo e quem é "Só opera aqui" ficam fora (o ASO é do empregador)', () => {
    expect(sec.rowsHtml).not.toContain('Inativo Silva');
    expect(sec.rowsHtml).not.toContain('Externo');
    expect(linhas(sec.rowsHtml)).toHaveLength(4);
  });

  it('em dia mostra validade e resultado', () => {
    const l = linhaDe(sec.rowsHtml, 'Maria');
    expect(l).toContain('01/03/2027');
    expect(l).toContain('Apto');
    expect(l).toContain('Em dia');
  });

  it('"Inapto" dentro do prazo aparece como Inapto, em destaque, não some atrás de "Em dia"', () => {
    const l = linhaDe(sec.rowsHtml, 'João');
    expect(l).toContain('Inapto');
    expect(l).toContain('color:#c0392b');
  });

  it('sem exame diz isso', () => {
    expect(linhaDe(sec.rowsHtml, 'Rita')).toContain('Sem exame registrado');
  });

  it('afastada aparece com o afastamento e fica fora do total', () => {
    expect(linhaDe(sec.rowsHtml, 'Bia')).toContain('Licença maternidade desde 01/08/2026');
    // Maria em dia; João tem validade ok (o resultado é outra coluna); Rita sem
    // exame; Bia afastada sai da conta: 2 de 3, 1 afastado.
    expect(sec.title).toBe('Controle de Saúde dos Manipuladores (ASO): 2 de 3 em dia, 1 afastado(s)');
  });

  it('loja sem equipe cai na mensagem de vazio', () => {
    const s = sectionAso({ staff: [], complianceDocs: [], now: NOW });
    expect(s.rowsHtml).toBe('');
    expect(s.emptyMessage).toContain('Nenhum colaborador ativo');
  });
});

describe('o Dossiê leva as seções novas', () => {
  const view = readFileSync(`${process.cwd()}/src/dossie-view.jsx`, 'utf8');
  const ini = view.indexOf('const sections = [');
  const lista = view.slice(ini, view.indexOf('];', ini));

  it('Documentos é a primeira seção (na visita, documento vem antes de registro)', () => {
    expect(lista.indexOf('sectionDocuments(')).toBeGreaterThan(-1);
    expect(lista.indexOf('sectionDocuments(')).toBeLessThan(lista.indexOf("'Controle de Temperatura'"));
  });

  it('ASO vem logo depois de Capacitação', () => {
    const cap = lista.indexOf("'Capacitação de Colaboradores'");
    const aso = lista.indexOf('sectionAso(');
    expect(cap).toBeGreaterThan(-1);
    expect(aso).toBeGreaterThan(cap);
    expect(aso).toBeLessThan(lista.indexOf('sectionNonConformities('));
  });

  it('as seções saem numeradas no PDF montado', () => {
    const docs = sectionDocuments({ companyProfile: {}, complianceDocs: [], formTemplates: [], formRecords: [], now: NOW });
    const aso = sectionAso({ staff: [], complianceDocs: [], now: NOW });
    const html = buildDossierHtml({ tenantName: 'Loja', periodLabel: '30 dias', companyProfile: {}, sections: [docs, aso], generatedAt: NOW });
    expect(html).toContain('1. Documentos e Situação Legal');
    expect(html).toContain('2. Controle de Saúde dos Manipuladores (ASO)');
  });
});
