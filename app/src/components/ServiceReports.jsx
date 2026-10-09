import { useState } from "react";
import { uid, money, fmtDate, todayISO, nameOf, sum } from "../lib/helpers.js";
import { jobNumberOf } from "../calc/jobs.js";
import { jobOptionLabel } from "./JobCostPicker.jsx";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort, AutoTextarea } from "./ui.jsx";

const NEW_JOB = "__new__";

// Service reports on Work → Time Tracking: a visit written up — the job, the
// date and who did it, what was reported, the work done, follow-up, the parts
// used and the hours. The hours are time entries on the job (approved and
// billed like any other time); a billed part with a price becomes a ready line
// on the job's sales order. A visit with no job opens one.
export default function ServiceReports({ db, actions, toast, readOnly, session, isAdmin }) {
  const [edit, setEdit] = useState(null);
  const all = db.serviceReports || [];
  const reports = isAdmin ? all : all.filter(r => r.userEmail === session.user.email);
  const hoursOf = r => sum((db.timeEntries || []).filter(t => t.serviceReportId === r.id), t => Number(t.hours) || 0);
  const soOf = r => db.salesOrders.find(s => s.id === r.salesOrderId);
  const { sorted, sort, onSort } = useTableSort(reports, {
    number: r => r.number, date: r => r.date || "", who: r => r.userEmail || "", job: r => (soOf(r) && jobNumberOf(db, soOf(r))) || soOf(r)?.number || "",
    customer: r => nameOf(db, soOf(r)?.customerId), work: r => r.workPerformed || r.problem || "", hours: hoursOf, parts: r => (r.parts || []).length,
  }, { key: "date", dir: "desc" });

  const del = async (r) => {
    if (!confirm(`Delete ${r.number}? Its hours are deleted with it; parts already added to the job stay there.`)) return;
    if (await actions.deleteServiceReport(r.id)) toast(r.number + " deleted");
  };

  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>Service Reports</h3>
      {!readOnly && <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setEdit({ report: null })}>
        <Ico d={ICONS.plus} size={14} />New Service Report</button>}</div>
    {reports.length === 0
      ? <Empty icon={ICONS.clock} title="No service reports yet" msg="Write up a visit — the work done, the parts used and the hours. The hours go on the job's time like any other." />
      : <table><thead><tr>
        <SortTh label="Report" col="number" sort={sort} onSort={onSort} />
        <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
        {isAdmin && <SortTh label="Who" col="who" sort={sort} onSort={onSort} />}
        <SortTh label="Job" col="job" sort={sort} onSort={onSort} />
        <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
        <SortTh label="Work Performed" col="work" sort={sort} onSort={onSort} />
        <SortTh label="Hours" col="hours" sort={sort} onSort={onSort} num />
        <SortTh label="Parts" col="parts" sort={sort} onSort={onSort} num />
        <th></th></tr></thead>
        <tbody>{sorted.map(r => {
          const so = soOf(r);
          return <tr key={r.id} className="clickable" onClick={() => setEdit({ report: r })}>
            <td className="doc-id">{r.number}</td>
            <td className="subtle">{fmtDate(r.date)}</td>
            {isAdmin && <td className="subtle">{r.userEmail}</td>}
            <td className="mono">{so ? (jobNumberOf(db, so) || so.number) : "—"}</td>
            <td>{so ? nameOf(db, so.customerId) : "—"}</td>
            <td className="subtle" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(r.workPerformed || r.problem || "—").split("\n")[0]}</td>
            <td className="num mono">{hoursOf(r)}</td>
            <td className="num mono">{(r.parts || []).length || ""}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              {!readOnly && <button className="btn ghost icon" title="Delete" onClick={e => { e.stopPropagation(); del(r); }}><Ico d={ICONS.trash} size={14} /></button>}
            </td>
          </tr>;
        })}</tbody></table>}
    {edit && <ServiceReportModal db={db} actions={actions} toast={toast} session={session} readOnly={readOnly}
      report={edit.report} onClose={() => setEdit(null)} />}
  </div>;
}

