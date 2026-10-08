import { Fragment, useState } from "react";
import { money, fmtDate } from "../lib/helpers.js";
import { invoiceStatus, lineTotals } from "../calc/ledger.js";
import {
  salesOrderReport, jobTrackingReport, jobCostingReport, STAGE_LABEL,
  BUDGET_LINES, COST_CATEGORIES, JOB_SPEC_FIELDS, costLabel,
} from "../calc/jobs.js";
import { Badge, Empty, ICONS, Ico, SortTh, useTableSort } from "../components/ui.jsx";
import { downloadCSV, ReportCard, StatusToggle } from "../components/reportKit.jsx";

const dash = <span className="subtle">—</span>;
const amt = v => (Math.abs(v) > 0.005 ? money(v) : dash);
const Toggle = ({ checked, onChange, children }) => <label className="subtle no-print" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", marginLeft: 12 }}>
  <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />{children}</label>;
const CsvButton = ({ onClick }) => <button className="btn sm no-print" style={{ marginLeft: 8 }} onClick={onClick}><Ico d={ICONS.download || ICONS.print} size={14} />CSV</button>;

/* ================= Sales Orders (Accounts Receivable) ================= */

// One row per sales order: its value, what is left to invoice, what is billed
// and unpaid, and what is paid. With detail, each invoice it produced — and
// the SO lines that invoice billed — then the lines still to invoice.
export function SalesOrderReport({ db, from, to, partyId, rangeLabel }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [detail, setDetail] = useState(false);
  const r = salesOrderReport(db, { from, to, partyId, statusFilter });
  const { sorted, sort, onSort } = useTableSort(r.rows, {
    number: x => x.so.number, customer: x => x.customer, job: x => x.job, po: x => x.so.poNumber || "",
    amount: x => x.amount, extras: x => x.extras, status: x => x.status, left: x => x.leftToInvoice, outstanding: x => x.outstanding, paid: x => x.paid,
  });

  const exportCSV = () => {
    const head = ["Sales Order", "Customer", "Job", "PO Number", "SO Amount", "Extras Invoiced", "Status", "Left to Invoice", "Outstanding Invoices", "Paid"];
    const rows = [];
    sorted.forEach(x => {
      rows.push([x.so.number, x.customer, x.job, x.so.poNumber || "", x.amount.toFixed(2), x.extras.toFixed(2), x.status === "open" ? "Open" : "Closed", x.leftToInvoice.toFixed(2), x.outstanding.toFixed(2), x.paid.toFixed(2)]);
      if (!detail) return;
      x.invoiceRows.forEach(iv => {
        rows.push(["", "  Invoice " + iv.inv.number, fmtDate(iv.inv.date), "", iv.total.toFixed(2), "", invoiceStatus(iv.inv), "", Math.max(0, iv.balance).toFixed(2), iv.paid.toFixed(2)]);
        linesOf(iv).forEach(l => rows.push(["", "    " + l.desc.split("\n")[0], "", "", l.amount.toFixed(2), "", "", "", "", ""]));
      });
      x.unbilled.forEach(li => rows.push(["", "  To invoice: " + (li.desc || "").split("\n")[0], "", "", lineTotals([li], x.so.taxRate).total.toFixed(2), "", "", "", "", ""]));
    });
    rows.push(["TOTAL", "", "", "", r.totals.amount.toFixed(2), r.totals.extras.toFixed(2), "", r.totals.leftToInvoice.toFixed(2), r.totals.outstanding.toFixed(2), r.totals.paid.toFixed(2)]);
    downloadCSV("sales-orders", head, rows);
  };

  return <ReportCard title="Sales Orders" rangeLabel={rangeLabel} right={<>
    <span style={{ marginLeft: 12 }}><StatusToggle value={statusFilter} onChange={setStatusFilter} /></span>
    <Toggle checked={detail} onChange={setDetail}>Show detail</Toggle>
    <CsvButton onClick={exportCSV} />
  </>}>
    {r.rows.length === 0
      ? <Empty icon={ICONS.so} title="No sales orders" msg="Nothing matches those filters. Widen the date range, change the customer, or switch to All." />
      : <table><thead><tr>
        <SortTh label="SO #" col="number" sort={sort} onSort={onSort} />
        <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
        <SortTh label="Job" col="job" sort={sort} onSort={onSort} />
        <SortTh label="PO #" col="po" sort={sort} onSort={onSort} />
        <SortTh label="SO Amount" col="amount" sort={sort} onSort={onSort} num />
        <SortTh label="Extras Invoiced" col="extras" sort={sort} onSort={onSort} num />
        <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
        <SortTh label="Left to Invoice" col="left" sort={sort} onSort={onSort} num />
        <SortTh label="Outstanding Invoices" col="outstanding" sort={sort} onSort={onSort} num />
        <SortTh label="Paid" col="paid" sort={sort} onSort={onSort} num />
      </tr></thead>
        <tbody>{sorted.map(x => <Fragment key={x.so.id}>
          <tr style={detail ? { borderTop: "2px solid var(--line)" } : undefined}>
            <td className="doc-id">{x.so.number}</td>
            <td style={{ fontWeight: 600 }}>{x.customer}</td>
            <td className="mono">{x.job || dash}</td>
            <td className="mono subtle">{x.so.poNumber || "—"}</td>
            <td className="num mono">{money(x.amount)}</td>
            <td className="num mono">{amt(x.extras)}</td>
            <td><Badge status={x.status} /></td>
            <td className="num mono">{amt(x.leftToInvoice)}</td>
            <td className="num mono">{amt(x.outstanding)}</td>
            <td className="num mono">{amt(x.paid)}</td>
          </tr>
          {detail && x.invoiceRows.map(iv => <Fragment key={iv.inv.id}>
            <tr className="sub-row">
              <td></td>
              <td colSpan={3}><span className="doc-id">{iv.inv.number}</span> <span className="subtle">· {fmtDate(iv.inv.date)}</span> <Badge status={invoiceStatus(iv.inv)} /></td>
              <td className="num mono">{money(iv.total)}</td><td></td><td></td><td></td>
              <td className="num mono">{amt(Math.max(0, iv.balance))}</td>
              <td className="num mono">{amt(iv.paid)}</td>
            </tr>
            {linesOf(iv).map(l => <tr key={l.id} className="sub-row">
              <td></td><td colSpan={3} style={{ paddingLeft: 28, whiteSpace: "pre-line" }}>{l.desc}</td>
              <td className="num mono subtle">{money(l.amount)}</td><td colSpan={5}></td>
            </tr>)}
          </Fragment>)}
          {detail && x.unbilled.length > 0 && x.unbilled.map(li => <tr key={li.id} className="sub-row">
            <td></td><td colSpan={3} style={{ whiteSpace: "pre-line" }}><span className="subtle">To invoice · </span>{li.desc}{li.ready ? <> <Badge status="ready" /></> : null}</td>
            <td></td><td></td><td></td><td className="num mono">{money(lineTotals([li], x.so.taxRate).total)}</td><td colSpan={2}></td>
          </tr>)}
          {detail && x.closedLines.map(li => <tr key={li.id} className="sub-row">
            <td></td><td colSpan={3} className="subtle" style={{ whiteSpace: "pre-line", textDecoration: "line-through" }}>Closed · {li.desc}</td>
            <td colSpan={6}></td>
          </tr>)}
          {detail && x.invoiceRows.length === 0 && x.unbilled.length === 0 && <tr className="sub-row"><td></td><td colSpan={9} className="subtle">No invoices.</td></tr>}
        </Fragment>)}
          <tr><td style={{ fontWeight: 700 }}>Total</td><td colSpan={3} className="subtle">{r.rows.length} sales order{r.rows.length === 1 ? "" : "s"}</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.amount)}</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.extras)}</td><td></td>
            <td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.leftToInvoice)}</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.outstanding)}</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.paid)}</td></tr>
        </tbody></table>}
    <p className="subtle" style={{ margin: "10px 16px 14px" }}>
      Open: something is still to be invoiced or an invoice is unpaid. Closed: every line is invoiced or closed, and every invoice is paid.
      Extras Invoiced is anything billed beyond the order's own lines — start-up or extra work added when the job was invoiced.
      Paid includes any early-payment discount the customer took, so SO Amount + Extras = Left to Invoice + Outstanding + Paid (less any line closed without billing).
    </p>
  </ReportCard>;
}
// The lines an invoice billed: the SO lines that point at it, else its own.
function linesOf(iv) {
  if (iv.soLines.length) return iv.soLines.map(li => ({ id: li.id, desc: li.desc || "", amount: lineTotals([li], iv.inv.taxRate).total }));
  return (iv.inv.lineItems || []).filter(li => Number(li.qty)).map(li => ({ id: li.id, desc: li.desc || "", amount: lineTotals([li], iv.inv.taxRate).total }));
}

