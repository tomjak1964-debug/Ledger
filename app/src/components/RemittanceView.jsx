import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { money, fmtDate } from "../lib/helpers.js";
import { remittancePdf } from "../lib/remittance.js";
import { remitEmail } from "../lib/checks.js";
import { saveBlob } from "../lib/saveFile.js";
import DocActions from "./DocActions.jsx";
import EmailModal from "./EmailModal.jsx";

// A remittance advice on screen, with the same toolbar as every document:
// Email (to the vendor's remittance contact), Print (the printer dialog for
// the PDF itself), Save (the PDF, named "<Vendor> Remittance - <Ref>") and
// Edit (the payment). args: { payment, vendor, lines, settings }.
export default function RemittanceView({ args, onClose, onEdit, toast }) {
  const { blob, filename } = useMemo(() => remittancePdf(args), [args]);
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const frame = useRef();
  const [email, setEmail] = useState(false);
  useEffect(() => {
    document.body.classList.add("doc-open");
    return () => document.body.classList.remove("doc-open");
  }, []);
  const s = args.settings || {};
  const { payment, vendor } = args;
  const print = () => {
    // The PDF's own print, so the page prints exactly as it saves.
    try { frame.current.contentWindow.focus(); frame.current.contentWindow.print(); }
    catch { window.open(url, "_blank"); }
  };
  return createPortal(<div className="doc-screen">
    <DocActions onClose={onClose} onEdit={onEdit} onEmail={() => setEmail(true)} onPrint={print}
      saves={[{ label: "Save PDF", hint: filename, run: () => saveBlob(blob, filename) }]} />
    {email && <EmailModal docType="remittance"
      title={"Email Remittance · " + (vendor?.name || "")}
      defaultTo={remitEmail(vendor)}
      defaultSubject={`Remittance advice — ${money(payment.amount)} from ${s.company}`}
      defaultBody={`Please find attached remittance advice for our payment of ${money(payment.amount)} dated ${fmtDate(payment.date)}${payment.ref ? ` (reference ${payment.ref})` : ""}.\n\n${s.company}`}
      buildAttachment={() => Promise.resolve({ blob, filename })}
      onClose={() => setEmail(false)} toast={toast} />}
    <iframe ref={frame} title={filename} src={url} className="remit-frame" />
  </div>, document.body);
}
