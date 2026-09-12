// Check printing on pre-printed check stock.
//
// The geometry comes from a FORM (src/lib/forms.js) — a named, editable layout
// picked in Settings → Forms. Positions are inches from the top-left of the
// page; print at 100% scale (no "fit to page") or nothing will line up.
import { jsPDF } from "jspdf";
import { money, fmtDate } from "./helpers.js";
import { formFor, fieldsOf, FIELD_SPECS } from "./forms.js";

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

// Resolved field map: catalogue defaults + the form's values + its calibration.
export function checkFields(form) {
  const ox = Number(form?.offsetX) || 0, oy = Number(form?.offsetY) || 0;
  return Object.fromEntries(fieldsOf(form).map(f => [f.key, { ...f, x: f.x + ox, y: f.y + oy }]));
}

const COLS = [
  ["col.ref", l => l.ref || ""],
  ["col.desc", l => l.desc || ""],
  ["col.invDate", l => (l.date ? fmtDate(l.date) : "")],
  ["col.invAmount", l => (l.invoiceAmount == null ? "" : money(l.invoiceAmount))],
  ["col.discount", l => (Number(l.discount) ? money(l.discount) : "")],
  ["col.amountPaid", l => money(l.amount)],
];

export function drawCheck(doc, form, { payment, vendor, memo, stubLines }) {
  const F = checkFields(form);
  const base = Number(form.fontSize) || 10;
  doc.setFont("helvetica", "normal").setTextColor(0);

  const put = (key, text, size, y) => {
    const f = F[key];
    if (!f || !f.on || text == null || text === "") return;
    doc.setFontSize(size || f.size || base);
    doc.text(String(text), f.x, y == null ? f.y : y, f.align === "right" ? { align: "right" } : undefined);
  };
  // Trim to the room a column actually has before the next one starts.
  const fit = (key, text, size) => {
    const f = F[key];
    if (!f?.on || !text) return "";
    const next = COLS.map(([k]) => F[k]).filter(c => c.on && c.x > f.x).sort((a, b) => a.x - b.x)[0];
    const room = next ? next.x - f.x - 0.08 : 8.3 - f.x;
    doc.setFontSize(size || base);
    let s = String(text);
    if (doc.getTextWidth(s) <= room) return s;
    while (s.length > 1 && doc.getTextWidth(s + "...") > room) s = s.slice(0, -1);
    return s.replace(/[\s,.-]+$/, "") + "...";
  };

  const amt = Number(payment.amount) || 0;
  const disc = (stubLines || []).reduce((t, l) => t + (Number(l.discount) || 0), 0);

  put("date", fmtDate(payment.date));
  put("payee", vendor?.name || "");
  put("amount", "**" + amt.toLocaleString("en-US", { minimumFractionDigits: 2 }), base + 1);
  put("words", (amountInWords(amt) + " ").padEnd(95, "*"), Math.min(base, 9.5));
  // Mail the check to the remit-to address when the vendor gave one.
  const mailTo = (vendor?.remitAddress || "").trim() || vendor?.address || "";
  if (mailTo && F.address.on) {
    doc.setFontSize(F.address.size || base);
    doc.text([vendor.name, ...mailTo.split("\n")].filter(Boolean), F.address.x, F.address.y);
  }
  put("memo", memo || "");

  // The two vouchers are identical: one for the payee, one for the file.
  const voucher = (rowsKey, footKey) => {
    const start = F[rowsKey], foot = F[footKey];
    if (!start?.on) return;
    const rh = Number(form.rowHeight) || 0.17;
    const lines = stubLines || [];
    const room = foot?.on ? Math.max(1, Math.floor((foot.y - start.y) / rh) - 1) : lines.length;
    const shown = lines.length > room ? lines.slice(0, Math.max(0, room - 1)) : lines;
    const size = 9;
    doc.setFontSize(size);
    let y = start.y;
    shown.forEach(l => {
      COLS.forEach(([k, val]) => put(k, k === "col.desc" ? fit(k, val(l), size) : val(l), size, y));
      y += rh;
    });
    if (lines.length > shown.length) put("col.desc", `+ ${lines.length - shown.length} more invoice(s)`, size, y);
    if (foot?.on) {
      doc.setFont("helvetica", "bold");
      put("foot.date", fmtDate(payment.date), size, foot.y);
      put("foot.number", payment.ref || "", size, foot.y);
      put("foot.payee", fit("foot.payee", vendor?.name || "", size), size, foot.y);
      put("foot.discounts", money(disc), size, foot.y);
      put("foot.amount", money(amt), size, foot.y);
      doc.setFont("helvetica", "normal");
    }
  };
  voucher("stubTop", "footTop");
  voucher("stubBottom", "footBottom");
}