/* ================= Job Tracking (Jobs) ================= */

const Milestones = ({ list }) => <span>{list.map(m => <span key={m.id} className={"ms " + m.state}
  title={`${m.desc} — ${money(m.amount)} — ${m.state === "invoiced" ? "invoiced" : m.state === "ready" ? "ready to invoice" : m.state === "closed" ? "closed, not billed" : "not invoiced"}`}>
  {m.label}<span className="mono">{money(m.amount)}</span></span>)}</span>;

function trackingStatus(x) {
  if (x.type === "proposal") return <Badge status={x.stage} />;
  if (x.stage === "partial" || x.stage === "notStarted") return <span><Badge status="open" /> <span className="subtle">{STAGE_LABEL[x.stage]} · <span className="mono">{money(x.leftToInvoice)}</span> left</span></span>;
  if (x.stage === "invoiced") return <span><Badge status="unpaid" /> <span className="subtle">Invoiced · <span className="mono">{money(x.outstanding)}</span> due</span></span>;
  return <Badge status="paid" />;
}
const statusText = x => x.type === "proposal" ? "Proposal " + x.stage
  : x.stage === "paid" ? "Paid" : x.stage === "invoiced" ? `Invoiced (${x.outstanding.toFixed(2)} due)` : `${STAGE_LABEL[x.stage]} (${x.leftToInvoice.toFixed(2)} left to invoice)`;

