import { useState } from "react";
import { money, fmtDate, todayISO, nameOf } from "../lib/helpers.js";
import { AUTO_NUMBER } from "../lib/store.js";
import { Modal, Field, Badge } from "./ui.jsx";

// Bill selected line items of a sales order onto one invoice, optionally with
// logged time as T&M lines. Un-invoiced lines are selectable; already-billed
// lines show greyed. When onlyReady is set (invoicing from a task), only the
// ready-and-un-invoiced lines are pre-checked. PO comes from the SO. The invoice
// number defaults to auto — type over it to override.
export default function InvoiceFromSOModal({ so, db, onClose, onGenerate, onlyReady }) {
  const [sel, setSel] = useState(() => Object.fromEntries((so.lineItems || []).map(li =>
    [li.id, !li.invoiced && (onlyReady ? !!li.ready : true)])));
  const jobTime = (db.timeEntries || []).filter(t => t.salesOrderId === so.id && !t.invoiceId && t.approved);
  const pendingTime = (db.timeEntries || []).filter(t => t.salesOrderId === so.id && !t.invoiceId && !t.approved).length;
  const [selTime, setSelTime] = useState(() => Object.fromEntries(jobTime.map(t => [t.id, true])));
  const [date, setDate] = useState(todayISO());
  const [number, setNumber] = useState(AUTO_NUMBER);
  const [saving, setSaving] = useState(false);
  const catName = id => (db.timeCategories || []).find(c => c.id === id)?.name || "Labor";

  const billable = (so.lineItems || []).filter(li => !li.invoiced);
  const chosen = (so.lineItems || []).filter(li => !li.invoiced && sel[li.id]);
  const chosenTime = jobTime.filter(t => selTime[t.id]);
  const subLines = chosen.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0);
  const subTime = chosenTime.reduce((s, t) => s + (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
  const subtotal = subLines + subTime;
  const tax = subtotal * (Number(so.taxRate) || 0) / 100;

  const submit = async (print) => {
    setSaving(true);
    const inv = await onGenerate(chosen.map(li => li.id), { number, date, timeEntryIds: chosenTime.map(t => t.id) }, print);
    setSaving(false);
    if (inv) onClose();
  };
  const nothing = chosen.length === 0 && chosenTime.length === 0;

  return <Modal wide title={"Invoice from " + so.number} onClose={onClose}
    foot={<>
      <div className="subtle" style={{ marginRight: "auto", alignSelf: "center" }}>
        {(chosen.length || chosenTime.length) ? `${money(subtotal + tax)} on this invoice` : "Select what to invoice"}
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
      <tbody>{(so.lineItems || []).map(li => {
        const amt = (Number(li.qty) || 0) * (Number(li.unitPrice) || 0);
        const done = li.invoiced;
        return <tr key={li.id} style={done ? { opacity: 0.5 } : (sel[li.id] ? {} : { opacity: 0.6 })}>
          <td>{done
            ? <span title="Already invoiced">✓</span>
            : <input type="checkbox" checked={!!sel[li.id]} onChange={e => setSel(p => ({ ...p, [li.id]: e.target.checked }))} />}</td>
          <td>{li.desc}</td>
          <td className="num mono">{li.qty}</td>
          <td className="subtle">{li.unit}</td>
          <td className="num mono">{money(li.unitPrice)}</td>
          <td className="num mono">{money(amt)}</td>
          <td>{done ? <Badge status="invoiced" /> : li.ready ? <Badge status="fulfilled" /> : null}</td>
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

    <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--canvas)", borderRadius: 9, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="subtle">This invoice{Number(so.taxRate) ? ` (incl. ${so.taxRate}% tax)` : ""}</span>
      <span className="mono" style={{ fontWeight: 700, fontSize: 18 }}>{money(subtotal + tax)}</span>
    </div>
  </Modal>;
}
