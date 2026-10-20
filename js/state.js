// Estado da interface (valores como o usuário digita: percentuais em "%"), saneamento de dados
// vindos de localStorage/URL e conversão para o modelo de cálculo (decimais).

import { parseISO } from './calendar.js';
import { INDEXERS } from './financial-math.js';
import { PRODUCTS } from './tax-rules.js';
import { todayInBrazil } from './rates-api.js';

export const MAX_STAGES = 8;

export const defaultStage = () => ({
  product: 'CDB', indexer: 'CDI', rate: 100, termValue: 12, termUnit: 'months', taxMode: 'auto', cost: 0,
});

// CDI/Selic projetados começam vazios: são preenchidos com as taxas consultadas (ou digitados).
// Nunca usamos uma taxa inventada como padrão.
export const defaultState = () => ({
  name: 'CDB promocional',
  institution: '',
  amount: 50000,
  startDate: todayInBrazil(),
  liquidity: 'maturity',
  earlyRedemption: false,
  stages: [{ ...defaultStage(), rate: 107.3, termValue: 5 }],
  premises: { cdi: null, selic: null, ipca: null, horizonMonths: 24, refRate: 100, reinvestRate: 100, autoRates: true },
});

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, fallback, max = 120) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const oneOf = (v, options, fallback) => (options.includes(v) ? v : fallback);

function sanitizeStage(raw) {
  const d = defaultStage();
  if (!raw || typeof raw !== 'object') return d;
  return {
    product: oneOf(raw.product, Object.keys(PRODUCTS), d.product),
    indexer: oneOf(raw.indexer, Object.keys(INDEXERS), d.indexer),
    rate: num(raw.rate, d.rate),
    termValue: num(raw.termValue, d.termValue),
    termUnit: oneOf(raw.termUnit, ['days', 'months', 'years'], d.termUnit),
    taxMode: oneOf(raw.taxMode, ['auto', 'taxable', 'exempt'], d.taxMode),
    cost: num(raw.cost, 0),
  };
}

// Aceita qualquer coisa (JSON corrompido, versão antiga, URL adulterada) e devolve um estado válido.
export function sanitizeState(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const p = raw.premises && typeof raw.premises === 'object' ? raw.premises : {};
  const stages = Array.isArray(raw.stages) && raw.stages.length ? raw.stages.slice(0, MAX_STAGES).map(sanitizeStage) : d.stages;
  return {
    name: str(raw.name, d.name),
    institution: str(raw.institution, d.institution),
    amount: num(raw.amount, d.amount),
    startDate: typeof raw.startDate === 'string' && parseISO(raw.startDate) ? raw.startDate : d.startDate,
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
    stages: state.stages.map((s) => ({ ...s, rate: pct(s.rate) })),
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
