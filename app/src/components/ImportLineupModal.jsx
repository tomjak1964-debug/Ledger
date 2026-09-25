import { useState, useMemo, useRef } from "react";
import { uid, money, todayISO, fmtDate } from "../lib/helpers.js";
import { proposalConfig } from "../calc/proposals.js";
import { newEstimate, priceEstimate, derivedIo, DEVICE_FIELDS, STRUCTURE_FIELDS, LINEUP_FIELDS, SAFETY_OPTIONS, contentSummary } from "../calc/estimates.js";
import { readLineupFile, textLines, parseLineup, driversFromLineup, lineupAssumptions, guessCustomer } from "../lib/lineup.js";
import { Ico, ICONS, Modal, Field } from "./ui.jsx";

// Turn Electrical Engineering Line-ups into controls estimates: drop the PDFs
// (or paste one's text), check what was read off each, correct any count, and
// write them. Every number on the review panel is what the estimate will be
// priced on, so nothing is written until it has been looked at.

// The table shows the first few things counted; the full list is the tooltip
// and the review panel.
const shortContent = drivers => { const parts = contentSummary(drivers).split(" · "); return parts.slice(0, 4).join(" · ") + (parts.length > 4 ? " · …" : ""); };
const stateOf = addr => (String(addr || "").match(/\b([A-Z]{2})\.?\s+\d{5}/) || [])[1] || "";
const cityLine = addr => String(addr || "").split("\n").map(t => t.trim()).filter(Boolean).pop() || "";

