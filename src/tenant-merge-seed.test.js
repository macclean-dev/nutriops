import { describe, it, expect } from 'vitest';
import { mesclaTenants } from './pages';

// Bug do iPhone (07/08): logou em swiss@nutriops.app, escolheu operador e
// registrou. Ao trocar de operador, o seletor abriu VAZIO; depois do logout, o
// login respondeu "Supabase não configurado".
//
// Uma causa só: `readOnboardingTenants() ?? defaultTenants`. Bastava UM tenant
// salvo no device (link ?token=, onboarding) pra as lojas embutidas sumirem
// inteiras — e com elas as duas coisas que só existem no seed da Swiss:
// `supabase` (env do build) e `usersList`.
describe('mesclaTenants — tenant salvo não pode apagar as lojas do app', () => {
  const seed = [
    { id:'swiss',    name:'Swiss',    usersList:[{ name:'Fran' }], supabase:{ url:'u', anonKey:'k' } },
    { id:'backerei', name:'Bäckerei', usersList:[{ name:'Sila' }], supabase:{ url:'u', anonKey:'k' } },
  ];
  const salvo = [{ id:'bf245c3b-2f9', name:'CASA DOCE' }];   // veio do ?token=, sem supabase/usersList

  it('mantém as lojas do seed ao lado do tenant salvo', () => {
    const r = mesclaTenants(salvo, seed);
    expect(r.map(t => t.id)).toEqual(['bf245c3b-2f9', 'swiss', 'backerei']);
  });

  it('a Swiss continua com credencial e equipe — as duas quebras do relato', () => {
    const swiss = mesclaTenants(salvo, seed).find(t => t.id === 'swiss');
    expect(swiss.supabase?.url).toBe('u');        // sem isto: "Supabase não configurado"
    expect(swiss.usersList).toHaveLength(1);      // sem isto: seletor de operador vazio
  });

  it('tenant salvo tem precedência quando o id coincide (dado da nuvem é mais fresco)', () => {
    const r = mesclaTenants([{ id:'swiss', name:'Swiss (nuvem)' }], seed);
    expect(r).toHaveLength(2);                    // não duplica
    expect(r[0].name).toBe('Swiss (nuvem)');
  });

  it('sem nada salvo devolve o seed intacto', () => {
    expect(mesclaTenants(null, seed)).toBe(seed);
    expect(mesclaTenants([], seed)).toBe(seed);
  });
});
