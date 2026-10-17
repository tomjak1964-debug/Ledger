// Bank reconciliation: the cash register out of the ledger, what has cleared,
// and matching a statement against it.
//
// The register is not a table of its own — it is every ledger line on the
// cash account (calc/gl.js), so a receipt, a check, an expense entry, a
// journal line and the opening-balance entry all show up, and anything
// corrected in the books corrects itself here. Each item has a stable key:
//   receipt:<payment id> · payment:<payment id> · expense:<expense id> ·
//   journal:<entry id>:<line index>
// Clearing an item writes that key to bank_cleared_items (migration 027) with
// the reconciliation it cleared in, so the next statement only shows what is
// still outstanding.
//
// The arithmetic is the plain one: the bank's balance is the sum of every
// item that has ever cleared, so
//   difference = statement ending balance − Σ cleared items on the account
// and a reconciliation is done when that is zero. There is no "last
// reconciled balance" to carry, because the cleared items carry it.
import { journal } from "./gl.js";
import { accountSettings } from "./accounts.js";
import { round2, billBalance, balance } from "./ledger.js";
import { sum, daysBetween } from "../lib/helpers.js";

export const itemKey = (source, lineIdx) =>
  source.type === "journal" ? `journal:${source.id}:${lineIdx}` : `${source.type}:${source.id}`;

// Every ledger line on `account` (default: the cash account in Settings),
// oldest first. amount is signed from the bank's side: a deposit positive, a
// check negative.
export function cashRegister(db, account) {
  const acct = String(account || accountSettings(db.settings).cash);
  const out = [];
  journal(db, { close: false }).forEach(e => e.lines.forEach((l, i) => {
    if (String(l.account) !== acct) return;
    out.push({
      key: itemKey(e.source, i), date: e.date, memo: l.memo ? `${e.memo}: ${l.memo}` : e.memo, party: e.party || "",
      ref: e.source.ref || (e.source.type === "journal" ? e.source.number : "") || "", type: e.source.type, sourceId: e.source.id,
      amount: round2(l.debit - l.credit),
    });
  }));
  out.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.key.localeCompare(b.key));
  return out;
}

// The state of one reconciliation: the items on the statement's side of the
// date with their cleared flag, the totals, and the difference still to find.
export function reconcileState(db, recon) {
  const account = String(recon.account || accountSettings(db.settings).cash);
  // Each statement counts what cleared on it and on the statements before it —
  // never a later one. Otherwise February's clearing would move January's
  // difference off zero after January was finished.
  const dateOf = new Map((db.bankReconciliations || []).map(r => [r.id, r.statementDate]));
  const upTo = c => c.reconciliationId === recon.id || (dateOf.get(c.reconciliationId) || "") < recon.statementDate;
  const cleared = new Map((db.bankCleared || []).filter(c => String(c.account) === account && upTo(c)).map(c => [c.itemKey, c]));
  const register = cashRegister(db, account);
  const items = register
    .filter(it => it.date && it.date <= recon.statementDate)
    .map(it => { const c = cleared.get(it.key); return { ...it, cleared: !!c, thisRecon: !!c && c.reconciliationId === recon.id, otherRecon: !!c && c.reconciliationId !== recon.id }; })
    .filter(it => !it.otherRecon);   // cleared on an earlier statement: no longer the bank's business here
  // (an item a LATER statement cleared shows here as outstanding, as it was at this statement's date)
  const clearedTotal = round2(sum([...cleared.values()], c => Number(c.amount) || 0));
  const thisCleared = items.filter(it => it.thisRecon);
  const outstanding = items.filter(it => !it.cleared);
  const bookBalance = round2(sum(register.filter(it => it.date && it.date <= recon.statementDate), it => it.amount));
  return {
    account, items,
    deposits: items.filter(it => it.amount > 0), payments: items.filter(it => it.amount < 0),
    clearedTotal, difference: round2((Number(recon.statementBalance) || 0) - clearedTotal),
    clearedDeposits: round2(sum(thisCleared.filter(it => it.amount > 0), it => it.amount)),
    clearedPayments: round2(-sum(thisCleared.filter(it => it.amount < 0), it => it.amount)),
    outstanding, outstandingDeposits: round2(sum(outstanding.filter(it => it.amount > 0), it => it.amount)),
    outstandingPayments: round2(-sum(outstanding.filter(it => it.amount < 0), it => it.amount)),
    bookBalance,
  };
}

