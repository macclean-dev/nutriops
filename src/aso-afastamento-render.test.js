import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// A tela (training.jsx) fica travada aqui — sem servidor, sem localStorage
// (o AsoPanel usa efeito por tenant.id, difícil de exercitar sem montar toda
// a TrainingView com router/sessão). O motor (compliance.js) já tem cobertura
// funcional plena em aso-afastamento.test.js; isto trava que a TELA de fato
// usa esse motor do jeito certo — mesmo padrão de auth-error-kind.test.js.
// ─────────────────────────────────────────────────────────────────────────────

const fonte = readFileSync(`${process.cwd()}/src/training.jsx`, 'utf8');

describe('AsoPanel — afastamento não é resultado de exame', () => {
  it('importa o vocabulário certo do motor', () => {
    expect(fonte).toContain('LEAVE_TYPE_LABEL');
    expect(fonte).toContain('currentLeave');
  });

  it('o seletor de situação existe, com as 2 opções pedidas + "Ativa"', () => {
    expect(fonte).toContain('<option value="">Ativa</option>');
    expect(fonte).toContain('Object.entries(LEAVE_TYPE_LABEL).map');
  });

  it('"voltar ao trabalho" apaga o doc em vez de gravar um 3º valor — sem isso currentLeave nunca vê ausência de novo', () => {
    expect(fonte).toContain('mudarAfastamento(s.name, e.target.value || null)');
    expect(fonte).toContain('if (leaveType) {');
  });

  it('delete-then-insert evita linha órfã acumulando na nuvem a cada troca', () => {
    expect(fonte).toContain('deleteComplianceDoc(tenant.id, anterior.id)');
  });

  it('o texto principal da linha muda pra licença quando afastada', () => {
    expect(fonte).toContain('s.leaveType ? LEAVE_TYPE_LABEL[s.leaveType]');
  });

  it('o status real do ASO não é curto-circuitado — continua vindo de employeeAsoStatus, só não pinta a linha', () => {
    // A troca fica em compliance.js (teamAsoSummary sempre chama
    // employeeAsoStatus); aqui só travo que a tela não reimplementou a
    // decisão sozinha com um `if (leaveType) return` que pularia o cálculo.
    expect(fonte).not.toContain('if (s.leaveType) return');
  });

  it('o estado local atualiza ANTES do delete na nuvem — achado no teste manual (24/08): a 1ª versão gatiava setDocs atrás do await e travava a tela em "Licença maternidade" pra sempre quando a nuvem recusava o delete por qualquer motivo real', () => {
    const corpo = fonte.slice(fonte.indexOf('const mudarAfastamento'), fonte.indexOf("const tone = { ok:'ok'"));
    const idxSetDocs = corpo.indexOf('setDocs(proximos)');
    const idxAwaitDelete = corpo.indexOf('const r = await deleteComplianceDoc');
    expect(idxSetDocs).toBeGreaterThan(-1);
    expect(idxAwaitDelete).toBeGreaterThan(-1);
    expect(idxSetDocs).toBeLessThan(idxAwaitDelete);
  });

  it('a tira de resumo ganhou a 5ª coluna', () => {
    expect(fonte).toContain("['leave','Afastada(o)',resumo.leave]");
  });

  it('o botão Atualizar/Registrar ASO continua disponível pra quem está afastada — não trava o cadastro do exame', () => {
    const bloco = fonte.slice(fonte.indexOf('resumo.situacoes.map'), fonte.indexOf('editando === s.name &&'));
    expect(bloco).toContain('onClick={() => abrir(s.name)}');
    expect(bloco).not.toContain('leaveType &&'); // sem guarda escondendo o botão
  });
});

describe('compliance.js já exporta o que a tela precisa', () => {
  const compliance = readFileSync(`${process.cwd()}/src/compliance.js`, 'utf8');

  it('DOC_TYPES.LEAVE existe e não colide com ASO/MANUAL_BP', () => {
    expect(compliance).toContain("LEAVE: 'leave_status'");
  });

  it('teamAsoSummary devolve leaveType por pessoa e contagem "leave" no total', () => {
    expect(compliance).toContain('leaveType: currentLeave(u.name, docs)?.leaveType');
    expect(compliance).toContain('leave:   situacoes.filter');
  });
});
