import { describe, it, expect, beforeEach } from 'vitest';
import { bucketByDay } from './admin';
import { getSupabaseAuthError, clearSupabaseAuthError, shouldAutoConfigSupabase } from './repository';

// created_at no formato que o Supabase devolve (ISO). bucketByDay usa só
// os primeiros 10 chars (YYYY-MM-DD), então a hora não importa.
const at = (daysAgo, hour = 10) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};
const dayKey = (daysAgo) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

describe('bucketByDay', () => {
  it('retorna N buckets pro range pedido', () => {
    expect(bucketByDay([], 30)).toHaveLength(30);
    expect(bucketByDay([], 7)).toHaveLength(7);
  });

  it('buckets vazios têm count 0', () => {
    const out = bucketByDay([], 7);
    expect(out.every(b => b.count === 0)).toBe(true);
  });

  it('está ordenado cronologicamente (último é hoje)', () => {
    const out = bucketByDay([], 30);
    const dates = out.map(b => b.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
    expect(out[out.length - 1].date).toBe(dayKey(0));
  });

  it('conta registros no dia certo', () => {
    const records = [
      { created_at: at(0) }, { created_at: at(0) }, // 2 hoje
      { created_at: at(1) },                         // 1 ontem
    ];
    const out = bucketByDay(records, 7);
    const hoje = out.find(b => b.date === dayKey(0));
    const ontem = out.find(b => b.date === dayKey(1));
    expect(hoje.count).toBe(2);
    expect(ontem.count).toBe(1);
  });

  it('ignora registros fora da janela', () => {
    const records = [
      { created_at: at(0) },   // dentro
      { created_at: at(40) },  // fora da janela de 30d
    ];
    const out = bucketByDay(records, 30);
    const total = out.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1);
  });

  it('lida com created_at ausente ou inválido sem quebrar', () => {
    const records = [{ created_at: null }, {}, { created_at: at(0) }];
    const out = bucketByDay(records, 7);
    const total = out.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1); // só o válido conta
  });

  it('default é 30 dias', () => {
    expect(bucketByDay([])).toHaveLength(30);
  });
});

describe('Supabase auth error flag', () => {
  const KEY = 'nutriops.supabase.auth_error';
  beforeEach(() => { localStorage.clear(); });

  it('retorna null quando não há erro', () => {
    expect(getSupabaseAuthError()).toBeNull();
  });

  it('lê o erro gravado no localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify({ status: 401, table: 'temperature_records', at: '2026-05-29T00:00:00Z' }));
    const err = getSupabaseAuthError();
    expect(err).toMatchObject({ status: 401, table: 'temperature_records' });
  });

  it('clear remove a flag', () => {
    localStorage.setItem(KEY, JSON.stringify({ status: 403 }));
    expect(getSupabaseAuthError()).not.toBeNull();
    clearSupabaseAuthError();
    expect(getSupabaseAuthError()).toBeNull();
  });

  it('retorna null pra JSON corrompido (sem lançar)', () => {
    localStorage.setItem(KEY, '{corrompido');
    expect(getSupabaseAuthError()).toBeNull();
  });
});

describe('shouldAutoConfigSupabase', () => {
  const TENANT_SB = { url: 'https://seed.supabase.co', anonKey: 'seed-key' };

  it('não aplica se tenant não tem supabase', () => {
    expect(shouldAutoConfigSupabase(null, null).apply).toBe(false);
    expect(shouldAutoConfigSupabase(null, { url: 'x' }).apply).toBe(false);
  });

  it('aplica quando não há config local', () => {
    const r = shouldAutoConfigSupabase(null, TENANT_SB);
    expect(r.apply).toBe(true);
    expect(r.reason).toBe('sem config');
  });

  it('aplica quando config local está desabilitada', () => {
    const r = shouldAutoConfigSupabase({ url: TENANT_SB.url, anonKey: TENANT_SB.anonKey, enabled: false }, TENANT_SB);
    expect(r.apply).toBe(true);
    expect(r.reason).toBe('estava desabilitado');
  });

  it('aplica quando a anon key do tenant rotacionou (config tenant)', () => {
    const existing = { url: TENANT_SB.url, anonKey: 'key-velha', enabled: true, source: 'tenant' };
    const r = shouldAutoConfigSupabase(existing, TENANT_SB);
    expect(r.apply).toBe(true);
    expect(r.reason).toBe('anon key rotacionou');
  });

  it('aplica quando a URL do tenant mudou (config tenant)', () => {
    const existing = { url: 'https://antiga.supabase.co', anonKey: TENANT_SB.anonKey, enabled: true, source: 'tenant' };
    const r = shouldAutoConfigSupabase(existing, TENANT_SB);
    expect(r.apply).toBe(true);
    expect(r.reason).toBe('URL mudou');
  });

  it('NÃO aplica quando já configurado igual', () => {
    const existing = { url: TENANT_SB.url, anonKey: TENANT_SB.anonKey, enabled: true, source: 'tenant' };
    expect(shouldAutoConfigSupabase(existing, TENANT_SB).apply).toBe(false);
  });

  it('PROTEGE config manual mesmo com URL diferente (projeto dedicado)', () => {
    // Cenário crítico: Enterprise com Supabase dedicado. Auto-config NÃO pode
    // redirecionar os dados pro projeto seed.
    const dedicado = { url: 'https://dedicado-enterprise.supabase.co', anonKey: 'key-dedicada', enabled: true, source: 'manual' };
    const r = shouldAutoConfigSupabase(dedicado, TENANT_SB);
    expect(r.apply).toBe(false);
    expect(r.reason).toBe('config manual protegida');
  });

  it('PROTEGE config manual mesmo desabilitada', () => {
    const manual = { url: 'https://x.supabase.co', anonKey: 'k', enabled: false, source: 'manual' };
    expect(shouldAutoConfigSupabase(manual, TENANT_SB).apply).toBe(false);
  });
});
