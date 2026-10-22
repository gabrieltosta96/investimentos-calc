import { test } from 'node:test';
import assert from 'node:assert/strict';
import { irRate, iofRate, computeRedemptionTaxes, isIrExempt, minTermWarning } from '../../src/pages/investimentos/lib/tax-rules.js';
import { simulateApplication } from '../../src/pages/investimentos/lib/financial-math.js';

const premises = { cdi: 0.1365, selic: 0.1365, ipca: 0.045 };

test('IR regressivo nos quatro intervalos (limites inclusivos)', () => {
  assert.equal(irRate(1), 0.225);
  assert.equal(irRate(180), 0.225);
  assert.equal(irRate(181), 0.2);
  assert.equal(irRate(360), 0.2);
  assert.equal(irRate(361), 0.175);
  assert.equal(irRate(720), 0.175);
  assert.equal(irRate(721), 0.15);
  assert.equal(irRate(5000), 0.15);
  assert.throws(() => irRate(-1));
});

test('IOF regressivo até 29 dias e zero a partir de 30', () => {
  assert.equal(iofRate(1), 0.96);
  assert.equal(iofRate(10), 0.66);
  assert.equal(iofRate(15), 0.5);
  assert.equal(iofRate(29), 0.03);
  assert.equal(iofRate(30), 0);
  assert.equal(iofRate(400), 0);
});

test('IR incide sobre (rendimento − IOF), não sobre o capital', () => {
  // 10 dias: IOF 66% do rendimento de R$ 100 = 66; IR 22,5% de 34 = 7,65.
  const t = computeRedemptionTaxes({ principal: 1000, gross: 1100, calendarDays: 10, exempt: false });
  assert.equal(t.iof, 66);
  assert.equal(t.ir, 7.65);
  const after30 = computeRedemptionTaxes({ principal: 1000, gross: 1100, calendarDays: 30, exempt: false });
  assert.equal(after30.iof, 0);
  assert.equal(after30.ir, 22.5);
});

test('CDB resgatado em 10 dias paga IOF; em 31 dias não', () => {
  const base = { product: 'CDB', indexer: 'CDI', rate: 1, principal: 50000, startDate: '2026-11-03' };
  const short = simulateApplication({ ...base, endDate: '2026-11-13' }, premises);
  assert.equal(short.iofRate, 0.66);
  assert.equal(short.iof, Math.round((short.gross - 50000) * 0.66 * 100) / 100);
  const long = simulateApplication({ ...base, endDate: '2026-12-04' }, premises);
  assert.equal(long.iof, 0);
});

test('LCI/LCA isentas de IR para PF; modo tributável força a tabela', () => {
  assert.equal(isIrExempt('LCI'), true);
  assert.equal(isIrExempt('LCA'), true);
  assert.equal(isIrExempt('CDB'), false);
  assert.equal(isIrExempt('LCA', 'taxable'), false);
  const lca = simulateApplication({
    product: 'LCA', indexer: 'CDI', rate: 0.92, principal: 50000, startDate: '2026-11-03', endDate: '2027-11-03',
  }, premises);
  assert.equal(lca.ir, 0);
  assert.equal(lca.iof, 0);
  assert.equal(lca.net, lca.gross);
});

test('carência mínima de LCI/LCA (Res. CMN 5.215/2025)', () => {
  assert.match(minTermWarning('LCI', 'CDI', '2026-11-03', '2027-03-03'), /6 meses/);
  assert.equal(minTermWarning('LCI', 'CDI', '2026-11-03', '2027-05-03'), null);
  assert.match(minTermWarning('LCI', 'IPCA', '2026-11-03', '2027-11-03'), /36 meses/);
  assert.equal(minTermWarning('CDB', 'CDI', '2026-11-03', '2026-11-10'), null);
});
