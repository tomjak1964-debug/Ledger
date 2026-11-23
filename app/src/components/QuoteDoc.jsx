import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { printPdf, isIOS } from "../lib/printSupport.js";
import { pagesToPdf, saveBlob } from "../lib/saveFile.js";
import { money, fmtDate } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { termsLabelFor } from "../lib/terms.js";
import { personName, emailFor, proposalPerson, ccChoices } from "../lib/people.js";
import { proposalConfig } from "../calc/proposals.js";
import { docFooter } from "../views/Proposals.jsx";
import DocActions from "./DocActions.jsx";
import EmailModal from "./EmailModal.jsx";

// "QUO-261123-01 4769 Pass Demister" — the PDF's file name and the tab title.
export const quoteFileStem = q => [q.number, q.jobNumber, q.description].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, "-").trim();

// What a quote says, laid out as a proposal does: the scope is its line items,
// the Sales Notes and Clarifications are its notes (one per line), and the
// pricing is each line's amount to the total.
export function buildQuoteContent(q, db) {
  const s = db.settings;
  const cfg = proposalConfig(s, db.timeCategories);
  const customer = db.contacts.find(c => c.id === q.customerId);
  const personRec = proposalPerson(db, {}, customer);
  const name = (personName(personRec) || customer?.contact || "").trim();
  const custName = customer?.name || "Customer";
  const salutation = (() => {
    if (!name) return custName + " Team:";
    const parts = name.split(/\s+/);
    const title = /^(Mr|Ms|Mrs|Dr)\.?$/i.test(parts[0]) ? parts[0] + " " : "";
    return (title ? title + parts[parts.length - 1] : parts[parts.length - 1]) + ":";
  })();
  const items = (q.lineItems || []).filter(li => (li.desc || "").trim() || Number(li.unitPrice));
  const qtyOf = li => Number(li.qty) || 0;
  // A line's description can run to several lines: the first is the bullet, the rest sit under it.
  const scope = items.map(li => {
    const [first, ...rest] = String(li.desc || "").split("\n");
    return { t: (qtyOf(li) !== 1 ? `(${qtyOf(li)}${li.unit ? " " + li.unit : ""}) ` : "") + first.trim(), more: rest.join("\n").trim() };
  });
  const lines = items.map(li => ({ label: String(li.desc || "").split("\n")[0].trim() || "Item", amount: qtyOf(li) * (Number(li.unitPrice) || 0) }));
  const t = lineTotals(q.lineItems || [], q.taxRate);
  // The notes, one per line — a leading "1." or "-" typed into the note is dropped, the list numbers them.
  const notes = String(q.notes || s.quoteNotes || "").split("\n").map(x => x.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim()).filter(Boolean);
  const firm = q.expiryDate ? `This offer is firm until ${fmtDate(q.expiryDate)}.` : `This offer is firm for ${Number(cfg.validityDays) || 30} days from the date of this quote.`;
  return {
    cfg, customer, salutation, custName, scope, lines, notes, t,
    person: name ? { name, email: (personRec?.email || "").trim() || emailFor(db, q.customerId, "proposal") } : null,
    terms: `${firm} Terms shall be ${termsLabelFor(db, q.customerId)}. Any invoice more than 30 days past due will be assessed interest at the rate of 12% APR accruing monthly.`,
  };
}

