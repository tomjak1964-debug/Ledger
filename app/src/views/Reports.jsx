import { useState } from "react";
import { money, fmtDate, todayISO, daysBetween, nameOf } from "../lib/helpers.js";
import { balance, invoiceStatus } from "../calc/ledger.js";
import { plCashBasis, salesTaxReport, salesByCustomer, expensesByCategory, customerStatement, agedReceivables, agedPayables, incomeExpenseByMonth } from "../calc/reports.js";
import { Ico, ICONS, Badge, Empty, Field } from "../components/ui.jsx";

/* ---------- date ranges ---------- */
const pad2 = n => String(n).padStart(2, "0");
const firstOf = (y, m) => `${y}-${pad2(m + 1)}-01`;
const lastOf = (y, m) => `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`;
const PRESETS = [
  ["thisMonth", "This Month"], ["lastMonth", "Last Month"], ["thisQuarter", "This Quarter"],
  ["thisYear", "This Year"], ["lastYear", "Last Year"], ["all", "All Time"], ["custom", "Custom…"],
];
function rangeFor(preset) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  switch (preset) {
    case "thisMonth": return [firstOf(y, m), lastOf(y, m)];
    case "lastMonth": return m === 0 ? [firstOf(y - 1, 11), lastOf(y - 1, 11)] : [firstOf(y, m - 1), lastOf(y, m - 1)];
    case "thisQuarter": { const qs = Math.floor(m / 3) * 3; return [firstOf(y, qs), lastOf(y, qs + 2)]; }
    case "thisYear": return [`${y}-01-01`, `${y}-12-31`];
    case "lastYear": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    default: return ["", ""];
  }
}

