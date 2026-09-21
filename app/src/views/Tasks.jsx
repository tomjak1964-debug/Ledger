import { useState, useRef } from "react";
import { money, fmtDate, nameOf } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { Ico, ICONS, Empty, Modal, SortTh, useTableSort } from "../components/ui.jsx";
import InvoiceFromSOModal from "../components/InvoiceFromSOModal.jsx";

// Work waiting on the user. Today's only task type is "create invoice" — raised
// when a job has items marked ready. Acting on it opens the invoice modal
// pre-selected to the ready items; billing them closes the task automatically.
//
// Several jobs can be billed in one go: tick them and either create every
// invoice at once, or walk them one at a time with the usual dialog so each
// can be adjusted before it is written.
export default function TasksView({ db, actions, toast, openDoc, readOnly }) {
  const [invoiceSO, setInvoiceSO] = useState(null);
  const [sel, setSel] = useState({});          // taskId -> ticked
  const [confirmBatch, setConfirmBatch] = useState(null);   // { withTime }
  const [queue, setQueue] = useState(null);    // { sos, i } — the one-by-one run
  const [results, setResults] = useState(null); // what a run produced
  const [busy, setBusy] = useState(false);
  const openTasks = (db.tasks || []).filter(t => t.status === "open");
  const soOf = t => db.salesOrders.find(s => s.id === t.salesOrderId);
  const readyLines = so => (so?.lineItems || []).filter(li => li.ready && !li.invoiced && !li.closed);
  const unbilledTime = so => (db.timeEntries || []).filter(t => t.salesOrderId === so?.id && !t.invoiceId && t.approved);
  const readyValue = t => {
    const so = soOf(t);
    return so ? lineTotals(readyLines(so), so.taxRate).total : 0;
  };
  const { sorted: taskRows, sort, onSort } = useTableSort(openTasks, {
    task: t => t.title || "Create invoice", job: t => soOf(t)?.number || "",
    customer: t => { const so = soOf(t); return so ? nameOf(db, so.customerId) : t.detail || ""; },
    value: readyValue,
  });
  const selected = taskRows.filter(t => sel[t.id] && soOf(t));

  const generate = async (so, ids, opts, print) => {
    const inv = await actions.generateInvoice(so, ids, opts);
    if (inv) { toast("Invoice " + inv.number + " generated"); if (print) openDoc("invoice", inv); }
    return inv;
  };
  const dismiss = async (t) => { if (confirm("Dismiss this task?") && await actions.setTaskStatus(t.id, "dismissed")) toast("Task dismissed"); };

  // Create every selected job's invoice in one pass. Sequential on purpose:
  // each invoice claims its number from the server before the next starts.
  const runBatch = async (withTime) => {
    setBusy(true);
    const out = [];
    for (const t of selected) {
      const so = soOf(t);
      const ids = readyLines(so).map(li => li.id);
      const timeEntryIds = withTime ? unbilledTime(so).map(e => e.id) : [];
      if (!ids.length && !timeEntryIds.length) { out.push({ so, skipped: "nothing ready to bill" }); continue; }
      const inv = await actions.generateInvoice(so, ids, { timeEntryIds });
      out.push({ so, inv, failed: !inv });
    }
    setBusy(false);
    setConfirmBatch(null);
    setSel({});
    setResults(out);
    const made = out.filter(r => r.inv).length;
    toast(made ? `${made} invoice${made === 1 ? "" : "s"} created` : "No invoices created");
  };

  // One-by-one: the usual dialog, once per job, with Skip and Stop. What the run
  // has created lives in a ref, not state: the dialog generates and closes in
  // the same tick, so a state read here would be one invoice behind.
  const made = useRef([]);
  const startQueue = () => { made.current = []; setQueue({ sos: selected.map(soOf), i: 0 }); };
  const finishQueue = () => {
    setQueue(null);
    setSel({});
    if (made.current.length) setResults(made.current.slice());
  };
  // The dialog calls onClose after a successful generate too, so advancing
  // belongs here and nowhere else — otherwise a job gets skipped.
  const advance = () => setQueue(q => {
    if (!q) return null;
    if (q.i + 1 >= q.sos.length) { queueMicrotask(finishQueue); return q; }
    return { ...q, i: q.i + 1 };
  });

  return <div>
    {selected.length > 0 && <div className="toolbar">
      <span style={{ fontWeight: 600 }}>{selected.length} job{selected.length === 1 ? "" : "s"} selected</span>
      <span className="subtle">{money(selected.reduce((s, t) => s + readyValue(t), 0))} ready to bill</span>
      <button className="btn primary" style={{ marginLeft: "auto" }} disabled={readOnly} onClick={() => setConfirmBatch({ withTime: true })}>
        <Ico d={ICONS.inv} size={15} />Create {selected.length} Invoice{selected.length === 1 ? "" : "s"}</button>
      <button className="btn" disabled={readOnly} onClick={startQueue}>Review One by One</button>
      <button className="btn ghost" onClick={() => setSel({})}>Clear</button>
    </div>}

    <div className="card">
      <div className="card-head"><h3>Open Tasks</h3></div>
      {openTasks.length === 0
        ? <Empty icon={ICONS.task} title="All clear" msg="When someone marks a job's items ready to invoice, a task shows up here for whoever can create invoices." />
        : <table><thead><tr>
          <th style={{ width: 34 }}><input type="checkbox" title="Select all"
            checked={selected.length > 0 && selected.length === taskRows.filter(t => soOf(t)).length}
            onChange={e => setSel(e.target.checked ? Object.fromEntries(taskRows.filter(t => soOf(t)).map(t => [t.id, true])) : {})} /></th>
          <SortTh label="Task" col="task" sort={sort} onSort={onSort} />
          <SortTh label="Job" col="job" sort={sort} onSort={onSort} />
          <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
          <SortTh label="Ready to bill" col="value" sort={sort} onSort={onSort} num />
          <th></th></tr></thead>
          <tbody>{taskRows.map(t => {
            const so = soOf(t);
            const lines = readyLines(so);
            return <tr key={t.id}>
              <td>{so && <input type="checkbox" checked={!!sel[t.id]} onChange={e => setSel(s => ({ ...s, [t.id]: e.target.checked }))} />}</td>
              <td>{t.title || "Create invoice"}</td>
              <td className="doc-id">{so ? so.number : "—"}</td>
              <td>{so ? nameOf(db, so.customerId) : t.detail}</td>
              <td className="num mono">{lines.length ? money(lineTotals(lines, so.taxRate).total) : "—"}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && so && <button className="btn sm primary" onClick={() => setInvoiceSO(so)}><Ico d={ICONS.inv} size={14} />Create Invoice</button>}
                {!readOnly && <button className="btn ghost sm" onClick={() => dismiss(t)}>Dismiss</button>}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>

    {confirmBatch && <Modal title={`Create ${selected.length} Invoice${selected.length === 1 ? "" : "s"}`} onClose={() => setConfirmBatch(null)}
      foot={<><button className="btn" disabled={busy} onClick={() => setConfirmBatch(null)}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => runBatch(confirmBatch.withTime)}>
          {busy ? "Creating…" : `Create ${selected.length} Invoice${selected.length === 1 ? "" : "s"}`}</button></>}>
      <p className="subtle" style={{ marginTop: 0 }}>One invoice per job, billing the items marked ready. Each is numbered and dated today,
        on that customer's terms. Nothing is printed — the invoices are listed afterwards so you can print what you need.</p>
      <table><thead><tr><th>Job</th><th>Customer</th><th className="num">Lines</th><th className="num">Time</th><th className="num">Invoice</th></tr></thead>
        <tbody>{selected.map(t => {
          const so = soOf(t);
          const lines = readyLines(so);
          const time = unbilledTime(so);
          const hours = time.reduce((s, e) => s + (Number(e.hours) || 0), 0);
          const timeVal = confirmBatch.withTime ? time.reduce((s, e) => s + (Number(e.hours) || 0) * (Number(e.rate) || 0), 0) : 0;
          const sub = lines.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0) + timeVal;
          return <tr key={t.id}>
            <td className="doc-id">{so.number}</td>
            <td>{nameOf(db, so.customerId)}</td>
            <td className="num mono">{lines.length}</td>
            <td className="num mono subtle">{time.length && confirmBatch.withTime ? hours + " hr" : "—"}</td>
            <td className="num mono">{money(sub * (1 + (Number(so.taxRate) || 0) / 100))}</td>
          </tr>;
        })}</tbody></table>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <input type="checkbox" checked={confirmBatch.withTime} onChange={e => setConfirmBatch({ withTime: e.target.checked })} />
        Include approved unbilled time on these invoices
      </label>
    </Modal>}

    {results && <Modal title={`${results.filter(r => r.inv).length} Invoice${results.filter(r => r.inv).length === 1 ? "" : "s"} Created`} onClose={() => setResults(null)}
      foot={<button className="btn primary" onClick={() => setResults(null)}><Ico d={ICONS.check} size={15} />Done</button>}>
      <table><thead><tr><th>Job</th><th>Invoice</th><th>Date</th><th className="num">Total</th><th></th></tr></thead>
        <tbody>{results.map((r, i) => <tr key={i}>
          <td className="doc-id">{r.so?.number || "—"}</td>
          <td className="doc-id">{r.inv ? r.inv.number : <span className="subtle">{r.skipped || "not created"}</span>}</td>
          <td className="subtle">{r.inv ? fmtDate(r.inv.date) : "—"}</td>
          <td className="num mono">{r.inv ? money(lineTotals(r.inv.lineItems, r.inv.taxRate).total) : "—"}</td>
          <td style={{ textAlign: "right" }}>{r.inv &&
            <button className="btn sm" onClick={() => openDoc("invoice", r.inv)}><Ico d={ICONS.print} size={14} />Print</button>}</td>
        </tr>)}</tbody></table>
      {results.some(r => r.failed) && <p className="subtle" style={{ marginBottom: 0, color: "var(--neg)" }}>
        A job with no invoice against it wasn't written — the reason was shown at the time. Its task is still open, so nothing is lost.</p>}
    </Modal>}

    {queue && queue.sos[queue.i] && <InvoiceFromSOModal so={queue.sos[queue.i]} db={db} onlyReady
      queue={{ index: queue.i + 1, total: queue.sos.length, onStop: finishQueue }}
      onClose={advance}
      onGenerate={async (ids, opts, print) => {
        const so = queue.sos[queue.i];
        const inv = await generate(so, ids, opts, print);
        if (inv) made.current.push({ so, inv });
        return inv;   // the dialog closes on success, which advances the run
      }}
      onCloseLine={async (lineId, closed) => { const so = queue.sos[queue.i]; if (await actions.setLineClosed(so.id, lineId, closed)) toast(closed ? "Line closed" : "Line reopened"); }} />}

    {invoiceSO && <InvoiceFromSOModal so={invoiceSO} db={db} onlyReady onClose={() => setInvoiceSO(null)}
      onGenerate={(ids, opts, print) => generate(invoiceSO, ids, opts, print)}
      onCloseLine={async (lineId, closed) => { if (await actions.setLineClosed(invoiceSO.id, lineId, closed)) toast(closed ? "Line closed" : "Line reopened"); }} />}
  </div>;
}
