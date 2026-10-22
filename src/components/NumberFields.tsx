type NumberFieldsProps<T extends Record<string, number>> = {
  fields: { key: keyof T & string; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

export const NumberFields = <T extends Record<string, number>>({
  fields,
  value,
  onChange,
}: NumberFieldsProps<T>) => (
  <div className="grid-2">
    {fields.map(({ key, label }) => (
      <label key={key} className="field">
        {label}
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={value[key]}
          onChange={(e) => onChange({ ...value, [key]: e.target.valueAsNumber || 0 })}
        />
      </label>
    ))}
  </div>
);
