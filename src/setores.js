// ─── Agrupamento de equipamentos por setor ──────────────────────────────────
// Com 44 equipamentos numa grade única (CASA DOCE), o colaborador da Padaria
// precisava caçar os dele no meio dos da Gelateria. Cada um cuida da própria
// área, então a lista de captura segue a mesma lógica das planilhas BPF.
//
// Mora num módulo próprio, sem imports, porque duas telas MUITO diferentes
// precisam da mesma regra: o quiosque (kiosk.jsx) e o "Registrar agora" da
// visão geral (overview-v2.jsx, a tela de boot de todo mundo). Deixar isso em
// kiosk.jsx obrigava o overview a importar o chunk pesado de planilhas só pra
// agrupar uma lista — e reimplementar seria pior: em 10/08 as duas telas
// divergiram (o quiosque agrupava, a visão geral não) e a nutricionista da
// CASA DOCE leu isso como "o app parou de agrupar num aparelho".

// Chave de comparação de setor: sem caixa e sem acento. Os 44 equipamentos da
// CASA DOCE foram digitados à mão, então "Confeitaria", "confeitaria" e
// "CONFEITARIA" convivem — comparando cru, o mesmo setor vira três blocos
// separados na tela.
export const chaveSetor = (s) => (s ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ORDENAR antes de agrupar não é cosmético: o quiosque navega por ÍNDICE do
// catálogo (activeIdx) e o "próximo equipamento" após salvar é o próximo índice
// não registrado. Se a ordem do array não bater com a da tela, o cursor pula
// de setor a cada leitura.
export function ordenarPorSetor(list) {
  const cmp = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
  return [...list].sort((a, b) => {
    // Compara pela CHAVE normalizada, não pela grafia crua: "Confeitaria" e
    // "confeitaria" são strings diferentes mas o mesmo setor. Comparando cru,
    // o desempate por nome nunca rodava entre elas (localeCompare base devolve
    // 0) e os equipamentos do setor saíam fora de ordem.
    const ka = chaveSetor(a.location), kb = chaveSetor(b.location);
    if (Boolean(ka) !== Boolean(kb)) return ka ? -1 : 1;   // sem setor por último
    return ka !== kb ? cmp(ka, kb) : cmp(a.label ?? '', b.label ?? '');
  });
}

// Quebra a lista JÁ ORDENADA em blocos, preservando o índice original de cada
// item — é por ele que o quiosque seleciona o equipamento.
export function agruparPorSetor(list) {
  const grupos = [];
  list.forEach((item, i) => {
    const bruto = (item.location ?? '').trim();
    const setor = bruto || 'Sem setor';
    const chave = bruto ? chaveSetor(bruto) : ' sem-setor';
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === chave) { ultimo.itens.push({ item, i }); ultimo.grafias.push(bruto); }
    else grupos.push({ setor, chave, itens: [{ item, i }], grafias: [bruto] });
  });
  // Rotulo = grafia MAIS FREQUENTE do setor (empate: a primeira, porque sort e
  // estavel). Se 12 equipamentos dizem "Confeitaria" e um diz "confeitaria",
  // exibir a minuscula so por ela ter caido primeiro pareceria erro do app.
  for (const g of grupos) {
    const conta = new Map();
    for (const s of g.grafias) if (s) conta.set(s, (conta.get(s) ?? 0) + 1);
    if (conta.size) g.setor = [...conta.entries()].sort((a, b) => b[1] - a[1])[0][0];
    delete g.grafias;
  }
  return grupos;
}
