// Estado da interface (valores como o usuário digita: percentuais em "%"), saneamento de dados
// vindos de localStorage/URL e conversão para o modelo de cálculo (decimais).

import { addMonths, addTerm, businessDaysBetween, parseISO } from './calendar.js';
import { INDEXERS } from './financial-math.js';
import { PRODUCTS } from './tax-rules.js';
import { todayInBrazil } from './rates-api.js';
import { MAX_TERM } from './comparison.js';

export const MAX_STAGES = 8;

// Cada etapa termina no mês/ano informado (endMonth 'YYYY-MM'), no mesmo dia do início da etapa.
// Prefixado: rate é a rentabilidade TOTAL no período (%), não ao ano.
export const monthOf = (iso) => iso.slice(0, 7);
export const isMonth = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

export const defaultStage = (endMonth = monthOf(addMonths(todayInBrazil(), 12))) => ({
  product: 'CDB', indexer: 'CDI', rate: 100, endMonth, cost: 0,
});

// Datas de cada etapa encadeadas a partir de startDate (mesma regra de runStrategy).
// months <= 0 = data final não é posterior ao início da etapa; daí em diante, sem datas.
export function stageDates(startDate, stages) {
  let cursor = parseISO(startDate) ? startDate : null;
  return stages.map((s) => {
    if (!cursor) return null;
    // Texto livre (navegador sem <input type="month">) pode não ser 'YYYY-MM': trata como inválido.
    const months = isMonth(s.endMonth) ? monthIndex(s.endMonth) - monthIndex(monthOf(cursor)) : NaN;
    if (!(months > 0 && months <= MAX_TERM.months)) {
      cursor = null;
      return { months, start: null, end: null };
    }
    const start = cursor;
    cursor = addMonths(start, months);
    return { months, start, end: cursor };
  });
}

// CDI/Selic projetados começam vazios: são preenchidos com as taxas consultadas (ou digitados).
// Nunca usamos uma taxa inventada como padrão.
export const defaultState = () => ({
  name: 'CDB promocional',
  institution: '',
  amount: 50000,
  startDate: todayInBrazil(),
  liquidity: 'maturity',
  earlyRedemption: false,
  stages: [{ ...defaultStage(monthOf(addMonths(todayInBrazil(), 5))), rate: 107.3 }],
  premises: { cdi: null, selic: null, ipca: null, horizonMonths: 24, refRate: 100, reinvestRate: 100, autoRates: true },
});

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, fallback, max = 120) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const oneOf = (v, options, fallback) => (options.includes(v) ? v : fallback);

// cursor: início da etapa, para converter estados antigos (termValue/termUnit) em endMonth.
function sanitizeStage(raw, cursor) {
  const d = defaultStage();
  if (!raw || typeof raw !== 'object') return d;
  const indexer = oneOf(raw.indexer, Object.keys(INDEXERS), d.indexer);
  let rate = num(raw.rate, d.rate);
  let endMonth = cursor ? monthOf(addMonths(cursor, 12)) : d.endMonth;
  if (isMonth(raw.endMonth)) endMonth = raw.endMonth;
  else if (cursor && Number.isInteger(raw.termValue) && raw.termValue > 0 && ['days', 'months', 'years'].includes(raw.termUnit)) {
    try {
      endMonth = monthOf(addTerm(cursor, raw.termValue, raw.termUnit));
      // Formato antigo: prefixado era % a.a.; converte para % total no novo período.
      const dates = stageDates(cursor, [{ endMonth }])[0];
      if (indexer === 'PRE' && dates?.end) rate = ((1 + rate / 100) ** (businessDaysBetween(dates.start, dates.end) / 252) - 1) * 100;
    } catch { /* prazo absurdo: usa padrão */ }
  }
  return {
    product: oneOf(raw.product, Object.keys(PRODUCTS), d.product),
    indexer,
    rate,
    endMonth,
    cost: num(raw.cost, 0),
  };
}

// Aceita qualquer coisa (JSON corrompido, versão antiga, URL adulterada) e devolve um estado válido.
export function sanitizeState(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const p = raw.premises && typeof raw.premises === 'object' ? raw.premises : {};
  const startDate = typeof raw.startDate === 'string' && parseISO(raw.startDate) ? raw.startDate : d.startDate;
  let cursor = startDate;
  const stages = Array.isArray(raw.stages) && raw.stages.length
    ? raw.stages.slice(0, MAX_STAGES).map((r) => {
      const s = sanitizeStage(r, cursor);
      cursor = stageDates(cursor, [s])[0]?.end ?? null;
      return s;
    })
    : d.stages;
  return {
    name: str(raw.name, d.name),
    institution: str(raw.institution, d.institution),
    amount: num(raw.amount, d.amount),
    startDate,
    liquidity: oneOf(raw.liquidity, ['daily', 'maturity', 'other'], d.liquidity),
    earlyRedemption: Boolean(raw.earlyRedemption),
    stages,
    premises: {
      cdi: numOrNull(p.cdi),
      selic: numOrNull(p.selic),
      ipca: numOrNull(p.ipca),
      horizonMonths: num(p.horizonMonths, d.premises.horizonMonths),
      refRate: num(p.refRate, d.premises.refRate),
      reinvestRate: num(p.reinvestRate, d.premises.reinvestRate),
      autoRates: p.autoRates !== false,
    },
  };
}

const pct = (v) => (v == null ? NaN : v / 100);

export function toModel(state) {
  return {
    principal: state.amount,
    startDate: state.startDate,
    liquidity: state.liquidity,
    stages: stageDates(state.startDate, state.stages).map((dates, i) => {
      const { endMonth, ...s } = state.stages[i];
      const months = dates?.months ?? 0;
      let rate = pct(s.rate);
      // Prefixado total no período → taxa ao ano equivalente (base 252), que é o que o cálculo usa.
      if (s.indexer === 'PRE' && dates?.end) rate = (1 + rate) ** (252 / businessDaysBetween(dates.start, dates.end)) - 1;
      return { ...s, rate, termValue: months, termUnit: 'months' };
    }),
    premises: {
      cdi: pct(state.premises.cdi),
      selic: pct(state.premises.selic),
      ipca: pct(state.premises.ipca),
      horizonMonths: state.premises.horizonMonths,
      refRate: pct(state.premises.refRate),
      reinvestRate: pct(state.premises.reinvestRate),
    },
  };
}
