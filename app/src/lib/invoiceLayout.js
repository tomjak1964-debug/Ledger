// Invoice pagination — shared by the printable invoice (DocumentView) and the
// PDF (invoicePdf), so both break onto new pages in exactly the same places.
//
// An invoice always prints as full pages: the frame is a fixed height, the
// items box is ruled all the way down whether it holds two lines or twenty,
// and the totals sit at the bottom of the last page. Lines that don't fit
// carry to the next page, which is framed the same way.

// Characters that fit across the Description column at 9pt Helvetica.
export const DESC_CHARS = 52;
// Text lines the items box holds, and what a row costs on top of its text
// (cell padding). A page carrying the totals box has room for 13 single-line
// rows; a page that only says "continued" has room for 19. Measured against
// the printable invoice, which is the tighter of the two renderers.
export const PAGE_LINES = 22;
export const PAGE_LINES_FULL = 31;
const ROW_OVERHEAD = 0.6;

// Description as printed lines: hard breaks the user typed, then word wrap.
// Before descriptions could hold real line breaks, " — " was how a second line
// was faked; it still reads as one, but only where the text has no real break
// of its own — so an em dash in a typed multi-line description stays inline.
export function descLines(desc, max = DESC_CHARS) {
  const text = String(desc ?? "");
  const raw = text.includes("\n") ? text : text.replace(/ — /g, "\n");
  const out = [];
  raw.split("\n").forEach(para => {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); return; }
    let line = "";
    words.forEach(word => {
      let w = word;
      while (w.length > max) {                 // a word wider than the column
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, max));
        w = w.slice(max);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= max) line += " " + w;
      else { out.push(line); line = w; }
    });
    if (line) out.push(line);
  });
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out.length ? out : ["—"];
}

// A line item as it prints: qty/price/amount plus its wrapped description.
// qty 0 is an unbilled reference line — price, no amount (CLAUDE.md §8).
export function invoiceRows(lineItems) {
  return (lineItems || []).map(it => {
    const qty = Number(it.qty) || 0;
    const price = Number(it.unitPrice) || 0;
    return { qty, price, amount: qty * price, billed: qty > 0, lines: descLines(it.desc) };
  });
}

// Rows grouped into pages. A row never straddles a page break unless its
// description alone is taller than a page, in which case it continues with
// the numbers left off the continuation. The last page holds fewer rows,
// because that is the page the totals box sits on.
export function paginateRows(rows, budget = PAGE_LINES_FULL, lastBudget = PAGE_LINES) {
  const maxLines = Math.floor(lastBudget - ROW_OVERHEAD);
  const cost = r => r.lines.length + ROW_OVERHEAD;
  // round the running total: 15 rows at 1.6 is 24.000000000000004 in floats,
  // which would spill a row off a page that fits it exactly.
  const used = pg => Math.round(pg.reduce((t, r) => t + cost(r), 0) * 100) / 100;
  const pages = [[]];
  const push = (row) => {
    if (used(pages[pages.length - 1]) + cost(row) > budget && pages[pages.length - 1].length) pages.push([]);
    pages[pages.length - 1].push(row);
  };
  rows.forEach(row => {
    if (row.lines.length <= maxLines) { push(row); return; }
    for (let i = 0; i < row.lines.length; i += maxLines) {
      const chunk = row.lines.slice(i, i + maxLines);
      push(i === 0 ? { ...row, lines: chunk } : { qty: 0, price: null, amount: 0, billed: false, lines: chunk });
    }
  });
  // Make room for the totals box: spill whatever doesn't fit onto a new page.
  while (used(pages[pages.length - 1]) > lastBudget && pages[pages.length - 1].length > 1) {
    const pg = pages[pages.length - 1];
    const carry = [];
    while (pg.length > 1 && used(pg) > lastBudget) carry.unshift(pg.pop());
    pages.push(carry);
  }
  return pages;
}

export const invoicePages = (lineItems) => paginateRows(invoiceRows(lineItems));
