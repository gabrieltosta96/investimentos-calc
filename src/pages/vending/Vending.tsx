import { useState } from "react";
import { MoneyTable } from "../../components/MoneyTable";
import { brl } from "../../format";
import { NumberFields } from "../../components/NumberFields";
import { Section } from "../../components/Section";
import { StackedBar } from "../../components/StackedBar";
import { calculate, type VendingInput } from "./calc";

const dayValue = (value: number, days: number) => (days > 0 ? value / days : 0);

const paybackText = (months: number, investment: number) => {
  if (investment <= 0) return "—";
  if (!Number.isFinite(months)) return "nunca";
  const m = Math.ceil(months);
  return m < 12 ? `${m} meses` : `${m} meses (${(m / 12).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} anos)`;
};

const perDay = (units: number, days: number) =>
  (days > 0 ? units / days : 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

const defaults: VendingInput & { daysOpen: number } = {
  buyPrice: 8,
  sellPrice: 15,
  units: 720,
  taxPct: 4,
  mallSharePct: 10,
  rent: 3500,
  accounting: 300,
  otherCosts: 250,
  initialInvestment: 0,
  daysOpen: 30,
};

export const Vending = () => {
  const [input, setInput] = useState(defaults);
  const r = calculate(input);
  const fields = { value: input, onChange: setInput };
  const profit = r.net >= 0;
  // Whole packages: what you actually have to sell to break even.
  const breakEvenUnits = Math.ceil(r.breakEvenUnits);

  return (
    <main className="layout">
      <h1>Calculadora Vending Machine</h1>
      <div className="inputs">
        <Section title="📦 Produto">
          <NumberFields
            {...fields}
            fields={[
              { key: "buyPrice", label: "Compra (R$/pct)" },
              { key: "sellPrice", label: "Venda (R$/pct)" },
              { key: "units", label: "Pacotes/mês" },
              { key: "daysOpen", label: "Dias abertos/mês" },
            ]}
          />
        </Section>
        <Section title="％ Percentuais">
          <NumberFields
            {...fields}
            fields={[
              { key: "taxPct", label: "Imposto (% faturamento)" },
              { key: "mallSharePct", label: "Shopping (% lucro bruto)" },
            ]}
          />
        </Section>
        <Section title="💰 Investimento">
          <NumberFields
            {...fields}
            fields={[{ key: "initialInvestment", label: "Investimento inicial (R$)" }]}
          />
          <p className="muted small">Máquina, instalação, estoque inicial, etc.</p>
        </Section>
        <Section title="🏠 Custos fixos/mês">
          <NumberFields
            {...fields}
            fields={[
              { key: "rent", label: "Aluguel" },
              { key: "accounting", label: "Contabilidade" },
              { key: "otherCosts", label: "Combustível, etc" },
            ]}
          />
        </Section>
      </div>

      <Section title="Resultado do mês">
        <div className={`hero ${profit ? "pos" : "neg"}`}>
          {profit ? "✅ Lucro" : "⚠️ Prejuízo"} <strong>{brl(r.net)}</strong>
        </div>
        <div className="kpis">
          <div className={`kpi ${Number.isFinite(r.paybackMonths) ? "" : "neg"}`}>
            <div className="kpi-label">Retorno do investimento</div>
            <strong className="kpi-value">{paybackText(r.paybackMonths, input.initialInvestment)}</strong>
            <div className="kpi-sub">
              {input.initialInvestment > 0 ? `para recuperar ${brl(input.initialInvestment)}` : "informe o investimento inicial"}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Margem de lucro</div>
            <strong className="kpi-value">
              {(r.revenue > 0 ? (r.net / r.revenue) * 100 : 0).toLocaleString("pt-BR", {
                maximumFractionDigits: 1,
              })}
              %
            </strong>
            <div className="kpi-sub">do faturamento</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Sobra por pacote</div>
            <strong className="kpi-value">{brl(r.unitMargin)}</strong>
          </div>
          <div className="kpi">
            <div className="kpi-label">Empata com</div>
            <strong className="kpi-value">
              {Number.isFinite(r.breakEvenUnits)
                ? `${breakEvenUnits} pct/mês`
                : "nunca"}
            </strong>
            {Number.isFinite(r.breakEvenUnits) && (
              <>
                <div className="kpi-sub">{perDay(breakEvenUnits, input.daysOpen)} pct/dia</div>
                <div className="kpi-sub">
                  Venda bruta {brl(breakEvenUnits * input.sellPrice)}/mês · {brl(dayValue(breakEvenUnits * input.sellPrice, input.daysOpen))}/dia
                </div>
              </>
            )}
          </div>
          <div className="kpi">
            <div className="kpi-label">Vende hoje</div>
            <strong className="kpi-value">{input.units} pct/mês</strong>
            <div className="kpi-sub">{perDay(input.units, input.daysOpen)} pct/dia</div>
            <div className="kpi-sub">
              Venda bruta {brl(r.revenue)}/mês · {brl(dayValue(r.revenue, input.daysOpen))}/dia
            </div>
          </div>
        </div>
      </Section>

      <Section title="Para onde vai o faturamento">
        <StackedBar
          total={Math.max(r.revenue, r.revenue - r.net)}
          segments={[
            { label: "Mercadoria", value: r.cost, color: "#2a78d6" },
            { label: "Imposto", value: r.tax, color: "#eb6834" },
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

      <Section title="Passo a passo">
        <MoneyTable
          rows={[
            ["Faturamento", r.revenue, true],
            ["− Mercadoria", -r.cost],
            ["= Lucro bruto", r.grossProfit, true],
            ["− Imposto", -r.tax],
            ["− Shopping", -r.mallShare],
            ["− Custos fixos", -r.fixedCosts],
            ["= Lucro líquido", r.net, true],
          ]}
        />
      </Section>
    </main>
  );
};
