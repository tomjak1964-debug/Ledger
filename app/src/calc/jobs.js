// Jobs, as the shop's job-tracking sheet saw them: a sales order with a job
// number, a description, the specs and proposal budget it was sold on, the five
// billing milestones it invoices through, and the costs booked against it.
// Pure functions over the db object; the reports in views/Reports.jsx read them.
import { lineTotals, paid, settled, balance, round2 } from "./ledger.js";
import { sum, nameOf } from "../lib/helpers.js";

const n = v => Number(v) || 0;
const inRange = (d, from, to) => (!from || (d || "") >= from) && (!to || (d || "") <= to);

/* ---------- the sheet's columns ---------- */

// The proposal's price lines, in the order the sheet carried them (AE–AM).
// A saved pricing snapshot names its lines in words, so each key also carries
// the pattern that recognises it; a line nothing recognises is "other".
export const BUDGET_LINES = [
  { key: "eng", label: "Engineering / Start-Up", match: /engineering|start.?up/i },
  { key: "dnCheckout", label: "Data National Checkout", match: /data.?national.*check/i },
  { key: "panel", label: "Control Panel", match: /panel|hmi|bingo|hardware/i },
  { key: "blockIo", label: "Block I/O", match: /block.?i\/?o|i\/?o.?block/i },
  { key: "dnMaterial", label: "Data National Material", match: /data.?national.*material/i },
  { key: "fieldWiring", label: "Field Wiring", match: /field.?wir/i },
  { key: "runoff", label: "Run Off Support", match: /run.?off|field services/i },
  { key: "remotePanels", label: "Remote Panels", match: /remote.*(sonic|panel)/i },
  { key: "remoteHmi", label: "Remote HMI", match: /remote.*hmi/i },
  { key: "other", label: "Other", match: null },
];
// Remote HMI / remote panels before "panel", data national before the rest.
const MATCH_ORDER = ["remoteHmi", "remotePanels", "dnCheckout", "dnMaterial", "blockIo", "fieldWiring", "runoff", "eng", "panel"];
export const budgetKeyOf = label => MATCH_ORDER.find(k => BUDGET_LINES.find(b => b.key === k).match.test(label || "")) || "other";

// What a job's cost lands in. The first five are the sheet's material columns
// (L, N, O, P, Q — "Material Total" is their sum); the rest are the work.
export const COST_CATEGORIES = [
  { key: "panel", label: "Control Panel", material: true },
  { key: "hmi", label: "HMI / Bingo Board", material: true },
  { key: "cables", label: "Base Cables", material: true },
  { key: "ioBlocks", label: "I/O Blocks", material: true },
  { key: "dnMaterial", label: "Data National Material", material: true },
  { key: "fieldWiring", label: "Field Wiring", material: false },
  { key: "labor", label: "Engineering Labor", material: false },
  { key: "travel", label: "Travel & Living", material: false },
  { key: "other", label: "Other", material: false },
];
const costKey = k => (COST_CATEGORIES.some(c => c.key === k) ? k : "other");
export const costLabel = k => COST_CATEGORIES.find(c => c.key === costKey(k)).label;

// The quantities a fixture was priced from (the sheet's U–AD, plus the counts
// a Ledger proposal prices on). Proposal specs use the same keys.
export const JOB_SPEC_FIELDS = [
  { key: "machineType", label: "Fixture Type" }, { key: "generators", label: "Sonic Gen", num: true },
  { key: "horns", label: "Horns", num: true }, { key: "panelSize", label: "Panel Size" },
  { key: "plc", label: "PLC" }, { key: "program", label: "Program" },
  { key: "ioBlocks", label: "I/O Blocks", num: true }, { key: "cameras", label: "Cameras", num: true },
  { key: "dataNational", label: "Data National" }, { key: "welds", label: "Welds", num: true },
  { key: "clamps", label: "Clamps", num: true }, { key: "pp", label: "Pick Points", num: true },
  { key: "nests", label: "Nests", num: true }, { key: "clips", label: "Clips", num: true },
  { key: "tabs", label: "Tabs", num: true }, { key: "torque", label: "Torque Tools", num: true },
  { key: "ioLink", label: "IO-Link", num: true }, { key: "proposalDate", label: "Proposal Date" },
];

/* ---------- one job ---------- */

export const proposalOf = (db, so) => (db.proposals || []).find(p => p.salesOrderId === so.id && p.status !== "superseded");
export const jobNumberOf = (db, so) => so.jobNumber || proposalOf(db, so)?.jobNumber || "";
export const jobDescriptionOf = (db, so) => so.description || proposalOf(db, so)?.description || "";

