// Recurring invoices and bills (migration 043): a template made from a document,
// how often it repeats, and the next date it's due. Ledger has no scheduler, so
// nothing is created on its own — Invoices and Payables list what's due and make
// it on a click; each one made is an ordinary invoice or bill, and the template
// moves on to its next date.
import { uid, addDays } from "../lib/helpers.js";
import { dueDateFor } from "../lib/terms.js";
const AUTO_NUMBER = "(auto)";   // the same marker store.js numbers a new invoice from

export const EVERY = [["week", "Every week"], ["month", "Every month"], ["quarter", "Every quarter"], ["year", "Every year"]];
export const everyLabel = e => (EVERY.find(([k]) => k === e) || EVERY[1])[1];

// The next date after `date`: a week on, or the same day of the month a month,
// a quarter or a year on (the 31st falls back to the month's last day).
export function advance(date, every) {
  if (every === "week") return addDays(date, 7);
  const months = every === "quarter" ? 3 : every === "year" ? 12 : 1;
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// Due: active, on or past its next date, and not past its end date.
export const isDue = (r, today) => r.active && r.nextDate && r.nextDate <= today && (!r.endDate || r.nextDate <= r.endDate);
export const finished = r => !!r.endDate && r.nextDate > r.endDate;

// What a document repeats: its party, lines, tax, notes and accounts — never its
// number, dates, payments, or the sales order / PO it came from.
export function templateFrom(kind, doc) {
  if (kind === "invoice") return {
    customerId: doc.customerId || "", contactPersonId: doc.contactPersonId || "", poNumber: doc.poNumber || "",
    taxRate: doc.taxRate || 0, notes: doc.notes || "", incomeAccount: doc.incomeAccount || "",
    lineItems: (doc.lineItems || []).map(li => ({ desc: li.desc ?? "", qty: li.qty, unit: li.unit ?? "", unitPrice: li.unitPrice })),
  };
  const lines = (doc.lines || []).length ? doc.lines : [{ desc: "", qty: 1, unitPrice: doc.amount, account: doc.expenseAccount || "", salesOrderId: doc.salesOrderId || "", costCategory: doc.costCategory || "" }];
  return {
    vendorId: doc.vendorId || "", expenseAccount: doc.expenseAccount || "", notes: doc.notes || "",
    lines: lines.map(l => ({ desc: l.desc || "", qty: l.qty ?? 1, unitPrice: l.unitPrice ?? l.amount, account: l.account || "", salesOrderId: l.salesOrderId || "", costCategory: l.costCategory || "" })),
  };
}
export const templateTotal = (kind, t) => kind === "invoice"
  ? (t.lineItems || []).reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0) * (1 + (Number(t.taxRate) || 0) / 100)
  : (t.lines || []).reduce((s, l) => s + (l.qty === "" || l.qty == null ? 1 : Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

// The document a template makes, dated `date`. A bill's vendor invoice # must be
// unique per vendor, so it is the template's name initials and the date
// (REC-261114) — change it to the vendor's own number when it arrives.
export function docFromTemplate(db, r, date) {
  const t = r.template || {};
  if (r.kind === "invoice") return {
    id: uid(), number: AUTO_NUMBER, _new: true, kind: "invoice", salesOrderId: "", quoteId: "", proposalId: "",
    customerId: t.customerId, contactPersonId: t.contactPersonId || "", poNumber: t.poNumber || "",
    date, dueDate: dueDateFor(db, t.customerId, date), taxRate: t.taxRate || 0, notes: t.notes || "", incomeAccount: t.incomeAccount || "",
    lineItems: (t.lineItems || []).map(li => ({ id: uid(), desc: li.desc, qty: li.qty, unit: li.unit || "", unitPrice: li.unitPrice })),
    printed: false, payments: [],
  };
  const ref = `REC-${date.slice(2).replace(/-/g, "")}`;
  return {
    id: uid(), _new: true, vendorId: t.vendorId, date, dueDate: dueDateFor(db, t.vendorId, date), ref,
    notes: [t.notes, `Recurring: ${r.name}`].filter(Boolean).join("\n"), expenseAccount: t.expenseAccount || "", salesOrderId: "", costCategory: "",
    lines: (t.lines || []).map(l => ({ ...l, id: uid() })), amount: Math.round(templateTotal("bill", t) * 100) / 100, payments: [],
  };
}
