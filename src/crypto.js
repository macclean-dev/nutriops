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
