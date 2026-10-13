import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { money, fmtDate } from "../lib/helpers.js";
import { rateSheetConfig, rateRows, multLabel } from "../lib/rateSheet.js";
import DocActions from "./DocActions.jsx";
import EmailModal from "./EmailModal.jsx";
import { pagesToPdf, saveBlob } from "../lib/saveFile.js";

// The printable rate sheet. Like the other documents it is portalled out of
// .main and flags the body, so printing shows only the sheet; the tab title
// becomes the file name Save PDF offers.
export default function RateSheetDoc({ settings, timeCategories, onClose, toast }) {
  const s = settings || {};
  const rs = rateSheetConfig(s);
  const rows = rateRows(s, timeCategories);
  const year = rs.effectiveDate.slice(0, 4);
  const stem = `${s.company || "Rate Sheet"} Rate Sheet ${year}`;
  const page = useRef();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(false);
  useEffect(() => {
    const title = document.title;
    document.body.classList.add("doc-open");
    document.title = stem;
    return () => { document.body.classList.remove("doc-open"); document.title = title; };
  }, [stem]);
  // One Letter page, whatever the screen: the PDF shrinks the sheet to fit.
  const pdf = () => pagesToPdf([page.current], { filename: stem + ".pdf", title: stem, fit: true });
  const savePdf = async () => {
    setBusy(true);
    try { const { blob, filename } = await pdf(); saveBlob(blob, filename); }
    catch (e) { toast?.("⚠ Couldn't make the PDF: " + (e.message || e)); }
    setBusy(false);
  };

  return createPortal(<div className="doc-screen">
    <DocActions onClose={onClose} onEmail={() => setEmail(true)} onPrint={() => window.print()} busy={busy}
      saves={[{ label: "Save PDF", hint: stem + ".pdf", run: savePdf }]} />
    {email && <EmailModal docType="proposal" title="Email · Rate Sheet" defaultTo=""
      defaultSubject={`${s.company || ""} rate sheet — effective ${fmtDate(rs.effectiveDate)}`}
      defaultBody={`Please find attached our current rate sheet, effective ${fmtDate(rs.effectiveDate)}.\n\nRegards,\n${s.company || ""}\n${s.companyPhone || ""}`}
      buildAttachment={pdf} onClose={() => setEmail(false)} toast={toast || (() => {})} />}
    <div className="printable rate-sheet" ref={page}>
      <div className="doc-top">
        <div className="doc-co">
          <img src="/tmj-logo.png" alt={s.company || ""} style={{ width: 150, display: "block", marginBottom: 10 }} />
          <div className="co-meta">{[s.company, s.companyAddress, s.companyPhone, s.companyEmail].filter(Boolean).join("\n")}</div>
        </div>
        <div className="doc-title">
          <div className="t">Rate Sheet</div>
          <div className="n" style={{ fontFamily: "Inter, sans-serif" }}>Engineering &amp; Field Services</div>
          <div className="n" style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "#6b7280" }}>Effective {fmtDate(rs.effectiveDate)}</div>
        </div>
      </div>

      <table className="doc-items">
        <thead><tr><th>Service</th><th className="r">Standard Rate</th><th className="r">Overtime ({multLabel(rs.otMultiplier)})</th><th className="r">Double Time ({multLabel(rs.dtMultiplier)})</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.key}>
          <td style={{ fontWeight: 600 }}>{r.label}</td>
          <td className="r mono">{money(r.rate)}<span className="rs-hr">/hr</span></td>
          <td className="r mono">{money(r.ot)}<span className="rs-hr">/hr</span></td>
          <td className="r mono">{money(r.dt)}<span className="rs-hr">/hr</span></td>
        </tr>)}</tbody>
      </table>

      <div className="rs-section">
        <h4>Overtime and Premium Time</h4>
        <ul>
          <li><b>Standard rates</b> apply to the first {rs.dailyHours} hours worked in a day, Monday through Friday.</li>
          <li><b>Overtime at {multLabel(rs.otMultiplier)}</b> the standard rate applies to hours worked beyond {rs.dailyHours} in a day, hours worked beyond {rs.weeklyHours} in a week, and all hours worked on Saturdays.</li>
          <li><b>Double time at {multLabel(rs.dtMultiplier)}</b> the standard rate applies to all hours worked on Sundays and recognized holidays.</li>
        </ul>
      </div>

      <div className="rs-section">
        <h4>Travel and Living Expenses</h4>
        <ul>
          <li>Work performed within the {rs.localArea} area is billed at the hourly rates above, with no additional travel or living charges.</li>
          <li>For work outside the {rs.localArea} area, travel and living expenses are billed in addition to labor. Airfare, rental vehicles, lodging and other travel and living accommodations are billed at <b>actual cost</b>.</li>
          <li>Use of a personal or company vehicle is billed at the <b>current IRS standard mileage rate</b> in effect on the date of travel.</li>
          <li>Meals and incidental expenses are billed at the <b>per diem rate for the work location</b>, as published by the U.S. General Services Administration and recognized by the IRS for that area.</li>
        </ul>
      </div>

      {rs.notes && <div className="doc-notes">{rs.notes}</div>}
      <div className="doc-foot">{[s.company, s.companyPhone, s.companyEmail].filter(Boolean).join(" · ")}</div>
    </div>
  </div>, document.body);
}
