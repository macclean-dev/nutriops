// ─────────────────────────────────────────────────────────────────────────────
// Temperatura por tipo de produto no Recebimento (pedido da RT da CASA DOCE,
// 06/10). RDC 216 4.7.3: "a temperatura das matérias-primas e ingredientes que
// necessitem de condições especiais de conservação deve ser verificada nas
// etapas de recepção". Até a v1.9.268 o formulário tinha UMA temperatura, em
// texto, que nada avaliava.
//
// Só na CASA DOCE matriz (`recebimentoCompleto`, modulos-da-loja.js): PKS e
// Terraço recebem da matriz produto pronto, e a RT pediu manter lá como está.
//
// Faixas de referência ditadas pela RT. Avalia o LIMITE DE CIMA de cada tipo,
// que é o que põe o alimento em risco: produto refrigerado chegando mais frio
// que o mínimo da faixa (pescado a 1 °C no gelo, por exemplo) não vira
// desvio. A faixa completa aparece na tela como referência.
// ─────────────────────────────────────────────────────────────────────────────

import { parseTemperatura } from './limits';

export const TIPOS_TEMPERATURA = [
  { id: 'congelado',   label: 'Congelado',           curto: 'Congelado',   referencia: 'igual ou inferior a -12 °C (ou conforme o fabricante)', max: -12 },
  { id: 'pescado',     label: 'Pescado resfriado',   curto: 'Pescado',     referencia: 'entre 2 °C e 3 °C',  max: 3 },
  { id: 'carne',       label: 'Carne resfriada',     curto: 'Carne',       referencia: 'entre 4 °C e 7 °C',  max: 7 },
  { id: 'refrigerado', label: 'Demais refrigerados', curto: 'Refrigerado', referencia: 'entre 4 °C e 10 °C', max: 10 },
];

// `curto` é o que cabe no seletor da linha num celular; o nome completo
// aparece na referência acima das linhas e no resumo gravado.
export const LINHAS_INICIAIS = 6;

export const linhaVazia = () => ({ tipo: '', valor: '' });

const tipoPorId = (id) => TIPOS_TEMPERATURA.find((t) => t.id === id) ?? null;

// Situação de UMA linha: 'vazia' (nada preenchido), 'incompleta' (falta tipo
// ou valor legível), 'ok' ou 'fora'.
export function avaliarLinha(linha) {
  const temValor = String(linha?.valor ?? '').trim() !== '';
  if (!linha?.tipo && !temValor) return 'vazia';
  const tipo = tipoPorId(linha?.tipo);
  const v = parseTemperatura(linha?.valor);
  if (!tipo || !Number.isFinite(v)) return 'incompleta';
  return v <= tipo.max ? 'ok' : 'fora';
}

// Congelado digitado positivo quase sempre é o sinal que faltou: o teclado
// numérico do celular não tem tecla de menos (o bug de 14/08). Mesmo raciocínio
// de suspectMissingMinus (limits.js): só sugere se o valor negado ficaria
// dentro da faixa.
export function faltouSinal(linha) {
  if (linha?.tipo !== 'congelado') return false;
  const v = parseTemperatura(linha?.valor);
  return Number.isFinite(v) && v > 0 && -v <= tipoPorId('congelado').max;
}

// Linhas que valem a pena gravar (ignora as vazias) já com a avaliação.
export function linhasPreenchidas(linhas) {
  return (linhas ?? [])
    .map((l) => ({ tipo: l.tipo, valor: String(l.valor ?? '').trim(), situacao: avaliarLinha(l) }))
    .filter((l) => l.situacao !== 'vazia');
}

export const temIncompleta = (linhas) => linhasPreenchidas(linhas).some((l) => l.situacao === 'incompleta');
export const temFora = (linhas) => linhasPreenchidas(linhas).some((l) => l.situacao === 'fora');

// Texto curto pro campo `temperatura` antigo (histórico, CSV, Dossiê e Central
// de NC continuam lendo esse campo): "Congelado -15 °C; Carne resfriada 9 °C (fora)".
export function resumoTemperaturas(linhas) {
  return linhasPreenchidas(linhas)
    .map((l) => `${tipoPorId(l.tipo)?.label ?? 'Sem tipo'} ${l.valor} °C${l.situacao === 'fora' ? ' (fora)' : ''}`)
    .join('; ');
}
