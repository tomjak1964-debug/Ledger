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
  if (!isIOS() || !build) { fallback(); return; }
  window.dispatchEvent(new CustomEvent("ledger:share-print", { detail: { build } }));
}