// Field names printed where they'd land, over a quarter-inch ruler — print it
// on plain paper, hold it against a blank check, and nudge what's off.
function drawTest(doc, form) {
  const F = checkFields(form);
  const label = FIELD_SPECS.check.reduce((m, s) => (m[s.key] = s.label, m), {});
  doc.setFont("helvetica", "normal").setTextColor(0).setFontSize(8);
  FIELD_SPECS.check.filter(s => s.axes === "xy").forEach(s => {
    if (F[s.key].on) doc.text(`[${label[s.key]}]`, F[s.key].x, F[s.key].y, F[s.key].align === "right" ? { align: "right" } : undefined);
  });
  [["stubTop", "footTop"], ["stubBottom", "footBottom"]].forEach(([rowsKey, footKey]) => {
    if (!F[rowsKey].on) return;
    COLS.forEach(([k]) => { if (F[k].on) doc.text(label[k], F[k].x, F[rowsKey].y, F[k].align === "right" ? { align: "right" } : undefined); });
    if (F[footKey].on) ["foot.date", "foot.number", "foot.payee", "foot.discounts", "foot.amount"]
      .forEach(k => { if (F[k].on) doc.text(label[k], F[k].x, F[footKey].y, F[k].align === "right" ? { align: "right" } : undefined); });
  });
  doc.setDrawColor(170).setLineWidth(0.006);
  (form.guides || []).forEach(g => doc.line(0.2, g, 8.3, g));
  doc.setFontSize(6).setTextColor(150);
  for (let i = 1; i < 44; i++) doc.text(String(i % 4 === 0 ? i / 4 : "·"), 0.06, i / 4);
  for (let i = 1; i < 34; i++) doc.text(String(i % 4 === 0 ? i / 4 : "·"), i / 4, 0.15);
}

// payment: {amount, date, ref}; vendor contact; stubLines: [{ref, date, desc, invoiceAmount, discount, amount}]
export function printCheck({ payment, vendor, memo, stubLines, settings, form, test }) {
  const L = form || formFor(settings, "check");
  const doc = new jsPDF({ unit: "in", format: "letter" });
  if (test) drawTest(doc, L);
  else drawCheck(doc, L, { payment, vendor, memo, stubLines });
  return doc;
}

// One PDF, one page per check — for Pay Bills runs.
export function checksPdf(list, settings, form) {
  const L = form || formFor(settings, "check");
  const doc = new jsPDF({ unit: "in", format: "letter" });
  list.forEach((args, i) => { if (i) doc.addPage(); drawCheck(doc, L, args); });
  return doc.output("blob");
}

export function openCheckPdf(args) {
  const doc = printCheck(args);
  window.open(URL.createObjectURL(doc.output("blob")), "_blank");
}

// A filled-in example, for previewing a form while you edit it.
export const sampleCheck = () => ({
  payment: { amount: 12345.67, date: new Date().toISOString().slice(0, 10), ref: "5866" },
  vendor: { name: "Sample Vendor, Inc.", address: "123 Main St\nAnytown, MI 48000" },
  memo: "Inv 9981, 9982",
  stubLines: [
    { ref: "9981", date: "2026-08-04", desc: "Panel build — line 3 retrofit", invoiceAmount: 8200, discount: 164, amount: 8036 },
    { ref: "9982", date: "2026-08-18", desc: "Field service, two days", invoiceAmount: 4400, discount: 90.33, amount: 4309.67 },
  ],
});
