import { usePersistedState } from "../../usePersistedState";
import { brl } from "../../format";
import { LineChart } from "../../components/LineChart";
import { NumberFields, NumberInput } from "../../components/NumberFields";
import { Section } from "../../components/Section";
import { StackedBar } from "../../components/StackedBar";
import { calculate, type VendingInput } from "./calc";

const perDay = (value: number, days: number) => (days > 0 ? value / days : 0);
const pctText = (fraction: number) => `${(fraction * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

const paybackText = (months: number, investment: number) => {
  if (investment <= 0) return "—";
  if (!Number.isFinite(months)) return "nunca";
  const m = Math.ceil(months);
  return m < 12 ? `${m} meses` : `${m} meses (${(m / 12).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} anos)`;
};


const defaults: VendingInput & { daysOpen: number } = {
  buyPrice: 8,
  sellPrice: 15,
  units: 720,
  taxPct: 4,
  cardFeePct: 0,
  mallSharePct: 10,
  rent: 3500,
  accounting: 300,
  otherCosts: 250,
  initialInvestment: 0,
  daysOpen: 30,
};

// Hypothetical foot traffic × conversion. "Realista" matches the default 24 pct/dia.
const defaultScenarios = [
  { name: "Pessimista", people: 1500, conversionPct: 1 },
  { name: "Realista", people: 2000, conversionPct: 1.2 },
  { name: "Otimista", people: 2500, conversionPct: 1.6 },
];
const SCENARIO_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"]; // categorical slots 1-3 (dataviz)
const PROJECTION_MONTHS = 24;

const addMonths = (months: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

export const Vending = () => {
  const [input, setInput] = usePersistedState("vending.input", defaults);
  const [scenarios, setScenarios] = usePersistedState("vending.scenarios", defaultScenarios);
  const r = calculate(input);
  const fields = { value: input, onChange: setInput };
  const profit = r.net >= 0;
  // Whole packages: what you actually have to sell to break even.
  const breakEvenUnits = Math.ceil(r.breakEvenUnits);
  const slack = input.units - breakEvenUnits;
  const m = r.metrics;
  const per = (v: number) => (input.units > 0 ? v / input.units : 0);
  // [label, per package, per month, subtotal?]
  const metricRows: [string, number, number, boolean?][] = [
    ["Preço de venda", input.sellPrice, r.revenue, true],
    ["− Mercadoria", -input.buyPrice, -r.cost],
    ["= Lucro bruto", per(r.grossProfit), r.grossProfit, true],
    ["− Imposto", -per(r.tax), -r.tax],
    ["− Taxa de cartão", -per(r.cardFee), -r.cardFee],
    ["− Shopping", -per(r.mallShare), -r.mallShare],
    ["= Contribuição", r.unitMargin, r.unitMargin * input.units, true],
    ["− Custos fixos (rateio)", -per(r.fixedCosts), -r.fixedCosts],
    ["= Lucro líquido", per(r.net), r.net, true],
  ];
  // Traffic scenarios: same costs/prices, units = people × conversion × days open.
  const projections = scenarios.map((sc) => {
    const perDayUnits = (sc.people * sc.conversionPct) / 100;
    const units = Math.round(perDayUnits * input.daysOpen);
    const res = calculate({ ...input, units });
    return {
      ...sc,
      perDayUnits,
      units,
      ...res,
      // Conversion needed to break even with this traffic.
      breakEvenConversion: sc.people > 0 && input.daysOpen > 0 ? res.breakEvenUnits / input.daysOpen / sc.people : Infinity,
    };
  });
  const updateScenario = (i: number, patch: Partial<(typeof scenarios)[number]>) =>
    setScenarios(scenarios.map((sc, j) => (j === i ? { ...sc, ...patch } : sc)));
  const cashSeries = projections.map((p, i) => ({
    name: p.name,
    color: SCENARIO_COLORS[i],
    points: Array.from({ length: PROJECTION_MONTHS + 1 }, (_, month) => ({
      date: addMonths(month),
      value: month * p.net - input.initialInvestment,
    })),
  }));

  // Same inputs, different sales volume.
  const volumeChanges = [-0.2, -0.1, 0, 0.1, 0.2].map((change) => {
    const units = Math.round(input.units * (1 + change));
    return { change, units, ...calculate({ ...input, units }) };
  });

  return (
    <main className="layout">
      <div className="card-head">
        <h1>Calculadora Vending Machine</h1>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            if (!confirm("Voltar todos os campos e cenários para os valores padrão?")) return;
            setInput(defaults);
            setScenarios(defaultScenarios);
          }}
        >
          Restaurar padrão
        </button>
      </div>
      <p className="muted small">Os valores ficam salvos neste navegador.</p>
      <div className="inputs">
        <Section title="💰 Investimento">
          <NumberFields
            {...fields}
            fields={[{ key: "initialInvestment", label: "Investimento inicial", unit: "R$" }]}
          />
          <p className="muted small note">Máquina, instalação, estoque inicial, etc.</p>
        </Section>
        <Section title="📦 Produto e vendas">
          <NumberFields
            {...fields}
            fields={[
              { key: "buyPrice", label: "Compra", unit: "R$/pct" },
              { key: "sellPrice", label: "Venda", unit: "R$/pct" },
              { key: "units", label: "Vendas", unit: "pct/mês" },
              { key: "daysOpen", label: "Dias abertos", unit: "dias/mês" },
            ]}
          />
        </Section>
        <Section title="％ Percentuais">
          <NumberFields
            {...fields}
            fields={[
              { key: "taxPct", label: "Imposto", unit: "% do faturamento" },
              { key: "cardFeePct", label: "Taxa de cartão", unit: "% do faturamento" },
              { key: "mallSharePct", label: "Shopping", unit: "% do lucro bruto" },
            ]}
          />
        </Section>
        <Section title="🏠 Custos fixos">
          <NumberFields
            {...fields}
            fields={[
              { key: "rent", label: "Aluguel", unit: "R$/mês" },
              { key: "accounting", label: "Contabilidade", unit: "R$/mês" },
              { key: "otherCosts", label: "Combustível, etc", unit: "R$/mês" },
            ]}
          />
        </Section>
      </div>

      <Section title="Resultado do mês">
        <div className="kpis">
          <div className={`kpi highlight ${profit ? "pos" : "neg"}`}>
            <div className="kpi-label">{profit ? "✅ Lucro líquido" : "⚠️ Prejuízo"}</div>
            <div className="kpi-value">{brl(r.net)}</div>
            <div className="kpi-sub">
              margem de {pctText(m.netMargin)} · {brl(r.net * 12)}/ano
            </div>
          </div>
          <div className={`kpi ${Number.isFinite(r.paybackMonths) ? "" : "neg"}`}>
            <div className="kpi-label">Retorno do investimento</div>
            <div className="kpi-value">{paybackText(r.paybackMonths, input.initialInvestment)}</div>
            <div className="kpi-sub">
              {input.initialInvestment > 0 ? `ROI de ${pctText(m.annualRoi)} ao ano` : "informe o investimento inicial"}
            </div>
          </div>
          <div className={`kpi ${m.safetyMargin < 0.1 ? "neg" : ""}`}>
            <div className="kpi-label">Margem de segurança</div>
            <div className="kpi-value">{Number.isFinite(r.breakEvenUnits) ? pctText(m.safetyMargin) : "—"}</div>
            <div className="kpi-sub">quanto as vendas podem cair até o prejuízo</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Markup</div>
            <div className="kpi-value">{pctText(m.markup)}</div>
            <div className="kpi-sub">preço de venda acima do custo</div>
          </div>
        </div>
      </Section>

      <Section title="Por pacote e por mês">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Indicador</th>
                <th scope="col">Por pacote</th>
                <th scope="col">% do preço</th>
                <th scope="col">No mês</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map(([label, unit, month, total]) => (
                <tr key={label}>
                  <th scope="row">{total ? <strong>{label}</strong> : label}</th>
                  <td className={unit < 0 ? "neg" : undefined}>{brl(unit)}</td>
                  <td className={unit < 0 ? "neg" : undefined}>{pctText(input.sellPrice > 0 ? unit / input.sellPrice : 0)}</td>
                  <td className={month < 0 ? "neg" : undefined}>{total ? <strong>{brl(month)}</strong> : brl(month)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Meta de vendas">
        {Number.isFinite(r.breakEvenUnits) ? (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col"></th>
                    <th scope="col">Para empatar</th>
                    <th scope="col">Hoje</th>
                    <th scope="col">Folga</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Pacotes/mês", breakEvenUnits, input.units, (n: number) => fmt(n)],
                      ["Pacotes/dia", perDay(breakEvenUnits, input.daysOpen), perDay(input.units, input.daysOpen), (n: number) => fmt(n)],
                      ["Venda bruta/mês", breakEvenUnits * input.sellPrice, r.revenue, brl],
                      ["Venda bruta/dia", perDay(breakEvenUnits * input.sellPrice, input.daysOpen), perDay(r.revenue, input.daysOpen), brl],
                    ] as const
                  ).map(([label, even, today, f]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      <td>{f(even)}</td>
                      <td>{f(today)}</td>
                      <td className={slack < 0 ? "neg" : undefined}>{f(today - even)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Number.isFinite(m.minSellPrice) && (
              <p className="small">
                Vendendo {fmt(input.units)} pct/mês, o preço mínimo para não ter prejuízo é <strong>{brl(m.minSellPrice)}</strong>.
              </p>
            )}
          </>
        ) : (
          <p className="alert alert-warn">Cada pacote vendido dá prejuízo: não existe volume que empate. Revise preço de compra/venda.</p>
        )}
      </Section>

      <Section title="E se as vendas mudarem?">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Vendas</th>
                <th scope="col">Pacotes/mês</th>
                <th scope="col">Faturamento</th>
                <th scope="col">Lucro/mês</th>
                {input.initialInvestment > 0 && <th scope="col">Retorno</th>}
              </tr>
            </thead>
            <tbody>
              {volumeChanges.map((sc) => (
                <tr key={sc.change}>
                  <th scope="row">{sc.change === 0 ? <strong>Hoje</strong> : `${sc.change > 0 ? "+" : "−"}${Math.abs(sc.change * 100)}%`}</th>
                  <td>{fmt(sc.units)}</td>
                  <td>{brl(sc.revenue)}</td>
                  <td className={sc.net < 0 ? "neg" : "pos"}>{brl(sc.net)}</td>
                  {input.initialInvestment > 0 && <td>{paybackText(sc.paybackMonths, input.initialInvestment)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Projeções por fluxo de pessoas">
        <p className="muted small">
          Cenários hipotéticos: quantas pessoas passam pela máquina por dia e quantas compram. Edite os valores; custos e preços vêm dos campos acima.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Cenário</th>
                <th scope="col">Pessoas/dia</th>
                <th scope="col">% que compra</th>
                <th scope="col">Pacotes/dia</th>
                <th scope="col">Faturamento/mês</th>
                <th scope="col">Lucro/mês</th>
                {input.initialInvestment > 0 && <th scope="col">Retorno</th>}
                <th scope="col">% p/ empatar</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p, i) => (
                <tr key={p.name}>
                  <th scope="row">
                    <span className="bar-swatch" style={{ background: SCENARIO_COLORS[i], display: "inline-block", marginRight: 6 }} />
                    {p.name}
                  </th>
                  <td>
                    <NumberInput className="cell-input" label={`Pessoas/dia ${p.name}`} value={p.people} onChange={(people) => updateScenario(i, { people })} />
                  </td>
                  <td>
                    <NumberInput
                      className="cell-input"
                      label={`% que compra ${p.name}`}
                      value={p.conversionPct}
                      onChange={(conversionPct) => updateScenario(i, { conversionPct })}
                    />
                  </td>
                  <td>{fmt(p.perDayUnits)}</td>
                  <td>{brl(p.revenue)}</td>
                  <td className={p.net < 0 ? "neg" : "pos"}>
                    <strong>{brl(p.net)}</strong>
                  </td>
                  {input.initialInvestment > 0 && <td>{paybackText(p.paybackMonths, input.initialInvestment)}</td>}
                  <td>{Number.isFinite(p.breakEvenConversion) ? pctText(p.breakEvenConversion) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">"% p/ empatar": quantos dos que passam precisam comprar para o mês não dar prejuízo.</p>
        <h3>Caixa acumulado em {PROJECTION_MONTHS} meses</h3>
        <p className="muted small">
          {input.initialInvestment > 0
            ? `Começa em −${brl(input.initialInvestment)} (investimento) e soma o lucro de cada mês. Onde a linha cruza zero, o investimento voltou.`
            : "Soma o lucro de cada mês. Informe o investimento inicial para ver quando ele volta."}
        </p>
        <ul className="legend">
          {projections.map((p, i) => (
            <li key={p.name}>
              <span className="swatch" style={{ background: SCENARIO_COLORS[i] }} />
              {p.name}: {brl(p.net * PROJECTION_MONTHS - input.initialInvestment)} em {PROJECTION_MONTHS} meses
            </li>
          ))}
        </ul>
        <LineChart series={cashSeries} label="Caixa acumulado por cenário de fluxo. Os valores estão na tabela acima." />
      </Section>

      <Section title="Para onde vai o faturamento">
        <StackedBar
          total={Math.max(r.revenue, r.revenue - r.net)}
          segments={[
            { label: "Mercadoria", value: r.cost, color: "#2a78d6" },
            { label: "Imposto", value: r.tax, color: "#eb6834" },
            { label: "Taxa de cartão", value: r.cardFee, color: "#00a3b4" },
            { label: "Shopping", value: r.mallShare, color: "#1baf7a" },
            { label: "Aluguel", value: input.rent, color: "#eda100" },
            { label: "Contabilidade", value: input.accounting, color: "#e87ba4" },
            { label: "Combustível, etc", value: input.otherCosts, color: "#6250d6" },
            { label: "Lucro", value: r.net, color: "#008300" },
          ]}
        />
        {!profit && (
          <p className="neg">Custos passam do faturamento em {brl(-r.net)}.</p>
        )}
      </Section>

    </main>
  );
};
