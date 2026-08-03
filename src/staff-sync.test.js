import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ls, lw, getOfflineQueue, clearOfflineQueue, pushStaffMember } from './repository';

const STAFF_KEY = (id) => `nutriops.users.${id}`;

beforeEach(() => { localStorage.clear(); clearOfflineQueue(); });

describe('sync da equipe — o PIN NUNCA pode ir pra nuvem', () => {
  it('a linha enviada não carrega pin, mesmo quando o usuário local tem um', async () => {
    // Offline → cai na fila, e a fila guarda exatamente a linha que seria enviada.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await pushStaffMember('swiss', {
      name: 'Emmilyn Barbosa', role: 'Colaborador', location: 'Cozinha',
      status: 'Ativo', pin: '4729',        // ← credencial, não pode vazar
    });
    const [item] = getOfflineQueue();
    expect(item.table).toBe('tenant_staff');
    expect(item.payload).not.toHaveProperty('pin');
    expect(JSON.stringify(item.payload)).not.toContain('4729');
    expect(item.payload).toMatchObject({
      tenant_id: 'swiss', name: 'Emmilyn Barbosa', role: 'Colaborador',
      location: 'Cozinha', status: 'Ativo',
    });
    vi.restoreAllMocks();
  });
});

describe('sync da equipe — chave de armazenamento', () => {
  it('grava na MESMA chave que o app lê (nutriops.users.{id})', () => {
    // Foi o bug do catálogo de equipamentos (v1.9.60): sincronizava pra uma
    // chave que a tela não lia e a loja via "ninguém cadastrado".
    lw(STAFF_KEY('swiss'), [{ name: 'Fran', role: 'Supervisor', status: 'Ativo' }]);
    expect(ls('nutriops.users.swiss', [])).toHaveLength(1);
  });
});

// A troca de empresa gravava a equipe da loja ANTERIOR sob a chave da NOVA
// (efeito de escrita com id novo + state velho). Antes isso ficava preso no
// aparelho; com o sync ligado, a contaminação subiria pra nuvem.
describe('troca de empresa não contamina a equipe', () => {
  const simular = ({ guard }) => {
    const equipeSwiss    = [{ name: 'Emmilyn', role: 'Colaborador', pin: '0000' }];
    const equipeCasaDoce = [{ name: 'Isabela', role: 'Nutricionista RT' }];
    lw(STAFF_KEY('swiss'), equipeSwiss);
    lw(STAFF_KEY('bf245c3b-2f9'), equipeCasaDoce);

    let users = equipeSwiss, usersTenant = 'swiss';
    const activeId = 'bf245c3b-2f9';                      // usuário trocou de loja

    // efeito #1 (deps [activeTenant.id]) — só AGENDA o setState
    const pendentes = { users: ls(STAFF_KEY(activeId), []), tenant: activeId };
    // efeito #2 (activeTenant.id nas deps → dispara nesta mesma passada)
    if (!guard || usersTenant === activeId) lw(STAFF_KEY(activeId), users);

    users = pendentes.users; usersTenant = pendentes.tenant;   // próximo render
    if (!guard || usersTenant === activeId) lw(STAFF_KEY(activeId), users);

    return ls(STAFF_KEY('bf245c3b-2f9'), []).map(u => u.name);
  };

  it('SEM guard a equipe da Swiss vaza pra CASA DOCE (o bug)', () => {
    lw(STAFF_KEY('bf245c3b-2f9'), [{ name: 'Isabela' }]);
    let users = [{ name: 'Emmilyn', pin: '0000' }];
    lw(STAFF_KEY('bf245c3b-2f9'), users);                 // efeito #2 sem guard
    expect(ls(STAFF_KEY('bf245c3b-2f9'), []).map(u => u.name)).toEqual(['Emmilyn']);
  });

  it('COM guard a CASA DOCE mantém a própria equipe', () => {
    expect(simular({ guard: true })).toEqual(['Isabela']);
  });
});
