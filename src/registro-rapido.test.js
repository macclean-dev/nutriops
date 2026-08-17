import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { suspectMissingMinus, resolveTone } from './limits';

// ─────────────────────────────────────────────────────────────────────────────
// CASA DOCE, 17/08: a supervisora da gelateria mediu às 06:30 pelo celular e a
// leitura nunca existiu — nem na nuvem, nem no aparelho dela.
//
// O registro rápido (QuickRegisterModal, overview-v2.jsx) bloqueia quando
// suspeita de sinal trocado. O bloqueio estava CERTO; o que estava errado era
// ser MUDO: `save()` dava `return` e o botão continuava verde escrito
// "Registrar". Toca, não acontece nada, ninguém é avisado.
//
// É a terceira vez que a mesma armadilha aparece — teclado do quiosque
// (v1.9.143) e agora aqui. Estes testes travam a regra dos DOIS lados: quando
// bloqueia, e que estando bloqueado o botão NÃO pode parecer pronto.
//
// A derivação abaixo é a mesma do componente (não temos testing-library no
// projeto; a lógica é o que decide, o JSX só a reflete).
// ─────────────────────────────────────────────────────────────────────────────

const estadoDoBotao = ({ value, min, max, insistiuPositivo = false, saving = false }) => {
  const numericValue = Number(value);
  const hasValue = value !== '' && !isNaN(numericValue);
  const faltouMenos = hasValue && suspectMissingMinus(numericValue, min, max);
  const bloqueadoPeloSinal = faltouMenos && !insistiuPositivo;
  return {
    bloqueadoPeloSinal,
    disabled: !hasValue || saving || bloqueadoPeloSinal,
    rotulo: saving ? 'Salvando…' : bloqueadoPeloSinal ? 'Confirme o sinal acima' : 'Registrar',
    gravaria: hasValue && !saving && !bloqueadoPeloSinal,
  };
};

// Vitrine de gelato: faixa negativa, e o celular não tem tecla de menos com
// inputMode="decimal" — é exatamente a combinação que produziu o incidente.
const GELATERIA = { min: -18, max: -12 };

