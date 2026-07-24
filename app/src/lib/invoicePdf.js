// Invoice PDF (jsPDF) styled after the Sage-style "Invoice Example.pdf":
// company block + big INVOICE header, Bill To / Ship To boxes, info grid,
// items table, boxed totals. Used by the Email attachment and Download PDF.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { money, fmtDate } from "./helpers.js";
import { lineTotals, paid, balance } from "../calc/ledger.js";

const GRAY = [217, 217, 217];
const fmt2 = n => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function invoicePdf(inv, db) {
  const s = db.settings;
  const customer = db.contacts.find(c => c.id === inv.customerId);
  const person = db.contactPeople.find(p => p.id === inv.contactPersonId);
  const t = lineTotals(inv.lineItems, inv.taxRate);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 42;

  // header
  doc.setFont("helvetica", "bold").setFontSize(14).text(s.company || "", M, 56);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text((s.companyAddress || "").split("\n").filter(Boolean), M, 70);
  if (s.companyPhone) doc.text("Voice:  " + s.companyPhone, M, 118);
  doc.setFont("helvetica", "bold").setFontSize(30).setTextColor(80).text("INVOICE", W - M, 62, { align: "right" });
  doc.setTextColor(0).setFontSize(9);
  const hdr = [["Invoice Number:", inv.number], ["Invoice Date:", fmtDate(inv.date)], ["Page:", "1"]];
  hdr.forEach(([k, v], i) => {
    doc.setFont("helvetica", "normal").text(k, W - 210, 82 + i * 13);
    doc.text(String(v), W - 130, 82 + i * 13);
  });

  // Bill To / Ship To boxes
  const boxY = 150, boxH = 86, boxW = (W - 2 * M - 40) / 2;
  const addr = [person?.name, customer?.name, ...(customer?.address || "").split("\n")].filter(Boolean);
  [["Bill To:", M], ["Ship to:", M + boxW + 40]].forEach(([label, x]) => {
    doc.setFillColor(...GRAY).rect(x, boxY, boxW, 16, "FD");
    doc.rect(x, boxY, boxW, boxH);
    doc.setFont("helvetica", "bold").setFontSize(9).text(label, x + 6, boxY + 11);
    doc.setFont("helvetica", "normal").text(addr, x + 6, boxY + 30);
  });

  // info grid
  const gridY = boxY + boxH + 14;
  autoTable(doc, {
    startY: gridY, margin: { left: M, right: M }, theme: "grid",
    head: [["Customer ID", "Customer PO", "Payment Terms"]],
    body: [["", inv.poNumber || "", `Net ${s.terms} Days`]],
    styles: { font: "helvetica", fontSize: 9, halign: "center", cellPadding: 3, lineColor: 0, lineWidth: 0.5, textColor: 0 },
    headStyles: { fillColor: GRAY, fontStyle: "bold" },
  });
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY, margin: { left: M, right: M }, theme: "grid",
    head: [["Sales Rep ID", "Shipping Method", "Ship Date", "Due Date"]],
    body: [["", "", "", fmtDate(inv.dueDate)]],
    styles: { font: "helvetica", fontSize: 9, halign: "center", cellPadding: 3, lineColor: 0, lineWidth: 0.5, textColor: 0 },
    headStyles: { fillColor: GRAY, fontStyle: "bold" },
  });

  // items — memo lines (qty 0) show unit price but no qty/amount
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 10, margin: { left: M, right: M }, theme: "grid",
    head: [["Quantity", "Item", "Description", "Unit Price", "Amount"]],
    body: inv.lineItems.map(it => {
      const qty = Number(it.qty) || 0;
      return [
        qty > 0 ? qty.toFixed(2) : "",
        "",
        (it.desc || "—").replace(/ — /g, "\n"),
        fmt2(it.unitPrice),
        qty > 0 ? fmt2(qty * (Number(it.unitPrice) || 0)) : "",
      ];
    }),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 4, lineColor: 0, lineWidth: 0.5, textColor: 0, valign: "top" },
    headStyles: { fillColor: GRAY, fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { halign: "right", cellWidth: 60 }, 1: { cellWidth: 70 },
      3: { halign: "right", cellWidth: 75 }, 4: { halign: "right", cellWidth: 80 },
    },
  });

  // totals box
  let y = doc.lastAutoTable.finalY;
  const rows = [
    ["Subtotal", fmt2(t.sub)],
    ["Sales Tax", t.tax ? fmt2(t.tax) : ""],
    ["Total Invoice Amount", fmt2(t.total)],
    ["Payment/Credit Applied", paid(inv) ? fmt2(paid(inv)) : ""],
    ["TOTAL", fmt2(paid(inv) ? balance(inv) : t.total)],
  ];
  const tx = W - M - 300;
  doc.setFont("helvetica", "normal").setFontSize(9).text("Check/Credit Memo No:", M, y + 40);
  rows.forEach(([k, v], i) => {
    const ry = y + i * 17;
    const last = i === rows.length - 1;
    if (last) doc.setFillColor(...GRAY).rect(tx, ry, 300, 17, "FD"); else doc.rect(tx, ry, 300, 17);
    doc.setFont("helvetica", last ? "bold" : "normal");
    doc.text(k, tx + 5, ry + 12);
    doc.text(v, tx + 295, ry + 12, { align: "right" });
  });
  y += rows.length * 17 + 24;
  const notes = inv.notes || s.invoiceNotes;
  if (notes) doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90).text(doc.splitTextToSize(notes, W - 2 * M), M, y);

  return { blob: doc.output("blob"), filename: `${inv.number}.pdf` };
}
