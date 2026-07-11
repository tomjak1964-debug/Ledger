import { useState } from "react";
import { uid, money, fmtDate, todayISO } from "../lib/helpers.js";
import { paid, balance, round2 } from "../calc/ledger.js";
import { Modal, Field, Ico, ICONS } from "./ui.jsx";

export default function PaymentModal({ doc, onClose, onSave, onDelete, isBill }) {
  const bal = isBill ? ((Number(doc.amount) || 0) - paid(doc)) : balance(doc);
  const [amount, setAmount] = useState(round2(bal));
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("Check");
  return <Modal title={"Record Payment · " + doc.number} onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => onSave({ id: uid(), amount: Number(amount) || 0, date, method })}>Record {money(Number(amount) || 0)}</button></>}>
    <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--canvas)", borderRadius: 9, display: "flex", justifyContent: "space-between" }}>
      <span className="subtle">Outstanding balance</span><span className="mono" style={{ fontWeight: 600, fontSize: 16 }}>{money(bal)}</span>
    </div>
    <div className="row">
      <Field label="Amount"><input className="input mono" type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      <Field label="Date"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Method"><select className="select" value={method} onChange={e => setMethod(e.target.value)}>
        {["Check", "ACH / Wire", "Credit Card", "Cash", "Other"].map(m => <option key={m}>{m}</option>)}
      </select></Field>
    </div>
    {(doc.payments || []).length > 0 && <><div className="divider"></div><div className="subtle" style={{ marginBottom: 8, fontWeight: 600 }}>Payment history</div>
      {doc.payments.map(p => <div key={p.id} className="cat-row"><span className="mono">{money(p.amount)}</span><span className="subtle">{p.method}</span><span className="subtle" style={{ marginLeft: "auto" }}>{fmtDate(p.date)}</span>
        {onDelete && <button className="btn ghost icon" title="Delete payment" onClick={() => { if (confirm("Delete this " + money(p.amount) + " payment?")) onDelete(p.id); }}><Ico d={ICONS.trash} size={14} /></button>}</div>)}</>}
  </Modal>;
}
