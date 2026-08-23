import { useState, Fragment } from "react";
import { money, fmtDate, nameOf } from "../lib/helpers.js";
import { Ico, ICONS, Badge, Empty } from "../components/ui.jsx";

// A job = a Sales Order. Track progress by marking line items ready (work done).
// Marking un-invoiced items ready raises a task for an invoicer to bill them.
export default function JobsView({ db, actions, toast, readOnly }) {
  const [open, setOpen] = useState(null);   // expanded SO id
  const jobs = db.salesOrders.filter(s => s.status === "open");

  const toggleReady = async (so, li, ready) => {
    if (await actions.setLineReady(so.id, li.id, ready)) toast(ready ? "Marked ready" : "Marked not ready");
  };

  return <div>
    <div className="card">
      <div className="card-head"><h3>Active Jobs</h3></div>
      {jobs.length === 0
        ? <Empty icon={ICONS.job} title="No active jobs" msg="Jobs are your open sales orders. Mark line items ready as the work is completed — that flags them for invoicing." />
        : <table><thead><tr><th>Job</th><th>Customer</th><th>PO #</th><th>Progress</th><th className="num">Ready / Total</th><th></th></tr></thead>
          <tbody>{jobs.slice().reverse().map(so => {
            const lines = so.lineItems || [];
            const total = lines.length;
            const ready = lines.filter(li => li.ready).length;
            const invoiced = lines.filter(li => li.invoiced).length;
            const pct = total ? Math.round((ready / total) * 100) : 0;
            const isOpen = open === so.id;
            return <Fragment key={so.id}>
              <tr className="clickable" onClick={() => setOpen(isOpen ? null : so.id)}>
                <td className="doc-id">{so.number}</td>
                <td>{nameOf(db, so.customerId)}</td>
                <td className="mono subtle">{so.poNumber || "—"}</td>
                <td style={{ minWidth: 160 }}>
                  <div style={{ height: 8, background: "var(--canvas)", borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ width: pct + "%", height: "100%", background: "var(--accent)" }}></div>
                  </div>
                  <span className="subtle" style={{ fontSize: 12 }}>{pct}% ready{invoiced ? ` · ${invoiced} invoiced` : ""}</span>
                </td>
                <td className="num mono">{ready} / {total}</td>
                <td style={{ textAlign: "right" }}><Ico d={isOpen ? ICONS.arrow : ICONS.arrow} size={14} /></td>
              </tr>
              {isOpen && <tr><td colSpan={6} style={{ background: "var(--canvas)" }}>
                <table><thead><tr><th style={{ width: 90 }}>Ready</th><th>Description</th><th className="num">Qty</th><th>Status</th></tr></thead>
                  <tbody>{lines.map(li => <tr key={li.id} style={li.closed ? { opacity: 0.55 } : {}}>
                    <td><label style={{ display: "flex", alignItems: "center", gap: 6, cursor: li.invoiced || li.closed || readOnly ? "default" : "pointer" }}>
                      <input type="checkbox" checked={!!li.ready} disabled={li.invoiced || li.closed || readOnly}
                        onChange={e => toggleReady(so, li, e.target.checked)} />
                      {li.ready ? "Ready" : ""}
                    </label></td>
                    <td>{li.desc}</td>
                    <td className="num mono">{li.qty} {li.unit}</td>
                    <td>{li.invoiced ? <Badge status="invoiced" /> : li.closed ? <Badge status="closed" /> : li.ready ? <Badge status="fulfilled" /> : <span className="subtle">in progress</span>}</td>
                  </tr>)}</tbody></table>
              </td></tr>}
            </Fragment>;
          })}</tbody></table>}
    </div>
  </div>;
}
