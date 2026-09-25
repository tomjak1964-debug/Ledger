// Word (.docx) export of a proposal — mirrors the printable view, built with
// the docx package entirely in the browser.
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, LevelFormat, BorderStyle, Footer, UnderlineType,
} from "docx";
import { money, fmtDate } from "./helpers.js";
import { buildProposalContent } from "../views/Proposals.jsx";
import { buildControlsContent, revLabel } from "../views/ControlsEstimate.jsx";

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
  if (p.kind === "controls") return controlsDocxBlob(p, db);
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
  return { blob, filename: proposalFileStem(p) + ".docx" };
}

// The name a proposal is saved under, without extension — the Word download
// and the browser's Save-as-PDF suggestion (which takes document.title) both
// read it, so the two files sit together in a folder.
export const proposalFileStem = p =>
  `${p.number}${revLabel(p) ? " " + revLabel(p) : ""} - ${[p.jobNumber, p.description].filter(Boolean).join(" – ").replace(/[\\/:*?"<>|]/g, "-")}`;

/* ---------------- controls estimate ---------------- */

const H = text => new Paragraph({ spacing: { before: 200, after: 60 }, children: [new TextRun({ text, bold: true })] });
const cell = (text, width, { right = false, bold = false } = {}) => new TableCell({ width: { size: width, type: WidthType.DXA }, borders: NO_BORDERS,
  children: [new Paragraph({ spacing: { after: 20 }, alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold })] })] });
const plainRow = (label, amount, { bold = false, sub = "" } = {}) => new TableRow({ children: [
  cell(label + (sub ? "   " + sub : ""), 6000, { bold }), cell(money(amount), 2200, { right: true, bold }),
] });

