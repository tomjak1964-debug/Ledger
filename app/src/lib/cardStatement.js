// Reading a credit card statement into charges, credits and payments.
//
// The same approach as the bank statement reader (lib/bankStatement.js) with
// the card's point of view: a charge is what the card is owed (positive), a
// credit or a payment takes it down (negative). A .csv download is read by its
// headings — one signed Amount column (Amex: charges positive), or Debit /
// Credit (Citi) — and a PDF or pasted text line by line: a line that starts
// with a date (or two: sale and post date) and ends in an amount is a
// transaction, a minus sign or a "Payments / Credits" section makes it a
// credit. Everything comes back for review; nothing is posted from here.
import { pdfLines, textLines } from "./lineup.js";
import { parseDate, findPeriod, looksLikeCsv, csvRows } from "./bankStatement.js";
import { uid } from "./helpers.js";

export async function readCardFile(file) {
  if (/\.pdf$/i.test(file.name)) return { kind: "text", lines: await pdfLines(await file.arrayBuffer()) };
  const text = await file.text();
  if (/\.csv$/i.test(file.name) || looksLikeCsv(text)) return { kind: "csv", text };
  return { kind: "text", lines: textLines(text) };
}
export const readCardPaste = text => (looksLikeCsv(text) ? { kind: "csv", text } : { kind: "text", lines: textLines(text) });

