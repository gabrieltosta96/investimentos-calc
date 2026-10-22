import { brl } from "../format";

export type Segment = { label: string; value: number; color: string };

// Bar is 100% of `total`; legend shows value and share of total.
export const StackedBar = ({ segments, total }: { segments: Segment[]; total: number }) => {
  const visible = segments.filter((s) => s.value > 0);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <>
      <div className="bar">
        {visible.map((s) => (
          <div
            key={s.label}
            style={{ width: `${pct(s.value)}%`, background: s.color }}
            title={`${s.label}: ${brl(s.value)} (${pct(s.value).toFixed(1)}%)`}
          />
        ))}
      </div>
      <ul className="bar-legend">
        {visible.map((s) => (
          <li key={s.label}>
            <span className="bar-swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span>{brl(s.value)}</span>
            <span className="muted">{pct(s.value).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </>
  );
};
