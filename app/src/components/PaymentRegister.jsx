import { Fragment, useState } from "react";
import { money, fmtDate, nameOf, sum } from "../lib/helpers.js";
import { round2 } from "../calc/ledger.js";
import { receiptGroups } from "../calc/reports.js";
import { checkNumberTaken, normRef } from "../lib/checks.js";
import { rangeFor, defaultCustom } from "../lib/dateRanges.js";
import { Ico, ICONS, Empty, Modal, Field } from "./ui.jsx";
import FilterBar from "./FilterBar.jsx";
import ReceiptModal from "./ReceiptModal.jsx";

const METHODS = ["Check", "ACH / Wire", "Credit Card", "Cash", "Other"];

// Every payment on file, editable and voidable. Money in (kind="invoice",
// customer receipts) and money out (kind="bill", vendor payments) are the same
// register with the labels swapped.
//
// Receipts are listed as RECEIPTS, not as payment rows: one check or transfer
// from one customer is one line, expandable to the invoices it covered. Vendor
// payments stay one row per bill, since a check there is already flagged with
// the bills it spans.
//
// Nothing here needs to "reopen" a document: balances are derived from the
// payments (CLAUDE.md §6), so trimming or deleting a payment puts the bill or
// invoice back in the open list on its own.
export default function PaymentRegister({ db, actions, toast, readOnly, kind }) {
  const isBill = kind === "bill";
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState("all");
  const [custom, setCustom] = useState(defaultCustom);
  const [partyId, setPartyId] = useState("");
  const [edit, setEdit] = useState(null);        // { payment, doc } — one line of a receipt
  const [editGroup, setEditGroup] = useState(null);  // a whole receipt, re-allocated across invoices
  const [from, to] = rangeFor(preset, custom);
  const parents = isBill ? db.bills : db.invoices;
  const docLabel = isBill ? "Bill" : "Invoice";
  const partyLabel = isBill ? "Vendor" : "Customer";
  const needle = q.trim().toLowerCase();

  const filters = <>
    <div className="search" style={{ maxWidth: 250 }}><Ico d={ICONS.search} size={15} />
      <input className="input" placeholder={`Search ${partyLabel.toLowerCase()}, ${docLabel.toLowerCase()} #, check #…`}
        value={q} onChange={e => setQ(e.target.value)} /></div>
    {(q || preset !== "all" || partyId) && <button className="btn sm"
      onClick={() => { setQ(""); setPreset("all"); setPartyId(""); }}>Clear</button>}
  </>;
  const bar = <FilterBar preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom}
    partyKind={isBill ? "vendor" : "customer"} partyId={partyId} onParty={setPartyId} contacts={db.contacts}>
    {filters}
  </FilterBar>;

  const editEntry = (paymentId, docId) => {
    const doc = parents.find(d => d.id === docId);
    const payment = doc?.payments?.find(p => p.id === paymentId);
    if (payment) setEdit({ payment: { ...payment }, doc });
  };
  const editModal = edit && <EditPayment db={db} actions={actions} toast={toast} kind={kind} entry={edit} onClose={() => setEdit(null)} />;

  // Receipts open whole: the same modal that records one, loaded with what it
  // already covers, so invoices can be added to it or taken off it.
  const groupModal = editGroup && <ReceiptModal db={db} receipt={editGroup} onClose={() => setEditGroup(null)}
    onSave={async (allocations, meta) => {
      const ok = await actions.updateReceipt(editGroup.lines.map(l => l.paymentId), allocations, meta);
      if (ok) toast("Receipt updated");
      return ok;
    }} />;

  return <div>
    {bar}
    <Register db={db} actions={actions} toast={toast} readOnly={readOnly} kind={kind}
      from={from} to={to} partyId={partyId} needle={needle} onEdit={editEntry}
      onEditGroup={isBill ? null : setEditGroup} />
    {editModal}
    {groupModal}
  </div>;
}

