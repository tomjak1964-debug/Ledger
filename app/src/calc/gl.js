// The general ledger, derived from the documents.
//
// Nothing is journalled by hand: every invoice, credit note, bill, expense and
// payment already on file IS the journal, posted by the rules below whenever a
// report asks. That keeps the ledger in step with the books by construction —
// correct a payment and the ledger corrects itself — at the cost of there
// being no manual journal entry (yet).
//
// Postings (Dr / Cr):
//   invoice          Dr A/R total                Cr income subtotal, Cr sales tax payable tax
//   credit note      Dr income |subtotal|, Dr tax |tax|      Cr A/R |total|
//   receipt          Dr cash amount, Dr sales discounts discount     Cr A/R amount + discount
//   bill             Dr expense amount           Cr A/P amount
//   bill payment     Dr A/P amount + discount    Cr cash amount, Cr purchase discounts discount
//   expense entry    Dr expense amount           Cr cash amount
// A credit applied to an invoice moves nothing between accounts (A/R to A/R),
// so those payment pairs are skipped.
import { sum } from "../lib/helpers.js";
import { lineTotals, round2 as r2 } from "./ledger.js";
import { CREDIT_METHOD } from "../lib/credits.js";
import {
  accountSettings, normalSide, TYPE_GROUP, accountByNumber, accountsOfType,
  incomeAccountOf, expenseAccountOfBill, expenseAccountOfExpense, cashAccountOf,
} from "./accounts.js";

const round2 = v => r2(Number(v) || 0);
const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
const partyName = (db, id) => db.contacts.find(c => c.id === id)?.name || "";

// Every posting, oldest first. Each entry is one document event with balanced
// lines; `lines` carry the account number, a debit or a credit, never both.
export function journal(db) {
  const acct = accountSettings(db.settings);
  const out = [];
  const post = (date, source, memo, party, lines) => {
    const clean = lines.filter(l => Math.abs(l.debit || 0) > 0.005 || Math.abs(l.credit || 0) > 0.005)
      .map(l => ({ account: l.account, debit: round2(l.debit), credit: round2(l.credit) }));
    if (clean.length) out.push({ date, source, memo, party, lines: clean });
  };

  db.invoices.forEach(inv => {
    const t = lineTotals(inv.lineItems, inv.taxRate);
    const income = incomeAccountOf(db, inv);
    const who = partyName(db, inv.customerId);
    const isCredit = inv.kind === "credit" || t.total < 0;
    if (isCredit) {
      post(inv.date, { type: "credit", id: inv.id, number: inv.number }, `Credit note ${inv.number}`, who, [
        { account: income, debit: Math.abs(t.sub) },
        { account: acct.salesTax, debit: Math.abs(t.tax) },
        { account: acct.ar, credit: Math.abs(t.total) },
      ]);
    } else {
      post(inv.date, { type: "invoice", id: inv.id, number: inv.number }, `Invoice ${inv.number}`, who, [
        { account: acct.ar, debit: t.total },
        { account: income, credit: t.sub },
        { account: acct.salesTax, credit: t.tax },
      ]);
    }
    (inv.payments || []).forEach(p => {
      if (p.method === CREDIT_METHOD) return;              // a credit applied: A/R to A/R, nothing moves
      const amount = Number(p.amount) || 0, disc = Number(p.discount) || 0;
      post(p.date, { type: "receipt", id: p.id, number: inv.number, ref: p.ref }, `Receipt on ${inv.number}${p.ref ? " #" + p.ref : ""}`, who, [
        { account: cashAccountOf(db, p), debit: amount },
        { account: acct.salesDiscount, debit: disc },
        { account: acct.ar, credit: amount + disc },
      ]);
    });
  });

  db.bills.forEach(b => {
    const expense = expenseAccountOfBill(db, b);
    const who = partyName(db, b.vendorId);
    post(b.date, { type: "bill", id: b.id, number: b.number, ref: b.ref }, `Bill ${b.number}${b.ref ? " (" + b.ref + ")" : ""}`, who, [
      { account: expense, debit: Number(b.amount) || 0 },
      { account: acct.ap, credit: Number(b.amount) || 0 },
    ]);
    (b.payments || []).forEach(p => {
      const amount = Number(p.amount) || 0, disc = Number(p.discount) || 0;
      post(p.date, { type: "payment", id: p.id, number: b.number, ref: p.ref }, `Payment on ${b.number}${p.ref ? " #" + p.ref : ""}`, who, [
        { account: acct.ap, debit: amount + disc },
        { account: cashAccountOf(db, p), credit: amount },
        { account: acct.purchaseDiscount, credit: disc },
      ]);
    });
  });

  db.expenses.forEach(e => {
    post(e.date, { type: "expense", id: e.id, number: "", ref: "" }, `Expense — ${e.category || "Uncategorized"}${e.notes ? ": " + e.notes : ""}`, e.vendor || "", [
      { account: expenseAccountOfExpense(db, e), debit: Number(e.amount) || 0 },
      { account: cashAccountOf(db, e), credit: Number(e.amount) || 0 },
    ]);
  });

  out.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.memo.localeCompare(b.memo));
  return out;
}

