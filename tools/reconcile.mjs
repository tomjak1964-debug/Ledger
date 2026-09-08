#!/usr/bin/env node
// Reconcile a Ledger backup against a Sage journal export.
//
//   node tools/reconcile.mjs <backup.json> <journal.xlsx|.csv> [--kind bill|invoice]
//
// Sage is the book of record here: the journal says who was paid (or who paid
// us), how much, on what date, and under which check or reference. This walks
// every line of it against the payments in a Ledger backup and reports what
// doesn't line up.
//
// Written because the Sage import matched disbursements to bills by the
// "Invoice:" reference alone, ignoring the party. Those references are
// date-coded, so two vendors paid for the same period shared one — and the
// second vendor's payment landed on the first vendor's bill. Five did. This
// finds that class of error, and anything else that drifts.
//
// No dependencies: it reads .xlsx directly (a zip of XML) using node's zlib.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { basename } from "node:path";

/* ---------------- .xlsx: just enough of the format ---------------- */

// Entries we need, pulled straight out of the zip central directory.
function unzip(buf) {
  const files = new Map();
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  let at = buf.readUInt32LE(end + 16);
  const count = buf.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const compSize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localAt + 26);
    const lExtraLen = buf.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataAt, dataAt + compSize);
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescapeXml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");

// Excel serial day -> ISO date. Day 1 is 1900-01-01, and Excel believes 1900
// was a leap year, which is why the epoch below is 1899-12-30.
const serialToISO = n => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);

// Built-in date formats, plus any custom one whose code contains y/m/d outside
// a literal — enough to tell a date cell from a plain number.
function dateStyles(files) {
  const xml = files.get("xl/styles.xml")?.toString("utf8") || "";
  const dateFmts = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  for (const m of xml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    if (/[ymd]/i.test(unescapeXml(m[2]).replace(/"[^"]*"|\[[^\]]*\]/g, ""))) dateFmts.add(+m[1]);
  }
  const cellXfs = xml.split("<cellXfs")[1]?.split("</cellXfs>")[0] || "";
  return [...cellXfs.matchAll(/<xf[^>]*numFmtId="(\d+)"/g)].map(m => dateFmts.has(+m[1]));
}

function readXlsx(path) {
  const files = unzip(readFileSync(path));
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString("utf8") || "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unescapeXml(t[1])).join(""));
  const isDate = dateStyles(files);
  const sheetName = [...files.keys()].filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const sheet = files.get(sheetName).toString("utf8");
  const rows = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1];
      const col = /r="([A-Z]+)/.exec(attrs)?.[1];
      const idx = col ? [...col].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const style = +(/s="(\d+)"/.exec(attrs)?.[1] ?? -1);
      let v = null;
      if (type === "inlineStr") v = [...c[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unescapeXml(t[1])).join("");
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(c[2])?.[1];
        if (raw != null) v = type === "s" ? shared[+raw] : (type === "str" ? unescapeXml(raw)
          : (isDate[style] ? serialToISO(+raw) : Number(raw)));
      }
      cells[idx] = v ?? null;
    }
    rows.push(cells);
  }
  return rows;
}

function readCsv(path) {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const rows = [[]]; let cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { rows.at(-1).push(cell); cell = ""; }
    else if (ch === "\n") { rows.at(-1).push(cell); cell = ""; rows.push([]); }
    else if (ch !== "\r") cell += ch;
  }
  rows.at(-1).push(cell);
  return rows.filter(r => r.some(c => String(c ?? "").trim() !== ""));
}

/* ---------------- the journal ---------------- */

const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = s => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const isoOf = v => {
  if (v == null) return "";
  if (typeof v === "number") return serialToISO(v);
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (!m) return s.slice(0, 10);
  return m[0].includes("/") ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : `${m[1]}-${m[2]}-${m[3]}`;
};

