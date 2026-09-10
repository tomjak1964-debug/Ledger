// Pure business-logic core, ported verbatim from ledger.html (CLAUDE.md §6).
// These run on the in-memory app shape; the Supabase adapter reassembles rows
// into that shape so nothing here changed.
import { sum, todayISO, daysBetween } from "../lib/helpers.js";

export function lineTotals(items, taxRate) {
  const sub = sum(items, i => (Number(i.qty) || 0) * (Number(i.unitPrice) || 0));
  const tax = sub * (Number(taxRate) || 0) / 100;
  return { sub, tax, total: sub + tax };
}
// `paid` is CASH — what moved through the bank. Every cash figure in the app
// (P&L, the registers, collected-to-date) reads it, so it must never absorb a
// discount.
export function paid(doc) { return sum(doc.payments || [], p => Number(p.amount) || 0); }
// A discount taken settles part of a document without cash moving: an early-pay
// term on a vendor bill, or one a customer took on an invoice.
export function discounts(doc) { return sum(doc.payments || [], p => Number(p.discount) || 0); }
// What closes the document: cash plus anything discounted off it.
export function settled(doc) { return paid(doc) + discounts(doc); }
export function balance(doc) { return round2(lineTotals(doc.lineItems, doc.taxRate).total - settled(doc)); }
// The bill equivalent of `balance`. Bills carry a single amount rather than line
// items, and this used to be hand-rolled at every call site — which is exactly
// how a discount would have been missed in one of them.
export function billBalance(bill) { return round2((Number(bill.amount) || 0) - settled(bill)); }
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export function invoiceStatus(inv) {
  const t = lineTotals(inv.lineItems, inv.taxRate).total;
  const p = settled(inv);
  if (p >= t - 0.005 && t > 0) return "paid";
  if (inv.dueDate && inv.dueDate < todayISO() && p < t) return "overdue";
  if (p > 0) return "partial";
  return "unpaid";
}
export function billStatus(bill) {
  const p = settled(bill);
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
