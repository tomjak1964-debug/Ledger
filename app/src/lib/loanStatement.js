// Reading a line of credit statement, and the journal entries it makes.
//
// A line of credit statement (PNC's Business Line of Credit, and the same
// shape from most banks) carries a summary — previous balance, payments,
// advances, fees, interest, new balance — and the transactions: a line that
// starts with a transaction date and a post date and ends in an amount.
// Signed as the bank prints them: a payment or credit is negative (it takes
// the balance down), an advance, a fee or the month's interest positive.
//
// Interest and fees are charged TO the line — the bank adds them to what is
// owed — and the monthly payment comes out of checking against that balance.
// So the books read:
//   interest charged  Dr interest expense   Cr the line      (on the closing date)
//   fees              Dr service charges    Cr the line
//   payment           Dr the line           Cr checking      (its own entry, its own date)
//   advance (draw)    Dr checking           Cr the line
// A payment and a draw each get an entry of their own on their own date, so
// the bank reconciliation pairs each with its bank line; one already on the
// books (posted from Bank Reconciliation, or by hand) is linked instead.
import { pdfLines, textLines } from "./lineup.js";
import { parseDate } from "./bankStatement.js";
import { uid } from "./helpers.js";

export async function readLoanFile(file) {
  if (/\.pdf$/i.test(file.name)) return pdfLines(await file.arrayBuffer());
  return textLines(await file.text());
}
export const readLoanPaste = text => textLines(text);

