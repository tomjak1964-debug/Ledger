import { useState } from "react";
import { money, fmtDate, nameOf } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { Ico, ICONS, Badge, Empty } from "../components/ui.jsx";
import InvoiceFromSOModal from "../components/InvoiceFromSOModal.jsx";

export default function SalesOrdersView({ db, actions, toast, openDoc, readOnly }) {
  const [invoiceSO, setInvoiceSO] = useState(null);
  const del = async (id) => { if (!confirm("Delete this sales order?")) return; if (await actions.deleteSO(id)) toast("Deleted"); };
  const reopen = async (so) => {
    if (!confirm(`Reopen ${so.number} for invoicing? Its prior invoice no longer exists.`)) return;
    if (await actions.reopenSO(so.id)) toast(so.number + " reopened");
  };
  // Generate from the modal, then open the new invoice so it can be printed.
  const generate = async (so, ids, opts) => {
    const inv = await actions.generateInvoice(so, ids, opts);
    if (inv) { toast("Invoice " + inv.number + " generated"); openDoc("invoice", inv); }
    return inv;
  };

  return <div>
    <div className="card">
      {db.salesOrders.length === 0
        ? <Empty icon={ICONS.so} title="No sales orders" msg="Sales orders appear here when you accept a quote and convert it — that's when a customer PO comes in. From an SO you pick which line items to invoice, so you can bill in phases." />
        : <table><thead><tr><th>Order</th><th>Customer</th><th>PO #</th><th>From Quote</th><th>Date</th><th>Status</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{db.salesOrders.slice().reverse().map(so => {
            const q = db.quotes.find(x => x.id === so.quoteId);
            const lines = so.lineItems || [];
            const billed = lines.filter(li => li.invoiced);
            const openLines = lines.filter(li => !li.invoiced);
            const remaining = lineTotals(openLines, so.taxRate).total;
            const total = lineTotals(lines, so.taxRate).total;
            const invoiceExists = db.invoices.some(i => i.salesOrderId === so.id);
            const orphaned = so.status === "invoiced" && !invoiceExists;
            // derived badge: partially-billed open orders read as "partial"
            const badge = orphaned ? "open" : (so.status === "open" && billed.length ? "partial" : so.status);
            return <tr key={so.id}>
              <td className="doc-id">{so.number}</td>
              <td>{nameOf(db, so.customerId)}</td>
              <td className="mono subtle">{so.poNumber || "—"}</td>
              <td className="mono subtle">{q ? q.number : "—"}</td>
              <td className="subtle">{fmtDate(so.date)}</td>
              <td><Badge status={badge} />{so.status === "open" && billed.length > 0 &&
                <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>{money(remaining)} left to invoice</div>}</td>
              <td className="num">{money(total)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {(so.status === "open"
                  ? !readOnly && <button className="btn sm primary" onClick={() => setInvoiceSO(so)}><Ico d={ICONS.inv} size={14} />Invoice…</button>
                  : orphaned
                    ? !readOnly && <button className="btn sm" title="Prior invoice was deleted" onClick={() => reopen(so)}><Ico d={ICONS.refresh} size={14} />Reopen</button>
                    : <span className="subtle">Invoiced ✓</span>)}
                {!readOnly && <button className="btn ghost icon" onClick={() => del(so.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {invoiceSO && <InvoiceFromSOModal so={invoiceSO} db={db} onClose={() => setInvoiceSO(null)}
      onGenerate={(ids, opts) => generate(invoiceSO, ids, opts)} />}
  </div>;
}
