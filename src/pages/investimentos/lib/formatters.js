const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const numFmt = (digits) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const brl = (v) => (Number.isFinite(v) ? brlFmt.format(v) : '—');
export const brlShort = (v) => (Number.isFinite(v) ? brlCompact.format(v) : '—');
export const signedBrl = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${brlFmt.format(v)}` : '—');

// Recebe decimal (0.1365) e exibe "13,65%".
export const pct = (v, digits = 2) => (Number.isFinite(v) ? `${numFmt(digits).format(v * 100)}%` : '—');
export const signedPct = (v, digits = 2) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${pct(v, digits)}` : '—');
export const number = (v, digits = 2) => (Number.isFinite(v) ? numFmt(digits).format(v) : '—');

export const date = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
export const dateTime = (isoTs) => {
  const d = new Date(isoTs);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
