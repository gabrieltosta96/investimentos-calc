import { useState } from "react";
import { MoneyTable } from "../../components/MoneyTable";
import { brl } from "../../format";
import { NumberFields } from "../../components/NumberFields";
import { Section } from "../../components/Section";
import { StackedBar } from "../../components/StackedBar";
import { calculate, type VendingInput } from "./calc";

const perDay = (value: number, days: number) => (days > 0 ? value / days : 0);
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
  const slack = input.units - breakEvenUnits;

  return (
    <main className="layout">
      <h1>Calculadora Vending Machine</h1>
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
            <div className="kpi-sub">margem de {fmt(r.revenue > 0 ? (r.net / r.revenue) * 100 : 0)}% do faturamento</div>
          </div>
          <div className={`kpi ${Number.isFinite(r.paybackMonths) ? "" : "neg"}`}>
            <div className="kpi-label">Retorno do investimento</div>
            <div className="kpi-value">{paybackText(r.paybackMonths, input.initialInvestment)}</div>
            <div className="kpi-sub">
              {input.initialInvestment > 0 ? `para recuperar ${brl(input.initialInvestment)}` : "informe o investimento inicial"}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Sobra por pacote</div>
            <div className="kpi-value">{brl(r.unitMargin)}</div>
            <div className="kpi-sub">depois de mercadoria, imposto e shopping</div>
          </div>
          <div className={`kpi ${slack >= 0 ? "" : "neg"}`}>
            <div className="kpi-label">Folga sobre o empate</div>
            <div className="kpi-value">{Number.isFinite(slack) ? `${slack} pct/mês` : "—"}</div>
            <div className="kpi-sub">{Number.isFinite(slack) ? `${fmt(perDay(slack, input.daysOpen))} pct/dia` : "nunca empata"}</div>
          </div>
        </div>
      </Section>

      <Section title="Meta de vendas">
        {Number.isFinite(r.breakEvenUnits) ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col"></th>
                  <th scope="col">Para empatar (lucro zero)</th>
                  <th scope="col">Hoje</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Pacotes/mês</th>
                  <td>{breakEvenUnits}</td>
                  <td>{input.units}</td>
                </tr>
                <tr>
                  <th scope="row">Pacotes/dia</th>
                  <td>{fmt(perDay(breakEvenUnits, input.daysOpen))}</td>
                  <td>{fmt(perDay(input.units, input.daysOpen))}</td>
                </tr>
                <tr>
                  <th scope="row">Venda bruta/mês</th>
                  <td>{brl(breakEvenUnits * input.sellPrice)}</td>
                  <td>{brl(r.revenue)}</td>
                </tr>
                <tr>
                  <th scope="row">Venda bruta/dia</th>
                  <td>{brl(perDay(breakEvenUnits * input.sellPrice, input.daysOpen))}</td>
                  <td>{brl(perDay(r.revenue, input.daysOpen))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="alert alert-warn">Cada pacote vendido dá prejuízo: não existe volume que empate. Revise preço de compra/venda.</p>
        )}
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
