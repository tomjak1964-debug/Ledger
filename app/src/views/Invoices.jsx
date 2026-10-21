import { useState, useEffect } from "react";
import { uid, money, fmtDate, todayISO, addDays, nameOf, pickable } from "../lib/helpers.js";
import { emailFor } from "../lib/people.js";
import { lineTotals, balance, invoiceStatus } from "../calc/ledger.js";
import { AUTO_NUMBER } from "../lib/store.js";
import { useFilters } from "../components/useFilters.jsx";
import { Ico, ICONS, Badge, Empty, Field, Modal, SortTh, useTableSort } from "../components/ui.jsx";
import PaymentModal from "../components/PaymentModal.jsx";
import { dueDateFor, termsLabelFor, discountOffer } from "../lib/terms.js";
import LineItemsEditor from "../components/LineItemsEditor.jsx";
import EmailModal from "../components/EmailModal.jsx";
import InvoiceFromSOModal from "../components/InvoiceFromSOModal.jsx";
import Attachments from "../components/Attachments.jsx";
import { invoicePdf, invoicesPdf } from "../lib/invoicePdf.js";
import PdfView from "../components/PdfView.jsx";
import { saveBlob } from "../lib/saveFile.js";
import AccountSelect from "../components/AccountSelect.jsx";
import { incomeAccountOf, accountLabel } from "../calc/accounts.js";

