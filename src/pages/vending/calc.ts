export type VendingInput = {
  buyPrice: number;
  sellPrice: number;
  units: number;
  taxPct: number;
  mallSharePct: number;
  rent: number;
  accounting: number;
  otherCosts: number;
  initialInvestment: number;
};

// Tax is on revenue (Simples Nacional). Mall share is on gross profit, matching the original spreadsheet.
export const calculate = (input: VendingInput) => {
  const cost = input.buyPrice * input.units;
  const revenue = input.sellPrice * input.units;
  const tax = revenue * (input.taxPct / 100);
  const grossProfit = revenue - cost;
  // Selling at a loss doesn't make the mall pay you.
  const mallShare = Math.max(0, grossProfit) * (input.mallSharePct / 100);
  const fixedCosts = input.rent + input.accounting + input.otherCosts;
  const net = grossProfit - tax - mallShare - fixedCosts;

  // What each package leaves after variable costs; break-even = fixed costs / that.
  const unitMargin =
    input.sellPrice -
    input.buyPrice -
    input.sellPrice * (input.taxPct / 100) -
    (input.sellPrice - input.buyPrice) * (input.mallSharePct / 100);
  const breakEvenUnits = unitMargin > 0 ? fixedCosts / unitMargin : Infinity;

  // Months of net profit needed to pay back the initial investment.
  const paybackMonths = input.initialInvestment <= 0 ? 0 : net > 0 ? input.initialInvestment / net : Infinity;

  // Business metrics; percentages are fractions (0.25 = 25%).
  const t = input.taxPct / 100;
  const ms = input.mallSharePct / 100;
  const metrics = {
    markup: input.buyPrice > 0 ? (input.sellPrice - input.buyPrice) / input.buyPrice : 0,
    netMargin: revenue > 0 ? net / revenue : 0,
    annualRoi: input.initialInvestment > 0 ? (net * 12) / input.initialInvestment : 0,
    // How much sales can drop before losing money.
    safetyMargin: input.units > 0 ? (input.units - breakEvenUnits) / input.units : 0,
    // Lowest price that breaks even at the current volume: units × (p(1−t−ms) − buy(1−ms)) = fixed.
    minSellPrice: input.units > 0 && 1 - t - ms > 0 ? (fixedCosts / input.units + input.buyPrice * (1 - ms)) / (1 - t - ms) : Infinity,
  };

  return { cost, revenue, tax, grossProfit, mallShare, fixedCosts, net, unitMargin, breakEvenUnits, paybackMonths, metrics };
};
