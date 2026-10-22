// Interface da calculadora de renda fixa. Toda a regra de negócio fica em ./lib (JS puro, com testes).

import { useEffect, useRef, useState } from "react";
import { addTerm, businessDaysBetween, calendarDaysBetween, parseISO } from "./lib/calendar.js";
import { renderLineChart } from "./lib/charts.js";
import { MAX_TERM, compare, timeline } from "./lib/comparison.js";
import { INDEXERS, annualize } from "./lib/financial-math.js";
import { brl, date as fmtDate, dateTime, number, pct, signedBrl, signedPct } from "./lib/formatters.js";
import { SERIES, SOURCE, fetchRates } from "./lib/rates-api.js";
import { MAX_STAGES, defaultStage, defaultState, sanitizeState, toModel } from "./lib/state.js";
import * as storage from "./lib/storage.js";
import { IR_BRACKETS, PRODUCTS, TAX_RULES_VERIFIED_AT } from "./lib/tax-rules.js";

type Stage = ReturnType<typeof defaultStage>;
type State = Omit<ReturnType<typeof sanitizeState>, "stages"> & { stages: Stage[] };
type Rate = { value: number; date: string; source?: string; fetchedAt?: string; fromCache?: boolean; stale?: boolean };
type Rates = { rates: Record<string, Rate>; errors: Record<string, string>; loading: boolean };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shapes come from the untyped JS lib
type AppResult = any;

const COLORS = { strategy: "#0b8f6f", reference: "#c2570c" }; // validados para daltonismo (dataviz)
const PAGE_HASH = "#/investimentos";

function loadInitialState(): State {
  const query = window.location.hash.split("?")[1] ?? "";
  const shared = new URLSearchParams(query).get("s");
  if (shared) {
    history.replaceState(null, "", window.location.pathname + window.location.search + PAGE_HASH);
    const decoded = storage.decodeShare(shared);
    if (decoded) return decoded;
  }
  return storage.loadCurrent() ?? defaultState();
}

function cachedRates(): Record<string, Rate> {
  const cache = storage.loadRatesCache();
  const out: Record<string, Rate> = {};
  for (const key of Object.keys(SERIES)) {
    const c = cache[key];
    if (c && Number.isFinite(c.value) && parseISO(c.date)) out[key] = { ...c, fromCache: true, stale: true };
  }
  return out;
}

// Copia as taxas consultadas para as premissas quando "usar taxas atuais" está ligado.
function withRates(state: State, rates: Record<string, Rate>): State {
  if (!state.premises.autoRates) return state;
  const premises = { ...state.premises };
  if (rates.cdi) premises.cdi = rates.cdi.value;
  if (rates.selicEfetiva) premises.selic = rates.selicEfetiva.value;
  return { ...state, premises };
}

// ---------- caminho "a.b.0.c" no estado ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPath = (obj: any, path: string) => path.split(".").reduce((o, k) => o?.[k], obj);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setPath(obj: any, path: string, value: unknown) {
  const keys = path.split(".");
  const last = keys.pop()!;
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

// ---------- texto auxiliar ----------
const RATE_LABEL: Record<string, string> = {
  CDI: "Percentual do CDI (%)",
  SELIC: "Percentual da Selic (%)",
  PRE: "Taxa prefixada (% a.a.)",
  IPCA: "Taxa acima do IPCA (% a.a.)",
};
function rateText(indexer: string, rate: number) {
  if (!Number.isFinite(rate)) return "—";
  if (indexer === "CDI") return `${number(rate * 100, 1)}% do CDI`;
  if (indexer === "SELIC") return `${number(rate * 100, 1)}% da Selic`;
  if (indexer === "PRE") return `${pct(rate)} a.a. (pré)`;
  return `IPCA + ${pct(rate)} a.a.`;
}
const UNIT_TEXT: Record<string, string> = { days: "dia(s)", months: "mês(es)", years: "ano(s)" };
const termText = (s: Stage) => `${s.termValue} ${UNIT_TEXT[s.termUnit]}`;
const productLabel = (a: AppResult) => (a.isFill ? "CDB (reinvest.)" : PRODUCTS[a.product as keyof typeof PRODUCTS].label);
const taxLine = (a: AppResult) => (a.exempt ? "Isento" : pct(a.irRate, 1));
const tone = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

// Períodos de cada etapa, encadeados a partir da data de aplicação.
function maturities(state: State) {
  let cursor: string | null = state.startDate;
  return state.stages.map((s) => {
    const valid =
      cursor && parseISO(cursor) && Number.isInteger(s.termValue) && s.termValue > 0 && s.termValue <= MAX_TERM[s.termUnit as keyof typeof MAX_TERM];
    if (!valid) {
      cursor = null;
      return null;
    }
    const start: string = cursor!;
    const end: string = addTerm(start, s.termValue, s.termUnit);
    cursor = end;
    return { start, end, calendar: calendarDaysBetween(start, end), business: businessDaysBetween(start, end) };
  });
}

