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
import { round2 } from "./ledger.js";
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
  const cleared = new Map((db.bankCleared || []).filter(c => String(c.account) === account).map(c => [c.itemKey, c]));
  const register = cashRegister(db, account);
  const items = register
    .filter(it => it.date && it.date <= recon.statementDate)
    .map(it => { const c = cleared.get(it.key); return { ...it, cleared: !!c, thisRecon: !!c && c.reconciliationId === recon.id, otherRecon: !!c && c.reconciliationId !== recon.id }; })
    .filter(it => !it.otherRecon);   // cleared on an earlier statement: no longer the bank's business here
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
  lines.forEach((ln, i) => { if (!out[i]) out[i] = { line: ln, item: null }; });
  return out;
}