describe('registro rápido — o bloqueio de sinal não pode ser mudo', () => {
  it('18 numa vitrine de −18/−12 bloqueia (foi o caso real)', () => {
    const b = estadoDoBotao({ value: '18', ...GELATERIA });
    expect(b.bloqueadoPeloSinal).toBe(true);
    expect(b.gravaria).toBe(false);
  });

  it('bloqueado ⇒ o botão está desabilitado E diz por quê', () => {
    const b = estadoDoBotao({ value: '18', ...GELATERIA });
    expect(b.disabled).toBe(true);                       // ✅ não parece pronto
    expect(b.rotulo).toBe('Confirme o sinal acima');     // ✅ e explica
  });

  // A regressão: antes, `disabled` só olhava hasValue/saving. O botão ficava
  // verde, clicável, escrito "Registrar" — e o save() voltava calado.
  it('a combinação proibida é botão-que-parece-pronto + save que não grava', () => {
    const b = estadoDoBotao({ value: '18', ...GELATERIA });
    const pareceProto = !b.disabled && b.rotulo === 'Registrar';
    expect(pareceProto && !b.gravaria).toBe(false);
  });

  it('corrigir o sinal destrava e grava', () => {
    const b = estadoDoBotao({ value: '-18', ...GELATERIA });
    expect(b.bloqueadoPeloSinal).toBe(false);
    expect(b.disabled).toBe(false);
    expect(b.rotulo).toBe('Registrar');
    expect(b.gravaria).toBe(true);
  });

  it('insistir no positivo também destrava — a pessoa tem a última palavra', () => {
    const b = estadoDoBotao({ value: '18', ...GELATERIA, insistiuPositivo: true });
    expect(b.disabled).toBe(false);
    expect(b.gravaria).toBe(true);
  });

  it('desvio real negativo NÃO é confundido com sinal trocado', () => {
    // −5 numa vitrine de −18/−12 é a gelateria não gelando: tem que gravar,
    // é justamente a evidência que a RDC quer. Bloquear aqui esconderia falha.
    const b = estadoDoBotao({ value: '-5', ...GELATERIA });
    expect(resolveTone(-5, GELATERIA.min, GELATERIA.max)).toBe('danger');
    expect(b.bloqueadoPeloSinal).toBe(false);
    expect(b.gravaria).toBe(true);
  });

  it('equipamento de faixa positiva nunca cai nesse bloqueio', () => {
    // Refrigerador 0/5: +18 é desvio real, não dedo escorregando no menos.
    const b = estadoDoBotao({ value: '18', min: 0, max: 5 });
    expect(b.bloqueadoPeloSinal).toBe(false);
    expect(b.gravaria).toBe(true);
  });

  it('campo vazio: desabilitado, mas sem acusar sinal', () => {
    const b = estadoDoBotao({ value: '', ...GELATERIA });
    expect(b.disabled).toBe(true);
    expect(b.bloqueadoPeloSinal).toBe(false);
    expect(b.rotulo).toBe('Registrar');
  });

  it('durante o salvamento o rótulo é o de salvar, não o de bloqueio', () => {
    const b = estadoDoBotao({ value: '-18', ...GELATERIA, saving: true });
    expect(b.rotulo).toBe('Salvando…');
    expect(b.gravaria).toBe(false);   // não dispara duas vezes
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Os testes acima replicam a derivação — não veriam o componente voltar a
// mentir. Estes olham o código-fonte, que é onde a regressão moraria. Grosseiro,
// mas é o guarda que `repository.test.js` já usa pras policies de RLS, e pega
// exatamente o que se perdeu: o botão desamarrado do bloqueio.
// ─────────────────────────────────────────────────────────────────────────────
describe('overview-v2.jsx — o botão continua amarrado ao bloqueio', () => {
  // `import.meta.url` vira http:// sob jsdom — o caminho sai da raiz do projeto.
  const fonte = readFileSync(`${process.cwd()}/src/overview-v2.jsx`, 'utf8');

  it('o disabled do botão inclui bloqueadoPeloSinal', () => {
    const botao = fonte.match(/<button onClick=\{save\} disabled=\{[^}]*\}/)?.[0] ?? '';
    expect(botao).toContain('bloqueadoPeloSinal');
  });

  it('existe rótulo próprio pro estado bloqueado — não só cinza mudo', () => {
    expect(fonte).toContain('Confirme o sinal acima');
  });

  it('o card do modal rola (celular com teclado aberto não pode prender o botão)', () => {
    expect(fonte).toMatch(/maxHeight:'calc\(100dvh - 48px\)',\s*overflowY:'auto'/);
  });

  // ─── A confirmação de que salvou ─────────────────────────────────────────
  // O que faltava desde sempre: sucesso e "fechei sem querer" eram a MESMA
  // tela. A tela inicial confirma desde o começo — e é a única que a
  // nutricionista diz que funciona. Não é coincidência.
  it('sucesso vira estado visível, não um fechar calado', () => {
    expect(fonte).toContain("setEstado('salvo')");
    expect(fonte).toMatch(/role="status"/);
    expect(fonte).toContain('✓ Registrado:');
  });

  it('a confirmação repete o valor gravado — confirmar sem dizer o quê não pega dedo errado', () => {
    expect(fonte).toMatch(/✓ Registrado: \{numericValue\}°C em \{equipment\.label\}/);
  });

  it('falha ao salvar aparece — o save tem catch, não só finally', () => {
    expect(fonte).toContain("setEstado('erro')");
    expect(fonte).toMatch(/Não foi possível salvar/);
  });

  it('tocar fora NÃO descarta um número já digitado', () => {
    expect(fonte).toMatch(/const fecharPeloFundo = \(\) => \{ if \(!hasValue/);
    expect(fonte).toContain('onClick={fecharPeloFundo}');
    // e o backdrop não chama mais onClose direto
    expect(fonte).not.toMatch(/<div onClick=\{onClose\} style=\{\{\s*position:'fixed', inset:0, zIndex:1000/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inventário dos caminhos de gravação de temperatura, pra próxima vez que
// alguém mexer nisso. Os três bloqueiam pela MESMA regra (suspectMissingMinus)
// e cada um avisa do seu jeito:
//   • tela principal (pages.jsx) — window.confirm, impossível de não ver
//   • quiosque (kiosk.jsx)       — faixa vermelha acima do teclado (v1.9.143)
//   • registro rápido            — botão desabilitado e rotulado (este arquivo)
// Caminho novo entra nesta lista COM o aviso já resolvido.
// ─────────────────────────────────────────────────────────────────────────────
