// Printing on an iPad or iPhone. iOS ignores the page's print command in a
// home-screen app (and often in Safari too), so there Print makes the PDF the
// document already saves and hands it to the Share sheet, which has Print —
// and Save to Files, Mail, AirDrop. Everywhere else it is the browser's own
// print, unchanged. The PDF is made first and the Share sheet opened from a
// tap on "Print…" in IOSPrintHost (components/IOSPrintHost.jsx), because iOS
// only opens it straight from a tap.
export function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// build: () => Promise<{ blob, filename }> — the document's PDF.
export function printOrShare(build, fallback = () => window.print()) {
  if (!isIOS() || !build) return fallback();
  window.dispatchEvent(new CustomEvent("ledger:share-print", { detail: { build } }));
}

// Print the document's own PDF, so the paper matches the saved copy page for
// page — footer and "Page n of m" included (proposals and quotes). On an iPad
// it goes to the Share sheet as above; elsewhere the PDF loads in a hidden
// frame and that frame prints. Resolves once the PDF is made, so a document
// opened just to print can close after it.
export function printPdf(build) {
  return printOrShare(build, async () => {
    const { blob, filename } = await build();
    const url = URL.createObjectURL(blob);
    const f = document.createElement("iframe");
    f.title = filename || "Print";
    f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
    f.onload = () => setTimeout(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, "_blank"); }
    }, 150);
    f.src = url;
    document.body.appendChild(f);
    setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120000);
  });
}