const amt = s => {
  const t = String(s ?? "").trim();
  const m = t.replace(/[$,\s]/g, "").match(/^\(?(-)?(\d+\.\d{2})(-)?\)?$/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] || m[3] || /^\(/.test(t) ? -v : v;
};
const MONEY = String.raw`(-?\$?[\d,]+\.\d{2}-?)`;
const D = String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4})`;
const ROW = new RegExp(String.raw`^${D}\s+${D}\s+(.+?)\s+${MONEY}$`);
const find = (text, re) => { const m = text.match(re); return m ? m[1] : null; };

export const LOAN_KINDS = { advance: "Advance", payment: "Payment", credit: "Credit", fee: "Fee", interest: "Interest" };
export function loanKind(desc, amount) {
  if (amount < 0) return /\b(payment|pmt|paymt|payoff|thank you)\b/i.test(desc) ? "payment" : "credit";
  if (/\binterest\b/i.test(desc)) return "interest";
  if (/\b(fee|late charge|charge)\b/i.test(desc)) return "fee";
  return "advance";
}

export function parseLoanText(lines) {
  const text = lines.join("\n");
  const period = text.match(new RegExp(String.raw`for the period\s+${D}\s+to\s+${D}`, "i"));
  const closing = find(text, new RegExp(String.raw`statement closing date\s+${D}`, "i")) || (period && period[2]);
  const closingDate = closing ? parseDate(closing) : "";
  const year = Number((closingDate || "").slice(0, 4)) || new Date().getFullYear();
  const out = [];
  for (const ln of lines) {
    const m = ln.match(ROW);
    if (!m || /\btotal\b/i.test(m[3])) continue;
    const amount = amt(m[4]);
    if (amount == null) continue;
    const desc = m[3].replace(/\s+/g, " ").trim();
    out.push({ id: uid(), date: parseDate(m[1], year), postDate: parseDate(m[2], year), desc, amount, kind: loanKind(desc, amount) });
  }
  const tail = find(text, /account\s+(?:number:?\s*)?[x*\d]*?(\d{4})\b/i);
  return {
    periodFrom: period ? parseDate(period[1]) : "",
    closingDate,
    previousBalance: amt(find(text, new RegExp(String.raw`previous balance\s+${MONEY}`, "i"))),
    newBalance: amt(find(text, new RegExp(String.raw`new balance\s+${MONEY}`, "i"))),
    accountTail: tail || "",
    lines: out,
  };
}

// The statement's own check: previous balance + every line = new balance.
export function loanCheck(st) {
  if (st.previousBalance == null || st.newBalance == null) return null;
  return Math.round((Number(st.previousBalance) + st.lines.reduce((t, l) => t + Number(l.amount), 0) - Number(st.newBalance)) * 100) / 100;
}
export function loanTotals(lines) {
  const t = { advance: 0, payment: 0, credit: 0, fee: 0, interest: 0 };
  lines.forEach(l => { t[l.kind] = Math.round((t[l.kind] + Number(l.amount)) * 100) / 100; });
  return t;
}

// The loan as set up (settings.accounts.loans): the liability account, the
// bank account payments come from, where interest and fees post, and the
// words that name it on a bank statement.
export const loanDefaults = { cashAccount: "1020", interestAccount: "7150", feeAccount: "6850" };
export const loanOf = (loan) => ({ ...loanDefaults, ...loan, account: String(loan.account), cashAccount: String(loan.cashAccount || loanDefaults.cashAccount),
  interestAccount: String(loan.interestAccount || loanDefaults.interestAccount), feeAccount: String(loan.feeAccount || loanDefaults.feeAccount) });

const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
// A payment or draw already on the books: an entry moving exactly this amount
// between the line and the bank account, dated within five days of the
// transaction or its posting, and not already claimed by a posted statement.
export function findExistingEntry(db, loan, line, taken = new Set()) {
  const L = loanOf(loan), a = Math.abs(Number(line.amount));
  const near = (d) => days(d, line.date) <= 5 || (line.postDate && days(d, line.postDate) <= 5);
  const paysDown = line.amount < 0;
  return (db.journalEntries || []).filter(j => !taken.has(j.id) && near(j.date) && (j.lines || []).some(l =>
    String(l.account) === L.account && Math.abs((Number(paysDown ? l.debit : l.credit) || 0) - a) < 0.005) && (j.lines || []).some(l =>
    String(l.account) === L.cashAccount && Math.abs((Number(paysDown ? l.credit : l.debit) || 0) - a) < 0.005))
    .sort((x, y) => days(x.date, line.date) - days(y.date, line.date))[0] || null;
}

// Journal entries already linked to a posted statement's lines.
export const linkedEntryIds = (db) => new Set((db.loanStatements || []).flatMap(s => (s.lines || []).map(l => l.entryId).filter(Boolean)));

// What posting a statement writes: one entry per payment / draw (or the entry
// it links to), and one entry for the interest, fees and credits.
export function planLoanStatement(db, loan, st) {
  const L = loanOf(loan);
  const taken = linkedEntryIds(db);
  const cash = st.lines.filter(l => l.kind === "payment" || l.kind === "advance").map(l => {
    const existing = findExistingEntry(db, L, l, taken);
    if (existing) taken.add(existing.id);
    const a = Math.abs(Number(l.amount));
    const entry = existing ? null : {
      date: l.date, ref: `${L.name} ${l.kind}`, memo: `${L.name} — ${l.kind === "payment" ? "payment" : "advance"}: ${l.desc}`,
      lines: l.kind === "payment"
        ? [{ account: L.account, desc: `${L.name} payment`, debit: a, credit: "" }, { account: L.cashAccount, desc: l.desc, debit: "", credit: a }]
        : [{ account: L.cashAccount, desc: l.desc, debit: a, credit: "" }, { account: L.account, desc: `${L.name} advance`, debit: "", credit: a }],
    };
    return { line: l, existing, entry };
  });
  const charges = st.lines.filter(l => l.kind === "interest" || l.kind === "fee" || l.kind === "credit");
  let chargesEntry = null;
  if (charges.length) {
    const lines = charges.map(l => {
      const a = Math.abs(Number(l.amount));
      const account = l.kind === "interest" ? L.interestAccount : L.feeAccount;
      return Number(l.amount) > 0 ? { account, desc: l.desc, debit: a, credit: "" } : { account, desc: l.desc, debit: "", credit: a };
    });
    const net = Math.round(charges.reduce((t, l) => t + Number(l.amount), 0) * 100) / 100;
    if (Math.abs(net) > 0.005) lines.push(net > 0 ? { account: L.account, desc: L.name, debit: "", credit: net } : { account: L.account, desc: L.name, debit: -net, credit: "" });
    chargesEntry = { date: st.closingDate, ref: `${L.name} statement ${st.closingDate}`, memo: `${L.name} — interest and fees charged to the line`, lines };
  }
  return { cash, chargesEntry };
}
