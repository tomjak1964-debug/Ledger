// Reading a bank statement into dated, signed lines.
//
// Banks print statements a dozen ways, so this is keyword-driven rather than
// bank-specific: a PDF is read as rows of text (pdf.js, loaded on demand — the
// same reader the lineup import uses), a .csv by its column headings, and
// pasted text line by line. A line is a transaction when it starts with a
// date (or a check number and a date) and ends in an amount; the section it
// sits in — "Deposits and additions", "Checks paid", "Withdrawals" — decides
// the sign, and a running-balance column overrides that when it is there.
// Everything comes back for review before it touches the books.
import { pdfLines, textLines } from "./lineup.js";
export { textLines };
import { uid } from "./helpers.js";

export async function readStatementFile(file) {
  if (/\.pdf$/i.test(file.name)) return { kind: "text", lines: await pdfLines(await file.arrayBuffer()) };
  const text = await file.text();
  if (/\.csv$/i.test(file.name) || looksLikeCsv(text)) return { kind: "csv", text };
  return { kind: "text", lines: textLines(text) };
}

// A .csv export has a heading row naming a date column and the same number of
// separators on most lines; a pasted statement with a comma in "January 1,
// 2026" does not.
export function looksLikeCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(l => l.trim()).slice(0, 12);
  if (lines.length < 2) return false;
  const sep = /\t/.test(lines[0]) ? "\t" : ",";
  const count = l => l.split(sep).length - 1;
  const n = count(lines[0]);
  if (n < 2 || !/date/i.test(lines[0])) return false;
  return lines.filter(l => count(l) >= n - 1).length >= Math.ceil(lines.length * 0.6);
}
// Pasted text, whichever it is.
export const parsePasted = (text, opts) => parseStatement(looksLikeCsv(text) ? { kind: "csv", text } : { kind: "text", lines: textLines(text) }, opts);

const money = s => { const m = String(s || "").replace(/[$,\s]/g, "").match(/^\(?(-?\d+\.\d{2})\)?$/); if (!m) return null; const v = Number(m[1]); return /^\(/.test(String(s).trim()) ? -v : v; };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// "01/15", "1/15/2026", "01-15-26", "Jan 15, 2026", "15 Jan 2026" → ISO, using
// `year` when the date has none.
export function parseDate(s, year) {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year; return iso(y, Number(m[1]), Number(m[2])); }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = t.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})?$/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(m[3] ? Number(m[3]) : year, MONTHS[m[1].toLowerCase()], Number(m[2]));
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s*(\d{4})?$/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(m[3] ? Number(m[3]) : year, MONTHS[m[2].toLowerCase()], Number(m[1]));
  return "";
}