// "$1,234.56" "-$12.00" "12.00-" "(12.00)" → number
const money = s => {
  const t = String(s ?? "").trim();
  const m = t.replace(/[$,\s]/g, "").match(/^\(?(-)?(\d+\.\d{2})(-)?\)?$/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] || m[3] || /^\(/.test(t) ? -v : v;
};
const PAYMENT = /\b(payment|autopay|auto-pay|thank you|pymt|online pmt|ach pmt)\b/i;
export const kindOf = (desc, amount) => (amount < 0 ? (PAYMENT.test(desc) ? "payment" : "credit") : "charge");

// A transaction month later than the closing month belongs to the year before
// (a Jan 20 statement listing Dec 28 charges).
function fixYear(date, closing) {
  if (!date || !closing) return date;
  return date > closing ? String(Number(date.slice(0, 4)) - 1) + date.slice(4) : date;
}

const CLOSING = /(?:statement\s+)?closing\s+date[:\s]*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const NEW_BAL = /new\s+balance[^\d$-]*(-?\$?[\d,]+\.\d{2})/i;
const PREV_BAL = /previous\s+balance[^\d$-]*(-?\$?[\d,]+\.\d{2})/i;
const SECTION_CREDIT = /\b(payments?|credits?)\b/i;
const SECTION_CHARGE = /\b(purchases?|new\s+charges|charges|fees?|interest\s+charged|transactions)\b/i;
const NOISE = /\b(total|subtotal|balance|minimum payment|credit limit|available credit|page \d|account ending|payment due)\b/i;
const DATE = String.raw`(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\*?|[A-Za-z]{3}\.?\s+\d{1,2})`;
const ROW = new RegExp(String.raw`^${DATE}(?:\s+${DATE})?\s+(.*?)\s+(\(?-?\$?[\d,]+\.\d{2}-?\)?)$`);

// Text rows (PDF or pasted) → statement.
export function parseCardText(lines, { year } = {}) {
  let closingDate = "", newBalance = null, previousBalance = null;
  const fy = year || new Date().getFullYear();
  for (const raw of lines) {
    const ln = raw.replace(/\s+/g, " ").trim();
    const c = ln.match(CLOSING); if (c && !closingDate) closingDate = parseDate(c[1].replace(/\./, ""), fy);
    const nb = ln.match(NEW_BAL); if (nb && newBalance == null) newBalance = money(nb[1]);
    const pb = ln.match(PREV_BAL); if (pb && previousBalance == null) previousBalance = money(pb[1]);
  }
  const period = findPeriod(lines);
  if (!closingDate && period) closingDate = period.to;
  const y = closingDate ? Number(closingDate.slice(0, 4)) : fy;
  const out = [];
  let creditSection = false;
  for (const raw of lines) {
    const ln = raw.replace(/\s+/g, " ").trim();
    if (!ln) continue;
    const m = ln.match(ROW);
    if (!m) {
      // A heading: "Payments and Other Credits" turns what follows into credits,
      // "Purchases" / "New Charges" / "Fees" back into charges.
      if (!/\d\.\d{2}\b/.test(ln)) {
        if (SECTION_CREDIT.test(ln) && !SECTION_CHARGE.test(ln.replace(SECTION_CREDIT, ""))) creditSection = true;
        else if (SECTION_CHARGE.test(ln)) creditSection = false;
      }
      continue;
    }
    const desc = m[3].replace(/\s+/g, " ").trim();
    if (NOISE.test(desc) && !/interest|fee/i.test(desc)) continue;
    let amount = money(m[4]);
    if (amount == null || Math.abs(amount) < 0.005) continue;
    if (creditSection && amount > 0) amount = -amount;
    const date = fixYear(parseDate(m[1].replace(/[.*]/g, ""), y), closingDate);
    if (!date) continue;
    out.push({ id: uid(), date, desc, amount, kind: kindOf(desc, amount) });
  }
  return { closingDate, periodFrom: period?.from || "", previousBalance, newBalance, lines: out };
}

// A .csv download → statement. Charges come out positive whichever way the
// card company signs them.
export function parseCardCsv(text, { year } = {}) {
  const rows = csvRows(text);
  if (!rows.length) return { closingDate: "", periodFrom: "", previousBalance: null, newBalance: null, lines: [] };
  const head = rows[0].map(h => h.toLowerCase().trim());
  const col = (...names) => head.findIndex(h => names.some(n => h === n || h.includes(n)));
  const cDate = col("transaction date", "trans. date", "date"), cDesc = col("description", "merchant", "payee", "name", "details"),
    cAmt = head.findIndex(h => h === "amount" || h.startsWith("amount")), cDebit = col("debit", "charge"), cCredit = col("credit", "payment");
  const y = year || new Date().getFullYear();
  let lines = [];
  for (const r of rows.slice(1)) {
    const date = parseDate(r[cDate] || "", y);
    let amount = null;
    if (cAmt >= 0 && money(r[cAmt]) != null) amount = money(r[cAmt]);
    else {
      const d = cDebit >= 0 ? money(r[cDebit]) : null, c = cCredit >= 0 ? money(r[cCredit]) : null;
      if (d) amount = Math.abs(d); else if (c) amount = -Math.abs(c);
    }
    if (!date || amount == null || Math.abs(amount) < 0.005) continue;
    const desc = (cDesc >= 0 ? r[cDesc] : r.filter((_, i) => i !== cDate && i !== cAmt).join(" ")).replace(/\s+/g, " ").trim();
    lines.push({ id: uid(), date, desc, amount });
  }
  // Some cards export purchases as negatives; if payments are the only
  // positives, the whole file is the other way round.
  if (cAmt >= 0) {
    const nonPay = lines.filter(l => !PAYMENT.test(l.desc));
    if (nonPay.filter(l => l.amount < 0).length > nonPay.filter(l => l.amount > 0).length) lines = lines.map(l => ({ ...l, amount: -l.amount }));
  }
  lines = lines.map(l => ({ ...l, kind: kindOf(l.desc, l.amount) })).sort((a, b) => a.date.localeCompare(b.date));
  const last = lines.length ? lines[lines.length - 1].date : "";
  return { closingDate: last, periodFrom: lines[0]?.date || "", previousBalance: null, newBalance: null, lines };
}

export const parseCardStatement = (src, opts) => (src.kind === "csv" ? parseCardCsv(src.text, opts) : parseCardText(src.lines, opts));

// "COSTCO WHSE #1234 TROY MI" and "COSTCO WHSE #0567" are the same merchant:
// the words before the first number or store marker, up to three of them.
export function merchantKey(desc) {
  const words = String(desc || "").toUpperCase().replace(/[*#].*$/, " ").replace(/\d.*$/, " ").replace(/[^A-Z&' ]/g, " ").split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(" ");
}

// How each merchant was treated on earlier statements, newest first wins:
// { [merchantKey]: { use, account } }.
export function learnedChoices(statements) {
  const out = {};
  [...(statements || [])].sort((a, b) => String(a.closingDate).localeCompare(String(b.closingDate))).forEach(st =>
    (st.lines || []).forEach(l => {
      if (l.kind === "payment" || !l.use || l.use === "skip") return;
      const k = merchantKey(l.desc);
      if (k) out[k] = { use: l.use, account: l.use === "business" ? l.account || "" : "" };
    }));
  return out;
}

// A statement's lines with a first guess at each: payments skipped (they're
// the bank side), everything else as that merchant went last time, else
// undecided so it has to be picked.
export function suggest(lines, learned) {
  return lines.map(l => {
    if (l.kind === "payment") return { ...l, use: "skip", account: "" };
    const was = learned[merchantKey(l.desc)];
    return { ...l, use: was?.use || "", account: was?.account || "" };
  });
}

export function statementTotals(lines) {
  const sum = (f) => Math.round(lines.filter(f).reduce((t, l) => t + Number(l.amount), 0) * 100) / 100;
  return {
    business: sum(l => l.use === "business"),
    personal: sum(l => l.use === "personal"),
    payments: sum(l => l.kind === "payment"),
    undecided: lines.filter(l => l.kind !== "payment" && !l.use).length,
    noAccount: lines.filter(l => l.use === "business" && !l.account).length,
  };
}
