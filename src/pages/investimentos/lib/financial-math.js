// Matemática financeira pura (sem DOM). Taxas sempre em decimal: 13,65% a.a. = 0.1365; 107,3% do CDI = 1.073.
//
// Convenções (base 252 dias úteis, padrão do mercado brasileiro):
// - Taxa diária do DI/Selic: TD = (1 + taxa_anual)^(1/252) − 1, arredondada na 8ª casa (convenção B3).
// - Percentual do indexador: fator diário = 1 + TD × percentual; fator do período = fator_diário^du.
// - Prefixado: fator = (1 + taxa)^(du/252).
// - IPCA + taxa (simplificação): fator = [(1 + IPCA_projetado) × (1 + taxa)]^(du/252).
// - du = dias úteis entre aplicação (inclusive) e resgate (exclusive).
// A taxa projetada do indexador é constante no período: é uma hipótese, não uma previsão.

import { businessDaysBetween, calendarDaysBetween, parseISO } from './calendar.js';
import { PRODUCTS, computeRedemptionTaxes, isIrExempt } from './tax-rules.js';

export const INDEXERS = {
  CDI: { label: '% do CDI', rateKind: 'percentOfIndex' },
  SELIC: { label: '% da Selic', rateKind: 'percentOfIndex' },
  PRE: { label: 'Prefixado', rateKind: 'annual' },
  IPCA: { label: 'IPCA + taxa', rateKind: 'annual' },
};

export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const round8 = (x) => Math.round(x * 1e8) / 1e8;

export function dailyIndexRate(annualRate) {
  return round8((1 + annualRate) ** (1 / 252) - 1);
}

export function dailyFactor({ indexer, rate }, premises) {
  switch (indexer) {
    case 'CDI':
      return 1 + dailyIndexRate(premises.cdi) * rate;
    case 'SELIC':
      return 1 + dailyIndexRate(premises.selic) * rate;
    case 'PRE':
      return (1 + rate) ** (1 / 252);
    case 'IPCA':
      return ((1 + premises.ipca) * (1 + rate)) ** (1 / 252);
    default:
      throw new RangeError(`Indexador não suportado: ${indexer}`);
  }
}

export function grossFactor(app, premises, businessDays) {
  return dailyFactor(app, premises) ** businessDays;
}

// Retorna lista de mensagens de erro; vazia quando a aplicação é válida.
export function validateApplication(app) {
  const errors = [];
  if (!Number.isFinite(app.principal) || app.principal <= 0) errors.push('Valor aplicado deve ser maior que zero.');
  const start = parseISO(app.startDate);
  const end = parseISO(app.endDate);
  if (!start) errors.push('Data de aplicação inválida.');
  if (!end) errors.push('Data de vencimento inválida.');
  if (start && end && end <= start) errors.push('O prazo deve ser positivo (vencimento após a aplicação).');
  if (!PRODUCTS[app.product]) errors.push('Tipo de investimento desconhecido.');
  else if (!PRODUCTS[app.product].supported) errors.push(`${PRODUCTS[app.product].label}: ${PRODUCTS[app.product].reason}`);
  if (!INDEXERS[app.indexer]) errors.push('Indexador inválido.');
  if (!Number.isFinite(app.rate) || app.rate < 0) errors.push('Taxa deve ser um número não negativo.');
  if (app.cost != null && (!Number.isFinite(app.cost) || app.cost < 0)) errors.push('Custos devem ser não negativos.');
  return errors;
}

const PREMISE_BY_INDEXER = { CDI: ['cdi', 'CDI'], SELIC: ['selic', 'Selic'], IPCA: ['ipca', 'IPCA'] };

// Valida apenas as projeções exigidas pelos indexadores usados.
export function validatePremises(p, indexers) {
  const errors = [];
  for (const [key, label] of new Set(indexers.map((i) => PREMISE_BY_INDEXER[i]).filter(Boolean))) {
    if (!Number.isFinite(p?.[key]) || p[key] <= -1) errors.push(`Informe o ${label} anual projetado.`);
  }
  return errors;
}

// Simula uma aplicação mantida até o resgate em endDate.
// Bruto é arredondado em centavos no resgate; IOF e IR também (como no extrato da instituição).
// Custos (R$) conhecidos são descontados após os impostos.
export function simulateApplication(app, premises) {
  const errors = [...validateApplication(app), ...validatePremises(premises, [app.indexer])];
  if (errors.length) throw new RangeError(errors.join(' '));

  const calendarDays = calendarDaysBetween(app.startDate, app.endDate);
  const businessDays = businessDaysBetween(app.startDate, app.endDate);
  const factor = grossFactor(app, premises, businessDays);
  const gross = round2(app.principal * factor);
  const exempt = isIrExempt(app.product, app.taxMode);
  const taxes = computeRedemptionTaxes({ principal: app.principal, gross, calendarDays, exempt });
  const cost = app.cost || 0;
  const net = round2(gross - taxes.iof - taxes.ir - cost);

  return {
    ...app,
    calendarDays,
    businessDays,
    factor,
    gross,
    income: round2(taxes.income),
    iof: taxes.iof,
    ir: taxes.ir,
    iofRate: taxes.iofRate,
    irRate: taxes.irRate,
    exempt,
    cost,
    taxes: round2(taxes.iof + taxes.ir),
    net,
    netIncome: round2(net - app.principal),
    grossReturn: gross / app.principal - 1,
    netReturn: net / app.principal - 1,
  };
}

// Saldo bruto estimado em uma data intermediária (para gráficos).
export function grossBalanceAt(app, premises, dateIso) {
  return app.principal * grossFactor(app, premises, businessDaysBetween(app.startDate, dateIso));
}

// Retorno acumulado → taxa equivalente ao ano (base 252 dias úteis).
export function annualize(totalReturn, businessDays) {
  if (!(businessDays > 0) || totalReturn <= -1) return null;
  return (1 + totalReturn) ** (252 / businessDays) - 1;
}
