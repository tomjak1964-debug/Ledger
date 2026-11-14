import { useState, useEffect } from "react";
import { money, fmtDate, todayISO, nameOf } from "../lib/helpers.js";
import { EVERY, everyLabel, advance, isDue, finished, templateTotal, templateFrom } from "../calc/recurring.js";
import { Ico, ICONS, Modal, Field, SortTh, useTableSort } from "./ui.jsx";

// The recurring invoices (or bills) on the Invoices (Payables) page: each
// template with its party, amount, how often and when it's next due. What's due
// is flagged and made on a click — Create, or Create All Due — and each one made
// is an ordinary invoice or bill. "Make Recurring" on a row's ⋯ menu starts one.
export default function RecurringPanel({ kind, db, actions, toast, readOnly, start, onStarted }) {
  const today = todayISO();
  const list = (db.recurring || []).filter(r => r.kind === kind);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const due = list.filter(r => isDue(r, today));
  const noun = kind === "invoice" ? "invoice" : "bill";
  const { sorted, sort, onSort } = useTableSort(list, {
    name: r => r.name, party: r => nameOf(db, r.partyId), amount: r => templateTotal(kind, r.template),
    every: r => everyLabel(r.every), next: r => r.nextDate, status: r => (isDue(r, today) ? 0 : r.active ? 1 : 2),
  }, { key: "next", dir: "asc" });
  // "Make Recurring" from a row: the template from that document, next due one period on.
  useEffect(() => {
    if (!start) return;
    const party = kind === "invoice" ? start.customerId : start.vendorId;
    const first = kind === "invoice" ? (start.lineItems || [])[0]?.desc : ((start.lines || [])[0]?.desc || start.ref);
    setEdit({ kind, name: [nameOf(db, party), String(first || "").split("\n")[0]].filter(Boolean).join(" · ").slice(0, 80), partyId: party,
      every: "month", nextDate: advance(start.date || today, "month"), endDate: "", active: true, template: templateFrom(kind, start) });
    onStarted?.();
  }, [start]);   // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (rs) => {
    setBusy(true);
    let made = 0;
    for (const r of rs) if (await actions.runRecurring(r)) made++;
    setBusy(false);
    if (made) toast(`${made} recurring ${noun}${made === 1 ? "" : "s"} created`);
  };
  const save = async () => {
    setBusy(true);
    const ok = await actions.saveRecurring(edit);
    setBusy(false);
    if (ok) { toast(`Recurring ${noun} saved — next ${fmtDate(ok.nextDate)}`); setEdit(null); }
  };
  const del = async (r) => { if (confirm(`Stop and delete "${r.name}"? ${noun[0].toUpperCase() + noun.slice(1)}s already made stay.`) && await actions.deleteRecurring(r.id)) toast("Recurring " + noun + " deleted"); };
  if (!list.length && !edit) return null;
  return <div className="card" style={{ marginBottom: 16, ...(due.length ? { borderLeft: "4px solid var(--warn)" } : {}) }}>
    <div className="card-head" style={{ cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
      <h3>Recurring {noun[0].toUpperCase() + noun.slice(1)}s</h3><span className="count" style={{ marginLeft: 8 }}>{list.length}</span>
      {due.length > 0 && <span className="badge amber" style={{ marginLeft: 10 }}><span className="dot"></span>{due.length} due</span>}
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }} onClick={e => e.stopPropagation()}>
        {!readOnly && due.length > 0 && <button className="btn sm primary" disabled={busy} onClick={() => run(due)}>
          <Ico d={ICONS.plus} size={14} />{busy ? "Creating…" : `Create ${due.length === 1 ? "the Due One" : `All ${due.length} Due`}`}</button>}
        <button className="btn sm" onClick={() => setOpen(o => !o)}>{open ? "Hide" : "Show"}</button>
      </span></div>
    {open && <table><thead><tr>
      <SortTh label="Name" col="name" sort={sort} onSort={onSort} />
      <SortTh label={kind === "invoice" ? "Customer" : "Vendor"} col="party" sort={sort} onSort={onSort} />
      <SortTh label="Amount" col="amount" sort={sort} onSort={onSort} num />
      <SortTh label="How Often" col="every" sort={sort} onSort={onSort} />
      <SortTh label="Next" col="next" sort={sort} onSort={onSort} />
      <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
      <th></th></tr></thead>
      <tbody>{sorted.map(r => <tr key={r.id}>
        <td style={{ fontWeight: 600 }}>{r.name}</td>
        <td>{nameOf(db, r.partyId)}</td>
        <td className="num mono">{money(templateTotal(kind, r.template))}</td>
        <td className="subtle">{everyLabel(r.every)}{r.endDate ? ` · until ${fmtDate(r.endDate)}` : ""}</td>
        <td className="nowrap">{finished(r) ? "—" : fmtDate(r.nextDate)}</td>
        <td>{!r.active ? <span className="badge"><span className="dot"></span>Paused</span> : finished(r) ? <span className="badge"><span className="dot"></span>Ended</span>
          : isDue(r, today) ? <span className="badge amber"><span className="dot"></span>Due</span> : <span className="badge blue"><span className="dot"></span>Scheduled</span>}</td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{!readOnly && <>
          {r.active && !finished(r) && <button className="btn sm" disabled={busy} title={`Make the ${fmtDate(r.nextDate)} ${noun} now`} onClick={() => run([r])}>Create</button>}
          <button className="btn ghost icon" title="Edit" onClick={() => setEdit({ ...r })}><Ico d={ICONS.edit} size={15} /></button>
          <button className="btn ghost icon" title="Delete" onClick={() => del(r)}><Ico d={ICONS.trash} size={15} /></button></>}</td>
      </tr>)}</tbody></table>}
    {edit && <Modal title={edit.id ? "Edit Recurring " + (kind === "invoice" ? "Invoice" : "Bill") : "Make Recurring"} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn primary" disabled={busy || !edit.nextDate} onClick={save}>Save</button></>}>
      <p className="subtle" style={{ marginTop: 0 }}>
        {nameOf(db, edit.partyId)} · {money(templateTotal(kind, edit.template))} each time. It repeats the {noun}'s lines, tax, notes and accounts;
        each one made is a new {noun} dated its due date, made when you press Create on this page.</p>
      <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
      <div className="row">
        <Field label="How often"><select className="select" value={edit.every} onChange={e => setEdit({ ...edit, every: e.target.value })}>
          {EVERY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Next due"><input className="input" type="date" value={edit.nextDate} onChange={e => setEdit({ ...edit, nextDate: e.target.value })} /></Field>
        <Field label="Ends (optional)"><input className="input" type="date" value={edit.endDate || ""} onChange={e => setEdit({ ...edit, endDate: e.target.value })} /></Field>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} />Active — untick to pause it</label>
      {kind === "bill" && <p className="subtle" style={{ marginBottom: 0 }}>Each bill gets the vendor invoice # REC-YYMMDD — change it to the vendor's own number when their invoice arrives.</p>}
    </Modal>}
  </div>;
}
