import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal, Ico, ICONS } from "./ui.jsx";
import { saveBlob } from "../lib/saveFile.js";

// The iPad / iPhone end of Print (lib/printSupport.js): makes the document's
// PDF, then "Print…" opens the Share sheet with it — choose Print there. One
// instance, mounted by App, above any open document.
export default function IOSPrintHost({ toast }) {
  const [st, setSt] = useState(null);   // { busy } while the PDF is made, then { blob, filename }
  useEffect(() => {
    const on = async (e) => {
      setSt({ busy: true });
      try { setSt(await e.detail.build()); }
      catch (err) { setSt(null); toast?.("⚠ Couldn't make the PDF: " + (err.message || err)); }
    };
    window.addEventListener("ledger:share-print", on);
    return () => window.removeEventListener("ledger:share-print", on);
  }, [toast]);
  if (!st) return null;
  const share = async () => {
    const file = new File([st.blob], st.filename || "document.pdf", { type: "application/pdf" });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: st.filename }); setSt(null); return; }
    } catch (e) { if (e?.name === "AbortError") return; }
    // No Share sheet: open the PDF, whose own Share button has Print.
    window.open(URL.createObjectURL(st.blob), "_blank");
  };
  return createPortal(<div style={{ position: "relative", zIndex: 300 }}>
    <Modal title="Print" onClose={() => setSt(null)}
      foot={st.busy ? <button className="btn" onClick={() => setSt(null)}>Cancel</button> : <>
        <button className="btn" onClick={() => saveBlob(st.blob, st.filename)}><Ico d={ICONS.download} size={15} />Save PDF</button>
        <button className="btn primary" onClick={share}><Ico d={ICONS.print} size={15} />Print…</button></>}>
      {st.busy
        ? <p style={{ margin: 0 }}>Getting it ready to print…</p>
        : <p style={{ margin: 0 }}><b>{st.filename}</b> is ready. Tap <b>Print…</b>, then choose <b>Print</b> in the share sheet (or Save to Files, Mail, AirDrop).</p>}
    </Modal>
  </div>, document.body);
}
