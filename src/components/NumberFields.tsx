import { useState } from "react";

type NumberFieldsProps<T extends Record<string, number>> = {
  fields: { key: keyof T & string; label: string; unit?: string }[];
  value: T;
  onChange: (value: T) => void;
};

const display = (n: number) => (n ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "");
// pt-BR typing: "30.000,5" -> 30000.5; "8.5" (dot + 1-2 digits) is a decimal too; empty/invalid -> 0.
const parse = (s: string) => {
  const normalized = /^\d+\.\d{1,2}$/.test(s.trim()) ? s.trim() : s.replace(/\./g, "").replace(",", ".");
  return Math.max(0, Number(normalized) || 0);
};

// Free text while focused (can clear, type commas); formatted pt-BR when not.
const NumberInput = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="0"
      value={draft ?? display(value)}
      onFocus={(e) => {
        setDraft(display(value));
        e.target.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parse(e.target.value));
      }}
      onBlur={() => setDraft(null)}
    />
  );
};

// One row per field: label (+ unit) on the left, input on the right, so inputs line up.
export const NumberFields = <T extends Record<string, number>>({
  fields,
  value,
  onChange,
}: NumberFieldsProps<T>) => (
  <div className="num-rows">
    {fields.map(({ key, label, unit }) => (
      <label key={key} className="num-row">
        <span>
          {label}
          {unit && <span className="muted small unit">{unit}</span>}
        </span>
        <NumberInput value={value[key]} onChange={(n) => onChange({ ...value, [key]: n })} />
      </label>
    ))}
  </div>
);
