import { money, fmtDate } from "../lib/helpers.js";
import { lineTotals, paid, balance } from "../calc/ledger.js";
import { Ico, ICONS } from "./ui.jsx";

export default function DocumentView({ kind, doc, contact, settings, onClose }) {
  const t = lineTotals(doc.lineItems, doc.taxRate);
  const isQuote = kind === "quote";
  const title = isQuote ? "Quote" : "Invoice";
  if (!isQuote) return <InvoiceDoc inv={doc} contact={contact} settings={settings} onClose={onClose} />;
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
      {(doc.notes || (isQuote ? settings.quoteNotes : settings.invoiceNotes)) &&
        <div className="doc-notes">{doc.notes || (isQuote ? settings.quoteNotes : settings.invoiceNotes)}</div>}
      <div className="doc-foot">{settings.company} · {settings.companyEmail}</div>
    </div>
  </div>;
}

// Sage-style invoice layout, matching Examples/Invoice Example.pdf.
// qty-0 lines are unbilled-phase reference lines: unit price, no amount.
function InvoiceDoc({ inv, contact, settings, onClose }) {
  const t = lineTotals(inv.lineItems, inv.taxRate);
  const p = paid(inv);
  const addr = [contact?.name, ...(contact?.address || "").split("\n")].filter(Boolean).join("\n");
  const fmt2 = n => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <div className="doc-screen">
    <div className="doc-bar">
      <button className="btn" onClick={onClose}><Ico d={ICONS.back} size={16} />Close</button>
      <button className="btn primary" onClick={() => window.print()}><Ico d={ICONS.print} size={16} />Print / Save PDF</button>
    </div>
    <div className="printable inv-doc">
      <div className="inv-top">
        <div>
          <h2>{settings.company}</h2>
          <div className="co">{settings.companyAddress}</div>
          {settings.companyPhone && <div className="co" style={{ marginTop: 14 }}>Voice:  {settings.companyPhone}</div>}
        </div>
        <div className="inv-title">
          <div className="t">INVOICE</div>
          <table className="hdr"><tbody>
            <tr><td>Invoice Number:</td><td>{inv.number}</td></tr>
            <tr><td>Invoice Date:</td><td>{fmtDate(inv.date)}</td></tr>
            <tr><td>Page:</td><td>1</td></tr>
          </tbody></table>
        </div>
      </div>
      <div className="inv-boxes">
        <div className="box"><div className="bh">Bill To:</div><div className="bb">{addr}</div></div>
        <div className="box"><div className="bh">Ship to:</div><div className="bb">{addr}</div></div>
      </div>
      <table className="inv-grid"><tbody>
        <tr className="h"><td>Customer ID</td><td>Customer PO</td><td colSpan={2}>Payment Terms</td></tr>
        <tr><td>&nbsp;</td><td>{inv.poNumber || " "}</td><td colSpan={2}>Net {settings.terms} Days</td></tr>
        <tr className="h"><td>Sales Rep ID</td><td>Shipping Method</td><td>Ship Date</td><td>Due Date</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>{fmtDate(inv.dueDate)}</td></tr>
      </tbody></table>
      <table className="inv-items"><thead><tr>
        <th style={{ width: 70 }}>Quantity</th><th style={{ width: 80 }}>Item</th><th>Description</th>
        <th style={{ width: 90 }}>Unit Price</th><th style={{ width: 95 }}>Amount</th>
      </tr></thead><tbody>
        {inv.lineItems.map((it, i) => {
          const qty = Number(it.qty) || 0;
          return <tr key={i}>
            <td className="r">{qty > 0 ? qty.toFixed(2) : ""}</td><td></td>
            <td style={{ whiteSpace: "pre-line" }}>{(it.desc || "—").replace(/ — /g, "\n")}</td>
            <td className="r">{fmt2(it.unitPrice)}</td>
            <td className="r">{qty > 0 ? fmt2(qty * (Number(it.unitPrice) || 0)) : ""}</td>
          </tr>;
        })}
        <tr className="fill"><td colSpan={5}></td></tr>
      </tbody></table>
      <div className="inv-foot">
        <div className="memo">Check/Credit Memo No:</div>
        <table className="totals"><tbody>
          <tr><td>Subtotal</td><td className="r">{fmt2(t.sub)}</td></tr>
          <tr><td>Sales Tax</td><td className="r">{t.tax ? fmt2(t.tax) : ""}</td></tr>
          <tr><td>Total Invoice Amount</td><td className="r">{fmt2(t.total)}</td></tr>
          <tr><td>Payment/Credit Applied</td><td className="r">{p ? fmt2(p) : ""}</td></tr>
          <tr className="grand"><td>TOTAL</td><td className="r">{fmt2(p ? balance(inv) : t.total)}</td></tr>
        </tbody></table>
      </div>
      {(inv.notes || settings.invoiceNotes) && <div className="doc-notes">{inv.notes || settings.invoiceNotes}</div>}
    </div>
  </div>;
}
