// Saving a document to the user's computer under a name of its own, never
// "download" or a blob id. A browser set to ask where to save shows this name
// in the dialog; otherwise it lands in Downloads under it.
export function saveBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// Turn on-screen document pages into a PDF, one Letter page per element.
// fit: shrink an element that's taller than a page so it stays one page (the
// rate sheet, each half of a fixture proposal); otherwise a long element runs
// on over as many pages as it needs. html2canvas ships with jsPDF.
// `width` lays the element out at that many CSS px before it is drawn — a report
// on an iPad is narrower than the page, and its tables scroll sideways in their
// card, so drawn as shown the right-hand columns were cut off. The copy drawn is
// laid out as on a desktop (windowWidth), with nothing inside it scrolling or
// clipped; the page on screen isn't touched.
export async function pagesToPdf(elements, { filename, title, fit = true, margin = 0.5, width } = {}) {
  const [{ jsPDF }, html2canvas] = await Promise.all([import("jspdf"), import("html2canvas").then(m => m.default)]);
  const pdf = new jsPDF({ unit: "in", format: "letter" });
  const W = 8.5 - 2 * margin, H = 11 - 2 * margin;
  let first = true;
  for (const el of elements) {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
      ignoreElements: n => !!n.classList?.contains("no-print"),
      windowWidth: Math.max(1280, (width || 0) + 160),
      onclone: (_doc, copy) => {
        if (width) { copy.style.width = width + "px"; copy.style.maxWidth = "none"; }
        [copy, ...copy.querySelectorAll("*")].forEach(n => {
          const cs = _doc.defaultView.getComputedStyle(n);
          if (cs.overflowX !== "visible" || cs.overflowY !== "visible") { n.style.overflow = "visible"; n.style.maxHeight = "none"; }
        });
      } });
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const ratio = canvas.height / canvas.width;
    if (fit || W * ratio <= H) {
      const w = W * ratio > H ? H / ratio : W, h = w * ratio;
      if (!first) pdf.addPage();
      pdf.addImage(img, "JPEG", margin + (W - w) / 2, margin, w, h);
      first = false;
    } else {
      // Run on: slice the canvas into page-high strips, each ending on a clean
      // line — a blank band or a row's rule — so no row of text is cut in two.
      const sliceH = Math.floor(canvas.width * (H / W));
      const ctx = canvas.getContext("2d");
      const cleanCut = (from, to) => {
        // Search upward from `to` (at most the bottom sixth of the page) for a
        // pixel row of one colour.
        const top = Math.max(from + Math.floor(sliceH * 0.83), 0);
        if (to >= canvas.height) return canvas.height;
        // The middle of the width only: a card's border runs down both edges.
        const x0 = Math.floor(canvas.width * 0.04), cw = canvas.width - 2 * x0;
        const data = ctx.getImageData(x0, top, cw, to - top).data, w = cw * 4;
        for (let r = to - top - 1; r >= 0; r--) {
          const o = r * w, r0 = data[o], g0 = data[o + 1], b0 = data[o + 2];
          let same = true;
          for (let i = o; i < o + w; i += 16) if (Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) > 24) { same = false; break; }
          if (same) return top + r + 1;
        }
        return to;
      };
      for (let y = 0, next; y < canvas.height; y = next) {
        next = cleanCut(y, Math.min(y + sliceH, canvas.height));
        if (next <= y) next = Math.min(y + sliceH, canvas.height);
        const part = document.createElement("canvas");
        part.width = canvas.width; part.height = next - y;
        part.getContext("2d").drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
        if (!first) pdf.addPage();
        pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, W, W * part.height / canvas.width);
        first = false;
      }
    }
  }
  if (title) pdf.setProperties({ title });
  return { blob: pdf.output("blob"), filename };
}
