import { nameOf } from "../lib/helpers.js";
import { COST_CATEGORIES, jobNumberOf } from "../calc/jobs.js";
import { Field } from "./ui.jsx";

// "Which job is this a cost of, and what kind of cost": the pair every bill,
// expense and journal line uses to land in Job Costing. Open jobs are listed;
// a closed one already chosen stays selectable so editing doesn't drop it.
export const jobOptionLabel = (db, so) => [so.number, jobNumberOf(db, so), nameOf(db, so.customerId)].filter(Boolean).join(" — ");

export function JobSelect({ db, value, onChange, disabled, blank = "— none —" }) {
  const open = db.salesOrders.filter(s => s.status === "open" || s.id === value);
  return <select className="select" value={value || ""} disabled={disabled} onChange={e => onChange(e.target.value)}>
    <option value="">{blank}</option>
    {open.map(s => <option key={s.id} value={s.id}>{jobOptionLabel(db, s)}</option>)}
  </select>;
}

export function CostCategorySelect({ value, onChange, disabled }) {
  return <select className="select" value={value || ""} disabled={disabled} onChange={e => onChange(e.target.value)}>
    <option value="">Other</option>
    {COST_CATEGORIES.filter(c => c.key !== "other").map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
  </select>;
}

export default function JobCostPicker({ db, salesOrderId, costCategory, onChange, hint }) {
  return <div className="row">
    <Field label="Job (optional)" hint={hint}>
      <JobSelect db={db} value={salesOrderId} onChange={v => onChange({ salesOrderId: v })} /></Field>
    {salesOrderId && <Field label="Job Cost Category" hint="The Job Costing column this lands in">
      <CostCategorySelect value={costCategory} onChange={v => onChange({ costCategory: v })} /></Field>}
  </div>;
}
