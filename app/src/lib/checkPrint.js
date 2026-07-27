// Check printing on pre-printed voucher stock (check on top, two stubs).
// Field positions are in INCHES from the top-left of the page and are fully
// editable in Settings → Check Printing; these defaults suit standard
// QuickBooks/Sage voucher checks. Print the PDF at 100% scale (no "fit").
import { jsPDF } from "jspdf";
import { money, fmtDate } from "./helpers.js";

export const DEFAULT_CHECK_LAYOUT = {
  fontSize: 10,
  fields: {
    date:    { label: "Date",             x: 6.30, y: 0.95 },
    payee:   { label: "Pay to the order of", x: 0.90, y: 1.50 },
    amount:  { label: "Amount (numeric)", x: 7.05, y: 1.50 },
    words:   { label: "Amount in words",  x: 0.35, y: 1.90 },
    address: { label: "Payee address",    x: 0.90, y: 2.30 },
    memo:    { label: "Memo",             x: 0.55, y: 3.15 },
    stub1:   { label: "Stub 1 (top line)", x: 0.40, y: 3.90 },
    stub2:   { label: "Stub 2 (top line)", x: 0.40, y: 7.45 },
  },
};

export const checkLayout = settings => {
  const saved = settings.check || {};
  return {
    fontSize: saved.fontSize || DEFAULT_CHECK_LAYOUT.fontSize,
    fields: Object.fromEntries(Object.entries(DEFAULT_CHECK_LAYOUT.fields).map(([k, def]) =>
      [k, { ...def, ...(saved.fields?.[k] || {}) }])),
  };
};

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words999(n) {
  let s = "";
  if (n >= 100) { s += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) s += " "; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += "-" + ONES[n % 10]; }
  else if (n > 0) s += ONES[n];
  return s;
}
export function amountInWords(amount) {
  const dollars = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - dollars) * 100);
  let s = "";
  const groups = [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"], [1, ""]];
  let rest = dollars;
  for (const [div, name] of groups) {
    const g = Math.floor(rest / div);
    if (g) { s += (s ? " " : "") + words999(g) + (name ? " " + name : ""); rest %= div; }
  }
  if (!s) s = "Zero";
  return `${s} and ${String(cents).padStart(2, "0")}/100 Dollars`;
}

// payment: {amount, date, ref}; vendor contact; stubLines: [{ref, date, desc, amount}]
export function printCheck({ payment, vendor, memo, stubLines, settings, test }) {
  const L = checkLayout(settings);
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const F = L.fields;
  const put = (k, text, size) => {
    doc.setFontSize(size || L.fontSize);
    doc.text(String(text), F[k].x, F[k].y);
  };
  doc.setFont("helvetica", "normal");

  if (test) {
    // alignment pattern: field names at their positions + a light 1/4" ruler edge
    doc.setTextColor(0);
    Object.entries(F).forEach(([k, f]) => { doc.setFontSize(9); doc.text(`[${f.label}]`, f.x, f.y); });
    doc.setFontSize(6).setTextColor(150);
    for (let i = 1; i < 44; i++) { doc.text(String(i % 4 === 0 ? i / 4 : "·"), 0.06, i / 4); }
    for (let i = 1; i < 34; i++) { doc.text(String(i % 4 === 0 ? i / 4 : "·"), i / 4, 0.15); }
    return doc;
  }

  const amt = Number(payment.amount) || 0;
  const words = amountInWords(amt);
  put("date", fmtDate(payment.date));
  put("payee", vendor?.name || "");
  put("amount", "**" + amt.toLocaleString("en-US", { minimumFractionDigits: 2 }), L.fontSize + 1);
  put("words", (words + " ").padEnd(95, "*"), Math.min(L.fontSize, 9.5));
  if (vendor?.address) {
    doc.setFontSize(L.fontSize);
    doc.text([vendor.name, ...vendor.address.split("\n")].filter(Boolean), F.address.x, F.address.y);
  }
  put("memo", memo || "");

  // voucher stubs (identical, one for payee, one for records)
  const stub = (k) => {
    let y = F[k].y;
    doc.setFontSize(9);
    doc.text(`${vendor?.name || ""}    ${fmtDate(payment.date)}    Check ${payment.ref || ""}`, F[k].x, y);
    y += 0.22;
    (stubLines || []).forEach(l => {
      doc.text(`${l.ref || ""}  ${l.desc || ""}`.trim().slice(0, 80), F[k].x, y);
      doc.text(money(l.amount), F[k].x + 7.2, y, { align: "right" });
      y += 0.19;
    });
    doc.setFont("helvetica", "bold");
    doc.text("Total", F[k].x, y + 0.05);
    doc.text(money(amt), F[k].x + 7.2, y + 0.05, { align: "right" });
    doc.setFont("helvetica", "normal");
  };
  stub("stub1"); stub("stub2");
  return doc;
}

export function openCheckPdf(args) {
  const doc = printCheck(args);
  window.open(URL.createObjectURL(doc.output("blob")), "_blank");
}