// The check number in a register item's reference or a statement line's
// description, if there is one.
const checkNo = s => { const m = String(s || "").match(/(?:^|check\s*#?\s*|chk\s*#?\s*|#)(\d{3,7})\b/i); return m ? m[1] : ""; };

// Pair statement lines with uncleared register items: same amount and sign,
// the check number when both have one, else the nearest date within `days`.
// Each item is used once. A line with no partner comes back with item null —
// something the bank knows about that the books don't (yet).
export function matchStatement(lines, items, { days = 10 } = {}) {
  const free = items.filter(it => !it.cleared).map(it => ({ it, used: false }));
  const out = [];
  // Check-number matches first, so a same-amount check can't steal another's slot.
  const pass = (pred) => lines.forEach((ln, i) => {
    if (out[i]) return;
    const cands = free.filter(f => !f.used && Math.abs(Math.abs(f.it.amount) - Math.abs(ln.amount)) < 0.005 && Math.sign(f.it.amount) === Math.sign(ln.amount) && pred(f.it, ln));
    if (!cands.length) return;
    cands.sort((a, b) => Math.abs(daysBetween(a.it.date, ln.date)) - Math.abs(daysBetween(b.it.date, ln.date)));
    cands[0].used = true;
    out[i] = { line: ln, item: cands[0].it };
  });
  pass((it, ln) => { const a = checkNo(it.ref), b = ln.checkNo || checkNo(ln.desc); return a && b && a === b; });
  pass((it, ln) => Math.abs(daysBetween(it.date, ln.date)) <= days);
  pass((it, ln) => !!(ln.checkNo || checkNo(ln.desc)) && checkNo(it.ref) === (ln.checkNo || checkNo(ln.desc)));   // a check that took a long time to clear
  // One bank line, several rows in the books: a transfer that paid several
  // bills (or netted a vendor credit) is one row per document here but one
  // amount at the bank. Rows sharing a reference and a date that add up to the
  // line are matched together.
  lines.forEach((ln, i) => {
    if (out[i]) return;
    const groups = new Map();
    free.filter(f => !f.used && f.it.ref).forEach(f => {
      const k = f.it.ref + "|" + f.it.date;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    });
    const hit = [...groups.values()].filter(g => g.length > 1
      && Math.abs(round2(sum(g, f => f.it.amount)) - ln.amount) < 0.005
      && Math.abs(daysBetween(g[0].it.date, ln.date)) <= days)
      .sort((a, b) => Math.abs(daysBetween(a[0].it.date, ln.date)) - Math.abs(daysBetween(b[0].it.date, ln.date)))[0];
    if (!hit) return;
    hit.forEach(f => { f.used = true; });
    out[i] = { line: ln, item: hit[0].it, group: hit.map(f => f.it) };
  });
  // Close but not equal: a payment, receipt or expense in the books a few
  // dollars off the bank's figure (typed $6,334 for $6,344) — offered as a
  // correction, never matched on its own. Within $25, or within 2% when the
  // payee's name is on the bank line; ten days either way. Pairs are chosen
  // across the whole statement — a named payee first, then the smallest
  // difference — so the first line read can't take another line's row.
  const named = (it, ln) => { const w = nameWords(it.party); const d = " " + String(ln.desc || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") + " ";
    return w.length > 0 && w.slice(0, 2).every(x => d.includes(" " + x + " ")); };
  const pairs = [];
  lines.forEach((ln, i) => {
    if (out[i]) return;
    free.forEach(f => {
      if (f.used || !["payment", "receipt", "expense"].includes(f.it.type) || Math.sign(f.it.amount) !== Math.sign(ln.amount)) return;
      const diff = Math.abs(f.it.amount - ln.amount), byName = named(f.it, ln);
      if (diff < 0.005 || Math.abs(daysBetween(f.it.date, ln.date)) > days) return;
      if (diff <= 25 || (byName && diff <= Math.abs(ln.amount) * 0.02)) pairs.push({ i, f, diff, byName });
    });
  });
  pairs.sort((a, b) => (b.byName - a.byName) || (a.diff - b.diff));
  for (const pr of pairs) if (!out[pr.i] && !pr.f.used) { pr.f.used = true; out[pr.i] = { line: lines[pr.i], item: null, near: pr.f.it }; }
  lines.forEach((ln, i) => { if (!out[i]) out[i] = { line: ln, item: null, near: null }; });
  return out;
}

// The words that name a recurring bank line, so how it was posted last time can
// be offered again: no reference numbers or dates (they change every month),
// but a masked account ("XXXXX1064") stays — it tells two transfers apart.
export function bankKey(desc) {
  return String(desc || "").toUpperCase().split(/\s+/)
    .map(t => t.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, ""))
    .filter(t => t && (!/\d/.test(t) || /^X{3,}\d{2,}$/.test(t)))
    .slice(0, 6).join(" ");
}

// A payment to a vendor the books don't have: an open bill for exactly this
// amount (narrowed to the vendor the line names, if it names one), else just
// the vendor whose name the statement line carries. Recording it as that
// vendor's bill payment — not a bare expense — keeps their account and their
// 1099 right. → { vendorId, billId } or null.
const nameWords = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
  .filter(w => w.length >= 3 && !/^(inc|llc|ltd|corp|co|the|and|services?)$/.test(w));
export function partyNamedIn(db, desc, type) {
  const d = " " + String(desc || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") + " ";
  return db.contacts.filter(c => c.type === type).find(v => { const w = nameWords(v.name); return w.length && w.slice(0, 2).every(x => d.includes(" " + x + " ")); }) || null;
}
export const vendorNamedIn = (db, desc) => partyNamedIn(db, desc, "vendor");
export function suggestVendorPayment(db, line) {
  if (!line || line.amount >= 0) return null;
  const amt = Math.abs(line.amount);
  const named = vendorNamedIn(db, line.desc);
  const open = db.bills.filter(b => Math.abs(billBalance(b) - amt) < 0.005 && (!named || b.vendorId === named.id));
  if (open.length === 1) return { vendorId: open[0].vendorId, billId: open[0].id };
  if (named) return { vendorId: named.id, billId: "" };
  return null;
}

// The customer side: a deposit the books don't have. An open invoice for
// exactly this amount (narrowed to the customer the line names), else the
// customer the line names — spread over their open invoices oldest first when
// they owe at least this much, else a new invoice written for it. Recording it
// as that customer's receipt — not bare income — keeps their account right.
// → { customerId, invoiceId } where invoiceId is a document id, "oldest" or ""
// (a new invoice), or null.
export const openInvoices = (db, customerId) => db.invoices
  .filter(i => i.customerId === customerId && balance(i) > 0.005)
  .sort((a, b) => (a.dueDate || a.date || "").localeCompare(b.dueDate || b.date || ""));
export function suggestCustomerReceipt(db, line) {
  if (!line || line.amount <= 0) return null;
  const amt = line.amount;
  const named = partyNamedIn(db, line.desc, "customer");
  const exact = db.invoices.filter(i => Math.abs(balance(i) - amt) < 0.005 && (!named || i.customerId === named.id));
  if (exact.length === 1) return { customerId: exact[0].customerId, invoiceId: exact[0].id };
  if (!named) return null;
  const owed = round2(sum(openInvoices(db, named.id), balance));
  return { customerId: named.id, invoiceId: owed >= amt - 0.005 ? "oldest" : "" };
}
