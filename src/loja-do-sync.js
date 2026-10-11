// ─────────────────────────────────────────────────────────────────────────────
// Qual loja o aparelho sincroniza (revisão adversarial, 10/10).
//
// Até a v1.9.271 o alvo era `session.tenantId ?? activeTenant.id`. Para quem
// entra por e-mail com vínculo em várias lojas (a RT da CASA DOCE: Matriz,
// PKS, Terraço), `session.tenantId` é fixo na loja PRINCIPAL
// (scopeSessionToMembership, auth.jsx), e trocar de loja no seletor muda só o
// `activeTenant`. Resultado: ela abria o Terraço e o sync (no boot e a cada
// 2 min) buscava recebimento e planilhas da Matriz. Era o próprio sintoma que
// ela relatou ("planilha feita aparecendo como não feita") continuando pra
// ela.
//
// Agora o alvo é a loja que a pessoa está OLHANDO, desde que a sessão a
// alcance (`visibleTenants`, a mesma lista do seletor). Conta de loja única e
// admin global não mudam: pra elas a loja ativa já era o alvo efetivo.
// ─────────────────────────────────────────────────────────────────────────────

export function lojaDoSync({ session, activeTenant, visibleTenants }) {
  if (!session) return null;
  const ativa = activeTenant?.id ?? null;
  if (ativa && (visibleTenants ?? []).some((t) => t?.id === ativa)) return ativa;
  return session.tenantId ?? ativa ?? null;
}
