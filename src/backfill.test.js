import { describe, it, expect } from 'vitest';
import { shouldAutoBackfill } from './repository';

describe('shouldAutoBackfill — auto-cura no boot', () => {
  const base = { enabled: true, online: true, alreadyDone: false, localCount: 5 };

  it('roda quando: ligado + online + não feito + tem dado local', () => {
    expect(shouldAutoBackfill(base)).toBe(true);
  });
  it('NÃO roda se Supabase desligado', () => {
    expect(shouldAutoBackfill({ ...base, enabled: false })).toBe(false);
  });
  it('NÃO roda offline', () => {
    expect(shouldAutoBackfill({ ...base, online: false })).toBe(false);
  });
  it('NÃO roda se já foi feito (1x por device)', () => {
    expect(shouldAutoBackfill({ ...base, alreadyDone: true })).toBe(false);
  });
  it('NÃO roda se não há dado local', () => {
    expect(shouldAutoBackfill({ ...base, localCount: 0 })).toBe(false);
  });
});
