// Taxas públicas do Banco Central do Brasil — SGS (Sistema Gerenciador de Séries Temporais).
// API: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{código}/dados?formato=json&dataInicial=dd/mm/aaaa&dataFinal=dd/mm/aaaa
// Sem chave; responde com Access-Control-Allow-Origin: * (verificado em 2026-10-20).
//
// - 432: Selic meta definida pelo Copom (% a.a.). A série é publicada com datas FUTURAS (repete a meta
//   até a próxima reunião), por isso só consideramos datas ≤ hoje.
// - 1178: Selic efetiva/over anualizada base 252 (% a.a.). É a taxa que remunera títulos atrelados à Selic.
// - 4389: CDI anualizado base 252 (% a.a.), calculado a partir da taxa DI divulgada pela B3.
// CDI, Selic efetiva e Selic meta são indicadores diferentes e normalmente têm valores diferentes.

export const SOURCE = 'Banco Central do Brasil — SGS';
export const SERIES = {
  selicMeta: { code: 432, label: 'Selic meta (Copom)' },
  selicEfetiva: { code: 1178, label: 'Selic efetiva (over, base 252)' },
  cdi: { code: 4389, label: 'CDI (base 252)' },
};

// Referências com mais de 5 dias corridos (fim de semana + feriado) são tratadas como desatualizadas.
const STALE_AFTER_DAYS = 5;
const BASE_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.';

export const todayInBrazil = (now = new Date()) => now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const brToIso = (s) => (/^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.split('/').reverse().join('-') : null);
const isoToBr = (s) => s.split('-').reverse().join('/');

export async function fetchSeriesLatest(code, { fetchImpl = fetch, now = new Date(), timeoutMs = 15000 } = {}) {
  const today = todayInBrazil(now);
  const from = new Date(now.getTime() - 20 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const url = `${BASE_URL}${code}/dados?formato=json&dataInicial=${isoToBr(from)}&dataFinal=${isoToBr(today)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // A série 1178 responde com content-type text/html, então lemos texto e convertemos.
  const data = JSON.parse(await res.text());
  if (!Array.isArray(data)) throw new Error('Resposta inesperada da API');
  const points = data
    .map((p) => ({ date: brToIso(p?.data), value: typeof p?.valor === 'string' && p.valor.trim() ? Number(p.valor) : NaN }))
    .filter((p) => p.date && p.date <= today && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!points.length) throw new Error('Nenhum valor recente disponível');
  return points.at(-1);
}

export function isStaleDate(dateIso, now = new Date()) {
  const days = (Date.parse(todayInBrazil(now)) - Date.parse(dateIso)) / 86_400_000;
  return days > STALE_AFTER_DAYS;
}

// Busca todas as séries; falhas individuais não derrubam as demais.
// Quando uma série falha, usa o valor do cache marcado como fromCache (nunca como atual).
export async function fetchRates({ cache = null, ...opts } = {}) {
  const keys = Object.keys(SERIES);
  // Uma nova tentativa por série: a API do BCB tem timeouts intermitentes.
  const fetchOne = (code) => fetchSeriesLatest(code, opts).catch(() => fetchSeriesLatest(code, opts));
  const results = await Promise.allSettled(keys.map((k) => fetchOne(SERIES[k].code)));
  const fetchedAt = (opts.now ?? new Date()).toISOString();
  const rates = {};
  const errors = {};
  results.forEach((r, i) => {
    const key = keys[i];
    if (r.status === 'fulfilled') {
      rates[key] = { ...r.value, fetchedAt, source: SOURCE, fromCache: false };
    } else {
      errors[key] = r.reason?.name === 'TimeoutError' ? 'Tempo esgotado' : (r.reason?.message || 'Falha na consulta');
      const cached = cache?.[key];
      if (cached && Number.isFinite(cached.value) && cached.date) rates[key] = { ...cached, fromCache: true };
    }
  });
  for (const r of Object.values(rates)) r.stale = r.fromCache || isStaleDate(r.date, opts.now);
  return { rates, errors };
}
