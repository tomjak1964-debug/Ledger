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
export async function pagesToPdf(elements, { filename, title, fit = true, margin = 0.5 } = {}) {
  const [{ jsPDF }, html2canvas] = await Promise.all([import("jspdf"), import("html2canvas").then(m => m.default)]);
  const pdf = new jsPDF({ unit: "in", format: "letter" });
  const W = 8.5 - 2 * margin, H = 11 - 2 * margin;
  let first = true;
  for (const el of elements) {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const ratio = canvas.height / canvas.width;
    if (fit || W * ratio <= H) {
      const w = W * ratio > H ? H / ratio : W, h = w * ratio;
      if (!first) pdf.addPage();
      pdf.addImage(img, "JPEG", margin + (W - w) / 2, margin, w, h);
      first = false;
    } else {
      // Run on: slice the canvas into page-high strips.
      const sliceH = Math.floor(canvas.width * (H / W));
      for (let y = 0; y < canvas.height; y += sliceH) {
        const part = document.createElement("canvas");
        part.width = canvas.width; part.height = Math.min(sliceH, canvas.height - y);
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