function verdictText(state: State, r: AppResult) {
  const name = state.name || "o investimento informado";
  const ref = `CDB a ${number(state.premises.refRate, 1)}% do CDI`;
  const { A, diffAB, C } = r;
  const lines: string[] = [];
  lines.push(
    diffAB === 0
      ? `${name} rende o mesmo, líquido, que um ${ref} no mesmo período (${fmtDate(A.startDate)} a ${fmtDate(A.endDate)}).`
      : `Investir em ${name} rende ${brl(Math.abs(diffAB))} líquidos a ${diffAB > 0 ? "mais" : "menos"} do que deixar o dinheiro em um ${ref} durante o mesmo período (${A.calendarDays} dias).`,
  );
  if (r.breakevenRate != null) lines.push(`Equivale a um CDB tributável de ${number(r.breakevenRate * 100, 2)}% do CDI no mesmo prazo.`);
  if (C.valid) {
    const h = state.premises.horizonMonths;
    lines.push(
      `Após ${h} meses, a estratégia com o investimento informado${C.strategy.apps.length > 1 ? " e reinvestimentos" : ""} resulta em ${brl(C.strategy.summary.netFinal)} líquidos, contra ${brl(C.reference.summary.netFinal)} na estratégia de referência. Diferença estimada: ${signedBrl(C.diff)}.`,
    );
  } else {
    lines.push(`Comparação em ${state.premises.horizonMonths} meses indisponível: ${C.strategy.reason}`);
  }
  return lines;
}

function warningsFor(state: State, r: AppResult): string[] {
  const list = [...r.warnings, ...(r.C.valid ? r.C.strategy.warnings.filter((w: string) => !r.warnings.some((x: string) => w.endsWith(x))) : [])];
  if (state.liquidity === "other") list.push("Liquidez “outra condição” não é modelada: a simulação assume resgate no vencimento de cada etapa.");
  if (state.earlyRedemption) list.push("Resgate antecipado pode ter rentabilidade menor que a contratada; não é simulado.");
  return list;
}

function summaryText(state: State, r: AppResult) {
  if (r.errors.length) return "Simulação com erros: " + r.errors.join(" ");
  const p = state.premises;
  const ref = `CDB a ${number(p.refRate, 1)}% do CDI`;
  return [
    `${state.name}${state.institution ? ` (${state.institution})` : ""}`,
    `Aplicação: ${brl(state.amount)} em ${fmtDate(state.startDate)}`,
    ...state.stages.map(
      (s, i) => `Etapa ${i + 1}: ${PRODUCTS[s.product as keyof typeof PRODUCTS].label} ${rateText(s.indexer, s.rate / 100)} por ${termText(s)}`,
    ),
    `Premissas: CDI ${number(p.cdi, 2)}% a.a.${Number.isFinite(p.selic) ? `, Selic ${number(p.selic, 2)}% a.a.` : ""}, constantes (projeção, não garantia).`,
    "",
    `A) Investimento: líquido ${brl(r.A.net)} (bruto ${brl(r.A.gross)}, impostos ${brl(r.A.taxes)})`,
    `B) ${ref}: líquido ${brl(r.B.net)}`,
    `Diferença A − B: ${signedBrl(r.diffAB)}`,
    "",
    ...verdictText(state, r),
  ].join("\n");
}

