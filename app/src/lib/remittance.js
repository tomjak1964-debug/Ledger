// Remittance advice for electronic payments (ACH / wire) — the "what this
// payment covers" document a check stub would normally provide.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { money, fmtDate } from "./helpers.js";

export function remittancePdf({ payment, vendor, lines, settings }) {
  const s = settings;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
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
  doc.text([vendor?.name, ...(vendor?.address || "").split("\n")].filter(Boolean), M, 144);

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
  const filename = `Remittance ${vendor?.name || ""} ${payment.date}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
  return { blob: doc.output("blob"), filename };
}

export function openRemittancePdf(args) {
  window.open(URL.createObjectURL(remittancePdf(args).blob), "_blank");
}
