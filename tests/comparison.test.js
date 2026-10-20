// Os valores esperados são recalculados no próprio teste com as fórmulas explícitas
// (fator diário DI na 8ª casa, centavos no resgate, IOF → IR), sem usar simulateApplication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, runStrategy } from '../js/comparison.js';
import { businessDaysBetween, calendarDaysBetween } from '../js/calendar.js';
import { irRate } from '../js/tax-rules.js';

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const TD = Math.round(((1.1365) ** (1 / 252) - 1) * 1e8) / 1e8;
const premises = { cdi: 0.1365, selic: 0.1375, ipca: 0.045, horizonMonths: 24, refRate: 1, reinvestRate: 1 };

// Aplicação CDB tributável mantida acima de 30 dias (sem IOF), calculada à mão.
function manualCdb(principal, pct, start, end) {
  const gross = r2(principal * (1 + TD * pct) ** businessDaysBetween(start, end));
  const ir = r2((gross - principal) * irRate(calendarDaysBetween(start, end)));
  return { gross, ir, net: r2(gross - ir) };
}

const stage = (over) => ({ product: 'CDB', indexer: 'CDI', rate: 1, termValue: 24, termUnit: 'months', taxMode: 'auto', cost: 0, ...over });
const model = (stages, over = {}) => ({ principal: 50000, startDate: '2026-11-05', liquidity: 'maturity', stages, premises, ...over });

test('1. CDB 100% CDI x referência 100% CDI: diferença zero', () => {
  const r = compare(model([stage({ termValue: 12 })]));
  assert.deepEqual(r.errors, []);
  assert.equal(r.diffAB, 0);
  close(r.breakevenRate, 1, 1e-6);
  const full = compare(model([stage()]));
  assert.equal(full.C.diff, 0);
});

test('2 e 3. CDB 107,3% CDI por 5 meses + reinvestimento 100% CDI até 24 meses, contra 100% CDI por 24 meses', () => {
  const r = compare(model([stage({ rate: 1.073, termValue: 5 })]));
  const s = r.C.strategy;
  assert.equal(s.valid, true);
  assert.equal(s.apps.length, 2);
  const [a1, a2] = s.apps;
  assert.equal(a1.endDate, '2027-04-05');
  assert.equal(a2.endDate, '2028-11-05');
  assert.equal(a2.isFill, true);

  const m1 = manualCdb(50000, 1.073, '2026-11-05', '2027-04-05');
  const m2 = manualCdb(m1.net, 1, '2027-04-05', '2028-11-05');
  const ref = manualCdb(50000, 1, '2026-11-05', '2028-11-05');
  assert.equal(a1.gross, m1.gross);
  assert.equal(a1.net, m1.net);
  assert.equal(a1.irRate, 0.225); // 151 dias
  assert.equal(a2.principal, m1.net); // reinveste o líquido
  assert.equal(a2.irRate, 0.175); // nova contagem: 580 dias
  assert.equal(s.summary.netFinal, m2.net);
  assert.equal(r.C.reference.apps[0].irRate, 0.15); // 731 dias
  assert.equal(r.C.reference.summary.netFinal, ref.net);
  assert.equal(r.C.diff, r2(m2.net - ref.net));
  assert.equal(s.summary.totalTaxes, r2(m1.ir + m2.ir));

  // A taxa promocional ganha no prazo curto, mas o IR maior sobre o período total pode inverter o resultado.
  assert.equal(r.diffAB, r2(m1.net - manualCdb(50000, 1, '2026-11-05', '2027-04-05').net));
  assert.ok(r.diffAB > 0);
});

