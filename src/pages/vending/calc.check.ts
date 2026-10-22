import assert from "node:assert/strict";
import { calculate } from "./calc.ts";

const base = {
  buyPrice: 8,
  sellPrice: 15,
  units: 720,
  taxPct: 0,
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