// The price lines a job was sold on, as { key, label, amount }. The SO's own
// copy wins (a won proposal stamps it; the sheet import filled the rest);
// otherwise it is read off the linked proposal's pricing.
export function budgetOf(db, so, prop = proposalOf(db, so)) {
  if (Array.isArray(so?.budget) && so.budget.length) return so.budget.map(b => ({ ...b, key: b.key || budgetKeyOf(b.label), amount: n(b.amount) }));
  return proposalBudget(prop);
}
export function proposalBudget(p) {
  const pr = p?.pricing || {};
  if (p?.kind === "controls") return [
    { key: "eng", label: "Controls Engineering", amount: n(pr.engineeringTotal) },
    { key: "panel", label: "Control Hardware", amount: n(pr.hardwareTotal) },
    { key: "runoff", label: "Field Services", amount: n(pr.fieldTotal) },
    { key: "other", label: "Contingency", amount: n(pr.contingency) },
  ].filter(b => b.amount);
  return [...(pr.baseLines || []), ...(pr.premiumLines || [])]
    .filter(l => n(l.amount)).map(l => ({ key: budgetKeyOf(l.label), label: l.label, amount: n(l.amount) }));
}
export const budgetByKey = lines => Object.fromEntries(BUDGET_LINES.map(b => [b.key, round2(sum(lines.filter(l => l.key === b.key), l => l.amount))]));

export function specsOf(db, so, prop = proposalOf(db, so)) {
  if (so?.specs && Object.keys(so.specs).length) return so.specs;
  return proposalSpecs(db, prop);
}
export function proposalSpecs(db, p) {
  if (!p) return {};
  const s = p.specs || {};
  const mt = (db.machineTypes || []).find(m => m.id === p.machineTypeId);
  return { ...s, machineType: mt?.name || s.machineType || "", ioBlocks: s.ioBlocks === "" || s.ioBlocks == null ? (p.pricing?.blocks ?? "") : s.ioBlocks,
    dataNational: s.dataNational === true ? "Yes" : s.dataNational === false ? "No" : s.dataNational || "", proposalDate: p.date || "" };
}

// Each SO line as a billing milestone: invoiced (orange), ready to invoice
// (blue), not yet (plain), or closed without billing.
export const lineState = li => (li.invoiced ? "invoiced" : li.closed ? "closed" : li.ready ? "ready" : "open");
const lineAmount = (li, taxRate) => lineTotals([li], taxRate).total;

// Where a sales order stands: what it is worth, what is left to bill, what is
// billed and not yet paid, what has been paid. "Paid" is settled — cash plus
// any discount the customer took — so the four figures add up.
export function soSummary(db, so) {
  const lines = so.lineItems || [];
  const amount = round2(lineTotals(lines, so.taxRate).total);
  const invoices = db.invoices.filter(i => i.salesOrderId === so.id && i.kind !== "credit");
  const invoicedAmt = round2(sum(invoices, i => lineTotals(i.lineItems, i.taxRate).total));
  // What the unflagged lines are worth, but never more than the order less
  // what has been invoiced against it: an SO carried over from Sage as one
  // line, invoiced in full without the line ever being flagged, is not still
  // waiting to be billed.
  const unflagged = round2(sum(lines.filter(li => !li.invoiced && !li.closed), li => lineAmount(li, so.taxRate)));
  const leftToInvoice = Math.max(0, Math.min(unflagged, round2(amount - invoicedAmt)));
  const outstanding = round2(sum(invoices, i => Math.max(0, balance(i))));
  const paidAmt = round2(sum(invoices, i => settled(i)));
  const cash = round2(sum(invoices, i => paid(i)));
  // Extras: what was invoiced beyond the order's own lines — field start-up
  // or extra work added as lines when the job was billed. With them, the
  // order reads Amount + Extras − Closed = Left + Outstanding + Paid.
  // A line closed unbilled only counts as unbilled as far as the invoices
  // actually fall short of the order: Sage carried some lines over as closed
  // that were in fact invoiced.
  const closedLines = round2(sum(lines.filter(li => li.closed && !li.invoiced), li => lineAmount(li, so.taxRate)));
  const closedAmt = Math.min(closedLines, Math.max(0, round2(amount - leftToInvoice - invoicedAmt)));
  const extras = Math.max(0, round2(invoicedAmt - (amount - leftToInvoice - closedAmt)));
  const revenue = round2(amount + extras - closedAmt);   // what the job is worth as billed
  const open = leftToInvoice > 0.005 || outstanding > 0.005;
  const anyInvoiced = invoices.length > 0 || lines.some(li => li.invoiced);
  // The job-tracking reading of the same numbers.
  const stage = leftToInvoice > 0.005 ? (anyInvoiced ? "partial" : "notStarted") : outstanding > 0.005 ? "invoiced" : "paid";
  return { amount, extras, closedAmt, revenue, leftToInvoice, outstanding, paid: paidAmt, cash, invoicedAmt, invoices, open, status: open ? "open" : "closed", stage };
}
export const STAGE_LABEL = { notStarted: "Not invoiced", partial: "Partial", invoiced: "Invoiced", paid: "Paid" };

