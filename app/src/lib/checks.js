// The check register.
//
// There is no separate `checks` table: a check IS the set of Check-method bill
// payments that share one check number (`payment.ref`). A batch pay run writes
// several payments with the same ref — that's one physical check covering
// several bills — so uniqueness is per check number, not per payment row.
//
// Deleting/voiding a check deletes its payments, which reopens the bills (the
// balance is derived, CLAUDE.md §6) and frees the number for reuse.
import { round2 } from "../calc/ledger.js";

export const CHECK_METHOD = "Check";
export const normRef = (ref) => String(ref ?? "").trim();
const key = (ref) => normRef(ref).toLowerCase();
export const isCheckPayment = (p) => p.method === CHECK_METHOD && normRef(p.ref) !== "";

// Every check payment on a bill, flattened: { payment, bill }.
export function checkPayments(db) {
  return (db.bills || []).flatMap(b => (b.payments || []).filter(isCheckPayment).map(p => ({ payment: p, bill: b })));
}

// The register: one entry per check number, newest first.
export function checkRuns(db) {
  const m = new Map();
  checkPayments(db).forEach(({ payment, bill }) => {
    const k = key(payment.ref);
    if (!m.has(k)) m.set(k, { ref: normRef(payment.ref), date: payment.date, vendorId: bill.vendorId, amount: 0, entries: [] });
    const run = m.get(k);
    run.amount = round2(run.amount + (Number(payment.amount) || 0));
    run.entries.push({ paymentId: payment.id, billId: bill.id, amount: Number(payment.amount) || 0 });
    if ((payment.date || "") > (run.date || "")) run.date = payment.date;
  });
  return [...m.values()].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.ref.localeCompare(a.ref));
}

// True when this check number is already in use by a payment we're not editing.
// `allowIds` are the payment ids that belong to the check being written, so
// re-saving or extending an existing check run doesn't collide with itself.
export function checkNumberTaken(db, ref, allowIds = []) {
  const k = key(ref);
  if (!k) return false;
  const allow = new Set(allowIds);
  return checkPayments(db).some(({ payment }) => key(payment.ref) === k && !allow.has(payment.id));
}

// The next check to pull off the stack: one past the highest number used,
// never below the starting number from Settings → Check Printing. Voiding the
// most recent check hands its number straight back.
export function nextCheckNumber(db, settings) {
  const start = parseInt(settings?.check?.start, 10);
  const floor = Number.isFinite(start) && start > 0 ? start : 1001;
  const highest = checkPayments(db).reduce((max, { payment }) => {
    const n = parseInt(normRef(payment.ref), 10);
    return Number.isFinite(n) && String(n) === normRef(payment.ref).replace(/^0+(?=\d)/, "") ? Math.max(max, n) : max;
  }, 0);
  return String(Math.max(floor, highest + 1));
}

// Where a vendor's remittance advice should be emailed: the A/P contact if the
// vendor has one, otherwise the general address.
export const remitEmail = (vendor) => (vendor?.remitEmail || "").trim() || (vendor?.email || "").trim();