// The chart the ledger reports against: the accounts on file, plus any number a
// document points at that the chart doesn't know (so nothing posted is hidden).
export function ledgerAccounts(db, entries) {
  const known = new Map((db.accounts || []).map(a => [String(a.number), a]));
  (entries || journal(db)).forEach(e => e.lines.forEach(l => {
    if (!known.has(String(l.account))) known.set(String(l.account), { number: String(l.account), name: "(not in chart)", type: guessType(l.account), active: true, sort: 9999 });
  }));
  return [...known.values()].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
}
// A number with no chart row is typed by its first digit, the way the Sage
// chart is laid out (1 assets, 2 liabilities, 3 equity, 4 income, 5 cost, 6-7 expenses).
function guessType(number) {
  const d = String(number)[0];
  return d === "1" ? "Other Current Assets" : d === "2" ? "Other Current Liabilities" : d === "3" ? "Equity-doesn't close"
    : d === "4" ? "Income" : d === "5" ? "Cost of Sales" : "Expenses";
}

// Signed balance in the account's own terms: a debit-normal account grows with
// debits, a credit-normal one with credits.
const signed = (type, debit, credit) => normalSide(type) === "debit" ? debit - credit : credit - debit;

// One account's activity in a range with a running balance, opening balance
// from everything before `from`. `account` blank means every account with
// activity, one block each.
export function generalLedger(db, { from, to, account } = {}) {
  const entries = journal(db);
  const accounts = ledgerAccounts(db, entries).filter(a => !account || String(a.number) === String(account));
  const blocks = accounts.map(a => {
    const num = String(a.number);
    let opening = 0;
    const rows = [];
    entries.forEach(e => e.lines.forEach(l => {
      if (String(l.account) !== num) return;
      if (from && e.date < from) { opening += signed(a.type, l.debit, l.credit); return; }
      if (!inRange(e.date, from, to)) return;
      rows.push({ date: e.date, memo: e.memo, party: e.party, source: e.source, debit: l.debit, credit: l.credit });
    }));
    let bal = round2(opening);
    rows.forEach(r => { bal = round2(bal + signed(a.type, r.debit, r.credit)); r.balance = bal; });
    return { account: a, opening: round2(opening), rows, debits: round2(sum(rows, r => r.debit)), credits: round2(sum(rows, r => r.credit)), closing: bal };
  }).filter(b => b.rows.length || Math.abs(b.opening) > 0.005);
  return { blocks, entries: entries.length };
}

