// Camada de interface: lê o formulário, chama os módulos de cálculo e desenha os resultados.

import { addTerm, businessDaysBetween, calendarDaysBetween, parseISO } from './calendar.js';
import { renderLineChart } from './charts.js';
import { MAX_TERM, compare, timeline } from './comparison.js';
import { INDEXERS, annualize } from './financial-math.js';
import { brl, date as fmtDate, dateTime, number, pct, signedBrl, signedPct } from './formatters.js';
import { SERIES, SOURCE, fetchRates } from './rates-api.js';
import { MAX_STAGES, defaultStage, defaultState, toModel } from './state.js';
import * as storage from './storage.js';
import { IR_BRACKETS, PRODUCTS, TAX_RULES_VERIFIED_AT } from './tax-rules.js';

const COLORS = { strategy: '#0b8f6f', reference: '#c2570c' }; // validados para daltonismo (dataviz)
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let state = loadInitialState();
let rates = { rates: cachedRates(), errors: {}, loading: false };
let result = null;
let currentSim = null; // { id, name } da simulação carregada

function loadInitialState() {
  const hash = new URLSearchParams(location.hash.slice(1)).get('s');
  if (hash) {
    const shared = storage.decodeShare(hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (shared) return shared;
  }
  return storage.loadCurrent() ?? defaultState();
}

function cachedRates() {
  const cache = storage.loadRatesCache();
  const out = {};
  for (const key of Object.keys(SERIES)) {
    const c = cache[key];
    if (c && Number.isFinite(c.value) && parseISO(c.date)) out[key] = { ...c, fromCache: true, stale: true };
  }
  return out;
}

// ---------- caminho "a.b.0.c" no estado ----------
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}
function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return el.value === '' || Number.isNaN(el.valueAsNumber) ? null : el.valueAsNumber;
  return el.value;
}
function writeInput(el, value) {
  if (el.type === 'checkbox') el.checked = Boolean(value);
  else el.value = value ?? '';
}

// ---------- texto auxiliar ----------
function rateLabel(indexer) {
  return { CDI: 'Percentual do CDI (%)', SELIC: 'Percentual da Selic (%)', PRE: 'Taxa prefixada (% a.a.)', IPCA: 'Taxa acima do IPCA (% a.a.)' }[indexer];
}
function rateText(indexer, rate) {
  if (!Number.isFinite(rate)) return '—';
  if (indexer === 'CDI') return `${number(rate * 100, 1)}% do CDI`;
  if (indexer === 'SELIC') return `${number(rate * 100, 1)}% da Selic`;
  if (indexer === 'PRE') return `${pct(rate)} a.a. (pré)`;
  return `IPCA + ${pct(rate)} a.a.`;
}
const termText = (s) => `${s.termValue} ${{ days: 'dia(s)', months: 'mês(es)', years: 'ano(s)' }[s.termUnit]}`;

// ---------- taxas ----------
function renderRates() {
  const grid = $('#rates-grid');
  grid.innerHTML = Object.entries(SERIES).map(([key, meta]) => {
    const r = rates.rates[key];
    const err = rates.errors[key];
    let badge = '<span class="badge badge-muted">Indisponível</span>';
    if (rates.loading && !r) badge = '<span class="badge badge-muted">Carregando…</span>';
    else if (r?.fromCache) badge = '<span class="badge badge-warn">Último valor salvo</span>';
    else if (r?.stale) badge = '<span class="badge badge-warn">Desatualizado</span>';
    else if (r) badge = '<span class="badge badge-ok">Atualizado</span>';
    return `
      <div class="rate">
        <div class="rate-label">${esc(meta.label)} ${badge}</div>
        <div class="rate-value">${r ? `${number(r.value, 2)}<small>% a.a.</small>` : '—'}</div>
        <div class="muted small">${r ? `Referência: ${esc(fmtDate(r.date))} · Consulta: ${esc(dateTime(r.fetchedAt))}` : 'Sem valor válido'}</div>
        <div class="muted small">Fonte: ${esc(r?.source ?? SOURCE)} (série ${meta.code})${err ? ` · Erro: ${esc(err)}` : ''}</div>
      </div>`;
  }).join('');
  const ok = Object.values(rates.rates).filter((r) => !r.fromCache).length;
  $('#rates-status').textContent = rates.loading
    ? 'Consultando o Banco Central…'
    : Object.keys(rates.errors).length
      ? `Consulta com falhas (${ok} de ${Object.keys(SERIES).length} séries atualizadas). Valores salvos anteriormente aparecem marcados; você pode digitar as projeções manualmente.`
      : `Selic meta, Selic efetiva e CDI são indicadores diferentes. O CDI projeta CDBs/LCIs/LCAs pós-fixados; a Selic efetiva, os atrelados à Selic.`;
  $('#btn-refresh-rates').disabled = rates.loading;
}

