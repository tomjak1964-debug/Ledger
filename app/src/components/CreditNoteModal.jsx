import { useState } from "react";
import { uid, money, todayISO } from "../lib/helpers.js";
import { lineTotals, paid, round2 } from "../calc/ledger.js";
import { AUTO_NUMBER } from "../lib/store.js";
import { Modal, Field } from "./ui.jsx";
import LineItemsEditor from "./LineItemsEditor.jsx";

// Issue a credit note — its own document, numbered in its own series (CM-0001).
//
// Amounts are typed as positive numbers here, the way anyone would write a
// credit, and stored negative: a credit note is an A/R document whose total is
// below zero, which is what every balance, aging and apply calculation already
// understands (CLAUDE.md §6).
export default function CreditNoteModal({ db, credit, onClose, onSave }) {
  const customers = db.contacts.filter(c => c.type === "customer");
  const pos = li => ({ ...li, unitPrice: Math.abs(Number(li.unitPrice) || 0) });
  const [cn, setCn] = useState(() => credit
    ? { ...credit, lineItems: (credit.lineItems || []).map(pos) }
    : {
      id: uid(), _new: true, kind: "credit", number: AUTO_NUMBER, customerId: customers[0]?.id || "",
      date: todayISO(), dueDate: todayISO(), taxRate: db.settings.taxRate, notes: "", poNumber: "",
      lineItems: [{ id: uid(), desc: "", qty: 1, unit: "", unitPrice: 0 }], payments: [],
    });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setCn(p => ({ ...p, [k]: v }));

  const live = (cn.lineItems || []).filter(li => String(li.desc || "").trim() || Number(li.qty) || Number(li.unitPrice));
  const t = lineTotals(live, cn.taxRate);
  // What has already been applied to invoices — the credit can't be cut below it.
  const applied = credit ? round2(-paid(credit)) : 0;
  const err = !cn.customerId ? "Choose the customer this credit is for."
    : t.total <= 0.005 ? "Add at least one line with an amount."
      : applied > t.total + 0.005
        ? `${cn.number} already has ${money(applied)} applied to invoices — the credit can't be less than that. Unapply it first.`
        : "";

  const save = async () => {
    setSaving(true);
    const ok = await onSave({
      ...cn, kind: "credit", dueDate: cn.date,
      lineItems: live.map(li => ({ ...li, unitPrice: -Math.abs(Number(li.unitPrice) || 0) })),
    });
    setSaving(false);
    if (ok) onClose();
  };

  return <Modal wide title={cn._new ? "New Credit Note" : "Edit " + cn.number} onClose={onClose}
    foot={<>
      <div className="subtle" style={{ marginRight: "auto", alignSelf: "center" }}>
        {t.total > 0.005 ? `${money(t.total)} credit` : "Enter what you are crediting"}
      </div>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={saving || !!err} onClick={save}>{saving ? "Saving…" : "Save Credit Note"}</button>
    </>}>
    <div className="row">
      <Field label="Customer">
        <select className="select" value={cn.customerId} onChange={e => set("customerId", e.target.value)}>
          <option value="">Select customer…</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Credit Note #" hint={cn._new ? "Assigned from the credit series on save" : "Renaming affects this credit only"}>
        <input className="input mono" value={cn.number} onChange={e => set("number", e.target.value)} /></Field>
      <Field label="Date"><input className="input" type="date" value={cn.date} onChange={e => set("date", e.target.value)} /></Field>
    </div>
    <p className="subtle" style={{ marginTop: 0 }}>Enter the amounts as positives — what you are crediting the customer.
      It prints as a credit memo and can be applied to their open invoices from Receivables.</p>
    <div className="divider"></div>
    <LineItemsEditor items={cn.lineItems} setItems={v => set("lineItems", v)}
      taxRate={cn.taxRate} setTaxRate={v => set("taxRate", v)} catalog={db.catalog} />
    <div className="divider"></div>
    <Field label="Reason / notes (printed on the credit)">
      <textarea className="input" value={cn.notes || ""} onChange={e => set("notes", e.target.value)}
        placeholder="Returned parts, billing correction, goodwill…" /></Field>
    {applied > 0.005 && <p className="subtle" style={{ marginBottom: 0 }}>{money(applied)} of this credit is already applied to invoices.</p>}
    {err && <p className="subtle" style={{ margin: "8px 0 0", color: "var(--neg)" }}>{err}</p>}
  </Modal>;
}
