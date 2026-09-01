// Shared reporting date ranges. Every report and register offers the same
// preset list so "This Year" means the same thing everywhere.
const pad2 = n => String(n).padStart(2, "0");
const firstOf = (y, m) => `${y}-${pad2(m + 1)}-01`;
const lastOf = (y, m) => `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`;

export const RANGE_PRESETS = [
  ["thisMonth", "This Month"], ["lastMonth", "Last Month"],
  ["thisQuarter", "This Quarter"], ["lastQuarter", "Last Quarter"],
  ["thisYear", "This Year"], ["lastYear", "Last Year"],
  ["range", "Range…"], ["all", "All Time"],
];

// → [from, to] as ISO dates; ["",""] means unbounded (All Time).
export function rangeFor(preset, custom) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  switch (preset) {
    case "thisMonth": return [firstOf(y, m), lastOf(y, m)];
    case "lastMonth": return m === 0 ? [firstOf(y - 1, 11), lastOf(y - 1, 11)] : [firstOf(y, m - 1), lastOf(y, m - 1)];
    case "thisQuarter": { const q = Math.floor(m / 3) * 3; return [firstOf(y, q), lastOf(y, q + 2)]; }
    case "lastQuarter": {
      const q = Math.floor(m / 3) * 3 - 3;
      return q < 0 ? [firstOf(y - 1, 9), lastOf(y - 1, 11)] : [firstOf(y, q), lastOf(y, q + 2)];
    }
    case "thisYear": return [`${y}-01-01`, `${y}-12-31`];
    case "lastYear": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case "range": return [custom?.from || "", custom?.to || ""];
    default: return ["", ""];   // all
  }
}

export const defaultCustom = () => {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: new Date().toISOString().slice(0, 10) };
};
