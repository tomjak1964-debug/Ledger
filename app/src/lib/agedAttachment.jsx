// "Attach the customer's Aged Receivables (detail)": the same report Reports →
// Aged Receivables makes, filtered to one customer as of today, drawn off-screen
// and turned into a real report PDF (lib/reportPdf.js) — letterhead, headings and
// "Page n of m" — to ride along on an invoice email.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AgedReport } from "../views/Reports.jsx";
import { reportPdf } from "./reportPdf.js";
import { agedReceivables } from "../calc/reports.js";
import { nameOf, todayISO, fmtDate, money } from "./helpers.js";

export async function agedReceivablesPdf(db, customerId, asOf = todayISO()) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-12000px;top:0;width:1060px;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    const label = "As of " + fmtDate(asOf);
    const name = nameOf(db, customerId);
    flushSync(() => root.render(<AgedReport db={db} asOf={asOf} partyId={customerId} kind="ar" initialDetail rangeLabel={label + " · Customer: " + name} />));
    return await reportPdf(host, { title: "Aged Receivables", subtitle: label, filter: "Customer: " + name, settings: db.settings,
      filename: `Aged Receivables ${name} ${asOf}.pdf` });
  } finally { root.unmount(); host.remove(); }
}

// The email dialog's tickbox for each customer the email is for (EmailModal's
// `extras`): off until ticked, with what the customer has open today.
export function agedExtras(db, customerIds) {
  const ids = [...new Set((customerIds || []).filter(Boolean))];
  const open = agedReceivables(db, todayISO()).rows;
  return ids.map(id => {
    const row = open.find(r => r.key === id);
    return { key: "aged:" + id, label: `Attach Aged Receivables (detail) for ${nameOf(db, id)}`,
      hint: row ? `${money(row.total)} open in ${row.docs.length} document${row.docs.length === 1 ? "" : "s"}` : "nothing open today",
      build: () => agedReceivablesPdf(db, id) };
  });
}
