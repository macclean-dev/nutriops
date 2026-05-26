// PIN overrides — cada user troca o PIN no 1º login, override mora em
// localStorage e tem precedência sobre o pin de data.js.

const pinOverrideKey = (tenantId) => `nutriops.pin.overrides.${tenantId}`;

function readOverrides(tenantId) {
  try {
    const raw = localStorage.getItem(pinOverrideKey(tenantId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeOverrides(tenantId, overrides) {
  try { localStorage.setItem(pinOverrideKey(tenantId), JSON.stringify(overrides)); } catch {}
}

export function readPinOverride(tenantId, userName) {
  const overrides = readOverrides(tenantId);
  return overrides[userName] ?? null;
}

export function writePinOverride(tenantId, userName, pin) {
  const overrides = readOverrides(tenantId);
  overrides[userName] = { pin, changedAt: new Date().toISOString() };
  writeOverrides(tenantId, overrides);
}

export function getEffectivePin(tenantId, user) {
  const override = readPinOverride(tenantId, user.name);
  return override?.pin ?? user.pin ?? '0000';
}

export function hasPinOverride(tenantId, userName) {
  return Boolean(readPinOverride(tenantId, userName));
}

// PINs que devem ser rejeitados no setup (sequências triviais)
export const WEAK_PINS = new Set([
  '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
  '1234','4321','12345','54321','123456','654321',
]);

export function isWeakPin(pin) {
  return WEAK_PINS.has(pin);
}
