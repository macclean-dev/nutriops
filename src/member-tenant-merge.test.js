import { describe, it, expect } from 'vitest';
import { mergeMemberTenant } from './pages';

// Bug do teste da Swiss (05/08): a conta de loja logou e o seletor "Quem está
// registrando?" abriu SEM NOME NENHUM — tela sem saída na abertura do turno.
//
// Causa: loja-seed não tem linha em public.tenants, então get_member_tenants
// devolve os campos ricos vazios (coalesce(...,'[]')) e o nome cai pro id. O
// login fundia essa casca POR CIMA do seed e apagava a lista de nomes.
describe('mergeMemberTenant — nuvem não pode apagar o que só o seed tem', () => {
  const seedSwiss = {
    id:'swiss', name:'Swiss', segment:'Padaria e Cafeteria',
    usersList:[{ name:'Fran', role:'Supervisor', status:'Ativo' },
               { name:'Emmilyn Barbosa', role:'Colaborador', status:'Ativo' }],
    equipmentCatalog:[{ label:'Freezer 1', location:'Cozinha' }],
    stores:[{ id:'swiss-bsb', name:'Swiss — Brasília Shopping' }],
    multiStore:false,
  };
  // O que a RPC devolve pra uma loja-seed: só id e papel são reais.
  const nuvemSwiss = {
    id:'swiss', name:'swiss', segment:'', plan:null,
    usersList:[], equipmentCatalog:[], stores:[],
    memberRole:'Colaborador', implantacao:true, _fromMembership:true,
  };

  it('preserva a EQUIPE — sem isso o seletor de operador abre vazio', () => {
    const t = mergeMemberTenant(nuvemSwiss, seedSwiss);
    expect(t.usersList).toHaveLength(2);
    expect(t.usersList.map(u => u.name)).toContain('Fran');
  });

  it('preserva catálogo, lojas e o nome de exibição ("swiss" → "Swiss")', () => {
    const t = mergeMemberTenant(nuvemSwiss, seedSwiss);
    expect(t.name).toBe('Swiss');                      // não o id cru
    expect(t.segment).toBe('Padaria e Cafeteria');
    expect(t.equipmentCatalog).toHaveLength(1);
    expect(t.stores).toHaveLength(1);
  });

  it('mantém o que só a nuvem sabe (papel do vínculo, implantação)', () => {
    const t = mergeMemberTenant(nuvemSwiss, seedSwiss);
    expect(t.memberRole).toBe('Colaborador');
    expect(t._fromMembership).toBe(true);
    expect(t.implantacao).toBe(true);
  });

  it('tenant REAL da nuvem (CASA DOCE) vence o seed — dado fresco manda', () => {
    const nuvemCD = {
      id:'bf245c3b-2f9', name:'CASA DOCE', segment:'Confeitaria',
      usersList:[], equipmentCatalog:[{ label:'Câmara C.1' }, { label:'Forno 01' }],
      stores:[{ id:'cd-main', name:'CASA DOCE — Matriz' }], _fromMembership:true,
    };
    const antigo = { id:'bf245c3b-2f9', name:'Nome velho', equipmentCatalog:[{ label:'obsoleto' }], stores:[] };
    const t = mergeMemberTenant(nuvemCD, antigo);
    expect(t.name).toBe('CASA DOCE');
    expect(t.equipmentCatalog).toHaveLength(2);
    expect(t.equipmentCatalog[0].label).toBe('Câmara C.1');
  });

  it('sem seed correspondente (loja nova neste device) devolve a da nuvem', () => {
    expect(mergeMemberTenant(nuvemSwiss, undefined)).toBe(nuvemSwiss);
  });
});
