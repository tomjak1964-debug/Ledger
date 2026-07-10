import { useState, useEffect, useRef } from "react";
import { uid, money, fmtDate, todayISO, addDays, nameOf } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { Ico, ICONS, Badge, Empty, Field, MenuItem } from "../components/ui.jsx";
import LineItemsEditor from "../components/LineItemsEditor.jsx";

export default function QuotesView({ db, actions, toast, openDoc }) {
  const [edit, setEdit] = useState(null); // quote object being edited/created
  const [search, setSearch] = useState("");
  const customers = db.contacts.filter(c => c.type === "customer");
  const filtered = db.quotes.filter(q => {
    const s = search.toLowerCase(); if (!s) return true;
    return q.number.toLowerCase().includes(s) || nameOf(db, q.customerId).toLowerCase().includes(s) || (q.status || "").includes(s);
  });

  const startNew = () => {
    // Provisional number for display; the real one is claimed atomically at save.
    const n = db.settings.quotePrefix + "-" + String(db.settings.counters.quote).padStart(4, "0");
    setEdit({
      id: uid(), number: n, _new: true, customerId: customers[0]?.id || "", date: todayISO(),
      expiryDate: addDays(todayISO(), 30), status: "draft", poNumber: "",
      lineItems: [{ id: uid(), desc: "", qty: 1, unit: "", unitPrice: 0 }], taxRate: db.settings.taxRate, notes: ""
    });
  };
  const save = async (q) => {
    const saved = await actions.saveQuote(q);
    if (saved) { setEdit(null); toast(q._new ? "Quote created" : "Quote saved"); }
  };
  const setStatus = async (id, status) => { if (await actions.setQuoteStatus(id, status)) toast("Marked " + status); };
  const del = async (id) => { if (!confirm("Delete this quote?")) return; if (await actions.deleteQuote(id)) toast("Quote deleted"); };

  const convertToSO = async (q) => {
    const po = prompt("Purchase Order number from customer (optional):", q.poNumber || "");
    if (po === null) return;
    const so = await actions.convertQuoteToSO(q, po);
    if (so) toast("Sales order created from " + q.number);
  };

  if (edit) return <QuoteEditor quote={edit} customers={customers} catalog={db.catalog} onCancel={() => setEdit(null)} onSave={save} />;

  return <div>
    <div className="toolbar">
      <div className="search"><Ico d={ICONS.search} size={15} /><input className="input" placeholder="Search quotes…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={startNew}><Ico d={ICONS.plus} size={15} />New Quote</button>
    </div>
    <div className="card">
      {db.quotes.length === 0
        ? <Empty icon={ICONS.quote} title="No quotes yet" msg="Build a quote with the dynamic line-item form. Accepted quotes convert straight into sales orders."
          action={<button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Quote</button>} />
        : <table><thead><tr><th>Quote</th><th>Customer</th><th>Date</th><th>Valid Until</th><th>Status</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{filtered.slice().reverse().map(q => {
            const t = lineTotals(q.lineItems, q.taxRate).total;
            return <tr key={q.id}>
              <td className="doc-id">{q.number}</td>
              <td>{nameOf(db, q.customerId)}</td>
              <td className="subtle">{fmtDate(q.date)}</td>
              <td className="subtle">{fmtDate(q.expiryDate)}</td>
              <td><Badge status={q.status} /></td>
              <td className="num">{money(t)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn ghost icon" title="Print" onClick={() => openDoc("quote", q)}><Ico d={ICONS.print} size={16} /></button>
                <button className="btn ghost icon" title="Edit" onClick={() => setEdit({ ...q })}><Ico d={ICONS.edit} size={16} /></button>
                <QuoteMenu q={q} setStatus={setStatus} convert={convertToSO} del={del} />
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
  </div>;
}

function QuoteMenu({ q, setStatus, convert, del }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  return <span style={{ position: "relative", display: "inline-block" }} ref={ref}>
    <button className="btn ghost icon" onClick={() => setOpen(o => !o)} title="More">⋯</button>
    {open && <div style={{ position: "absolute", right: 0, top: "100%", background: "#fff", border: "1px solid var(--line)", borderRadius: 9, boxShadow: "var(--shadow)", zIndex: 30, minWidth: 180, padding: 6, textAlign: "left" }}>
      {q.status !== "sent" && <MenuItem onClick={() => { setStatus(q.id, "sent"); setOpen(false); }}>Mark as Sent</MenuItem>}
      {q.status !== "accepted" && <MenuItem onClick={() => { setStatus(q.id, "accepted"); setOpen(false); }}>Mark as Accepted</MenuItem>}
      {q.status !== "declined" && <MenuItem onClick={() => { setStatus(q.id, "declined"); setOpen(false); }}>Mark as Declined</MenuItem>}
      {!q.salesOrderId && <MenuItem accent onClick={() => { convert(q); setOpen(false); }}>Convert to Sales Order →</MenuItem>}
      {q.salesOrderId && <div style={{ padding: "7px 10px", fontSize: 12, color: "var(--muted)" }}>Converted to SO ✓</div>}
      <MenuItem danger onClick={() => { del(q.id); setOpen(false); }}>Delete</MenuItem>
    </div>}
  </span>;
}

function QuoteEditor({ quote, customers, catalog, onCancel, onSave }) {
  const [q, setQ] = useState(quote);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setQ(p => ({ ...p, [k]: v }));
  const save = async () => { setSaving(true); await onSave(q); setSaving(false); };
  return <div>
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{q._new ? "New Quote" : "Edit " + q.number} <span className="mono subtle" style={{ fontSize: 14 }}>{q.number}</span></h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Quote"}</button>
      </div>
    </div>
    <div className="card"><div className="card-body">
      <div className="row">
        <Field label="Customer"><select className="select" value={q.customerId} onChange={e => set("customerId", e.target.value)}>
          <option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Quote Date"><input className="input" type="date" value={q.date} onChange={e => set("date", e.target.value)} /></Field>
        <Field label="Valid Until"><input className="input" type="date" value={q.expiryDate} onChange={e => set("expiryDate", e.target.value)} /></Field>
        <Field label="Status"><select className="select" value={q.status} onChange={e => set("status", e.target.value)}>
          <option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="declined">Declined</option>
        </select></Field>
      </div>
      <div className="divider"></div>
      <LineItemsEditor items={q.lineItems} setItems={v => set("lineItems", v)} taxRate={q.taxRate} setTaxRate={v => set("taxRate", v)} catalog={catalog} />
      <div className="divider"></div>
      <Field label="Notes (printed on quote)"><textarea className="input" value={q.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Scope notes, lead time, exclusions…" /></Field>
    </div></div>
  </div>;
}