// A Sage journal row is Date | Check # | Account ID | Line Description | Debit | Credit.
// Rows arrive in blocks: the document lines ("Invoice: 260402") of one payment,
// then the cash line whose description names the party. The party line's
// direction also tells us the sign of the document lines, so the same reader
// handles money out (disbursements) and money in (receipts).
function parseJournal(rows, names) {
  const head = rows.findIndex(r => r.some(c => /^date$/i.test(String(c ?? "").trim())));
  const cols = (rows[head] || []).map(c => norm(c));
  const at = re => cols.findIndex(c => re.test(c));
  const iDate = at(/^date$/), iRef = at(/check|ref/), iDesc = at(/description/),
        iDeb = at(/debit/), iCred = at(/credit/);
  if ([iDate, iDesc, iDeb, iCred].some(i => i < 0))
    throw new Error(`could not find the Date / Line Description / Debit / Credit columns in ${cols.join(" | ")}`);

  const lines = []; let block = [];
  for (const row of rows.slice(head + 1)) {
    if (!row || row[iDate] == null || String(row[iDate]).trim() === "") continue;
    const date = isoOf(row[iDate]);
    const ref = String(row[iRef] ?? "").trim();
    const desc = String(row[iDesc] ?? "").trim();
    const net = r2((Number(row[iDeb]) || 0) - (Number(row[iCred]) || 0));
    // Footer and subtotal rows carry figures but no description; they are not
    // journal lines and must not be mistaken for documents awaiting a party.
    if (!desc || /^(sub)?total\b/i.test(desc)) continue;
    if (names.has(norm(desc))) {                       // the cash line: it names the party
      const sign = net > 0 ? -1 : 1;                   // flip so a normal payment is positive
      for (const b of block) lines.push({ ...b, party: desc, amount: r2(b.raw * sign) });
      block = [];
    } else {
      block.push({ date, ref, doc: desc.replace(/^invoice:\s*/i, "").trim(), raw: net });
    }
  }
  if (block.length) throw new Error(`${block.length} journal line(s) had no party line after them — is a name missing from Contacts?`);
  return lines;
}

/* ---------------- reconcile ---------------- */

const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const flag = n => process.argv.includes("--" + n);
const optOf = n => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : null; };
if (args.length < 2) {
  console.error("usage: node tools/reconcile.mjs <backup.json> <journal.xlsx|.csv> [--kind bill|invoice]");
  process.exit(2);
}
const [backupPath, journalPath] = args;
const db = JSON.parse(readFileSync(backupPath, "utf8"));
const kind = optOf("kind") || (/receipt/i.test(basename(journalPath)) ? "invoice" : "bill");
const isBill = kind === "bill";

const partyNames = new Map();
for (const c of db.contacts || []) if (c.type === (isBill ? "vendor" : "customer")) partyNames.set(norm(c.name), c.id);
const nameOf = id => (db.contacts || []).find(c => c.id === id)?.name || "—";

const rows = /\.csv$/i.test(journalPath) ? readCsv(journalPath) : readXlsx(journalPath);
const journal = parseJournal(rows, partyNames);
if (!journal.length) { console.error("no journal lines found"); process.exit(2); }
const from = journal.reduce((a, l) => l.date < a ? l.date : a, journal[0].date);
const to = journal.reduce((a, l) => l.date > a ? l.date : a, journal[0].date);

const docs = isBill ? (db.bills || []) : (db.invoices || []);
const payments = [];
for (const d of docs) for (const p of d.payments || [])
  payments.push({ party: nameOf(isBill ? d.vendorId : d.customerId), amount: r2(Number(p.amount) || 0),
                  date: p.date || "", ref: String(p.ref ?? "").trim(), number: d.number, docId: d.id });
const inWindow = payments.filter(p => p.date >= from && p.date <= to);

const key = x => [norm(x.party), x.amount, x.date].join("|");
const pool = new Map();
for (const p of inWindow) pool.set(key(p), [...(pool.get(key(p)) || []), p]);
const missing = [], matched = [];
for (const l of journal) {
  const hit = pool.get(key(l));
  if (hit?.length) matched.push([l, hit.shift()]); else missing.push(l);
}
const extra = [...pool.values()].flat();

