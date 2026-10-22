import { brl } from "../format";

// Third item = subtotal row (bold).
export const MoneyTable = ({ rows }: { rows: [string, number, boolean?][] }) => (
  <div className="table-wrap">
    <table className="data">
      <tbody>
        {rows.map(([label, value, total]) => (
          <tr key={label}>
            <th scope="row">{total ? <strong>{label}</strong> : label}</th>
            <td className={value < 0 ? "neg" : undefined}>{total ? <strong>{brl(value)}</strong> : brl(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
