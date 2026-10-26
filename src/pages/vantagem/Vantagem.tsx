import { usePersistedState } from "../../usePersistedState";
import { brl } from "../../format";
import { NumberInput } from "../../components/NumberFields";

type Item = { qty: number; price: number };

const empty: Item = { qty: 0, price: 0 };
const letter = (i: number) => String.fromCharCode(65 + i);
const pctText = (fraction: number) => `${(fraction * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const qtyText = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export const Vantagem = () => {
  const [items, setItems] = usePersistedState<Item[]>("vantagem.items", [empty, empty]);
  const update = (i: number, patch: Partial<Item>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const unitPrices = items.map((it) => (it.qty > 0 && it.price > 0 ? it.price / it.qty : Infinity));
  const valid = unitPrices.filter(Number.isFinite);
  const best = Math.min(...unitPrices);
  const bestIndex = unitPrices.indexOf(best);
  const tie = valid.length > 1 && valid.every((p) => Math.abs(p - best) < 1e-9);
  // Unit prices like R$ 0,033/ml read badly; show per 100 ml when quantities are in the hundreds.
  const minQty = Math.min(...items.filter((it) => it.qty > 0).map((it) => it.qty));
  const per = Number.isFinite(minQty) ? Math.max(1, 10 ** Math.floor(Math.log10(minQty))) : 1;

  return (
    <main className="layout vantagem">
      <h1>Qual vale mais a pena?</h1>
      <p className="muted small">Use a mesma unidade em todas as opções (ml, g, unidades…).</p>

      {items.map((it, i) => {
        const isBest = valid.length > 1 && !tie && i === bestIndex;
        const unit = unitPrices[i];
        return (
          <section key={i} className={`card option ${isBest ? "best" : ""}`}>
            <div className="card-head">
              <h2>
                Opção {letter(i)} {isBest && <span className="badge badge-ok">🏆 Mais vantajosa</span>}
              </h2>
              {items.length > 2 && (
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  Remover
                </button>
              )}
            </div>
            <div className="option-fields">
              <label>
                Quantidade
                <NumberInput value={it.qty} onChange={(qty) => update(i, { qty })} />
              </label>
              <label>
                Preço (R$)
                <NumberInput value={it.price} onChange={(price) => update(i, { price })} />
              </label>
            </div>
            {Number.isFinite(unit) && (
              <p className="small">
                {brl(unit * per)} a cada {qtyText(per)}
                {valid.length > 1 && !tie && !isBest && (
                  <span className="neg"> · {pctText(unit / best - 1)} mais caro</span>
                )}
              </p>
            )}
          </section>
        );
      })}

      <button type="button" className="btn" onClick={() => setItems([...items, empty])}>
        + Adicionar opção
      </button>

      {valid.length > 1 && (
        <section className="card verdict pos" aria-live="polite">
          {tie ? (
            <p>Empate: todas saem pelo mesmo preço.</p>
          ) : (
            <p>
              <strong>Opção {letter(bestIndex)}</strong> é a mais vantajosa. Na quantidade dela ({qtyText(items[bestIndex].qty)}),
              as outras custariam:{" "}
              {unitPrices
                .map((u, i) => [i, u] as const)
                .filter(([i, u]) => i !== bestIndex && Number.isFinite(u))
                .map(([i, u]) => `${letter(i)} ${brl(u * items[bestIndex].qty)}`)
                .join(" · ")}{" "}
              (vs {brl(items[bestIndex].price)}).
            </p>
          )}
        </section>
      )}

      <button type="button" className="btn btn-ghost" onClick={() => setItems([empty, empty])}>
        Limpar
      </button>
    </main>
  );
};
