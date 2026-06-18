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
  if (!Array.isArray(users)) return null;
  // Normaliza a ENTRADA do mesmo jeito que o nome do usuário: minúsculas, sem
  // acento, espaços viram ponto. Sem isso, "marcia menezes" (com espaço) não
  // casava com "Marcia Menezes" — só "marcia" ou "marcia.menezes" funcionavam.
  // Remove @ e pontos/espaços nas bordas.
  const input = normalizeName(String(rawUsername ?? '').trim().replace(/^@+/, ''))
    .replace(/^\.+|\.+$/g, '');
  if (!input) return null;
  const flatInput = input.replace(/\./g, '');
  const flat = (s) => normalizeName(s).replace(/\./g, '');
  return users.find((u) => normalizeName(u.name) === input)
      ?? users.find((u) => normalizeName(u.name).split('.')[0] === input)
      ?? users.find((u) => normalizeName(u.name).startsWith(input))
      ?? users.find((u) => flat(u.name) === flatInput)
      ?? users.find((u) => flat(u.name).startsWith(flatInput))
      ?? null;
}
