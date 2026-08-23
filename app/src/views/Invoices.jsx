import { useState } from "react";
import { uid, money, fmtDate, todayISO, addDays, nameOf } from "../lib/helpers.js";
import { lineTotals, balance, invoiceStatus } from "../calc/ledger.js";
import { AUTO_NUMBER } from "../lib/store.js";
import { Ico, ICONS, Badge, Empty, Field, Modal } from "../components/ui.jsx";
import PaymentModal from "../components/PaymentModal.jsx";
import LineItemsEditor from "../components/LineItemsEditor.jsx";
import EmailModal from "../components/EmailModal.jsx";
import InvoiceFromSOModal from "../components/InvoiceFromSOModal.jsx";
import Attachments from "../components/Attachments.jsx";
import { invoicePdf } from "../lib/invoicePdf.js";

export default function InvoicesView({ db, actions, toast, openDoc, readOnly }) {
  const [pay, setPay] = useState(null);
  const [edit, setEdit] = useState(null);
  const [email, setEmail] = useState(null);
  const [pickSO, setPickSO] = useState(false);   // choose an SO to invoice from
  const [invoiceSO, setInvoiceSO] = useState(null);
  const [unprintedOnly, setUnprintedOnly] = useState(false);
  const customers = db.contacts.filter(c => c.type === "customer");
  const openSOs = db.salesOrders.filter(s => s.status === "open");
  const del = async (id) => { if (!confirm("Delete this invoice?")) return; if (await actions.deleteInvoice(id)) toast("Deleted"); };
  const generateFromSO = async (so, ids, opts, print) => {
    const inv = await actions.generateInvoice(so, ids, opts);
    if (inv) { toast("Invoice " + inv.number + " generated"); if (print) openDoc("invoice", inv); }
    return inv;
  };

  const startNew = () => {
    // Standalone invoice — no quote or SO behind it (time & materials, service
    // calls). The number defaults to auto (customer code + date + index) but can
    // be overridden per-invoice in the editor.
    setEdit({
      id: uid(), number: AUTO_NUMBER, _new: true, salesOrderId: "", quoteId: "", customerId: customers[0]?.id || "",
      poNumber: "", date: todayISO(), dueDate: addDays(todayISO(), db.settings.terms),
      lineItems: [{ id: uid(), desc: "", qty: 1, unit: "", unitPrice: 0 }], taxRate: db.settings.taxRate, notes: "", payments: []
    });
  };
  const save = async (inv) => {
    const saved = await actions.saveInvoice(inv);
    if (saved) { setEdit(null); toast(inv._new ? "Invoice created" : "Invoice saved"); }
  };

  if (edit) return <InvoiceEditor invoice={edit} customers={customers} catalog={db.catalog} onCancel={() => setEdit(null)} onSave={save} db={db} actions={actions} toast={toast} readOnly={readOnly} />;

  const unprintedCount = db.invoices.filter(i => !i.printed).length;
  const rows = db.invoices.slice().reverse().filter(i => !unprintedOnly || !i.printed);

  return <div>
    <div className="toolbar">
      <button className={"btn" + (unprintedOnly ? " primary" : "")} onClick={() => setUnprintedOnly(v => !v)}
        title="Invoices you haven't printed yet">
        <Ico d={ICONS.print} size={14} />{unprintedOnly ? "Showing unprinted" : `Unprinted${unprintedCount ? " · " + unprintedCount : ""}`}</button>
      {!readOnly && <>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setPickSO(true)} disabled={openSOs.length === 0}
          title={openSOs.length === 0 ? "No open sales orders" : "Bill selected lines from a sales order"}>
          <Ico d={ICONS.so} size={15} />Invoice from Sales Order</button>
        <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Invoice</button>
      </>}
    </div>
    <div className="card">
      {db.invoices.length === 0
        ? <Empty icon={ICONS.inv} title="No invoices" msg="Generate an invoice from a sales order, or create a standalone one for service and T&M work. Record payments to update its status."
          action={<button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Invoice</button>} />
        : <table><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th><th></th></tr></thead>
          <tbody>{rows.map(inv => {
            const st = invoiceStatus(inv);
            return <tr key={inv.id}>
              <td className="doc-id">{inv.number}</td>
              <td>{nameOf(db, inv.customerId)}</td>
              <td className="subtle">{fmtDate(inv.date)}</td>
              <td className="subtle">{fmtDate(inv.dueDate)}</td>
              <td><Badge status={st} />{!inv.printed && <span className="badge amber" style={{ marginLeft: 6 }} title="Not printed yet"><span className="dot"></span>Unprinted</span>}</td>
              <td className="num">{money(lineTotals(inv.lineItems, inv.taxRate).total)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(balance(inv))}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && st !== "paid" && <button className="btn sm" onClick={() => setPay(inv)}><Ico d={ICONS.money} size={14} />Payment</button>}
                <button className="btn ghost icon" title="Email invoice" onClick={() => setEmail(inv)}><Ico d={ICONS.mail} size={16} /></button>
                <button className="btn ghost icon" title="Print" onClick={() => openDoc("invoice", inv)}><Ico d={ICONS.print} size={16} /></button>
                {!readOnly && <button className="btn ghost icon" title="Edit" onClick={() => setEdit({ ...inv })}><Ico d={ICONS.edit} size={16} /></button>}
                {!readOnly && <button className="btn ghost icon" onClick={() => del(inv.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {pickSO && <Modal title="Invoice from Sales Order" onClose={() => setPickSO(false)}
      foot={<button className="btn" onClick={() => setPickSO(false)}>Cancel</button>}>
      <p className="subtle" style={{ marginTop: 0 }}>Pick an open sales order, then choose which line items to bill. The PO carries over automatically.</p>
      {openSOs.length === 0
        ? <p className="subtle">No open sales orders.</p>
        : openSOs.slice().reverse().map(so => {
          const openLines = (so.lineItems || []).filter(li => !li.invoiced);
          return <div key={so.id} className="cat-row">
            <span className="doc-id">{so.number}</span>
            <span>{nameOf(db, so.customerId)}</span>
            <span className="mono subtle">PO {so.poNumber || "—"}</span>
            <span className="mono subtle" style={{ marginLeft: "auto" }}>{money(lineTotals(openLines, so.taxRate).total)} open</span>
            <button className="btn sm primary" onClick={() => { setInvoiceSO(so); setPickSO(false); }}>Select</button>
          </div>;
        })}
    </Modal>}
    {invoiceSO && <InvoiceFromSOModal so={invoiceSO} db={db} onClose={() => setInvoiceSO(null)}
      onGenerate={(ids, opts, print) => generateFromSO(invoiceSO, ids, opts, print)}
      onCloseLine={async (lineId, closed) => { if (await actions.setLineClosed(invoiceSO.id, lineId, closed)) toast(closed ? "Line closed" : "Line reopened"); }} />}
    {email && <EmailModal
      title={"Email · " + email.number}
      defaultTo={db.contactPeople.find(p => p.id === email.contactPersonId)?.email || db.contacts.find(c => c.id === email.customerId)?.email || ""}
      defaultSubject={`Invoice ${email.number} — ${db.settings.company}`}
      defaultBody={`Please find attached invoice ${email.number}.\n\nThank you for your business.\n\n${db.settings.company}\n${db.settings.companyPhone || ""}`}
      buildAttachment={() => invoicePdf(email, db)}
      onClose={() => setEmail(null)} toast={toast} />}
    {pay && <PaymentModal doc={pay} onClose={() => setPay(null)}
      onSave={async (p) => {
        if (await actions.recordPayment("invoice", pay.id, p)) { setPay(null); toast("Payment recorded"); }
      }}
      onDelete={async (pid) => {
        if (await actions.deletePayment("invoice", pay.id, pid)) {
          setPay(prev => ({ ...prev, payments: (prev.payments || []).filter(x => x.id !== pid) }));
          toast("Payment deleted");
        }
      }} />}
  </div>;
}

function InvoiceEditor({ invoice, customers, catalog, onCancel, onSave, db, actions, toast, readOnly }) {
  const [inv, setInv] = useState(invoice);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setInv(p => ({ ...p, [k]: v }));
  const save = async () => { setSaving(true); await onSave(inv); setSaving(false); };
  return <div>
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{inv._new ? "New Invoice" : "Edit " + inv.number} <span className="mono subtle" style={{ fontSize: 14 }}>{inv.number}</span></h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Invoice"}</button>
      </div>
    </div>
    <div className="card"><div className="card-body">
      <div className="row">
        <Field label="Customer"><select className="select" value={inv.customerId} onChange={e => set("customerId", e.target.value)}>
          <option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        {inv._new
          ? <Field label="Invoice #" hint="Leave as (auto) to use the generated number"><input className="input mono" value={inv.number} onChange={e => set("number", e.target.value)} /></Field>
          : <Field label="Invoice #"><input className="input mono" value={inv.number} disabled /></Field>}
        <Field label="Invoice Date"><input className="input" type="date" value={inv.date} onChange={e => set("date", e.target.value)} /></Field>
        <Field label="Due Date"><input className="input" type="date" value={inv.dueDate} onChange={e => set("dueDate", e.target.value)} /></Field>
        <Field label="Customer PO #"><input className="input mono" value={inv.poNumber || ""} onChange={e => set("poNumber", e.target.value)} /></Field>
      </div>
      <div className="divider"></div>
      <LineItemsEditor items={inv.lineItems} setItems={v => set("lineItems", v)} taxRate={inv.taxRate} setTaxRate={v => set("taxRate", v)} catalog={catalog} />
      <div className="divider"></div>
      <Field label="Notes (printed on invoice)" hint="Leave blank to use the default from Settings"><textarea className="input" value={inv.notes || ""} onChange={e => set("notes", e.target.value)} /></Field>
      {inv._new
        ? <p className="subtle" style={{ margin: "8px 0 0" }}>Save the invoice first to attach files (signed POs, etc.).</p>
        : <><div className="divider"></div><Attachments db={db} actions={actions} toast={toast} parentType="invoice" parentId={inv.id} readOnly={readOnly} /></>}
    </div></div>
  </div>;
}
