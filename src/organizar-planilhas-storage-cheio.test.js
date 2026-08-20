import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { saveCompanyProfile, readCompanyProfile } from './settings';
import { profileWithPrefs, prefsFromProfile } from './form-prefs';

// ─────────────────────────────────────────────────────────────────────────────
// Ticket real de cliente (RT da CASA DOCE, 20/08): "vi aqui que tem como
// editar, só não consegui tirar a higienização de hortifrutícolas e do filtro
// do café de dentro da aba Faxina".
//
// Investigação: as duas planilhas NÃO estão sujeitas à trava intencional das
// 21 fichas de Higienização (essa trava é `category === 'higienizacao'`, e a
// categoria de nascença das duas é 'faxina') — o commit que criou a tela
// (5c23332, v1.9.153) inclusive testou mover essas duas exatas com sucesso.
// Ou seja: se não move, é falha de persistência, não regra de negócio.
//
// Candidato encontrado — o MESMO achado da auditoria já corrigido em
// settings.jsx/handleSaveProfile (tier baixa, a30e01c/v1.9.181), que passou
// batido aqui em forms.jsx/salvarOrganizacao: o retorno de saveCompanyProfile
// era descartado. Com o localStorage cheio (tablet de loja compartilhado —
// cenário que o projeto já documenta), a reorganização aparecia na tela na
// hora (só estado do React) mas nunca chegava em disco; reabrir "Organizar"
// relê do storage e traz o valor ANTIGO de volta, sem nenhum aviso do motivo.
// Sintoma idêntico ao relatado pela RT.
//
// Estes testes reproduzem a PERDA de verdade (Storage.prototype.setItem
// falhando só na chave do perfil), não só a ausência de aviso.
// ─────────────────────────────────────────────────────────────────────────────

const TENANT = 'casadoce-teste';
const CHAVE = `nutriops.company.profile.${TENANT}`;
const fonte = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('mecanismo — saveCompanyProfile devolve false quando o storage está cheio', () => {
  it('a gravação NÃO acontece e o valor anterior permanece intacto', () => {
    // Estado inicial: as duas planilhas do ticket ainda em 'faxina'.
    const perfilAntigo = profileWithPrefs({ cnpj: '00.000.000/0001-00' }, {
      templateCategory: { 'hortifruti-id': 'faxina', 'filtro-cafe-id': 'faxina' },
    });
    localStorage.setItem(CHAVE, JSON.stringify(perfilAntigo));

    // Storage enche entre o cadastro e a reorganização.
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
      if (k === CHAVE) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      return real.call(this, k, v);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // A RT move as duas pra 'servicos_gerais'.
    const perfilNovo = profileWithPrefs(readCompanyProfile(TENANT), {
      templateCategory: { 'hortifruti-id': 'servicos_gerais', 'filtro-cafe-id': 'servicos_gerais' },
    });
    const salvou = saveCompanyProfile(TENANT, perfilNovo);

    expect(salvou).toBe(false); // o sinal que salvarOrganizacao precisa checar

    // A perda de verdade: o disco continua com o valor ANTIGO. É isso que a
    // próxima abertura de "Organizar" (que relê do storage) vai mostrar.
    const doDisco = prefsFromProfile(readCompanyProfile(TENANT));
    expect(doDisco.templateCategory['hortifruti-id']).toBe('faxina');
    expect(doDisco.templateCategory['filtro-cafe-id']).toBe('faxina');
  });

  it('com storage saudável, grava e o valor novo sobrevive à releitura', () => {
    localStorage.setItem(CHAVE, JSON.stringify(profileWithPrefs({}, {
      templateCategory: { 'hortifruti-id': 'faxina' },
    })));

    const perfilNovo = profileWithPrefs(readCompanyProfile(TENANT), {
      templateCategory: { 'hortifruti-id': 'servicos_gerais' },
    });
    expect(saveCompanyProfile(TENANT, perfilNovo)).toBe(true);
    expect(prefsFromProfile(readCompanyProfile(TENANT)).templateCategory['hortifruti-id'])
      .toBe('servicos_gerais');
  });
});

describe('salvarOrganizacao (forms.jsx) — checa o retorno antes de dar sucesso', () => {
  const corpo = (() => {
    const ini = fonte.indexOf('const salvarOrganizacao = (novas) => {');
    return fonte.slice(ini, fonte.indexOf('const sectors =', ini));
  })();

  it('captura o retorno de saveCompanyProfile', () => {
    expect(corpo).toContain('const salvou = saveCompanyProfile(activeTenant.id, perfil);');
    // a forma antiga (retorno descartado) não pode voltar
    expect(corpo).not.toMatch(/^\s*saveCompanyProfile\(activeTenant\.id, perfil\);\s*$/m);
  });

  it('em falha: mostra o motivo e NÃO fecha o modal nem marca prefs como salvas', () => {
    const posGuarda = corpo.indexOf('if (!salvou) {');
    const posSetPrefs = corpo.indexOf('setPrefs(enxutas);');
    const posFechar = corpo.indexOf('setOrganizando(false);');
    expect(posGuarda).toBeGreaterThan(-1);
    expect(corpo).toContain('setOrganizarError(');
    // o `return` da guarda vem ANTES de aplicar o estado otimista e de fechar
    expect(posSetPrefs).toBeGreaterThan(posGuarda);
    expect(posFechar).toBeGreaterThan(posGuarda);
    expect(corpo.slice(posGuarda, posSetPrefs)).toContain('return;');
  });

  it('o push pra nuvem só acontece depois da gravação local ter dado certo', () => {
    const posGuarda = corpo.indexOf('if (!salvou) {');
    const posPush = corpo.indexOf('pushCompanyProfile');
    expect(posPush).toBeGreaterThan(posGuarda);
  });

  it('o modal recebe o erro e o exibe (não some junto com o modal fechando)', () => {
    expect(fonte).toContain('function OrganizarPlanilhasModal({ templates, prefs, onSave, onClose, error })');
    expect(fonte).toContain('error={organizarError}');
    expect(fonte).toContain('{error && (');
  });

  it('abrir "Organizar" limpa erro de uma tentativa anterior', () => {
    expect(fonte).toContain('onClick={() => { setOrganizarError(null); setOrganizando(true); }}');
  });
});