function ServiceReportModal({ db, actions, toast, session, readOnly, report, onClose }) {
  const cats = (db.timeCategories || []).filter(c => c.active);
  const customers = db.contacts.filter(c => c.type === "customer");
  const jobs = db.salesOrders.filter(s => s.status === "open" || s.id === report?.salesOrderId);
  const [r, setR] = useState(() => report ? { ...report, parts: (report.parts || []).map(p => ({ ...p })) } : {
    id: uid(), _new: true, number: "", salesOrderId: jobs[0]?.id || "", date: todayISO(), userEmail: session.user.email,
    problem: "", workPerformed: "", followUp: "", parts: [],
  });
  const existing = report ? (db.timeEntries || []).filter(t => t.serviceReportId === report.id) : [];
  const [lines, setLines] = useState(() => existing.length
    ? existing.map(t => ({ id: t.id, categoryId: t.categoryId, hours: t.hours, description: t.description, invoiced: !!t.invoiceId }))
    : [{ id: uid(), categoryId: cats[0]?.id || "", hours: "", description: "" }]);
  const [newJob, setNewJob] = useState({ customerId: customers[0]?.id || "", jobNumber: "", description: "", poNumber: "" });
  const [saving, setSaving] = useState(false);
  const isNewJob = r.salesOrderId === NEW_JOB;
  const set = (k, v) => setR(x => ({ ...x, [k]: v }));
  const setLine = (i, patch) => setLines(ls => ls.map((l, x) => x === i ? { ...l, ...patch } : l));
  const setPart = (i, patch) => setR(x => ({ ...x, parts: x.parts.map((p, j) => j === i ? { ...p, ...patch } : p) }));
  const hours = sum(lines, l => Number(l.hours) || 0);
  const lock = readOnly;

  const save = async () => {
    setSaving(true);
    const out = await actions.saveServiceReport({ ...r, salesOrderId: isNewJob ? "" : r.salesOrderId }, { lines, newJob: isNewJob ? newJob : null });
    setSaving(false);
    if (out) { toast(`${out.number} saved${isNewJob ? " — job " + newJob.jobNumber.trim() + " opened" : ""}`); onClose(); }
  };

  return <Modal wide title={report ? "Service Report " + report.number : "New Service Report"} onClose={onClose}
    foot={<>
      <span className="subtle" style={{ marginRight: "auto" }}>{hours ? hours + " hr" : ""}</span>
      <button className="btn" onClick={onClose}>{lock ? "Close" : "Cancel"}</button>
      {!lock && <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Service Report"}</button>}
    </>}>
    <div className="row">
      <Field label="Job">
        <select className="select" value={r.salesOrderId} disabled={lock} onChange={e => set("salesOrderId", e.target.value)}>
          <option value="">Select a job…</option>
          {jobs.map(s => <option key={s.id} value={s.id}>{jobOptionLabel(db, s)}</option>)}
          <option value={NEW_JOB}>+ New job…</option>
        </select></Field>
      <Field label="Date"><input className="input" type="date" value={r.date} disabled={lock} onChange={e => set("date", e.target.value)} /></Field>
      <Field label="Technician"><input className="input" value={r.userEmail} disabled /></Field>
    </div>
    {isNewJob && <div className="card" style={{ margin: "4px 0 12px", background: "var(--canvas)" }}><div className="card-body">
      <p className="subtle" style={{ marginTop: 0 }}>Opens a sales order for this job, so its hours and parts can be invoiced like any job.</p>
      <div className="row">
        <Field label="Customer"><select className="select" value={newJob.customerId} onChange={e => setNewJob({ ...newJob, customerId: e.target.value })}>
          <option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Job #"><input className="input mono" value={newJob.jobNumber} placeholder="e.g. 4810" onChange={e => setNewJob({ ...newJob, jobNumber: e.target.value })} /></Field>
        <Field label="Customer PO #" hint="Optional"><input className="input mono" value={newJob.poNumber} onChange={e => setNewJob({ ...newJob, poNumber: e.target.value })} /></Field>
      </div>
      <Field label="Description"><input className="input" value={newJob.description} placeholder="What the job is" onChange={e => setNewJob({ ...newJob, description: e.target.value })} /></Field>
    </div></div>}

    <Field label="Problem Reported"><AutoTextarea className="input" value={r.problem} disabled={lock} onChange={e => set("problem", e.target.value)} placeholder="What the customer called about" /></Field>
    <Field label="Work Performed"><AutoTextarea className="input" value={r.workPerformed} disabled={lock} onChange={e => set("workPerformed", e.target.value)} placeholder="What was found and what was done" /></Field>
    <Field label="Follow-up Needed"><AutoTextarea className="input" value={r.followUp} disabled={lock} onChange={e => set("followUp", e.target.value)} placeholder="Optional" /></Field>

    <div className="divider"></div>
    <h4 style={{ margin: "0 0 6px" }}>Hours</h4>
    <table className="li-table"><thead><tr><th>Category</th><th className="num" style={{ width: 90 }}>Hours</th><th>Description</th><th style={{ width: 40 }}></th></tr></thead>
      <tbody>{lines.map((l, i) => <tr key={l.id}>
        <td><select className="select" value={l.categoryId} disabled={lock || l.invoiced} onChange={e => setLine(i, { categoryId: e.target.value })}>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name} ({money(c.rate)}/hr)</option>)}
          {l.categoryId && !cats.some(c => c.id === l.categoryId) && <option value={l.categoryId}>(inactive category)</option>}
        </select></td>
        <td><input className="input mono" type="number" step="0.25" style={{ textAlign: "right" }} value={l.hours} disabled={lock || l.invoiced} onChange={e => setLine(i, { hours: e.target.value })} /></td>
        <td><input className="input" value={l.description} disabled={lock || l.invoiced} placeholder="On site, travel, programming…" onChange={e => setLine(i, { description: e.target.value })} />
          {l.invoiced && <div className="subtle" style={{ fontSize: 12 }}>Invoiced — can't be changed here</div>}</td>
        <td>{!lock && !l.invoiced && <button className="btn ghost icon" title="Remove line" onClick={() => setLines(ls => ls.filter((_, x) => x !== i))}><Ico d={ICONS.x} size={14} /></button>}</td>
      </tr>)}</tbody></table>
    {!lock && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setLines(ls => [...ls, { id: uid(), categoryId: cats[0]?.id || "", hours: "", description: "" }])}>
      <Ico d={ICONS.plus} size={14} />Add Hours</button>}

    <div className="divider"></div>
    <h4 style={{ margin: "0 0 6px" }}>Parts / Materials Used</h4>
    {r.parts.length === 0 && <p className="subtle" style={{ margin: "0 0 6px" }}>None.</p>}
    {r.parts.length > 0 && <table className="li-table"><thead><tr><th className="num" style={{ width: 80 }}>Qty</th><th>Description</th>
      <th className="num" style={{ width: 120 }}>Unit Price</th><th style={{ width: 120 }} title="Add it to the job's sales order, ready to invoice">Bill customer</th><th style={{ width: 40 }}></th></tr></thead>
      <tbody>{r.parts.map((p, i) => <tr key={p.id}>
        <td><input className="input mono" type="number" step="any" style={{ textAlign: "right" }} value={p.qty} disabled={lock} onChange={e => setPart(i, { qty: e.target.value })} /></td>
        <td><input className="input" value={p.desc} disabled={lock} placeholder="Part number and description" onChange={e => setPart(i, { desc: e.target.value })} /></td>
        <td><input className="input mono" type="number" step="0.01" style={{ textAlign: "right" }} value={p.unitPrice} placeholder="0.00" disabled={lock || !!p.soLineId} onChange={e => setPart(i, { unitPrice: e.target.value })} /></td>
        <td>{p.soLineId ? <span className="subtle">On the job</span>
          : <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={!!p.bill} disabled={lock} onChange={e => setPart(i, { bill: e.target.checked })} />Bill</label>}</td>
        <td>{!lock && !p.soLineId && <button className="btn ghost icon" title="Remove part" onClick={() => setR(x => ({ ...x, parts: x.parts.filter((_, j) => j !== i) }))}><Ico d={ICONS.x} size={14} /></button>}</td>
      </tr>)}</tbody></table>}
    {!lock && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setR(x => ({ ...x, parts: [...x.parts, { id: uid(), qty: 1, desc: "", unitPrice: "", bill: false }] }))}>
      <Ico d={ICONS.plus} size={14} />Add Part</button>}
    <p className="subtle" style={{ marginBottom: 0 }}>Hours go on the job's time for approval and billing. A part ticked <b>Bill</b> with a price is added to the job's sales order, ready to invoice, when you save.</p>
  </Modal>;
}
