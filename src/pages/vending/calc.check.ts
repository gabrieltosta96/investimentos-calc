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
