// Word (.docx) export of a proposal — mirrors the printable view, built with
// the docx package entirely in the browser.
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, LevelFormat, BorderStyle, Footer, UnderlineType,
} from "docx";
import { money, fmtDate } from "./helpers.js";
import { buildProposalContent } from "../views/Proposals.jsx";

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 120 },
  alignment: opts.align,
  children: [new TextRun({ text, bold: opts.bold, underline: opts.ul ? { type: UnderlineType.SINGLE } : undefined })],
});

const priceRow = (label, amount, { bold = false } = {}) => new TableRow({
  children: [
    new TableCell({ width: { size: 6000, type: WidthType.DXA }, borders: NO_BORDERS, children: [new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: label, bold })] })] }),
    new TableCell({ width: { size: 2200, type: WidthType.DXA }, borders: NO_BORDERS, children: [new Paragraph({ spacing: { after: 20 }, alignment: AlignmentType.RIGHT, children: [new TextRun({ text: money(amount), bold: true, underline: { type: UnderlineType.SINGLE } })] })] }),
  ],
});

const priceTable = rows => new Table({ width: { size: 8200, type: WidthType.DXA }, columnWidths: [6000, 2200], borders: NO_BORDERS, rows });

export async function proposalDocxBlob(p, db) {
  const c = buildProposalContent(p, db);
  const s = db.settings;
  const logo = await fetch("/tmj-logo.png").then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);

  const bullets = c.bullets.map(b => new Paragraph({
    numbering: { reference: "scope", level: b.sub ? 1 : 0 },
    spacing: { after: 40 },
    children: [new TextRun(b.t)],
  }));
  const notes = c.salesNotes.map(t => new Paragraph({
    numbering: { reference: "notes", level: 0 },
    spacing: { after: 40 },
    children: [new TextRun(t)],
  }));

  const schedRows = c.phases.map(ph => new TableRow({
    children: [
      new TableCell({ width: { size: 3600, type: WidthType.DXA }, borders: NO_BORDERS, children: [new Paragraph({ spacing: { after: 20 }, children: [new TextRun(ph.label)] })] }),
      new TableCell({ width: { size: 1200, type: WidthType.DXA }, borders: NO_BORDERS, children: [new Paragraph({ spacing: { after: 20 }, alignment: AlignmentType.RIGHT, children: [new TextRun(ph.pct + "%")] })] }),
      new TableCell({ width: { size: 2200, type: WidthType.DXA }, borders: NO_BORDERS, children: [new Paragraph({ spacing: { after: 20 }, alignment: AlignmentType.RIGHT, children: [new TextRun(money(ph.amount))] })] }),
    ],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 22 } } } },
    numbering: {
      config: [
        { reference: "scope", levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "o", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        ]},
        { reference: "notes", levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ]},
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
      footers: { default: new Footer({ children: [P([s.companyAddress?.replace(/\n/g, ", "), s.companyPhone].filter(Boolean).join(" - "), { align: AlignmentType.CENTER, after: 0 })] }) },
      children: [
        ...(logo ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new ImageRun({ type: "png", data: logo, transformation: { width: 170, height: 112 } })] })] : []),
        P(fmtDate(p.date)),
        ...[c.person?.name, c.customer?.name, ...(c.customer?.address || "").split("\n")].filter(Boolean).map(t => P(t, { after: 0 })),
        P("", { after: 60 }),
        P("Proposal: " + p.number, { after: 0 }),
        P("Re: " + [p.jobNumber, p.description].filter(Boolean).join(" – ")),
        P(c.salutation),
        P(`Thank you for giving ${s.company || "us"} an opportunity to provide a proposal for services and deliverables for Turnkey Controls for (1) Assembly Machine.`),
        P("Scope", { bold: true, after: 40 }),
        P(`${s.company || "We"} will provide design services with the following deliverables:`),
        ...bullets,
        P("", { after: 60 }),
        P("Sales Notes and Clarifications", { bold: true, ul: true, after: 40 }),
        ...notes,
        P("", { after: 60 }),
        P("Base Pricing", { bold: true, ul: true, after: 40 }),
        priceTable([
          ...c.pricing.baseLines.map(l => priceRow(l.label, l.amount)),
          priceRow("Base Price Sub Total", c.pricing.base, { bold: true }),
        ]),
        P("", { after: 20 }),
        P("Premium Pricing", { bold: true, ul: true, after: 40 }),
        priceTable([
          ...c.pricing.premiumLines.map(l => priceRow(l.label, l.amount)),
          priceRow("Premium Price Sub Total", c.pricing.premium, { bold: true }),
        ]),
        P("", { after: 20 }),
        priceTable([priceRow("Total Price for this proposal is:", c.pricing.total, { bold: true })]),
        P("", { after: 20 }),
        P("Invoicing Schedule", { bold: true, ul: true, after: 40 }),
        P("Project will be invoiced according to the following invoicing schedule", { after: 40 }),
        new Table({ width: { size: 7000, type: WidthType.DXA }, columnWidths: [3600, 1200, 2200], borders: NO_BORDERS, rows: schedRows }),
        P("", { after: 60 }),
        P("This offer is firm for 30 days from the date of this proposal. Terms shall be Net 30 Days. Any invoice more than 30 days past due will be assessed interest at the rate of 12% APR accruing monthly."),
        P("I hope you find this offering favorable. If you have any questions, or require additional information, please feel free to contact me."),
        P("Regards,", { after: 360 }),
        P(c.cfg.signer || s.company || ""),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${p.number} - ${[p.jobNumber, p.description].filter(Boolean).join(" – ").replace(/[\\/:*?"<>|]/g, "-")}.docx`;
  return { blob, filename };
}

export async function downloadProposalDocx(p, db) {
  const { blob, filename } = await proposalDocxBlob(p, db);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
