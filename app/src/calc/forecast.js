// Cash-flow forecast: the checking balance week by week for the next few weeks,
// from what is on the books today (Dashboard → Cash Forecast).
//
//   start     the cash account's book balance today
//   in        every open invoice's balance on its due date; an overdue one is
//             left out unless asked for (includeOverdue) — counting it as
//             arriving this week makes the outlook look better than it is
//   out       every open bill's balance on its due date (overdue: this week);
//             each card's latest statement balance ~25 days after it closed, if
//             that is still ahead; the line of credit's monthly payment (the
//             last one, repeated on the same day each month); payroll at the
//             average of the last six months, on the day it last ran
//
// The card, line of credit and payroll figures are estimates and say so; the
// invoices and bills are what the books hold.
import { journal } from "./gl.js";
import { accountSettings } from "./accounts.js";
import { balance, billBalance } from "./ledger.js";
import { payrollAccounts } from "./close.js";
import { addDays, nameOf } from "../lib/helpers.js";

const r2 = n => Math.round(n * 100) / 100;
const monday = d => { const t = new Date(d + "T12:00:00"); const k = (t.getDay() + 6) % 7; return addDays(d, -k); };
const nextOnDay = (from, day, until) => {   // that day of the month, each month from `from` to `until`
  const out = [];
  let [y, m] = from.split("-").map(Number);
  for (let i = 0; i < 4; i++) {
    const last = new Date(y, m, 0).getDate();
    const d = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
    if (d >= from && d <= until) out.push(d);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
};

export function cashForecast(db, today, { weeks = 8, includeOverdue = false } = {}) {
  const acct = accountSettings(db.settings);
  const cash = String(acct.cash || "1020");
  const until = addDays(monday(today), weeks * 7 - 1);
  const start = r2(journal(db, { close: false }).filter(e => e.date <= today)
    .reduce((t, e) => t + e.lines.filter(l => String(l.account) === cash).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0), 0));
  const items = [];
  const when = d => (!d || d < today ? today : d);
  (db.invoices || []).forEach(inv => {
    const b = balance(inv);
    if (b > 0.005 && when(inv.dueDate) <= until)
      items.push({ date: when(inv.dueDate), amount: b, kind: "in", label: `${inv.number} · ${nameOf(db, inv.customerId)}`, overdue: (inv.dueDate || "") < today });
  });
  (db.bills || []).forEach(b => {
    const owed = billBalance(b);
    if (owed > 0.005 && when(b.dueDate) <= until)
      items.push({ date: when(b.dueDate), amount: -owed, kind: "out", label: `${b.ref || b.number} · ${nameOf(db, b.vendorId)}`, overdue: (b.dueDate || "") < today });
  });
  // Each card: its latest posted statement, paid about 25 days after it closed.
  (acct.cards || []).forEach(c => {
    const st = (db.cardStatements || []).filter(s => s.cardAccount === String(c.account)).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
    if (!st || !(Number(st.newBalance) > 0)) return;
    const due = addDays(st.closingDate, 25);
    if (due >= today && due <= until) items.push({ date: due, amount: -Number(st.newBalance), kind: "out", label: `${c.name} statement balance`, estimate: true });
  });
  // The line of credit: the last payment, again each month on the same day.
  (acct.loans || []).forEach(l => {
    const pays = (db.loanStatements || []).filter(s => s.loanAccount === String(l.account)).flatMap(s => (s.lines || []).filter(x => x.kind === "payment"));
    const last = pays.sort((a, b) => b.date.localeCompare(a.date)).find(x => !/principal/i.test(x.desc || ""));
    if (!last) return;
    nextOnDay(today, Number(last.date.slice(8, 10)), until).forEach(d =>
      items.push({ date: d, amount: r2(Number(last.amount)), kind: "out", label: `${l.name} payment`, estimate: true }));
  });
  // Payroll: the last six months' average, on the day of the month it last ran.
  const pay = payrollAccounts(db);
  const since = addDays(today, -183);
  const runs = [];
  (db.expenses || []).forEach(e => { if (e.date >= since && e.date <= today && pay.has(String(e.account))) runs.push({ date: e.date, amount: Number(e.amount) || 0 }); });
  (db.journalEntries || []).forEach(j => { if (j.date >= since && j.date <= today) (j.lines || []).forEach(x => { if (pay.has(String(x.account))) runs.push({ date: j.date, amount: (Number(x.debit) || 0) - (Number(x.credit) || 0) }); }); });
  const big = runs.filter(r => r.amount >= 1000).sort((a, b) => b.date.localeCompare(a.date));
  if (big.length) {
    const monthly = r2(runs.reduce((t, r) => t + r.amount, 0) / 6);
    nextOnDay(today, Number(big[0].date.slice(8, 10)), until).forEach(d => items.push({ date: d, amount: -monthly, kind: "out", label: "Payroll (average)", estimate: true }));
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  // Week by week.
  const out = [];
  let bal = start;
  for (let w = 0; w < weeks; w++) {
    const from = addDays(monday(today), w * 7), to = addDays(from, 6);
    const its = items.filter(i => i.date >= from && i.date <= to && (includeOverdue || !(i.kind === "in" && i.overdue)));
    const inn = r2(its.filter(i => i.amount > 0).reduce((t, i) => t + i.amount, 0));
    const outt = r2(its.filter(i => i.amount < 0).reduce((t, i) => t + i.amount, 0));
    bal = r2(bal + inn + outt);
    out.push({ from, to, in: inn, out: outt, balance: bal, items: its });
  }
  const low = out.reduce((m, w) => (w.balance < m.balance ? w : m), out[0] || { balance: start });
  return { start, weeks: out, low, items, overdueIn: r2(items.filter(i => i.kind === "in" && i.overdue).reduce((t, i) => t + i.amount, 0)) };
}