// Debits and credits per account through `asOf`; the two columns must agree.
export function trialBalance(db, asOf) {
  const entries = journal(db).filter(e => inRange(e.date, null, asOf));
  const m = new Map();
  entries.forEach(e => e.lines.forEach(l => {
    const at = m.get(String(l.account)) || { debit: 0, credit: 0 };
    at.debit += l.debit; at.credit += l.credit; m.set(String(l.account), at);
  }));
  const rows = ledgerAccounts(db, entries).map(a => {
    const t = m.get(String(a.number)) || { debit: 0, credit: 0 };
    const net = round2(t.debit - t.credit);
    return { account: a, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  }).filter(r => r.debit > 0.005 || r.credit > 0.005);
  return { rows, debits: round2(sum(rows, r => r.debit)), credits: round2(sum(rows, r => r.credit)) };
}

// The standard income statement (Sage layout): every Income, Cost of Sales and
// Expenses account in the chart — zeros included, so the shape never changes —
// for the selected range and for the year to date at its end, each with its
// share of total revenues. Accrual basis: invoices count when issued and bills
// when entered, which is what the chart's A/R and A/P are for.
export function incomeStatement(db, from, to) {
  const entries = journal(db);
  const end = to || entries[entries.length - 1]?.date || "";
  const ytdFrom = end ? end.slice(0, 4) + "-01-01" : "";
  const sumFor = (num, type, f, t) => {
    let d = 0, c = 0;
    entries.forEach(e => { if (inRange(e.date, f, t)) e.lines.forEach(l => { if (String(l.account) === String(num)) { d += l.debit; c += l.credit; } }); });
    return round2(signed(type, d, c));
  };
  const chart = ledgerAccounts(db, entries).filter(a => ["income", "cos", "expense"].includes(TYPE_GROUP[a.type]) && a.active !== false);
  const section = group => chart.filter(a => TYPE_GROUP[a.type] === group)
    .map(a => ({ account: a, period: sumFor(a.number, a.type, from, to), ytd: sumFor(a.number, a.type, ytdFrom, end) }));
  const revenues = section("income"), cos = section("cos"), expenses = section("expense");
  const tot = rows => ({ period: round2(sum(rows, r => r.period)), ytd: round2(sum(rows, r => r.ytd)) });
  const totRev = tot(revenues), totCos = tot(cos), totExp = tot(expenses);
  const gross = { period: round2(totRev.period - totCos.period), ytd: round2(totRev.ytd - totCos.ytd) };
  const net = { period: round2(gross.period - totExp.period), ytd: round2(gross.ytd - totExp.ytd) };
  const pct = (v, base) => (Math.abs(base) > 0.005 ? (v / base) * 100 : 0);
  return { revenues, cos, expenses, totRev, totCos, totExp, gross, net, ytdFrom, end, pct: { period: v => pct(v, totRev.period), ytd: v => pct(v, totRev.ytd) } };
}

// 1099 vendor report for a calendar year: every vendor marked 1099-NEC or
// 1099-MISC, with the cash paid to them that year — bill payments, and expense
// entries whose payee is that vendor's name — one line per payment, the total,
// and whether the $600 reporting threshold was met.
export const TEN99_LIMIT = 600;
export function vendor1099(db, year) {
  const y = String(year);
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const vendors = db.contacts.filter(c => c.type === "vendor" && (c.ten99 === "nec" || c.ten99 === "misc"));
  const rows = vendors.map(v => {
    const lines = [];
    db.bills.filter(b => b.vendorId === v.id).forEach(b => (b.payments || []).forEach(p => {
      if (!p.date || !p.date.startsWith(y) || p.method === CREDIT_METHOD) return;
      const amount = Number(p.amount) || 0;
      if (Math.abs(amount) > 0.005) lines.push({ date: p.date, ref: p.ref || "", bill: b.number, amount });
    }));
    db.expenses.forEach(e => {
      if (!e.date || !e.date.startsWith(y) || norm(e.vendor) !== norm(v.name)) return;
      lines.push({ date: e.date, ref: e.method || "", bill: "expense", amount: Number(e.amount) || 0 });
    });
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
    const total = round2(sum(lines, l => l.amount));
    return { vendor: v, lines, total, limitMet: total >= TEN99_LIMIT };
  }).sort((a, b) => (a.vendor.code || a.vendor.name).localeCompare(b.vendor.code || b.vendor.name, undefined, { sensitivity: "base" }));
  return { year: y, rows, total: round2(sum(rows, r => r.total)) };
}

export { accountByNumber, accountsOfType };