// The quote on screen, with the standard toolbar (S2.2). Saved, printed and
// emailed copies are all the same PDF, with the company's address and
// "Page n of m" at the foot of every page.
export default function QuoteDoc({ q, db, onClose, toast, onEdit, onCopy, auto, onEmailed }) {
  const c = buildQuoteContent(q, db);
  const s = db.settings;
  const stem = quoteFileStem(q);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(auto === "email");
  // Out of .main and flagged, as every document overlay is; the tab title is the file name.
  useEffect(() => {
    const title = document.title;
    document.body.classList.add("doc-open");
    document.title = stem;
    return () => { document.body.classList.remove("doc-open"); document.title = title; };
  }, [stem]);
  const docRef = useRef();
  const buildPdf = () => pagesToPdf([...docRef.current.querySelectorAll(".prop-page")],
    { filename: stem + ".pdf", title: stem, fit: true, footer: docFooter(s) });
  const savePdf = async () => {
    setBusy(true);
    try { const { blob, filename } = await buildPdf(); saveBlob(blob, filename); }
    catch (e) { toast("⚠ Couldn't make the PDF: " + (e.message || e)); }
    setBusy(false);
  };
  const print = async () => {
    setBusy(true);
    try { await printPdf(buildPdf); }
    catch (e) { toast("⚠ Couldn't make the PDF: " + (e.message || e)); }
    setBusy(false);
  };
  // Opened from the list's Print or Save PDF: do that, then close.
  useEffect(() => {
    if (auto !== "print" && auto !== "pdf") return;
    const t = setTimeout(async () => {
      if (auto === "print") { await print(); if (isIOS()) return; } else await savePdf();
      onClose();
    }, 400);
    return () => clearTimeout(t);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const re = [q.jobNumber, q.description].filter(Boolean).join(" – ");
  return createPortal(<div className="doc-screen">
    <DocActions onClose={onClose} onEdit={onEdit} onCopy={onCopy} onEmail={() => setEmail(true)} onPrint={print} busy={busy}
      saves={[{ label: "Save PDF", hint: stem + ".pdf", run: savePdf }]} />
    {email && <EmailModal docType="proposal"
      title={"Email · " + q.number}
      defaultTo={c.person?.email || emailFor(db, q.customerId, "proposal")} ccChoices={ccChoices(db, [q.customerId])}
      defaultSubject={`Quote ${q.number}${re ? " — " + re : ""}`}
      defaultBody={`${c.salutation.replace(/:$/, ",")}\n\nPlease find attached quote ${q.number}${q.description ? " for " + q.description : ""}.\n\nRegards,\n${c.cfg.signer || s.company}`}
      buildAttachment={buildPdf}
      onSent={onEmailed}
      onClose={() => setEmail(false)} toast={toast} />}
    <div ref={docRef}>
      <div className="printable prop-doc prop-page">
        <div style={{ textAlign: "center", marginBottom: 26 }}><img src="/tmj-logo.png" alt="TMJ Engineering" style={{ width: 170 }} /></div>
        <p>{fmtDate(q.date)}</p>
        <p style={{ whiteSpace: "pre-line" }}>{[c.person?.name, c.customer?.name, c.customer?.address].filter(Boolean).join("\n")}</p>
        <p className="mono" style={{ marginTop: 18 }}>Quote: {q.number}{re && <><br />Re: {re}</>}</p>
        <p>{c.salutation}</p>
        <p>Thank you for giving {s.company || "us"} an opportunity to provide a quote{q.description ? ` for ${q.description}` : ""}.</p>
        <h4 style={{ margin: "14px 0 4px" }}>Scope</h4>
        <p style={{ marginTop: 0 }}>{s.company || "We"} will provide the following:</p>
        <ul className="prop-bullets">
          {c.scope.map((b, i) => <li key={i}>{b.t}{b.more && <div style={{ whiteSpace: "pre-line" }}>{b.more}</div>}</li>)}
        </ul>
      </div>
      <div className="printable prop-doc prop-page">
        {c.notes.length > 0 && <><h4 style={{ margin: "0 0 4px" }}>Sales Notes and Clarifications</h4>
          <ol className="prop-bullets">{c.notes.map((t, i) => <li key={i}>{t}</li>)}</ol></>}
        <div className="prop-price">
          <h4>Pricing</h4>
          <table><tbody>
            {c.lines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="amt">{money(l.amount)}</td></tr>)}
            {c.t.tax > 0.005 && <tr><td>Tax ({q.taxRate}%)</td><td className="amt">{money(c.t.tax)}</td></tr>}
            <tr className="tot"><td>Total Price for this quote is:</td><td className="amt">{money(c.t.total)}</td></tr>
          </tbody></table>
        </div>
        <p style={{ marginTop: 18 }}>{c.terms}</p>
        <p>I hope you find this offering favorable. If you have any questions, or require additional information, please feel free to contact me.</p>
        <p style={{ marginBottom: 34 }}>Regards,</p>
        <p>{c.cfg.signer || s.company}</p>
        <div className="doc-foot">{docFooter(s)}</div>
      </div>
    </div>
  </div>, document.body);
}