// The statement period, from "January 1, 2026 through January 31, 2026",
// "01/01/2026 - 01/31/2026", "Statement Period: 1/1/26 to 1/31/26"…
export function findPeriod(lines) {
  const dateRe = /([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/g;
  for (const ln of lines) {
    if (!/through|thru|to|-|–/i.test(ln)) continue;
    const ds = [...ln.matchAll(dateRe)].map(m => parseDate(m[1].replace(/\./, ""), new Date().getFullYear())).filter(Boolean);
    if (ds.length >= 2 && ds[1] >= ds[0]) return { from: ds[0], to: ds[1] };
  }
  return null;
}

const SIGN_OUT = /\b(checks?|withdrawals?|debits?|payments?|fees?|charges?|subtractions?|purchases?|electronic\s+withdrawals?|atm)\b/i;
const SIGN_IN = /\b(deposits?|credits?|additions?|interest\s+(paid|earned)|incoming)\b/i;
const NOISE = /\b(balance|total|subtotal|page \d|statement|account number|beginning|ending)\b/i;

// Text rows (PDF or pasted) → { period, endingBalance, lines }.
export function parseStatementText(lines, { year } = {}) {
  const period = findPeriod(lines);
  const y = year || (period ? Number(period.to.slice(0, 4)) : new Date().getFullYear());
  const out = [];
  let sign = -1, prevBal = null, endingBalance = null;
  const push = (date, desc, amount, checkNo) => {
    if (!date || amount == null || Math.abs(amount) < 0.005) return;
    out.push({ id: uid(), date, desc: desc.replace(/\s+/g, " ").trim(), amount, checkNo: checkNo || "" });
  };
  for (const raw of lines) {
    const ln = raw.replace(/\s+/g, " ").trim();
    if (!ln) continue;
    // Section headings set the sign for what follows.
    if (!/\d\.\d{2}\b/.test(ln) || NOISE.test(ln)) {
      if (SIGN_IN.test(ln) && !SIGN_OUT.test(ln)) sign = 1;
      else if (SIGN_OUT.test(ln) && !SIGN_IN.test(ln)) sign = -1;
      const eb = ln.match(/(ending|closing|new)\s+balance[^\d-]*(-?\$?[\d,]+\.\d{2})/i);
      if (eb) endingBalance = money(eb[2]);
      const bb = ln.match(/(beginning|opening|previous)\s+balance[^\d-]*(-?\$?[\d,]+\.\d{2})/i);
      if (bb) prevBal = money(bb[2]);
      continue;
    }
    // A checks table: several "1234 ^ 01/05 $500.00" on one line (Chase, others).
    const checks = [...ln.matchAll(/(?:^|\s)(\d{3,7})\s*[\^*]?\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+\$?(-?[\d,]+\.\d{2})(?=\s|$)/g)];
    if (checks.length && sign < 0) { checks.forEach(m => push(parseDate(m[2], y), "Check " + m[1], -Math.abs(money(m[3])), m[1])); continue; }
    // date  description  amount [balance]
    const m = ln.match(/^(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|[A-Za-z]{3}\.?\s+\d{1,2},?(?:\s+\d{4})?)\s+(.*?)\s+(\(?-?\$?[\d,]+\.\d{2}\)?)(?:\s+(\(?-?\$?[\d,]+\.\d{2}\)?))?$/);
    if (!m) continue;
    const date = parseDate(m[1].replace(/\./, ""), y);
    let desc = m[2], amount = money(m[3]), balance = m[4] != null ? money(m[4]) : null;
    if (amount == null) continue;
    let signed;
    if (balance != null && prevBal != null) signed = Math.abs(amount) * (balance - prevBal >= 0 ? 1 : -1);   // the balance column knows
    else if (/^-|\(/.test(m[3].trim()) || /\bDR\b/.test(desc)) signed = -Math.abs(amount);
    else if (/\bCR\b/.test(desc)) signed = Math.abs(amount);
    else signed = Math.abs(amount) * sign;
    if (balance != null) prevBal = balance;
    const ck = desc.match(/^(?:check|chk)\s*#?\s*(\d{3,7})\b/i);
    push(date, desc.replace(/\b(DR|CR)\b$/, ""), signed, ck ? ck[1] : "");
  }
  return { period, endingBalance, lines: out };
}

// A .csv export: columns found by heading. Amount may be one signed column,
// or Debit/Credit (Withdrawal/Deposit) pairs.
export function parseStatementCsv(text, { year } = {}) {
  const rows = csvRows(text);
  if (!rows.length) return { period: null, endingBalance: null, lines: [] };
  const head = rows[0].map(h => h.toLowerCase().trim());
  const col = (...names) => head.findIndex(h => names.some(n => h === n || h.includes(n)));
  const cDate = col("date", "posted"), cDesc = col("description", "memo", "payee", "details", "name"),
    cAmt = col("amount"), cDebit = col("debit", "withdrawal", "money out"), cCredit = col("credit", "deposit", "money in"),
    cBal = col("balance"), cCheck = col("check", "cheque", "number");
  const y = year || new Date().getFullYear();
  const lines = [];
  for (const r of rows.slice(1)) {
    if (!r.length || r.every(c => !c.trim())) continue;
    const date = parseDate(r[cDate] || "", y);
    let amount = null;
    if (cAmt >= 0 && money(r[cAmt]) != null) amount = money(r[cAmt]);
    else {
      const d = cDebit >= 0 ? money(r[cDebit]) : null, c = cCredit >= 0 ? money(r[cCredit]) : null;
      if (d) amount = -Math.abs(d); else if (c) amount = Math.abs(c);
    }
    if (!date || amount == null || Math.abs(amount) < 0.005) continue;
    const desc = cDesc >= 0 ? r[cDesc] : r.filter((_, i) => i !== cDate && i !== cAmt && i !== cBal).join(" ");
    const ck = (cCheck >= 0 && /^\d{3,7}$/.test((r[cCheck] || "").trim())) ? r[cCheck].trim() : (desc.match(/^(?:check|chk)\s*#?\s*(\d{3,7})\b/i)?.[1] || "");
    lines.push({ id: uid(), date, desc: desc.trim(), amount, checkNo: ck });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const last = lines.length && cBal >= 0 ? money(rows[rows.length - 1][cBal]) : null;
  return { period: lines.length ? { from: lines[0].date, to: lines[lines.length - 1].date } : null, endingBalance: last, lines };
}

export function csvRows(text) {
  const rows = [], sep = /\t/.test(text.split("\n")[0]) ? "\t" : ",";
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

export function parseStatement(src, opts) {
  return src.kind === "csv" ? parseStatementCsv(src.text, opts) : parseStatementText(src.lines, opts);
}