const sageTotal = r2(journal.reduce((s, l) => s + l.amount, 0));
const ledgerTotal = r2(inWindow.reduce((s, p) => s + p.amount, 0));
const refMismatch = matched.filter(([l, p]) => p.ref && norm(p.ref) !== norm(l.ref));
const refBlank = matched.filter(([l, p]) => !p.ref && l.ref);

// The import's signature failure: one Sage payment landing twice on one document.
const doubled = [];
for (const d of docs) {
  const byGroup = new Map();
  for (const p of d.payments || []) {
    const k = [p.date, p.method, norm(p.ref)].join("|");
    byGroup.set(k, [...(byGroup.get(k) || []), p]);
  }
  for (const [, ps] of byGroup) if (ps.length > 1)
    doubled.push({ number: d.number, party: nameOf(isBill ? d.vendorId : d.customerId), lines: ps });
}

/* ---------------- report ---------------- */

const label = isBill ? "vendor payments" : "customer receipts";
const H = s => "\n" + s + "\n" + "-".repeat(s.length);
console.log(`Ledger ${basename(backupPath)}  vs  Sage ${basename(journalPath)}   (${label})`);
console.log(`window ${from} .. ${to}`);
console.log(`\n  Sage    ${String(journal.length).padStart(4)} lines   ${money(sageTotal).padStart(14)}`);
console.log(`  Ledger  ${String(inWindow.length).padStart(4)} payments ${money(ledgerTotal).padStart(13)}`);
if (r2(sageTotal - ledgerTotal) !== 0) console.log(`  difference               ${money(r2(ledgerTotal - sageTotal)).padStart(13)}`);

if (missing.length) {
  console.log(H(`In Sage, not in the ledger (${missing.length})`));
  for (const l of missing) console.log(`  ${l.date}  ${l.party.padEnd(26)} ${money(l.amount).padStart(13)}   ref ${l.ref || "—"}  doc ${l.doc || "—"}`);
}
if (extra.length) {
  console.log(H(`In the ledger, not in Sage (${extra.length})`));
  for (const p of extra) console.log(`  ${p.date}  ${p.party.padEnd(26)} ${money(p.amount).padStart(13)}   on ${p.number}`);
}
if (refBlank.length) {
  console.log(H(`Sage has a reference, the ledger has none (${refBlank.length})`));
  for (const [l, p] of refBlank.slice(0, 20)) console.log(`  ${l.date}  ${p.number.padEnd(12)} ${money(l.amount).padStart(13)}   should be ${l.ref}`);
  if (refBlank.length > 20) console.log(`  … and ${refBlank.length - 20} more`);
}
if (refMismatch.length) {
  console.log(H(`Reference differs from Sage (${refMismatch.length})`));
  for (const [l, p] of refMismatch) console.log(`  ${l.date}  ${p.number.padEnd(12)} ledger ${p.ref}  Sage ${l.ref}`);
}
if (doubled.length) {
  console.log(H(`One payment applied twice to the same document (${doubled.length})`));
  console.log("  This is the shape of the import bug: check each against Sage — one line may belong to another party.");
  for (const d of doubled) console.log(`  ${d.number.padEnd(12)} ${d.party.padEnd(26)} ` +
    d.lines.map(p => `${money(Number(p.amount))} on ${p.date}`).join("  +  "));
}

const clean = !missing.length && !extra.length && !refMismatch.length && !doubled.length;
console.log(clean
  ? `\nClean: every one of the ${journal.length} Sage lines matches a ledger payment on party, amount and date.`
  + (refBlank.length ? `  (${refBlank.length} payment(s) missing their reference — run the reference restore.)` : "")
  : `\nDiscrepancies found — see above.`);
process.exit(clean ? 0 : 1);
