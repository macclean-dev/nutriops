import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// O modo edição do cadastro de cliente tinha "Gerar novo PIN de configuração ao
// salvar" — logo abaixo de uma caixa dizendo que contas se gerenciam em
// Equipe → Usuários. As duas não podiam estar certas ao mesmo tempo.
//
// Marcar o box REVELAVA um PIN em texto claro. Quem entrasse com ele caía no
// SetupPinScreen, que cria sessão LOCAL sem accessToken (setup-tenant.jsx:206);
// a partir daí `sbHeaders` manda a chave anônima, o RLS recusa com 42501 e a
// loja registra evidência que nunca sai do aparelho — o bug que a v1.9.201
// apagou do cadastro e que ficou vivo na edição.
// ─────────────────────────────────────────────────────────────────────────────

const admin = readFileSync(`${process.cwd()}/src/admin.jsx`, 'utf8');

describe('o gatilho saiu do modo edição', () => {
  it('não existe mais checkbox de gerar PIN', () => {
    expect(admin).not.toContain('Gerar novo PIN de configuração ao salvar');
  });

  it('some o convite a criar PIN pra cliente que não tem', () => {
    expect(admin).not.toContain('Gere um agora pra ele conseguir entrar');
  });

  it('some o texto de regeneração', () => {
    expect(admin).not.toContain('Regenere se o cliente esqueceu o PIN');
  });

  it('o estado `regenerate` foi embora junto — senão fica gatilho órfão', () => {
    expect(admin).not.toContain('setRegenerate');
    expect(admin).not.toMatch(/\bregenerate\b/);
  });

  it('PIN novo agora depende só de ser cliente novo', () => {
    expect(admin).toContain('const needsNewPin   = isNew;');
    expect(admin).not.toContain('isNew || regenerate');
  });
});

describe('o plano B continua de pé — não era ele o problema', () => {
  it('cliente novo ainda gera PIN', () => {
    expect(admin).toContain('setupPinPlain = generateSetupPin(4)');
  });

  it('o PIN ainda é revelado quando a conta de e-mail falha', () => {
    expect(admin).toContain('setGeneratedPin(setupPinPlain)');
    expect(admin).toContain('<SetupPinReveal');
  });

  it('e o aviso de que esse modo NÃO sincroniza continua', () => {
    expect(admin).toContain('NÃO sincroniza com a nuvem');
  });
});

describe('conselho de erro tem que apontar pra algo que existe', () => {
  it('não manda mais usar um botão aposentado', () => {
    // Só o TEXTO que a pessoa lê. O comentário logo acima da mensagem cita o
    // rótulo antigo de propósito, pra quem for ler o código daqui a um ano
    // entender por que a frase mudou — proibir a menção histórica junto
    // castigaria justamente a documentação do conserto.
    const mensagens = admin.match(/setPushError\([\s\S]*?\);/g)?.join('\n') ?? '';
    expect(mensagens).not.toContain('use "Editar (regerar PIN)"');
    expect(mensagens).not.toContain('Editar (regerar PIN)');
  });

  it('manda salvar pelo Editar, que de fato reenvia', () => {
    expect(admin).toContain('abra "Editar" e salve');
  });

  it('e lembra do segundo passo, porque salvar não recria conta', () => {
    // criarContaDoCliente roda só `if (isNew ...)` — reeditar não tenta de novo
    expect(admin).toContain('if (isNew && !pushFailed)');
    expect(admin).toMatch(/Depois crie as contas em Equipe → Usuários/);
  });
});

describe('a caixa que diz a verdade continua lá', () => {
  it('aponta Equipe → Usuários pras contas', () => {
    expect(admin).toContain('Convidar colaborador');
    expect(admin).toContain('Vincular conta existente');
  });
});