/* ---------- one row per receipt / per check ----------
   A receipt (or a payment) is what actually moved: one check or transfer, from
   or to one party, on one date. Several documents can sit under it, so the row
   expands to show what it was applied to. */
function Register({ db, actions, toast, readOnly, kind, from, to, partyId, needle, onEdit, onEditGroup }) {
  const [open, setOpen] = useState({});
  const isBill = kind === "bill";
  const L = isBill
    ? { title: "Payments", one: "payment", ref: "Check / Ref #", party: "Vendor", when: "Date Paid", docs: "Bills", doc: "bill" }
    : { title: "Receipts", one: "receipt", ref: "Reference #", party: "Customer", when: "Date Received", docs: "Invoices", doc: "invoice" };
  const all = receiptGroups(db, { kind, from, to, partyId });
  const rows = needle
    ? all.rows.filter(g => [g.ref, g.method, nameOf(db, g.partyId), ...g.lines.map(l => l.number)]
      .some(v => String(v || "").toLowerCase().includes(needle)))
    : all.rows;
  const total = round2(sum(rows, g => g.amount));
  const anyPayments = (isBill ? db.bills : db.invoices).some(d => (d.payments || []).length);

  const voidGroup = async (g) => {
    const what = g.ref ? `${L.one} #${g.ref}` : `the ${money(g.amount)} ${L.one}`;
    const docs = g.lines.map(l => l.number).join(", ");
    const reusable = isBill && g.ref && g.method === "Check" ? ` and check #${g.ref} can be used again` : "";
    if (!confirm(`Delete ${what}? Its ${g.count} payment${g.count > 1 ? "s are" : " is"} removed, ${docs} go back to open${reusable}.`)) return;
    if (await actions.deletePayments(g.lines.map(l => l.paymentId)))
      toast(`${L.title.slice(0, -1)} deleted — ${g.count} ${L.doc}${g.count > 1 ? "s" : ""} reopened`);
  };
  const deleteLine = async (g, l) => {
    if (g.count === 1) return voidGroup(g);
    if (!confirm(`Remove the ${money(l.amount)} applied to ${l.number}? That ${L.doc} goes back to open for the amount.`)) return;
    if (await actions.deletePayments([l.paymentId])) toast("Removed — " + l.number + " reopened");
  };

  return <div className="card">
    <div className="card-head"><h3>{L.title}</h3>
      <span className="mono" style={{ marginLeft: "auto", fontWeight: 600, fontSize: 16 }}>{money(total)}</span>
      <span className="subtle">{rows.length} {L.one}{rows.length === 1 ? "" : "s"}</span></div>
    {rows.length === 0
      ? <Empty icon={ICONS.money} title={anyPayments ? "Nothing matches those filters" : `No ${L.one}s yet`}
        msg={anyPayments ? "Widen the date range or clear the search."
          : `Payments you ${isBill ? "make against vendor bills" : "receive against customer invoices"} show up here, grouped by the check or transfer they went out on.`} />
      : <table><thead><tr>
        <th style={{ width: 34 }}></th><th>{L.ref}</th><th>{L.party}</th><th>{L.when}</th><th>Method</th>
        <th className="num">{L.docs}</th><th className="num">Amount</th><th></th></tr></thead>
        <tbody>{rows.map(g => {
          const isOpen = !!open[g.key];
          const toggle = () => setOpen(o => ({ ...o, [g.key]: !o[g.key] }));
          return <Fragment key={g.key}>
            <tr style={{ cursor: "pointer" }} onClick={toggle}>
              <td><button className="btn ghost icon" title={isOpen ? "Collapse" : `Show ${L.docs.toLowerCase()}`}
                style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}
                onClick={e => { e.stopPropagation(); toggle(); }}><Ico d={ICONS.arrow} size={15} /></button></td>
              <td className="mono doc-id">{g.ref ? "#" + g.ref : "—"}</td>
              <td style={{ fontWeight: 600 }}>{nameOf(db, g.partyId)}</td>
              <td className="subtle">{fmtDate(g.date)}</td>
              <td className="subtle">{g.method || "—"}</td>
              <td className="num subtle">{g.count}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(g.amount)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && onEditGroup && <button className="btn ghost icon" title={`Open this ${L.one} — add or remove ${L.docs.toLowerCase()}`}
                  onClick={e => { e.stopPropagation(); onEditGroup(g); }}><Ico d={ICONS.edit} size={15} /></button>}
                {!readOnly && <button className="btn ghost icon" title={`Delete this whole ${L.one}`}
                  onClick={e => { e.stopPropagation(); voidGroup(g); }}><Ico d={ICONS.trash} size={15} /></button>}
              </td>
            </tr>
            {isOpen && g.lines.map(l => <tr key={l.paymentId} className="sub-row">
              <td></td><td className="subtle" style={{ paddingLeft: 8 }}>applied to</td>
              <td className="doc-id">{l.number}</td>
              <td className="subtle">{fmtDate(l.docDate)}</td>
              <td colSpan={2}></td>
              <td className="num">{money(l.amount)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && <button className="btn ghost icon" title="Edit this line" onClick={() => onEdit(l.paymentId, l.docId)}><Ico d={ICONS.edit} size={14} /></button>}
                {!readOnly && <button className="btn ghost icon" title="Remove this line" onClick={() => deleteLine(g, l)}><Ico d={ICONS.trash} size={14} /></button>}
              </td>
            </tr>)}
          </Fragment>;
        })}
          <tr><td></td><td style={{ fontWeight: 700 }}>Total</td><td colSpan={4}></td>
            <td className="num" style={{ fontWeight: 700 }}>{money(total)}</td><td></td></tr>
        </tbody></table>}
  </div>;
}

