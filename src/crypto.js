// Hash de PINs com PBKDF2 (Web Crypto API).
// 4 dígitos têm só 10000 combinações, então brute-force de hash seria trivial
// com SHA-256 puro. PBKDF2 com 100k iterações deixa cada tentativa ~100ms,
// inviabilizando enumeração offline mesmo se um hash vazasse.
//
// Salt = tenant.id (único por cliente). Não é segredo, mas evita rainbow tables
// e torna cada hash único entre tenants mesmo se o PIN coincidir.

const PBKDF2_ITERATIONS = 100000;
const HASH_BITS = 256;

export async function hashPin(pin, salt) {
  if (!pin || !salt) throw new Error('hashPin: pin e salt obrigatórios');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(pin)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const buf = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(String(salt)),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    HASH_BITS,
  );
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin, salt, expectedHash) {
  if (!expectedHash) return false;
  const actual = await hashPin(pin, salt);
  // Comparação simples (constant-time não é crítico aqui — o gargalo é o hash).
  return actual === expectedHash;
}

// Gera setup PIN aleatório de 4 dígitos. Usa crypto.getRandomValues pra evitar
// Math.random (que não é criptograficamente seguro).
export function generateSetupPin(digits = 4) {
  const max = 10 ** digits;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Modulo bias é desprezível pra 4 dígitos com Uint32 (2^32 / 10000 = 429496.7…)
  const n = buf[0] % max;
  return String(n).padStart(digits, '0');
}

// ─── Senha inicial de cliente novo ──────────────────────────────────────────
// Substitui o setup PIN no cadastro de cliente (21/08). O PIN levava o cliente
// pro SetupPinScreen, que cria sessão LOCAL sem accessToken — e sem token toda
// requisição sai com a chave anônima, que o RLS recusa. Cliente cadastrado
// assim nascia sem sincronizar, em silêncio. Agora o cadastro cria conta de
// e-mail de verdade, e isto gera a senha inicial que o cliente troca depois.
//
// Alfabeto sem 0/O/1/l/I: a senha é ditada por WhatsApp ou telefone, e esses
// pares são o que mais gera "não consigo entrar". 10 caracteres do alfabeto
// abaixo dão ~51 bits — folgado pra uma senha provisória de uso único, e o
// mínimo da Edge Function é 8.
const ALFABETO_SENHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateInitialPassword(len = 10) {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  // Rejeita o resto que causaria viés em vez de fazer `% alfabeto` cru — o
  // alfabeto (57) não divide 2^32, então o módulo puro favoreceria as
  // primeiras letras. Com poucos caracteres o viés é pequeno, mas é senha:
  // não custa nada fazer certo.
  const limite = Math.floor(0x100000000 / ALFABETO_SENHA.length) * ALFABETO_SENHA.length;
  let out = '';
  for (let i = 0; out.length < len; i++) {
    if (i >= buf.length) { // acabou o buffer (só acontece com muita rejeição)
      const extra = new Uint32Array(len);
      crypto.getRandomValues(extra);
      buf.set(extra.subarray(0, Math.min(extra.length, buf.length)));
      i = 0;
    }
    if (buf[i] >= limite) continue;
    out += ALFABETO_SENHA[buf[i] % ALFABETO_SENHA.length];
  }
  return out;
}
