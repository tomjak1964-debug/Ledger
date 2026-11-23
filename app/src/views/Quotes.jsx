import { useState, useEffect } from "react";
import { uid, money, fmtDate, todayISO, addDays, nameOf, pickable } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { useFilters } from "../components/useFilters.jsx";
import { Ico, ICONS, Badge, Empty, Field, MenuItem, ActionMenu, SortTh, useTableSort } from "../components/ui.jsx";
import LineItemsEditor from "../components/LineItemsEditor.jsx";
import QuoteDoc from "../components/QuoteDoc.jsx";

export default function QuotesView({ db, actions, toast, readOnly, editRequest, clearEditRequest }) {
  const [edit, setEdit] = useState(null); // quote object being edited/created
  const [doc, setDoc] = useState(null);   // { q, auto } — the quote open as a document
  // Opened from the top-bar search (view) or a document's Edit.
  useEffect(() => {
    if (editRequest?.kind !== "quote") return;
    const rec = db.quotes.find(x => x.id === editRequest.id);
    if (rec) { if (editRequest.view || readOnly) setDoc({ q: rec }); else setEdit({ ...rec }); }
    clearEditRequest?.();
  }, [editRequest]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState("");
  const customers = db.contacts.filter(c => c.type === "customer");
  const f = useFilters({ partyKind: "customer", contacts: db.contacts });
  const filtered = db.quotes.filter(q => {
    if (!f.keep(q.date, q.customerId)) return false;
    const s = search.toLowerCase(); if (!s) return true;
    return [q.number, q.jobNumber, q.description, nameOf(db, q.customerId), q.status].join(" ").toLowerCase().includes(s);
  });
  const { sorted: qRows, sort, onSort } = useTableSort(filtered.slice().reverse(), {
    number: q => q.number, job: q => q.jobNumber || "", customer: q => nameOf(db, q.customerId), desc: q => q.description || "",
    date: q => q.date, expiry: q => q.expiryDate, status: q => q.status, total: q => lineTotals(q.lineItems, q.taxRate).total,
  });

  const startNew = () => {
    setEdit({
      id: uid(), number: "", _new: true, customerId: pickable(customers)[0]?.id || "", date: todayISO(),
      expiryDate: addDays(todayISO(), 30), status: "draft", poNumber: "", jobNumber: "", description: "",
      lineItems: [{ id: uid(), desc: "", qty: 1, unit: "", unitPrice: 0 }], taxRate: db.settings.taxRate, notes: ""
    });
  };
  const save = async (q) => {
    const saved = await actions.saveQuote(q);
    if (saved) { setEdit(null); toast(q._new ? "Quote " + saved.number + " created" : "Quote saved"); }
  };
  const setStatus = async (id, status) => { if (await actions.setQuoteStatus(id, status)) toast("Marked " + status); };
  // Emailing a draft sends it: the customer has it now. Anything past draft is left alone.
  const markEmailed = async (q) => {
    if (readOnly) return;
    const cur = db.quotes.find(x => x.id === q.id) || q;
    if (cur.status === "draft" && await actions.setQuoteStatus(cur.id, "sent")) toast(`Email sent · ${cur.number} is now Sent`);
  };
  const del = async (id) => {
    if (!confirm("Delete this quote?")) return;
    const rec = db.quotes.find(q => q.id === id);
    if (await actions.deleteQuote(id)) toast("Deleted " + (rec?.number || "quote"), { actionLabel: "Undo", onAction: async () => { if (await actions.restoreRecord("quote", rec)) toast(rec.number + " restored"); } });
  };
  // Copy: a new draft dated today with the next number, everything else carried
  // over; saved straight away so it claims its number, then opened to edit.
  const copy = async (q) => {
    const saved = await actions.saveQuote({
      ...q, id: uid(), _new: true, number: "", date: todayISO(), expiryDate: addDays(todayISO(), 30), status: "draft",
      poNumber: "", salesOrderId: undefined, lineItems: (q.lineItems || []).map(li => ({ ...li, id: uid() })),
    });
    if (!saved) return;
    toast(`${saved.number} copied from ${q.number}`);
    setDoc(null); setEdit({ ...saved });
  };

  const convertToSO = async (q) => {
    const po = prompt("Customer Purchase Order number:", q.poNumber || "");
    if (po === null) return;
    const so = await actions.convertQuoteToSO(q, po);
    if (so) toast(`Won — sales order ${so.number} created from ${q.number}`);
  };
  const changePo = async (q) => {
    const po = prompt(`Customer PO for ${q.number} (its sales order changes with it):`, q.poNumber || "");
    if (po === null) return;
    if (await actions.setQuotePo(q, po)) toast(`${q.number} is now on PO ${po.trim() || "—"}`);
  };

  if (edit) return <QuoteEditor quote={edit} customers={customers} catalog={db.catalog} onCancel={() => setEdit(null)} onSave={save} />;

  return <div>
    <div className="toolbar">
      <div className="search"><Ico d={ICONS.search} size={15} /><input className="input" placeholder="Search quotes…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      {!readOnly && <button className="btn primary" style={{ marginLeft: "auto" }} onClick={startNew}><Ico d={ICONS.plus} size={15} />New Quote</button>}
    </div>
    {f.bar()}
    <div className="card">
      {db.quotes.length === 0
        ? <Empty icon={ICONS.quote} title="No quotes yet" msg="Build a quote with the dynamic line-item form. Accepted quotes convert straight into sales orders."
          action={!readOnly && <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Quote</button>} />
        : <table><thead><tr>
          <SortTh label="Quote" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Job #" col="job" sort={sort} onSort={onSort} />
          <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
          <SortTh label="Description" col="desc" sort={sort} onSort={onSort} />
          <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
          <SortTh label="Valid Until" col="expiry" sort={sort} onSort={onSort} />
          <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
          <SortTh label="Total" col="total" sort={sort} onSort={onSort} num /><th></th></tr></thead>
          <tbody>{qRows.map(q => {
            const t = lineTotals(q.lineItems, q.taxRate).total;
            return <tr key={q.id}>
              <td className="doc-id">{q.number}</td>
              <td className="mono subtle">{q.jobNumber || "—"}</td>
              <td>{nameOf(db, q.customerId)}</td>
              <td>{q.description || "—"}</td>
              <td className="subtle nowrap">{fmtDate(q.date)}</td>
              <td className="subtle nowrap">{fmtDate(q.expiryDate)}</td>
              <td><Badge status={q.status} />{q.salesOrderId && q.poNumber && <span className="subtle" style={{ marginLeft: 6 }}>PO {q.poNumber}</span>}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(t)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn ghost icon" title="View" onClick={() => setDoc({ q })}><Ico d={ICONS.view} size={16} /></button>
                <button className="btn ghost icon" title="Email quote" onClick={() => setDoc({ q, auto: "email" })}><Ico d={ICONS.mail} size={16} /></button>
                <button className="btn ghost icon" title="Print" onClick={() => setDoc({ q, auto: "print" })}><Ico d={ICONS.print} size={16} /></button>
                <ActionMenu title="Save" icon={ICONS.download} minWidth={210}>{close => <>
                  <MenuItem onClick={() => { close(); setDoc({ q, auto: "pdf" }); }}>Save PDF</MenuItem>
                </>}</ActionMenu>
                {!readOnly && <button className="btn ghost icon" title="Copy quote — a new draft from this one" onClick={() => copy(q)}><Ico d={ICONS.copy} size={16} /></button>}
                {!readOnly && <button className="btn ghost icon" title="Edit" onClick={() => setEdit({ ...q })}><Ico d={ICONS.edit} size={16} /></button>}
                {!readOnly && <QuoteMenu q={q} setStatus={setStatus} convert={convertToSO} changePo={changePo} del={del} />}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {doc && <QuoteDoc q={db.quotes.find(x => x.id === doc.q.id) || doc.q} auto={doc.auto} db={db} toast={toast} onClose={() => setDoc(null)}
      onEmailed={() => markEmailed(doc.q)}
      onEdit={readOnly ? undefined : () => { const x = doc.q; setDoc(null); setEdit({ ...(db.quotes.find(y => y.id === x.id) || x) }); }}
      onCopy={readOnly ? undefined : () => copy(db.quotes.find(x => x.id === doc.q.id) || doc.q)} />}
  </div>;
}

// The row's ⋯ menu, as a proposal's: until the quote is won it can be marked
// sent, won (PO received → its sales order) or declined; once won, its PO can
// be changed.
function QuoteMenu({ q, setStatus, convert, changePo, del }) {
  const won = !!q.salesOrderId;
  return <ActionMenu minWidth={200}>{close => {
    const item = (label, fn, opts = {}) => <MenuItem {...opts} onClick={() => { fn(); close(); }}>{label}</MenuItem>;
    return <>
      {!won && q.status === "draft" && item("Mark as Sent", () => setStatus(q.id, "sent"))}
      {!won && item("Won — PO received →", () => convert(q), { accent: true })}
      {won && item("Change PO…", () => changePo(q))}
      {!won && q.status !== "declined" && item("Mark as Declined", () => setStatus(q.id, "declined"))}
      {item("Delete", () => del(q.id), { danger: true })}
    </>;
  }}</ActionMenu>;
}

function QuoteEditor({ quote, customers, catalog, onCancel, onSave }) {
  const [q, setQ] = useState(quote);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setQ(p => ({ ...p, [k]: v }));
  const save = async () => { setSaving(true); await onSave(q); setSaving(false); };
  return <div data-editing="1">
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{q._new ? "New Quote" : "Edit " + (quote.number || "")}</h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Quote"}</button>
      </div>
    </div>
    <div className="card"><div className="card-body">
      <div className="row">
        <Field label="Quote #" hint={q._new ? "Blank takes the next QUO-YYMMDD-NN" : "Editable"}>
          <input className="input mono" value={q.number || ""} onChange={e => set("number", e.target.value)} placeholder="Assigned at save" /></Field>
        <Field label="Customer"><select className="select" value={q.customerId} onChange={e => set("customerId", e.target.value)}>
          <option value="">Select customer…</option>{pickable(customers, q.customerId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Quote Date"><input className="input" type="date" value={q.date} onChange={e => set("date", e.target.value)} /></Field>
        <Field label="Valid Until"><input className="input" type="date" value={q.expiryDate} onChange={e => set("expiryDate", e.target.value)} /></Field>
        <Field label="Job Number"><input className="input mono" value={q.jobNumber || ""} onChange={e => set("jobNumber", e.target.value)} placeholder="e.g. 4769" /></Field>
        <Field label="Status"><select className="select" value={q.status} onChange={e => set("status", e.target.value)}>
          <option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="declined">Declined</option>
        </select></Field>
      </div>
      <Field label="Description"><input className="input" value={q.description || ""} onChange={e => set("description", e.target.value)} placeholder="What the job is — printed on the Re: line" /></Field>
      <div className="divider"></div>
      <div className="subtle" style={{ margin: "0 0 6px" }}>The line items are the quote's Scope and its Pricing.</div>
      <LineItemsEditor items={q.lineItems} setItems={v => set("lineItems", v)} taxRate={q.taxRate} setTaxRate={v => set("taxRate", v)} catalog={catalog} />
      <div className="divider"></div>
      <Field label="Sales Notes and Clarifications" hint="One per line — each is a numbered note on the quote"><textarea className="input" rows={5} value={q.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Lead time, exclusions, what the customer supplies…" /></Field>
    </div></div>
  </div>;
}
