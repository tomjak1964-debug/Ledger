import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { saveBlob } from "../lib/saveFile.js";
import DocActions from "./DocActions.jsx";

// A ready-made PDF on screen with Print (the PDF's own print, so it prints
// exactly as it saves) and Save. autoPrint opens the printer dialog as soon
// as it has loaded; onPrinted runs whenever Print is used.
export default function PdfView({ blob, filename, onClose, onPrinted, autoPrint }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const frame = useRef();
  useEffect(() => {
    document.body.classList.add("doc-open");
    return () => document.body.classList.remove("doc-open");
  }, []);
  const print = () => {
    onPrinted?.();
    try { frame.current.contentWindow.focus(); frame.current.contentWindow.print(); }
    catch { window.open(url, "_blank"); }
  };
  return createPortal(<div className="doc-screen">
    <DocActions onClose={onClose} onPrint={print} saves={[{ label: "Save PDF", hint: filename, run: () => saveBlob(blob, filename) }]} />
    <iframe ref={frame} title={filename} src={url} className="remit-frame"
      onLoad={autoPrint ? () => setTimeout(print, 300) : undefined} />
  </div>, document.body);
}
