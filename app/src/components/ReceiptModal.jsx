import { useState, useMemo } from "react";
import { money, fmtDate, todayISO } from "../lib/helpers.js";
import { lineTotals, balance, round2 } from "../calc/ledger.js";
import { Modal, Field, Badge } from "./ui.jsx";

// Customer-first cash receipt: pick a customer, see every open item (regular
// invoices AND credit invoices), tick the ones this check/transfer covers, and
// apply an amount per line. Credits default to their negative balance so they
// net against the invoices on the same receipt. The live "Amount received" is
// the sum of applied lines — the actual cash landing in the bank.
export default function ReceiptModal({ db, preselectCustomerId, onClose, onSave }) {
  const customers = db.contacts.filter(c => c.type === "customer");
  const [customerId, setCustomerId] = useState(preselectCustomerId || "");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("Check");
  const [ref, setRef] = useState("");
  const [saving, setSaving] = useState(false);
  // Explicit per-invoice overrides: { [id]: { checked, amount } }. Anything not
  // in here uses the default (checked, applied = full balance).
  const [alloc, setAlloc] = useState({});

  const items = useMemo(() => db.invoices
    .filter(i => i.customerId === customerId && Math.abs(balance(i)) > 0.005)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "")), [db.invoices, customerId]);

  const eff = (i) => alloc[i.id] || { checked: true, amount: round2(balance(i)) };
  const net = round2(items.reduce((s, i) => { const a = eff(i); return s + (a.checked ? (Number(a.amount) || 0) : 0); }, 0));
  const selectedCount = items.filter(i => eff(i).checked && Math.abs(Number(eff(i).amount) || 0) > 0.005).length;

  const pickCustomer = (id) => { setCustomerId(id); setAlloc({}); };
  const setLine = (i, patch) => setAlloc(prev => ({ ...prev, [i.id]: { ...eff(i), ...patch } }));

  const submit = async () => {
    const allocations = items.filter(i => eff(i).checked).map(i => ({ invoiceId: i.id, amount: eff(i).amount }));
    setSaving(true);
    const ok = await onSave(allocations, { date, method, ref });
    setSaving(false);
    if (ok) onClose();
  };

  return <Modal title="Receive Payment" onClose={onClose} wide
    foot={<>
      <div className="subtle" style={{ marginRight: "auto", alignSelf: "center" }}>
        {selectedCount ? `${selectedCount} item${selectedCount > 1 ? "s" : ""} selected` : "Select the items this receipt covers"}
      </div>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={saving || net === 0 || !selectedCount} onClick={submit}>
        {saving ? "Recording…" : "Record " + money(net)}
      </button>
    </>}>
    <div className="row">
      <Field label="Customer"><select className="select" value={customerId} onChange={e => pickCustomer(e.target.value)}>
        <option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></Field>
      <Field label="Date"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Method"><select className="select" value={method} onChange={e => setMethod(e.target.value)}>
        {["Check", "ACH / Wire", "Credit Card", "Cash", "Other"].map(m => <option key={m}>{m}</option>)}
      </select></Field>
      <Field label="Check # / Ref"><input className="input mono" value={ref} onChange={e => setRef(e.target.value)} /></Field>
    </div>

    <div className="divider"></div>

    {!customerId
      ? <p className="subtle" style={{ margin: "8px 0" }}>Choose a customer to see their open invoices and credits.</p>
      : items.length === 0
        ? <p className="subtle" style={{ margin: "8px 0" }}>Nothing open for this customer — every invoice is settled.</p>
        : <table><thead><tr>
          <th style={{ width: 34 }}></th><th>Invoice</th><th>Date</th><th>Due</th><th></th>
          <th className="num">Balance</th><th className="num" style={{ width: 150 }}>Applied</th>
        </tr></thead>
          <tbody>{items.map(i => {
            const a = eff(i); const bal = round2(balance(i)); const isCredit = lineTotals(i.lineItems, i.taxRate).total < 0;
            return <tr key={i.id} style={a.checked ? {} : { opacity: 0.5 }}>
              <td><input type="checkbox" checked={a.checked} onChange={e => setLine(i, { checked: e.target.checked })} /></td>
              <td className="doc-id">{i.number}</td>
              <td className="subtle">{fmtDate(i.date)}</td>
              <td className="subtle">{fmtDate(i.dueDate)}</td>
              <td>{isCredit && <Badge status="credit" />}</td>
              <td className="num" style={{ fontWeight: 600, color: bal < 0 ? "var(--accent)" : undefined }}>{money(bal)}</td>
              <td className="num"><input className="input mono" type="number" step="any" style={{ textAlign: "right" }}
                value={a.amount} disabled={!a.checked} onChange={e => setLine(i, { amount: e.target.value })} /></td>
            </tr>;
          })}</tbody></table>}

    <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--canvas)", borderRadius: 9, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="subtle">Amount received</span>
      <span className="mono" style={{ fontWeight: 700, fontSize: 18, color: net < 0 ? "var(--accent)" : undefined }}>{money(net)}</span>
    </div>
    {net < 0 && <p className="subtle" style={{ margin: "8px 0 0", color: "var(--accent)" }}>This receipt nets negative — the selected credits exceed the invoices. Add the invoices being paid, or record it to carry the credit.</p>}
  </Modal>;
}
