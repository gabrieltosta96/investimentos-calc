import assert from "node:assert/strict";
import { calculate } from "./calc.ts";

const base = {
  buyPrice: 8,
  sellPrice: 15,
  units: 720,
  taxPct: 0,
  cardFeePct: 0,
  mallSharePct: 10,
  rent: 3500,
  accounting: 300,
  otherCosts: 250,
  initialInvestment: 0,
};

const r = calculate(base);
assert.equal(r.cost, 5760);
assert.equal(r.revenue, 10800);
assert.equal(r.grossProfit, 5040);
assert.equal(r.mallShare, 504);
assert.equal(r.net, 486);

const taxed = calculate({ ...base, taxPct: 4 });
assert.equal(taxed.tax, 432);
assert.equal(taxed.net, 54);
console.log("ok");
assert.ok(Math.abs(taxed.unitMargin - 5.7) < 1e-9);
assert.ok(Math.abs(taxed.breakEvenUnits - 4050 / 5.7) < 1e-9);
assert.ok(Math.abs(taxed.unitMargin * 720 - taxed.fixedCosts - taxed.net) < 1e-9);
console.log("ok break-even");

assert.equal(calculate({ ...base, taxPct: 4, initialInvestment: 10800 }).paybackMonths, 200);
assert.equal(calculate({ ...base, taxPct: 4, rent: 9999, initialInvestment: 1 }).paybackMonths, Infinity);
assert.equal(base.initialInvestment, 0);
assert.equal(r.paybackMonths, 0);
console.log("ok payback");

const loss = calculate({ ...base, sellPrice: 5 });
assert.equal(loss.mallShare, 0);
assert.equal(loss.net, 5 * 720 - 8 * 720 - 4050);
assert.equal(loss.breakEvenUnits, Infinity);
console.log("ok loss");

const withInvestment = calculate({ ...base, taxPct: 4, initialInvestment: 10800 });
const m = withInvestment.metrics;
assert.equal(m.markup, 7 / 8);
assert.equal(m.netMargin, 54 / 10800);
assert.equal(m.annualRoi, (54 * 12) / 10800);
assert.ok(Math.abs(m.safetyMargin - (720 - 4050 / 5.7) / 720) < 1e-12);
// Selling at the minimum price must give zero profit.
assert.ok(Math.abs(calculate({ ...base, taxPct: 4, sellPrice: m.minSellPrice }).net) < 1e-9);
console.log("ok metrics");

// Card fee behaves like tax: both on revenue.
const card = calculate({ ...base, taxPct: 2, cardFeePct: 2 });
assert.equal(card.cardFee, 216);
assert.equal(card.net, taxed.net);
assert.ok(Math.abs(card.unitMargin - taxed.unitMargin) < 1e-9);
assert.ok(Math.abs(calculate({ ...base, taxPct: 2, cardFeePct: 2, sellPrice: card.metrics.minSellPrice }).net) < 1e-9);
console.log("ok card fee");
