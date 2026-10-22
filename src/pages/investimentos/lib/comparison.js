// Cenários de comparação (sem DOM). Cada reinvestimento é uma NOVA aplicação: prazo de IR/IOF
// recomeça do zero e o principal é o valor líquido da aplicação anterior.

import { addMonths, addTerm, businessDaysBetween, isBusinessDay } from './calendar.js';
import { annualize, grossBalanceAt, round2, simulateApplication, validatePremises } from './financial-math.js';
import { PRODUCTS, minTermWarning } from './tax-rules.js';

// Limite de 50 anos por etapa: evita datas fora do intervalo do Date.
export const MAX_TERM = { days: 18262, months: 600, years: 50 };

export const referenceStage = (rate) => ({ product: 'CDB', indexer: 'CDI', rate, taxMode: 'auto', cost: 0 });

function stageWarnings(app) {
  const out = [];
  const w = minTermWarning(app.product, app.indexer, app.startDate, app.endDate);
  if (w) out.push(w);
  if (!isBusinessDay(app.endDate)) {
    out.push(`Vencimento em ${app.endDate} não é dia útil; na prática o crédito ocorre no próximo dia útil (não modelado).`);
  }
  return out;
}

export function summarize(apps, principal) {
  const last = apps[apps.length - 1];
  const sum = (key) => round2(apps.reduce((acc, a) => acc + a[key], 0));
  const businessDays = businessDaysBetween(apps[0].startDate, last.endDate);
  const netReturn = last.net / principal - 1;
  return {
    startDate: apps[0].startDate,
    endDate: last.endDate,
    principal,
    grossFinal: last.gross,
    netFinal: last.net,
    totalIncome: sum('income'),
    totalTaxes: sum('taxes'),
    totalCosts: sum('cost'),
    netIncome: round2(last.net - principal),
    netReturn,
    businessDays,
    annualizedNet: annualize(netReturn, businessDays),
  };
}

// Encadeia etapas a partir de startDate. Com horizonEnd, completa o período restante
// reinvestindo no CDB de referência (hipótese explícita, marcada com isFill).
export function runStrategy({ principal, startDate, stages, premises, liquidity, horizonEnd }) {
  const apps = [];
  const warnings = [];
  let cursor = startDate;
  let balance = principal;

  for (const [i, stage] of stages.entries()) {
    let endDate = addTerm(cursor, stage.termValue, stage.termUnit);
    let truncated = false;
    if (horizonEnd && endDate > horizonEnd) {
      if (i === 0 && liquidity === 'daily') {
        endDate = horizonEnd;
        truncated = true;
        warnings.push('O produto vence após o horizonte. Como a liquidez é diária, assumimos resgate no fim do horizonte sem penalidade além dos impostos — confirme com a instituição.');
      } else {
        return {
          valid: false,
          reason: i === 0
            ? 'O produto vence após o horizonte de comparação e não tem liquidez diária. Não é possível comparar sem presumir resgate antecipado (que pode ter deságio ou não ser permitido).'
            : `A etapa ${i + 1} termina após o horizonte de comparação. Ajuste os prazos das etapas ou o horizonte.`,
        };
      }
    }
    const app = simulateApplication({ ...stage, principal: balance, startDate: cursor, endDate }, premises);
    app.truncated = truncated;
    warnings.push(...stageWarnings(app).map((w) => `Etapa ${i + 1}: ${w}`));
    apps.push(app);
    balance = app.net;
    cursor = endDate;
    if (horizonEnd && cursor === horizonEnd) {
      if (i < stages.length - 1) {
        return { valid: false, reason: `A etapa ${i + 1} já completa o horizonte de comparação; as etapas seguintes ficariam de fora. Ajuste os prazos ou o horizonte.` };
      }
      break;
    }
  }

  if (horizonEnd && cursor < horizonEnd) {
    const fill = simulateApplication(
      { ...referenceStage(premises.reinvestRate), principal: balance, startDate: cursor, endDate: horizonEnd },
      premises,
    );
    fill.isFill = true;
    if (fill.calendarDays < 30) warnings.push('O reinvestimento final dura menos de 30 dias e sofre IOF regressivo.');
    apps.push(fill);
  }

  return { valid: true, apps, warnings, summary: summarize(apps, principal) };
}

