// Invoice PDF (jsPDF) styled after the Sage-style "Invoice Example.pdf":
// company block + big INVOICE header, Bill To / Ship To boxes, info grid,
// items table, boxed totals. Used by the Email attachment and Download PDF.
//
// Every page is a full page: the frame is fixed, the items box is ruled down
// to the totals however few lines there are, and lines that don't fit carry
// onto the next page, framed the same way. Pagination comes from
// invoiceLayout.js, so the PDF and the printable invoice break in step.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate } from "./helpers.js";
import { lineTotals, paid, balance } from "../calc/ledger.js";
import { invoicePages } from "./invoiceLayout.js";
import { termsLabel } from "./terms.js";
import { isCreditMemo } from "./credits.js";

const GRAY = [217, 217, 217];
const fmt2 = n => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Page geometry, in points from the top-left of a letter page.
const M = 42;
const BOX_Y = 140, BOX_H = 80;
const ITEMS_BOTTOM = 608;       // where the items box ends on the totals page
const ITEMS_BOTTOM_CONT = 722;  // and on a page that only says "continued"
const TOTALS_Y = 620;           // top of the totals box on the last page
const ROW_H = 17;

export async function invoicePdf(inv, db) {
  const s = db.settings;
  const customer = db.contacts.find(c => c.id === inv.customerId);
  const person = db.contactPeople.find(p => p.id === inv.contactPersonId);
  // Credit notes are stored negative and printed positive under a CREDIT MEMO
  // heading — the same document, read the way a credit reads.
  const isCredit = isCreditMemo(inv);
  const doc0 = isCredit
    ? { ...inv, lineItems: (inv.lineItems || []).map(li => ({ ...li, unitPrice: -(Number(li.unitPrice) || 0) })) }
    : inv;
  const t = lineTotals(doc0.lineItems, doc0.taxRate);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const pages = invoicePages(doc0.lineItems);

  pages.forEach((rows, pi) => {
    if (pi) doc.addPage();
    const itemsTop = drawFrame(doc, { inv, s, customer, person, W, page: pi + 1, of: pages.length, isCredit });

    autoTable(doc, {
      startY: itemsTop, margin: { left: M, right: M }, theme: "grid", rowPageBreak: "avoid",
      head: [["Quantity", "Item", "Description", "Unit Price", "Amount"]],
      body: rows.map(r => [
        r.billed ? r.qty.toFixed(2) : "",
        "",
        r.lines.join("\n"),
        r.price == null ? "" : fmt2(r.price),
        r.billed ? fmt2(r.amount) : "",
      ]),
      styles: { font: "helvetica", fontSize: 9, cellPadding: 4, lineColor: 0, lineWidth: 0.5, textColor: 0, valign: "top" },
      headStyles: { fillColor: GRAY, fontStyle: "bold", halign: "center" },
      columnStyles: {
        0: { halign: "right", cellWidth: 60 }, 1: { cellWidth: 70 },
        3: { halign: "right", cellWidth: 75 }, 4: { halign: "right", cellWidth: 80 },
      },
    });

    // Rule the items box down to its fixed bottom, so a short invoice still
    // prints a full page.
    const last = pi === pages.length - 1;
    const bottom = last ? ITEMS_BOTTOM : ITEMS_BOTTOM_CONT;
    const endY = doc.lastAutoTable.finalY;
    if (endY < bottom) doc.setDrawColor(0).setLineWidth(0.5).rect(M, endY, W - 2 * M, bottom - endY);

    if (!last) {
      doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(60)
        .text(`Continued on page ${pi + 2}`, W - M, bottom + 16, { align: "right" });
      doc.setTextColor(0);
    } else {
      drawTotals(doc, { inv, s, t, W, isCredit });
    }
  });

  return { blob: doc.output("blob"), filename: `${inv.number}.pdf` };
}

