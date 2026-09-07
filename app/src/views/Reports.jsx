import { Fragment, useState } from "react";
import { money, fmtDate, todayISO, daysBetween, nameOf } from "../lib/helpers.js";
import { balance, invoiceStatus } from "../calc/ledger.js";
import { rangeFor, defaultCustom } from "../lib/dateRanges.js";
import {
  plCashBasis, salesTaxReport, salesByCustomer, expensesByCategory, customerStatement,
  agedReceivables, agedPayables, incomeExpenseByMonth, receiptGroups,
} from "../calc/reports.js";
import { Ico, ICONS, Badge, Empty } from "../components/ui.jsx";
import FilterBar, { rangeLabel } from "../components/FilterBar.jsx";

/* ---------- CSV export ---------- */
function downloadCSV(name, header, rows) {
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [header, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name + "-" + todayISO() + ".csv";
  a.click();
}

/* ---------- the report catalog ----------
   Categories mirror Sage 50's "Select a Report or Form" rail, so the list is
   familiar even where this app has nothing to put in a category yet (Payroll,
   Inventory, and friends stay visible but empty rather than silently missing).
   Every report declares which party filter applies to it; `party: null` means
   the report is company-wide and a customer/vendor filter would misrepresent it
   (a P&L can't attribute overhead to one customer). */
const REPORTS = {
  pl: { label: "Profit & Loss", blurb: "Cash-basis income against expenses and bill payments.", party: null, Render: ProfitLoss },
  ie: { label: "Cash Flow by Month", blurb: "Month-by-month cash in, cash out, and the net.", party: null, Render: IncomeExpense },
  ar: { label: "Aged Receivables", blurb: "What each customer owes, bucketed by how late it is.", party: "customer", asOf: true, Render: AgedReceivablesReport },
  customers: { label: "Sales by Customer", blurb: "Invoiced, collected, and still open — per customer.", party: "customer", Render: SalesByCustomer },
  receipts: { label: "Receipts Register", blurb: "Every payment received, by check or reference, with the invoices it covered.", party: "customer", Render: ReceiptsReport },
  statement: { label: "Customer Statement", blurb: "One customer's open invoices, ready to print and send.", party: "customer", Render: Statements },
  tax: { label: "Sales Tax", blurb: "Tax invoiced (accrual) and tax collected (cash).", party: "customer", Render: SalesTax },
  ap: { label: "Aged Payables", blurb: "What you owe each vendor, bucketed by how late it is.", party: "vendor", asOf: true, Render: AgedPayablesReport },
  payments: { label: "Payments Register", blurb: "Every payment made, by check or reference, with the bills it covered.", party: "vendor", Render: PaymentsReport },
  expenses: { label: "Expenses by Category", blurb: "Where the money went, grouped by category.", party: null, Render: ExpenseReport },
};

const CATEGORIES = [
  { key: "ar", label: "Accounts Receivable", icon: ICONS.ar, blurb: "Customers, what they owe, what they've paid, and sales tax.", reports: ["ar", "customers", "receipts", "statement", "tax"] },
  { key: "ap", label: "Accounts Payable", icon: ICONS.ap, blurb: "Vendors, open bills, and the checks that paid them.", reports: ["ap", "payments"] },
  { key: "payroll", label: "Payroll", icon: ICONS.contacts, blurb: "Wages and payroll taxes.", reports: [] },
  { key: "gl", label: "General Ledger", icon: ICONS.catalog, blurb: "Account activity and journal detail.", reports: [] },
  { key: "financial", label: "Financial Statements", icon: ICONS.reports, blurb: "Profit and loss, and cash in versus cash out.", reports: ["pl", "ie"] },
  { key: "inventory", label: "Inventory", icon: ICONS.catalog, blurb: "Stock on hand and item movement.", reports: [] },
  { key: "jobs", label: "Job Reports", icon: ICONS.job, blurb: "Cost and profit per job.", reports: [] },
  { key: "recon", label: "Account Reconciliation", icon: ICONS.check, blurb: "Bank statements against the register.", reports: [] },
  { key: "time", label: "Time/Expense Reports", icon: ICONS.clock, blurb: "Hours logged and business spending.", reports: ["expenses"] },
  { key: "company", label: "Company Reports", icon: ICONS.settings, blurb: "Company-wide lists and settings.", reports: [] },
];

export default function ReportsView({ db }) {
  const [catKey, setCatKey] = useState("ar");
  const [rptKey, setRptKey] = useState("");
  const [preset, setPreset] = useState("thisYear");
  const [custom, setCustom] = useState(defaultCustom);
  const [partyId, setPartyId] = useState("");

  const cat = CATEGORIES.find(c => c.key === catKey) || CATEGORIES[0];
  const rpt = REPORTS[rptKey];
  const [from, to] = rangeFor(preset, custom);
  const pickCat = (k) => { setCatKey(k); setRptKey(""); };
  const openReport = (k) => { setRptKey(k); setPartyId(""); };

  const asOf = rpt?.asOf ? (to || todayISO()) : undefined;
  const label = rpt?.asOf ? "As of " + fmtDate(asOf) : rangeLabel(from, to);

  return <div className="rpt-layout">
    <nav className="rpt-rail no-print">
      {CATEGORIES.map(c => <button key={c.key} className={"rpt-rail-item" + (c.key === cat.key ? " on" : "")}
        onClick={() => pickCat(c.key)}>
        <Ico d={c.icon} size={17} />
        <span>{c.label}</span>
        {c.reports.length > 0 && <span className="rpt-rail-n">{c.reports.length}</span>}
      </button>)}
    </nav>

    <div className="rpt-pane">
      {!rpt
        ? <div className="card">
          <div className="card-head"><h3>{cat.label}</h3><span className="subtle" style={{ marginLeft: "auto" }}>{cat.blurb}</span></div>
          {cat.reports.length === 0
            ? <Empty icon={cat.icon} title={"No " + cat.label.toLowerCase() + " yet"}
              msg="Ledger doesn't track this area yet. The category is here so reports can slot straight in when it does." />
            : <table><tbody>
              {cat.reports.map(k => <tr key={k} style={{ cursor: "pointer" }} onClick={() => openReport(k)}>
                <td style={{ width: 34 }}><Ico d={ICONS.reports} size={16} /></td>
                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{REPORTS[k].label}</td>
                <td className="subtle">{REPORTS[k].blurb}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn sm" onClick={e => { e.stopPropagation(); openReport(k); }}>Run<Ico d={ICONS.arrow} size={14} /></button></td>
              </tr>)}
            </tbody></table>}
        </div>
        : <>
          <div className="toolbar no-print" style={{ marginBottom: 12 }}>
            <button className="btn sm" onClick={() => setRptKey("")}><Ico d={ICONS.back} size={14} />Back</button>
            <span className="subtle">{cat.label} / <strong style={{ color: "var(--ink)" }}>{rpt.label}</strong></span>
          </div>
          <FilterBar
            preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom}
            partyKind={rpt.party} partyId={partyId} onParty={setPartyId} contacts={db.contacts}
            right={<button className="btn" onClick={() => window.print()}><Ico d={ICONS.print} size={15} />Print</button>} />
          {rpt.asOf && <p className="subtle no-print" style={{ margin: "-6px 0 14px" }}>
            Aging is calculated as of the end of the selected range ({fmtDate(asOf)}).
          </p>}
          <rpt.Render db={db} from={from} to={to} asOf={asOf} partyId={partyId} rangeLabel={label} />
        </>}
    </div>
  </div>;
}

