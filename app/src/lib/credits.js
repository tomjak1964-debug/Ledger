// Customer credits — credit memos entered as negative invoices.
//
// A credit is an invoice whose total is negative. Until it is applied it sits
// in Receivables with a negative balance, which is what "open credit" means.
// Applying it moves no cash: each allocation writes a pair of payment rows —
// the invoice gets +amount, the credit gets −amount — so both documents settle
// against `settled()` (CLAUDE.md §6) and every cash figure nets to zero.
import { lineTotals, balance, round2 } from "../calc/ledger.js";

export const CREDIT_METHOD = "Credit";

// kind is the document's own answer (migration 020). The negative-total rule
// stays for credits typed as negative invoices before credit notes existed.
export const isCreditMemo = inv =>
  inv?.kind === "credit" || lineTotals(inv?.lineItems, inv?.taxRate).total < -0.005;

// What a credit still has to give. A credit's balance is negative, so the
// remaining amount is its balance flipped.
export const creditRemaining = inv => round2(-balance(inv));

export const openCredits = (db, customerId) => (db.invoices || []).filter(i =>
  isCreditMemo(i) && creditRemaining(i) > 0.005 && (!customerId || i.customerId === customerId));

export const creditAvailable = (db, customerId) =>
  round2(openCredits(db, customerId).reduce((s, i) => s + creditRemaining(i), 0));

// Invoices a credit can go against: same customer, still owed, not the credit.
export const openInvoicesFor = (db, customerId) => (db.invoices || [])
  .filter(i => i.customerId === customerId && balance(i) > 0.005)
  .sort((a, b) => String(a.dueDate || a.date || "").localeCompare(String(b.dueDate || b.date || "")));

// Oldest first, until the credit runs out — the default way to spend one.
export function allocateOldestFirst(remaining, invoices) {
  let left = round2(remaining);
  const out = {};
  for (const inv of invoices) {
    if (left <= 0.005) break;
    const take = round2(Math.min(left, balance(inv)));
    if (take > 0.005) { out[inv.id] = take; left = round2(left - take); }
  }
  return out;
}
