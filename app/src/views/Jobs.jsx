import { useState, Fragment } from "react";
import { money, fmtDate, nameOf } from "../lib/helpers.js";
import { Ico, ICONS, Badge, Empty, SortTh, useTableSort } from "../components/ui.jsx";
import { jobNumberOf, jobDescriptionOf } from "../calc/jobs.js";
import JobCostsModal from "../components/JobCostsModal.jsx";

// A job = a Sales Order. Track progress by marking line items ready (work done).
// Marking un-invoiced items ready raises a task for an invoicer to bill them.
// Costs that have no bill, expense or time entry of their own are booked here.
export default function JobsView({ db, actions, toast, readOnly }) {
  const [open, setOpen] = useState(null);   // expanded SO id
  const [costsFor, setCostsFor] = useState(null);   // SO whose job costs are open
  const [showClosed, setShowClosed] = useState(false);
  const closedCount = db.salesOrders.filter(s => s.status !== "open").length;
  const jobs = db.salesOrders.filter(s => showClosed || s.status === "open");
  // Available = ready to invoice: marked ready and not yet billed or closed.
  const availableOf = so => (so.lineItems || []).filter(li => li.ready && !li.invoiced && !li.closed).length;
  const invoicedOf = so => (so.lineItems || []).filter(li => li.invoiced).length;
  const { sorted: jobRows, sort, onSort } = useTableSort(jobs.slice().reverse(), {
    number: so => so.number, job: so => jobNumberOf(db, so), desc: so => jobDescriptionOf(db, so),
    customer: so => nameOf(db, so.customerId), po: so => so.poNumber || "",
    progress: so => { const t = (so.lineItems || []).length; return t ? invoicedOf(so) / t : 0; },
    available: so => availableOf(so),
  });

  const toggleReady = async (so, li, ready) => {
    if (await actions.setLineReady(so.id, li.id, ready)) toast(ready ? "Marked ready" : "Marked not ready");
  };

  return <div>
    <div className="card">
      <div className="card-head"><h3>{showClosed ? "Jobs" : "Active Jobs"}</h3>
        {closedCount > 0 && <label className="subtle" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />Show closed ({closedCount})</label>}</div>
      {jobs.length === 0
        ? <Empty icon={ICONS.job} title="No active jobs" msg="Jobs are your open sales orders. Mark line items ready as the work is completed — that flags them for invoicing." />
        : <table><thead><tr>
          <SortTh label="SO #" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Job #" col="job" sort={sort} onSort={onSort} />
          <SortTh label="Description" col="desc" sort={sort} onSort={onSort} />
          <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
          <SortTh label="PO #" col="po" sort={sort} onSort={onSort} />
          <SortTh label="Progress" col="progress" sort={sort} onSort={onSort} />
          <SortTh label="Available / Total" col="available" sort={sort} onSort={onSort} num />
          <th></th></tr></thead>
          <tbody>{jobRows.map(so => {
            const lines = so.lineItems || [];
            const total = lines.length;
            const available = availableOf(so);
            const invoiced = invoicedOf(so);
            // The bar fills as lines are billed; the available share shows ahead of it.
            const pctInv = total ? (invoiced / total) * 100 : 0;
            const pctAvail = total ? (available / total) * 100 : 0;
            const isOpen = open === so.id;
            return <Fragment key={so.id}>
              <tr className="clickable" onClick={() => setOpen(isOpen ? null : so.id)}>
                <td className="doc-id">{so.number}</td>
                <td className="mono">{jobNumberOf(db, so) || <span className="subtle">—</span>}</td>
                <td>{jobDescriptionOf(db, so) || <span className="subtle">—</span>}</td>
                <td>{nameOf(db, so.customerId)}</td>
                <td className="mono subtle">{so.poNumber || "—"}</td>
                <td style={{ minWidth: 160 }}>
                  <div style={{ height: 8, background: "var(--canvas)", borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ display: "flex", height: "100%" }}>
                      <div style={{ width: pctInv + "%", background: "var(--billed)" }}></div>
                      <div style={{ width: pctAvail + "%", background: "var(--accent)" }}></div>
                    </div>
                  </div>
                  <span className="subtle" style={{ fontSize: 12 }}>{available} available · {invoiced} invoiced</span>
                </td>
                <td className="num mono">{available} / {total}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn ghost icon" title="Job costs — what's been spent on this job" onClick={e => { e.stopPropagation(); setCostsFor(so); }}><Ico d={ICONS.money} size={15} /></button>
                  <Ico d={ICONS.arrow} size={14} /></td>
              </tr>
              {isOpen && <tr><td colSpan={8} style={{ background: "var(--canvas)" }}>
                <table><thead><tr><th style={{ width: 90 }}>Ready</th><th>Description</th><th className="num">Qty</th><th>Status</th></tr></thead>
                  <tbody>{lines.map(li => <tr key={li.id} style={li.closed ? { opacity: 0.55 } : {}}>
                    <td><label style={{ display: "flex", alignItems: "center", gap: 6, cursor: li.invoiced || li.closed || readOnly ? "default" : "pointer" }}>
                      <input type="checkbox" checked={!!li.ready} disabled={li.invoiced || li.closed || readOnly}
                        onChange={e => toggleReady(so, li, e.target.checked)} />
                      {li.ready ? "Ready" : ""}
                    </label></td>
                    <td style={{ whiteSpace: "pre-line" }}>{li.desc}</td>
                    <td className="num mono">{li.qty} {li.unit}</td>
                    <td>{li.invoiced ? <Badge status="invoiced" /> : li.closed ? <Badge status="closed" /> : li.ready ? <Badge status="ready" /> : <span className="subtle">in progress</span>}</td>
                  </tr>)}</tbody></table>
              </td></tr>}
            </Fragment>;
          })}</tbody></table>}
    </div>
    {costsFor && <JobCostsModal db={db} actions={actions} toast={toast} readOnly={readOnly}
      so={db.salesOrders.find(s => s.id === costsFor.id) || costsFor} onClose={() => setCostsFor(null)} />}
  </div>;
}