function ReportCard({ title, rangeLabel, right, children }) {
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>{title}</h3><span className="subtle" style={{ marginLeft: "auto" }}>{rangeLabel}</span>{right}</div>
    {children}
  </div>;
}

/* ---------- Receipts / Payments register ----------
   Same shape both ways: one row per check or transfer, optionally expanded to
   the documents it was applied to. "Summary" shows just the money that moved;
   "Detail" shows it with every invoice or bill underneath. */
// Declared as functions, not const arrows: REPORTS above is built at module
// load and would hit the temporal dead zone on a const declared down here.
function ReceiptsReport(p) { return <RegisterReport {...p} kind="invoice" />; }
function PaymentsReport(p) { return <RegisterReport {...p} kind="bill" />; }

function RegisterReport({ db, from, to, partyId, rangeLabel: label, kind }) {
  const [detail, setDetail] = useState(false);
  const [open, setOpen] = useState({});
  const isBill = kind === "bill";
  const L = isBill
    ? { title: "Payments Register", one: "payment", plural: "Payments", ref: "Check / Ref #", party: "Vendor", when: "Date Paid", docs: "Bills", doc: "Bill", file: "payments-register", stat: "Total Paid", meta: "checks / transfers sent" }
    : { title: "Receipts Register", one: "receipt", plural: "Receipts", ref: "Reference #", party: "Customer", when: "Date Received", docs: "Invoices", doc: "Invoice", file: "receipts-register", stat: "Total Received", meta: "checks / transfers received" };
  const r = receiptGroups(db, { kind, from, to, partyId });
  const exportCSV = () => downloadCSV(L.file,
    detail
      ? ["Reference", L.party, L.when, "Method", L.plural.slice(0, -1) + " Amount", L.doc, L.doc + " Date", "Applied"]
      : ["Reference", L.party, L.when, "Method", L.docs, "Amount"],
    detail
      ? r.rows.flatMap(g => g.lines.map(l =>
        [g.ref || "", nameOf(db, g.partyId), g.date, g.method, g.amount.toFixed(2), l.number, l.docDate, l.amount.toFixed(2)]))
      : r.rows.map(g => [g.ref || "", nameOf(db, g.partyId), g.date, g.method, g.count, g.amount.toFixed(2)]));

  return <>
    <div className="grid" style={{ gridTemplateColumns: "repeat(2,1fr)", marginBottom: 16 }}>
      <div className="stat"><div className="lbl">{L.stat}</div><div className={"val mono " + (isBill ? "neg" : "pos")}>{money(r.total)}</div><div className="meta">{label}</div></div>
      <div className="stat"><div className="lbl">{L.plural}</div><div className="val mono">{r.count}</div><div className="meta">{L.meta}</div></div>
    </div>
    <ReportCard title={L.title} rangeLabel={label} right={<>
      <div className="pill-tabs no-print">
        <button className={detail ? "" : "on"} onClick={() => setDetail(false)}>Summary</button>
        <button className={detail ? "on" : ""} onClick={() => setDetail(true)}>Detail</button>
      </div>
      <button className="btn sm no-print" onClick={exportCSV}>Export CSV</button></>}>
      {r.rows.length === 0
        ? <Empty icon={ICONS.money} title={"No " + L.one + "s in this range"} msg={"Widen the date range or clear the " + L.party.toLowerCase() + " filter."} />
        : <table><thead><tr>
          {!detail && <th style={{ width: 34 }}></th>}
          <th>{L.ref}</th><th>{L.party}</th><th>{L.when}</th><th>Method</th>
          <th className="num">{L.docs}</th><th className="num">Amount</th></tr></thead>
          <tbody>{r.rows.map(g => {
            const isOpen = detail || !!open[g.key];
            const toggle = () => setOpen(o => ({ ...o, [g.key]: !o[g.key] }));
            return <Fragment key={g.key}>
              <tr style={detail ? undefined : { cursor: "pointer" }} onClick={detail ? undefined : toggle}>
                {!detail && <td><button className="btn ghost icon" title={isOpen ? "Collapse" : "Show " + L.docs.toLowerCase()}
                  style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}
                  onClick={e => { e.stopPropagation(); toggle(); }}><Ico d={ICONS.arrow} size={15} /></button></td>}
                <td className="mono doc-id">{g.ref ? "#" + g.ref : "—"}</td>
                <td style={{ fontWeight: 600 }}>{nameOf(db, g.partyId)}</td>
                <td className="subtle">{fmtDate(g.date)}</td>
                <td className="subtle">{g.method || "—"}</td>
                <td className="num subtle">{g.count}</td>
                <td className="num" style={{ fontWeight: 600 }}>{money(g.amount)}</td>
              </tr>
              {isOpen && g.lines.map(l => <tr key={l.paymentId} className="sub-row">
                {!detail && <td></td>}
                <td className="subtle" style={{ paddingLeft: 8 }}>applied to</td>
                <td className="doc-id">{l.number}</td>
                <td className="subtle">{fmtDate(l.docDate)}</td>
                <td colSpan={2}></td>
                <td className="num">{money(l.amount)}</td>
              </tr>)}
            </Fragment>;
          })}
            <tr>{!detail && <td></td>}<td style={{ fontWeight: 700 }}>Total</td><td colSpan={4}></td>
              <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td></tr>
          </tbody></table>}
    </ReportCard>
  </>;
}