/* ---------- report 1: sales orders ---------- */

// statusFilter: "all" | "open" | "closed". Dated by the SO's order date.
export function salesOrderReport(db, { from, to, partyId, statusFilter = "all" } = {}) {
  const rows = db.salesOrders
    .filter(so => inRange(so.date, from, to) && (!partyId || so.customerId === partyId))
    .map(so => {
      const s = soSummary(db, so);
      // Which SO lines each invoice billed: a line points at its invoice when
      // the store wrote it; otherwise the invoice's own lines are shown.
      const invoices = s.invoices.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(inv => ({
        inv, total: round2(lineTotals(inv.lineItems, inv.taxRate).total), paid: round2(settled(inv)), balance: balance(inv),
        soLines: (so.lineItems || []).filter(li => li.invoiceId === inv.id),
      }));
      const unbilled = (so.lineItems || []).filter(li => !li.invoiced && !li.closed);
      const closedLines = (so.lineItems || []).filter(li => li.closed && !li.invoiced);
      return { so, ...s, job: jobNumberOf(db, so), customer: nameOf(db, so.customerId), invoiceRows: invoices, unbilled, closedLines };
    })
    .filter(r => statusFilter === "all" || r.status === statusFilter);
  const tot = k => round2(sum(rows, r => r[k]));
  return { rows, totals: { amount: tot("amount"), extras: tot("extras"), leftToInvoice: tot("leftToInvoice"), outstanding: tot("outstanding"), paid: tot("paid") } };
}

/* ---------- report 2: job tracking ---------- */

// Every job in flight: each sales order, and each proposal not yet won (a
// proposal that became an SO shows as that SO). statusFilter: "all" | "open"
// (proposals out, SOs not paid in full) | "closed" (paid, lost, superseded).
export function jobTrackingReport(db, { from, to, partyId, statusFilter = "all" } = {}) {
  const soRows = db.salesOrders.map(so => {
    const prop = proposalOf(db, so);
    const s = soSummary(db, so);
    return {
      key: "so:" + so.id, type: "so", date: so.date, customerId: so.customerId,
      job: jobNumberOf(db, so), po: so.poNumber || "", amount: s.amount, soNumber: so.number, proposalNumber: prop?.number || "",
      description: jobDescriptionOf(db, so), stage: s.stage, leftToInvoice: s.leftToInvoice, outstanding: s.outstanding, paid: s.paid,
      milestones: (so.lineItems || []).map(li => ({ id: li.id, label: milestoneLabel(li.desc), desc: li.desc, amount: lineAmount(li, so.taxRate), state: lineState(li) })),
      open: s.stage !== "paid", so,
    };
  });
  const propRows = (db.proposals || []).filter(p => !p.salesOrderId && p.status !== "won").map(p => ({
    key: "p:" + p.id, type: "proposal", date: p.date, customerId: p.customerId,
    job: p.jobNumber || "", po: p.poNumber || "", amount: n(p.pricing?.total), soNumber: "", proposalNumber: p.number,
    description: p.description || "", stage: p.status, leftToInvoice: n(p.pricing?.total), outstanding: 0, paid: 0,
    milestones: (p.phases || []).map(ph => ({ id: ph.key, label: ph.label, desc: ph.label, amount: round2(n(p.pricing?.total) * n(ph.pct) / 100), state: ph.invoiceId ? "invoiced" : "open" })),
    open: p.status === "draft" || p.status === "submitted", proposal: p,
  }));
  const rows = [...soRows, ...propRows]
    .filter(r => inRange(r.date, from, to) && (!partyId || r.customerId === partyId))
    .filter(r => statusFilter === "all" || (statusFilter === "open" ? r.open : !r.open));
  return { rows };
}
// "4724-F3 Field Wire Complete" → "Field Wire Complete": the job number the
// line text starts with is already in its own column.
export function milestoneLabel(desc) {
  const first = String(desc || "").split("\n")[0];
  return first.replace(/^\s*[A-Z]{0,3}\d[\w-]*\s+(?=[A-Za-z])/, "").trim() || first;
}