export function JobTrackingReport({ db, from, to, partyId, rangeLabel }) {
  const [statusFilter, setStatusFilter] = useState("open");
  const r = jobTrackingReport(db, { from, to, partyId, statusFilter });
  const { sorted, sort, onSort } = useTableSort(r.rows, {
    job: x => x.job, po: x => x.po, amount: x => x.amount, so: x => x.soNumber, proposal: x => x.proposalNumber,
    desc: x => x.description, type: x => x.type, status: x => statusText(x), left: x => x.leftToInvoice,
  }, { key: "job", dir: "asc" });

  const exportCSV = () => downloadCSV("job-tracking",
    ["Job Number", "PO Number", "PO Amount", "Sales Order", "Proposal", "Description", "Type", "Status", "Left to Invoice", "Milestones"],
    sorted.map(x => [x.job, x.po, x.amount.toFixed(2), x.soNumber, x.proposalNumber, x.description, x.type === "so" ? "Sales Order" : "Proposal",
      statusText(x), x.leftToInvoice.toFixed(2), x.milestones.map(m => `${m.label} ${m.amount.toFixed(2)} [${m.state === "open" ? "not invoiced" : m.state}]`).join("; ")]));

  return <ReportCard title="Job Tracking" rangeLabel={rangeLabel} right={<>
    <span style={{ marginLeft: 12 }}><StatusToggle value={statusFilter} onChange={setStatusFilter} /></span>
    <CsvButton onClick={exportCSV} />
  </>}>
    {r.rows.length === 0
      ? <Empty icon={ICONS.job} title="No jobs" msg="Nothing matches those filters. Widen the date range or switch to All." />
      : <table><thead><tr>
        <SortTh label="Job #" col="job" sort={sort} onSort={onSort} />
        <SortTh label="PO #" col="po" sort={sort} onSort={onSort} />
        <SortTh label="PO Amount" col="amount" sort={sort} onSort={onSort} num />
        <SortTh label="SO #" col="so" sort={sort} onSort={onSort} />
        <SortTh label="Proposal" col="proposal" sort={sort} onSort={onSort} />
        <SortTh label="Description" col="desc" sort={sort} onSort={onSort} />
        <SortTh label="Type" col="type" sort={sort} onSort={onSort} />
        <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
        <th>Billing Milestones</th>
      </tr></thead>
        <tbody>{sorted.map(x => <tr key={x.key}>
          <td className="mono" style={{ fontWeight: 600 }}>{x.job || dash}</td>
          <td className="mono subtle">{x.po || "—"}</td>
          <td className="num mono">{money(x.amount)}</td>
          <td className="doc-id">{x.soNumber || dash}</td>
          <td className="doc-id">{x.proposalNumber || dash}</td>
          <td>{x.description || dash}</td>
          <td className="subtle">{x.type === "so" ? "Sales Order" : "Proposal"}</td>
          <td style={{ whiteSpace: "nowrap" }}>{trackingStatus(x)}</td>
          <td style={{ minWidth: 300 }}><Milestones list={x.milestones} /></td>
        </tr>)}
          <tr><td style={{ fontWeight: 700 }}>Total</td><td className="subtle">{r.rows.length} job{r.rows.length === 1 ? "" : "s"}</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{money(r.rows.reduce((t, x) => t + x.amount, 0))}</td><td colSpan={6}></td></tr>
        </tbody></table>}
    <p className="subtle" style={{ margin: "10px 16px 14px" }}>
      Milestones: <span className="ms">not invoiced</span><span className="ms ready">ready to invoice</span><span className="ms invoiced">invoiced</span><span className="ms closed">closed</span>
      — a sales order's lines; a proposal shows its invoicing schedule. Mark a line ready on the Jobs page.
      Open is everything not yet paid in full, plus proposals still out.
    </p>
  </ReportCard>;
}

