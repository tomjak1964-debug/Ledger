// Remittance advice for electronic payments (ACH / wire) — the "what this
// payment covers" document a check stub would normally provide.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { money, fmtDate } from "./helpers.js";

// The file name a remittance goes out under: "<Vendor> Remittance - <Reference #>",
// falling back to the payment date when the transfer has no reference. It is
// the attachment name when emailed and, because it is also written into the
// PDF's Title, what the browser's Save / Print dialog offers when the PDF is
// opened in a tab — a blob URL has no name of its own to suggest.
export function remittanceFileStem({ vendor, payment }) {
  const who = (vendor?.name || "Vendor").trim();
  const ref = String(payment?.ref || "").trim() || fmtDate(payment?.date);
  return `${who} Remittance - ${ref}`.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

export function remittancePdf(args) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const stem = remittanceFileStem(args);
  doc.setProperties({ title: stem, subject: "Remittance advice", creator: args.settings?.company || "" });
  drawRemit(doc, args);
  return { blob: doc.output("blob"), filename: stem + ".pdf" };
}

// One PDF, one page per vendor — for Pay Bills runs. A run to a single vendor
// is named like a single remittance; several vendors share one dated file.
export function remittancesPdf(list) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const stem = list.length === 1 ? remittanceFileStem(list[0])
    : `Remittances - ${fmtDate(list[0]?.payment?.date)}`.replace(/[\\/:*?"<>|]/g, "-");
  doc.setProperties({ title: stem, subject: "Remittance advice", creator: list[0]?.settings?.company || "" });
  list.forEach((args, i) => { if (i) doc.addPage(); drawRemit(doc, args); });
  return doc.output("blob");
}

function drawRemit(doc, { payment, vendor, lines, settings }) {
  const s = settings;
  const W = doc.internal.pageSize.getWidth(), M = 54;
  doc.setFont("helvetica", "bold").setFontSize(14).text(s.company || "", M, 56);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text([...(s.companyAddress || "").split("\n"), s.companyPhone].filter(Boolean), M, 70);
  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(80).text("REMITTANCE ADVICE", W - M, 62, { align: "right" });
  doc.setTextColor(0).setFontSize(10);
  const meta = [["Payment Date:", fmtDate(payment.date)], ["Method:", payment.method || "Electronic"], ["Reference #:", payment.ref || "—"]];
  meta.forEach(([k, v], i) => {
    doc.setFont("helvetica", "bold").text(k, W - 230, 92 + i * 14);
    doc.setFont("helvetica", "normal").text(String(v), W - M, 92 + i * 14, { align: "right" });
  });
  doc.setFont("helvetica", "bold").setFontSize(9).text("PAID TO", M, 130);
  doc.setFont("helvetica", "normal").setFontSize(10);
  // Remit-to details win when the vendor has an A/P desk of its own.
  const remitTo = (vendor?.remitAddress || "").trim() || vendor?.address || "";
  doc.text([vendor?.name, vendor?.remitName ? "Attn: " + vendor.remitName : "", ...remitTo.split("\n")].filter(Boolean), M, 144);

  autoTable(doc, {
    startY: 210, margin: { left: M, right: M },
    head: [["Your Invoice #", "Bill Date", "Description", "Amount Paid"]],
    body: (lines || []).map(l => [l.ref || "—", fmtDate(l.date), (l.desc || "").slice(0, 60), money(l.amount)]),
    foot: [["", "", "Total Paid", money(payment.amount)]],
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [19, 35, 59] },
    footStyles: { fillColor: [217, 217, 217], textColor: 0, fontStyle: "bold" },
    columnStyles: { 3: { halign: "right" } },
  });
  const y = doc.lastAutoTable.finalY + 24;
  doc.setFontSize(9).setTextColor(90).text(
    `Payment sent electronically on ${fmtDate(payment.date)}. Please apply to the invoice(s) above. Questions: ${s.companyPhone || s.companyEmail || ""}`,
    M, y, { maxWidth: W - 2 * M });
}

export function openRemittancePdf(args) {
  window.open(URL.createObjectURL(remittancePdf(args).blob), "_blank");
}