/* ---------- report 3: job costing ---------- */

// Every cost booked to a job, wherever it was booked: entries made by hand
// (job_costs), vendor bills and expenses tagged to the job, time logged to it
// (hours × the cost rate snapshotted on the entry), and journal-entry lines
// that name the job. Each comes back as { source, date, category, desc, hours, amount }.
export function jobCostItems(db, so) {
  const out = [];
  (db.jobCosts || []).filter(c => c.salesOrderId === so.id).forEach(c =>
    out.push({ source: c.source === "sheet" ? "Sheet" : "Manual", id: c.id, date: c.date, category: costKey(c.category), desc: c.description, hours: n(c.hours), amount: n(c.amount), editable: true }));
  db.bills.filter(b => b.salesOrderId === so.id).forEach(b =>
    out.push({ source: "Bill", id: b.id, date: b.date, category: costKey(b.costCategory), desc: `${b.number} · ${nameOf(db, b.vendorId)}${b.ref ? " · " + b.ref : ""}`, hours: 0, amount: n(b.amount) }));
  db.expenses.filter(e => e.salesOrderId === so.id).forEach(e =>
    out.push({ source: "Expense", id: e.id, date: e.date, category: costKey(e.costCategory), desc: [e.vendor, e.notes].filter(Boolean).join(" · "), hours: 0, amount: n(e.amount) }));
  (db.timeEntries || []).filter(t => t.salesOrderId === so.id).forEach(t =>
    out.push({ source: "Time", id: t.id, date: t.date, category: "labor", desc: [t.userEmail, t.description].filter(Boolean).join(" · "), hours: n(t.hours), amount: round2(n(t.hours) * n(t.cost)) }));
  (db.journalEntries || []).forEach(j => (j.lines || []).forEach(l => {
    if (l.salesOrderId !== so.id) return;
    out.push({ source: "Journal", id: j.id + ":" + l.id, date: j.date, category: costKey(l.costCategory), desc: [j.number, l.desc || j.memo].filter(Boolean).join(" · "), hours: 0, amount: round2(n(l.debit) - n(l.credit)) });
  }));
  return out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

export function jobCostingReport(db, { from, to, partyId, statusFilter = "all" } = {}) {
  const rows = db.salesOrders
    .filter(so => inRange(so.date, from, to) && (!partyId || so.customerId === partyId))
    .map(so => {
      const prop = proposalOf(db, so);
      const s = soSummary(db, so);
      const budget = budgetOf(db, so, prop);
      const items = jobCostItems(db, so);
      const actual = Object.fromEntries(COST_CATEGORIES.map(c => [c.key, round2(sum(items.filter(i => i.category === c.key), i => i.amount))]));
      const material = round2(sum(COST_CATEGORIES.filter(c => c.material), c => actual[c.key]));
      const totalCost = round2(sum(COST_CATEGORIES, c => actual[c.key]));
      const hours = round2(sum(items, i => i.hours));
      return {
        so, prop, key: so.id, job: jobNumberOf(db, so), po: so.poNumber || "", soNumber: so.number, proposalNumber: prop?.number || "",
        description: jobDescriptionOf(db, so), customer: nameOf(db, so.customerId), date: so.date,
        amount: s.amount, extras: s.extras, revenue: s.revenue, stage: s.stage, open: s.stage !== "paid",
        specs: specsOf(db, so, prop), budget, budgetBy: budgetByKey(budget), budgetTotal: round2(sum(budget, b => b.amount)),
        items, actual, material, totalCost, hours,
        // The sheet's S column: the PO less material — what engineering earned.
        // Profit is on the revenue — the PO plus any extras invoiced, less lines closed unbilled.
        engProfit: round2(s.revenue - material),
        profit: round2(s.revenue - totalCost),
        margin: s.revenue > 0.005 ? (s.revenue - totalCost) / s.revenue * 100 : null,
      };
    })
    .filter(r => statusFilter === "all" || (statusFilter === "open" ? r.open : !r.open));
  const tot = k => round2(sum(rows, r => r[k]));
  return { rows, totals: { amount: tot("amount"), extras: tot("extras"), budgetTotal: tot("budgetTotal"), material: tot("material"), totalCost: tot("totalCost"), profit: tot("profit"), engProfit: tot("engProfit") } };
}