export default function InvoicesView({ db, actions, toast, openDoc, readOnly, editRequest, clearEditRequest }) {
  const [pay, setPay] = useState(null);
  // Save from the list: the invoice's PDF under its number, no viewer needed.
  const saveInvoice = async (inv) => {
    try { const { blob, filename } = await invoicePdf(inv, db); saveBlob(blob, filename); }
    catch (e) { toast("⚠ Couldn't make the PDF: " + (e.message || e)); }
  };
  const [edit, setEdit] = useState(null);
  // Edit from an open invoice document lands here.
  useEffect(() => {
    if (editRequest?.kind !== "invoice") return;
    const inv = db.invoices.find(i => i.id === editRequest.id);
    if (inv) setEdit({ ...inv });
    clearEditRequest?.();
  }, [editRequest]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [email, setEmail] = useState(null);
  const [pickSO, setPickSO] = useState(false);   // choose an SO to invoice from
  const [invoiceSO, setInvoiceSO] = useState(null);
  const [unprintedOnly, setUnprintedOnly] = useState(false);
  // Select mode: tick invoices, then email, save, mark or delete them together.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState({});
  const [bulkEmail, setBulkEmail] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [printSet, setPrintSet] = useState(null);   // { blob, filename, ids } — the selection as one PDF
  const customers = db.contacts.filter(c => c.type === "customer");
  const f = useFilters({ partyKind: "customer", contacts: db.contacts });
  const openSOs = db.salesOrders.filter(s => s.status === "open");
  const del = async (id) => { if (!confirm("Delete this invoice?")) return; if (await actions.deleteInvoice(id)) toast("Deleted"); };
  const generateFromSO = async (so, ids, opts, print) => {
    const inv = await actions.generateInvoice(so, ids, opts);
    if (inv) { toast("Invoice " + inv.number + " generated"); if (print) openDoc("invoice", inv); }
    return inv;
  };

  const startNew = () => {
    // Standalone invoice — no quote or SO behind it (time & materials, service
    // calls). The number defaults to auto (INV-, customer code and date) but can
    // be overridden per-invoice in the editor.
    const customerId = pickable(customers)[0]?.id || "";
    setEdit({
      id: uid(), number: AUTO_NUMBER, _new: true, salesOrderId: "", quoteId: "", customerId,
      poNumber: "", date: todayISO(), dueDate: dueDateFor(db, customerId, todayISO()),
      lineItems: [{ id: uid(), desc: "", qty: 1, unit: "", unitPrice: 0 }], taxRate: db.settings.taxRate, notes: "", payments: []
    });
  };
  const save = async (inv) => {
    const saved = await actions.saveInvoice(inv);
    if (saved) { setEdit(null); toast(inv._new ? "Invoice created" : "Invoice saved"); }
  };

  const unprintedCount = db.invoices.filter(i => !i.printed).length;
  const base = db.invoices.slice().reverse().filter(i => (!unprintedOnly || !i.printed) && f.keep(i.date, i.customerId));
  const { sorted: rows, sort, onSort } = useTableSort(base, {
    number: i => i.number, customer: i => nameOf(db, i.customerId), date: i => i.date, due: i => i.dueDate,
    status: i => invoiceStatus(i), printed: i => (i.printed ? 1 : 0),
    total: i => lineTotals(i.lineItems, i.taxRate).total, balance: i => balance(i),
  });
  // The Printed tick is the control: an invoice that went out by email, or one
  // printed before the flag existed, is marked by hand; unticking undoes a slip.
  const setPrinted = async (inv, printed) => {
    if (await actions.markInvoicePrinted(inv.id, printed)) toast(inv.number + (printed ? " marked printed" : " marked unprinted"));
  };
  const markAllShown = async () => {
    const ids = rows.filter(i => !i.printed).map(i => i.id);
    if (!ids.length || !confirm(`Mark ${ids.length} invoice${ids.length === 1 ? "" : "s"} as printed?`)) return;
    if (await actions.markInvoicePrinted(ids, true)) toast(`${ids.length} invoice${ids.length === 1 ? "" : "s"} marked printed`);
  };

  const chosen = rows.filter(i => picked[i.id]);
  const allPicked = rows.length > 0 && rows.every(i => picked[i.id]);
  const endSelect = () => { setSelecting(false); setPicked({}); };
  const plural = (n, w = "invoice") => `${n} ${w}${n === 1 ? "" : "s"}`;
  const bulkPrinted = async (printed) => {
    const ids = chosen.filter(i => !!i.printed !== printed).map(i => i.id);
    if (!ids.length) { toast(`All selected are already ${printed ? "printed" : "unprinted"}`); return; }
    setBulkBusy(true);
    if (await actions.markInvoicePrinted(ids, printed)) toast(`${plural(ids.length)} marked ${printed ? "printed" : "unprinted"}`);
    setBulkBusy(false);
    endSelect();
  };
  // Print the selection together: one PDF, each invoice on its own pages, one
  // trip to the printer dialog. Printing marks them printed, as printing one does.
  const bulkPrint = async () => {
    setBulkBusy(true);
    try { const { blob, filename } = await invoicesPdf(chosen, db); setPrintSet({ blob, filename, ids: chosen.map(i => i.id) }); }
    catch (e) { toast("⚠ Couldn't make the PDF: " + (e.message || e)); }
    setBulkBusy(false);
  };
  const bulkSave = async () => {
    setBulkBusy(true);
    try {
      // One PDF per invoice, spaced so the browser takes them all.
      for (const inv of chosen) { const { blob, filename } = await invoicePdf(inv, db); saveBlob(blob, filename); await new Promise(r => setTimeout(r, 350)); }
      toast(`Saved ${plural(chosen.length, "PDF")}`);
    } catch (e) { toast("⚠ Couldn't make the PDF: " + (e.message || e)); }
    setBulkBusy(false);
  };
  // An invoice with money on it is never deleted in a batch: its receipts would
  // go with it. Those are skipped and counted; the row's own Delete still works.
  const bulkDelete = async () => {
    const ok = chosen.filter(i => !(i.payments || []).length);
    const skipped = chosen.length - ok.length;
    if (!ok.length) { toast("Every selected invoice has payments on it — none deleted"); return; }
    if (!confirm(`Delete ${plural(ok.length)}?` + (skipped ? `\n\n${skipped} with payments on ${skipped === 1 ? "it is" : "them are"} left alone.` : "") + "\n\nTheir sales order lines go back to open. This can't be undone.")) return;
    setBulkBusy(true);
    let done = 0;
    for (const inv of ok) if (await actions.deleteInvoice(inv.id)) done++;
    setBulkBusy(false);
    toast(`Deleted ${plural(done)}` + (skipped ? ` · ${skipped} with payments skipped` : ""));
    endSelect();
  };
  const emailTo = () => {
    const ids = [...new Set(chosen.map(i => i.customerId))];
    if (ids.length !== 1) return "";
    return emailFor(db, ids[0], "invoice", chosen[0].contactPersonId);
  };

  if (edit) return <InvoiceEditor invoice={edit} customers={customers} catalog={db.catalog} onCancel={() => setEdit(null)} onSave={save} db={db} actions={actions} toast={toast} readOnly={readOnly} />;

  return <div>
    <div className="toolbar">
      <button className={"btn" + (unprintedOnly ? " primary" : "")} onClick={() => setUnprintedOnly(v => !v)}
        title="Invoices you haven't printed yet">
        <Ico d={ICONS.print} size={14} />{unprintedOnly ? "Showing unprinted" : `Unprinted${unprintedCount ? " · " + unprintedCount : ""}`}</button>
      {!readOnly && unprintedOnly && rows.length > 0 && <button className="btn" onClick={markAllShown} title="Mark every invoice shown as printed, without printing">
        <Ico d={ICONS.check} size={14} />Mark all {rows.length} as printed</button>}
      {db.invoices.length > 0 && <button className={"btn" + (selecting ? " primary" : "")} style={{ marginLeft: "auto" }}
        onClick={() => selecting ? endSelect() : setSelecting(true)} title="Pick several invoices to email, save, mark or delete together">
        <Ico d={ICONS.check} size={15} />{selecting ? "Done Selecting" : "Select"}</button>}
      {!readOnly && <>
        <button className="btn" style={db.invoices.length > 0 ? undefined : { marginLeft: "auto" }} onClick={() => setPickSO(true)} disabled={openSOs.length === 0}
          title={openSOs.length === 0 ? "No open sales orders" : "Bill selected lines from a sales order"}>
          <Ico d={ICONS.so} size={15} />Invoice from Sales Order</button>
        <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Invoice</button>
      </>}
    </div>
    {f.bar()}
    {selecting && <div className="toolbar">
      <span style={{ fontWeight: 600 }}>{chosen.length ? plural(chosen.length) + " selected" : "Tick the invoices to work on"}</span>
      {chosen.length > 0 && <span className="subtle mono">{money(chosen.reduce((t, i) => t + lineTotals(i.lineItems, i.taxRate).total, 0))}</span>}
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" disabled={!chosen.length || bulkBusy} onClick={() => setBulkEmail(true)}><Ico d={ICONS.mail} size={15} />Email</button>
        <button className="btn" disabled={!chosen.length || bulkBusy} onClick={bulkPrint}><Ico d={ICONS.print} size={15} />Print</button>
        <button className="btn" disabled={!chosen.length || bulkBusy} onClick={bulkSave}><Ico d={ICONS.download} size={15} />Save {chosen.length > 1 ? plural(chosen.length, "PDF") : "PDF"}</button>
        {!readOnly && <>
          <button className="btn" disabled={!chosen.length || bulkBusy} onClick={() => bulkPrinted(true)}>Mark Printed</button>
          <button className="btn" disabled={!chosen.length || bulkBusy} onClick={() => bulkPrinted(false)}>Mark Unprinted</button>
          <button className="btn danger" disabled={!chosen.length || bulkBusy} onClick={bulkDelete}><Ico d={ICONS.trash} size={15} />Delete</button>
        </>}
        <button className="btn ghost" onClick={endSelect}>Cancel</button>
      </span>
    </div>}
    <div className="card">
      {db.invoices.length === 0
        ? <Empty icon={ICONS.inv} title="No invoices" msg="Generate an invoice from a sales order, or create a standalone one for service and T&M work. Record payments to update its status."
          action={<button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Invoice</button>} />
        : <table><thead><tr>
          {selecting && <th style={{ width: 34 }}><input type="checkbox" title="Select all" checked={allPicked}
            onChange={e => setPicked(e.target.checked ? Object.fromEntries(rows.map(i => [i.id, true])) : {})} /></th>}
          <SortTh label="Invoice" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
          <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
          <SortTh label="Due" col="due" sort={sort} onSort={onSort} />
          <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
          <SortTh label="Printed" col="printed" sort={sort} onSort={onSort} />
          <SortTh label="Total" col="total" sort={sort} onSort={onSort} num />
          <SortTh label="Balance" col="balance" sort={sort} onSort={onSort} num /><th></th></tr></thead>
          <tbody>{rows.map(inv => {
            const st = invoiceStatus(inv);
            return <tr key={inv.id} onClick={selecting ? () => setPicked(s => ({ ...s, [inv.id]: !s[inv.id] })) : undefined}
              style={selecting ? { cursor: "pointer", background: picked[inv.id] ? "var(--accent-wash)" : undefined } : undefined}>
              {selecting && <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={!!picked[inv.id]}
                onChange={e => setPicked(s => ({ ...s, [inv.id]: e.target.checked }))} /></td>}
              <td className="doc-id">{inv.number}</td>
              <td>{nameOf(db, inv.customerId)}</td>
              <td className="subtle nowrap">{fmtDate(inv.date)}</td>
              <td className="subtle nowrap">{fmtDate(inv.dueDate)}</td>
              <td><Badge status={st} /></td>
              <td onClick={e => e.stopPropagation()}><label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: readOnly ? "default" : "pointer" }}
                title={inv.printed ? "Printed — untick to mark it unprinted" : "Not printed yet — tick to mark it printed without printing"}>
                <input type="checkbox" checked={!!inv.printed} disabled={readOnly} onChange={e => setPrinted(inv, e.target.checked)} />
                {inv.printed ? <span className="subtle">Printed</span> : <span className="badge amber"><span className="dot"></span>Unprinted</span>}
              </label></td>
              <td className="num">{money(lineTotals(inv.lineItems, inv.taxRate).total)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(balance(inv))}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                {!readOnly && st !== "paid" && <button className="btn sm" onClick={() => setPay(inv)}><Ico d={ICONS.money} size={14} />Payment</button>}
                <button className="btn ghost icon" title="View" onClick={() => openDoc("invoice", inv)}><Ico d={ICONS.view} size={16} /></button>
                <button className="btn ghost icon" title="Email invoice" onClick={() => setEmail(inv)}><Ico d={ICONS.mail} size={16} /></button>
                <button className="btn ghost icon" title="Print" onClick={() => openDoc("invoice", inv, { autoPrint: true })}><Ico d={ICONS.print} size={16} /></button>
                <button className="btn ghost icon" title={"Save " + inv.number + ".pdf"} onClick={() => saveInvoice(inv)}><Ico d={ICONS.download} size={16} /></button>
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
    {email && <EmailModal docType="invoice"
      title={"Email · " + email.number}
      defaultTo={emailFor(db, email.customerId, "invoice", email.contactPersonId)}
      defaultSubject={`Invoice ${email.number} — ${db.settings.company}`}
      defaultBody={`Please find attached invoice ${email.number}.\n\nThank you for your business.\n\n${db.settings.company}\n${db.settings.companyPhone || ""}`}
      buildAttachment={() => invoicePdf(email, db)}
      onClose={() => setEmail(null)} toast={toast} />}
    {printSet && <PdfView blob={printSet.blob} filename={printSet.filename} autoPrint
      onPrinted={readOnly ? undefined : () => actions.markInvoicePrinted(printSet.ids, true)}
      onClose={() => { setPrintSet(null); endSelect(); }} />}
    {bulkEmail && <EmailModal docType="invoice"
      title={`Email · ${plural(chosen.length)}`}
      defaultTo={emailTo()}
      defaultSubject={chosen.length === 1 ? `Invoice ${chosen[0].number} — ${db.settings.company}` : `Invoices ${chosen.map(i => i.number).join(", ")} — ${db.settings.company}`}
      defaultBody={`Please find attached ${chosen.length === 1 ? "invoice " + chosen[0].number : `our ${chosen.length} invoices`}:\n${chosen.map(i => `  • ${i.number} — ${money(lineTotals(i.lineItems, i.taxRate).total)}${i.poNumber ? " · PO " + i.poNumber : ""}`).join("\n")}\n\nThank you for your business.\n\n${db.settings.company}\n${db.settings.companyPhone || ""}`}
      buildAttachment={() => Promise.all(chosen.map(i => invoicePdf(i, db)))}
      onSent={endSelect}
      onClose={() => setBulkEmail(false)} toast={toast} />}
    {pay && <PaymentModal db={db} doc={pay} onClose={() => setPay(null)}
      offerFor={d => discountOffer(db, pay, pay.customerId, d)}
      onSave={async (p) => {
        if (!await actions.recordPayment("invoice", pay.id, p)) return false;
        toast("Payment recorded");
        return true;
      }}
      onVoid={async (p) => {
        if (!await actions.deletePayments([p.id])) return false;
        toast("Payment reversed — " + pay.number + " is open again");
        return true;
      }}
      onDelete={async (pid) => {
        if (await actions.deletePayments([pid])) {
          setPay(prev => ({ ...prev, payments: (prev.payments || []).filter(x => x.id !== pid) }));
          toast("Payment deleted");
        }
      }} />}
  </div>;
}

function InvoiceEditor({ invoice, customers, catalog, onCancel, onSave, db, actions, toast, readOnly }) {
  const [inv, setInv] = useState(invoice);
  const [saving, setSaving] = useState(false);
  // Changing the invoice date — or the customer — re-dates the invoice from
  // that customer's terms. Type over the due date afterwards and it stays put
  // until one of those two changes again.
  const set = (k, v) => setInv(p => {
    const next = { ...p, [k]: v };
    if (k === "date" || k === "customerId") next.dueDate = dueDateFor(db, next.customerId, next.date);
    return next;
  });
  // The number is editable on an issued invoice too — imports and typos happen.
  // Only a new one may be left on (auto); anything else has to be filled in and
  // must not collide with an invoice that already carries it. The store checks
  // this again on save, so no path around this screen can write a duplicate.
  const numTrim = (inv.number || "").trim();
  const autoNum = inv._new && (!numTrim || numTrim.startsWith("("));
  const numErr = autoNum ? ""
    : !numTrim ? "An invoice number is required."
      : db.invoices.some(x => x.id !== inv.id && (x.number || "").trim().toLowerCase() === numTrim.toLowerCase())
        ? `Invoice number "${numTrim}" is already used.` : "";
  const save = async () => { setSaving(true); await onSave(inv); setSaving(false); };
  return <div data-editing="1">
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{inv._new ? "New Invoice" : "Edit " + inv.number} <span className="mono subtle" style={{ fontSize: 14 }}>{inv.number}</span></h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving || !!numErr} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Invoice"}</button>
      </div>
    </div>
    <div className="card"><div className="card-body">
      <div className="row">
        <Field label="Customer" hint={inv.customerId ? termsLabelFor(db, inv.customerId) : undefined}>
          <select className="select" value={inv.customerId} onChange={e => set("customerId", e.target.value)}>
          <option value="">Select customer…</option>{pickable(customers, inv.customerId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Invoice #" hint={inv._new ? "Leave as (auto) to use the generated number" : "Renaming affects this invoice only"}>
          <input className="input mono" value={inv.number} onChange={e => set("number", e.target.value)}
            style={numErr ? { borderColor: "var(--neg)" } : undefined} /></Field>
        <Field label="Invoice Date"><input className="input" type="date" value={inv.date} onChange={e => set("date", e.target.value)} /></Field>
        <Field label="Due Date" hint={inv.customerId ? "From " + termsLabelFor(db, inv.customerId) : undefined}>
          <input className="input" type="date" value={inv.dueDate} onChange={e => setInv(p => ({ ...p, dueDate: e.target.value }))} /></Field>
        <Field label="Customer PO #"><input className="input mono" value={inv.poNumber || ""} onChange={e => set("poNumber", e.target.value)} /></Field>
        <Field label="Income Account" hint={inv.incomeAccount ? "Where this invoice posts" : "Default: " + (accountLabel(db, incomeAccountOf(db, inv)) || "none set")}>
          <AccountSelect db={db} value={inv.incomeAccount} onChange={v => setInv(p => ({ ...p, incomeAccount: v }))} types={["Income"]} blank="— customer's default —" /></Field>
      </div>
      {numErr && <p className="subtle" style={{ margin: "0 0 8px", color: "var(--neg)" }}>{numErr}</p>}
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
