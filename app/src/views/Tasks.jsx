import { useState } from "react";
import { money, fmtDate, nameOf } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { Ico, ICONS, Empty } from "../components/ui.jsx";
import InvoiceFromSOModal from "../components/InvoiceFromSOModal.jsx";

// Work waiting on the user. Today's only task type is "create invoice" — raised
// when a job has items marked ready. Acting on it opens the invoice modal
// pre-selected to the ready items; billing them closes the task automatically.
export default function TasksView({ db, actions, toast, openDoc, readOnly }) {
  const [invoiceSO, setInvoiceSO] = useState(null);
  const openTasks = (db.tasks || []).filter(t => t.status === "open");

  const generate = async (so, ids, opts, print) => {
    const inv = await actions.generateInvoice(so, ids, opts);
    if (inv) { toast("Invoice " + inv.number + " generated"); if (print) openDoc("invoice", inv); }
    return inv;
  };
  const dismiss = async (t) => { if (confirm("Dismiss this task?") && await actions.setTaskStatus(t.id, "dismissed")) toast("Task dismissed"); };

  return <div>
    <div className="card">
      <div className="card-head"><h3>Open Tasks</h3></div>
      {openTasks.length === 0
        ? <Empty icon={ICONS.task} title="All clear" msg="When someone marks a job's items ready to invoice, a task shows up here for whoever can create invoices." />
        : <table><thead><tr><th>Task</th><th>Job</th><th>Customer</th><th className="num">Ready to bill</th><th></th></tr></thead>
          <tbody>{openTasks.map(t => {
            const so = db.salesOrders.find(s => s.id === t.salesOrderId);
            const readyLines = so ? (so.lineItems || []).filter(li => li.ready && !li.invoiced) : [];
            const readyVal = lineTotals(readyLines, so?.taxRate).total;
            return <tr key={t.id}>
              <td>{t.title || "Create invoice"}</td>
              <td className="doc-id">{so ? so.number : "—"}</td>
              <td>{so ? nameOf(db, so.customerId) : t.detail}</td>
              <td className="num mono">{readyLines.length ? money(readyVal) : "—"}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && so && <button className="btn sm primary" onClick={() => setInvoiceSO(so)}><Ico d={ICONS.inv} size={14} />Create Invoice</button>}
                {!readOnly && <button className="btn ghost sm" onClick={() => dismiss(t)}>Dismiss</button>}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {invoiceSO && <InvoiceFromSOModal so={invoiceSO} db={db} onlyReady onClose={() => setInvoiceSO(null)}
      onGenerate={(ids, opts, print) => generate(invoiceSO, ids, opts, print)} />}
  </div>;
}
