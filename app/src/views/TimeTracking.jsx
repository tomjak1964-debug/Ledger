import { useState } from "react";
import { uid, money, fmtDate, todayISO, nameOf } from "../lib/helpers.js";
import { Ico, ICONS, Empty, Field, Badge } from "../components/ui.jsx";

// Log time against a job. Pick the job, add one or more lines (date, category,
// hours, description), and save. The category's flat rate is snapshotted onto
// each line so later rate changes don't rewrite history. Entries can later be
// billed onto an invoice from the job.
export default function TimeTrackingView({ db, actions, toast, readOnly, session }) {
  const jobs = db.salesOrders.filter(s => s.status === "open");
  const cats = (db.timeCategories || []).filter(c => c.active);
  const [soId, setSoId] = useState(jobs[0]?.id || "");
  const [lines, setLines] = useState([blankLine()]);
  const [saving, setSaving] = useState(false);

  function blankLine() { return { id: uid(), date: todayISO(), categoryId: cats[0]?.id || "", hours: "", description: "" }; }
  const setLine = (i, patch) => setLines(ls => ls.map((l, x) => x === i ? { ...l, ...patch } : l));
  const addLine = () => setLines(ls => [...ls, blankLine()]);
  const removeLine = (i) => setLines(ls => ls.length > 1 ? ls.filter((_, x) => x !== i) : ls);

  const valid = soId && lines.some(l => (Number(l.hours) || 0) > 0 && l.categoryId);
  const save = async () => {
    setSaving(true);
    const entries = lines.filter(l => (Number(l.hours) || 0) > 0 && l.categoryId).map(l => {
      const cat = cats.find(c => c.id === l.categoryId);
      return {
        id: uid(), salesOrderId: soId, categoryId: l.categoryId, date: l.date,
        hours: Number(l.hours) || 0, rate: cat?.rate || 0, cost: cat?.costRate || 0,
        description: l.description, userEmail: session.user.email,
      };
    });
    const ok = await actions.saveTimeEntries(entries);
    setSaving(false);
    if (ok) { setLines([blankLine()]); toast(`Logged ${entries.length} time line${entries.length > 1 ? "s" : ""}`); }
  };

  const mine = (db.timeEntries || []).filter(t => t.userEmail === session.user.email).slice(0, 30);
  const catName = id => (db.timeCategories || []).find(c => c.id === id)?.name || "—";
  const jobNo = id => db.salesOrders.find(s => s.id === id)?.number || "—";

  if (cats.length === 0) return <div className="card"><Empty icon={ICONS.clock} title="No time categories yet"
    msg="An admin needs to set up time categories and rates first (Settings → Time Categories)." /></div>;

  return <div>
    {!readOnly && <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Log Time</h3></div>
      <div className="card-body">
        <Field label="Job">
          <select className="select" value={soId} onChange={e => setSoId(e.target.value)}>
            <option value="">Select a job…</option>
            {jobs.map(s => <option key={s.id} value={s.id}>{s.number} — {nameOf(db, s.customerId)}</option>)}
          </select>
        </Field>
        <div className="divider"></div>
        <table><thead><tr><th style={{ width: 150 }}>Date</th><th>Category</th><th className="num" style={{ width: 90 }}>Hours</th><th>Description</th><th></th></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={l.id}>
            <td><input className="input" type="date" value={l.date} onChange={e => setLine(i, { date: e.target.value })} /></td>
            <td><select className="select" value={l.categoryId} onChange={e => setLine(i, { categoryId: e.target.value })}>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name} ({money(c.rate)}/hr)</option>)}
            </select></td>
            <td className="num"><input className="input mono" type="number" step="any" style={{ textAlign: "right" }} value={l.hours} onChange={e => setLine(i, { hours: e.target.value })} /></td>
            <td><input className="input" value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="What you worked on" /></td>
            <td><button className="btn ghost icon" title="Remove line" onClick={() => removeLine(i)}><Ico d={ICONS.x} size={15} /></button></td>
          </tr>)}</tbody></table>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn" onClick={addLine}><Ico d={ICONS.plus} size={14} />Add Line</button>
          <button className="btn primary" disabled={!valid || saving} onClick={save} style={{ marginLeft: "auto" }}>{saving ? "Saving…" : "Save Time"}</button>
        </div>
      </div>
    </div>}

    <div className="card">
      <div className="card-head"><h3>My Recent Time</h3></div>
      {mine.length === 0
        ? <Empty icon={ICONS.clock} title="No time logged yet" msg="Your logged hours will appear here." />
        : <table><thead><tr><th>Date</th><th>Job</th><th>Category</th><th>Description</th><th className="num">Hours</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>{mine.map(t => <tr key={t.id}>
            <td className="subtle">{fmtDate(t.date)}</td>
            <td className="doc-id">{jobNo(t.salesOrderId)}</td>
            <td>{catName(t.categoryId)}</td>
            <td className="subtle">{t.description || "—"}</td>
            <td className="num mono">{t.hours}</td>
            <td className="num mono">{money((Number(t.hours) || 0) * (Number(t.rate) || 0))}</td>
            <td>{t.invoiceId ? <Badge status="invoiced" /> : <span className="subtle">unbilled</span>}</td>
            <td style={{ textAlign: "right" }}>{!readOnly && !t.invoiceId &&
              <button className="btn ghost icon" title="Delete" onClick={async () => { if (confirm("Delete this time entry?") && await actions.deleteTimeEntry(t.id)) toast("Deleted"); }}><Ico d={ICONS.trash} size={14} /></button>}</td>
          </tr>)}</tbody></table>}
    </div>
  </div>;
}
