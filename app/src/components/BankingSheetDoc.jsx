import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtDate, todayISO } from "../lib/helpers.js";
import DocActions from "./DocActions.jsx";
import EmailModal from "./EmailModal.jsx";
import { pagesToPdf, saveBlob } from "../lib/saveFile.js";

// The banking information sheet: how customers pay us — ACH, wire, check — on
// the letterhead, from settings.banking (Settings → Company → Banking
// Information). One Letter page like the rate sheet: Print, Save PDF, Email
// (from invoices@, as billing). A field left blank is left off the sheet.
// `info` is the bank_info row (migration 037) — only there for someone with the
// Banking permission; without it the sheet has no numbers to print.
export const bankingConfig = (s, info) => {
  const b = info || {};
  return {
    effectiveDate: b.effectiveDate || todayISO(),
    bankName: b.bankName || "", bankAddress: b.bankAddress || "", bankPhone: b.bankPhone || "",
    accountName: b.accountName || s?.company || "", accountType: b.accountType || "Business Checking",
    accountNumber: b.accountNumber || "", achRouting: b.achRouting || "", wireRouting: b.wireRouting || "", swift: b.swift || "",
    payableTo: b.payableTo || s?.company || "", remitAddress: b.remitAddress || s?.companyAddress || "",
    arName: b.arName || "", arEmail: b.arEmail || s?.companyEmail || "", arPhone: b.arPhone || s?.companyPhone || "",
    taxId: b.taxId || "", notes: b.notes || "",
  };
};

export default function BankingSheetDoc({ settings, bankInfo, onClose, toast }) {
  const s = settings || {};
  const b = bankingConfig(s, bankInfo);
  const stem = `${s.company || "Company"} Banking Information`;
  const page = useRef();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(false);
  useEffect(() => {
    const title = document.title;
    document.body.classList.add("doc-open");
    document.title = stem;
    return () => { document.body.classList.remove("doc-open"); document.title = title; };
  }, [stem]);
  const pdf = () => pagesToPdf([page.current], { filename: stem + ".pdf", title: stem, fit: true });
  const savePdf = async () => {
    setBusy(true);
    try { const { blob, filename } = await pdf(); saveBlob(blob, filename); }
    catch (e) { toast?.("⚠ Couldn't make the PDF: " + (e.message || e)); }
    setBusy(false);
  };
  const missing = !b.bankName || !b.accountNumber || !b.achRouting;

  return createPortal(<div className="doc-screen">
    <DocActions onClose={onClose} onEmail={() => setEmail(true)} onPrint={() => window.print()} busy={busy}
      saves={[{ label: "Save PDF", hint: stem + ".pdf", run: savePdf }]} />
    {missing && <div className="no-print" style={{ maxWidth: 816, margin: "0 auto 10px", padding: "10px 14px", background: "var(--warn-wash)", borderRadius: 9 }}>
      The bank name, account number and ACH routing number aren't all filled in yet — add them under <b>Settings → Company → Banking Information</b> (it takes the Banking permission to see or change them).</div>}
    {email && <EmailModal docType="banking" fromChoice title="Email · Banking Information" defaultTo=""
      defaultSubject={`${s.company || ""} — banking and payment information`}
      defaultBody={`Hello,\n\nPlease find attached our banking information for payments by ACH, wire or check.\n\nFor your security, please confirm any change to these instructions by phone at ${b.arPhone || s.companyPhone || "our office"} before sending a payment — we will never change our banking details by email alone.\n\nRegards,\n${s.company || ""}\n${s.companyPhone || ""}`}
      buildAttachment={pdf} onClose={() => setEmail(false)} toast={toast || (() => {})} />}
    <BankingSheet settings={s} bankInfo={bankInfo} pageRef={page} />
  </div>, document.body);
}

// The page itself — rendered by BankingSheetDoc, and printable on its own.
export function BankingSheet({ settings, bankInfo, pageRef }) {
  const s = settings || {};
  const b = bankingConfig(s, bankInfo);
  const Row = ({ k, v, mono }) => v ? <tr><td className="bk-k">{k}</td><td className={mono ? "mono" : undefined} style={{ whiteSpace: "pre-line" }}>{v}</td></tr> : null;
  const wire = b.wireRouting || b.swift;
  return (
    <div className="printable rate-sheet banking-sheet" ref={pageRef}>
      <div className="doc-top">
        <div className="doc-co">
          <img src="/tmj-logo.png" alt={s.company || ""} style={{ width: 150, display: "block", marginBottom: 10 }} />
          <div className="co-meta">{[s.company, s.companyAddress, s.companyPhone, s.companyEmail].filter(Boolean).join("\n")}</div>
        </div>
        <div className="doc-title">
          <div className="t">Banking Information</div>
          <div className="n" style={{ fontFamily: "Inter, sans-serif" }}>Remittance &amp; Payment Instructions</div>
          <div className="n" style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "#6b7280" }}>Effective {fmtDate(b.effectiveDate)}</div>
        </div>
      </div>

      <div className="rs-section">
        <h4>ACH / Electronic Payment</h4>
        <table className="bk-table"><tbody>
          <Row k="Bank" v={[b.bankName, b.bankAddress].filter(Boolean).join("\n")} />
          <Row k="Account name" v={b.accountName} />
          <Row k="Account type" v={b.accountType} />
          <Row k="Routing number (ACH)" v={b.achRouting} mono />
          <Row k="Account number" v={b.accountNumber} mono />
        </tbody></table>
      </div>

      {wire && <div className="rs-section">
        <h4>Wire Transfer</h4>
        <table className="bk-table"><tbody>
          <Row k="Routing number (wire)" v={b.wireRouting} mono />
          <Row k="SWIFT / BIC (international)" v={b.swift} mono />
          <Row k="Beneficiary" v={b.accountName} />
          <Row k="Beneficiary account" v={b.accountNumber} mono />
        </tbody></table>
      </div>}

      <div className="rs-section">
        <h4>Payment by Check</h4>
        <table className="bk-table"><tbody>
          <Row k="Make checks payable to" v={b.payableTo} />
          <Row k="Mail to" v={b.remitAddress} />
        </tbody></table>
      </div>

      <div className="rs-section">
        <h4>Remittance Advice &amp; Questions</h4>
        <ul>
          <li>Please send remittance detail — the invoice numbers being paid — {b.arEmail ? <>to <b>{b.arEmail}</b></> : "with each payment"}.</li>
          {(b.arName || b.arPhone) && <li>Accounts receivable: {[b.arName, b.arPhone].filter(Boolean).join(" · ")}</li>}
          {b.taxId && <li>Federal tax ID (EIN): <span className="mono">{b.taxId}</span>. A W-9 is available on request.</li>}
          {b.notes && <li style={{ whiteSpace: "pre-line" }}>{b.notes}</li>}
        </ul>
      </div>

      <div className="bk-warn">
        <b>Protect your payment.</b> {s.company || "We"} will never change our banking instructions by email alone. If you receive a request to
        send payment to a different account, please call us at {b.arPhone || s.companyPhone || "our office"} to verify it before sending any payment.
      </div>
    </div>
  );
}