async function controlsDocxBlob(p, db) {
  const c = buildControlsContent(p, db);
  const s = db.settings;
  const pr = c.pricing;
  const logo = await fetch("/tmj-logo.png").then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
  const bullet = (t, level = 0) => new Paragraph({ numbering: { reference: "scope", level }, spacing: { after: 40 }, children: [new TextRun(t)] });
  const numbered = (t, ref) => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 40 }, children: [new TextRun(t)] });
  const hrs = x => c.showHours && x.hours != null ? `(${x.hours} hr × ${money(x.rate)})` : "";
  const infoRow = (k, v) => new TableRow({ children: [cell(k, 1600), cell(v, 2600)] });

  const children = [
    ...(logo ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new ImageRun({ type: "png", data: logo, transformation: { width: 170, height: 112 } })] })] : []),
    P(fmtDate(p.date)),
    ...[c.person?.name, c.customer?.name, ...(c.customer?.address || "").split("\n")].filter(Boolean).map(t => P(t, { after: 0 })),
    new Paragraph({ spacing: { after: 120 } }),
    new Table({ width: { size: 4200, type: WidthType.DXA }, columnWidths: [1600, 2600], borders: NO_BORDERS, rows: [
      infoRow("Proposal:", p.number + (c.rev ? " " + c.rev : "")),
      ...(p.jobNumber ? [infoRow("Reference:", p.jobNumber)] : []),
      infoRow("Valid through:", fmtDate(c.terms.validThrough)),
      ...(c.cfg.signer ? [infoRow("Prepared by:", c.cfg.signer)] : []),
    ] }),
    P("Re: " + c.reLine, { before: 160 }),
    P(c.salutation),
    P(`Thank you for the opportunity to provide a proposal for controls engineering services${c.hardware.length ? " and control hardware" : ""} for ${p.description || "this project"}${p.location ? ` at ${p.location}` : ""}.`),
    ...(c.basis.length || c.content ? [H("Basis of Estimate"),
      ...(c.basis.length ? [new Table({ width: { size: 8000, type: WidthType.DXA }, columnWidths: [2000, 6000], borders: NO_BORDERS,
        rows: c.basis.map(([k, v]) => new TableRow({ children: [cell(k, 2000), cell(v, 6000)] })) })] : []),
      ...(c.content ? [P("Priced for: " + c.content + ".", { before: 60 })] : [])] : []),
    H("Scope of Work"),
    P(`${s.company || "We"} will provide the following:`),
    ...c.scope.flatMap(sc => [new Paragraph({ spacing: { before: 80, after: 20 }, children: [new TextRun({ text: sc.label, bold: true })] }), ...sc.deliverables.map(d => bullet(d))]),
    ...(c.hardware.length ? [new Paragraph({ spacing: { before: 80, after: 20 }, children: [new TextRun({ text: "Hardware Supplied", bold: true })] }),
      ...c.hardware.map(h => bullet(`(${Number(h.qty) || 0}) ${h.desc}`))] : []),
    ...(c.assumptions.length ? [H("Assumptions and Clarifications"), ...c.assumptions.map(t => numbered(t, "assume"))] : []),
    ...(c.exclusions.length ? [H("Exclusions"), ...c.exclusions.map(t => numbered(t, "exclude"))] : []),
    H("Pricing"),
    priceTable([...pr.engineering.map(x => plainRow(x.label, x.amount, { sub: hrs(x) })), priceRow("Engineering Sub Total", pr.engineeringTotal, { bold: true })]),
    ...(pr.field.length ? [new Paragraph({ spacing: { after: 80 } }),
      priceTable([...pr.field.map(x => plainRow(x.label + (x.detail ? " — " + x.detail : ""), x.amount, { sub: hrs(x) })), priceRow("Field Services Sub Total", pr.fieldTotal, { bold: true })])] : []),
    ...(c.hardware.length ? [new Paragraph({ spacing: { after: 80 } }),
      priceTable([...pr.hardware.map(h => plainRow(`(${Number(h.qty) || 0}) ${h.desc}`, h.amount)), priceRow("Hardware Sub Total", pr.hardwareTotal, { bold: true })])] : []),
    new Paragraph({ spacing: { after: 80 } }),
    priceTable([...(pr.contingency > 0 ? [plainRow("Contingency", pr.contingency)] : []), priceRow("Total Price for this proposal is:", pr.total, { bold: true })]),
    ...(c.options.length ? [H("Options — priced separately, not included above"), priceTable(c.options.map(o => plainRow(o.desc, o.amount)))] : []),
    ...(c.schedule.length ? [H("Schedule"), new Table({ width: { size: 7000, type: WidthType.DXA }, columnWidths: [4600, 2400], borders: NO_BORDERS,
      rows: c.schedule.map(m => new TableRow({ children: [cell(m.label, 4600), cell(`week ${m.weeks} from award`, 2400, { right: true })] })) })] : []),
    H("Invoicing Schedule"),
    new Table({ width: { size: 7000, type: WidthType.DXA }, columnWidths: [3600, 1200, 2200], borders: NO_BORDERS,
      rows: c.phases.map(ph => new TableRow({ children: [cell(ph.label, 3600), cell(ph.pct + "%", 1200, { right: true }), cell(money(ph.amount), 2200, { right: true })] })) }),
    H("Terms"),
    P(`This offer is firm for ${c.terms.validityDays} days from the date of this proposal. Payment terms are ${c.terms.payment}. Engineering and support beyond the scope above is available at $${c.terms.supportRate}/hour U.S. plus actual expenses. Any invoice more than 30 days past due will be assessed interest at the rate of 12% APR accruing monthly.`),
    P("I hope you find this offering favorable. If you have any questions, or require additional information, please feel free to contact me."),
    P("Regards,", { after: 480 }),
    P(c.cfg.signer || s.company || ""),
    new Paragraph({ spacing: { before: 360, after: 80 }, children: [new TextRun({ text: "Acceptance", bold: true })] }),
    new Table({ width: { size: 8200, type: WidthType.DXA }, columnWidths: [4100, 4100], borders: NO_BORDERS, rows: [
      new TableRow({ children: [cell("Accepted by: ______________________________", 4100), cell("Title: ______________________________", 4100)] }),
      new TableRow({ children: [cell("Date: ______________________________", 4100), cell("Purchase Order No.: __________________", 4100)] }),
    ] }),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 22 } } } },
    numbering: { config: [
      { reference: "scope", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "o", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ] },
      ...["assume", "exclude"].map(reference => ({ reference, levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ] })),
    ] },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
      footers: { default: new Footer({ children: [P([s.companyAddress?.replace(/\n/g, ", "), s.companyPhone].filter(Boolean).join(" - "), { align: AlignmentType.CENTER, after: 0 })] }) },
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  return { blob, filename: proposalFileStem(p) + ".docx" };
}

export async function downloadProposalDocx(p, db) {
  const { blob, filename } = await proposalDocxBlob(p, db);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