// Percentual do CDI que um CDB tributável precisaria pagar, no mesmo período, para atingir targetNet.
export function breakevenCdiRate({ principal, startDate, endDate, targetNet, premises }) {
  const netAt = (rate) => simulateApplication({ ...referenceStage(rate), principal, startDate, endDate }, premises).net;
  let lo = 0;
  let hi = 10;
  if (netAt(hi) < targetNet) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (netAt(mid) < targetNet) lo = mid;
    else hi = mid;
  }
  return hi;
}

// Ponto de partida: model com valores em decimal (ver state.js#toModel).
export function compare(model) {
  const { principal, startDate, stages, premises, liquidity } = model;
  const errors = validatePremises(premises, ['CDI', ...(stages || []).map((s) => s.indexer)]);
  if (!stages?.length) errors.push('Cadastre ao menos uma etapa.');
  if (!Number.isInteger(premises.horizonMonths) || premises.horizonMonths < 1 || premises.horizonMonths > 600) errors.push('Horizonte de comparação deve ser um número inteiro de 1 a 600 meses.');
  if (!(premises.refRate >= 0) || !(premises.reinvestRate >= 0)) errors.push('Percentuais do CDI de referência/reinvestimento inválidos.');
  for (const [i, s] of (stages || []).entries()) {
    if (!PRODUCTS[s.product]?.supported) {
      errors.push(`Etapa ${i + 1} (${PRODUCTS[s.product]?.label ?? s.product}): ${PRODUCTS[s.product]?.reason ?? 'produto desconhecido.'}`);
    }
    if (!Number.isInteger(s.termValue) || s.termValue <= 0) errors.push(`Etapa ${i + 1}: prazo deve ser um inteiro positivo.`);
    else if (s.termValue > MAX_TERM[s.termUnit]) errors.push(`Etapa ${i + 1}: prazo máximo de 50 anos.`);
    if (!Number.isFinite(s.rate) || s.rate < 0) errors.push(`Etapa ${i + 1}: taxa deve ser um número não negativo.`);
  }
  if (errors.length) return { errors };

  try {
    return compareValid(model);
  } catch (e) {
    return { errors: [e.message] };
  }
}


function compareValid({ principal, startDate, stages, premises, liquidity }) {
  // Cenário A: investimento informado (1ª etapa), isolado.
  const endA = addTerm(startDate, stages[0].termValue, stages[0].termUnit);
  const A = simulateApplication({ ...stages[0], principal, startDate, endDate: endA }, premises);
  // Cenário B: CDB de referência no mesmo período.
  const B = simulateApplication({ ...referenceStage(premises.refRate), principal, startDate, endDate: A.endDate }, premises);
  const warnings = stageWarnings(A);

  // Cenário C: horizonte fixo.
  const horizonEnd = addMonths(startDate, premises.horizonMonths);
  const reference = runStrategy({
    principal, startDate, premises, liquidity: 'daily', horizonEnd,
    stages: [{ ...referenceStage(premises.refRate), termValue: premises.horizonMonths, termUnit: 'months' }],
  });
  const strategy = runStrategy({ principal, startDate, stages, premises, liquidity, horizonEnd });

  const C = { horizonEnd, reference, strategy, valid: strategy.valid };
  if (strategy.valid) {
    C.diff = round2(strategy.summary.netFinal - reference.summary.netFinal);
    C.diffPctOfPrincipal = C.diff / principal;
  }

  return {
    errors: [],
    warnings,
    A,
    B,
    diffAB: round2(A.net - B.net),
    breakevenRate: breakevenCdiRate({ principal, startDate, endDate: A.endDate, targetNet: A.net, premises }),
    C,
  };
}

// Pontos (data, saldo) para gráfico: saldo bruto mensal; em cada vencimento, o bruto e depois o líquido
// (queda = impostos), mostrando o momento do reinvestimento.
export function timeline(apps, premises) {
  const points = [];
  for (const app of apps) {
    for (let k = 0, d = app.startDate; d < app.endDate; d = addMonths(app.startDate, ++k)) {
      points.push({ date: d, value: grossBalanceAt(app, premises, d) });
    }
    points.push({ date: app.endDate, value: app.gross, event: 'gross' });
    points.push({ date: app.endDate, value: app.net, event: 'net' });
  }
  return points;
}
