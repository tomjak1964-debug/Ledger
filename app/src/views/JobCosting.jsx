import { money, nameOf } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { Ico, ICONS, Empty } from "../components/ui.jsx";

// Profitability per job (sales order): invoiced revenue minus labor cost (logged
// time × cost rate) and materials (expenses + bills tagged to the job). Only
// jobs with some activity are shown.
export default function JobCostingView({ db }) {
  const rows = db.salesOrders.map(so => {
    const revenue = db.invoices.filter(i => i.salesOrderId === so.id)
      .reduce((s, i) => s + lineTotals(i.lineItems, i.taxRate).sub, 0);
    const time = db.timeEntries.filter(t => t.salesOrderId === so.id);
    const labor = time.reduce((s, t) => s + (Number(t.hours) || 0) * (Number(t.cost) || 0), 0);
    const unbilled = time.filter(t => !t.invoiceId).reduce((s, t) => s + (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
    const materials = db.expenses.filter(e => e.salesOrderId === so.id).reduce((s, e) => s + (Number(e.amount) || 0), 0)
      + db.bills.filter(b => b.salesOrderId === so.id).reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const cost = labor + materials;
    const margin = revenue - cost;
    return { so, revenue, labor, materials, cost, margin, unbilled, pct: revenue > 0 ? (margin / revenue) * 100 : null };
  }).filter(r => r.revenue || r.cost || r.unbilled).reverse();

  const tot = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, labor: a.labor + r.labor, materials: a.materials + r.materials, cost: a.cost + r.cost, margin: a.margin + r.margin }),
    { revenue: 0, labor: 0, materials: 0, cost: 0, margin: 0 });
  const marginColor = m => m > 0.005 ? "var(--pos)" : m < -0.005 ? "var(--neg)" : undefined;

  return <div>
    <div className="grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 16 }}>
      <div className="stat"><div className="lbl">Revenue (invoiced)</div><div className="val mono">{money(tot.revenue)}</div></div>
      <div className="stat"><div className="lbl">Labor Cost</div><div className="val mono">{money(tot.labor)}</div></div>
      <div className="stat"><div className="lbl">Materials</div><div className="val mono">{money(tot.materials)}</div></div>
      <div className="stat"><div className="lbl">Margin</div><div className="val mono" style={{ color: marginColor(tot.margin) }}>{money(tot.margin)}</div></div>
    </div>
    <div className="card">
      <div className="card-head"><h3>Job Profitability</h3></div>
      {rows.length === 0
        ? <Empty icon={ICONS.job} title="No job costs yet" msg="Bill a job, log time against it, or tag expenses/bills to a sales order — profitability shows up here." />
        : <table><thead><tr>
          <th>Job</th><th>Customer</th><th className="num">Revenue</th><th className="num">Labor</th><th className="num">Materials</th>
          <th className="num">Total Cost</th><th className="num">Margin</th><th className="num">Margin %</th><th className="num">Unbilled time</th>
        </tr></thead>
          <tbody>{rows.map(r => <tr key={r.so.id}>
            <td className="doc-id">{r.so.number}</td>
            <td>{nameOf(db, r.so.customerId)}</td>
            <td className="num mono">{money(r.revenue)}</td>
            <td className="num mono">{money(r.labor)}</td>
            <td className="num mono">{money(r.materials)}</td>
            <td className="num mono">{money(r.cost)}</td>
            <td className="num mono" style={{ fontWeight: 600, color: marginColor(r.margin) }}>{money(r.margin)}</td>
            <td className="num mono" style={{ color: marginColor(r.margin) }}>{r.pct === null ? "—" : r.pct.toFixed(0) + "%"}</td>
            <td className="num mono subtle">{r.unbilled > 0.005 ? money(r.unbilled) : "—"}</td>
          </tr>)}</tbody></table>}
    </div>
    <p className="subtle" style={{ marginTop: 10 }}>Revenue is pre-tax invoiced amount. Labor uses each time entry's snapshot cost rate. Materials are expenses and vendor bills tagged to the job. "Unbilled time" is billable hours logged but not yet on an invoice.</p>
  </div>;
}
