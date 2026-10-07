import { useState } from "react";
import { uid, money, fmtDate, todayISO, sum } from "../lib/helpers.js";
import { round2 } from "../calc/ledger.js";
import { COST_CATEGORIES, costLabel, jobCostItems, jobNumberOf, jobDescriptionOf, soSummary } from "../calc/jobs.js";
import { CostCategorySelect } from "./JobCostPicker.jsx";
import { Ico, ICONS, Empty, Modal, Field } from "./ui.jsx";

// Everything booked to one job, wherever it was booked, with the costs that
// have no document of their own entered here. Bills, expenses, time and
// journal lines are edited where they live; this lists them so the job's
// cost reads in one place.
export default function JobCostsModal({ db, actions, toast, so, readOnly, onClose }) {
  const [edit, setEdit] = useState(null);
  const items = jobCostItems(db, so);
  const total = round2(sum(items, i => i.amount));
  const amount = soSummary(db, so).amount;
  const byCat = COST_CATEGORIES.map(c => ({ ...c, amount: round2(sum(items.filter(i => i.category === c.key), i => i.amount)) })).filter(c => c.amount);

  const startNew = () => setEdit({ id: uid(), _new: true, salesOrderId: so.id, date: todayISO(), category: "panel", description: "", hours: "", amount: "", source: "manual" });
  const save = async () => {
    if (await actions.saveJobCost({ ...edit, hours: Number(edit.hours) || 0, amount: Number(edit.amount) || 0 })) { toast("Job cost saved"); setEdit(null); }
  };
  const del = async (id) => {
    if (!confirm("Delete this job cost?")) return;
    if (await actions.deleteJobCost(id)) toast("Job cost deleted");
  };
  const title = [so.number, jobNumberOf(db, so)].filter(Boolean).join(" · ");

  return <Modal title={"Job Costs · " + title} onClose={onClose} wide foot={<>
    <span className="subtle" style={{ marginRight: "auto" }}>{jobDescriptionOf(db, so)}</span>
    <button className="btn" onClick={onClose}>Close</button>
    {!readOnly && <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />Add Cost</button>}
  </>}>
    <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 14 }}>
      <div className="stat"><div className="lbl">Sales Order</div><div className="val mono">{money(amount)}</div></div>
      <div className="stat"><div className="lbl">Cost to Date</div><div className="val mono">{money(total)}</div></div>
      <div className="stat"><div className="lbl">Profit</div><div className="val mono" style={{ color: amount - total >= 0 ? "var(--pos)" : "var(--neg)" }}>{money(round2(amount - total))}</div></div>
    </div>
    {byCat.length > 0 && <p className="subtle" style={{ margin: "0 0 10px" }}>{byCat.map(c => `${c.label} ${money(c.amount)}`).join(" · ")}</p>}

    {edit && <div className="card" style={{ marginBottom: 14 }}><div className="card-body">
      <div className="row">
        <Field label="Date"><input className="input" type="date" value={edit.date} onChange={e => setEdit({ ...edit, date: e.target.value })} /></Field>
        <Field label="Category"><CostCategorySelect value={edit.category} onChange={v => setEdit({ ...edit, category: v || "other" })} /></Field>
        <Field label="Hours" hint="Optional"><input className="input mono" type="number" step="0.25" value={edit.hours} onChange={e => setEdit({ ...edit, hours: e.target.value })} /></Field>
        <Field label="Amount"><input className="input mono" type="number" step="0.01" value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value })} /></Field>
      </div>
      <Field label="Description"><input className="input" value={edit.description} placeholder="Panel shop quote, cables from stock…" onChange={e => setEdit({ ...edit, description: e.target.value })} /></Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn primary" onClick={save}>{edit._new ? "Add Cost" : "Save Cost"}</button>
      </div>
    </div></div>}

    {items.length === 0
      ? <Empty icon={ICONS.money} title="No costs on this job yet"
        msg="Add a cost here, tag a vendor bill or an expense to the job, log time to it, or name it on a journal entry line." />
      : <table><thead><tr><th>Date</th><th>Source</th><th>Category</th><th>Description</th><th className="num">Hours</th><th className="num">Amount</th><th></th></tr></thead>
        <tbody>{items.map(i => <tr key={i.source + i.id}>
          <td className="subtle">{fmtDate(i.date)}</td>
          <td className="subtle">{i.source}</td>
          <td>{costLabel(i.category)}</td>
          <td>{i.desc || <span className="subtle">—</span>}</td>
          <td className="num mono">{i.hours ? i.hours : ""}</td>
          <td className="num mono">{money(i.amount)}</td>
          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            {i.editable && !readOnly && <>
              <button className="btn ghost icon" title="Edit" onClick={() => setEdit({ ...(db.jobCosts || []).find(c => c.id === i.id) })}><Ico d={ICONS.edit} size={14} /></button>
              <button className="btn ghost icon" title="Delete" onClick={() => del(i.id)}><Ico d={ICONS.trash} size={14} /></button>
            </>}
          </td>
        </tr>)}
          <tr><td colSpan={5} style={{ fontWeight: 700 }}>Total</td><td className="num mono" style={{ fontWeight: 700 }}>{money(total)}</td><td></td></tr>
        </tbody></table>}
  </Modal>;
}
