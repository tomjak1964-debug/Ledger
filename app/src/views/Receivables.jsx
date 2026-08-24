import { useState } from "react";
import { money, fmtDate, todayISO, daysBetween, nameOf } from "../lib/helpers.js";
import { lineTotals, balance, invoiceStatus, agingBuckets, round2 } from "../calc/ledger.js";
import { Ico, ICONS, Badge, Empty, SortTh, useTableSort } from "../components/ui.jsx";
import PaymentModal from "../components/PaymentModal.jsx";
import ReceiptModal from "../components/ReceiptModal.jsx";
import EmailModal from "../components/EmailModal.jsx";
import { invoicePdf } from "../lib/invoicePdf.js";

export default function ReceivablesView({ db, actions, toast, openDoc, readOnly }) {
  const [pay, setPay] = useState(null);
  const [receipt, setReceipt] = useState(false);
  const [remind, setRemind] = useState(null);
  // Every invoice with a non-zero balance: positive balances are owed to us,
  // negative balances are open credits waiting to be applied.
  const open = db.invoices.filter(i => Math.abs(balance(i)) > 0.005);
  const b = agingBuckets(open, i => i.dueDate, balance);      // positive balances only
  const total = b.cur + b.d30 + b.d60 + b.d90 + b.d90p;
  const credits = open.filter(i => balance(i) < -0.005);
  const creditTotal = round2(credits.reduce((s, i) => s + balance(i), 0));
  const isCredit = i => lineTotals(i.lineItems, i.taxRate).total < 0;
  const { sorted: arRows, sort, onSort } = useTableSort(open, {
    number: i => i.number, customer: i => nameOf(db, i.customerId), due: i => i.dueDate,
    age: i => daysBetween(i.dueDate, todayISO()), status: i => invoiceStatus(i), balance: i => balance(i),
  }, { key: "due", dir: "asc" });

  return <div>
    {!readOnly && <div className="toolbar">
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setReceipt(true)}>
        <Ico d={ICONS.money} size={15} />Receive Payment
      </button>
    </div>}
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>A/R Aging</h3><span className="mono" style={{ marginLeft: "auto", fontWeight: 600, fontSize: 16 }}>{money(total)}</span></div>
      <div className="card-body">
        <div className="aging">
          <div className="bucket"><div className="b-lbl">Current</div><div className="b-val">{money(b.cur)}</div></div>
          <div className="bucket"><div className="b-lbl">1–30 days</div><div className="b-val">{money(b.d30)}</div></div>
          <div className="bucket hot"><div className="b-lbl">31–60 days</div><div className="b-val">{money(b.d60)}</div></div>
          <div className="bucket hot"><div className="b-lbl">61–90 days</div><div className="b-val">{money(b.d90)}</div></div>
          <div className="bucket hot"><div className="b-lbl">90+ days</div><div className="b-val">{money(b.d90p)}</div></div>
        </div>
        {creditTotal < -0.005 && <p className="subtle" style={{ margin: "12px 0 0" }}>
          Open credits: <span className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{money(creditTotal)}</span> across {credits.length} credit invoice{credits.length > 1 ? "s" : ""} — apply them on a receipt.
        </p>}
      </div>
    </div>
    <div className="card">
      <div className="card-head"><h3>Open Invoices</h3></div>
      {open.length === 0
        ? <Empty icon={ICONS.ar} title="Nothing outstanding" msg="All invoices are paid. Receivables shows what customers still owe you, bucketed by age." />
        : <table><thead><tr>
          <SortTh label="Invoice" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
          <SortTh label="Due" col="due" sort={sort} onSort={onSort} />
          <SortTh label="Age" col="age" sort={sort} onSort={onSort} />
          <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
          <SortTh label="Balance" col="balance" sort={sort} onSort={onSort} num /><th></th></tr></thead>
          <tbody>{arRows.map(inv => {
            const od = daysBetween(inv.dueDate, todayISO());
            const credit = isCredit(inv);
            return <tr key={inv.id}>
              <td className="doc-id">{inv.number}</td><td>{nameOf(db, inv.customerId)}</td>
              <td className="subtle">{fmtDate(inv.dueDate)}</td>
              <td className={od > 0 && !credit ? "" : "subtle"} style={od > 0 && !credit ? { color: "var(--neg)", fontWeight: 600 } : {}}>{credit ? "—" : od > 0 ? od + "d late" : "current"}</td>
              <td><Badge status={credit ? "credit" : invoiceStatus(inv)} /></td>
              <td className="num" style={{ fontWeight: 600, color: balance(inv) < 0 ? "var(--accent)" : undefined }}>{money(balance(inv))}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && !credit && <button className="btn sm primary" onClick={() => setPay(inv)}>Record Payment</button>}
                {!readOnly && !credit && od > 0 && <button className="btn ghost icon" title="Email payment reminder" onClick={() => setRemind(inv)}><Ico d={ICONS.mail} size={16} /></button>}
                <button className="btn ghost icon" title="Print" onClick={() => openDoc("invoice", inv)}><Ico d={ICONS.print} size={16} /></button>
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {receipt && <ReceiptModal db={db} onClose={() => setReceipt(false)}
      onSave={async (allocations, meta) => {
        const ok = await actions.recordReceipt(allocations, meta);
        if (ok) toast("Receipt recorded");
        return ok;
      }} />}
    {remind && <EmailModal
      title={"Payment Reminder · " + remind.number}
      defaultTo={db.contactPeople.find(p => p.id === remind.contactPersonId)?.email || db.contacts.find(c => c.id === remind.customerId)?.email || ""}
      defaultSubject={`Payment reminder — invoice ${remind.number} (${db.settings.company})`}
      defaultBody={`Hello,\n\nA friendly reminder that invoice ${remind.number} for ${money(balance(remind))} was due ${fmtDate(remind.dueDate)} and is now ${daysBetween(remind.dueDate, todayISO())} days past due.\n\nPlease remit at your earliest convenience. If payment is already on the way, thank you and please disregard.\n\n${db.settings.company}\n${db.settings.companyPhone || ""}`}
      buildAttachment={() => invoicePdf(remind, db)}
      onClose={() => setRemind(null)} toast={toast} />}
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