async function refreshRates() {
  rates = { ...rates, loading: true };
  renderRates();
  const fresh = await fetchRates({ cache: storage.loadRatesCache() });
  rates = { ...fresh, loading: false };
  const toCache = { ...storage.loadRatesCache() };
  for (const [k, r] of Object.entries(fresh.rates)) if (!r.fromCache) toCache[k] = { value: r.value, date: r.date, source: r.source, fetchedAt: r.fetchedAt };
  storage.saveRatesCache(toCache);
  renderRates();
  applyRatesToPremises();
  update();
}

function applyRatesToPremises() {
  if (!state.premises.autoRates) return;
  if (rates.rates.cdi) state.premises.cdi = rates.rates.cdi.value;
  if (rates.rates.selicEfetiva) state.premises.selic = rates.rates.selicEfetiva.value;
  fillStaticForm();
}

// ---------- formulário ----------
function fillStaticForm() {
  for (const el of document.querySelectorAll('#form > section [data-path]:not([data-stage])')) {
    writeInput(el, getPath(state, el.dataset.path));
  }
}

function stageHtml(s, i) {
  const p = PRODUCTS[s.product];
  const opt = (obj, cur, labelOf) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(labelOf(v))}</option>`).join('');
  const sel = (path) => `data-stage data-path="stages.${i}.${path}"`;
  return `
    <fieldset class="stage">
      <legend>Etapa ${i + 1} — ${i === 0 ? 'investimento analisado' : 'reinvestimento'}</legend>
      ${i > 0 ? `<button type="button" class="btn btn-small btn-ghost stage-remove" data-remove="${i}" aria-label="Remover etapa ${i + 1}">Remover</button>` : ''}
      <div class="grid-2">
        <label class="field">Tipo de investimento
          <select ${sel('product')}>${opt(PRODUCTS, s.product, (v) => v.label)}</select>
        </label>
        <label class="field">Remuneração
          <select ${sel('indexer')}>${opt(INDEXERS, s.indexer, (v) => v.label)}</select>
        </label>
        <label class="field">${rateLabel(s.indexer)}
          <input type="number" ${sel('rate')} value="${s.rate ?? ''}" min="0" step="0.01" inputmode="decimal">
        </label>
        <div class="field">Prazo
          <div class="inline">
            <input type="number" ${sel('termValue')} value="${s.termValue ?? ''}" min="1" step="1" inputmode="numeric" aria-label="Prazo da etapa ${i + 1}">
            <select ${sel('termUnit')} aria-label="Unidade do prazo da etapa ${i + 1}">
              ${[['days', 'dias'], ['months', 'meses'], ['years', 'anos']].map(([v, l]) => `<option value="${v}" ${v === s.termUnit ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <label class="field">Tributação (IR)
          <select ${sel('taxMode')}>
            <option value="auto" ${s.taxMode === 'auto' ? 'selected' : ''}>Regra do produto (pessoa física)</option>
            <option value="taxable" ${s.taxMode === 'taxable' ? 'selected' : ''}>Tabela regressiva</option>
            <option value="exempt" ${s.taxMode === 'exempt' ? 'selected' : ''}>Isento (confirme o enquadramento)</option>
          </select>
        </label>
        <label class="field">Custos conhecidos (R$)
          <input type="number" ${sel('cost')} value="${s.cost ?? 0}" min="0" step="0.01" inputmode="decimal">
        </label>
      </div>
      <p class="small maturity" data-maturity="${i}"></p>
      ${p.supported ? '' : `<p class="alert alert-warn small">${esc(p.label)} ainda não é simulado: ${esc(p.reason)}</p>`}
    </fieldset>`;
}

function renderStages() {
  const focusedPath = document.activeElement?.dataset?.path;
  $('#stages').innerHTML = state.stages.map(stageHtml).join('');
  $('#btn-add-stage').disabled = state.stages.length >= MAX_STAGES;
  if (focusedPath) document.querySelector(`[data-path="${focusedPath}"]`)?.focus();
}

function renderMaturities() {
  let cursor = state.startDate;
  state.stages.forEach((s, i) => {
    const out = document.querySelector(`[data-maturity="${i}"]`);
    if (!out) return;
    if (!cursor || !parseISO(cursor) || !(Number.isInteger(s.termValue) && s.termValue > 0 && s.termValue <= MAX_TERM[s.termUnit])) {
      out.textContent = 'Vencimento: informe data e prazo válidos.';
      cursor = null;
      return;
    }
    const end = addTerm(cursor, s.termValue, s.termUnit);
    out.innerHTML = `Período: <strong>${fmtDate(cursor)} → ${fmtDate(end)}</strong> · ${calendarDaysBetween(cursor, end)} dias corridos · ${businessDaysBetween(cursor, end)} dias úteis`;
    cursor = end;
  });
  const p = state.premises;
  $('#fill-note').textContent = `Se a última etapa vencer antes de ${p.horizonMonths ?? '—'} meses, o saldo líquido é reinvestido (hipótese) em CDB a ${number(p.reinvestRate, 1)}% do CDI até completar o horizonte.`;
}

function renderPremisesNote() {
  const note = $('#premises-note');
  const r = rates.rates.cdi;
  if (!Number.isFinite(state.premises.cdi)) {
    note.className = 'small alert alert-warn';
    note.textContent = 'CDI projetado não informado: a taxa atual não pôde ser obtida. Digite o valor que deseja usar como hipótese.';
  } else if (state.premises.autoRates && r) {
    note.className = r.stale ? 'small alert alert-warn' : 'small muted';
    note.textContent = `CDI projetado = CDI de ${fmtDate(r.date)} (${number(r.value, 2)}% a.a.)${r.stale ? ' — valor DESATUALIZADO, confira antes de decidir.' : '.'} Selic projetada = Selic efetiva.`;
  } else {
    note.className = 'small muted';
    note.textContent = 'Projeções definidas manualmente.';
  }
}

// ---------- resultados ----------
const ref = () => `CDB a ${number(state.premises.refRate, 1)}% do CDI`;
const productLabel = (a) => (a.isFill ? `CDB (reinvest.)` : PRODUCTS[a.product].label);
const taxLine = (a) => (a.exempt ? 'Isento' : `${pct(a.irRate, 1)}`);

function kpi(label, value, sub = '', tone = '') {
  return `<div class="kpi ${tone}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}
const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

function verdictText(r) {
  const name = state.name || 'o investimento informado';
  const { A, diffAB, C } = r;
  const lines = [];
  lines.push(diffAB === 0
    ? `${name} rende o mesmo, líquido, que um ${ref()} no mesmo período (${fmtDate(A.startDate)} a ${fmtDate(A.endDate)}).`
    : `Investir em ${name} rende ${brl(Math.abs(diffAB))} líquidos a ${diffAB > 0 ? 'mais' : 'menos'} do que deixar o dinheiro em um ${ref()} durante o mesmo período (${A.calendarDays} dias).`);
  if (r.breakevenRate != null) lines.push(`Equivale a um CDB tributável de ${number(r.breakevenRate * 100, 2)}% do CDI no mesmo prazo.`);
  if (C.valid) {
    const h = state.premises.horizonMonths;
    lines.push(`Após ${h} meses, a estratégia com o investimento informado${C.strategy.apps.length > 1 ? ' e reinvestimentos' : ''} resulta em ${brl(C.strategy.summary.netFinal)} líquidos, contra ${brl(C.reference.summary.netFinal)} na estratégia de referência. Diferença estimada: ${signedBrl(C.diff)}.`);
  } else {
    lines.push(`Comparação em ${state.premises.horizonMonths} meses indisponível: ${C.strategy.reason}`);
  }
  return lines;
}

function scenarioTable(cols) {
  // cols: [{ title, a }] onde a é aplicação simulada
  const rows = [
    ['Valor aplicado', (a) => brl(a.principal)],
    ['Período', (a) => `${fmtDate(a.startDate)} → ${fmtDate(a.endDate)}<br><span class="muted small">${a.calendarDays} dc · ${a.businessDays} du</span>`],
    ['Remuneração', (a) => rateText(a.indexer, a.rate)],
    ['Valor bruto final', (a) => brl(a.gross)],
    ['Rendimento bruto', (a) => brl(a.income)],
    ['IOF', (a) => `${brl(a.iof)}${a.iofRate ? ` <span class="muted small">(${pct(a.iofRate, 0)} do rend.)</span>` : ''}`],
    ['Imposto de Renda', (a) => `${brl(a.ir)} <span class="muted small">(${taxLine(a)})</span>`],
    ['Outros custos', (a) => brl(a.cost)],
    ['Valor líquido final', (a) => `<strong>${brl(a.net)}</strong>`],
    ['Rendimento líquido', (a) => brl(a.netIncome)],
    ['Rentabilidade bruta no período', (a) => pct(a.grossReturn)],
    ['Rentabilidade líquida no período', (a) => pct(a.netReturn)],
    ['Rentabilidade líquida anualizada', (a) => pct(annualize(a.netReturn, a.businessDays))],
  ];
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th scope="col">Indicador</th>${cols.map((c) => `<th scope="col">${c.title}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, f]) => `<tr><th scope="row">${label}</th>${cols.map((c) => `<td>${f(c.a)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function strategyTable(C) {
  const s = C.strategy.summary;
  const r = C.reference.summary;
  const rows = [
    ['Patrimônio bruto final', brl(s.grossFinal), brl(r.grossFinal)],
    ['Patrimônio líquido final', `<strong>${brl(s.netFinal)}</strong>`, `<strong>${brl(r.netFinal)}</strong>`],
    ['Rendimentos brutos (soma das aplicações)', brl(s.totalIncome), brl(r.totalIncome)],
    ['Impostos pagos (IR + IOF)', brl(s.totalTaxes), brl(r.totalTaxes)],
    ['Custos', brl(s.totalCosts), brl(r.totalCosts)],
    ['Retorno líquido acumulado', pct(s.netReturn), pct(r.netReturn)],
    ['Rentabilidade líquida anualizada', pct(s.annualizedNet), pct(r.annualizedNet)],
  ];
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th scope="col">Indicador</th><th scope="col">Investimento + reinvestimentos</th><th scope="col">${ref()} por ${state.premises.horizonMonths} meses</th></tr></thead>
    <tbody>${rows.map(([l, a, b]) => `<tr><th scope="row">${l}</th><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Diferença líquida</th><td colspan="2" class="${tone(C.diff)}"><strong>${signedBrl(C.diff)}</strong> (${signedPct(C.diffPctOfPrincipal)} do capital inicial)</td></tr></tfoot>
  </table></div>`;
}

function stagesTable(groups) {
  const body = groups.map(({ title, apps }) => `
    <tr class="group"><th colspan="8" scope="colgroup">${title}</th></tr>
    ${apps.map((a, i) => `<tr>
      <td>${i + 1}${a.isFill ? '<span class="tag">hipótese</span>' : ''}${a.truncated ? '<span class="tag">resgate no horizonte</span>' : ''}</td>
      <td>${fmtDate(a.startDate)} → ${fmtDate(a.endDate)}<br><span class="muted small">${a.calendarDays} dias</span></td>
      <td>${productLabel(a)}</td>
      <td>${rateText(a.indexer, a.rate)}</td>
      <td>${brl(a.principal)}</td>
      <td>${brl(a.income)}</td>
      <td>${brl(a.taxes + a.cost)}<br><span class="muted small">IR ${taxLine(a)}${a.iof ? ` · IOF ${brl(a.iof)}` : ''}</span></td>
      <td><strong>${brl(a.net)}</strong></td>
    </tr>`).join('')}`).join('');
  return `<div class="table-wrap"><table class="data compact">
    <thead><tr><th scope="col">Etapa</th><th scope="col">Período</th><th scope="col">Produto</th><th scope="col">Taxa</th><th scope="col">Saldo inicial</th><th scope="col">Rendimento bruto</th><th scope="col">Impostos e custos</th><th scope="col">Saldo líquido</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function howItWorks(r) {
  const p = toModel(state).premises;
  const apps = [r.A, ...(r.C.valid ? r.C.strategy.apps : [])];
  return `
    <details class="card how">
      <summary><h2>Como o cálculo foi feito</h2></summary>
      <h3>Premissas usadas</h3>
      <ul>
        <li>CDI projetado: ${pct(p.cdi)} a.a. · Selic projetada: ${Number.isFinite(p.selic) ? `${pct(p.selic)} a.a.` : 'não informada'} · IPCA projetado: ${Number.isFinite(p.ipca) ? `${pct(p.ipca)} a.a.` : 'não informado'}.</li>
        <li>Taxas constantes durante todo o período (hipótese, não previsão). Data inicial: ${fmtDate(state.startDate)}. Horizonte: ${state.premises.horizonMonths} meses (até ${fmtDate(r.C.horizonEnd)}).</li>
        <li>Referência: ${ref()}, tributado pela tabela regressiva. Reinvestimentos futuros: CDB a ${number(state.premises.reinvestRate, 1)}% do CDI.</li>
      </ul>
      <h3>Fórmulas</h3>
      <ul>
        <li>Taxa diária do CDI: <code>TD = (1 + CDI)^(1/252) − 1</code>, arredondada na 8ª casa (convenção B3). Com o CDI projetado: TD = ${number(((1 + p.cdi) ** (1 / 252) - 1) * 100, 6)}% ao dia útil.</li>
        <li>Pós-fixado: <code>bruto = aplicado × (1 + TD × %indexador)^du</code>, onde <code>du</code> = dias úteis (calendário nacional de feriados) entre aplicação e resgate.</li>
        <li>Prefixado: <code>bruto = aplicado × (1 + taxa)^(du/252)</code>. IPCA+ (simplificado): <code>bruto = aplicado × [(1 + IPCA) × (1 + taxa)]^(du/252)</code>.</li>
        <li>IOF (resgate em menos de 30 dias corridos): <code>IOF = rendimento × alíquota_regressiva(dias)</code>.</li>
        <li>IR: <code>IR = (rendimento − IOF) × alíquota</code>, alíquota pelos dias corridos de <em>cada</em> aplicação: ${IR_BRACKETS.map((b) => `${b.maxDays === Infinity ? 'acima de 720' : `até ${b.maxDays}`} dias: ${pct(b.rate, 1)}`).join('; ')}.</li>
        <li>Líquido = bruto − IOF − IR − custos. Bruto, IOF e IR são arredondados em centavos no resgate; o líquido é reinvestido integralmente na etapa seguinte, que inicia nova contagem de prazo.</li>
        <li>Anualização: <code>(1 + retorno)^(252/du) − 1</code>. Retornos são compostos, nunca somados.</li>
        <li>Percentual do CDI equivalente: busca numérica (bisseção) do percentual que faz um CDB tributável, no mesmo período, chegar ao mesmo valor líquido.</li>
      </ul>
      <h3>Detalhamento tributário</h3>
      <div class="table-wrap"><table class="data compact">
        <thead><tr><th scope="col">Aplicação</th><th scope="col">Dias corridos</th><th scope="col">Dias úteis</th><th scope="col">Rendimento</th><th scope="col">IOF</th><th scope="col">Base do IR</th><th scope="col">Alíquota IR</th><th scope="col">IR</th></tr></thead>
        <tbody>${apps.map((a, i) => `<tr><td>${i === 0 ? 'Cenário A' : `Estratégia · etapa ${i}`}</td><td>${a.calendarDays}</td><td>${a.businessDays}</td><td>${brl(a.income)}</td><td>${brl(a.iof)}</td><td>${brl(a.income - a.iof)}</td><td>${taxLine(a)}</td><td>${brl(a.ir)}</td></tr>`).join('')}</tbody>
      </table></div>
      <h3>Limitações</h3>
      <ul>
        <li>Não há previsão de juros: a taxa é mantida constante. Mudanças na Selic/CDI alteram os resultados.</li>
        <li>Vencimentos em dia não útil não são ajustados para o próximo dia útil.</li>
        <li>IPCA+ usa IPCA anual constante, sem defasagem nem VNA mensal.</li>
        <li>Isenção de LCI/LCA considera pessoa física e as regras vigentes em ${fmtDate(TAX_RULES_VERIFIED_AT)}. Não é aconselhamento tributário.</li>
        <li>FGC não é garantia de rentabilidade nem cobre todos os riscos; confira limites e condições em fgc.org.br.</li>
      </ul>
    </details>`;
}

function warningsFor(r) {
  const list = [...r.warnings, ...(r.C.valid ? r.C.strategy.warnings.filter((w) => !r.warnings.some((x) => w.endsWith(x))) : [])];
  if (state.liquidity === 'other') list.push('Liquidez “outra condição” não é modelada: a simulação assume resgate no vencimento de cada etapa.');
  if (state.earlyRedemption) list.push('Resgate antecipado pode ter rentabilidade menor que a contratada; não é simulado.');
  return list;
}

function renderResults() {
  const out = $('#results');
  const errBox = $('#errors');
  if (result.errors.length) {
    errBox.hidden = false;
    errBox.innerHTML = `<strong>Não foi possível calcular:</strong><ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
    out.innerHTML = '';
    return;
  }
  errBox.hidden = true;
  const { A, B, C } = result;
  const warnings = warningsFor(result);
  const h = state.premises.horizonMonths;

  out.innerHTML = `
    <section class="card verdict ${tone(result.diffAB)}" aria-labelledby="verdict-title">
      <h2 id="verdict-title">${esc(state.name || 'Investimento')}${state.institution ? ` <span class="muted">· ${esc(state.institution)}</span>` : ''}</h2>
      ${verdictText(result).map((l) => `<p>${esc(l)}</p>`).join('')}
    </section>

    <div class="kpis">
      ${kpi('Patrimônio líquido final', brl(A.net), `em ${fmtDate(A.endDate)}`)}
      ${kpi('Rendimento líquido', brl(A.netIncome), `bruto ${brl(A.income)}`)}
      ${kpi('Impostos pagos', brl(A.taxes), A.exempt ? 'isento de IR' : `IR ${pct(A.irRate, 1)}${A.iof ? ' + IOF' : ''}`)}
      ${kpi('Rentabilidade líquida', pct(A.netReturn), `${pct(annualize(A.netReturn, A.businessDays))} a.a.`)}
      ${kpi(`Diferença vs ${number(state.premises.refRate, 0)}% do CDI`, signedBrl(result.diffAB), 'mesmo período', tone(result.diffAB))}
      ${kpi(`Resultado em ${h} meses`, C.valid ? signedBrl(C.diff) : 'n/d', C.valid ? `líquido final ${brl(C.strategy.summary.netFinal)}` : 'comparação inválida', C.valid ? tone(C.diff) : '')}
    </div>

    ${warnings.length ? `<div class="alert alert-warn" role="note"><strong>Atenção</strong><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

    <section class="card" aria-labelledby="ab-title">
      <h2 id="ab-title">Cenários A e B — mesmo prazo</h2>
      ${scenarioTable([{ title: 'A · Investimento informado', a: A }, { title: `B · ${ref()}`, a: B }])}
      <p class="small">Diferença líquida A − B: <strong class="${tone(result.diffAB)}">${signedBrl(result.diffAB)}</strong></p>
    </section>

    <section class="card" aria-labelledby="c-title">
      <h2 id="c-title">Cenário C — horizonte de ${h} meses</h2>
      ${C.valid ? `
        ${strategyTable(C)}
        <h3>Evolução estimada do patrimônio</h3>
        <ul class="legend">
          <li><span class="swatch" style="background:${COLORS.strategy}"></span>Investimento + reinvestimentos</li>
          <li><span class="swatch dashed" style="border-color:${COLORS.reference}"></span>${ref()}</li>
          <li><span class="dot"></span>Vencimento / reinvestimento (degrau = impostos)</li>
        </ul>
        <div id="chart" class="chart"></div>
        <h3>Detalhamento por etapa</h3>
        ${stagesTable([{ title: 'Estratégia com o investimento informado', apps: C.strategy.apps }, { title: 'Estratégia de referência', apps: C.reference.apps }])}
      ` : `<p class="alert alert-warn">${esc(C.strategy.reason)}</p>`}
    </section>

    ${howItWorks(result)}`;
  if (C.valid) drawChart();
}

function drawChart() {
  const el = $('#chart');
  if (!el || !result?.C?.valid) return;
  const prem = toModel(state).premises;
  renderLineChart(el, [
    { name: 'Investimento + reinvest.', color: COLORS.strategy, points: timeline(result.C.strategy.apps, prem) },
    { name: ref(), color: COLORS.reference, dashed: true, points: timeline(result.C.reference.apps, prem) },
  ]);
}

function update() {
  storage.saveCurrent(state);
  result = compare(toModel(state));
  renderMaturities();
  renderPremisesNote();
  renderResults();
}

// ---------- exportação / resumo ----------
function summaryText() {
  if (!result || result.errors.length) return 'Simulação com erros: ' + (result?.errors ?? []).join(' ');
  const p = state.premises;
  return [
    `${state.name}${state.institution ? ` (${state.institution})` : ''}`,
    `Aplicação: ${brl(state.amount)} em ${fmtDate(state.startDate)}`,
    ...state.stages.map((s, i) => `Etapa ${i + 1}: ${PRODUCTS[s.product].label} ${rateText(s.indexer, s.rate / 100)} por ${termText(s)}`),
    `Premissas: CDI ${number(p.cdi, 2)}% a.a.${Number.isFinite(p.selic) ? `, Selic ${number(p.selic, 2)}% a.a.` : ''}, constantes (projeção, não garantia).`,
    '',
    `A) Investimento: líquido ${brl(result.A.net)} (bruto ${brl(result.A.gross)}, impostos ${brl(result.A.taxes)})`,
    `B) ${ref()}: líquido ${brl(result.B.net)}`,
    `Diferença A − B: ${signedBrl(result.diffAB)}`,
    '',
    ...verdictText(result),
  ].join('\n');
}

function csv() {
  const n = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '');
  const cell = (v) => `"${String(v).replaceAll('"', '""')}"`;
  const rows = [['Estratégia', 'Etapa', 'Início', 'Vencimento', 'Dias corridos', 'Dias úteis', 'Produto', 'Taxa', 'Saldo inicial', 'Bruto final', 'Rendimento bruto', 'IOF', 'IR', 'Custos', 'Líquido final']];
  const add = (label, apps) => apps.forEach((a, i) => rows.push([label, i + 1, a.startDate, a.endDate, a.calendarDays, a.businessDays, productLabel(a), rateText(a.indexer, a.rate), n(a.principal), n(a.gross), n(a.income), n(a.iof), n(a.ir), n(a.cost), n(a.net)]));
  add('A - Investimento informado', [result.A]);
  add(`B - ${ref()}`, [result.B]);
  if (result.C.valid) {
    add(`C - Investimento + reinvestimentos (${state.premises.horizonMonths}m)`, result.C.strategy.apps);
    add(`C - Referência (${state.premises.horizonMonths}m)`, result.C.reference.apps);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    toast('Não foi possível copiar automaticamente.');
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

// ---------- simulações salvas ----------
function renderSimsList() {
  const list = storage.listSimulations();
  $('#sims-list').innerHTML = list.length
    ? list.map((s) => `
      <li>
        <div><strong>${esc(s.name)}</strong><br><span class="muted small">${dateTime(s.savedAt)}</span></div>
        <div class="sims-actions">
          <button type="button" class="btn btn-small" data-sim="load" data-id="${esc(s.id)}">Carregar</button>
          <button type="button" class="btn btn-small" data-sim="dup" data-id="${esc(s.id)}">Duplicar</button>
          <button type="button" class="btn btn-small btn-ghost" data-sim="del" data-id="${esc(s.id)}">Excluir</button>
        </div>
      </li>`).join('')
    : '<li class="muted">Nenhuma simulação salva.</li>';
}

function loadState(next) {
  state = next;
  applyRatesToPremises();
  fillStaticForm();
  renderStages();
  update();
}

// ---------- eventos ----------
function onFieldChange(e) {
  const el = e.target;
  const path = el.dataset?.path;
  if (!path) return;
  let value = readInput(el);
  if (path === 'name' || path === 'institution') value = String(value).slice(0, 120);
  setPath(state, path, value);
  if (path === 'premises.cdi' || path === 'premises.selic') {
    state.premises.autoRates = false;
    writeInput(document.querySelector('[data-path="premises.autoRates"]'), false);
  }
  if (path === 'premises.autoRates' && value) applyRatesToPremises();
  if (e.type === 'change' && /\.(product|indexer)$/.test(path)) renderStages();
  update();
}

function bind() {
  const form = $('#form');
  form.addEventListener('input', onFieldChange);
  form.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') onFieldChange(e); });
  form.addEventListener('submit', (e) => e.preventDefault());

  $('#stages').addEventListener('click', (e) => {
    const i = e.target.dataset?.remove;
    if (i == null) return;
    state.stages.splice(Number(i), 1);
    renderStages();
    update();
  });
  $('#btn-add-stage').addEventListener('click', () => {
    if (state.stages.length >= MAX_STAGES) return;
    state.stages.push(defaultStage());
    renderStages();
    update();
  });

  $('#btn-refresh-rates').addEventListener('click', refreshRates);
  $('#btn-copy').addEventListener('click', () => copy(summaryText(), 'Resumo copiado.'));
  $('#btn-csv').addEventListener('click', () => {
    if (!result || result.errors.length) return toast('Corrija os erros antes de exportar.');
    download(`simulacao-${state.startDate}.csv`, csv(), 'text/csv;charset=utf-8');
  });
  $('#btn-share').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}#s=${storage.encodeShare(state)}`;
    copy(url, 'Link copiado. Os dados vão no próprio link, sem passar por servidores.');
  });
  $('#btn-reset').addEventListener('click', () => {
    if (confirm('Restaurar os valores padrão? A simulação atual não salva será perdida.')) {
      currentSim = null;
      loadState(defaultState());
    }
  });

  const dlgSave = $('#dlg-save');
  $('#btn-save').addEventListener('click', () => {
    $('#save-name').value = currentSim?.name ?? state.name;
    dlgSave.showModal();
  });
  dlgSave.addEventListener('close', () => {
    if (dlgSave.returnValue !== 'save') return;
    const name = $('#save-name').value.trim() || state.name || 'Simulação';
    const id = storage.saveSimulation(name, structuredClone(state), currentSim?.name === name ? currentSim.id : undefined);
    if (id) {
      currentSim = { id, name };
      toast('Simulação salva neste navegador.');
    } else toast('Não foi possível salvar (armazenamento indisponível).');
  });

  const dlgSims = $('#dlg-sims');
  $('#btn-open').addEventListener('click', () => {
    renderSimsList();
    dlgSims.showModal();
  });
  $('#sims-list').addEventListener('click', (e) => {
    const { sim, id } = e.target.dataset ?? {};
    if (!sim) return;
    const found = storage.listSimulations().find((s) => s.id === id);
    if (!found) return;
    if (sim === 'load') {
      currentSim = { id: found.id, name: found.name };
      loadState(found.state);
      dlgSims.close();
      toast(`“${found.name}” carregada.`);
    } else if (sim === 'dup') {
      storage.saveSimulation(`${found.name} (cópia)`, found.state);
      renderSimsList();
    } else if (sim === 'del' && confirm(`Excluir “${found.name}”?`)) {
      storage.deleteSimulation(found.id);
      if (currentSim?.id === found.id) currentSim = null;
      renderSimsList();
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawChart, 150);
  });
}

// ---------- início ----------
bind();
applyRatesToPremises(); // valores do cache (marcados como desatualizados) até a consulta terminar
fillStaticForm();
renderStages();
renderRates();
update();
refreshRates();
