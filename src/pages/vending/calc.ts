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

  return { cost, revenue, tax, grossProfit, mallShare, fixedCosts, net, unitMargin, breakEvenUnits, paybackMonths };
};
