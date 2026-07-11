import { useState } from "react";
import { money, fmtDate, todayISO, daysBetween, nameOf } from "../lib/helpers.js";
import { balance, invoiceStatus, agingBuckets } from "../calc/ledger.js";
import { Ico, ICONS, Badge, Empty } from "../components/ui.jsx";
import PaymentModal from "../components/PaymentModal.jsx";

export default function ReceivablesView({ db, actions, toast, openDoc }) {
  const [pay, setPay] = useState(null);
  const open = db.invoices.filter(i => balance(i) > 0.005);
  const b = agingBuckets(open, i => i.dueDate, balance);
  const total = b.cur + b.d30 + b.d60 + b.d90 + b.d90p;
  return <div>
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
      </div>
    </div>
    <div className="card">
      <div className="card-head"><h3>Open Invoices</h3></div>
      {open.length === 0
        ? <Empty icon={ICONS.ar} title="Nothing outstanding" msg="All invoices are paid. Receivables shows what customers still owe you, bucketed by age." />
        : <table><thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th>Age</th><th>Status</th><th className="num">Balance</th><th></th></tr></thead>
          <tbody>{open.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || "")).map(inv => {
            const od = daysBetween(inv.dueDate, todayISO());
            return <tr key={inv.id}>
              <td className="doc-id">{inv.number}</td><td>{nameOf(db, inv.customerId)}</td>
              <td className="subtle">{fmtDate(inv.dueDate)}</td>
              <td className={od > 0 ? "" : "subtle"} style={od > 0 ? { color: "var(--neg)", fontWeight: 600 } : {}}>{od > 0 ? od + "d late" : "current"}</td>
              <td><Badge status={invoiceStatus(inv)} /></td>
              <td className="num" style={{ fontWeight: 600 }}>{money(balance(inv))}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn sm primary" onClick={() => setPay(inv)}>Record Payment</button>
                <button className="btn ghost icon" title="Print" onClick={() => openDoc("invoice", inv)}><Ico d={ICONS.print} size={16} /></button>
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
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
