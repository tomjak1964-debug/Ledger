import { fmtDate } from "../lib/helpers.js";
import { RANGE_PRESETS } from "../lib/dateRanges.js";

// The one filter row used by every report and register: a date-range preset
// (with a custom Range…) plus an optional customer/vendor narrowing.
export default function FilterBar({
  preset, onPreset, custom, onCustom,
  partyKind, partyId, onParty, contacts,
  right, children,
}) {
  const parties = partyKind ? (contacts || []).filter(c => c.type === partyKind) : [];
  const label = partyKind === "vendor" ? "vendor" : "customer";
  return <div className="toolbar no-print">
    <select className="select" style={{ maxWidth: 165 }} value={preset} onChange={e => onPreset(e.target.value)}>
      {RANGE_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
    {preset === "range" && <>
      <input className="input" style={{ maxWidth: 155 }} type="date" value={custom.from}
        onChange={e => onCustom({ ...custom, from: e.target.value })} />
      <span className="subtle">to</span>
      <input className="input" style={{ maxWidth: 155 }} type="date" value={custom.to}
        onChange={e => onCustom({ ...custom, to: e.target.value })} />
    </>}
    {partyKind && <select className="select" style={{ maxWidth: 230 }} value={partyId} onChange={e => onParty(e.target.value)}>
      <option value="">All {label}s</option>
      {parties.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>}
    {children}
    {right && <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>{right}</span>}
  </div>;
}

// "Jan 1, 2026 – Aug 31, 2026" / "All time" — the line printed on every report.
export const rangeLabel = (from, to) =>
  (!from && !to) ? "All time" : `${from ? fmtDate(from) : "Beginning"} – ${to ? fmtDate(to) : fmtDate(new Date().toISOString().slice(0, 10))}`;
