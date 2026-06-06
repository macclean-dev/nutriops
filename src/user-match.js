// Matching de nome de usuário — compartilhado entre o login (login.jsx) e a
// troca de empresa (TenantSwitchModal em pages.jsx). Puro e testável.
//
// Mantém EXATAMENTE a heurística do login original: aceita primeiro nome,
// nome completo com espaço ou ponto, e prefixo. `rawUsername` já deve vir
// sem o sufixo `@empresa` (o login faz esse split antes de chamar aqui).

export function normalizeName(s) {
  return String(s ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '.');
}

export function findUserByName(users, rawUsername) {
  const username = String(rawUsername ?? '').trim().toLowerCase().replace(/^@+/, '');
  if (!username || !Array.isArray(users)) return null;
  const flat = (s) => normalizeName(s).replace(/\./g, '');
  return users.find((u) => normalizeName(u.name) === username)
      ?? users.find((u) => normalizeName(u.name).split('.')[0] === username)
      ?? users.find((u) => normalizeName(u.name).startsWith(username))
      ?? users.find((u) => flat(u.name) === username)
      ?? users.find((u) => flat(u.name).startsWith(username))
      ?? null;
}
