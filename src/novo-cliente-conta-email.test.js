import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateInitialPassword } from './crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Achado em PRODUÇÃO (21/08), pelo dono, ao cadastrar um cliente de teste pelo
// Super Admin: caiu na tela "Crie seu PIN definitivo" — o modelo de PIN que
// foi APOSENTADO na v1.9.99.
//
// Não era só um resquício de UI. O SetupPinScreen cria sessão LOCAL, sem
// accessToken. Sem token, `sbHeaders` (repository.js) só anexa o JWT
// `if (tenantId)` e a requisição sai com a CHAVE ANÔNIMA — que o RLS recusa
// com 42501, porque a policy chama `is_member()`, revogada de anon. Ou seja:
// TODO cliente cadastrado pelo "+ Novo cliente" nascia sem sincronizar nada,
// em silêncio, e só descobriria quando fosse buscar a evidência pro fiscal.
//
// É o mesmo mecanismo dos outros dois bugs do dia (banner falso do
// healthcheck, sync do admin global): tenantId/credencial faltando levando
// requisição pra anon. Aqui o efeito era o pior dos três.
//
// Correção: o cadastro passa a criar a conta de e-mail de verdade, pelo MESMO
// caminho já provado do convite de colaborador.
// ─────────────────────────────────────────────────────────────────────────────

const admin  = readFileSync(`${process.cwd()}/src/admin.jsx`, 'utf8');
const crypto = readFileSync(`${process.cwd()}/src/crypto.js`, 'utf8');
const repo   = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');

