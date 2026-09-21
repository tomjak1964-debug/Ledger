import { useState, useMemo } from "react";
import { money, fmtDate, todayISO, nameOf } from "../lib/helpers.js";
import { balance, round2 } from "../calc/ledger.js";
import { Modal, Field, Ico, ICONS } from "./ui.jsx";
import { openCredits, openInvoicesFor, creditRemaining, allocateOldestFirst } from "../lib/credits.js";

// Spend an open credit against that customer's invoices. Nothing is applied
// until an amount is typed — "Oldest first" fills it the usual way in one
// click. No cash moves: the invoice and the credit each get a payment row and
// the pair cancels out (see applyCredit in store.js).
export default function ApplyCreditModal({ db, customerId, creditId, focusInvoiceId, onClose, onApply }) {
  const credits = openCredits(db, customerId);
  const [pickId, setPickId] = useState(creditId || credits[0]?.id || "");
  const credit = credits.find(c => c.id === pickId) || credits[0];
  const remaining = credit ? creditRemaining(credit) : 0;
  const invoices = useMemo(() => openInvoicesFor(db, credit?.customerId).filter(i => i.id !== credit?.id), [db, credit]);
  const [amounts, setAmounts] = useState(() => (focusInvoiceId && credit
    ? { [focusInvoiceId]: round2(Math.min(creditRemaining(credit), balance(db.invoices.find(i => i.id === focusInvoiceId) || {}) || 0)) }
    : {}));
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const applied = round2(invoices.reduce((s, i) => s + (Number(amounts[i.id]) || 0), 0));
  const over = applied > remaining + 0.005;
  const tooMuch = invoices.find(i => (Number(amounts[i.id]) || 0) > round2(balance(i)) + 0.005);
  // The per-invoice complaint is the more precise one, so it goes first: told
  // "more than the credit has" while typing 5,000 into a 2,000 invoice, you'd
  // fix the wrong number.
  const err = !credit ? "This customer has no open credits."
    : tooMuch ? `${money(Number(amounts[tooMuch.id]))} is more than ${tooMuch.number} still owes (${money(balance(tooMuch))}).`
      : over ? `That applies ${money(applied)}, but ${credit.number} only has ${money(remaining)} left.` : "";

  const set = (id, v) => setAmounts(a => ({ ...a, [id]: v }));
  const oldestFirst = () => setAmounts(allocateOldestFirst(remaining, invoices));
  const apply = async () => {
    setBusy(true);
    const ok = await onApply(credit.id, invoices.map(i => ({ invoiceId: i.id, amount: amounts[i.id] })), { date });
    setBusy(false);
    if (ok) onClose();
  };

  return <Modal wide title="Apply Credit" onClose={onClose}
    foot={<>
      <div className="subtle" style={{ marginRight: "auto", alignSelf: "center" }}>
        {credit ? `${money(applied)} of ${money(remaining)} applied` : ""}
      </div>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !!err || applied <= 0.005} onClick={apply}>
        {busy ? "Applying…" : "Apply " + money(applied)}</button>
    </>}>
    <div className="row">
      <Field label="Credit" hint={credit ? nameOf(db, credit.customerId) : undefined}>
        <select className="select" value={pickId} onChange={e => { setPickId(e.target.value); setAmounts({}); }}>
          {credits.map(c => <option key={c.id} value={c.id}>{c.number} — {money(creditRemaining(c))} available</option>)}
        </select>
      </Field>
      <Field label="Date applied"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
    </div>
    <p className="subtle" style={{ marginTop: 0 }}>No money changes hands — the credit settles the invoices it is applied to, and
      what is left stays on the credit for next time.</p>
    {invoices.length === 0
      ? <p className="subtle">{nameOf(db, credit?.customerId)} has no open invoices to apply this to.</p>
      : <>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <span className="subtle">Type what to put against each invoice.</span>
          <button className="btn sm" style={{ marginLeft: "auto" }} onClick={oldestFirst}>Oldest first</button>
          <button className="btn sm" disabled={applied <= 0.005} onClick={() => setAmounts({})}>Clear</button>
        </div>
        <table><thead><tr><th>Invoice</th><th>Due</th><th className="num">Owed</th><th className="num">Apply</th></tr></thead>
          <tbody>{invoices.map(i => <tr key={i.id}>
            <td className="doc-id">{i.number}</td>
            <td className="subtle">{fmtDate(i.dueDate)}</td>
            <td className="num mono">{money(balance(i))}</td>
            <td className="num"><input className="input mono" style={{ maxWidth: 120, textAlign: "right" }} type="number" step="any"
              value={amounts[i.id] ?? ""} placeholder="0.00" onChange={e => set(i.id, e.target.value)} /></td>
          </tr>)}</tbody></table>
      </>}
    {err && <p className="subtle" style={{ margin: "10px 0 0", color: "var(--neg)" }}>{err}</p>}
    {!err && applied > 0.005 && round2(remaining - applied) > 0.005 && <p className="subtle" style={{ margin: "10px 0 0" }}>
      <Ico d={ICONS.check} size={14} /> {money(round2(remaining - applied))} stays on {credit.number}.</p>}
  </Modal>;
}
