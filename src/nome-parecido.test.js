import { describe, it, expect } from 'vitest';
import { nomeParecido, normalizar } from './nome-parecido';

// ─────────────────────────────────────────────────────────────────────────────
// Casos REAIS do levantamento da CASA DOCE (24/08): 35 nomes distintos mediram
// temperatura em 7 dias, 31 não batiam com a lista cadastrada da loja.
// ─────────────────────────────────────────────────────────────────────────────

const EQUIPE_CD = [
  { name: 'ANDRIELE FERNANDES DA SILVA' },
  { name: 'BRUNA BOTELHO SOARES' },
  { name: 'DANIELA FERREIRA DOS SANTOS' },
  { name: 'FERNANDA DOS SANTOS ARAÚJO' },
  { name: 'ISABELA LORENA GOMES RODRIGUES' },
  { name: 'JOENICE SOUZA DE SANTANA MARQUES' },
  { name: 'SARA STHEFANY DE JESUS QUEIROZ' },
  { name: 'LAYZA CRISTINA PEREIRA LUSTOSA' },
];

describe('acha a pessoa certa nos casos que aconteceram de verdade', () => {
  const casos = [
    ['layza cristina',      'LAYZA CRISTINA PEREIRA LUSTOSA'],
    ['LAYZA CRISTINA',      'LAYZA CRISTINA PEREIRA LUSTOSA'],
    ['Andriele Fernandes',  'ANDRIELE FERNANDES DA SILVA'],
    ['Bruna botelho',       'BRUNA BOTELHO SOARES'],
    ['Daniela Ferreira',    'DANIELA FERREIRA DOS SANTOS'],
    ['Fernanda dos Santos', 'FERNANDA DOS SANTOS ARAÚJO'],
    ['Isabela Lorena',      'ISABELA LORENA GOMES RODRIGUES'],
    ['Sara Sthefany',       'SARA STHEFANY DE JESUS QUEIROZ'],
  ];
  for (const [digitado, esperado] of casos) {
    it(`"${digitado}" → ${esperado}`, () => {
      expect(nomeParecido(EQUIPE_CD, digitado)).toBe(esperado);
    });
  }
});

describe('normalização', () => {
  it('acento não separa a mesma pessoa', () => {
    expect(nomeParecido([{ name: 'ALEXANDRA CRISÓSTOMO MOREIRA' }], 'Alexandra crisostomo'))
      .toBe('ALEXANDRA CRISÓSTOMO MOREIRA');
  });

  it('caixa e espaço sobrando não separam', () => {
    expect(nomeParecido([{ name: 'MARIA SANTA ARAÚJO TEIXEIRA' }], '  maria   santa  '))
      .toBe('MARIA SANTA ARAÚJO TEIXEIRA');
  });

  it('preposição não conta como palavra — "Tamires de Lima" acha "TAMIRES DE LIMA FELIX"', () => {
    expect(nomeParecido([{ name: 'TAMIRES DE LIMA FELIX' }], 'Tamires de Lima'))
      .toBe('TAMIRES DE LIMA FELIX');
  });

  it('normalizar tira acento e caixa', () => {
    expect(normalizar('  CRISÓSTOMO  ')).toBe('crisostomo');
  });
});

describe('quando NÃO pode sugerir — errar aqui falsearia autoria de registro sanitário', () => {
  it('nome que já é exatamente o cadastrado não vira sugestão', () => {
    expect(nomeParecido(EQUIPE_CD, 'LAYZA CRISTINA PEREIRA LUSTOSA')).toBeNull();
    expect(nomeParecido(EQUIPE_CD, 'layza cristina pereira lustosa')).toBeNull();
  });

  it('duas pessoas casam com o mesmo texto → não escolhe nenhuma', () => {
    const duas = [{ name: 'MARIA SILVA SANTOS' }, { name: 'MARIA SILVA COSTA' }];
    expect(nomeParecido(duas, 'Maria Silva')).toBeNull();
  });

  it('pessoa de verdade que não está na lista não vira sugestão de outra', () => {
    expect(nomeParecido(EQUIPE_CD, 'Carlos Eduardo Pereira')).toBeNull();
  });

  it('palavra a mais impede o palpite — "Maria Santa supervisora" não é a Maria Santa', () => {
    // Caso real do levantamento. "supervisora" não está no nome cadastrado,
    // então a regra "todas as palavras precisam existir" barra — e barrar é
    // o certo: pode ser outra pessoa, ou um apelido de função.
    expect(nomeParecido([{ name: 'MARIA SANTA ARAÚJO TEIXEIRA' }], 'Maria Santa supervisora')).toBeNull();
  });

  it('erro de digitação NÃO é corrigido — "Perreira" com dois erres fica de fora', () => {
    // Deliberado: corrigir typo exigiria distância de edição, e aí "Sousa"
    // viraria "Souza" de OUTRA pessoa. Conservador de propósito.
    expect(nomeParecido([{ name: 'IARA PEREIRA NEIVA' }], 'Iara Perreira Neiva')).toBeNull();
  });

  it('texto vazio ou só preposição não sugere nada', () => {
    expect(nomeParecido(EQUIPE_CD, '')).toBeNull();
    expect(nomeParecido(EQUIPE_CD, '   ')).toBeNull();
    expect(nomeParecido(EQUIPE_CD, 'de da dos')).toBeNull();
  });

  it('só uma inicial não basta — "L" não vira Layza', () => {
    expect(nomeParecido(EQUIPE_CD, 'L')).toBeNull();
  });

  it('equipe vazia ou nula não quebra', () => {
    expect(nomeParecido([], 'Layza')).toBeNull();
    expect(nomeParecido(null, 'Layza')).toBeNull();
  });

  it('aceita lista de strings além de objetos {name}', () => {
    expect(nomeParecido(['LAYZA CRISTINA PEREIRA LUSTOSA'], 'layza cristina'))
      .toBe('LAYZA CRISTINA PEREIRA LUSTOSA');
  });
});