export default function ImportLineupModal({ db, actions, toast, onClose, onDone }) {
  const cfg = proposalConfig(db.settings);
  const customers = db.contacts.filter(c => c.type === "customer");
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState([]);     // [{ id, fileName, header, drivers, notes, evidence, take }]
  const [sel, setSel] = useState(0);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const fileRef = useRef();
  const customer = customers.find(c => c.id === customerId);
  // A start-up at a customer in the same state is a drive, not a trip.
  const local = customer && stateOf(customer.address) && stateOf(customer.address) === stateOf(db.settings.companyAddress);

  const addParsed = (parsedList) => {
    setRows(rs => {
      const next = [...rs, ...parsedList.map(r => ({
        id: uid(), fileName: r.fileName, header: r.header, notes: r.notes, evidence: r.evidence, take: true,
        // null = follow the customer: a local start-up has no travel & living
        drivers: { ...driversFromLineup(r), travelIncluded: null },
      }))];
      if (!rs.length) setSel(0);
      return next;
    });
    setErr("");
  };
  const onFiles = async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    setBusy(true);
    const out = [], bad = [];
    for (const f of list) {
      try {
        const lines = await readLineupFile(f);
        const r = parseLineup(lines, { fileName: f.name });
        if (!customerId) { const g = guessCustomer(lines, customers); if (g) setCustomerId(g.id); }
        if (!r.header.customerJob && !r.header.fixture && !(r.io.inputs + r.io.outputs)) bad.push(f.name + " (no lineup fields found)");
        else out.push(r);
      } catch (e) { bad.push(f.name + " — " + (e.message || e)); }
    }
    setBusy(false);
    if (out.length) addParsed(out);
    if (bad.length) setErr("Couldn't read: " + bad.join("; "));
    if (fileRef.current) fileRef.current.value = "";
  };
  const onPaste = () => {
    const lines = textLines(paste);
    const r = parseLineup(lines, { fileName: "pasted lineup" });
    if (!customerId) { const g = guessCustomer(lines, customers); if (g) setCustomerId(g.id); }
    addParsed([r]); setPaste("");
  };

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const setDriver = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, drivers: { ...r.drivers, [k]: v } } : r));
  const setHeader = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, header: { ...r.header, [k]: v } } : r));

  const travelOn = r => r.drivers.travelIncluded == null ? !local : r.drivers.travelIncluded !== false;
  const specsFor = (r) => ({
    ...newEstimate(cfg), drivers: { ...r.drivers, travelIncluded: travelOn(r) }, lineup: r.header,
    assumptions: [...lineupAssumptions({ header: r.header, notes: r.notes }, customer?.name), ...cfg.assumptions],
  });
  const priced = useMemo(() => rows.map(r => priceEstimate(specsFor(r), cfg)), [rows, cfg, customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const taken = rows.filter(r => r.take);
  const total = rows.reduce((t, r, i) => t + (r.take ? priced[i].total : 0), 0);

  // Written one at a time on purpose: each estimate claims its own number.
  const run = async () => {
    setBusy(true);
    const out = [];
    const location = customer ? [customer.name, cityLine(customer.address)].filter(Boolean).join(", ") : "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; if (!r.take) continue;
      const specs = specsFor(r);
      const pricing = priceEstimate(specs, cfg);
      const note = [r.fileName && "From lineup " + r.fileName, r.header.endUser && "End user: " + r.header.endUser,
        r.header.references && "Reference jobs: " + r.header.references].filter(Boolean).join(" · ");
      const saved = await actions.saveProposal({
        id: uid(), _new: true, kind: "controls", rev: 0, customerId, contactPersonId: "", contactName: customer?.contact || "",
        date, status: "draft", jobNumber: r.header.customerJob ? String(r.header.customerJob) : "", description: r.header.fixture || "",
        location, machineTypeId: "", specs, pricing, phases: cfg.controlsPhases.engineering.map(ph => ({ ...ph })), notes: note,
      });
      out.push({ r, saved, total: pricing.total });
    }
    setBusy(false);
    setResults(out);
    const made = out.filter(o => o.saved).length;
    toast(made ? `${made} estimate${made === 1 ? "" : "s"} created` : "No estimates created");
    if (made) onDone?.();
  };

  if (results) return <Modal wide title={`${results.filter(r => r.saved).length} Estimates Created`} onClose={onClose}
    foot={<button className="btn primary" onClick={onClose}><Ico d={ICONS.check} size={15} />Done</button>}>
    <table><thead><tr><th>Estimate</th><th>Job</th><th>Fixture</th><th className="num">Total</th></tr></thead>
      <tbody>{results.map((x, i) => <tr key={i}>
        <td className="doc-id">{x.saved ? x.saved.number : <span className="subtle">not created</span>}</td>
        <td className="mono subtle">{x.r.header.customerJob || "—"}</td>
        <td>{x.r.header.fixture || "—"}</td>
        <td className="num mono">{money(x.total)}</td>
      </tr>)}</tbody></table>
  </Modal>;

  const cur = rows[sel];
  const curPrice = priced[sel];
  const dio = cur ? derivedIo(cur.drivers) : null;

  return <Modal wide title="Import Lineup" onClose={onClose}
    foot={<><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !taken.length || !customerId} onClick={run}>
        <Ico d={ICONS.plus} size={15} />{busy ? "Working…" : `Create ${taken.length} Estimate${taken.length === 1 ? "" : "s"}`}</button></>}>

    <p className="subtle" style={{ marginTop: 0 }}>One controls estimate per lineup. The counts are read off the lineup's component lists and I/O tally
      and priced by the hour model; check them on the review panel and correct anything before creating.</p>
    <div className="row">
      <Field label="Lineup files" hint="PDFs as issued, or .txt — several at once">
        <input ref={fileRef} type="file" multiple accept=".pdf,.txt" className="input" disabled={busy} onChange={e => onFiles(e.target.files)} />
      </Field>
      <Field label="Customer"><select className="select" value={customerId} onChange={e => setCustomerId(e.target.value)}>
        <option value="">— pick a customer —</option>
        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></Field>
      <Field label="Estimate date"><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></Field>
    </div>
    {!rows.length && <Field label="…or paste a lineup's text" hint="Select all in the PDF, copy, paste here">
      <textarea className="input" rows={4} value={paste} onChange={e => setPaste(e.target.value)} />
      {paste.trim() && <button className="btn" style={{ marginTop: 6 }} onClick={onPaste}>Read pasted lineup</button>}
    </Field>}
    {err && <p style={{ color: "var(--neg)", fontWeight: 500 }}>{err}</p>}

    {rows.length > 0 && <>
      <table><thead><tr>
        <th style={{ width: 34 }}><input type="checkbox" title="Select all" checked={taken.length === rows.length}
          onChange={e => setRows(rs => rs.map(r => ({ ...r, take: e.target.checked })))} /></th>
        <th>Job</th><th>Fixture</th><th>End user</th><th className="num">I/O</th><th>Content</th><th className="num">Hours</th><th className="num">Total</th><th></th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id} style={r.take ? {} : { opacity: 0.45 }} className={i === sel ? "active" : ""}>
          <td><input type="checkbox" checked={r.take} onChange={e => setRow(i, { take: e.target.checked })} /></td>
          <td className="mono">{r.header.customerJob || "—"}</td>
          <td>{r.header.fixture || <span className="subtle">{r.fileName}</span>}</td>
          <td className="subtle">{r.header.endUser || "—"}</td>
          <td className="num mono">{r.drivers.ioDiscrete === "" ? <span className="subtle">{derivedIo(r.drivers).total}*</span> : r.drivers.ioDiscrete}</td>
          <td className="subtle" style={{ fontSize: 12, minWidth: 220 }} title={contentSummary(r.drivers)}>{shortContent(r.drivers)}</td>
          <td className="num mono">{priced[i].hoursTotal}</td>
          <td className="num mono" style={{ fontWeight: 600 }}>{money(priced[i].total)}</td>
          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <button className="btn sm" onClick={() => setSel(i)}>{i === sel ? "Reviewing" : "Review"}</button>
            <button className="btn ghost icon" title="Remove" onClick={() => { setRows(rs => rs.filter((_, j) => j !== i)); setSel(0); }}><Ico d={ICONS.trash} size={14} /></button>
          </td>
        </tr>)}</tbody></table>
      <p className="subtle" style={{ display: "flex", marginBottom: 4 }}>
        <span>{taken.length} of {rows.length} will be written{local ? " — start-up is local, so no travel & living" : ""}. * I/O derived from the devices.</span>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 600 }}>{money(total)}</span>
      </p>

      {cur && <div className="card" style={{ marginTop: 8 }}>
        <div className="card-head"><h3>Review — {cur.header.customerJob || cur.fileName}</h3>
          <span className="mono" style={{ marginLeft: "auto", fontWeight: 700 }}>{money(curPrice.total)}</span></div>
        <div className="card-body">
          <div className="row">
            {LINEUP_FIELDS.map(([k, label]) => <Field key={k} label={label}>
              <input className="input" value={cur.header[k] ?? ""} onChange={e => setHeader(sel, k, e.target.value)} /></Field>)}
          </div>
          <div className="subtle" style={{ fontWeight: 600, margin: "6px 0" }}>I/O and safety</div>
          <div className="row">
            <Field label="Discrete I/O" hint={`lineup tally; blank = derived ${dio.total} (${dio.inputs} in / ${dio.outputs} out)`}>
              <input className="input mono" type="number" min="0" value={cur.drivers.ioDiscrete ?? ""} placeholder={String(dio.total)} onChange={e => setDriver(sel, "ioDiscrete", e.target.value)} /></Field>
            <Field label="Analog / IO-Link points"><input className="input mono" type="number" min="0" value={cur.drivers.ioAnalog ?? 0} onChange={e => setDriver(sel, "ioAnalog", e.target.value)} /></Field>
            <Field label="Safety system"><select className="select" value={cur.drivers.safety} onChange={e => setDriver(sel, "safety", e.target.value)}>
              {SAFETY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Reuse from reference job (%)"><input className="input mono" type="number" min="0" max="90" value={cur.drivers.reusePct ?? 0} onChange={e => setDriver(sel, "reusePct", e.target.value)} /></Field>
          </div>
          <div className="subtle" style={{ fontWeight: 600, margin: "6px 0" }}>Devices</div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {DEVICE_FIELDS.map(f => <Field key={f.key} label={f.label} hint={f.hint || undefined}>
              <input className="input mono" type="number" min="0" value={cur.drivers[f.key] ?? 0} onChange={e => setDriver(sel, f.key, e.target.value)} /></Field>)}
          </div>
          <div className="subtle" style={{ fontWeight: 600, margin: "6px 0" }}>Program, documents and start-up</div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {STRUCTURE_FIELDS.map(([k, label]) => <Field key={k} label={label}>
              <input className="input mono" type="number" min="0" value={cur.drivers[k] ?? 0} onChange={e => setDriver(sel, k, e.target.value)} /></Field>)}
            <Field label="Start-up trips"><input className="input mono" type="number" min="0" value={cur.drivers.trips} onChange={e => setDriver(sel, "trips", e.target.value)} /></Field>
            <Field label="Days per trip"><input className="input mono" type="number" min="0" step="0.5" value={cur.drivers.daysPerTrip} onChange={e => setDriver(sel, "daysPerTrip", e.target.value)} /></Field>
            <Field label="People on site"><input className="input mono" type="number" min="1" value={cur.drivers.people} onChange={e => setDriver(sel, "people", e.target.value)} /></Field>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0 8px" }}>
            <input type="checkbox" checked={travelOn(cur)} onChange={e => setDriver(sel, "travelIncluded", e.target.checked)} />Travel &amp; living applies
            {cur.drivers.travelIncluded == null && <span className="subtle">({local ? "off: start-up is local" : "on: out-of-state customer"})</span>}</label>
          <div className="row">
            <div style={{ flex: 1 }}>
              <div className="subtle" style={{ fontWeight: 600, marginBottom: 4 }}>Suggested hours</div>
              <table><tbody>{curPrice.components.filter(c => c.include).map(c => <tr key={c.key}><td>{c.label}</td><td className="num mono">{c.hours}</td><td className="num mono subtle">{money(c.amount)}</td></tr>)}
                {curPrice.field.filter(f => f.key === "travel").map(f => <tr key="t"><td>Travel &amp; living</td><td></td><td className="num mono subtle">{money(f.amount)}</td></tr>)}</tbody></table>
            </div>
            <div style={{ flex: 1 }}>
              <div className="subtle" style={{ fontWeight: 600, marginBottom: 4 }}>Read off the lineup</div>
              <div style={{ maxHeight: 220, overflow: "auto", fontSize: 12 }}>
                {cur.evidence.length ? cur.evidence.map((e, i) => <div key={i} className="subtle"><span className="mono">{e.qty}</span> {e.line} <span style={{ opacity: 0.7 }}>→ {DEVICE_FIELDS.find(f => f.key === e.key)?.label || e.key}</span></div>)
                  : <div className="subtle">No quantities found — enter the counts by hand.</div>}
                {cur.notes.length > 0 && <div style={{ marginTop: 6 }}><span className="subtle" style={{ fontWeight: 600 }}>Notes on the lineup:</span>
                  {cur.notes.slice(0, 8).map((t, i) => <div key={i} className="subtle">{t}</div>)}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>}
    </>}
  </Modal>;
}
