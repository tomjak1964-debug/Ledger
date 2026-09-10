import { useState } from "react";
import { uid, money, fmtDate, todayISO } from "../lib/helpers.js";
import { paid, balance, round2, billBalance } from "../calc/ledger.js";
import { Modal, Field, Ico, ICONS } from "./ui.jsx";

// One payment, start to finish:
//
//   entry  → record the payment (the button disarms the moment it fires)
//   check  → the check is on the printer: confirm it came out clean, reprint,
//            or void it — voiding deletes the payment, so the bill reopens and
//            the check number goes back on the shelf
//   done   → print / email / save the remittance, then everything closes
//
// There is no way back to the Record button after a payment lands, so the same
// payment can't be applied twice.
export default function PaymentModal({ doc, onClose, onSave, onVoid, onDelete, onPrintCheck, onEmailDoc, isBill, nextCheckRef, isRefTaken }) {
  const bal = isBill ? billBalance(doc) : balance(doc);
  const [amount, setAmount] = useState(round2(bal));
  const [discount, setDiscount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("Check");
  const [ref, setRef] = useState(isBill && nextCheckRef ? nextCheckRef : "");
  const [stage, setStage] = useState("entry");   // entry | check | done
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  const isCheck = isBill && method === "Check";
  const amt = round2(Number(amount) || 0);
  // A discount settles the rest of the document without cash moving, so amount
  // plus discount is what closes it. Typing one drops the cash by the same
  // amount, which is what taking a term actually does.
  const disc = round2(Number(discount) || 0);
  const takeDiscount = (v) => {
    const d = round2(Number(v) || 0);
    setDiscount(v);
    setAmount(round2(Math.max(0, round2(bal) - d)));
  };
  // Switching to Check pulls the next number off the stack; switching away
  // clears it so an ACH doesn't quietly consume a check number.
  const pickMethod = (m) => {
    setMethod(m);
    if (isBill && m === "Check" && !ref.trim()) setRef(nextCheckRef || "");
    if (m !== "Check" && ref.trim() && ref.trim() === (nextCheckRef || "")) setRef("");
  };
  const refErr = isCheck
    ? !ref.trim() ? "Enter the check number." : isRefTaken?.(ref) ? `Check #${ref.trim()} has already been used.` : ""
    : "";
  const err = amt === 0 && disc === 0 ? "Enter an amount." : refErr;

  const record = async () => {
    setBusy(true);
    const p = { id: uid(), amount: amt, discount: disc, date, method, ref: ref.trim() };
    const ok = await onSave(p);
    setBusy(false);
    if (!ok) return;
    setSaved(p);
    if (isCheck) { onPrintCheck?.(p); setStage("check"); }
    else setStage("done");
  };

  const voidPayment = async () => {
    setBusy(true);
    const ok = await onVoid?.(saved);
    setBusy(false);
    if (ok !== false) onClose();
  };

  /* ---- the check is printing ---- */
  // Dismissing keeps the payment — it is already recorded. Reversing it is the
  // explicit "It Didn't Print" choice.
  if (stage === "check") return <Modal title={"Check #" + saved.ref + " · " + money(saved.amount)} onClose={onClose}
    foot={<>
      <button className="btn danger" disabled={busy} style={{ marginRight: "auto" }} onClick={voidPayment}>
        <Ico d={ICONS.trash} size={15} />It Didn't Print
      </button>
      <button className="btn" disabled={busy} onClick={() => onPrintCheck?.(saved)}><Ico d={ICONS.print} size={15} />Print Again</button>
      <button className="btn primary" disabled={busy} onClick={onClose}><Ico d={ICONS.check} size={15} />Printed Correctly — Save</button>
    </>}>
    <p style={{ marginTop: 0 }}>Check <span className="mono" style={{ fontWeight: 600 }}>#{saved.ref}</span> for <span className="mono" style={{ fontWeight: 600 }}>{money(saved.amount)}</span> has opened in a new tab. Print it on your check stock at 100% scale, then confirm below. If no tab opened, your browser blocked it — use <strong>Print Again</strong>.</p>
    <p className="subtle" style={{ marginBottom: 0 }}>
      If the check misfeeds or prints crooked, choose <strong>It Didn't Print</strong>: the payment is reversed, {doc.number} goes back to open, and check #{saved.ref} is free to use again.
    </p>
  </Modal>;

  /* ---- recorded: hand over the paperwork, then close ---- */
  if (stage === "done") return <Modal title={"Payment Recorded · " + money(saved.amount)} onClose={onClose}
    foot={<button className="btn primary" onClick={onClose}><Ico d={ICONS.check} size={15} />Done</button>}>
    <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--pos-wash)", borderRadius: 9 }}>
      <div style={{ fontWeight: 600 }}>{money(saved.amount)} applied to {doc.number}</div>
      <div className="subtle">{saved.method}{saved.ref ? " #" + saved.ref : ""} · {fmtDate(saved.date)}</div>
    </div>
    <p className="subtle" style={{ marginTop: 0 }}>Send the {isBill ? "vendor a remittance advice" : "customer a receipt"} now, or just save.</p>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {onPrintCheck && <button className="btn" onClick={() => onPrintCheck(saved)}><Ico d={ICONS.print} size={15} />Print / Save PDF</button>}
      {onEmailDoc && <button className="btn" onClick={() => onEmailDoc(saved)}><Ico d={ICONS.mail} size={15} />Email Remittance</button>}
    </div>
  </Modal>;

  /* ---- entry ---- */
  return <Modal title={"Record Payment · " + doc.number} onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !!err} onClick={record}>{busy ? "Recording…" : "Record " + money(amt)}</button></>}>
    <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--canvas)", borderRadius: 9, display: "flex", justifyContent: "space-between" }}>
      <span className="subtle">Outstanding balance</span><span className="mono" style={{ fontWeight: 600, fontSize: 16 }}>{money(bal)}</span>
    </div>
    <div className="row">
      <Field label="Amount"><input className="input mono" type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      <Field label="Discount taken" hint={disc > 0 ? `Settles ${money(round2(amt + disc))} of the balance` : "Early-payment terms"}>
        <input className="input mono" type="number" step="any" value={discount} onChange={e => takeDiscount(e.target.value)} /></Field>
      <Field label="Date"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Method"><select className="select" value={method} onChange={e => pickMethod(e.target.value)}>
        {["Check", "ACH / Wire", "Credit Card", "Cash", "Other"].map(m => <option key={m}>{m}</option>)}
      </select></Field>
      <Field label={isCheck ? "Check #" : "Ref #"} hint={isCheck ? "Next unused check" : undefined}>
        <input className="input mono" value={ref} onChange={e => setRef(e.target.value)}
          style={refErr ? { borderColor: "var(--neg)" } : undefined} /></Field>
    </div>
    {refErr && <p className="subtle" style={{ margin: "0 0 8px", color: "var(--neg)" }}>{refErr}</p>}
    {isCheck && <p className="subtle" style={{ margin: "0 0 8px" }}>Recording prints the check on your stock (alignment in Settings → Check Printing), then asks you to confirm it printed.</p>}
    {(doc.payments || []).length > 0 && <><div className="divider"></div><div className="subtle" style={{ marginBottom: 8, fontWeight: 600 }}>Payment history</div>
      {doc.payments.map(p => <div key={p.id} className="cat-row"><span className="mono">{money(p.amount)}</span><span className="subtle">{p.method}{p.ref ? " #" + p.ref : ""}</span><span className="subtle" style={{ marginLeft: "auto" }}>{fmtDate(p.date)}</span>
        {onPrintCheck && <button className="btn ghost icon" title={p.method === "Check" ? "Print / save check" : "Print / save remittance"} onClick={() => onPrintCheck(p)}><Ico d={ICONS.print} size={14} /></button>}
        {onEmailDoc && p.method !== "Check" && <button className="btn ghost icon" title="Email remittance" onClick={() => onEmailDoc(p)}><Ico d={ICONS.mail} size={14} /></button>}
        {onDelete && <button className="btn ghost icon" title="Delete payment" onClick={() => { if (confirm("Delete this " + money(p.amount) + " payment?")) onDelete(p.id); }}><Ico d={ICONS.trash} size={14} /></button>}</div>)}</>}
  </Modal>;
}