/* ---------- Aged Receivables / Payables ---------- */
function AgedReceivablesReport(p) { return <AgedReport {...p} kind="ar" />; }
function AgedPayablesReport(p) { return <AgedReport {...p} kind="ap" />; }

function AgedReport({ db, asOf, partyId, kind }) {
  const isAR = kind === "ar";
  const r0 = isAR ? agedReceivables(db, asOf) : agedPayables(db, asOf);
  const rows = partyId ? r0.rows.filter(x => x.key === partyId) : r0.rows;
  const totals = partyId
    ? rows.reduce((t, x) => { ["cur", "d30", "d60", "d90", "d90p", "total"].forEach(k => t[k] += x[k]); return t; },
      { cur: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 })
    : r0.totals;
  const title = isAR ? "Aged Receivables" : "Aged Payables";
  const who = isAR ? "Customer" : "Vendor";
  const cols = [["cur", "Current"], ["d30", "1–30"], ["d60", "31–60"], ["d90", "61–90"], ["d90p", "90+"]];
  const exportCSV = () => downloadCSV(isAR ? "aged-receivables" : "aged-payables",
    [who, ...cols.map(([, l]) => l), "Total"],
    [...rows.map(x => [nameOf(db, x.key), ...cols.map(([k]) => x[k].toFixed(2)), x.total.toFixed(2)]),
    ["TOTAL", ...cols.map(([k]) => totals[k].toFixed(2)), totals.total.toFixed(2)]]);
  return <ReportCard title={title} rangeLabel={"As of " + fmtDate(asOf)}
    right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
    {rows.length === 0
      ? <Empty icon={isAR ? ICONS.ar : ICONS.ap} title="Nothing outstanding" msg={isAR ? "No customer owed you money on this date." : "You owed no vendor bills on this date."} />
      : <table><thead><tr><th>{who}</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Total</th></tr></thead>
        <tbody>
          {rows.map(x => <tr key={x.key}>
            <td style={{ fontWeight: 600 }}>{nameOf(db, x.key)}</td>
            {cols.map(([k]) => <td key={k} className="num" style={k !== "cur" && x[k] > 0 ? { color: "var(--neg)" } : {}}>{x[k] > 0 ? money(x[k]) : "—"}</td>)}
            <td className="num" style={{ fontWeight: 600 }}>{money(x.total)}</td>
          </tr>)}
          <tr>
            <td style={{ fontWeight: 700 }}>Total</td>
            {cols.map(([k]) => <td key={k} className="num" style={{ fontWeight: 700 }}>{money(totals[k])}</td>)}
            <td className="num" style={{ fontWeight: 700 }}>{money(totals.total)}</td>
          </tr>
        </tbody></table>}
  </ReportCard>;
}