test('10. vencimento que não coincide com o horizonte: completa com reinvestimento; acima do horizonte só com liquidez diária', () => {
  const r = compare(model([stage({ termValue: 100, termUnit: 'days' })]));
  const last = r.C.strategy.apps.at(-1);
  assert.equal(last.isFill, true);
  assert.equal(last.endDate, r.C.horizonEnd);

  const tooLong = compare(model([stage({ termValue: 30 })]));
  assert.equal(tooLong.C.valid, false);
  assert.match(tooLong.C.strategy.reason, /liquidez diária/);

  const daily = compare(model([stage({ termValue: 30 })], { liquidity: 'daily' }));
  assert.equal(daily.C.valid, true);
  assert.equal(daily.C.strategy.apps[0].truncated, true);
  assert.equal(daily.C.diff, 0); // mesmo produto da referência, resgatado no horizonte
});

test('11. reinvestimento em múltiplas etapas: cada aplicação tem seu IR e parte do líquido anterior', () => {
  const stages = [
    stage({ rate: 1.1, termValue: 3 }),
    stage({ product: 'LCA', rate: 0.92, termValue: 6 }),
    stage({ indexer: 'PRE', rate: 0.13, termValue: 1, termUnit: 'years' }),
  ];
  const s = runStrategy({ principal: 50000, startDate: '2026-11-05', stages, premises, liquidity: 'maturity', horizonEnd: '2028-11-05' });
  assert.equal(s.apps.length, 4);
  // 3 + 6 + 12 = 21 meses; o reinvestimento final cobre 3 meses (92 dias) → 22,5%.
  assert.deepEqual(s.apps.map((a) => a.irRate), [0.225, 0, 0.175, 0.225]);
  for (let i = 1; i < s.apps.length; i++) assert.equal(s.apps[i].principal, s.apps[i - 1].net);
  assert.equal(s.apps[1].ir, 0);
  const pre = s.apps[2];
  assert.equal(pre.gross, r2(pre.principal * 1.13 ** (businessDaysBetween(pre.startDate, pre.endDate) / 252)));
});

test('7. entradas inválidas retornam erros sem lançar exceção', () => {
  assert.ok(compare(model([stage()], { principal: 0 })).errors.length);
  assert.ok(compare(model([stage({ termValue: -3 })])).errors.length);
  assert.ok(compare(model([])).errors.length);
  assert.match(compare(model([stage({ product: 'TESOURO_IPCA' })])).errors[0], /marcação a mercado/);
});

test('LCI 92% CDI x CDB: percentual de CDI equivalente para empatar', () => {
  const r = compare(model([stage({ product: 'LCI', rate: 0.92, termValue: 12 })]));
  // Isenta, 365 dias (IR do CDB = 17,5%). O CDB precisa gerar rendimento bruto = rendimento da LCI / 0,825:
  // (1 + TD·p)^du − 1 = [(1 + TD·0,92)^du − 1] / 0,825  ⇒  p = ([1 + I/0,825]^(1/du) − 1) / TD.
  // Por causa da capitalização, p fica ABAIXO da regra de bolso 92%/0,825 ≈ 111,5%.
  const du = businessDaysBetween('2026-11-05', '2027-11-05');
  const lciIncome = (1 + TD * 0.92) ** du - 1;
  const p = ((1 + lciIncome / 0.825) ** (1 / du) - 1) / TD;
  close(r.breakevenRate, p, 1e-4);
  assert.ok(r.breakevenRate < 0.92 / 0.825);
});

function close(a, b, tol) { assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`); }

test('regressões: taxa inválida em etapa seguinte, prazos/horizonte enormes e etapas após o horizonte', () => {
  assert.match(compare(model([stage({ termValue: 5 }), stage({ rate: NaN })])).errors[0], /Etapa 2: taxa/);
  assert.match(compare(model([stage({ termValue: 5 }), stage({ rate: -0.05 })])).errors[0], /Etapa 2: taxa/);
  assert.match(compare(model([stage({ termValue: 1_000_000 })])).errors[0], /50 anos/);
  assert.match(compare(model([stage()], { premises: { ...premises, horizonMonths: 10_000_000 } })).errors[0], /600 meses/);
  const dropped = compare(model([stage({ termValue: 24 }), stage({ termValue: 6 })]));
  assert.equal(dropped.C.valid, false);
  assert.match(dropped.C.strategy.reason, /etapas seguintes/);
});