function csv(state: State, r: AppResult) {
  const ref = `CDB a ${number(state.premises.refRate, 1)}% do CDI`;
  const n = (v: number) => (Number.isFinite(v) ? v.toFixed(2).replace(".", ",") : "");
  const cell = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  const rows: unknown[][] = [
    ["Estratégia", "Etapa", "Início", "Vencimento", "Dias corridos", "Dias úteis", "Produto", "Taxa", "Saldo inicial", "Bruto final", "Rendimento bruto", "IOF", "IR", "Custos", "Líquido final"],
  ];
  const add = (label: string, apps: AppResult[]) =>
    apps.forEach((a, i) =>
      rows.push([label, i + 1, a.startDate, a.endDate, a.calendarDays, a.businessDays, productLabel(a), rateText(a.indexer, a.rate), n(a.principal), n(a.gross), n(a.income), n(a.iof), n(a.ir), n(a.cost), n(a.net)]),
    );
  add("A - Investimento informado", [r.A]);
  add(`B - ${ref}`, [r.B]);
  if (r.C.valid) {
    add(`C - Investimento + reinvestimentos (${state.premises.horizonMonths}m)`, r.C.strategy.apps);
    add(`C - Referência (${state.premises.horizonMonths}m)`, r.C.reference.apps);
  }
  return "﻿" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- componentes ----------
const Chart = ({ series }: { series: Parameters<typeof renderLineChart>[1] }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const draw = () => ref.current && renderLineChart(ref.current, series);
    draw();
    let timer: number | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = window.setTimeout(draw, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [series]);
  return <div ref={ref} className="chart" />;
};

const Kpi = ({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) => (
  <div className={`kpi ${tone}`}>
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
    {sub && <div className="kpi-sub">{sub}</div>}
  </div>
);

const ScenarioTable = ({ cols }: { cols: { title: string; a: AppResult }[] }) => {
  const rows: [string, (a: AppResult) => React.ReactNode][] = [
    ["Valor aplicado", (a) => brl(a.principal)],
    [
      "Período",
      (a) => (
        <>
          {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
          <br />
          <span className="muted small">
            {a.calendarDays} dc · {a.businessDays} du
          </span>
        </>
      ),
    ],
    ["Remuneração", (a) => rateText(a.indexer, a.rate)],
    ["Valor bruto final", (a) => brl(a.gross)],
    ["Rendimento bruto", (a) => brl(a.income)],
    [
      "IOF",
      (a) => (
        <>
          {brl(a.iof)} {a.iofRate ? <span className="muted small">({pct(a.iofRate, 0)} do rend.)</span> : null}
        </>
      ),
    ],
    [
      "Imposto de Renda",
      (a) => (
        <>
          {brl(a.ir)} <span className="muted small">({taxLine(a)})</span>
        </>
      ),
    ],
    ["Outros custos", (a) => brl(a.cost)],
    ["Valor líquido final", (a) => <strong>{brl(a.net)}</strong>],
    ["Rendimento líquido", (a) => brl(a.netIncome)],
    ["Rentabilidade bruta no período", (a) => pct(a.grossReturn)],
    ["Rentabilidade líquida no período", (a) => pct(a.netReturn)],
    ["Rentabilidade líquida anualizada", (a) => pct(annualize(a.netReturn, a.businessDays))],
  ];
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Indicador</th>
            {cols.map((c) => (
              <th key={c.title} scope="col">
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {cols.map((c) => (
                <td key={c.title}>{f(c.a)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const StrategyTable = ({ C, refLabel, horizon }: { C: AppResult; refLabel: string; horizon: number }) => {
  const s = C.strategy.summary;
  const r = C.reference.summary;
  const rows: [string, string, string, boolean?][] = [
    ["Patrimônio bruto final", brl(s.grossFinal), brl(r.grossFinal)],
    ["Patrimônio líquido final", brl(s.netFinal), brl(r.netFinal), true],
    ["Rendimentos brutos (soma das aplicações)", brl(s.totalIncome), brl(r.totalIncome)],
    ["Impostos pagos (IR + IOF)", brl(s.totalTaxes), brl(r.totalTaxes)],
    ["Custos", brl(s.totalCosts), brl(r.totalCosts)],
    ["Retorno líquido acumulado", pct(s.netReturn), pct(r.netReturn)],
    ["Rentabilidade líquida anualizada", pct(s.annualizedNet), pct(r.annualizedNet)],
  ];
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Indicador</th>
            <th scope="col">Investimento + reinvestimentos</th>
            <th scope="col">
              {refLabel} por {horizon} meses
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([l, a, b, bold]) => (
            <tr key={l}>
              <th scope="row">{l}</th>
              <td>{bold ? <strong>{a}</strong> : a}</td>
              <td>{bold ? <strong>{b}</strong> : b}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Diferença líquida</th>
            <td colSpan={2} className={tone(C.diff)}>
              <strong>{signedBrl(C.diff)}</strong> ({signedPct(C.diffPctOfPrincipal)} do capital inicial)
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

const StagesTable = ({ groups }: { groups: { title: string; apps: AppResult[] }[] }) => (
  <div className="table-wrap">
    <table className="data compact">
      <thead>
        <tr>
          {["Etapa", "Período", "Produto", "Taxa", "Saldo inicial", "Rendimento bruto", "Impostos e custos", "Saldo líquido"].map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      {groups.map(({ title, apps }) => (
        <tbody key={title}>
          <tr className="group">
            <th colSpan={8} scope="colgroup">
              {title}
            </th>
          </tr>
          {apps.map((a, i) => (
            <tr key={i}>
              <td>
                {i + 1}
                {a.isFill && <span className="tag">hipótese</span>}
                {a.truncated && <span className="tag">resgate no horizonte</span>}
              </td>
              <td>
                {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
                <br />
                <span className="muted small">{a.calendarDays} dias</span>
              </td>
              <td>{productLabel(a)}</td>
              <td>{rateText(a.indexer, a.rate)}</td>
              <td>{brl(a.principal)}</td>
              <td>{brl(a.income)}</td>
              <td>
                {brl(a.taxes + a.cost)}
                <br />
                <span className="muted small">
                  IR {taxLine(a)}
                  {a.iof ? ` · IOF ${brl(a.iof)}` : ""}
                </span>
              </td>
              <td>
                <strong>{brl(a.net)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  </div>
);

const HowItWorks = ({ state, r }: { state: State; r: AppResult }) => {
  const p = toModel(state).premises;
  const apps: AppResult[] = [r.A, ...(r.C.valid ? r.C.strategy.apps : [])];
  return (
    <details className="card how">
      <summary>
        <h2>Como o cálculo foi feito</h2>
      </summary>
      <h3>Premissas usadas</h3>
      <ul>
        <li>
          CDI projetado: {pct(p.cdi)} a.a. · Selic projetada: {Number.isFinite(p.selic) ? `${pct(p.selic)} a.a.` : "não informada"} · IPCA projetado:{" "}
          {Number.isFinite(p.ipca) ? `${pct(p.ipca)} a.a.` : "não informado"}.
        </li>
        <li>
          Taxas constantes durante todo o período (hipótese, não previsão). Data inicial: {fmtDate(state.startDate)}. Horizonte:{" "}
          {state.premises.horizonMonths} meses (até {fmtDate(r.C.horizonEnd)}).
        </li>
        <li>
          Referência: CDB a {number(state.premises.refRate, 1)}% do CDI, tributado pela tabela regressiva. Reinvestimentos futuros: CDB a{" "}
          {number(state.premises.reinvestRate, 1)}% do CDI.
        </li>
      </ul>
      <h3>Fórmulas</h3>
      <ul>
        <li>
          Taxa diária do CDI: <code>TD = (1 + CDI)^(1/252) − 1</code>, arredondada na 8ª casa (convenção B3). Com o CDI projetado: TD ={" "}
          {number(((1 + p.cdi) ** (1 / 252) - 1) * 100, 6)}% ao dia útil.
        </li>
        <li>
          Pós-fixado: <code>bruto = aplicado × (1 + TD × %indexador)^du</code>, onde <code>du</code> = dias úteis (calendário nacional de feriados)
          entre aplicação e resgate.
        </li>
        <li>
          Prefixado: <code>bruto = aplicado × (1 + taxa)^(du/252)</code>. IPCA+ (simplificado): <code>bruto = aplicado × [(1 + IPCA) × (1 + taxa)]^(du/252)</code>.
        </li>
        <li>
          IOF (resgate em menos de 30 dias corridos): <code>IOF = rendimento × alíquota_regressiva(dias)</code>.
        </li>
        <li>
          IR: <code>IR = (rendimento − IOF) × alíquota</code>, alíquota pelos dias corridos de <em>cada</em> aplicação:{" "}
          {IR_BRACKETS.map((b) => `${b.maxDays === Infinity ? "acima de 720" : `até ${b.maxDays}`} dias: ${pct(b.rate, 1)}`).join("; ")}.
        </li>
        <li>
          Líquido = bruto − IOF − IR − custos. Bruto, IOF e IR são arredondados em centavos no resgate; o líquido é reinvestido integralmente na etapa
          seguinte, que inicia nova contagem de prazo.
        </li>
        <li>
          Anualização: <code>(1 + retorno)^(252/du) − 1</code>. Retornos são compostos, nunca somados.
        </li>
        <li>Percentual do CDI equivalente: busca numérica (bisseção) do percentual que faz um CDB tributável, no mesmo período, chegar ao mesmo valor líquido.</li>
      </ul>
      <h3>Detalhamento tributário</h3>
      <div className="table-wrap">
        <table className="data compact">
          <thead>
            <tr>
              {["Aplicação", "Dias corridos", "Dias úteis", "Rendimento", "IOF", "Base do IR", "Alíquota IR", "IR"].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apps.map((a, i) => (
              <tr key={i}>
                <td>{i === 0 ? "Cenário A" : `Estratégia · etapa ${i}`}</td>
                <td>{a.calendarDays}</td>
                <td>{a.businessDays}</td>
                <td>{brl(a.income)}</td>
                <td>{brl(a.iof)}</td>
                <td>{brl(a.income - a.iof)}</td>
                <td>{taxLine(a)}</td>
                <td>{brl(a.ir)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Limitações</h3>
      <ul>
        <li>Não há previsão de juros: a taxa é mantida constante. Mudanças na Selic/CDI alteram os resultados.</li>
        <li>Vencimentos em dia não útil não são ajustados para o próximo dia útil.</li>
        <li>IPCA+ usa IPCA anual constante, sem defasagem nem VNA mensal.</li>
        <li>
          Isenção de LCI/LCA considera pessoa física e as regras vigentes em {fmtDate(TAX_RULES_VERIFIED_AT)}. Não é aconselhamento tributário.
        </li>
        <li>FGC não é garantia de rentabilidade nem cobre todos os riscos; confira limites e condições em fgc.org.br.</li>
      </ul>
    </details>
  );
};

// ---------- página ----------
export const Investimentos = () => {
  const [rates, setRates] = useState<Rates>(() => ({ rates: cachedRates(), errors: {}, loading: false }));
  // Valores do cache (marcados como desatualizados) até a consulta terminar.
  const [state, setState] = useState<State>(() => withRates(loadInitialState(), rates.rates));
  const [currentSim, setCurrentSim] = useState<{ id: string; name: string } | null>(null);
  const [sims, setSims] = useState(storage.listSimulations);
  const [toastMsg, setToastMsg] = useState("");
  const [saveName, setSaveName] = useState("");
  const saveDlg = useRef<HTMLDialogElement>(null);
  const simsDlg = useRef<HTMLDialogElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const result: AppResult = compare(toModel(state));
  const ends = maturities(state);
  const p = state.premises;
  const refLabel = `CDB a ${number(p.refRate, 1)}% do CDI`;

  useEffect(() => {
    storage.saveCurrent(state);
  }, [state]);

  const toast = (msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), 3000);
  };

  const refreshRates = async () => {
    setRates((r) => ({ ...r, loading: true }));
    const fresh = (await fetchRates({ cache: storage.loadRatesCache() })) as Omit<Rates, "loading">;
    const toCache = { ...storage.loadRatesCache() };
    for (const [k, r] of Object.entries(fresh.rates) as [string, Rate][]) {
      if (!r.fromCache) toCache[k] = { value: r.value, date: r.date, source: r.source, fetchedAt: r.fetchedAt };
    }
    storage.saveRatesCache(toCache);
    setRates({ ...fresh, loading: false });
    setState((s) => withRates(s, fresh.rates));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one fetch on mount
    refreshRates();
  }, []);

  const set = (path: string, value: unknown) =>
    setState((s) => {
      const next = structuredClone(s);
      setPath(next, path, value);
      if (path === "premises.cdi" || path === "premises.selic") next.premises.autoRates = false;
      return path === "premises.autoRates" && value ? withRates(next, rates.rates) : next;
    });

  // Props de input ligadas a um caminho do estado.
  const num = (path: string) => ({
    type: "number",
    value: getPath(state, path) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      set(path, e.target.value === "" || Number.isNaN(e.target.valueAsNumber) ? null : e.target.valueAsNumber),
  });
  const text = (path: string) => ({
    value: getPath(state, path) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(path, e.target.value),
  });
  const check = (path: string) => ({
    type: "checkbox",
    checked: Boolean(getPath(state, path)),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(path, e.target.checked),
  });

  const copy = async (value: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(okMsg);
    } catch {
      toast("Não foi possível copiar automaticamente.");
    }
  };

  const loadState = (next: State) => setState(withRates(next, rates.rates));

  const onSaveClose = () => {
    if (saveDlg.current?.returnValue !== "save") return;
    const name = saveName.trim() || state.name || "Simulação";
    const id = storage.saveSimulation(name, structuredClone(state), currentSim && currentSim.name === name ? (currentSim.id as ReturnType<typeof crypto.randomUUID>) : undefined);
    if (id) {
      setCurrentSim({ id, name });
      toast("Simulação salva neste navegador.");
    } else toast("Não foi possível salvar (armazenamento indisponível).");
  };

  const ok = Object.values(rates.rates).filter((r) => !r.fromCache).length;
  const cdiRate = rates.rates.cdi;
  const premisesNote = !Number.isFinite(p.cdi)
    ? { cls: "small alert alert-warn", text: "CDI projetado não informado: a taxa atual não pôde ser obtida. Digite o valor que deseja usar como hipótese." }
    : p.autoRates && cdiRate
      ? {
          cls: cdiRate.stale ? "small alert alert-warn" : "small muted",
          text: `CDI projetado = CDI de ${fmtDate(cdiRate.date)} (${number(cdiRate.value, 2)}% a.a.)${cdiRate.stale ? " — valor DESATUALIZADO, confira antes de decidir." : "."} Selic projetada = Selic efetiva.`,
        }
      : { cls: "small muted", text: "Projeções definidas manualmente." };

  const { A, B, C } = result;
  const h = p.horizonMonths;
  const model = toModel(state).premises;

  return (
    <>
      <main className="layout">
        <div className="card-head">
          <div>
            <h1>Calculadora de Renda Fixa</h1>
            <p className="subtitle">
              Vale a pena? Compare com 100% do CDI pelo valor <strong>líquido</strong>.
            </p>
          </div>
          <nav className="actions" aria-label="Ações da simulação">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSaveName(currentSim?.name ?? state.name);
                saveDlg.current?.showModal();
              }}
            >
              Salvar
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSims(storage.listSimulations());
                simsDlg.current?.showModal();
              }}
            >
              Simulações
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                copy(
                  `${location.origin}${location.pathname}${PAGE_HASH}?s=${storage.encodeShare(state)}`,
                  "Link copiado. Os dados vão no próprio link, sem passar por servidores.",
                )
              }
            >
              Compartilhar link
            </button>
            <button type="button" className="btn" onClick={() => copy(summaryText(state, result), "Resumo copiado.")}>
              Copiar resumo
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                result.errors.length ? toast("Corrija os erros antes de exportar.") : download(`simulacao-${state.startDate}.csv`, csv(state, result), "text/csv;charset=utf-8")
              }
            >
              Exportar CSV
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (confirm("Restaurar os valores padrão? A simulação atual não salva será perdida.")) {
                  setCurrentSim(null);
                  loadState(defaultState());
                }
              }}
            >
              Restaurar padrão
            </button>
          </nav>
        </div>

        {/* 1. Taxas atuais */}
        <section className="card rates" aria-labelledby="rates-title">
          <div className="card-head">
            <h2 id="rates-title">Taxas econômicas atuais</h2>
            <button type="button" className="btn btn-small" disabled={rates.loading} onClick={refreshRates}>
              Atualizar taxas
            </button>
          </div>
          <div className="rates-grid">
            {Object.entries(SERIES).map(([key, meta]) => {
              const r = rates.rates[key];
              const err = rates.errors[key];
              let badge = <span className="badge badge-muted">Indisponível</span>;
              if (rates.loading && !r) badge = <span className="badge badge-muted">Carregando…</span>;
              else if (r?.fromCache) badge = <span className="badge badge-warn">Último valor salvo</span>;
              else if (r?.stale) badge = <span className="badge badge-warn">Desatualizado</span>;
              else if (r) badge = <span className="badge badge-ok">Atualizado</span>;
              return (
                <div key={key} className="rate">
                  <div className="rate-label">
                    {meta.label} {badge}
                  </div>
                  <div className="rate-value">
                    {r ? (
                      <>
                        {number(r.value, 2)}
                        <small>% a.a.</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div className="muted small">{r ? `Referência: ${fmtDate(r.date)} · Consulta: ${dateTime(r.fetchedAt)}` : "Sem valor válido"}</div>
                  <div className="muted small">
                    Fonte: {r?.source ?? SOURCE} (série {meta.code}){err ? ` · Erro: ${err}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted small" role="status" aria-live="polite">
            {rates.loading
              ? "Consultando o Banco Central…"
              : Object.keys(rates.errors).length
                ? `Consulta com falhas (${ok} de ${Object.keys(SERIES).length} séries atualizadas). Valores salvos anteriormente aparecem marcados; você pode digitar as projeções manualmente.`
                : "Selic meta, Selic efetiva e CDI são indicadores diferentes. O CDI projeta CDBs/LCIs/LCAs pós-fixados; a Selic efetiva, os atrelados à Selic."}
          </p>
        </section>

        <div className="columns">
          {/* 2. Configuração */}
          <form className="col-form" noValidate autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <section className="card" aria-labelledby="inv-title">
              <h2 id="inv-title">Investimento</h2>
              <div className="grid-2">
                <label className="field span-2">
                  Nome ou descrição
                  <input type="text" maxLength={120} {...text("name")} />
                </label>
                <label className="field span-2">
                  Instituição financeira <span className="opt">(opcional)</span>
                  <input type="text" maxLength={120} {...text("institution")} />
                </label>
                <label className="field">
                  Valor inicial (R$)
                  <input {...num("amount")} min="0" step="0.01" inputMode="decimal" required />
                </label>
                <label className="field">
                  Data da aplicação
                  <input type="date" {...text("startDate")} required />
                </label>
                <label className="field">
                  Liquidez
                  <select {...text("liquidity")}>
                    <option value="maturity">Somente no vencimento</option>
                    <option value="daily">Diária</option>
                    <option value="other">Outra condição</option>
                  </select>
                </label>
                <label className="field check">
                  <input {...check("earlyRedemption")} /> Permite resgate antecipado
                </label>
              </div>
            </section>

            <section className="card" aria-labelledby="stages-title">
              <h2 id="stages-title">Etapas</h2>
              <p className="muted small">
                A etapa 1 é o investimento analisado. Etapas seguintes são reinvestimentos do valor líquido — cada uma é uma nova aplicação, com prazo de
                IR/IOF próprio.
              </p>
              {state.stages.map((s, i) => {
                const product: { label: string; supported: boolean; reason?: string } = PRODUCTS[s.product as keyof typeof PRODUCTS];
                const end = ends[i];
                const path = (k: string) => `stages.${i}.${k}`;
                return (
                  <fieldset key={i} className="stage">
                    <legend>
                      Etapa {i + 1} — {i === 0 ? "investimento analisado" : "reinvestimento"}
                    </legend>
                    {i > 0 && (
                      <button
                        type="button"
                        className="btn btn-small btn-ghost stage-remove"
                        aria-label={`Remover etapa ${i + 1}`}
                        onClick={() => setState((st) => ({ ...st, stages: st.stages.filter((_, j) => j !== i) }))}
                      >
                        Remover
                      </button>
                    )}
                    <div className="grid-2">
                      <label className="field">
                        Tipo de investimento
                        <select {...text(path("product"))}>
                          {Object.entries(PRODUCTS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Remuneração
                        <select {...text(path("indexer"))}>
                          {Object.entries(INDEXERS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        {RATE_LABEL[s.indexer]}
                        <input {...num(path("rate"))} min="0" step="0.01" inputMode="decimal" />
                      </label>
                      <div className="field">
                        Prazo
                        <div className="inline">
                          <input {...num(path("termValue"))} min="1" step="1" inputMode="numeric" aria-label={`Prazo da etapa ${i + 1}`} />
                          <select {...text(path("termUnit"))} aria-label={`Unidade do prazo da etapa ${i + 1}`}>
                            <option value="days">dias</option>
                            <option value="months">meses</option>
                            <option value="years">anos</option>
                          </select>
                        </div>
                      </div>
                      <label className="field">
                        Tributação (IR)
                        <select {...text(path("taxMode"))}>
                          <option value="auto">Regra do produto (pessoa física)</option>
                          <option value="taxable">Tabela regressiva</option>
                          <option value="exempt">Isento (confirme o enquadramento)</option>
                        </select>
                      </label>
                      <label className="field">
                        Custos conhecidos (R$)
                        <input {...num(path("cost"))} min="0" step="0.01" inputMode="decimal" />
                      </label>
                    </div>
                    <p className="small maturity">
                      {end ? (
                        <>
                          Período:{" "}
                          <strong>
                            {fmtDate(end.start)} → {fmtDate(end.end)}
                          </strong>{" "}
                          · {end.calendar} dias corridos · {end.business} dias úteis
                        </>
                      ) : (
                        "Vencimento: informe data e prazo válidos."
                      )}
                    </p>
                    {!product.supported && (
                      <p className="alert alert-warn small">
                        {product.label} ainda não é simulado: {product.reason}
                      </p>
                    )}
                  </fieldset>
                );
              })}
              <button
                type="button"
                className="btn btn-small"
                disabled={state.stages.length >= MAX_STAGES}
                onClick={() => setState((st) => ({ ...st, stages: [...st.stages, defaultStage()] }))}
              >
                + Adicionar etapa
              </button>
              <p className="muted small">
                Se a última etapa vencer antes de {p.horizonMonths ?? "—"} meses, o saldo líquido é reinvestido (hipótese) em CDB a {number(p.reinvestRate, 1)}%
                do CDI até completar o horizonte.
              </p>
            </section>

            <section className="card" aria-labelledby="prem-title">
              <h2 id="prem-title">Premissas da simulação</h2>
              <p className="muted small">
                Taxas constantes durante todo o período. É uma simplificação: CDI, Selic e IPCA vão mudar, e a projeção não garante rentabilidade futura.
              </p>
              <div className="grid-2">
                <label className="field">
                  CDI anual projetado (%)
                  <input {...num("premises.cdi")} step="0.01" inputMode="decimal" />
                </label>
                <label className="field">
                  Selic anual projetada (%)
                  <input {...num("premises.selic")} step="0.01" inputMode="decimal" />
                </label>
                <label className="field">
                  IPCA anual projetado (%)
                  <input {...num("premises.ipca")} step="0.01" inputMode="decimal" placeholder="Só para IPCA+" />
                </label>
                <label className="field">
                  Horizonte da comparação (meses)
                  <input {...num("premises.horizonMonths")} min="1" max="600" step="1" inputMode="numeric" />
                </label>
                <label className="field">
                  Referência: CDB a (% do CDI)
                  <input {...num("premises.refRate")} min="0" step="0.1" inputMode="decimal" />
                </label>
                <label className="field">
                  Reinvestimento futuro: CDB a (% do CDI)
                  <input {...num("premises.reinvestRate")} min="0" step="0.1" inputMode="decimal" />
                </label>
                <label className="field check span-2">
                  <input {...check("premises.autoRates")} /> Usar taxas atuais consultadas como projeção
                </label>
              </div>
              <p className={premisesNote.cls}>{premisesNote.text}</p>
            </section>
          </form>

          {/* 3 e 4. Resultados */}
          <section className="col-results" aria-label="Resultados">
            {result.errors.length ? (
              <div className="alert alert-error" role="alert">
                <strong>Não foi possível calcular:</strong>
                <ul>
                  {result.errors.map((e: string) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <section className={`card verdict ${tone(result.diffAB)}`}>
                  <h2>
                    {state.name || "Investimento"}
                    {state.institution && <span className="muted"> · {state.institution}</span>}
                  </h2>
                  {verdictText(state, result).map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </section>

                <div className="kpis">
                  <Kpi label="Patrimônio líquido final" value={brl(A.net)} sub={`em ${fmtDate(A.endDate)}`} />
                  <Kpi label="Rendimento líquido" value={brl(A.netIncome)} sub={`bruto ${brl(A.income)}`} />
                  <Kpi label="Impostos pagos" value={brl(A.taxes)} sub={A.exempt ? "isento de IR" : `IR ${pct(A.irRate, 1)}${A.iof ? " + IOF" : ""}`} />
                  <Kpi label="Rentabilidade líquida" value={pct(A.netReturn)} sub={`${pct(annualize(A.netReturn, A.businessDays))} a.a.`} />
                  <Kpi label={`Diferença vs ${number(p.refRate, 0)}% do CDI`} value={signedBrl(result.diffAB)} sub="mesmo período" tone={tone(result.diffAB)} />
                  <Kpi
                    label={`Resultado em ${h} meses`}
                    value={C.valid ? signedBrl(C.diff) : "n/d"}
                    sub={C.valid ? `líquido final ${brl(C.strategy.summary.netFinal)}` : "comparação inválida"}
                    tone={C.valid ? tone(C.diff) : ""}
                  />
                </div>

                {warningsFor(state, result).length > 0 && (
                  <div className="alert alert-warn" role="note">
                    <strong>Atenção</strong>
                    <ul>
                      {warningsFor(state, result).map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <section className="card">
                  <h2>Cenários A e B — mesmo prazo</h2>
                  <ScenarioTable
                    cols={[
                      { title: "A · Investimento informado", a: A },
                      { title: `B · ${refLabel}`, a: B },
                    ]}
                  />
                  <p className="small">
                    Diferença líquida A − B: <strong className={tone(result.diffAB)}>{signedBrl(result.diffAB)}</strong>
                  </p>
                </section>

                <section className="card">
                  <h2>Cenário C — horizonte de {h} meses</h2>
                  {C.valid ? (
                    <>
                      <StrategyTable C={C} refLabel={refLabel} horizon={h} />
                      <h3>Evolução estimada do patrimônio</h3>
                      <ul className="legend">
                        <li>
                          <span className="swatch" style={{ background: COLORS.strategy }} />
                          Investimento + reinvestimentos
                        </li>
                        <li>
                          <span className="swatch dashed" style={{ borderColor: COLORS.reference }} />
                          {refLabel}
                        </li>
                        <li>
                          <span className="dot" />
                          Vencimento / reinvestimento (degrau = impostos)
                        </li>
                      </ul>
                      <Chart
                        series={[
                          { name: "Investimento + reinvest.", color: COLORS.strategy, points: timeline(C.strategy.apps, model) },
                          { name: refLabel, color: COLORS.reference, dashed: true, points: timeline(C.reference.apps, model) },
                        ]}
                      />
                      <h3>Detalhamento por etapa</h3>
                      <StagesTable
                        groups={[
                          { title: "Estratégia com o investimento informado", apps: C.strategy.apps },
                          { title: "Estratégia de referência", apps: C.reference.apps },
                        ]}
                      />
                    </>
                  ) : (
                    <p className="alert alert-warn">{C.strategy.reason}</p>
                  )}
                </section>

                <HowItWorks state={state} r={result} />
              </>
            )}
          </section>
        </div>
      </main>

      <footer className="footer muted small">
        <p>
          Ferramenta de apoio à decisão. Não é recomendação de investimento nem aconselhamento tributário. Os dados ficam apenas no seu navegador. Taxas:{" "}
          <a href="https://dadosabertos.bcb.gov.br/" rel="noopener">
            Banco Central do Brasil (SGS)
          </a>
          .
        </p>
      </footer>

      <dialog ref={simsDlg} aria-labelledby="dlg-sims-title">
        <form method="dialog" className="dialog-body">
          <h2 id="dlg-sims-title">Simulações salvas</h2>
          <ul className="sims-list">
            {sims.length ? (
              sims.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <br />
                    <span className="muted small">{dateTime(s.savedAt)}</span>
                  </div>
                  <div className="sims-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        setCurrentSim({ id: s.id, name: s.name });
                        loadState(s.state);
                        simsDlg.current?.close();
                        toast(`“${s.name}” carregada.`);
                      }}
                    >
                      Carregar
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        storage.saveSimulation(`${s.name} (cópia)`, s.state);
                        setSims(storage.listSimulations());
                      }}
                    >
                      Duplicar
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-ghost"
                      onClick={() => {
                        if (!confirm(`Excluir “${s.name}”?`)) return;
                        storage.deleteSimulation(s.id);
                        if (currentSim?.id === s.id) setCurrentSim(null);
                        setSims(storage.listSimulations());
                      }}
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              ))
            ) : (
              <li className="muted">Nenhuma simulação salva.</li>
            )}
          </ul>
          <div className="dialog-actions">
            <button className="btn" value="close">
              Fechar
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={saveDlg} aria-labelledby="dlg-save-title" onClose={onSaveClose}>
        <form method="dialog" className="dialog-body">
          <h2 id="dlg-save-title">Salvar simulação</h2>
          <label className="field">
            Nome da simulação
            <input type="text" maxLength={120} required value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          </label>
          <div className="dialog-actions">
            <button className="btn btn-ghost" value="cancel" formNoValidate>
              Cancelar
            </button>
            <button className="btn btn-primary" value="save">
              Salvar
            </button>
          </div>
        </form>
      </dialog>

      {toastMsg && (
        <div className="toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </>
  );
};
