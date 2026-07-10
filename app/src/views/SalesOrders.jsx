import { money, fmtDate, nameOf } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { Ico, ICONS, Badge, Empty } from "../components/ui.jsx";

export default function SalesOrdersView({ db, actions, toast }) {
  const generateInvoice = async (so) => {
    const inv = await actions.generateInvoice(so);
    if (inv) toast("Invoice generated from " + so.number);
  };
  const del = async (id) => { if (!confirm("Delete this sales order?")) return; if (await actions.deleteSO(id)) toast("Deleted"); };

  return <div>
    <div className="card">
      {db.salesOrders.length === 0
        ? <Empty icon={ICONS.so} title="No sales orders" msg="Sales orders appear here when you accept a quote and convert it — that's when a customer PO comes in. From an SO you generate the invoice in one click." />
        : <table><thead><tr><th>Order</th><th>Customer</th><th>PO #</th><th>From Quote</th><th>Date</th><th>Status</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{db.salesOrders.slice().reverse().map(so => {
            const q = db.quotes.find(x => x.id === so.quoteId);
            return <tr key={so.id}>
              <td className="doc-id">{so.number}</td>
              <td>{nameOf(db, so.customerId)}</td>
              <td className="mono subtle">{so.poNumber || "—"}</td>
              <td className="mono subtle">{q ? q.number : "—"}</td>
              <td className="subtle">{fmtDate(so.date)}</td>
              <td><Badge status={so.status} /></td>
              <td className="num">{money(lineTotals(so.lineItems, so.taxRate).total)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {so.status === "open"
                  ? <button className="btn sm primary" onClick={() => generateInvoice(so)}><Ico d={ICONS.inv} size={14} />Generate Invoice</button>
                  : <span className="subtle">Invoiced ✓</span>}
                <button className="btn ghost icon" onClick={() => del(so.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
  </div>;
}
