// Report calculations — pure functions over the in-memory db shape, in the
// spirit of the calc core. All money flows through the same lineTotals/paid
// rules the rest of the app uses.
//
// Basis notes (matters if you file taxes on these numbers):
//  * P&L here is CASH BASIS: income = payments received in the range,
//    outgoing = expense entries dated in the range + bill payments made in the
//    range. That matches how most small shops without inventory file.
//  * Sales tax shows BOTH: tax invoiced in the range (accrual — what most
//    states expect you to remit) and tax collected via payments in the range
//    (cash), allocated proportionally when an invoice is partially paid.
import { sum } from "../lib/helpers.js";
import { lineTotals, paid, balance } from "./ledger.js";

const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);

export function plCashBasis(db, from, to) {
  let income = 0;
  db.invoices.forEach(inv => (inv.payments || []).forEach(p => { if (inRange(p.date, from, to)) income += Number(p.amount) || 0; }));
  const cats = {};
  let expensesTotal = 0;
  db.expenses.forEach(e => {
    if (!inRange(e.date, from, to)) return;
    const a = Number(e.amount) || 0;
    cats[e.category || "Uncategorized"] = (cats[e.category || "Uncategorized"] || 0) + a;
    expensesTotal += a;
  });
  let billsPaid = 0;
  db.bills.forEach(b => (b.payments || []).forEach(p => { if (inRange(p.date, from, to)) billsPaid += Number(p.amount) || 0; }));
  const totalOut = expensesTotal + billsPaid;
  return {
    income,
    categories: Object.entries(cats).sort((a, b) => b[1] - a[1]),
    expensesTotal, billsPaid, totalOut,
    net: income - totalOut,
  };
}

export function salesTaxReport(db, from, to) {
  const rows = [];
  let sub = 0, tax = 0, taxCollected = 0;
  db.invoices.forEach(inv => {
    const t = lineTotals(inv.lineItems, inv.taxRate);
    if (inRange(inv.date, from, to)) {
      rows.push({ inv, sub: t.sub, tax: t.tax, total: t.total });
      sub += t.sub; tax += t.tax;
    }
    if (t.total > 0 && t.tax > 0) {
      (inv.payments || []).forEach(p => {
        if (inRange(p.date, from, to)) taxCollected += (Number(p.amount) || 0) * (t.tax / t.total);
      });
    }
  });
  rows.sort((a, b) => (a.inv.date || "").localeCompare(b.inv.date || ""));
  return { rows, sub, tax, taxCollected };
}

export function salesByCustomer(db, from, to) {
  const m = {};
  db.invoices.forEach(inv => {
    if (!inRange(inv.date, from, to)) return;
    const k = inv.customerId || "";
    const t = lineTotals(inv.lineItems, inv.taxRate).total;
    m[k] ||= { customerId: k, count: 0, invoiced: 0, collected: 0, balance: 0 };
    m[k].count++; m[k].invoiced += t; m[k].collected += paid(inv); m[k].balance += Math.max(0, balance(inv));
  });
  return Object.values(m).sort((a, b) => b.invoiced - a.invoiced);
}

export function expensesByCategory(db, from, to) {
  const cats = {};
  let total = 0, count = 0;
  db.expenses.forEach(e => {
    if (!inRange(e.date, from, to)) return;
    const a = Number(e.amount) || 0;
    const k = e.category || "Uncategorized";
    cats[k] ||= { category: k, count: 0, total: 0 };
    cats[k].count++; cats[k].total += a; total += a; count++;
  });
  return { rows: Object.values(cats).sort((a, b) => b.total - a.total), total, count };
}

// Everything a customer still owes, oldest first, for a printable statement.
export function customerStatement(db, customerId) {
  const open = db.invoices
    .filter(i => i.customerId === customerId && balance(i) > 0.005)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return { open, totalDue: sum(open, balance) };
}