function EditPayment({ db, actions, toast, kind, entry, onClose }) {
  const original = entry.doc.payments.find(p => p.id === entry.payment.id) || entry.payment;
  const [p, setP] = useState({ ...original });
  const [busy, setBusy] = useState(false);
  const amt = round2(Number(p.amount) || 0);
  const changedRef = normRef(p.ref) !== normRef(original.ref) || p.method !== original.method;
  const refErr = kind === "bill" && p.method === "Check"
    ? !normRef(p.ref) ? "A check payment needs a check number."
      : changedRef && checkNumberTaken(db, p.ref, [p.id]) ? `Check #${normRef(p.ref)} is already used by another check.` : ""
    : "";
  const err = amt === 0 ? "Enter an amount." : refErr;

  const save = async () => {
    setBusy(true);
    const ok = await actions.updatePayment(kind, entry.doc.id, p);
    setBusy(false);
    if (ok) { toast("Payment updated"); onClose(); }
  };

  return <Modal title={"Edit Payment · " + entry.doc.number} onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !!err} onClick={save}>{busy ? "Saving…" : "Save Payment"}</button></>}>
    <div className="row">
      <Field label="Amount"><input className="input mono" type="number" step="any" value={p.amount} onChange={e => setP({ ...p, amount: e.target.value })} /></Field>
      <Field label="Date"><input className="input" type="date" value={p.date || ""} onChange={e => setP({ ...p, date: e.target.value })} /></Field>
      <Field label="Method"><select className="select" value={p.method || "Other"} onChange={e => setP({ ...p, method: e.target.value })}>
        {METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
      <Field label={kind === "bill" && p.method === "Check" ? "Check #" : "Ref #"}>
        <input className="input mono" value={p.ref || ""} onChange={e => setP({ ...p, ref: e.target.value })}
          style={refErr ? { borderColor: "var(--neg)" } : undefined} /></Field>
    </div>
    {err && <p className="subtle" style={{ margin: "0 0 8px", color: "var(--neg)" }}>{err}</p>}
    <p className="subtle" style={{ marginBottom: 0 }}>
      Changing the date, method or reference moves this line onto a different receipt.
      Lowering or removing it reopens {entry.doc.number} for the difference.
    </p>
  </Modal>;
}
