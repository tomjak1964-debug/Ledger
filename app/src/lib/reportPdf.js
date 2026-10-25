// A report as a real document, not a picture of the screen: text and tables
// drawn with jsPDF + autotable from the report's own tables, with the
// letterhead and the report's title / date / filter at the head of every page,
// column headings repeated on each page, and a footer with the print date and
// "Page n of m". Wide reports (more than eight columns) go landscape.
//
// It reads whatever the report shows (views/Reports.jsx wraps each in a ref):
// stat tiles become a summary strip, each table a table, under its card's
// heading when that differs from the report's title. Cells keep the screen's
// alignment and weight — amounts right-aligned, totals and subtotals bold, a
// shaded subtotal row shaded — and on-screen controls (.no-print, buttons,
// inputs) are left out.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, todayISO } from "./helpers.js";

const NAVY = [19, 35, 59], GREY = [237, 240, 244], MUTED = [91, 107, 128];

async function logo() {
  try {
    const blob = await (await fetch("/tmj-logo.png")).blob();
    const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    return { url, ratio: img.naturalWidth / img.naturalHeight };
  } catch { return null; }
}

// A cell's words without its on-screen controls; line breaks kept.
function textOf(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll(".no-print, button, input, select, svg").forEach(n => n.remove());
  c.querySelectorAll("br").forEach(n => n.replaceWith("\n"));
  c.querySelectorAll("div").forEach(n => n.insertAdjacentText("beforebegin", "\n"));
  return c.textContent.split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export async function reportPdf(root, { title, subtitle = "", filter = "", settings = {}, filename }) {
  const visible = el => !el.closest(".no-print");
  const tables = [...root.querySelectorAll("table")].filter(visible);
  const wide = tables.some(t => Math.max(...[...t.rows].slice(0, 3).map(r => [...r.cells].reduce((n, c) => n + (c.colSpan || 1), 0)), 0) > 8);
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: wide ? "landscape" : "portrait" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 40, TOP = 118, BOTTOM = 52;
  const mark = await logo();
  const company = settings.company || "";
  const coLines = [...(settings.companyAddress || "").split("\n"), settings.companyPhone].map(s => (s || "").trim()).filter(Boolean);

  const drawn = new Set();
  const header = () => {
    const pg = doc.getCurrentPageInfo().pageNumber;
    if (drawn.has(pg)) return;
    drawn.add(pg);
    let x = M;
    if (mark) { const h = 40, w = h * mark.ratio; doc.addImage(mark.url, "PNG", M, 30, w, h); x = M + w + 12; }
    doc.setTextColor(...NAVY).setFont("helvetica", "bold").setFontSize(11).text(company, x, 42);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text(coLines.join("  ·  "), x, 55, { maxWidth: W / 2 - 20 });
    doc.setTextColor(...NAVY).setFont("helvetica", "bold").setFontSize(16).text(title || "Report", W - M, 44, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
    [subtitle, filter].filter(Boolean).forEach((t, i) => doc.text(t, W - M, 58 + i * 12, { align: "right" }));
    doc.setDrawColor(...NAVY).setLineWidth(1.2).line(M, TOP - 22, W - M, TOP - 22);
  };
  header();
  let y = TOP;

  // Stat tiles: a summary strip.
  const stats = [...root.querySelectorAll(".stat")].filter(visible)
    .map(s => [textOf(s.querySelector(".lbl") || s), textOf(s.querySelector(".val") || s), s.querySelector(".meta") ? textOf(s.querySelector(".meta")) : ""]);
  if (stats.length) {
    autoTable(doc, {
      startY: y, margin: { top: TOP, bottom: BOTTOM, left: M, right: M }, theme: "plain",
      head: [stats.map(s => s[0].toUpperCase())], body: [stats.map(s => s[1]), stats.map(s => s[2])],
      styles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 6, right: 6 }, textColor: NAVY },
      headStyles: { fontSize: 7.5, textColor: MUTED, fontStyle: "bold", fillColor: GREY },
      didParseCell: d => { if (d.section === "body" && d.row.index === 0) { d.cell.styles.fontSize = 12; d.cell.styles.fontStyle = "bold"; } if (d.section === "body" && d.row.index === 1) { d.cell.styles.fontSize = 7.5; d.cell.styles.textColor = MUTED; } },
      didDrawPage: header,
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  if (!tables.length) {
    const empty = [...root.querySelectorAll(".empty .big, .empty")].filter(visible)[0];
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED).text(empty ? textOf(empty) : "Nothing to report for this selection.", M, y + 10);
  }

  for (const table of tables) {
    const head = table.closest(".card")?.querySelector(".card-head h3");
    const heading = head ? textOf(head) : "";
    if (heading && heading.toLowerCase() !== String(title || "").toLowerCase()) {
      if (y > H - BOTTOM - 60) { doc.addPage(); header(); y = TOP; }
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...NAVY).text(heading, M, y + 4);
      y += 12;
    }
    autoTable(doc, {
      html: table, startY: y, margin: { top: TOP, bottom: BOTTOM, left: M, right: M },
      theme: "striped", showHead: "everyPage",
      styles: { font: "helvetica", fontSize: wide ? 7.5 : 8.5, cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 }, textColor: [30, 41, 59], overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", fontSize: wide ? 7 : 7.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: d => {
        const el = d.cell.raw;
        if (!(el instanceof Element)) return;
        d.cell.text = textOf(el).split("\n");
        const cs = getComputedStyle(el);
        if (el.classList.contains("num") || cs.textAlign === "right" || cs.textAlign === "end") d.cell.styles.halign = "right";
        else if (cs.textAlign === "center") d.cell.styles.halign = "center";
        if (d.section === "body") {
          if ((parseInt(cs.fontWeight, 10) || 400) >= 600) d.cell.styles.fontStyle = "bold";
          const tr = el.parentElement;
          if (tr && (tr.style.background || tr.style.backgroundColor)) d.cell.styles.fillColor = GREY;
          if (el.classList.contains("doc-id")) d.cell.styles.font = "courier";
        }
      },
      didDrawPage: header,
    });
    y = doc.lastAutoTable.finalY + 18;
  }

  // Footers, now the page count is known.
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(200).setLineWidth(0.5).line(M, H - 36, W - M, H - 36);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
    doc.text(company, M, H - 24);
    doc.text("Printed " + fmtDate(todayISO()), W / 2, H - 24, { align: "center" });
    doc.text(`Page ${i} of ${n}`, W - M, H - 24, { align: "right" });
  }
  doc.setProperties({ title: title || "Report" });
  return { blob: doc.output("blob"), filename: filename || (title || "Report") + ".pdf" };
}
