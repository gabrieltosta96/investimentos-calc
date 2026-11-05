export type VendingInput = {
  buyPrice: number;
  sellPrice: number;
  units: number;
  taxPct: number;
  cardFeePct: number;
  mallSharePct: number;
  rent: number;
  accounting: number;
  otherCosts: number;
  initialInvestment: number;
};

// Tax (Simples Nacional) and card fee are on revenue. Mall share is on gross profit, matching the original spreadsheet.
export const calculate = (input: VendingInput) => {
  const cost = input.buyPrice * input.units;
  const revenue = input.sellPrice * input.units;
  const tax = revenue * (input.taxPct / 100);
  const cardFee = revenue * (input.cardFeePct / 100);
  const grossProfit = revenue - cost;
  // Selling at a loss doesn't make the mall pay you.
  const mallShare = Math.max(0, grossProfit) * (input.mallSharePct / 100);
  const fixedCosts = input.rent + input.accounting + input.otherCosts;
  const net = grossProfit - tax - cardFee - mallShare - fixedCosts;

  // What each package leaves after variable costs; break-even = fixed costs / that.
  const unitMargin =
    input.sellPrice -
    input.buyPrice -
    input.sellPrice * ((input.taxPct + input.cardFeePct) / 100) -
    (input.sellPrice - input.buyPrice) * (input.mallSharePct / 100);
  const breakEvenUnits = unitMargin > 0 ? fixedCosts / unitMargin : Infinity;

  // Business metrics; percentages are fractions (0.25 = 25%).
  const t = (input.taxPct + input.cardFeePct) / 100;
  const ms = input.mallSharePct / 100;
  const metrics = {
    markup: input.buyPrice > 0 ? (input.sellPrice - input.buyPrice) / input.buyPrice : 0,
    netMargin: revenue > 0 ? net / revenue : 0,
    // How much sales can drop before losing money.
    safetyMargin: input.units > 0 ? (input.units - breakEvenUnits) / input.units : 0,
    // Lowest price that breaks even at the current volume: units × (p(1−t−ms) − buy(1−ms)) = fixed.
    minSellPrice: input.units > 0 && 1 - t - ms > 0 ? (fixedCosts / input.units + input.buyPrice * (1 - ms)) / (1 - t - ms) : Infinity,
  };

  return { cost, revenue, tax, cardFee, grossProfit, mallShare, fixedCosts, net, unitMargin, breakEvenUnits, metrics };
};

// Month-by-month cash. Conservative timing: stock and fixed costs are paid at the start of the month,
// sales come in by the end (net of tax, card fee and mall share). When the cash on hand can't cover the
// start-of-month bill, the owner injects the difference. Sales go linearly from rampStartPct% in month 1
// to 100% in month rampMonths (whole months; rampMonths <= 1: no ramp). The initial investment is spent before month 1.
export const cashFlow = (input: VendingInput, months: number, rampStartPct: number, rampMonths: number) => {
  let cash = 0;
  let injected = input.initialInvestment;
  const rampEnd = Math.round(rampMonths);
  const first = Math.max(0, rampStartPct) / 100;
  return Array.from({ length: months }, (_, i) => {
    const ramp = rampEnd <= 1 ? 1 : first + (1 - first) * Math.min(1, i / (rampEnd - 1));
    const units = Math.round(input.units * ramp);
    const r = calculate({ ...input, units });
    const upfront = r.cost + r.fixedCosts;
    // Ignore sub-cent float leftovers (e.g. selling at exactly the break-even price).
    const injection = upfront - cash > 0.005 ? upfront - cash : 0;
    const start = cash;
    cash += injection + r.net;
    injected += injection;
    return { month: i + 1, units, start, upfront, injection, net: r.net, end: cash, injected };
  });
};

// Months simulated to find the payback: long ramps are simulated, not extrapolated.
// ponytail: past 50 years counts as "nunca".
export const PAYBACK_HORIZON = 600;

// First month where cash in hand covers everything put in (investment + injections); Infinity if not
// within the flow, so pass a PAYBACK_HORIZON-long flow.
export const payback = (flow: ReturnType<typeof cashFlow>) => flow.find((f) => f.end - f.injected >= 0)?.month ?? Infinity;
