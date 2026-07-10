import { money, fmtDate } from "../lib/helpers.js";
import { lineTotals, paid, balance } from "../calc/ledger.js";
import { Ico, ICONS } from "./ui.jsx";

export default function DocumentView({ kind, doc, contact, settings, onClose }) {
  const t = lineTotals(doc.lineItems, doc.taxRate);
  const isQuote = kind === "quote";
  const title = isQuote ? "Quote" : "Invoice";
  return <div className="doc-screen">
    <div className="doc-bar">
      <button className="btn" onClick={onClose}><Ico d={ICONS.back} size={16} />Close</button>
      <button className="btn primary" onClick={() => window.print()}><Ico d={ICONS.print} size={16} />Print / Save PDF</button>
    </div>
    <div className="printable">
      <div className="doc-top">
        <div className="doc-co">
          <h2>{settings.company || "Your Company"}</h2>
          <div className="co-meta">{[settings.companyAddress, settings.companyEmail, settings.companyPhone].filter(Boolean).join("\n")}</div>
        </div>
        <div className="doc-title">
          <div className="t">{title}</div>
          <div className="n">{doc.number}</div>
        </div>
      </div>
      <div className="doc-parties">
        <div className="blk">
          <div className="h">{isQuote ? "Quote For" : "Bill To"}</div>
          <div className="b">{contact ? [contact.name, contact.contact, contact.address, contact.email].filter(Boolean).join("\n") : "—"}</div>
        </div>
        <div className="doc-meta-grid">
          <div className="m"><div className="h">Date</div><div className="v">{fmtDate(doc.date)}</div></div>
          {isQuote
            ? <div className="m"><div className="h">Valid Until</div><div className="v">{fmtDate(doc.expiryDate)}</div></div>
            : <div className="m"><div className="h">Due</div><div className="v">{fmtDate(doc.dueDate)}</div></div>}
          {doc.poNumber && <div className="m"><div className="h">PO #</div><div className="v">{doc.poNumber}</div></div>}
        </div>
      </div>
      <table className="doc-items"><thead><tr>
        <th>Description</th><th className="r">Qty</th><th className="r">Unit Price</th><th className="r">Amount</th>
      </tr></thead><tbody>
        {doc.lineItems.map((it, i) => (
          <tr key={i}>
            <td>{it.desc || "—"}</td>
            <td className="r mono">{it.qty}{it.unit ? " " + it.unit : ""}</td>
            <td className="r mono">{money(Number(it.unitPrice) || 0)}</td>
            <td className="r mono">{money((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</td>
          </tr>
        ))}
      </tbody></table>
      <div className="doc-tot"><div className="box">
        <div className="l"><span>Subtotal</span><span className="v">{money(t.sub)}</span></div>
        <div className="l"><span>Tax ({doc.taxRate || 0}%)</span><span className="v">{money(t.tax)}</span></div>
        {!isQuote && paid(doc) > 0 && <div className="l"><span>Paid</span><span className="v">-{money(paid(doc))}</span></div>}
        <div className="l g"><span>{!isQuote && paid(doc) > 0 ? "Balance Due" : "Total"}</span><span className="v">{money(!isQuote && paid(doc) > 0 ? balance(doc) : t.total)}</span></div>
      </div></div>
      {(isQuote ? settings.quoteNotes : settings.invoiceNotes) &&
        <div className="doc-notes">{isQuote ? settings.quoteNotes : settings.invoiceNotes}</div>}
      <div className="doc-foot">{settings.company} · {settings.companyEmail}</div>
    </div>
  </div>;
}
