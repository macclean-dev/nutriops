// ─────────────────────────────────────────────────────────────────────────────
// "Equipamentos fora da rotina" — quais equipamentos estão há dias sem leitura.
//
// POR QUE EXISTE (CASA DOCE, 21/08): a RT reclamou que faltavam registros, e ao
// investigar apareceram 12 equipamentos parados havia 2-3 dias — Gelateria e
// Atendimento Pães e Café desde 18/08, Produção de Picolés desde 19/08, e um
// "Ultracongelado U.3" NUNCA medido. Ninguém tinha sido avisado, e havia dois
// motivos:
//
//   1. O alerta de turno (turn-alerts.js) olha só HOJE, e depende de os turnos
//      estarem cadastrados. Equipamento parado há três dias não gera nada
//      diferente de equipamento parado há três horas.
//   2. `if (emImplantacao) return []` desliga o alerta de turno inteiro
//      enquanto a loja treina a equipe — e a CASA DOCE está em implantação.
//      A intenção era não afogar a equipe em alerta durante o treino; o efeito
//      colateral foi silenciar também o buraco real.
//
// Este módulo responde outra pergunta, complementar: não "faltou no turno de
// hoje", mas "faz quantos dias que ninguém mede isso". É a pergunta que pega o
// setor esquecido, e é ausência de dado — pela RDC 216, planilha com buraco é o
// primeiro item que o fiscal folheia.
//
// Puro de propósito: sem localStorage, sem React. A leitura de catálogo/perfil
// e o desenho ficam com quem chama.
// ─────────────────────────────────────────────────────────────────────────────

import { dedupeCatalog, recordBelongsTo } from './limits';

export const FORA_DA_ROTINA_PADRAO_DIAS = 2;

// Lê o limite do perfil da empresa, com piso de 1 dia. Aceita string (vem de
// <input type="number">, que entrega texto) e cai no padrão pra vazio/lixo —
// um campo apagado não pode virar limite 0 e listar a loja inteira.
export function limiteForaDaRotina(profile) {
  const n = Number(profile?.foraDaRotinaDias);
  if (!Number.isFinite(n) || n < 1) return FORA_DA_ROTINA_PADRAO_DIAS;
  return Math.floor(n);
}

// Diferença em dias de CALENDÁRIO, não em blocos de 24h. Medido ontem às 23h e
// agora são 8h da manhã: são "1 dia", não "0" — é assim que a RT conta, e
// contar por 24h daria 0 e esconderia a falha de ontem. Usa data local (o
// aparelho está na loja, o fuso é o dela).
export function diasDeCalendario(de, ate) {
  const a = new Date(de), b = new Date(ate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const diaA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const diaB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((diaB - diaA) / 86400000);
}

// Devolve os equipamentos do catálogo que passaram do limite, do pior pro
// menos pior: NUNCA medido primeiro, depois por dias parados.
//
// `recordBelongsTo` e não comparação de nome: equipamento renomeado guarda o
// nome ANTIGO nas leituras já feitas (ver limits.js). Sem isso, renomear
// colocaria o equipamento nesta lista como se estivesse abandonado — que é
// exatamente o defeito que a v1.9.196 corrigiu em outras 7 telas.
export function equipamentosForaDaRotina({
  catalog = [], records = [], tenantId = null,
  limiteDias = FORA_DA_ROTINA_PADRAO_DIAS, now = new Date(),
} = {}) {
  const cat = dedupeCatalog(catalog ?? []);
  if (!cat.length) return [];
  const doTenant = tenantId ? (records ?? []).filter((r) => r?.tenantId === tenantId) : (records ?? []);

  const fora = [];
  for (const eq of cat) {
    // Mesma razão do turn-alerts.js: equipamento que só liga quando está em
    // uso não tem "rotina" pra estar fora. Sem isto, o ultracongelador da
    // gelateria apareceria como "sem leitura há N dias" pra sempre — e a
    // resposta natural de quem olha é apagar o equipamento do cadastro.
    if (eq?.usoIntermitente === true) continue;
    let ultima = null;
    for (const r of doTenant) {
      if (!recordBelongsTo(cat, r, eq)) continue;
      const t = new Date(r.createdAt).getTime();
      if (Number.isNaN(t)) continue;
      if (ultima === null || t > ultima) ultima = t;
    }
    if (ultima === null) {
      fora.push({ equipamento: eq.label, setor: eq.location || null, dias: null, ultimaLeitura: null, nunca: true });
      continue;
    }
    const dias = diasDeCalendario(ultima, now);
    if (dias !== null && dias >= limiteDias) {
      fora.push({ equipamento: eq.label, setor: eq.location || null, dias, ultimaLeitura: new Date(ultima).toISOString(), nunca: false });
    }
  }

  // NUNCA primeiro (é o pior caso: não existe nem linha de base), depois mais
  // dias parados, e o nome desempata pra a ordem não dançar entre renders.
  return fora.sort((a, b) => {
    if (a.nunca !== b.nunca) return a.nunca ? -1 : 1;
    if (a.dias !== b.dias) return (b.dias ?? 0) - (a.dias ?? 0);
    return String(a.equipamento).localeCompare(String(b.equipamento), 'pt-BR');
  });
}

// Nome distinto de `agruparPorSetor` (setores.js), que agrupa o CATÁLOGO —
// overview-v2 importa as duas.
// Agrupa por setor pra o card não virar uma lista de 12 nomes soltos — a RT
// pensa por setor ("a Gelateria parou"), não por equipamento avulso. Setor
// vazio vira "Sem setor" em vez de sumir.
export function agruparForaPorSetor(itens = []) {
  const mapa = new Map();
  for (const it of itens) {
    const chave = it.setor || 'Sem setor';
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(it);
  }
  // O setor com o pior caso aparece primeiro — mesma régua da lista.
  return [...mapa.entries()]
    .map(([setor, equipamentos]) => ({ setor, equipamentos }))
    .sort((a, b) => {
      const pior = (g) => g.equipamentos.some((e) => e.nunca) ? Infinity : Math.max(...g.equipamentos.map((e) => e.dias ?? 0));
      const pa = pior(a), pb = pior(b);
      if (pa !== pb) return pb - pa;
      return a.setor.localeCompare(b.setor, 'pt-BR');
    });
}

// Frase curta pra cada linha do card.
//
// DATA, não contagem de dias (21/08). A primeira versão dizia "há 2 dias sem
// leitura" e brigava com o resto da própria tela: `fmtRelative` (overview-v2)
// conta blocos de 24h e o mesmo equipamento aparecia como "há 1d" na grade
// logo abaixo. Nenhum dos dois está errado pela própria régua — leitura de
// 19/08 às 18h com agora 21/08 às 14h são 44h (1 bloco) e 2 dias de
// calendário. Mas dois números diferentes pro mesmo equipamento na mesma tela
// só confundem, e a data resolve os dois problemas de uma vez: é inequívoca e
// diz exatamente onde está o buraco na planilha.
//
// A contagem de dias continua existindo — é ela que ordena e que compara com o
// limite. Só não vai mais pra tela.
export function descreverAtraso(item) {
  if (item?.nunca) return 'nunca medido';
  if (!item?.ultimaLeitura) return 'sem leitura';
  const d = new Date(item.ultimaLeitura);
  if (Number.isNaN(d.getTime())) return 'sem leitura';
  return `sem leitura desde ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}
