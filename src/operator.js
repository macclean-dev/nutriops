// ─────────────────────────────────────────────────────────────────────────────
// Operador atual — quem está registrando AGORA numa sessão de loja.
//
// Modelo (decisão do dono, 03/08): o chão de loja deixa de ter credencial por
// pessoa. O aparelho entra uma vez com a CONTA DA LOJA e cada registro é
// atribuído a quem tocou no próprio nome. Isso resolve a rotatividade (entrou
// alguém = mais um nome na lista; saiu = tira o nome) sem perder o que a RDC
// 216 realmente exige, que é o responsável identificado em cada registro.
//
// AUTENTICAÇÃO (quem destrancou o app) ≠ ATRIBUIÇÃO (quem fez a medição).
// A conta da loja responde pela primeira; este módulo pela segunda.
//
// Truque que mantém a mudança pequena: o operador escolhido é gravado no
// `session.user.name`. Os 14 pontos do app que carimbam `session.user.name` no
// registro continuam corretos sem precisar de alteração nenhuma.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = (tenantId) => `nutriops.operator.${tenantId}`;

// Expira em 6h OU na virada do dia — o que vier primeiro. Sem isso, o tablet
// ficaria carimbando o nome de quem abriu ontem em quem está medindo hoje, que
// é justamente o vício da planilha de papel assinada em lote no fim do turno.
export const OPERATOR_TTL_MS = 6 * 60 * 60 * 1000;

export function isOperatorExpired(entry, now = Date.now()) {
  if (!entry?.name || !entry?.setAt) return true;
  const setAt = new Date(entry.setAt).getTime();
  if (!Number.isFinite(setAt)) return true;
  if (now - setAt > OPERATOR_TTL_MS) return true;
  return new Date(setAt).toDateString() !== new Date(now).toDateString();
}

export function readOperator(tenantId, now = Date.now()) {
  if (!tenantId) return null;
  let entry = null;
  try {
    const raw = localStorage.getItem(KEY(tenantId));
    entry = raw ? JSON.parse(raw) : null;
  } catch { return null; }
  return isOperatorExpired(entry, now) ? null : entry;
}

export function writeOperator(tenantId, name) {
  if (!tenantId || !name?.trim()) return null;
  const entry = { name: name.trim(), setAt: new Date().toISOString() };
  try { localStorage.setItem(KEY(tenantId), JSON.stringify(entry)); } catch {}
  return entry;
}

export function clearOperator(tenantId) {
  try { localStorage.removeItem(KEY(tenantId)); } catch {}
}

// Sessão de CONTA DE LOJA: genérica, compartilhada pelo aparelho do balcão.
// Só ela precisa de operador; conta pessoal (gestão) já é a própria pessoa.
export function isStoreAccountSession(session) {
  return session?.isStoreAccount === true;
}

// Precisa escolher operador antes de registrar? Só na conta de loja e só
// enquanto não houver um válido.
export function needsOperator(session, now = Date.now()) {
  if (!isStoreAccountSession(session)) return false;
  return readOperator(session.tenantId, now) === null;
}

// Aplica o operador na sessão. `user.name` passa a ser a pessoa (é o que vai
// carimbado nos registros e no "Boa tarde, X"); o papel continua sendo o da
// CONTA DA LOJA — permissão é da conta, não de quem tocou no nome. Quem
// precisa de poder de gestão entra na própria conta.
export function applyOperatorToSession(session, name) {
  if (!isStoreAccountSession(session) || !name?.trim()) return session;
  return {
    ...session,
    user: { ...session.user, name: name.trim() },
    operatorSetAt: new Date().toISOString(),
  };
}

// Nome da loja pra exibir, já que user.name virou o operador.
export function storeLabel(session) {
  return session?.storeName ?? session?.user?.location ?? '';
}