/* ---------- Income / Expense by month ---------- */
function IncomeExpense({ db, from, to, rangeLabel: label }) {
  const r = incomeExpenseByMonth(db, from, to);
  const mLabel = ym => { const [y, m] = ym.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }); };
  const exportCSV = () => downloadCSV("income-expense",
    ["Month", "Income", "Expenses", "Bill Payments", "Net"],
    [...r.rows.map(x => [mLabel(x.month), x.income.toFixed(2), x.expenses.toFixed(2), x.billsPaid.toFixed(2), x.net.toFixed(2)]),
    ["TOTAL", r.totals.income.toFixed(2), r.totals.expenses.toFixed(2), r.totals.billsPaid.toFixed(2), r.totals.net.toFixed(2)]]);
  return <>
    <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 16 }}>
      <div className="stat"><div className="lbl">Income</div><div className="val mono pos">{money(r.totals.income)}</div><div className="meta">payments received</div></div>
      <div className="stat"><div className="lbl">Money Out</div><div className="val mono neg">{money(r.totals.expenses + r.totals.billsPaid)}</div><div className="meta">expenses + bill payments</div></div>
      <div className="stat"><div className="lbl">Net</div><div className={"val mono " + (r.totals.net >= 0 ? "pos" : "neg")}>{money(r.totals.net)}</div><div className="meta">cash basis</div></div>
    </div>
    <ReportCard title="Income / Expense by Month" rangeLabel={label}
      right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
      {r.rows.length === 0
        ? <Empty icon={ICONS.reports} title="Nothing in this range" msg="No payments or expenses fall in the selected dates." />
        : <table><thead><tr><th>Month</th><th className="num">Income</th><th className="num">Expenses</th><th className="num">Bill Payments</th><th className="num">Net</th></tr></thead>
          <tbody>
            {r.rows.map(x => <tr key={x.month}>
              <td style={{ fontWeight: 600 }}>{mLabel(x.month)}</td>
              <td className="num" style={{ color: "var(--pos)" }}>{money(x.income)}</td>
              <td className="num">{money(x.expenses)}</td>
              <td className="num">{money(x.billsPaid)}</td>
              <td className="num" style={{ fontWeight: 600, color: x.net >= 0 ? "var(--pos)" : "var(--neg)" }}>{money(x.net)}</td>
            </tr>)}
            <tr>
              <td style={{ fontWeight: 700 }}>Total</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(r.totals.income)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(r.totals.expenses)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(r.totals.billsPaid)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(r.totals.net)}</td>
            </tr>
          </tbody></table>}
    </ReportCard>
  </>;
}