/* ================= Job Costing (Jobs) ================= */

const specVal = (v) => (v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? "" : String(v));

export function JobCostingReport({ db, from, to, partyId, rangeLabel }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [full, setFull] = useState(false);
  const [open, setOpen] = useState({});
  const r = jobCostingReport(db, { from, to, partyId, statusFilter });
  // Full columns only carry what some job on the report has a figure for.
  const specCols = JOB_SPEC_FIELDS.filter(f => f.key !== "proposalDate" && r.rows.some(x => specVal(x.specs[f.key])));
  const budgetCols = BUDGET_LINES.filter(b => r.rows.some(x => x.budgetBy[b.key]));
  const costCols = COST_CATEGORIES.filter(c => r.rows.some(x => x.actual[c.key]));
  const labor = x => x.actual.labor || 0;
  const otherCost = x => x.totalCost - x.material - labor(x);
  const { sorted, sort, onSort } = useTableSort(r.rows, {
    job: x => x.job, po: x => x.po, amount: x => x.amount, so: x => x.soNumber, proposal: x => x.proposalNumber, desc: x => x.description,
    budget: x => x.budgetTotal, material: x => x.material, labor, other: otherCost, cost: x => x.totalCost,
    engProfit: x => x.engProfit, profit: x => x.profit, margin: x => (x.margin == null ? -Infinity : x.margin),
  }, { key: "job", dir: "asc" });
  const tone = v => (v > 0.005 ? "var(--pos)" : v < -0.005 ? "var(--neg)" : undefined);

  const exportCSV = () => downloadCSV("job-costing",
    ["Job Number", "PO Number", "PO Amount", "Sales Order", "Proposal", "Description",
      ...JOB_SPEC_FIELDS.map(f => f.label), ...BUDGET_LINES.map(b => "Budget: " + b.label), "Budget Total",
      ...COST_CATEGORIES.map(c => "Actual: " + c.label), "Material Total", "Hours", "Total Cost", "Engineering/Profit (PO − material)", "Profit", "Margin %"],
    sorted.map(x => [x.job, x.po, x.amount.toFixed(2), x.soNumber, x.proposalNumber, x.description,
      ...JOB_SPEC_FIELDS.map(f => specVal(x.specs[f.key])), ...BUDGET_LINES.map(b => x.budgetBy[b.key].toFixed(2)), x.budgetTotal.toFixed(2),
      ...COST_CATEGORIES.map(c => x.actual[c.key].toFixed(2)), x.material.toFixed(2), x.hours, x.totalCost.toFixed(2), x.engProfit.toFixed(2), x.profit.toFixed(2),
      x.margin == null ? "" : x.margin.toFixed(1)]));

  const ident = x => <>
    <td className="mono" style={{ fontWeight: 600 }}>{x.job || dash}</td>
    <td className="mono subtle">{x.po || "—"}</td>
    <td className="num mono">{money(x.amount)}</td>
    <td className="doc-id">{x.soNumber}</td>
    <td className="doc-id">{x.proposalNumber || dash}</td>
    <td>{x.description || dash}</td>
  </>;
  const identHead = <>
    <SortTh label="Job #" col="job" sort={sort} onSort={onSort} />
    <SortTh label="PO #" col="po" sort={sort} onSort={onSort} />
    <SortTh label="PO Amount" col="amount" sort={sort} onSort={onSort} num />
    <SortTh label="SO #" col="so" sort={sort} onSort={onSort} />
    <SortTh label="Proposal" col="proposal" sort={sort} onSort={onSort} />
    <SortTh label="Description" col="desc" sort={sort} onSort={onSort} />
  </>;
  const profitCells = x => <>
    <td className="num mono">{money(x.totalCost)}</td>
    <td className="num mono" style={{ fontWeight: 600, color: tone(x.profit) }}>{money(x.profit)}</td>
    <td className="num mono" style={{ color: tone(x.profit) }}>{x.margin == null ? "—" : x.margin.toFixed(0) + "%"}</td>
  </>;
  const cols = 6 + 1 + (full ? specCols.length + budgetCols.length + costCols.length + 2 : 4) + 3;

  return <ReportCard title="Job Costing" rangeLabel={rangeLabel} right={<>
    <span style={{ marginLeft: 12 }}><StatusToggle value={statusFilter} onChange={setStatusFilter} /></span>
    <Toggle checked={full} onChange={setFull}>All columns</Toggle>
    <CsvButton onClick={exportCSV} />
  </>}>
    {r.rows.length === 0
      ? <Empty icon={ICONS.job} title="No jobs" msg="Nothing matches those filters. Widen the date range or switch to All." />
      : <table><thead>
        {full && <tr>
          <th colSpan={7}></th>
          {specCols.length > 0 && <th colSpan={specCols.length} style={{ textAlign: "center", borderBottom: "2px solid var(--line)" }}>Specs</th>}
          {budgetCols.length > 0 && <th colSpan={budgetCols.length} style={{ textAlign: "center", borderBottom: "2px solid var(--accent)" }}>Proposal Budget</th>}
          <th colSpan={costCols.length + 2} style={{ textAlign: "center", borderBottom: "2px solid var(--warn)" }}>Actual Cost</th>
          <th colSpan={3}></th>
        </tr>}
        <tr>
          <th style={{ width: 30 }}></th>
          {identHead}
          {full
            ? <>
              {specCols.map(f => <th key={f.key} className={f.num ? "num" : undefined}>{f.label}</th>)}
              {budgetCols.map(b => <th key={b.key} className="num">{b.label}</th>)}
              {costCols.map(c => <th key={c.key} className="num">{c.label}</th>)}
              <SortTh label="Material Total" col="material" sort={sort} onSort={onSort} num />
              <SortTh label="Eng / Profit" col="engProfit" sort={sort} onSort={onSort} num />
            </>
            : <>
              <SortTh label="Budget" col="budget" sort={sort} onSort={onSort} num />
              <SortTh label="Material" col="material" sort={sort} onSort={onSort} num />
              <SortTh label="Labor" col="labor" sort={sort} onSort={onSort} num />
              <SortTh label="Other" col="other" sort={sort} onSort={onSort} num />
            </>}
          <SortTh label="Total Cost" col="cost" sort={sort} onSort={onSort} num />
          <SortTh label="Profit" col="profit" sort={sort} onSort={onSort} num />
          <SortTh label="Margin" col="margin" sort={sort} onSort={onSort} num />
        </tr></thead>
        <tbody>{sorted.map(x => {
          const isOpen = !!open[x.key];
          return <Fragment key={x.key}>
            <tr style={{ cursor: "pointer" }} onClick={() => setOpen(o => ({ ...o, [x.key]: !o[x.key] }))}>
              <td><span style={{ display: "inline-flex", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}><Ico d={ICONS.arrow} size={14} /></span></td>
              {ident(x)}
              {full
                ? <>
                  {specCols.map(f => <td key={f.key} className={f.num ? "num mono" : undefined}>{specVal(x.specs[f.key]) || dash}</td>)}
                  {budgetCols.map(b => <td key={b.key} className="num mono">{amt(x.budgetBy[b.key])}</td>)}
                  {costCols.map(c => <td key={c.key} className="num mono">{amt(x.actual[c.key])}</td>)}
                  <td className="num mono">{amt(x.material)}</td>
                  <td className="num mono" style={{ color: tone(x.engProfit) }}>{money(x.engProfit)}</td>
                </>
                : <>
                  <td className="num mono">{amt(x.budgetTotal)}</td>
                  <td className="num mono">{amt(x.material)}</td>
                  <td className="num mono">{amt(labor(x))}</td>
                  <td className="num mono">{amt(otherCost(x))}</td>
                </>}
              {profitCells(x)}
            </tr>
            {isOpen && <tr className="sub-row"><td></td><td colSpan={cols - 1}><JobCostDetail x={x} /></td></tr>}
          </Fragment>;
        })}
          <tr><td></td><td style={{ fontWeight: 700 }}>Total</td><td className="subtle">{r.rows.length} job{r.rows.length === 1 ? "" : "s"}</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.amount)}</td>
            <td colSpan={full ? 3 + specCols.length + budgetCols.length + costCols.length : 3}></td>
            {full
              ? <><td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.material)}</td><td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.engProfit)}</td></>
              : <><td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.budgetTotal)}</td><td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.material)}</td><td colSpan={2}></td></>}
            <td className="num mono" style={{ fontWeight: 700 }}>{money(r.totals.totalCost)}</td>
            <td className="num mono" style={{ fontWeight: 700, color: tone(r.totals.profit) }}>{money(r.totals.profit)}</td>
            <td></td></tr>
        </tbody></table>}
    <p className="subtle" style={{ margin: "10px 16px 14px" }}>
      Budget is the proposal's price lines as sold. Actual cost comes from vendor bills and expenses tagged to the job (their Job Cost Category sets the column),
      time logged to the job (hours × the cost rate), journal-entry lines that name the job, and costs entered by hand on the Jobs page (the $ button).
      Material is panel, HMI, cables, I/O blocks and Data National material. Profit and Eng / Profit (the sheet's S column) are taken on what the job
      brought in: the PO plus any extras invoiced beyond the order's lines, less lines closed without billing.
    </p>
  </ReportCard>;
}

