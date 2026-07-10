import { useState } from "react";
import { money, fmtDate, nameOf } from "../lib/helpers.js";
import { lineTotals, balance, invoiceStatus } from "../calc/ledger.js";
import { Ico, ICONS, Badge, Empty } from "../components/ui.jsx";
import PaymentModal from "../components/PaymentModal.jsx";

export default function InvoicesView({ db, actions, toast, openDoc }) {
  const [pay, setPay] = useState(null);
  const del = async (id) => { if (!confirm("Delete this invoice?")) return; if (await actions.deleteInvoice(id)) toast("Deleted"); };
  return <div>
    <div className="card">
      {db.invoices.length === 0
        ? <Empty icon={ICONS.inv} title="No invoices" msg="Generate an invoice from a sales order and it lands here. Record payments to update its status and clear it from receivables." />
        : <table><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th><th></th></tr></thead>
          <tbody>{db.invoices.slice().reverse().map(inv => {
            const st = invoiceStatus(inv);
            return <tr key={inv.id}>
              <td className="doc-id">{inv.number}</td>
              <td>{nameOf(db, inv.customerId)}</td>
              <td className="subtle">{fmtDate(inv.date)}</td>
              <td className="subtle">{fmtDate(inv.dueDate)}</td>
              <td><Badge status={st} /></td>
              <td className="num">{money(lineTotals(inv.lineItems, inv.taxRate).total)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(balance(inv))}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {st !== "paid" && <button className="btn sm" onClick={() => setPay(inv)}><Ico d={ICONS.money} size={14} />Payment</button>}
                <button className="btn ghost icon" title="Print" onClick={() => openDoc("invoice", inv)}><Ico d={ICONS.print} size={16} /></button>
                <button className="btn ghost icon" onClick={() => del(inv.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {pay && <PaymentModal doc={pay} onClose={() => setPay(null)} onSave={async (p) => {
      if (await actions.recordPayment("invoice", pay.id, p)) { setPay(null); toast("Payment recorded"); }
    }} />}
  </div>;
}