function ProfitLoss({ db, from, to, rangeLabel: label }) {
  const r = plCashBasis(db, from, to);
  const exportCSV = () => downloadCSV("profit-and-loss",
    ["Line", "Amount"],
    [["Income — payments received", r.income.toFixed(2)],
    ...r.categories.map(([c, v]) => ["Expense — " + c, (-v).toFixed(2)]),
    ["Vendor bill payments", (-r.billsPaid).toFixed(2)],
    ["Net profit", r.net.toFixed(2)]]);
  return <ReportCard title="Profit & Loss (cash basis)" rangeLabel={label}
    right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
    <table><tbody>
      <tr><td style={{ fontWeight: 600 }}>Income</td><td className="num" style={{ fontWeight: 600 }}>{money(r.income)}</td></tr>
      <tr><td className="subtle" style={{ paddingLeft: 28 }}>Customer payments received</td><td className="num subtle">{money(r.income)}</td></tr>
      <tr><td style={{ fontWeight: 600 }}>Expenses</td><td className="num" style={{ fontWeight: 600 }}>{money(r.totalOut)}</td></tr>
      {r.categories.map(([c, v]) => <tr key={c}><td className="subtle" style={{ paddingLeft: 28 }}>{c}</td><td className="num subtle">{money(v)}</td></tr>)}
      {r.billsPaid > 0 && <tr><td className="subtle" style={{ paddingLeft: 28 }}>Vendor bill payments</td><td className="num subtle">{money(r.billsPaid)}</td></tr>}
      <tr><td style={{ fontWeight: 700, fontSize: 15, borderTop: "2px solid var(--ink)" }}>Net Profit</td>
        <td className="num" style={{ fontWeight: 700, fontSize: 15, borderTop: "2px solid var(--ink)", color: r.net >= 0 ? "var(--pos)" : "var(--neg)" }}>{money(r.net)}</td></tr>
    </tbody></table>
    <div className="card-body subtle" style={{ paddingTop: 10 }}>
      Cash basis: income counts payments when received; expenses count when logged / when bills are paid.
    </div>
  </ReportCard>;
}

