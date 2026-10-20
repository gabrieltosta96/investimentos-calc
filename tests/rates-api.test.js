import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRates, fetchSeriesLatest } from '../js/rates-api.js';

const now = new Date('2026-10-20T15:00:00Z');
const okFetch = (byCode) => async (url) => {
  const code = Number(url.match(/sgs\.(\d+)/)[1]);
  return { ok: true, status: 200, text: async () => JSON.stringify(byCode[code]) };
};

test('ignora datas futuras da Selic meta e pega o último valor até hoje', async () => {
  const fetchImpl = okFetch({ 432: [
    { data: '19/10/2026', valor: '13.75' }, { data: '20/10/2026', valor: '13.75' }, { data: '05/11/2026', valor: '13.25' },
  ] });
  assert.deepEqual(await fetchSeriesLatest(432, { fetchImpl, now }), { date: '2026-10-20', value: 13.75 });
});

test('8. falha na consulta: usa cache marcado como desatualizado e informa o erro', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const cache = { cdi: { value: 13.65, date: '2026-10-16', source: 'BCB', fetchedAt: '2026-10-17T10:00:00Z' } };
  const { rates, errors } = await fetchRates({ fetchImpl, now, cache });
  assert.equal(errors.cdi, 'Failed to fetch');
  assert.equal(errors.selicMeta, 'Failed to fetch');
  assert.equal(rates.cdi.value, 13.65);
  assert.equal(rates.cdi.fromCache, true);
  assert.equal(rates.cdi.stale, true);
  assert.equal(rates.selicMeta, undefined); // sem cache: nenhum valor inventado
});

test('falha parcial, HTTP 500 e JSON inválido não derrubam as outras séries', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('sgs.432')) return { ok: false, status: 500, text: async () => '' };
    if (url.includes('sgs.1178')) return { ok: true, status: 200, text: async () => '<html>erro</html>' };
    return { ok: true, status: 200, text: async () => JSON.stringify([{ data: '19/10/2026', valor: '13.65' }]) };
  };
  const { rates, errors } = await fetchRates({ fetchImpl, now });
  assert.equal(errors.selicMeta, 'HTTP 500');
  assert.ok(errors.selicEfetiva);
  assert.deepEqual([rates.cdi.value, rates.cdi.stale, rates.cdi.fromCache], [13.65, false, false]);
});

test('valor antigo retornado pela API é marcado como desatualizado', async () => {
  const fetchImpl = okFetch({ 432: [{ data: '01/10/2026', valor: '13.75' }], 1178: [], 4389: [{ data: '19/10/2026', valor: '13.65' }] });
  const { rates, errors } = await fetchRates({ fetchImpl, now });
  assert.equal(rates.selicMeta.stale, true);
  assert.equal(rates.cdi.stale, false);
  assert.match(errors.selicEfetiva, /Nenhum valor/);
});

test('valor nulo ou vazio na API não vira taxa 0%', async () => {
  const fetchImpl = okFetch({ 4389: [{ data: '16/10/2026', valor: '13.65' }, { data: '19/10/2026', valor: null }, { data: '20/10/2026', valor: '' }] });
  assert.deepEqual(await fetchSeriesLatest(4389, { fetchImpl, now }), { date: '2026-10-16', value: 13.65 });
});
