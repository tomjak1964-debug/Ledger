// Month-end close: what a month needs before it is locked, read straight from
// the books (System → Month-End Close, views/MonthEndClose.jsx).
//
//   bank        a finished bank reconciliation for the cash account whose
//               statement ends in the month (one still open is "in progress")
//   cards       each card's statement closing in the month, posted
//   loans       each line of credit's statement closing in the month, posted
//   payroll     what was booked to the payroll accounts in the month —
//               information only: payroll doesn't run every month
//   locked      the month ends on or before the lock date
// A card or line of credit is only checked from the month of its first posted
// statement; a month whose statement had nothing to post (a payment only, no
// activity) can be marked so (settings.accounts.closeSkips: { "2026-03": ["2160"] }).
//
// A month is ready to lock when its bank, card and loan checks pass.
import { accountSettings, chart } from "./accounts.js";

const pad = n => String(n).padStart(2, "0");
export const monthEnd = ym => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(new Date(y, m, 0).getDate())}`; };
export const monthLabel = ym => new Date(ym + "-15T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
const inMonth = (d, ym) => String(d || "").slice(0, 7) === ym;

// The accounts payroll is booked to: wages, salaries, payroll taxes, 401K —
// by name, so a chart renumbered later still reads right.
export const payrollAccounts = db => new Set(chart(db).filter(a => /wage|salar|payroll|401k/i.test(a.name || "")
  && ["Expenses", "Cost of Sales"].includes(a.type)).map(a => String(a.number)));

export function monthClose(db, ym, { today } = {}) {
  const acct = accountSettings(db.settings);
  const cash = String(acct.cash || "1020");
  const recons = (db.bankReconciliations || []).filter(r => String(r.account) === cash && inMonth(r.statementDate, ym));
  const bankDone = recons.find(r => r.status === "done");
  const bank = { label: "Bank reconciled", ok: !!bankDone,
    state: bankDone ? "done" : recons.length ? "progress" : "missing",
    detail: bankDone ? `Statement ending ${bankDone.statementDate}` : recons.length ? "Started, not finished" : "No reconciliation for this month", go: "recon" };
  const skips = (acct.closeSkips || {})[ym] || [];
  const statementCheck = (name, account, list, go) => {
    const mine = list.filter(s => s.account === String(account));
    const st = mine.find(s => inMonth(s.closingDate, ym));
    const first = mine.map(s => s.closingDate).sort()[0];
    if (st) return { label: name, account: String(account), ok: true, state: "done", detail: `Closing ${st.closingDate} posted`, go };
    if (!first || ym < first.slice(0, 7)) return { label: name, account: String(account), ok: true, state: "na", detail: "Before its first statement", go };
    if (skips.includes(String(account))) return { label: name, account: String(account), ok: true, state: "skipped", detail: "Marked nothing to post", go };
    return { label: name, account: String(account), ok: false, state: "missing", detail: "No statement posted", go, canSkip: true };
  };
  const cardSts = (db.cardStatements || []).map(s => ({ account: s.cardAccount, closingDate: s.closingDate }));
  const loanSts = (db.loanStatements || []).map(s => ({ account: s.loanAccount, closingDate: s.closingDate }));
  const cards = (acct.cards || []).map(c => statementCheck(c.name, c.account, cardSts, "cards"));
  const loans = (acct.loans || []).map(l => statementCheck(l.name, l.account, loanSts, "loans"));
  const pay = payrollAccounts(db);
  let payrollTotal = 0, payrollCount = 0;
  (db.expenses || []).forEach(e => { if (inMonth(e.date, ym) && pay.has(String(e.account))) { payrollTotal += Number(e.amount) || 0; payrollCount++; } });
  (db.journalEntries || []).forEach(j => { if (inMonth(j.date, ym)) (j.lines || []).forEach(l => { if (pay.has(String(l.account))) { payrollTotal += (Number(l.debit) || 0) - (Number(l.credit) || 0); payrollCount++; } }); });
  const payroll = { label: "Payroll booked", ok: true, info: true, state: payrollCount ? "done" : "none",
    amount: Math.round(payrollTotal * 100) / 100, detail: payrollCount ? `${payrollCount} entr${payrollCount === 1 ? "y" : "ies"}` : "None this month", go: "journal" };
  const end = monthEnd(ym);
  const locked = !!acct.lockDate && end <= acct.lockDate;
  // A month still running can't be closed yet: what it lacks is "not yet", not missing.
  const over = !today || end < today;
  if (!over) [bank, ...cards, ...loans].forEach(c => { if (c.state === "missing") Object.assign(c, { state: "pending", detail: "The month isn't over", canSkip: false }); });
  const checks = [bank, ...cards, ...loans];
  return { ym, end, label: monthLabel(ym), short: new Date(ym + "-15T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }), bank, cards, loans, payroll, checks, locked, over,
    ready: over && checks.every(c => c.ok), missing: checks.filter(c => !c.ok) };
}

// Every month from the first one Ledger kept the books for — the first bank
// reconciliation, else the first transaction — to this one, newest first.
export function closeMonths(db, today) {
  const recon = (db.bankReconciliations || []).map(r => r.statementDate).filter(Boolean).sort()[0];
  const dates = [...(db.invoices || []).map(i => i.date), ...(db.bills || []).map(b => b.date), ...(db.expenses || []).map(e => e.date),
    ...(db.journalEntries || []).map(j => j.date)].filter(Boolean).sort();
  const first = (recon || dates.find(d => d >= "2000") || today).slice(0, 7);
  const out = [];
  let [y, m] = first.split("-").map(Number);
  const [ty, tm] = today.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out.reverse().map(ym => monthClose(db, ym, { today }));
}
