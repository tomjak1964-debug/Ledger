import { useState, useRef, useEffect } from "react";
import { nameOf } from "../lib/helpers.js";
import { canRead } from "../lib/permissions.js";
import { Ico, ICONS } from "./ui.jsx";

// Top-bar search across the main records. Only searches areas the user can read.
// Ctrl/Cmd+K focuses it; picking a result jumps to that record's view.
export default function GlobalSearch({ db, member, go }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const inputRef = useRef();

  useEffect(() => {
    const away = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = e => { if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); inputRef.current?.focus(); setOpen(true); } };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, []);

  const s = q.trim().toLowerCase();
  const can = a => canRead(member, a);
  const results = [];
  if (s) {
    const hit = (...f) => f.filter(Boolean).some(x => String(x).toLowerCase().includes(s));
    const push = (view, label, sub, kind) => results.push({ view, label, sub, kind });
    if (can("quotes")) db.quotes.forEach(x => hit(x.number, nameOf(db, x.customerId)) && push("quotes", x.number, nameOf(db, x.customerId), "Quote"));
    if (can("salesOrders")) db.salesOrders.forEach(x => hit(x.number, x.poNumber, nameOf(db, x.customerId)) && push("salesOrders", x.number, nameOf(db, x.customerId), "Sales Order"));
    if (can("invoices") || can("receivables")) db.invoices.forEach(x => hit(x.number, x.poNumber, nameOf(db, x.customerId)) && push("invoices", x.number, nameOf(db, x.customerId), "Invoice"));
    if (can("payables")) db.bills.forEach(x => hit(x.number, x.ref, nameOf(db, x.vendorId)) && push("payables", x.number, nameOf(db, x.vendorId), "Bill"));
    if (can("payables")) (db.purchaseOrders || []).forEach(x => hit(x.number, nameOf(db, x.vendorId)) && push("purchaseOrders", x.number, nameOf(db, x.vendorId), "PO"));
    if (can("proposals")) db.proposals.forEach(x => hit(x.number, x.jobNumber, x.description, nameOf(db, x.customerId)) && push("proposals", x.number, x.description || nameOf(db, x.customerId), "Proposal"));
    if (can("contacts")) db.contacts.forEach(x => hit(x.name, x.email, x.contact) && push("contacts", x.name, x.type, "Contact"));
  }
  const shown = results.slice(0, 12);
  const pick = (r) => { setOpen(false); setQ(""); go(r.view); };

  return <div ref={ref} style={{ position: "relative" }}>
    <div className="search" style={{ minWidth: 210 }}>
      <Ico d={ICONS.search} size={15} />
      <input ref={inputRef} className="input" placeholder="Search…" value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
    </div>
    {open && s && <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", zIndex: 40, width: 340, maxHeight: 420, overflowY: "auto" }}>
      {shown.length === 0
        ? <div className="subtle" style={{ padding: 12 }}>No matches.</div>
        : shown.map((r, i) => <button key={i} onClick={() => pick(r)}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid var(--line)", padding: "9px 12px", cursor: "pointer" }}>
          <span className="doc-id" style={{ minWidth: 88 }}>{r.label}</span>
          <span className="subtle" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</span>
          <span className="subtle" style={{ fontSize: 11 }}>{r.kind}</span>
        </button>)}
    </div>}
  </div>;
}