/* ---------- CSV export ---------- */
function downloadCSV(name, header, rows) {
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [header, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name + "-" + todayISO() + ".csv";
  a.click();
}

const TABS = [
  ["pl", "Profit & Loss"], ["ie", "Income / Expense"], ["tax", "Sales Tax"],
  ["customers", "Sales by Customer"], ["expenses", "Expenses"],
  ["ar", "Aged Receivables"], ["ap", "Aged Payables"], ["statement", "Statements"],
];
const RANGE_TABS = ["pl", "ie", "tax", "customers", "expenses"];

export default function ReportsView({ db }) {
  const [tab, setTab] = useState("pl");
  const [preset, setPreset] = useState("thisYear");
  const [custom, setCustom] = useState({ from: firstOf(new Date().getFullYear(), 0), to: todayISO() });
  const [asOf, setAsOf] = useState(todayISO());
  const [from, to] = preset === "custom" ? [custom.from, custom.to] : rangeFor(preset);
  const rangeLabel = (!from && !to) ? "All time" : `${fmtDate(from)} – ${fmtDate(to)}`;

  return <div>
    <div className="toolbar no-print">
      <div className="pill-tabs" style={{ flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
    </div>
    {RANGE_TABS.includes(tab) && <div className="toolbar no-print">
      <select className="select" style={{ maxWidth: 170 }} value={preset} onChange={e => setPreset(e.target.value)}>
        {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {preset === "custom" && <>
        <input className="input" style={{ maxWidth: 160 }} type="date" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} />
        <span className="subtle">to</span>
        <input className="input" style={{ maxWidth: 160 }} type="date" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} />
      </>}
      <button className="btn" style={{ marginLeft: "auto" }} onClick={() => window.print()}><Ico d={ICONS.print} size={15} />Print</button>
    </div>}
    {(tab === "ar" || tab === "ap") && <div className="toolbar no-print">
      <span className="subtle" style={{ fontWeight: 600 }}>As of</span>
      <input className="input" style={{ maxWidth: 160 }} type="date" value={asOf} onChange={e => setAsOf(e.target.value || todayISO())} />
      <button className="btn" style={{ marginLeft: "auto" }} onClick={() => window.print()}><Ico d={ICONS.print} size={15} />Print</button>
    </div>}

    {tab === "pl" && <ProfitLoss db={db} from={from} to={to} rangeLabel={rangeLabel} />}
    {tab === "ie" && <IncomeExpense db={db} from={from} to={to} rangeLabel={rangeLabel} />}
    {tab === "tax" && <SalesTax db={db} from={from} to={to} rangeLabel={rangeLabel} />}
    {tab === "customers" && <SalesByCustomer db={db} from={from} to={to} rangeLabel={rangeLabel} />}
    {tab === "expenses" && <ExpenseReport db={db} from={from} to={to} rangeLabel={rangeLabel} />}
    {tab === "ar" && <AgedReport db={db} asOf={asOf} kind="ar" />}
    {tab === "ap" && <AgedReport db={db} asOf={asOf} kind="ap" />}
    {tab === "statement" && <Statements db={db} />}
  </div>;
}

/* ---------- Aged Receivables / Payables ---------- */
function AgedReport({ db, asOf, kind }) {
  const isAR = kind === "ar";
  const r = isAR ? agedReceivables(db, asOf) : agedPayables(db, asOf);
  const title = isAR ? "Aged Receivables" : "Aged Payables";
  const who = isAR ? "Customer" : "Vendor";
  const cols = [["cur", "Current"], ["d30", "1–30"], ["d60", "31–60"], ["d90", "61–90"], ["d90p", "90+"]];
  const exportCSV = () => downloadCSV(isAR ? "aged-receivables" : "aged-payables",
    [who, ...cols.map(([, l]) => l), "Total"],
    [...r.rows.map(x => [nameOf(db, x.key), ...cols.map(([k]) => x[k].toFixed(2)), x.total.toFixed(2)]),
    ["TOTAL", ...cols.map(([k]) => r.totals[k].toFixed(2)), r.totals.total.toFixed(2)]]);
  return <ReportCard title={title} rangeLabel={"As of " + fmtDate(asOf)}
    right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
    {r.rows.length === 0
      ? <Empty icon={isAR ? ICONS.ar : ICONS.ap} title={"Nothing outstanding"} msg={isAR ? "No customer owed you money on this date." : "You owed no vendor bills on this date."} />
      : <table><thead><tr><th>{who}</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Total</th></tr></thead>
        <tbody>
          {r.rows.map(x => <tr key={x.key}>
            <td style={{ fontWeight: 600 }}>{nameOf(db, x.key)}</td>
            {cols.map(([k]) => <td key={k} className="num" style={k !== "cur" && x[k] > 0 ? { color: "var(--neg)" } : {}}>{x[k] > 0 ? money(x[k]) : "—"}</td>)}
            <td className="num" style={{ fontWeight: 600 }}>{money(x.total)}</td>
          </tr>)}
          <tr>
            <td style={{ fontWeight: 700 }}>Total</td>
            {cols.map(([k]) => <td key={k} className="num" style={{ fontWeight: 700 }}>{money(r.totals[k])}</td>)}
            <td className="num" style={{ fontWeight: 700 }}>{money(r.totals.total)}</td>
          </tr>
        </tbody></table>}
  </ReportCard>;
}

/* ---------- Income / Expense by month ---------- */
function IncomeExpense({ db, from, to, rangeLabel }) {
  const r = incomeExpenseByMonth(db, from, to);
  const label = ym => { const [y, m] = ym.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }); };
  const exportCSV = () => downloadCSV("income-expense",
    ["Month", "Income", "Expenses", "Bill Payments", "Net"],
    [...r.rows.map(x => [label(x.month), x.income.toFixed(2), x.expenses.toFixed(2), x.billsPaid.toFixed(2), x.net.toFixed(2)]),
    ["TOTAL", r.totals.income.toFixed(2), r.totals.expenses.toFixed(2), r.totals.billsPaid.toFixed(2), r.totals.net.toFixed(2)]]);
  return <>
    <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 16 }}>
      <div className="stat"><div className="lbl">Income</div><div className="val mono pos">{money(r.totals.income)}</div><div className="meta">payments received</div></div>
      <div className="stat"><div className="lbl">Money Out</div><div className="val mono neg">{money(r.totals.expenses + r.totals.billsPaid)}</div><div className="meta">expenses + bill payments</div></div>
      <div className="stat"><div className="lbl">Net</div><div className={"val mono " + (r.totals.net >= 0 ? "pos" : "neg")}>{money(r.totals.net)}</div><div className="meta">cash basis</div></div>
    </div>
    <ReportCard title="Income / Expense by Month" rangeLabel={rangeLabel}
      right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
      {r.rows.length === 0
        ? <Empty icon={ICONS.reports} title="Nothing in this range" msg="No payments or expenses fall in the selected dates." />
        : <table><thead><tr><th>Month</th><th className="num">Income</th><th className="num">Expenses</th><th className="num">Bill Payments</th><th className="num">Net</th></tr></thead>
          <tbody>
            {r.rows.map(x => <tr key={x.month}>
              <td style={{ fontWeight: 600 }}>{label(x.month)}</td>
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

function ReportCard({ title, rangeLabel, right, children }) {
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>{title}</h3><span className="subtle" style={{ marginLeft: "auto" }}>{rangeLabel}</span>{right}</div>
    {children}
  </div>;
}

function ProfitLoss({ db, from, to, rangeLabel }) {
  const r = plCashBasis(db, from, to);
  const exportCSV = () => downloadCSV("profit-and-loss",
    ["Line", "Amount"],
    [["Income — payments received", r.income.toFixed(2)],
    ...r.categories.map(([c, v]) => ["Expense — " + c, (-v).toFixed(2)]),
    ["Vendor bill payments", (-r.billsPaid).toFixed(2)],
    ["Net profit", r.net.toFixed(2)]]);
  return <ReportCard title="Profit & Loss (cash basis)" rangeLabel={rangeLabel}
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

function SalesTax({ db, from, to, rangeLabel }) {
  const r = salesTaxReport(db, from, to);
  const exportCSV = () => downloadCSV("sales-tax",
    ["Invoice", "Customer", "Date", "Status", "Subtotal", "Tax", "Total"],
    r.rows.map(({ inv, sub, tax, total }) => [inv.number, nameOf(db, inv.customerId), inv.date, invoiceStatus(inv), sub.toFixed(2), tax.toFixed(2), total.toFixed(2)]));
  return <>
    <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 16 }}>
      <div className="stat"><div className="lbl">Taxable Sales (invoiced)</div><div className="val mono">{money(r.sub)}</div></div>
      <div className="stat"><div className="lbl">Tax Invoiced</div><div className="val mono">{money(r.tax)}</div><div className="meta">accrual — what most states expect</div></div>
      <div className="stat"><div className="lbl">Tax Collected (cash)</div><div className="val mono pos">{money(r.taxCollected)}</div><div className="meta">from payments received in range</div></div>
    </div>
    <ReportCard title="Invoices in Range" rangeLabel={rangeLabel}
      right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
      {r.rows.length === 0
        ? <Empty icon={ICONS.inv} title="No invoices in this range" msg="Change the date range above." />
        : <table><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th className="num">Subtotal</th><th className="num">Tax</th><th className="num">Total</th></tr></thead>
          <tbody>{r.rows.map(({ inv, sub, tax, total }) => <tr key={inv.id}>
            <td className="doc-id">{inv.number}</td><td>{nameOf(db, inv.customerId)}</td>
            <td className="subtle">{fmtDate(inv.date)}</td><td><Badge status={invoiceStatus(inv)} /></td>
            <td className="num">{money(sub)}</td><td className="num">{money(tax)}</td><td className="num">{money(total)}</td>
          </tr>)}</tbody></table>}
    </ReportCard>
  </>;
}

function SalesByCustomer({ db, from, to, rangeLabel }) {
  const rows = salesByCustomer(db, from, to);
  const exportCSV = () => downloadCSV("sales-by-customer",
    ["Customer", "Invoices", "Invoiced", "Collected", "Open Balance"],
    rows.map(r => [nameOf(db, r.customerId), r.count, r.invoiced.toFixed(2), r.collected.toFixed(2), r.balance.toFixed(2)]));
  return <ReportCard title="Sales by Customer" rangeLabel={rangeLabel}
    right={<button className="btn sm no-print" onClick={exportCSV}>Export CSV</button>}>
    {rows.length === 0
      ? <Empty icon={ICONS.contacts} title="No sales in this range" msg="Change the date range above." />
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

function ExpenseReport({ db, from, to, rangeLabel }) {
  const r = expensesByCategory(db, from, to);
  const exportCSV = () => downloadCSV("expenses-by-category",
    ["Category", "Entries", "Total"],
    [...r.rows.map(x => [x.category, x.count, x.total.toFixed(2)]), ["TOTAL", r.count, r.total.toFixed(2)]]);
  return <ReportCard title="Expenses by Category" rangeLabel={rangeLabel}
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

function Statements({ db }) {
  const customers = db.contacts.filter(c => c.type === "customer");
  const [customerId, setCustomerId] = useState("");
  const contact = db.contacts.find(c => c.id === customerId);
  const r = customerId ? customerStatement(db, customerId) : null;

  return <div>
    <div className="toolbar no-print">
      <Field label="Customer"><select className="select" style={{ minWidth: 260 }} value={customerId} onChange={e => setCustomerId(e.target.value)}>
        <option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></Field>
      {r && r.open.length > 0 && <button className="btn" style={{ marginLeft: "auto" }} onClick={() => window.print()}><Ico d={ICONS.print} size={15} />Print Statement</button>}
    </div>
    {!customerId
      ? <div className="card"><Empty icon={ICONS.contacts} title="Pick a customer" msg="Statements list every open invoice with its age and balance — ready to print and send with a payment reminder." /></div>
      : r.open.length === 0
        ? <div className="card"><Empty icon={ICONS.check} title="Nothing outstanding" msg={(contact?.name || "This customer") + " has no open invoices."} /></div>
        : <div className="card">
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
        </div>}
  </div>;
}