describe('o mecanismo que tornava isso grave — travado pra não regredir', () => {
  it('sem tenantId/JWT a requisição sai como anon', () => {
    // Não é defeito de sbHeaders, é o contrato dela. O teste existe pra
    // deixar explícito por que uma sessão SEM accessToken (a que o
    // SetupPinScreen criava) não consegue gravar nada na nuvem.
    expect(repo).toContain('async function sbHeaders(tenantId) {');
    expect(repo).toMatch(/if \(tenantId\) \{\s*\n\s*const jwt = await memberTokenFor\(tenantId\);/);
  });

  it('memberTokenFor exige sessão — PIN não tem accessToken pra dar', () => {
    const ini = repo.indexOf('async function memberTokenFor(tenantId) {');
    const corpo = repo.slice(ini, repo.indexOf('async function sbHeaders', ini));
    expect(corpo).toContain('getValidAccessToken');
  });
});

describe('criarContaDoCliente — usa o caminho já provado do convite', () => {
  const fn = (() => {
    const ini = admin.indexOf('async function criarContaDoCliente(');
    return admin.slice(ini, admin.indexOf('\n}', admin.indexOf('return { ok: false, erro: e2', ini)));
  })();

  it('cria a conta pela Edge Function, com papel de dono da loja', () => {
    expect(fn).toContain("await inviteCollaborator({ email, name: nome, role: 'tenant_admin', tenantId, password: senha });");
  });

  it('e-mail que JÁ existe vira vínculo, nunca segunda conta', () => {
    // Duas contas pra mesma pessoa dividem os registros dela na trilha de
    // auditoria — e o caso é real (dono com mais de uma unidade, RT que
    // cobre várias lojas).
    expect(fn).toMatch(/const jaExiste = \/já existe\|already\|exist\|registered\/i\.test/);
    expect(fn).toContain("await linkExistingMember({ tenantId, email, role: 'tenant_admin' });");
    expect(fn).toContain('vinculada: true');
  });

  it('NUNCA lança — o cliente já está salvo quando isto roda', () => {
    // Derrubar o cadastro inteiro porque a criação de conta falhou seria pior
    // que o problema. Devolve {ok:false, erro} e quem chama decide.
    expect(fn).toContain("return { ok: false, erro: e?.message ?? 'erro ao criar conta' };");
    expect(fn).toContain("return { ok: false, erro: e2?.message ?? 'erro ao vincular conta existente' };");
    expect(fn).not.toMatch(/throw /);
  });

  it('só roda pra cliente NOVO e que chegou na nuvem', () => {
    // Editar cliente existente não pode recriar conta; e cliente que não subiu
    // não tem onde vincular (a RPC exige a empresa existir).
    expect(admin).toContain('if (isNew && !pushFailed) {');
  });
});

describe('o desfecho do modal', () => {
  it('conta criada VENCE o PIN — o cliente nunca vê o ?token=', () => {
    expect(admin).toContain('} else if (conta?.ok) {');
    expect(admin).toContain('{!novaConta && generatedPin && (');
  });

  it('`conta?.ok`, não `conta` — senão o erro cairia na tela de credenciais', () => {
    // criarContaDoCliente devolve {ok:false} em caso de falha, que é truthy.
    // Sem o `.ok` o admin veria "Copie agora" com e-mail e senha vazios.
    expect(admin).not.toContain('} else if (conta) {');
  });

  it('falha ao criar conta AVISA — silenciar recriaria o bug', () => {
    expect(admin).toContain('if (conta && !conta.ok) {');
    expect(admin).toMatch(/NÃO sincroniza com a nuvem/);
  });
});

describe('CredenciaisReveal — a senha aparece uma vez só', () => {
  const comp = (() => {
    const ini = admin.indexOf('function CredenciaisReveal({ conta, onAck }) {');
    return admin.slice(ini, admin.indexOf('\n// ─── Conta de e-mail do cliente novo', ini));
  })();

  it('mostra e-mail e senha, e o texto copiável traz o site junto', () => {
    expect(comp).toContain('conta.email');
    expect(comp).toContain('conta.senha');
    expect(comp).toContain('https://nutriops.uniwares.net');
  });

  it('conta VINCULADA não promete senha nova', () => {
    // Quem já tinha conta continua com a senha dela — dizer "senha inicial" ali
    // faria o admin mandar uma senha que não existe.
    expect(comp).toContain("conta.senha ?? 'a que ela já usa hoje'");
    expect(comp).toMatch(/não crie uma segunda conta pra mesma pessoa/);
  });

  it('falha de clipboard fica visível — o fallback é ler da tela', () => {
    // Mesmo defeito já corrigido no SetupPinReveal: catch vazio fazia o admin
    // colar pro cliente o conteúdo ANTIGO do clipboard.
    expect(comp).toContain('if (!navigator.clipboard?.writeText) {');
    expect(comp).toContain("'✕ Falha — copie manualmente'");
  });

  it('manda a senha por canal separado do e-mail', () => {
    expect(comp).toMatch(/canal separado/);
  });
});

describe('generateInitialPassword', () => {
  it('tem o tamanho pedido e respeita o mínimo de 8 da Edge Function', () => {
    expect(generateInitialPassword()).toHaveLength(10);
    expect(generateInitialPassword(16)).toHaveLength(16);
    expect(generateInitialPassword().length).toBeGreaterThanOrEqual(8);
  });

  it('não usa caracteres que se confundem ao ditar por telefone', () => {
    // 0/O e 1/l/I são o que mais gera "não consigo entrar" quando a senha é
    // passada por WhatsApp ou ligação.
    const amostra = Array.from({ length: 200 }, () => generateInitialPassword()).join('');
    expect(amostra).not.toMatch(/[0O1lI]/);
  });

  it('não repete — é senha, não sequência', () => {
    const geradas = new Set(Array.from({ length: 500 }, () => generateInitialPassword()));
    expect(geradas.size).toBe(500);
  });

  it('usa crypto.getRandomValues, não Math.random', () => {
    expect(crypto).toContain('crypto.getRandomValues(buf);');
    const ini = crypto.indexOf('export function generateInitialPassword');
    expect(crypto.slice(ini)).not.toContain('Math.random');
  });

  it('rejeita o resto que causaria viés em vez de fazer módulo cru', () => {
    // O alfabeto (57) não divide 2^32 — módulo puro favoreceria as primeiras
    // letras. Viés pequeno, mas é senha.
    expect(crypto).toContain('const limite = Math.floor(0x100000000 / ALFABETO_SENHA.length) * ALFABETO_SENHA.length;');
    expect(crypto).toContain('if (buf[i] >= limite) continue;');
  });
});
