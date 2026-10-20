import { money } from "../lib/helpers.js";

// A price reduction on a proposal — a duplicate machine — as a dollar amount
// or a percentage off (specs.reduction; priced by reductionOf() in
// calc/proposals.js and priceEstimate() in calc/estimates.js). Blank or 0 is none.
export default function ReductionRow({ reduction, amount, onChange }) {
  const red = reduction || { type: "amt", value: "" };
  return <div className="cat-row" style={{ gap: 8, flexWrap: "wrap" }}>
    <span>{(red.label || "").trim() || "Duplicate Machine Reduction"}</span>
    <select className="select" style={{ width: 90, flex: "none" }} value={red.type || "amt"} onChange={e => onChange({ ...red, type: e.target.value })}>
      <option value="amt">$ off</option><option value="pct">% off</option>
    </select>
    <input className="input mono" type="number" min="0" step="any" style={{ width: 110, textAlign: "right" }} placeholder="0"
      value={red.value ?? ""} onChange={e => onChange({ ...red, value: e.target.value })} />
    <span className="mono" style={{ marginLeft: "auto", color: amount > 0 ? "var(--pos)" : undefined }}>{amount > 0 ? "−" + money(amount) : "—"}</span>
  </div>;
}
