import { money, fmtDate, todayISO, daysBetween, sum, nameOf } from "../lib/helpers.js";
import { lineTotals, paid, balance, invoiceStatus, billBalance } from "../calc/ledger.js";
import { canRead } from "../lib/permissions.js";
import { Ico, ICONS, Badge, Stat, Empty } from "../components/ui.jsx";

export default function Dashboard({ db, go, member }) {
  // Only surface the parts of the dashboard the user has access to. Admins and
  // owners read everything; a restricted user sees only their areas.
  const can = (area) => canRead(member, area);
  const canAR = can("receivables") || can("invoices");   // A/R + collections
  const canAP = can("payables");
  const canExp = can("expenses");
  const canQ = can("quotes");
  const canSO = can("salesOrders");
  const canInv = can("invoices") || can("receivables");

  const openQuotes = db.quotes.filter(q => q.status === "draft" || q.status === "sent");
  const openSOs = db.salesOrders.filter(s => s.status === "open");
  const openInv = db.invoices.filter(i => ["unpaid", "partial", "overdue"].includes(invoiceStatus(i)));
  const valQ = sum(openQuotes, q => lineTotals(q.lineItems, q.taxRate).total);
  const valS = sum(openSOs, s => lineTotals(s.lineItems, s.taxRate).total);
  const valI = sum(openInv, i => balance(i));
  const collected30 = sum(db.invoices, inv => sum((inv.payments || []).filter(p => daysBetween(p.date, todayISO()) <= 30 && daysBetween(p.date, todayISO()) >= 0), p => Number(p.amount) || 0));
  const arOut = sum(db.invoices, i => balance(i) > 0 ? balance(i) : 0);
  const apOut = sum(db.bills, b => { const bal = billBalance(b); return bal > 0 ? bal : 0; });
  const exp30 = sum(db.expenses.filter(e => daysBetween(e.date, todayISO()) <= 30 && daysBetween(e.date, todayISO()) >= 0), e => Number(e.amount) || 0);
  const overdue = db.invoices.filter(i => invoiceStatus(i) === "overdue");

  // KPI cards — only the ones this user can see.
  const stats = [
    canAR && <Stat key="ar" label="Open Receivables" value={money(arOut)} meta={openInv.length + " open invoice" + (openInv.length === 1 ? "" : "s")} />,
    canAR && <Stat key="col" label="Collected · 30d" value={money(collected30)} tone="pos" meta="payments received" />,
    canAP && <Stat key="ap" label="Payables Due" value={money(apOut)} tone={apOut > 0 ? "neg" : ""} meta={db.bills.length + " vendor bill" + (db.bills.length === 1 ? "" : "s")} />,
    canExp && <Stat key="exp" label="Expenses · 30d" value={money(exp30)} meta="recorded spend" />,
  ].filter(Boolean);

  // Pipeline stages — same gating; the arrow sits on every stage but the last.
  const stages = [
    canQ && { cls: "q", lbl: "Quotes Out", count: openQuotes.length, val: valQ },
    canSO && { cls: "s", lbl: "Sales Orders", count: openSOs.length, val: valS },
    canInv && { cls: "i", lbl: "Awaiting Payment", count: openInv.length, val: valI },
    canAR && { cls: "p", lbl: "Collected · 30d", count: db.invoices.filter(i => invoiceStatus(i) === "paid" && daysBetween(i.date, todayISO()) <= 60).length, val: collected30 },
  ].filter(Boolean);

  const recent = [
    ...(canQ ? db.quotes.map(q => ({ t: q.date, k: "quote", id: q.id, label: q.number, who: nameOf(db, q.customerId), amt: lineTotals(q.lineItems, q.taxRate).total, status: q.status })) : []),
    ...(canInv ? db.invoices.map(i => ({ t: i.date, k: "invoice", id: i.id, label: i.number, who: nameOf(db, i.customerId), amt: lineTotals(i.lineItems, i.taxRate).total, status: invoiceStatus(i) })) : []),
  ].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 6);

  return <div>
    {stats.length > 0 && <div className="grid" style={{ gridTemplateColumns: `repeat(${stats.length},1fr)`, marginBottom: 16 }}>{stats}</div>}

    {stages.length > 0 && <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Quote-to-Cash Pipeline</h3><span className="subtle" style={{ marginLeft: "auto" }}>Where value sits right now</span></div>
      <div className="pipeline">
        {stages.map((st, idx) => <div key={st.cls} className={"stage " + st.cls}>
          <div className="st-lbl"><span className="marker"></span>{st.lbl}</div>
          <div className="st-count">{st.count}</div>
          <div className="st-val">{money(st.val)}</div>
          {idx < stages.length - 1 && <div className="arrow"><Ico d={ICONS.arrow} size={11} /></div>}
        </div>)}
      </div>
    </div>}

    {canInv && overdue.length > 0 &&
      <div className="card" style={{ marginBottom: 16, borderColor: "var(--neg-wash)" }}>
        <div className="card-head" style={{ background: "var(--neg-wash)", borderRadius: "10px 10px 0 0" }}>
          <h3 style={{ color: "var(--neg)" }}>{overdue.length} Overdue Invoice{overdue.length > 1 ? "s" : ""}</h3>
          <span className="mono" style={{ marginLeft: "auto", color: "var(--neg)", fontWeight: 600 }}>{money(sum(overdue, balance))}</span>
        </div>
        <table><tbody>
          {overdue.map(i => <tr key={i.id} className="clickable" onClick={() => go("invoices")}>
            <td className="doc-id">{i.number}</td><td>{nameOf(db, i.customerId)}</td>
            <td className="subtle">{Math.abs(daysBetween(i.dueDate, todayISO()))} days late</td>
            <td className="num" style={{ fontWeight: 600 }}>{money(balance(i))}</td>
          </tr>)}
        </tbody></table>
      </div>}

    <div className="card">
      <div className="card-head"><h3>Recent Activity</h3></div>
      {recent.length === 0
        ? <Empty icon={ICONS.dash} title="Nothing here yet" msg={canQ ? "Create your first quote to start the pipeline." : "Activity you have access to will show up here."}
          action={canQ && <button className="btn primary" onClick={() => go("quotes")}><Ico d={ICONS.plus} size={15} />New Quote</button>} />
        : <table><thead><tr><th>Document</th><th>Customer</th><th>Date</th><th>Status</th><th className="num">Amount</th></tr></thead>
          <tbody>{recent.map((r, i) => <tr key={i} className="clickable" onClick={() => go(r.k === "quote" ? "quotes" : "invoices")}>
            <td className="doc-id">{r.label}</td><td>{r.who}</td><td className="subtle">{fmtDate(r.t)}</td>
            <td><Badge status={r.status} /></td><td className="num">{money(r.amt)}</td>
          </tr>)}</tbody></table>}
    </div>
  </div>;
}