// The opened job: what it was sold on next to what it cost, and every cost line.
function JobCostDetail({ x }) {
  const specs = JOB_SPEC_FIELDS.filter(f => specVal(x.specs[f.key]));
  const box = { flex: "1 1 220px", minWidth: 200 };
  return <div style={{ padding: "6px 0 10px" }}>
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 10 }}>
      <div style={box}><div style={{ fontWeight: 700, marginBottom: 4 }}>Specs</div>
        {specs.length ? <table><tbody>{specs.map(f => <tr key={f.key}><td className="subtle">{f.label}</td>
          <td className="mono">{f.key === "proposalDate" ? fmtDate(x.specs[f.key]) : specVal(x.specs[f.key])}</td></tr>)}</tbody></table>
          : <span className="subtle">No specs on file. A won proposal brings its own; for others, use the sheet import or add them on the sales order.</span>}</div>
      <div style={box}><div style={{ fontWeight: 700, marginBottom: 4 }}>Proposal Budget</div>
        {x.budget.length ? <table><tbody>{x.budget.map((b, i) => <tr key={i}><td>{b.label}</td><td className="num mono">{money(b.amount)}</td></tr>)}
          <tr><td style={{ fontWeight: 700 }}>Total</td><td className="num mono" style={{ fontWeight: 700 }}>{money(x.budgetTotal)}</td></tr></tbody></table>
          : <span className="subtle">No proposal budget on file.</span>}</div>
      <div style={box}><div style={{ fontWeight: 700, marginBottom: 4 }}>Actual by Category</div>
        <table><tbody>{COST_CATEGORIES.filter(c => x.actual[c.key]).map(c => <tr key={c.key}><td>{c.label}</td><td className="num mono">{money(x.actual[c.key])}</td></tr>)}
          <tr><td style={{ fontWeight: 700 }}>Total</td><td className="num mono" style={{ fontWeight: 700 }}>{money(x.totalCost)}</td></tr></tbody></table></div>
    </div>
    {x.items.length > 0 && <table><thead><tr><th>Date</th><th>Source</th><th>Category</th><th>Description</th><th className="num">Hours</th><th className="num">Amount</th></tr></thead>
      <tbody>{x.items.map(i => <tr key={i.source + i.id}><td className="subtle">{fmtDate(i.date)}</td><td className="subtle">{i.source}</td><td>{costLabel(i.category)}</td>
        <td>{i.desc || dash}</td><td className="num mono">{i.hours || ""}</td><td className="num mono">{money(i.amount)}</td></tr>)}</tbody></table>}
  </div>;
}
