import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeState, stageDates, toModel } from '../../src/pages/investimentos/lib/state.js';
import { businessDaysBetween } from '../../src/pages/investimentos/lib/calendar.js';
import { compare } from '../../src/pages/investimentos/lib/comparison.js';

const base = (stages) => sanitizeState({
  startDate: '2026-01-15', amount: 10000, stages,
  premises: { cdi: 13.65, selic: 13.75, ipca: 4.5, horizonMonths: 24, refRate: 100, reinvestRate: 100 },
});

test('data final mês/ano encadeia etapas no dia do início', () => {
  const s = base([{ indexer: 'CDI', rate: 100, endMonth: '2026-07' }, { indexer: 'CDI', rate: 100, endMonth: '2027-07' }]);
  assert.deepEqual(stageDates(s.startDate, s.stages).map((d) => d.end), ['2026-07-15', '2027-07-15']);
  assert.deepEqual(toModel(s).stages.map((x) => x.termValue), [6, 12]);
});

test('prefixado é taxa ao ano (base 252)', () => {
  const r = compare(toModel(base([{ product: 'CDB', indexer: 'PRE', rate: 13, endMonth: '2027-01' }])));
  assert.deepEqual(r.errors, []);
  const expected = 10000 * 1.13 ** (businessDaysBetween('2026-01-15', '2027-01-15') / 252);
  assert.ok(Math.abs(r.A.gross - expected) < 0.01, `bruto ${r.A.gross} vs ${expected}`);
});

test('data final não posterior ao início vira erro', () => {
  const r = compare(toModel(base([{ indexer: 'CDI', rate: 100, endMonth: '2026-01' }])));
  assert.match(r.errors[0], /Etapa 1: data final/);
});

test('estado antigo com prazo é convertido em data final', () => {
  const s = base([{ indexer: 'CDI', rate: 100, termValue: 5, termUnit: 'months' }, { indexer: 'CDI', rate: 100, termValue: 1, termUnit: 'years' }]);
  assert.deepEqual(s.stages.map((x) => x.endMonth), ['2026-06', '2027-06']);
});

test('data final em texto livre não quebra (navegador sem input month)', () => {
  const s = base([{ indexer: 'CDI', rate: 100, endMonth: '2026-07' }]);
  s.stages[0].endMonth = '07/2026'; // como vem do input, sem passar por sanitizeState
  assert.doesNotThrow(() => stageDates(s.startDate, [{ endMonth: '07/2026' }]));
  assert.equal(stageDates(s.startDate, [{ endMonth: '07/2026' }])[0].end, null);
  assert.ok(compare(toModel(s)).errors.length);
});

test('prefixado salvo no formato antigo mantém a taxa ao ano', () => {
  const s = base([{ product: 'CDB', indexer: 'PRE', rate: 13, termValue: 1, termUnit: 'years' }]);
  const r = compare(toModel(s));
  const expected = 10000 * 1.13 ** (businessDaysBetween('2026-01-15', '2027-01-15') / 252); // mesmo bruto do modelo antigo
  assert.ok(Math.abs(r.A.gross - expected) < 0.01, `bruto ${r.A.gross} vs ${expected}`);
});