// Everything above the items table. Returns the y the items table starts at.
function drawFrame(doc, { inv, s, customer, person, W, page, of, isCredit }) {
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(0).text(s.company || "", M, 56);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text((s.companyAddress || "").split("\n").filter(Boolean), M, 70);
  if (s.companyPhone) doc.text("Voice:  " + s.companyPhone, M, 114);
  doc.setFont("helvetica", "bold").setFontSize(isCredit ? 24 : 30).setTextColor(80).text(isCredit ? "CREDIT MEMO" : "INVOICE", W - M, 62, { align: "right" });
  doc.setTextColor(0).setFontSize(9);
  const hdr = [[isCredit ? "Credit Note #:" : "Invoice Number:", inv.number],
    [isCredit ? "Credit Date:" : "Invoice Date:", fmtDate(inv.date)], ["Page:", of > 1 ? `${page} of ${of}` : "1"]];
  hdr.forEach(([k, v], i) => {
    doc.setFont("helvetica", "normal").text(k, W - 210, 82 + i * 13);
    doc.text(String(v), W - 130, 82 + i * 13);
  });

  const boxW = (W - 2 * M - 40) / 2;
  const addr = [person?.name, customer?.name, ...(customer?.address || "").split("\n")].filter(Boolean);
  [["Bill To:", M], ["Ship to:", M + boxW + 40]].forEach(([label, x]) => {
    doc.setFillColor(...GRAY).setDrawColor(0).setLineWidth(0.5).rect(x, BOX_Y, boxW, 16, "FD");
    doc.rect(x, BOX_Y, boxW, BOX_H);
    doc.setFont("helvetica", "bold").setFontSize(9).text(label, x + 6, BOX_Y + 11);
    doc.setFont("helvetica", "normal").text(addr, x + 6, BOX_Y + 30);
  });

  const gridStyles = { font: "helvetica", fontSize: 9, halign: "center", cellPadding: 3, lineColor: 0, lineWidth: 0.5, textColor: 0 };
  autoTable(doc, {
    startY: BOX_Y + BOX_H + 12, margin: { left: M, right: M }, theme: "grid",
    head: [["Customer ID", "Customer PO", "Payment Terms"]],
    body: [["", inv.poNumber || "", isCredit ? "Credit memo" : termsLabel(customer, s)]],
    styles: gridStyles, headStyles: { fillColor: GRAY, fontStyle: "bold" },
  });
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY, margin: { left: M, right: M }, theme: "grid",
    head: [["Sales Rep ID", "Shipping Method", "Ship Date", isCredit ? "Credit Date" : "Due Date"]],
    body: [["", "", "", fmtDate(isCredit ? inv.date : inv.dueDate)]],
    styles: gridStyles, headStyles: { fillColor: GRAY, fontStyle: "bold" },
  });
  return doc.lastAutoTable.finalY + 10;
}

// Memo line, boxed totals and the invoice notes — last page only.
function drawTotals(doc, { inv, s, t, W, isCredit }) {
  const flip = isCredit ? -1 : 1;
  const applied = paid(inv) * flip;
  const rows = [
    ["Subtotal", fmt2(t.sub)],
    ["Sales Tax", t.tax ? fmt2(t.tax) : ""],
    [isCredit ? "Total Credit" : "Total Invoice Amount", fmt2(t.total)],
    [isCredit ? "Applied to invoices" : "Payment/Credit Applied", applied ? fmt2(applied) : ""],
    [isCredit ? "CREDIT REMAINING" : "TOTAL", fmt2(applied ? balance(inv) * flip : t.total)],
  ];
  const tx = W - M - 300;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0)
    .text(isCredit ? "Apply this credit to any open invoice." : "Check/Credit Memo No:", M, TOTALS_Y + 28);
  doc.setDrawColor(0).setLineWidth(0.5);
  rows.forEach(([k, v], i) => {
    const ry = TOTALS_Y + i * ROW_H;
    const last = i === rows.length - 1;
    if (last) doc.setFillColor(...GRAY).rect(tx, ry, 300, ROW_H, "FD"); else doc.rect(tx, ry, 300, ROW_H);
    doc.setFont("helvetica", last ? "bold" : "normal");
    doc.text(k, tx + 5, ry + 12);
    doc.text(v, tx + 295, ry + 12, { align: "right" });
  });
  const notes = inv.notes || s.invoiceNotes;
  if (notes) {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90)
      .text(doc.splitTextToSize(notes, W - 2 * M), M, TOTALS_Y + rows.length * ROW_H + 18);
    doc.setTextColor(0);
  }
}
