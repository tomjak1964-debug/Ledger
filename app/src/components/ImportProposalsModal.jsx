import { useState, useMemo, useRef } from "react";
import { uid, money, todayISO } from "../lib/helpers.js";
import { proposalConfig, priceProposal, ioBlocks, TMJ_DEFAULT_RATES } from "../calc/proposals.js";
import { readChartFile, parseDelimited, mapChart, matchMachineType, typeKey } from "../lib/quoteChart.js";
import { Ico, ICONS, Modal, Field } from "./ui.jsx";

// Write a whole quote chart into proposals: one row per machine, priced by the
// same rules the chart itself uses, reviewed before anything is written.
export default function ImportProposalsModal({ db, actions, toast, onClose, onDone }) {
  const cfg = proposalConfig(db.settings);
  const customers = db.contacts.filter(c => c.type === "customer");
  // Venture Global is the customer this chart is for, so pick it if it's there.
  const guess = customers.find(c => /venture\s*global/i.test(c.name)) || customers[0];
  const [customerId, setCustomerId] = useState(guess?.id || "");
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState(null);       // [{ rec, machineTypeId, take }]
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const fileRef = useRef();

  const load = (chartRows) => {
    try {
      const recs = mapChart(chartRows);
      if (!recs.length) throw new Error("No machine rows found under the headings.");
      setRows(recs.map(rec => ({
        rec, take: true,
        machineTypeId: matchMachineType(rec.typeName, db.machineTypes)?.id || "",
      })));
      setErr("");
    } catch (e) { setErr(e.message); setRows(null); }
  };
  const onFile = async (file) => {
    if (!file) return;
    try { load(await readChartFile(file)); }
    catch (e) { setErr("Couldn't read that file — " + e.message); }
  };

  // Machine types the chart names that aren't set up yet. Where TMJ's own rate
  // card has one by that name, it can be added here rather than in Settings.
  const missing = useMemo(() => {
    if (!rows) return [];
    const names = new Map();
    for (const r of rows) {
      if (r.machineTypeId || !r.rec.typeName) continue;
      const known = TMJ_DEFAULT_RATES.find(d => typeKey(d.name) === typeKey(r.rec.typeName));
      if (known && !names.has(known.name)) names.set(known.name, known);
    }
    return [...names.values()];
  }, [rows]);

  const priced = (r) => {
    const mt = db.machineTypes.find(m => m.id === r.machineTypeId);
    const { blocks } = ioBlocks(r.rec.specs, cfg);
    // The chart's own I/O block column is this same formula, so it only rides
    // along as an override when the estimator has overruled it.
    const override = r.rec.ioBlocks === "" || r.rec.ioBlocks === blocks ? "" : r.rec.ioBlocks;
    const specs = { ...r.rec.specs, ioBlocks: override };
    return { mt, blocks, specs, pricing: priceProposal(mt, specs, cfg) };
  };

  const taken = rows ? rows.filter(r => r.take) : [];
  const ready = taken.filter(r => r.machineTypeId);
  const total = ready.reduce((s, r) => s + priced(r).pricing.total, 0);

  const addMissing = async () => {
    setBusy(true);
    const added = await actions.seedMachineRates(missing);
    setBusy(false);
    if (added == null) return;
    toast(missing.map(m => m.name).join(" and ") + " added to Machine Rates");
    // Re-match now that the types exist.
    setRows(rs => rs.map(r => r.machineTypeId ? r : {
      ...r, machineTypeId: matchMachineType(r.rec.typeName, [...db.machineTypes, ...added])?.id || "",
    }));
  };

  // Written one at a time on purpose: each proposal claims its own number.
  const run = async () => {
    setBusy(true);
    const out = [];
    for (const r of ready) {
      const { specs, pricing } = priced(r);
      const { rec } = r;
      const note = [rec.quoteNumber && "Quote " + rec.quoteNumber, rec.endUser && "End user: " + rec.endUser]
        .filter(Boolean).join(" · ");
      const saved = await actions.saveProposal({
        id: uid(), _new: true, customerId, contactPersonId: "",
        contactName: db.contacts.find(c => c.id === customerId)?.contact || "",
        date, status: "draft", jobNumber: rec.jobNumber || "", description: rec.description || "",
        location: rec.location || cfg.location, machineTypeId: r.machineTypeId,
        specs, pricing, phases: cfg.phases.map(ph => ({ ...ph })), notes: note,
      });
      out.push({ rec, saved, total: pricing.total });
    }
    setBusy(false);
    setResults(out);
    const made = out.filter(o => o.saved).length;
    toast(made ? `${made} proposal${made === 1 ? "" : "s"} created` : "No proposals created");
    if (made) onDone?.();
  };

  if (results) return <Modal wide title={`${results.filter(r => r.saved).length} Proposals Created`} onClose={onClose}
    foot={<button className="btn primary" onClick={onClose}><Ico d={ICONS.check} size={15} />Done</button>}>
    <table><thead><tr><th>Proposal</th><th>Quote</th><th>Job</th><th>Description</th><th className="num">Total</th></tr></thead>
      <tbody>{results.map((r, i) => <tr key={i}>
        <td className="doc-id">{r.saved ? r.saved.number : <span className="subtle">not created</span>}</td>
        <td className="mono subtle">{r.rec.quoteNumber || "—"}</td>
        <td className="mono subtle">{r.rec.jobNumber || "—"}</td>
        <td>{r.rec.description}</td>
        <td className="num mono">{money(r.total)}</td>
      </tr>)}</tbody></table>
  </Modal>;

  return <Modal wide title="Import Quote Chart" onClose={onClose}
    foot={<><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !ready.length || !customerId} onClick={run}>
        <Ico d={ICONS.plus} size={15} />{busy ? "Creating…" : `Create ${ready.length} Proposal${ready.length === 1 ? "" : "s"}`}</button></>}>

    {!rows && <>
      <p className="subtle" style={{ marginTop: 0 }}>One proposal per row of the chart, priced by the machine type and its content —
        the same points and I/O block rules the chart uses. Nothing is written until you've looked it over.</p>
      <div className="row">
        <Field label="Quote chart file" hint="An .xlsx straight out of Excel, or a .csv">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="input"
            onChange={e => onFile(e.target.files?.[0])} />
        </Field>
      </div>
      <Field label="…or paste the rows" hint="Select the heading row and the machines in Excel, copy, and paste here">
        <textarea className="input" rows={5} value={paste} placeholder="QUOTE NUMBER	Job Number	Description	…"
          onChange={e => setPaste(e.target.value)} />
      </Field>
      {paste.trim() && <button className="btn" onClick={() => load(parseDelimited(paste))}>Read pasted rows</button>}
    </>}

    {err && <p style={{ color: "var(--neg)", fontWeight: 500 }}>{err}</p>}

    {rows && <>
      <div className="row">
        <Field label="Customer"><select className="select" value={customerId} onChange={e => setCustomerId(e.target.value)}>
          <option value="">— pick a customer —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Proposal date"><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></Field>
      </div>

      {missing.length > 0 && <p className="subtle" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span>The chart names {missing.map(m => m.name).join(" and ")}, which {missing.length === 1 ? "isn't" : "aren't"} in your Machine Rates yet.</span>
        <button className="btn sm primary" disabled={busy} onClick={addMissing}>Add to Machine Rates</button>
      </p>}

      <table><thead><tr>
        <th style={{ width: 34 }}><input type="checkbox" title="Select all" checked={taken.length === rows.length}
          onChange={e => setRows(rs => rs.map(r => ({ ...r, take: e.target.checked })))} /></th>
        <th>Quote</th><th>Job</th><th>Description</th><th>Machine type</th><th>Location</th>
        <th className="num">Blocks</th><th className="num">Total</th></tr></thead>
        <tbody>{rows.map((r, i) => {
          const { blocks, pricing } = priced(r);
          return <tr key={i} style={r.take ? {} : { opacity: 0.45 }}>
            <td><input type="checkbox" checked={r.take}
              onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, take: e.target.checked } : x))} /></td>
            <td className="mono subtle">{r.rec.quoteNumber || "—"}</td>
            <td className="mono subtle">{r.rec.jobNumber || "—"}</td>
            <td>{r.rec.description || "—"}</td>
            <td><select className="select" value={r.machineTypeId}
              style={r.machineTypeId ? {} : { borderColor: "var(--neg)" }}
              onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, machineTypeId: e.target.value } : x))}>
              <option value="">{r.rec.typeName ? `“${r.rec.typeName}” — pick one` : "— pick one —"}</option>
              {db.machineTypes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></td>
            <td className="subtle">{r.rec.location || "—"}</td>
            <td className="num mono subtle">{blocks}</td>
            <td className="num mono">{r.machineTypeId ? money(pricing.total) : "—"}</td>
          </tr>;
        })}</tbody></table>

      <p className="subtle" style={{ marginBottom: 0, display: "flex" }}>
        <span>{ready.length} of {rows.length} ready to write{taken.length > ready.length
          ? ` — ${taken.length - ready.length} still need a machine type` : ""}.
          Each gets its own proposal number; the chart's quote number and end user go in the notes.</span>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 600 }}>{money(total)}</span>
      </p>
    </>}
  </Modal>;
}
