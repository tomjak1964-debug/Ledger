import { useState } from "react";
import { uid, money, fmtDate, todayISO, nameOf } from "../lib/helpers.js";
import { AUTO_NUMBER } from "../lib/store.js";
import { Modal, Field, Badge, Ico, ICONS } from "./ui.jsx";

// Bill selected line items of a sales order onto one invoice, optionally with
// logged time as T&M lines. Un-invoiced lines are selectable; already-billed
// lines show greyed. When onlyReady is set (invoicing from a task), only the
// ready-and-un-invoiced lines are pre-checked. PO comes from the SO. The invoice
// number defaults to auto — type over it to override.
export default function InvoiceFromSOModal({ so, db, onClose, onGenerate, onlyReady, onCloseLine }) {
  // Read lines live from the store so closing a line updates the modal.
  const lines = (db.salesOrders.find(s => s.id === so.id)?.lineItems) || so.lineItems || [];
  // Default everything unchecked — the user picks what to bill. (From a task,
  // pre-check the ready-and-un-invoiced lines as a convenience.)
  const [sel, setSel] = useState(() => Object.fromEntries(lines.map(li =>
    [li.id, !!(onlyReady && li.ready && !li.invoiced && !li.closed)])));
  const jobTime = (db.timeEntries || []).filter(t => t.salesOrderId === so.id && !t.invoiceId && t.approved);
  const pendingTime = (db.timeEntries || []).filter(t => t.salesOrderId === so.id && !t.invoiceId && !t.approved).length;
  const [selTime, setSelTime] = useState(() => Object.fromEntries(jobTime.map(t => [t.id, true])));
  const [date, setDate] = useState(todayISO());
  const [number, setNumber] = useState(AUTO_NUMBER);
  // Extra lines typed straight onto this invoice — freight, a change order, a
  // part that was never on the order. They bill here only; the sales order is
  // untouched by them.
  const [extras, setExtras] = useState([]);
  const [saving, setSaving] = useState(false);
  const catName = id => (db.timeCategories || []).find(c => c.id === id)?.name || "Labor";

  const billable = lines.filter(li => !li.invoiced && !li.closed);
  const chosen = lines.filter(li => !li.invoiced && !li.closed && sel[li.id]);
  const chosenTime = jobTime.filter(t => selTime[t.id]);
  const liveExtras = extras.filter(li => String(li.desc || "").trim() || Number(li.qty) || Number(li.unitPrice));
  const subLines = chosen.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
  const subTime = chosenTime.reduce((s, t) => s + (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
  const subExtra = liveExtras.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
  const subtotal = subLines + subTime + subExtra;
  const tax = subtotal * (Number(so.taxRate) || 0) / 100;

  const submit = async (print) => {
    setSaving(true);
    const inv = await onGenerate(chosen.map(li => li.id),
      { number, date, timeEntryIds: chosenTime.map(t => t.id), extraLines: liveExtras }, print);
    setSaving(false);
    if (inv) onClose();
  };
  const nothing = chosen.length === 0 && chosenTime.length === 0 && liveExtras.length === 0;

  return <Modal wide title={"Invoice from " + so.number} onClose={onClose}
    foot={<>
      <div className="subtle" style={{ marginRight: "auto", alignSelf: "center" }}>
        {(chosen.length || chosenTime.length || liveExtras.length) ? `${money(subtotal + tax)} on this invoice` : "Select what to invoice"}
      </div>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={saving || nothing} onClick={() => submit(false)} title="Create the invoice without opening print">
        {saving ? "Saving…" : "Generate"}
      </button>
      <button className="btn primary" disabled={saving || nothing} onClick={() => submit(true)}>Generate &amp; Print</button>
    </>}>
    <div className="row">
      <Field label="Customer"><input className="input" value={nameOf(db, so.customerId)} disabled /></Field>
      <Field label="Customer PO #" hint="From the sales order"><input className="input mono" value={so.poNumber || "—"} disabled /></Field>
      <Field label="Invoice Date"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Invoice #" hint="Leave as (auto) to use the generated number"><input className="input mono" value={number} onChange={e => setNumber(e.target.value)} /></Field>
    </div>

    <div className="divider"></div>
    <div className="subtle" style={{ fontWeight: 600, marginBottom: 6 }}>Line items</div>
    <table><thead><tr>
      <th style={{ width: 34 }}></th><th>Description</th><th className="num">Qty</th><th>Unit</th>
      <th className="num">Price</th><th className="num">Amount</th><th></th>
    </tr></thead>
      <tbody>{lines.map(li => {
        const amt = (Number(li.qty) || 0) * (Number(li.unitPrice) || 0);
        const done = li.invoiced, closed = li.closed;
        const inactive = done || closed;
        return <tr key={li.id} style={inactive ? { opacity: 0.5 } : (sel[li.id] ? {} : { opacity: 0.6 })}>
          <td>{done ? <span title="Already invoiced">✓</span>
            : closed ? <span title="Closed">—</span>
              : <input type="checkbox" checked={!!sel[li.id]} onChange={e => setSel(p => ({ ...p, [li.id]: e.target.checked }))} />}</td>
          <td>{li.desc}</td>
          <td className="num mono">{li.qty}</td>
          <td className="subtle">{li.unit}</td>
          <td className="num mono">{money(li.unitPrice)}</td>
          <td className="num mono">{money(amt)}</td>
          <td style={{ whiteSpace: "nowrap" }}>
            {done ? <Badge status="invoiced" /> : closed ? <Badge status="closed" /> : li.ready ? <Badge status="ready" /> : null}
            {!done && onCloseLine && <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => onCloseLine(li.id, !closed)}>{closed ? "Reopen" : "Close"}</button>}
          </td>
        </tr>;
      })}</tbody></table>
    {billable.length === 0 && <p className="subtle" style={{ margin: "8px 0 0" }}>Every line on this order has already been invoiced.</p>}

    {pendingTime > 0 && <p className="subtle" style={{ margin: "10px 0 0" }}>{pendingTime} time {pendingTime === 1 ? "entry is" : "entries are"} awaiting approval and can't be billed yet.</p>}
    {jobTime.length > 0 && <>
      <div className="divider"></div>
      <div className="subtle" style={{ fontWeight: 600, marginBottom: 6 }}>Unbilled time on this job (approved)</div>
      <table><thead><tr><th style={{ width: 34 }}></th><th>Date</th><th>Category</th><th>Description</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>{jobTime.map(t => <tr key={t.id} style={selTime[t.id] ? {} : { opacity: 0.6 }}>
          <td><input type="checkbox" checked={!!selTime[t.id]} onChange={e => setSelTime(p => ({ ...p, [t.id]: e.target.checked }))} /></td>
          <td className="subtle">{fmtDate(t.date)}</td>
          <td>{catName(t.categoryId)}</td>
          <td className="subtle">{t.description || "—"}</td>
          <td className="num mono">{t.hours}</td>
          <td className="num mono">{money(t.rate)}</td>
          <td className="num mono">{money((Number(t.hours) || 0) * (Number(t.rate) || 0))}</td>
        </tr>)}</tbody></table>
    </>}

    <div className="divider"></div>
    <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
      <span className="subtle" style={{ fontWeight: 600 }}>Additional lines on this invoice</span>
      <button className="btn sm" style={{ marginLeft: "auto" }}
        onClick={() => setExtras(x => [...x, { id: uid(), desc: "", qty: 1, unit: "", unitPrice: 0 }])}>
        <Ico d={ICONS.plus} size={13} />Add line</button>
      {db.catalog?.length > 0 && <select className="select sm" style={{ maxWidth: 240, padding: "5px 10px", fontSize: 12, marginLeft: 8 }} value=""
        onChange={e => { const c = db.catalog.find(x => x.id === e.target.value); if (c) setExtras(x => [...x, { id: uid(), desc: c.desc, qty: 1, unit: c.unit, unitPrice: c.unitPrice }]); }}>
        <option value="">+ From catalog…</option>
        {db.catalog.map(c => <option key={c.id} value={c.id}>{c.desc} — {money(c.unitPrice)}/{c.unit}</option>)}
      </select>}
    </div>
    {extras.length === 0
      ? <p className="subtle" style={{ margin: "0 0 4px" }}>Nothing extra. Add a line for freight, a change order, or a part that wasn't on the order — it bills on this invoice only and leaves {so.number} alone.</p>
      : <table className="li-table"><thead><tr>
        <th className="li-desc">Description</th><th style={{ width: 70 }}>Qty</th><th style={{ width: 70 }}>Unit</th>
        <th className="num" style={{ width: 110 }}>Unit Price</th><th className="num" style={{ width: 110 }}>Amount</th><th style={{ width: 34 }}></th>
      </tr></thead><tbody>
        {extras.map((li, i) => {
          const upd = (k, v) => setExtras(x => x.map((e, j) => j === i ? { ...e, [k]: v } : e));
          return <tr key={li.id}>
            <td><input className="input" value={li.desc} placeholder="Item or service…" onChange={e => upd("desc", e.target.value)} /></td>
            <td><input className="input mono" type="number" step="any" value={li.qty} onChange={e => upd("qty", e.target.value)} /></td>
            <td><input className="input" value={li.unit} placeholder="ea" onChange={e => upd("unit", e.target.value)} /></td>
            <td><input className="input mono" type="number" step="any" value={li.unitPrice} style={{ textAlign: "right" }} onChange={e => upd("unitPrice", e.target.value)} /></td>
            <td className="num mono">{money((Number(li.qty) || 0) * (Number(li.unitPrice) || 0))}</td>
            <td><button className="btn ghost icon" title="Remove" onClick={() => setExtras(x => x.filter((_, j) => j !== i))}><Ico d={ICONS.x} size={15} /></button></td>
          </tr>;
        })}
      </tbody></table>}

    <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--canvas)", borderRadius: 9, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="subtle">This invoice{Number(so.taxRate) ? ` (incl. ${so.taxRate}% tax)` : ""}</span>
      <span className="mono" style={{ fontWeight: 700, fontSize: 18 }}>{money(subtotal + tax)}</span>
    </div>
  </Modal>;
}