function SalesTax({ db, from, to, partyId, rangeLabel: label }) {
  const r0 = salesTaxReport(db, from, to);
  const rows = partyId ? r0.rows.filter(x => x.inv.customerId === partyId) : r0.rows;
  const sub = rows.reduce((t, x) => t + x.sub, 0), tax = rows.reduce((t, x) => t + x.tax, 0);
  const exportCSV = () => downloadCSV("sales-tax",
    ["Invoice", "Customer", "Date", "Status", "Subtotal", "Tax", "Total"],
    rows.map(({ inv, sub: s, tax: t, total }) => [inv.number, nameOf(db, inv.customerId), inv.date, invoiceStatus(inv), s.toFixed(2), t.toFixed(2), total.toFixed(2)]));
  return <>
    <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 16 }}>
      <div className="stat"><div className="lbl">Taxable Sales (invoiced)</div><div className="val mono">{money(sub)}</div></div>
      <div className="stat"><div className="lbl">Tax Invoiced</div><div className="val mono">{money(tax)}</div><div className="meta">accrual — what most states expect</div></div>
      <div className="stat"><div className="lbl">Tax Collected (cash)</div><div className="val mono pos">{money(partyId ? 0 : r0.taxCollected)}</div><div className="meta">{partyId ? "all customers only" : "from payments received in range"}</div></div>
    </div>
    <ReportCard title="Invoices in Range" rangeLabel={label}
      right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
      {rows.length === 0
        ? <Empty icon={ICONS.inv} title="No invoices in this range" msg="Change the date range or customer above." />
        : <table><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th className="num">Subtotal</th><th className="num">Tax</th><th className="num">Total</th></tr></thead>
          <tbody>{rows.map(({ inv, sub: s, tax: t, total }) => <tr key={inv.id}>
            <td className="doc-id">{inv.number}</td><td>{nameOf(db, inv.customerId)}</td>
            <td className="subtle">{fmtDate(inv.date)}</td><td><Badge status={invoiceStatus(inv)} /></td>
            <td className="num">{money(s)}</td><td className="num">{money(t)}</td><td className="num">{money(total)}</td>
          </tr>)}</tbody></table>}
    </ReportCard>
  </>;
}

