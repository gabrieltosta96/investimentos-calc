// Valores de referência derivados à mão ou de dados publicados pelo BCB (documentados em cada teste).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDaysBetween, easterSunday, nationalHolidays, addMonths, addTerm } from '../../src/pages/investimentos/lib/calendar.js';
import { dailyIndexRate, grossFactor, simulateApplication, annualize } from '../../src/pages/investimentos/lib/financial-math.js';

const premises = { cdi: 0.1365, selic: 0.1365, ipca: 0.045 };
const close = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('Páscoa e feriados nacionais de 2026', () => {
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  const h = [...nationalHolidays(2026)].sort();
  assert.deepEqual(h, [
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01',
    '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
  ]);
});

test('dias úteis de 2026: 261 dias de semana − 12 feriados em dia de semana = 249', () => {
  // 15/11/2026 cai num domingo; os demais 12 feriados caem de segunda a sexta.
  assert.equal(businessDaysBetween('2026-01-01', '2027-01-01'), 249);
});

test('soma de prazos com fim de mês', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2027-12-31', 2), '2028-02-29');
  assert.equal(addTerm('2026-01-10', 2, 'years'), '2028-01-10');
  assert.equal(addTerm('2026-01-10', 45, 'days'), '2026-02-24');
});

test('taxa diária do CDI bate com a série 12 do BCB (CDI 13,65% a.a. → 0,050788% a.d.)', () => {
  // Fonte: api.bcb.gov.br série 12 em 19/10/2026 = 0.050788 (% a.d.), série 4389 = 13.65 (% a.a.).
  close(dailyIndexRate(0.1365), 0.00050788, 6e-9);
});

test('prefixado: 252 dias úteis a 13% a.a. dá fator 1,13', () => {
  close(grossFactor({ indexer: 'PRE', rate: 0.13 }, premises, 252), 1.13, 1e-12);
});

test('CDI e Selic com valores diferentes usam cada um a sua taxa', () => {
  const p = { cdi: 0.1365, selic: 0.1375, ipca: 0.045 };
  const fCdi = grossFactor({ indexer: 'CDI', rate: 1 }, p, 100);
  const fSelic = grossFactor({ indexer: 'SELIC', rate: 1 }, p, 100);
  close(fCdi, (1 + dailyIndexRate(0.1365)) ** 100, 1e-12);
  close(fSelic, (1 + dailyIndexRate(0.1375)) ** 100, 1e-12);
  assert.ok(fSelic > fCdi);
});

test('IPCA + taxa: [(1+IPCA)(1+taxa)]^(du/252)', () => {
  close(grossFactor({ indexer: 'IPCA', rate: 0.07 }, premises, 252), 1.045 * 1.07, 1e-12);
});

test('retorno bruto x líquido: CDB 100% CDI, 1 ano (IR 17,5%)', () => {
  const r = simulateApplication({
    product: 'CDB', indexer: 'CDI', rate: 1, principal: 10000, startDate: '2026-01-01', endDate: '2027-01-01',
  }, premises);
  const du = 249;
  const gross = Math.round(10000 * (1 + dailyIndexRate(0.1365)) ** du * 100) / 100;
  assert.equal(r.businessDays, du);
  assert.equal(r.calendarDays, 365);
  assert.equal(r.gross, gross);
  assert.equal(r.irRate, 0.175);
  assert.equal(r.iof, 0);
  assert.equal(r.ir, Math.round((gross - 10000) * 0.175 * 100) / 100);
  assert.equal(r.net, Math.round((gross - r.ir) * 100) / 100);
  assert.ok(r.netReturn < r.grossReturn);
  close(r.netReturn, (r.grossReturn) * (1 - 0.175), 1e-6);
});

test('valores inválidos: zero, negativo, prazo negativo, produto não suportado', () => {
  const base = { product: 'CDB', indexer: 'CDI', rate: 1, principal: 1000, startDate: '2026-01-01', endDate: '2026-06-01' };
  assert.throws(() => simulateApplication({ ...base, principal: 0 }, premises), /maior que zero/);
  assert.throws(() => simulateApplication({ ...base, principal: -5 }, premises), /maior que zero/);
  assert.throws(() => simulateApplication({ ...base, principal: NaN }, premises), /maior que zero/);
  assert.throws(() => simulateApplication({ ...base, endDate: '2025-12-01' }, premises), /prazo deve ser positivo/);
  assert.throws(() => simulateApplication({ ...base, endDate: '2026-02-30' }, premises), /vencimento inválida/);
  assert.throws(() => simulateApplication({ ...base, rate: -1 }, premises), /Taxa/);
  assert.throws(() => simulateApplication({ ...base, product: 'POUPANCA' }, premises), /Poupança/);
  assert.throws(() => simulateApplication(base, { ...premises, cdi: NaN }), /CDI/);
});

test('anualização: 252 du com retorno de 10% = 10% a.a.', () => {
  close(annualize(0.1, 252), 0.1, 1e-12);
  close(annualize(0.21, 504), 0.1, 1e-12);
  assert.equal(annualize(0.1, 0), null);
});
