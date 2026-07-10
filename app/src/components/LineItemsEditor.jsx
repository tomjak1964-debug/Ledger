import { uid, money } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { Ico, ICONS } from "./ui.jsx";

export default function LineItemsEditor({ items, setItems, taxRate, setTaxRate, catalog }) {
  const upd = (i, k, v) => { const c = items.slice(); c[i] = { ...c[i], [k]: v }; setItems(c); };
  const add = (item) => setItems([...items, item || { id: uid(), desc: "", qty: 1, unitPrice: 0, unit: "" }]);
  const del = i => setItems(items.filter((_, x) => x !== i));
  const t = lineTotals(items, taxRate);
  return <div>
    <table className="li-table"><thead><tr>
      <th className="li-desc">Description</th><th style={{ width: 70 }}>Qty</th><th style={{ width: 70 }}>Unit</th>
      <th className="num" style={{ width: 110 }}>Unit Price</th><th className="num" style={{ width: 110 }}>Amount</th><th style={{ width: 34 }}></th>
    </tr></thead><tbody>
      {items.map((it, i) => (
        <tr key={it.id || i}>
          <td><input className="input" value={it.desc} placeholder="Item or service…" onChange={e => upd(i, "desc", e.target.value)} /></td>
          <td><input className="input mono" type="number" step="any" value={it.qty} onChange={e => upd(i, "qty", e.target.value)} /></td>
          <td><input className="input" value={it.unit || ""} placeholder="ea" onChange={e => upd(i, "unit", e.target.value)} /></td>
          <td><input className="input mono" type="number" step="any" value={it.unitPrice} onChange={e => upd(i, "unitPrice", e.target.value)} style={{ textAlign: "right" }} /></td>
          <td className="num">{money((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</td>
          <td><button className="btn ghost icon" onClick={() => del(i)} title="Remove"><Ico d={ICONS.x} size={15} /></button></td>
        </tr>
      ))}
    </tbody></table>
    <div style={{ display: "flex", gap: 8, margin: "10px 0 4px", flexWrap: "wrap" }}>
      <button className="btn sm" onClick={() => add()}><Ico d={ICONS.plus} size={14} />Add line</button>
      {catalog && catalog.length > 0 &&
        <select className="select sm" style={{ maxWidth: 280, padding: "5px 10px", fontSize: 12 }} value="" onChange={e => {
          const c = catalog.find(x => x.id === e.target.value); if (c) add({ id: uid(), desc: c.desc, qty: 1, unit: c.unit, unitPrice: c.unitPrice });
        }}>
          <option value="">+ Add from catalog…</option>
          {catalog.map(c => <option key={c.id} value={c.id}>{c.desc} — {money(c.unitPrice)}/{c.unit}</option>)}
        </select>}
    </div>
    <div className="totals" style={{ marginTop: 14 }}>
      <div className="line"><span>Subtotal</span><span className="amt">{money(t.sub)}</span></div>
      <div className="line" style={{ alignItems: "center" }}>
        <span>Tax
          <input className="input mono" type="number" step="any" value={taxRate} onChange={e => setTaxRate(e.target.value)}
            style={{ width: 56, display: "inline-block", padding: "3px 6px", margin: "0 6px", textAlign: "right" }} />%
        </span>
        <span className="amt">{money(t.tax)}</span>
      </div>
      <div className="line grand"><span>Total</span><span className="amt">{money(t.total)}</span></div>
    </div>
  </div>;
}
