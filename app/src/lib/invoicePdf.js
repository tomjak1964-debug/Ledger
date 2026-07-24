// Programmatic invoice PDF (jsPDF) — used for the Email attachment and the
// Download PDF button. Browser print remains available for exact-CSS output.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { money, fmtDate } from "./helpers.js";
import { lineTotals, paid, balance } from "../calc/ledger.js";

async function logoDataUrl() {
  try {
    const blob = await fetch("/tmj-logo.png").then(r => r.ok ? r.blob() : null);
    if (!blob) return null;
    return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(blob); });
  } catch { return null; }
}

export async function invoicePdf(inv, db) {
  const s = db.settings;
  const customer = db.contacts.find(c => c.id === inv.customerId);
  const person = db.contactPeople.find(p => p.id === inv.contactPersonId);
  const t = lineTotals(inv.lineItems, inv.taxRate);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const logo = await logoDataUrl();
  let y = 46;
  if (logo) { doc.addImage(logo, "PNG", W / 2 - 55, y, 110, 72); y += 86; }

  doc.setFont("times", "bold").setFontSize(20).text("INVOICE", W - 54, y, { align: "right" });
  doc.setFont("courier", "bold").setFontSize(11).text(inv.number, W - 54, y + 16, { align: "right" });
  doc.setFont("times", "bold").setFontSize(13).text(s.company || "", 54, y);
  doc.setFont("times", "normal").setFontSize(9);
  doc.text([...(s.companyAddress || "").split("\n"), s.companyEmail, s.companyPhone].filter(Boolean), 54, y + 14);
  y += 64;

  doc.setFont("times", "bold").setFontSize(8).text("BILL TO", 54, y);
  doc.setFont("times", "normal").setFontSize(10);
  doc.text([person?.name, customer?.name, ...(customer?.address || "").split("\n"), person?.email].filter(Boolean), 54, y + 12);
  doc.setFont("times", "normal").setFontSize(10);
  const meta = [["Date", fmtDate(inv.date)], ["Due", fmtDate(inv.dueDate)], ...(inv.poNumber ? [["PO #", inv.poNumber]] : [])];
  meta.forEach(([k, v], i) => {
    doc.setFont("times", "bold").text(k, W - 160, y + 12 + i * 14);
    doc.setFont("times", "normal").text(String(v), W - 54, y + 12 + i * 14, { align: "right" });
  });
  y += 84;

  autoTable(doc, {
    startY: y, margin: { left: 54, right: 54 },
    head: [["Description", "Qty", "Unit Price", "Amount"]],
    body: inv.lineItems.map(it => [
      it.desc || "—",
      `${it.qty}${it.unit ? " " + it.unit : ""}`,
      money(Number(it.unitPrice) || 0),
      money((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)),
    ]),
    styles: { font: "times", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [19, 35, 59], fontSize: 8, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", cellWidth: 70 }, 2: { halign: "right", cellWidth: 90 }, 3: { halign: "right", cellWidth: 90 } },
  });
  y = doc.lastAutoTable.finalY + 16;

  const line = (label, val, bold) => {
    doc.setFont("times", bold ? "bold" : "normal").setFontSize(bold ? 12 : 10);
    doc.text(label, W - 220, y); doc.text(val, W - 54, y, { align: "right" });
    y += bold ? 18 : 15;
  };
  line("Subtotal", money(t.sub));
  line(`Tax (${inv.taxRate || 0}%)`, money(t.tax));
  if (paid(inv) > 0) line("Paid", "-" + money(paid(inv)));
  line(paid(inv) > 0 ? "Balance Due" : "Total", money(paid(inv) > 0 ? balance(inv) : t.total), true);

  const notes = inv.notes || s.invoiceNotes;
  if (notes) { y += 10; doc.setFont("times", "normal").setFontSize(9).text(doc.splitTextToSize(notes, W - 108), 54, y); }
  doc.setFontSize(8).setTextColor(120).text(
    [(s.companyAddress || "").replace(/\n/g, ", "), s.companyPhone].filter(Boolean).join(" - "),
    W / 2, doc.internal.pageSize.getHeight() - 30, { align: "center" });

  return { blob: doc.output("blob"), filename: `${inv.number}.pdf` };
}
