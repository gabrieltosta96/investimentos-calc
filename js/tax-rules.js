// Regras tributárias e de produtos centralizadas. Atualize aqui se a legislação mudar.
//
// Última verificação: 2026-10-20.
// - IR regressivo (Lei 11.033/2004, art. 1º): continua vigente. A MP 1.303/2025, que propunha
//   alíquota única de 17,5% e IR de 5% sobre LCI/LCA, perdeu a validade em out/2025.
// - IOF regressivo (Decreto 6.306/2007, art. 32 e anexo): incide sobre o rendimento de resgates
//   em menos de 30 dias.
// - LCI/LCA: rendimento isento de IR para pessoa física (Lei 11.033/2004, art. 3º, II e IV).
//   Prazo mínimo (Resolução CMN 5.215/2025): 6 meses para títulos não atualizados por índice de
//   preços; LCI atualizada por índice de preços: 36 meses; LCA atualizada por índice de preços: 12 meses.

import { addMonths } from './calendar.js';

export const TAX_RULES_VERIFIED_AT = '2026-10-20';

// Prazo em dias corridos entre aplicação e resgate.
export const IR_BRACKETS = [
  { maxDays: 180, rate: 0.225 },
  { maxDays: 360, rate: 0.2 },
  { maxDays: 720, rate: 0.175 },
  { maxDays: Infinity, rate: 0.15 },
];

// Percentual do rendimento devido como IOF, indexado pelo número de dias corridos (1 a 29).
// A partir do 30º dia, IOF = 0.
const IOF_PERCENT_BY_DAY = [
  100, 96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50,
  46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3,
];

export function irRate(calendarDays) {
  if (!Number.isFinite(calendarDays) || calendarDays < 0) throw new RangeError('Prazo inválido para IR');
  return IR_BRACKETS.find((b) => calendarDays <= b.maxDays).rate;
}

export function iofRate(calendarDays) {
  if (!Number.isFinite(calendarDays) || calendarDays < 0) throw new RangeError('Prazo inválido para IOF');
  return calendarDays >= 30 ? 0 : IOF_PERCENT_BY_DAY[calendarDays] / 100;
}

// supported=false: o produto ainda não é simulado; a interface explica o motivo em vez de mostrar números.
export const PRODUCTS = {
  CDB: { label: 'CDB', supported: true, irExemptPF: false, fgc: true },
  RDB: { label: 'RDB', supported: true, irExemptPF: false, fgc: true },
  LCI: { label: 'LCI', supported: true, irExemptPF: true, fgc: true, minMonths: 6, minMonthsPriceIndexed: 36 },
  LCA: { label: 'LCA', supported: true, irExemptPF: true, fgc: true, minMonths: 6, minMonthsPriceIndexed: 12 },
  TESOURO_SELIC: {
    label: 'Tesouro Selic', supported: false,
    reason: 'Preço de mercado (ágio/deságio), taxa de custódia da B3 e regras de liquidez do Tesouro Direto ainda não são modeladas.',
  },
  TESOURO_PRE: {
    label: 'Tesouro Prefixado', supported: false,
    reason: 'Resgate antes do vencimento depende da marcação a mercado; a taxa de custódia da B3 também não é modelada.',
  },
  TESOURO_IPCA: {
    label: 'Tesouro IPCA+', supported: false,
    reason: 'Depende da marcação a mercado, do VNA com IPCA mensal real e da taxa de custódia da B3.',
  },
  FUNDO_RF: {
    label: 'Fundo de renda fixa', supported: false,
    reason: 'Fundos têm taxa de administração, come-cotas semestral e regras próprias de cotização.',
  },
  POUPANCA: {
    label: 'Poupança', supported: false,
    reason: 'Rende por aniversário mensal com TR, e a regra muda conforme a Selic meta; ainda não modelado.',
  },
  OUTRO: {
    label: 'Outro', supported: false,
    reason: 'Sem regras tributárias definidas para o produto, a simulação poderia apresentar números incorretos.',
  },
};

// taxMode: 'auto' (regra do produto para pessoa física), 'taxable' (forçar tabela regressiva),
// 'exempt' (forçar isenção — use apenas se tiver certeza do enquadramento).
export function isIrExempt(productKey, taxMode = 'auto') {
  if (taxMode === 'taxable') return false;
  if (taxMode === 'exempt') return true;
  return Boolean(PRODUCTS[productKey]?.irExemptPF);
}

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

// Ordem de incidência: IOF sobre o rendimento; IR sobre (rendimento − IOF). Valores em centavos.
export function computeRedemptionTaxes({ principal, gross, calendarDays, exempt }) {
  const income = gross - principal;
  if (income <= 0) return { income, iof: 0, ir: 0, iofRate: 0, irRate: 0 };
  const iofR = iofRate(calendarDays);
  const iof = round2(income * iofR);
  const irR = exempt ? 0 : irRate(calendarDays);
  const ir = round2((income - iof) * irR);
  return { income, iof, ir, iofRate: iofR, irRate: irR };
}

// Aviso (não bloqueante) quando o prazo é menor que a carência mínima exigida para LCI/LCA.
export function minTermWarning(productKey, indexer, startIso, endIso) {
  const p = PRODUCTS[productKey];
  if (!p?.minMonths) return null;
  const min = indexer === 'IPCA' ? p.minMonthsPriceIndexed : p.minMonths;
  if (endIso < addMonths(startIso, min)) {
    return `${p.label}${indexer === 'IPCA' ? ' atrelada a índice de preços' : ''} exige prazo mínimo de ${min} meses (Res. CMN 5.215/2025). Verifique as condições do título.`;
  }
  return null;
}
