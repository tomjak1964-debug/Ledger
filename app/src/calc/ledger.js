// Pure business-logic core, ported verbatim from ledger.html (CLAUDE.md §6).
// These run on the in-memory app shape; the Supabase adapter reassembles rows
// into that shape so nothing here changed.
import { sum, todayISO, daysBetween } from "../lib/helpers.js";

export function lineTotals(items, taxRate) {
  const sub = sum(items, i => (Number(i.qty) || 0) * (Number(i.unitPrice) || 0));
  const tax = sub * (Number(taxRate) || 0) / 100;
  return { sub, tax, total: sub + tax };
}
export function paid(doc) { return sum(doc.payments || [], p => Number(p.amount) || 0); }
export function balance(doc) { return round2(lineTotals(doc.lineItems, doc.taxRate).total - paid(doc)); }
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export function invoiceStatus(inv) {
  const t = lineTotals(inv.lineItems, inv.taxRate).total;
  const p = paid(inv);
  if (p >= t - 0.005 && t > 0) return "paid";
  if (inv.dueDate && inv.dueDate < todayISO() && p < t) return "overdue";
  if (p > 0) return "partial";
  return "unpaid";
}
export function billStatus(bill) {
  const p = paid(bill);
  if (p >= (Number(bill.amount) || 0) - 0.005) return "paid";
  if (bill.dueDate && bill.dueDate < todayISO()) return "overdue";
  if (p > 0) return "partial";
  return "unpaid";
}

export function agingBuckets(items, dueOf, balOf) {
  const b = { cur: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  items.forEach(it => {
    const bal = balOf(it); if (bal <= 0) return;
    const overdueDays = daysBetween(dueOf(it), todayISO());
    if (overdueDays <= 0) b.cur += bal; else if (overdueDays <= 30) b.d30 += bal; else if (overdueDays <= 60) b.d60 += bal; else if (overdueDays <= 90) b.d90 += bal; else b.d90p += bal;
  });
  return b;
}
