import assert from "node:assert/strict";
import { PAYBACK_HORIZON, calculate, cashFlow, payback } from "./calc.ts";

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


const loss = calculate({ ...base, sellPrice: 5 });
assert.equal(loss.mallShare, 0);
assert.equal(loss.net, 5 * 720 - 8 * 720 - 4050);
assert.equal(loss.breakEvenUnits, Infinity);
console.log("ok loss");

const withInvestment = calculate({ ...base, taxPct: 4, initialInvestment: 10800 });
const m = withInvestment.metrics;
assert.equal(m.markup, 7 / 8);
assert.equal(m.netMargin, 54 / 10800);
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

// Cash flow: month 1 needs stock + fixed costs injected, then sales pay for the next month.
const flow = cashFlow({ ...base, taxPct: 4, initialInvestment: 20000 }, 3, 100, 0);
assert.equal(flow[0].injection, 5760 + 4050);
assert.equal(flow[0].end, 5760 + 4050 + 54);
assert.equal(flow[1].injection, 0);
assert.equal(flow[2].end, 9810 + 54 * 3);
assert.equal(flow[2].end - flow[2].injected, 54 * 3 - 20000);
// Payback counts the working capital too: 20000 + 9810 put in, cash starts at 9810 and grows 54/month.
assert.equal(payback(flow), Infinity); // not within 3 months
assert.equal(payback(cashFlow({ ...base, taxPct: 4, initialInvestment: 20000 }, PAYBACK_HORIZON, 100, 0)), Math.ceil(20000 / 54));
assert.equal(payback(cashFlow({ ...base, taxPct: 4, rent: 9999, initialInvestment: 1 }, PAYBACK_HORIZON, 100, 0)), Infinity);
// No investment: month 1's injection comes back with month 1's profit.
assert.equal(payback(cashFlow({ ...base, taxPct: 4 }, PAYBACK_HORIZON, 100, 0)), 1);
// Ramp longer than the 24-month projection: still simulated month by month, not "nunca".
const longRamp = (rampMonths: number) => payback(cashFlow({ ...base, initialInvestment: 5000 }, PAYBACK_HORIZON, 20, rampMonths));
assert.ok(Number.isFinite(longRamp(36)) && longRamp(36) > longRamp(1));
// Fractional ramp months round to whole months; negative start % counts as 0.
assert.deepEqual(cashFlow(base, 3, 50, 2.6), cashFlow(base, 3, 50, 3));
assert.deepEqual(cashFlow(base, 3, -10, 3), cashFlow(base, 3, 0, 3));
// Ramp: half the sales in month 1, full in month 3; losses keep requiring injections.
const ramp = cashFlow({ ...base, taxPct: 4 }, 4, 50, 3);
assert.deepEqual(ramp.map((m) => m.units), [360, 540, 720, 720]);
assert.ok(ramp[1].injection > 0);
assert.equal(ramp[3].injection, 0);
// Cash never goes negative: injections cover every start-of-month bill.
assert.ok(cashFlow({ ...base, rent: 9999 }, 12, 100, 0).every((m) => m.start + m.injection >= m.upfront && m.injection > 0));
console.log("ok cash flow");

// Selling at exactly break-even: float leftovers must not count as injections.
const even = calculate({ ...base, taxPct: 4 }).metrics.minSellPrice;
assert.ok(cashFlow({ ...base, taxPct: 4, sellPrice: even }, 24, 100, 0).slice(1).every((m) => m.injection === 0));
// Ramp above 100% (opening spike) settles at 100%.
assert.deepEqual(cashFlow({ ...base, taxPct: 4 }, 4, 150, 3).map((m) => m.units), [1080, 900, 720, 720]);
console.log("ok payback");
