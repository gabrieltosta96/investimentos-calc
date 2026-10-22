type NumberFieldsProps<T extends Record<string, number>> = {
  fields: { key: keyof T & string; label: string; unit?: string }[];
  value: T;
  onChange: (value: T) => void;
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
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={value[key]}
          onChange={(e) => onChange({ ...value, [key]: Math.max(0, e.target.valueAsNumber || 0) })}
        />
      </label>
    ))}
  </div>
);