function SalesByCustomer({ db, from, to, partyId, rangeLabel: label }) {
  const all = salesByCustomer(db, from, to);
  const rows = partyId ? all.filter(r => r.customerId === partyId) : all;
  const exportCSV = () => downloadCSV("sales-by-customer",
    ["Customer", "Invoices", "Invoiced", "Collected", "Open Balance"],
    rows.map(r => [nameOf(db, r.customerId), r.count, r.invoiced.toFixed(2), r.collected.toFixed(2), r.balance.toFixed(2)]));
  return <ReportCard title="Sales by Customer" rangeLabel={label}
    right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
    {rows.length === 0
      ? <Empty icon={ICONS.contacts} title="No sales in this range" msg="Change the date range or customer above." />
      : <table><thead><tr><th>Customer</th><th className="num">Invoices</th><th className="num">Invoiced</th><th className="num">Collected</th><th className="num">Open Balance</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.customerId}>
          <td style={{ fontWeight: 600 }}>{nameOf(db, r.customerId)}</td>
          <td className="num">{r.count}</td>
          <td className="num">{money(r.invoiced)}</td>
          <td className="num" style={{ color: "var(--pos)" }}>{money(r.collected)}</td>
          <td className="num" style={{ fontWeight: 600 }}>{money(r.balance)}</td>
        </tr>)}</tbody></table>}
  </ReportCard>;
}

function ExpenseReport({ db, from, to, rangeLabel: label }) {
  const r = expensesByCategory(db, from, to);
  const exportCSV = () => downloadCSV("expenses-by-category",
    ["Category", "Entries", "Total"],
    [...r.rows.map(x => [x.category, x.count, x.total.toFixed(2)]), ["TOTAL", r.count, r.total.toFixed(2)]]);
  return <ReportCard title="Expenses by Category" rangeLabel={label}
    right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
    {r.rows.length === 0
      ? <Empty icon={ICONS.exp} title="No expenses in this range" msg="Change the date range above." />
      : <table><thead><tr><th>Category</th><th className="num">Entries</th><th className="num">Total</th></tr></thead>
        <tbody>
          {r.rows.map(x => <tr key={x.category}><td>{x.category}</td><td className="num">{x.count}</td><td className="num">{money(x.total)}</td></tr>)}
          <tr><td style={{ fontWeight: 700 }}>Total</td><td className="num" style={{ fontWeight: 700 }}>{r.count}</td><td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td></tr>
        </tbody></table>}
  </ReportCard>;
}

function Statements({ db, partyId }) {
  const contact = db.contacts.find(c => c.id === partyId);
  const r = partyId ? customerStatement(db, partyId) : null;
  if (!partyId) return <div className="card"><Empty icon={ICONS.contacts} title="Pick a customer"
    msg="Choose a customer in the filter bar above. Statements list every open invoice with its age and balance — ready to print and send with a payment reminder." /></div>;
  if (r.open.length === 0) return <div className="card"><Empty icon={ICONS.check} title="Nothing outstanding"
    msg={(contact?.name || "This customer") + " has no open invoices."} /></div>;
  return <div className="card">
    <div className="card-head">
      <div>
        <h3>Statement — {contact?.name}</h3>
        <div className="subtle">As of {fmtDate(todayISO())}{db.settings.company ? " · " + db.settings.company : ""}</div>
      </div>
      <span className="mono" style={{ marginLeft: "auto", fontWeight: 700, fontSize: 17 }}>{money(r.totalDue)}</span>
    </div>
    <table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Age</th><th>Status</th><th className="num">Balance</th></tr></thead>
      <tbody>{r.open.map(inv => {
        const od = daysBetween(inv.dueDate, todayISO());
        return <tr key={inv.id}>
          <td className="doc-id">{inv.number}</td>
          <td className="subtle">{fmtDate(inv.date)}</td>
          <td className="subtle">{fmtDate(inv.dueDate)}</td>
          <td style={od > 0 ? { color: "var(--neg)", fontWeight: 600 } : {}}>{od > 0 ? od + "d overdue" : "current"}</td>
          <td><Badge status={invoiceStatus(inv)} /></td>
          <td className="num" style={{ fontWeight: 600 }}>{money(balance(inv))}</td>
        </tr>;
      })}
        <tr><td colSpan={5} style={{ fontWeight: 700 }}>Total Due</td><td className="num" style={{ fontWeight: 700 }}>{money(r.totalDue)}</td></tr>
      </tbody></table>
  </div>;
}
