import { useState } from "react";
import { money, fmtDate, nameOf, sum } from "../lib/helpers.js";
import { round2 } from "../calc/ledger.js";
import { checkNumberTaken, normRef, isCheckPayment } from "../lib/checks.js";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort } from "./ui.jsx";

const METHODS = ["Check", "ACH / Wire", "Credit Card", "Cash", "Other"];

// Every payment on file, editable and voidable. Money in (kind="invoice",
// customer receipts) and money out (kind="bill", vendor payments) are the same
// register with the labels swapped.
//
// Nothing here needs to "reopen" a document: balances are derived from the
// payments (CLAUDE.md §6), so trimming or deleting a payment puts the bill or
// invoice back in the open list on its own.
export default function PaymentRegister({ db, actions, toast, readOnly, kind }) {
  const isBill = kind === "bill";
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [edit, setEdit] = useState(null);   // { payment, doc }
  const parents = isBill ? db.bills : db.invoices;
  const docLabel = isBill ? "Bill" : "Invoice";
  const partyLabel = isBill ? "Vendor" : "Customer";
  const partyId = (d) => isBill ? d.vendorId : d.customerId;

  const all = parents.flatMap(d => (d.payments || []).map(p => ({ p, doc: d })));
  const needle = q.trim().toLowerCase();
  const rows = all.filter(({ p, doc }) => {
    if (from && (p.date || "") < from) return false;
    if (to && (p.date || "") > to) return false;
    if (!needle) return true;
    return [doc.number, doc.ref, p.ref, p.method, nameOf(db, partyId(doc))]
      .some(v => String(v || "").toLowerCase().includes(needle));
  });
  const total = round2(sum(rows, r => Number(r.p.amount) || 0));
  // Rows sharing one check number for one party are one physical check (or one
  // customer's check covering several invoices). Two parties may legitimately
  // write checks with the same number, so the party has to match too.
  const sameCheck = (row) => isCheckPayment(row.p)
    ? all.filter(r => isCheckPayment(r.p)
      && normRef(r.p.ref).toLowerCase() === normRef(row.p.ref).toLowerCase()
      && partyId(r.doc) === partyId(row.doc))
    : [];

  const { sorted, sort, onSort } = useTableSort(rows, {
    date: r => r.p.date || "", party: r => nameOf(db, partyId(r.doc)), doc: r => r.doc.number || "",
    method: r => r.p.method || "", ref: r => r.p.ref || "", amount: r => Number(r.p.amount) || 0,
  }, { key: "date", dir: "desc" });

  const removeOne = async (row) => {
    const { p, doc } = row;
    const run = sameCheck(row);
    if (run.length > 1) return voidCheck(row, run);
    if (!confirm(`Delete this ${money(p.amount)} payment? ${doc.number} goes back to open for that amount.`)) return;
    if (await actions.deletePayments([p.id])) toast("Payment deleted — " + doc.number + " reopened");
  };
  const voidCheck = async ({ p }, run) => {
    const ref = normRef(p.ref);
    const docs = run.map(r => r.doc.number).join(", ");
    const reusable = isBill ? ` and check #${ref} can be used again` : "";
    if (!confirm(`Void check #${ref}? Its ${run.length} payments are deleted, ${docs} go back to open${reusable}.`)) return;
    if (await actions.deletePayments(run.map(r => r.p.id)))
      toast(`Check #${ref} voided — ${run.length} ${docLabel.toLowerCase()}s reopened`);
  };

  return <div>
    <div className="toolbar">
      <div className="search"><Ico d={ICONS.search} size={15} />
        <input className="input" placeholder={`Search ${partyLabel.toLowerCase()}, ${docLabel.toLowerCase()} #, check #…`} value={q} onChange={e => setQ(e.target.value)} /></div>
      <label className="subtle" style={{ display: "flex", alignItems: "center", gap: 6 }}>From
        <input className="input" type="date" style={{ maxWidth: 150 }} value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label className="subtle" style={{ display: "flex", alignItems: "center", gap: 6 }}>To
        <input className="input" type="date" style={{ maxWidth: 150 }} value={to} onChange={e => setTo(e.target.value)} /></label>
      {(q || from || to) && <button className="btn sm" onClick={() => { setQ(""); setFrom(""); setTo(""); }}>Clear</button>}
    </div>
    <div className="card">
      <div className="card-head"><h3>{isBill ? "Payments Made" : "Payments Received"}</h3>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 600, fontSize: 16 }}>{money(total)}</span>
        <span className="subtle">{rows.length} payment{rows.length === 1 ? "" : "s"}</span></div>
      {sorted.length === 0
        ? <Empty icon={ICONS.money} title={all.length ? "Nothing matches those filters" : "No payments yet"}
          msg={all.length ? "Widen the date range or clear the search." : isBill ? "Payments you record against vendor bills show up here, ready to edit or void." : "Payments you receive against customer invoices show up here, ready to edit or delete."} />
        : <table><thead><tr>
          <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
          <SortTh label={partyLabel} col="party" sort={sort} onSort={onSort} />
          <SortTh label={docLabel} col="doc" sort={sort} onSort={onSort} />
          <SortTh label="Method" col="method" sort={sort} onSort={onSort} />
          <SortTh label={isBill ? "Check / Ref #" : "Ref #"} col="ref" sort={sort} onSort={onSort} />
          <SortTh label="Amount" col="amount" sort={sort} onSort={onSort} num /><th></th></tr></thead>
          <tbody>{sorted.map(({ p, doc }) => {
            const run = sameCheck({ p, doc });
            return <tr key={p.id}>
              <td className="subtle">{fmtDate(p.date)}</td>
              <td style={{ fontWeight: 600 }}>{nameOf(db, partyId(doc))}</td>
              <td className="doc-id">{doc.number}</td>
              <td className="subtle">{p.method || "—"}</td>
              <td className="mono subtle">{p.ref ? "#" + p.ref : "—"}{run.length > 1 && <span className="subtle"> · {run.length} {docLabel.toLowerCase()}s</span>}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(Number(p.amount) || 0)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && <button className="btn ghost icon" title="Edit payment" onClick={() => setEdit({ payment: { ...p }, doc })}><Ico d={ICONS.edit} size={15} /></button>}
                {!readOnly && <button className="btn ghost icon" title={run.length > 1 ? "Void this check" : "Delete payment"} onClick={() => removeOne({ p, doc })}><Ico d={ICONS.trash} size={15} /></button>}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {edit && <EditPayment db={db} actions={actions} toast={toast} kind={kind} entry={edit} onClose={() => setEdit(null)} />}
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
      Lowering or removing this payment reopens {entry.doc.number} for the difference — it goes straight back into {kind === "bill" ? "Payables" : "Receivables"}.
    </p>
  </Modal>;
}
