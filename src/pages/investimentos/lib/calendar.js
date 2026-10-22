// Datas como strings ISO 'YYYY-MM-DD', manipuladas em UTC para evitar problemas de fuso/horário de verão.
// Dias úteis seguem o calendário nacional usado pelo mercado (ANBIMA/B3):
// sábados, domingos e feriados nacionais não são dias úteis.

const DAY_MS = 86_400_000;

export function parseISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejeita datas inexistentes como 2026-02-30.
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

export const toISO = (date) => date.toISOString().slice(0, 10);

export function addDays(iso, days) {
  return toISO(new Date(parseISO(iso).getTime() + days * DAY_MS));
}

// Soma meses mantendo o dia; se o dia não existir no mês de destino, usa o último dia do mês
// (ex.: 31/01 + 1 mês = 28/02 ou 29/02).
export function addMonths(iso, months) {
  const d = parseISO(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

export function addTerm(iso, value, unit) {
  if (unit === 'days') return addDays(iso, value);
  if (unit === 'months') return addMonths(iso, value);
  if (unit === 'years') return addMonths(iso, value * 12);
  throw new RangeError(`Unidade de prazo inválida: ${unit}`);
}

export function calendarDaysBetween(startIso, endIso) {
  return Math.round((parseISO(endIso) - parseISO(startIso)) / DAY_MS);
}

// Algoritmo de Meeus/Jones/Butcher para o domingo de Páscoa (calendário gregoriano).
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISO(new Date(Date.UTC(year, month - 1, day)));
}

const holidayCache = new Map();

// Feriados nacionais considerados no calendário de dias úteis do mercado financeiro.
// Dia da Consciência Negra (20/11) é feriado nacional desde 2024 (Lei 14.759/2023).
export function nationalHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const easter = easterSunday(year);
  const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];
  if (year >= 2024) fixed.push('11-20');
  const set = new Set([
    ...fixed.map((md) => `${year}-${md}`),
    addDays(easter, -48), // Carnaval (segunda)
    addDays(easter, -47), // Carnaval (terça)
    addDays(easter, -2), // Sexta-feira Santa
    addDays(easter, 60), // Corpus Christi
  ]);
  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(iso) {
  const date = parseISO(iso);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !nationalHolidays(date.getUTCFullYear()).has(iso);
}

// Dias úteis no intervalo [início, fim): conta a data inicial e exclui a final,
// convenção usada para acumular o CDI (cada dia útil aplica um fator diário).
export function businessDaysBetween(startIso, endIso) {
  let count = 0;
  for (let d = startIso; d < endIso; d = addDays(d, 1)) {
    if (isBusinessDay(d)) count += 1;
  }
  return count;
}
