// Excel export (app standards S3.11): a real .xlsx, made with ExcelJS loaded only
// when someone exports. The sheet is what's on screen — the rows the view hands
// over, already sorted and filtered — with a title line naming the list and its
// filters, a navy heading row that stays put and filters, money and counts as
// numbers and dates as dates. Named "<List> YYYY-MM-DD.xlsx".
import { todayISO } from "./helpers.js";
import { saveBlob } from "./saveFile.js";

const NAVY = "FF13233B";
const MONEY = /^-?\d+\.\d{2}$/, INT = /^-?(0|[1-9]\d{0,14})$/, ISO = /^\d{4}-\d{2}-\d{2}$/;
// A value as Excel should hold it: "1234.50" a number to two places, "4870" a
// whole number, "2026-11-14" a date; anything else (INV-…, 0042, names) text.
export function cellValue(v) {
  if (v == null || v === "") return { value: null };
  if (typeof v === "number") return { value: v, fmt: Number.isInteger(v) ? "0" : "#,##0.00" };
  const s = String(v);
  if (MONEY.test(s)) return { value: Number(s), fmt: "#,##0.00" };
  if (INT.test(s)) return { value: Number(s), fmt: "0" };
  if (ISO.test(s)) { const [y, m, d] = s.split("-").map(Number); return { value: new Date(Date.UTC(y, m - 1, d)), fmt: "mmm d, yyyy" }; }
  return { value: s };
}
// "aged-receivables-detail" → "Aged Receivables Detail"
export const listTitle = name => String(name || "Export").replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());

export async function downloadXlsx(name, header, rows, { title = "" } = {}) {
  const { default: ExcelJS } = await import("exceljs");
  const list = listTitle(name);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(list.slice(0, 31));
  ws.addRow([title ? `${list} — ${title}` : list]).font = { bold: true, size: 13 };
  const head = ws.addRow(header);
  head.eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; });
  rows.forEach(r => {
    const row = ws.addRow(r.map(v => cellValue(v).value));
    r.forEach((v, i) => { const f = cellValue(v).fmt; if (f) row.getCell(i + 1).numFmt = f; });
  });
  ws.views = [{ state: "frozen", ySplit: 2 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: header.length } };
  header.forEach((h, i) => {
    const longest = Math.max(String(h).length, ...rows.slice(0, 500).map(r => String(r[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(48, Math.max(9, longest + 2));
  });
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${list} ${todayISO()}.xlsx`);
}
