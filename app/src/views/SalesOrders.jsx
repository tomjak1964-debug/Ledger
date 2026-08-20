import { useState } from "react";
import { uid, money, fmtDate, todayISO, nameOf } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { AUTO_NUMBER } from "../lib/store.js";
import { Ico, ICONS, Badge, Empty, Field } from "../components/ui.jsx";
import LineItemsEditor from "../components/LineItemsEditor.jsx";
import InvoiceFromSOModal from "../components/InvoiceFromSOModal.jsx";

export default function SalesOrdersView({ db, actions, toast, openDoc, readOnly }) {
  const [invoiceSO, setInvoiceSO] = useState(null);
  const [edit, setEdit] = useState(null);
  const customers = db.contacts.filter(c => c.type === "customer");

  const del = async (id) => { if (!confirm("Delete this sales order?")) return; if (await actions.deleteSO(id)) toast("Deleted"); };
  const reopen = async (so) => {
    if (!confirm(`Reopen ${so.number} for invoicing? Its prior invoice no longer exists.`)) return;
    if (await actions.reopenSO(so.id)) toast(so.number + " reopened");
  };
  const generate = async (so, ids, opts) => {
    const inv = await actions.generateInvoice(so, ids, opts);
    if (inv) { toast("Invoice " + inv.number + " generated"); openDoc("invoice", inv); }
    return inv;
  };
  const save = async (so) => {
    const saved = await actions.saveSalesOrder(so);
    if (saved) { setEdit(null); toast(so._new ? "Sales order " + saved.number + " created" : "Sales order saved"); }
  };
  // New or copied SO. A copy carries the customer, tax rate, and line items —
  // but gets a fresh number (auto) and a blank PO (a copy is a new order).
  const blankSO = (from) => ({
    id: uid(), _new: true, number: AUTO_NUMBER, quoteId: "",
    customerId: from?.customerId || customers[0]?.id || "", poNumber: "",
    date: todayISO(), status: "open", taxRate: from ? from.taxRate : db.settings.taxRate,
    lineItems: from
      ? (from.lineItems || []).map(li => ({ id: uid(), desc: li.desc, qty: li.qty, unit: li.unit, unitPrice: li.unitPrice }))
      : [{ id: uid(), desc: "", qty: 1, unit: "", unitPrice: 0 }],
  });

  if (edit) return <SalesOrderEditor so={edit} customers={customers} catalog={db.catalog} onCancel={() => setEdit(null)} onSave={save} />;

  return <div>
    {!readOnly && <div className="toolbar">
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setEdit(blankSO())}><Ico d={ICONS.plus} size={15} />New Sales Order</button>
    </div>}
    <div className="card">
      {db.salesOrders.length === 0
        ? <Empty icon={ICONS.so} title="No sales orders" msg="Create one directly, or convert an accepted quote / won proposal. From an SO you pick which line items to invoice, so you can bill in phases."
          action={!readOnly && <button className="btn primary" onClick={() => setEdit(blankSO())}><Ico d={ICONS.plus} size={15} />New Sales Order</button>} />
        : <table><thead><tr><th>Order</th><th>Customer</th><th>PO #</th><th>From Quote</th><th>Date</th><th>Status</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{db.salesOrders.slice().reverse().map(so => {
            const q = db.quotes.find(x => x.id === so.quoteId);
            const lines = so.lineItems || [];
            const billed = lines.filter(li => li.invoiced);
            const openLines = lines.filter(li => !li.invoiced);
            const remaining = lineTotals(openLines, so.taxRate).total;
            const total = lineTotals(lines, so.taxRate).total;
            const invoiceExists = db.invoices.some(i => i.salesOrderId === so.id);
            const orphaned = so.status === "invoiced" && !invoiceExists;
            const badge = orphaned ? "open" : (so.status === "open" && billed.length ? "partial" : so.status);
            return <tr key={so.id}>
              <td className="doc-id">{so.number}</td>
              <td>{nameOf(db, so.customerId)}</td>
              <td className="mono subtle">{so.poNumber || "—"}</td>
              <td className="mono subtle">{q ? q.number : "—"}</td>
              <td className="subtle">{fmtDate(so.date)}</td>
              <td><Badge status={badge} />{so.status === "open" && billed.length > 0 &&
                <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>{money(remaining)} left to invoice</div>}</td>
              <td className="num">{money(total)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {(so.status === "open"
                  ? !readOnly && <button className="btn sm primary" onClick={() => setInvoiceSO(so)}><Ico d={ICONS.inv} size={14} />Invoice…</button>
                  : orphaned
                    ? !readOnly && <button className="btn sm" title="Prior invoice was deleted" onClick={() => reopen(so)}><Ico d={ICONS.refresh} size={14} />Reopen</button>
                    : <span className="subtle">Invoiced ✓</span>)}
                {!readOnly && <button className="btn ghost icon" onClick={() => setEdit({ ...so, lineItems: (so.lineItems || []).map(li => ({ ...li })) })} title="View / edit"><Ico d={ICONS.edit} size={15} /></button>}
                {!readOnly && <button className="btn ghost icon" onClick={() => setEdit(blankSO(so))} title="Copy to a new sales order"><Ico d={ICONS.copy} size={15} /></button>}
                {!readOnly && <button className="btn ghost icon" onClick={() => del(so.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {invoiceSO && <InvoiceFromSOModal so={invoiceSO} db={db} onClose={() => setInvoiceSO(null)}
      onGenerate={(ids, opts) => generate(invoiceSO, ids, opts)} />}
  </div>;
}

function SalesOrderEditor({ so, customers, catalog, onCancel, onSave }) {
  const [o, setO] = useState(so);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setO(p => ({ ...p, [k]: v }));
  const save = async () => { setSaving(true); await onSave(o); setSaving(false); };
  return <div>
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{o._new ? "New Sales Order" : "Edit " + o.number} <span className="mono subtle" style={{ fontSize: 14 }}>{o.number}</span></h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Sales Order"}</button>
      </div>
    </div>
    <div className="card"><div className="card-body">
      <div className="row">
        <Field label="Customer"><select className="select" value={o.customerId} onChange={e => set("customerId", e.target.value)}>
          <option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        {o._new
          ? <Field label="SO #" hint="Leave as (auto) for the next number"><input className="input mono" value={o.number} onChange={e => set("number", e.target.value)} /></Field>
          : <Field label="SO #"><input className="input mono" value={o.number} onChange={e => set("number", e.target.value)} /></Field>}
        <Field label="Customer PO #"><input className="input mono" value={o.poNumber || ""} onChange={e => set("poNumber", e.target.value)} /></Field>
        <Field label="Order Date"><input className="input" type="date" value={o.date} onChange={e => set("date", e.target.value)} /></Field>
      </div>
      <div className="divider"></div>
      {!o._new && (o.lineItems || []).some(li => li.invoiced) &&
        <p className="subtle" style={{ margin: "0 0 10px", color: "var(--warn)" }}>
          Some line items are already invoiced — editing them here won't change invoices that were already issued.
        </p>}
      <LineItemsEditor items={o.lineItems} setItems={v => set("lineItems", v)} taxRate={o.taxRate} setTaxRate={v => set("taxRate", v)} catalog={catalog} />
    </div></div>
  </div>;
}
