import { useState, useMemo } from "react";
import { uid, money, fmtDate, addDays, cls } from "../lib/helpers.js";
import { termsLabelFor } from "../lib/terms.js";
import { proposalConfig } from "../calc/proposals.js";
import { COMPONENTS, DRIVER_FIELDS, SAFETY_OPTIONS, STANDARD_ELEMENTS, ROLE_LABELS, priceEstimate, suggestAll } from "../calc/estimates.js";
import { Ico, ICONS, Field } from "../components/ui.jsx";

// The controls estimate — a job for any customer. This file holds the editor,
// the document content (shared by the screen view and the Word export) and
// the on-screen document body. The Venture Global machine proposal is
// untouched by any of it; Proposals.jsx routes on proposal.kind.

export const revLabel = p => (Number(p.rev) > 0 ? "Rev " + String.fromCharCode(64 + Number(p.rev)) : "");

const samePhases = (a, b) => a.length === b.length && a.every((x, i) => x.key === b[i].key && Number(x.pct) === Number(b[i].pct));

/* ---------------- document content ---------------- */

export function buildControlsContent(p, db) {
  const cfg = proposalConfig(db.settings);
  const customer = db.contacts.find(c => c.id === p.customerId);
  const personRec = db.contactPeople.find(x => x.id === p.contactPersonId);
  const contactName = (p.contactName || personRec?.name || customer?.contact || "").trim();
  const person = contactName ? { name: contactName, email: personRec?.email || "" } : null;
  const custName = customer?.name || "Customer";
  const salutation = (() => {
    if (!person?.name) return custName + " Team:";
    const parts = person.name.trim().split(/\s+/);
    const title = /^(Mr|Ms|Mrs|Dr)\.?$/i.test(parts[0]) ? parts[0] + " " : "";
    return (title ? title + parts[parts.length - 1] : parts[parts.length - 1]) + ":";
  })();
  const s = p.specs || {};
  const pricing = p.pricing?.total != null && p.pricing.components ? p.pricing : priceEstimate(s, cfg);
  const included = new Set(pricing.components.filter(c => c.include).map(c => c.key));
  const scope = COMPONENTS.filter(c => included.has(c.key)).map(c => ({ key: c.key, label: c.label, deliverables: c.deliverables }));
  const hardware = s.hardwareIncluded ? pricing.hardware.filter(h => String(h.desc || "").trim()) : [];
  const phases = (p.phases || []).map(ph => ({ ...ph, amount: Math.round(pricing.total * ph.pct) / 100 }));
  const terms = {
    validityDays: cfg.validityDays,
    validThrough: p.date ? addDays(p.date, cfg.validityDays) : "",
    payment: termsLabelFor(db, p.customerId),
    supportRate: cfg.supportRate,
  };
  return { cfg, customer, person, custName, salutation, pricing, scope, hardware, phases, terms,
    assumptions: s.assumptions || [], exclusions: s.exclusions || [], schedule: s.schedule || [],
    options: pricing.options, showHours: !!s.showHours, rev: revLabel(p),
    reLine: [p.jobNumber, p.description].filter(Boolean).join(" – ") };
}

/* ---------------- on-screen document body ---------------- */

const Row = ({ label, amount, sub, bold, detail }) => <tr className={cls(bold && "tot")}>
  <td>{label}{sub ? <span className="subtle" style={{ marginLeft: 8, fontSize: 12 }}>{sub}</span> : null}{detail ? <div className="subtle" style={{ fontSize: 12 }}>{detail}</div> : null}</td>
  <td className="amt">{money(amount)}</td>
</tr>;

export function ControlsDocBody({ p, db }) {
  const c = buildControlsContent(p, db);
  const s = db.settings;
  const pr = c.pricing;
  const hrs = (x) => c.showHours && x.hours != null ? `${x.hours} hr × ${money(x.rate)}` : null;
  return <div className="printable prop-doc">
    <div style={{ textAlign: "center", marginBottom: 20 }}><img src="/tmj-logo.png" alt="TMJ Engineering" style={{ width: 170 }} /></div>
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", marginBottom: 14 }}>
      <div style={{ flex: 1 }}>
        <p style={{ margin: "0 0 10px" }}>{fmtDate(p.date)}</p>
        <p style={{ whiteSpace: "pre-line", margin: 0 }}>{[c.person?.name, c.customer?.name, c.customer?.address].filter(Boolean).join("\n")}</p>
      </div>
      <table className="mono" style={{ fontSize: 12, borderCollapse: "collapse" }}><tbody>
        <tr><td className="subtle" style={{ paddingRight: 12 }}>Proposal</td><td>{p.number}{c.rev ? " " + c.rev : ""}</td></tr>
        {p.jobNumber && <tr><td className="subtle" style={{ paddingRight: 12 }}>Reference</td><td>{p.jobNumber}</td></tr>}
        <tr><td className="subtle" style={{ paddingRight: 12 }}>Valid through</td><td>{fmtDate(c.terms.validThrough)}</td></tr>
        {c.cfg.signer && <tr><td className="subtle" style={{ paddingRight: 12 }}>Prepared by</td><td>{c.cfg.signer}</td></tr>}
      </tbody></table>
    </div>
    <p className="mono" style={{ marginTop: 6 }}>Re: {c.reLine}</p>
    <p>{c.salutation}</p>
    <p>Thank you for the opportunity to provide a proposal for controls engineering services{c.hardware.length ? " and control hardware" : ""} for {p.description || "this project"}{p.location ? ` at ${p.location}` : ""}.</p>

    <h4 style={{ margin: "14px 0 4px" }}>Scope of Work</h4>
    <p style={{ marginTop: 0 }}>{s.company || "We"} will provide the following:</p>
    {c.scope.map(sc => <div key={sc.key} style={{ marginBottom: 6 }}>
      <div style={{ fontWeight: 600 }}>{sc.label}</div>
      <ul className="prop-bullets" style={{ marginTop: 2 }}>{sc.deliverables.map((d, i) => <li key={i}>{d}</li>)}</ul>
    </div>)}
    {c.hardware.length > 0 && <div style={{ marginBottom: 6 }}>
      <div style={{ fontWeight: 600 }}>Hardware Supplied</div>
      <ul className="prop-bullets" style={{ marginTop: 2 }}>{c.hardware.map((h, i) => <li key={i}>({Number(h.qty) || 0}) {h.desc}</li>)}</ul>
    </div>}

    {c.assumptions.length > 0 && <>
      <h4 style={{ margin: "14px 0 4px" }}>Assumptions and Clarifications</h4>
      <ol className="prop-bullets">{c.assumptions.map((t, i) => <li key={i}>{t}</li>)}</ol></>}
    {c.exclusions.length > 0 && <>
      <h4 style={{ margin: "14px 0 4px" }}>Exclusions</h4>
      <ol className="prop-bullets">{c.exclusions.map((t, i) => <li key={i}>{t}</li>)}</ol></>}

    <div className="prop-price">
      <h4>Pricing</h4>
      <table><tbody>
        {pr.engineering.map(x => <Row key={x.key} label={x.label} sub={hrs(x)} amount={x.amount} />)}
        <Row label="Engineering Sub Total" amount={pr.engineeringTotal} bold />
      </tbody></table>
      {pr.field.length > 0 && <table style={{ marginTop: 8 }}><tbody>
        {pr.field.map(x => <Row key={x.key} label={x.label} sub={hrs(x)} detail={x.detail} amount={x.amount} />)}
        <Row label="Field Services Sub Total" amount={pr.fieldTotal} bold />
      </tbody></table>}
      {c.hardware.length > 0 && <table style={{ marginTop: 8 }}><tbody>
        {pr.hardware.map((h, i) => <Row key={i} label={`(${Number(h.qty) || 0}) ${h.desc}`} amount={h.amount} />)}
        <Row label="Hardware Sub Total" amount={pr.hardwareTotal} bold />
      </tbody></table>}
      <table style={{ marginTop: 10 }}><tbody>
        {pr.contingency > 0 && <Row label="Contingency" amount={pr.contingency} />}
        <Row label="Total Price for this proposal is:" amount={pr.total} bold />
      </tbody></table>
      {c.options.length > 0 && <>
        <h4>Options — priced separately, not included above</h4>
        <table><tbody>{c.options.map((o, i) => <Row key={i} label={o.desc} amount={o.amount} />)}</tbody></table></>}
      {c.schedule.length > 0 && <>
        <h4>Schedule</h4>
        <table className="sched"><tbody>{c.schedule.map((m, i) => <tr key={i}><td>{m.label}</td><td className="pct" colSpan={2}>week {m.weeks} from award</td></tr>)}</tbody></table></>}
      <h4>Invoicing Schedule</h4>
      <table className="sched"><tbody>
        {c.phases.map(ph => <tr key={ph.key}><td>{ph.label}</td><td className="pct">{ph.pct}%</td><td className="amt plain">{money(ph.amount)}</td></tr>)}
      </tbody></table>
    </div>

    <h4 style={{ margin: "16px 0 4px" }}>Terms</h4>
    <p style={{ marginTop: 0 }}>This offer is firm for {c.terms.validityDays} days from the date of this proposal. Payment terms are {c.terms.payment}.
      Engineering and support beyond the scope above is available at ${c.terms.supportRate}/hour U.S. plus actual expenses.
      Any invoice more than 30 days past due will be assessed interest at the rate of 12% APR accruing monthly.</p>
    <p>I hope you find this offering favorable. If you have any questions, or require additional information, please feel free to contact me.</p>
    <p style={{ marginBottom: 30 }}>Regards,</p>
    <p>{c.cfg.signer || s.company}</p>

    <div style={{ marginTop: 26, borderTop: "1px solid #999", paddingTop: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Acceptance</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 30px", fontSize: 13 }}>
        <div>Accepted by: ________________________________</div>
        <div>Title: ________________________________</div>
        <div>Date: ________________________________</div>
        <div>Purchase Order No.: ____________________</div>
      </div>
    </div>
    <div className="doc-foot">{[s.companyAddress?.replace(/\n/g, ", "), s.companyPhone].filter(Boolean).join(" - ")}</div>
  </div>;
}

/* ---------------- editor ---------------- */

const Lines = ({ title, rows, cols, onChange, onAdd, onRemove, addLabel, extra }) => <div className="card" style={{ marginBottom: 16 }}>
  <div className="card-head"><h3>{title}</h3>{extra}</div>
  <div className="card-body" style={{ paddingTop: 0 }}>
    {rows.length > 0 && <table><thead><tr>{cols.map(c => <th key={c.key} className={c.num ? "num" : ""} style={c.width ? { width: c.width } : {}}>{c.label}</th>)}<th></th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id || i}>
        {cols.map(c => <td key={c.key} className={c.num ? "num" : ""}>
          {c.render ? c.render(r, i) : <input className={cls("input", c.num && "mono")} type={c.num ? "number" : "text"} step="any" min={c.num ? "0" : undefined}
            value={r[c.key] ?? ""} placeholder={c.placeholder} onChange={e => onChange(i, c.key, e.target.value)} />}
        </td>)}
        <td style={{ textAlign: "right" }}><button className="btn ghost icon" title="Remove" onClick={() => onRemove(i)}><Ico d={ICONS.trash} size={15} /></button></td>
      </tr>)}</tbody></table>}
    <button className="btn sm" style={{ marginTop: rows.length ? 8 : 0 }} onClick={onAdd}><Ico d={ICONS.plus} size={14} />{addLabel}</button>
  </div>
</div>;

export default function ControlsEstimateEditor({ p, db, cfg, customers, onCancel, onSave }) {
  const [x, setX] = useState(p);
  const [saving, setSaving] = useState(false);
  const [quick, setQuick] = useState("");
  const sp = x.specs;
  const set = (k, v) => setX(prev => ({ ...prev, [k]: v }));
  const setSpec = (k, v) => setX(prev => ({ ...prev, specs: { ...prev.specs, [k]: v } }));
  const setDriver = (k, v) => setSpec("drivers", { ...sp.drivers, [k]: v });
  const setComp = (k, patch) => setSpec("components", { ...sp.components, [k]: { ...sp.components[k], ...patch } });
  const people = db.contactPeople.filter(cp => cp.contactId === x.customerId);
  const pricing = useMemo(() => priceEstimate(sp, cfg), [sp, cfg]);
  const suggested = useMemo(() => suggestAll(sp.drivers, cfg.hourModel), [sp.drivers, cfg.hourModel]);
  const phasePct = (x.phases || []).reduce((t, ph) => t + (Number(ph.pct) || 0), 0);

  // Turning hardware on or off swaps the invoicing split only while the split
  // is still a stock one — a schedule the estimator has edited is left alone.
  const toggleHardware = (on) => {
    const from = on ? cfg.controlsPhases.engineering : cfg.controlsPhases.hardware;
    const to = on ? cfg.controlsPhases.hardware : cfg.controlsPhases.engineering;
    setX(prev => ({ ...prev, specs: { ...prev.specs, hardwareIncluded: on },
      phases: samePhases(prev.phases || [], from) ? to.map(ph => ({ ...ph })) : prev.phases }));
  };
  const lineList = (key) => ({
    rows: sp[key] || [],
    onChange: (i, k, v) => setSpec(key, sp[key].map((r, j) => j === i ? { ...r, [k]: v } : r)),
    onRemove: (i) => setSpec(key, sp[key].filter((_, j) => j !== i)),
  });
  const textLines = (key) => ({
    value: (sp[key] || []).join("\n"),
    onChange: e => setSpec(key, e.target.value.split("\n")),
  });
  const save = async () => { setSaving(true); await onSave({ ...x, specs: { ...sp, assumptions: sp.assumptions.filter(t => t.trim()), exclusions: sp.exclusions.filter(t => t.trim()) } }); setSaving(false); };

  return <div>
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{x._new ? "New Controls Estimate" : "Edit " + x.number + (revLabel(x) ? " " + revLabel(x) : "")}</h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving || !x.customerId} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Estimate"}</button>
      </div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
      <div className="row">
        <Field label="Customer"><select className="select" value={x.customerId} onChange={e => {
          const cid = e.target.value, cc = db.contacts.find(c => c.id === cid)?.contact || "";
          setX(prev => ({ ...prev, customerId: cid, contactPersonId: "", contactName: prev.contactName || cc }));
        }}>
          <option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Contact / Attn" hint="Type any name, or pick a suggestion">
          <input className="input" list={"attn-" + x.customerId} value={x.contactName || ""} onChange={e => set("contactName", e.target.value)} placeholder="e.g. Mr. John Murphy" />
          <datalist id={"attn-" + x.customerId}>
            {[db.contacts.find(c => c.id === x.customerId)?.contact, ...people.map(cp => cp.name)].filter(Boolean).map((n, i) => <option key={i} value={n} />)}
          </datalist>
        </Field>
        <Field label="Date"><input className="input" type="date" value={x.date} onChange={e => set("date", e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Customer Reference / RFQ"><input className="input mono" value={x.jobNumber} onChange={e => set("jobNumber", e.target.value)} placeholder="RFQ 2026-114" /></Field>
        <Field label="Description"><input className="input" value={x.description} onChange={e => set("description", e.target.value)} placeholder="Line 4 conveyor controls upgrade" /></Field>
        <Field label="Site / Start-up Location"><input className="input" value={x.location} onChange={e => set("location", e.target.value)} placeholder="Plant, City, ST" /></Field>
      </div>
    </div></div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Job Content</h3><span className="subtle" style={{ marginLeft: "auto" }}>what the hour model reads — every hour below can be overridden</span></div>
      <div className="card-body">
        <div className="row">
          {DRIVER_FIELDS.map(([k, label]) => <Field key={k} label={label}>
            <input className="input mono" type="number" min="0" value={sp.drivers[k] ?? 0} onChange={e => setDriver(k, e.target.value)} />
          </Field>)}
          <Field label="Safety system"><select className="select" value={sp.drivers.safety} onChange={e => setDriver("safety", e.target.value)}>
            {SAFETY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          {[["vision", "Vision system"], ["dataCollection", "Data collection / reporting"], ["remoteAccess", "Remote access"]].map(([k, l]) =>
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px 9px 0" }}>
              <input type="checkbox" checked={!!sp.drivers[k]} onChange={e => setDriver(k, e.target.checked)} />{l}</label>)}
        </div>
        <div className="row">
          <Field label="Start-up trips"><input className="input mono" type="number" min="0" value={sp.drivers.trips} onChange={e => setDriver("trips", e.target.value)} /></Field>
          <Field label="Days per trip"><input className="input mono" type="number" min="0" step="0.5" value={sp.drivers.daysPerTrip} onChange={e => setDriver("daysPerTrip", e.target.value)} /></Field>
          <Field label="People on site"><input className="input mono" type="number" min="1" value={sp.drivers.people} onChange={e => setDriver("people", e.target.value)} /></Field>
        </div>
      </div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Engineering Components</h3>
        <span className="mono subtle" style={{ marginLeft: "auto" }}>{pricing.hoursTotal} hr</span></div>
      <table><thead><tr><th style={{ width: 34 }}></th><th>Component</th><th>Rate as</th><th className="num">Suggested</th><th className="num">Hours</th><th className="num">$/hr</th><th className="num">Amount</th></tr></thead>
        <tbody>{pricing.components.map(c => {
          const def = COMPONENTS.find(d => d.key === c.key);
          const row = sp.components[c.key] || {};
          return <tr key={c.key} style={c.include ? {} : { opacity: 0.5 }}>
            <td><input type="checkbox" checked={c.include} onChange={e => setComp(c.key, { include: e.target.checked })} /></td>
            <td>{c.label}{def.field && <span className="subtle" style={{ marginLeft: 6, fontSize: 12 }}>field</span>}{def.optional && <span className="subtle" style={{ marginLeft: 6, fontSize: 12 }}>optional</span>}</td>
            <td className="subtle">{ROLE_LABELS[def.role]}</td>
            <td className="num mono subtle">{suggested[c.key]}</td>
            <td className="num"><input className="input mono" type="number" min="0" step="any" style={{ width: 90 }} placeholder={String(suggested[c.key])}
              value={row.hours ?? ""} onChange={e => setComp(c.key, { hours: e.target.value })} /></td>
            <td className="num"><input className="input mono" type="number" min="0" step="any" style={{ width: 90 }} placeholder={String(cfg.laborRates[def.role] ?? 0)}
              value={row.rate ?? ""} onChange={e => setComp(c.key, { rate: e.target.value })} /></td>
            <td className="num mono" style={{ fontWeight: 600 }}>{c.include ? money(c.amount) : "—"}</td>
          </tr>;
        })}</tbody></table>
      <div className="card-body subtle" style={{ paddingTop: 8 }}>Blank Hours or $/hr use the suggestion and the rate card. Start-Up / Debug hours are trips × days × people × {cfg.hourModel.hoursPerDay}; travel & living adds {money(cfg.travelPerDay)} per person-day under Field Services.</div>
    </div>

    <Lines title="Hardware" rows={sp.hardwareIncluded ? sp.hardware : []}
      extra={<label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontWeight: 500, cursor: "pointer" }}>
        <input type="checkbox" checked={!!sp.hardwareIncluded} onChange={e => toggleHardware(e.target.checked)} />Hardware included</label>}
      cols={[{ key: "desc", label: "Item", placeholder: "Control panel — enclosure, PLC, I/O, power…" }, { key: "qty", label: "Qty", num: true, width: 80 },
        { key: "unitCost", label: "Unit cost", num: true, width: 120 }, { key: "markupPct", label: "Markup %", num: true, width: 100, placeholder: String(cfg.hardwareMarkupPct) },
        { key: "amount", label: "Amount", num: true, width: 120, render: r => <span className="mono" style={{ fontWeight: 600 }}>{money(pricing.hardware.find(h => h.id === r.id)?.amount || 0)}</span> }]}
      {...lineList("hardware")}
      addLabel="Add line"
      onAdd={() => { if (!sp.hardwareIncluded) toggleHardware(true); setSpec("hardware", [...sp.hardware, { id: uid(), desc: "", qty: 1, unitCost: "", markupPct: "" }]); }} />
    {sp.hardwareIncluded && <div style={{ marginTop: -8, marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
      <select className="select" value={quick} onChange={e => setQuick(e.target.value)} style={{ maxWidth: 480 }}>
        <option value="">Add a standard control element…</option>
        {STANDARD_ELEMENTS.map((el, i) => <option key={i} value={i}>{el.desc}</option>)}
      </select>
      <button className="btn sm" disabled={quick === ""} onClick={() => { const el = STANDARD_ELEMENTS[+quick]; setSpec("hardware", [...sp.hardware, { id: uid(), desc: el.desc, qty: el.qty, unitCost: "", markupPct: "" }]); setQuick(""); }}>Add</button>
      <span className="subtle">Prices are yours to fill in — none are assumed.</span>
    </div>}

    <Lines title="Options — priced separately" rows={sp.options}
      cols={[{ key: "desc", label: "Option", placeholder: "Remote HMI panel" }, { key: "amount", label: "Amount", num: true, width: 140 }]}
      {...lineList("options")} addLabel="Add option"
      onAdd={() => setSpec("options", [...sp.options, { id: uid(), desc: "", amount: "" }])} />

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Assumptions and Exclusions</h3><span className="subtle" style={{ marginLeft: "auto" }}>one per line</span></div>
      <div className="card-body"><div className="row">
        <Field label="Assumptions and clarifications"><textarea className="input" rows={6} {...textLines("assumptions")} /></Field>
        <Field label="Exclusions"><textarea className="input" rows={6} {...textLines("exclusions")} /></Field>
      </div></div>
    </div>

    <Lines title="Schedule" rows={sp.schedule}
      cols={[{ key: "label", label: "Milestone" }, { key: "weeks", label: "Weeks from award", num: true, width: 160 }]}
      {...lineList("schedule")} addLabel="Add milestone"
      onAdd={() => setSpec("schedule", [...sp.schedule, { id: uid(), label: "", weeks: "" }])} />

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Invoicing Schedule</h3>
        <span className={cls("mono", phasePct !== 100 && "neg")} style={{ marginLeft: "auto", color: phasePct === 100 ? undefined : "var(--neg)" }}>{phasePct}%</span></div>
      <div className="card-body">
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className="btn sm" onClick={() => set("phases", cfg.controlsPhases.engineering.map(ph => ({ ...ph })))}>Engineering-only split</button>
          <button className="btn sm" onClick={() => set("phases", cfg.controlsPhases.hardware.map(ph => ({ ...ph })))}>With-hardware split</button>
        </div>
        {(x.phases || []).map((ph, i) => <div key={ph.key || i} className="row" style={{ alignItems: "center" }}>
          <input className="input" value={ph.label} onChange={e => set("phases", x.phases.map((q, j) => j === i ? { ...q, label: e.target.value } : q))} />
          <input className="input mono" type="number" min="0" style={{ maxWidth: 90 }} value={ph.pct} onChange={e => set("phases", x.phases.map((q, j) => j === i ? { ...q, pct: Number(e.target.value) || 0 } : q))} />
          <span className="mono subtle" style={{ minWidth: 100, textAlign: "right" }}>{money(Math.round(pricing.total * (Number(ph.pct) || 0)) / 100)}</span>
          <button className="btn ghost icon" onClick={() => set("phases", x.phases.filter((_, j) => j !== i))}><Ico d={ICONS.trash} size={15} /></button>
        </div>)}
        <button className="btn sm" onClick={() => set("phases", [...(x.phases || []), { key: "p" + uid().slice(0, 4), label: "", pct: 0 }])}><Ico d={ICONS.plus} size={14} />Add phase</button>
        {phasePct !== 100 && <p className="subtle" style={{ marginBottom: 0, color: "var(--neg)" }}>Phases should add up to 100%.</p>}
      </div>
    </div>

    <div className="card">
      <div className="card-head"><h3>Pricing</h3><span className="mono" style={{ marginLeft: "auto", fontWeight: 700, fontSize: 17 }}>{money(pricing.total)}</span></div>
      <div className="card-body">
        <div className="cat-row"><span>Engineering</span><span className="mono" style={{ marginLeft: "auto" }}>{money(pricing.engineeringTotal)}</span></div>
        <div className="cat-row"><span>Field Services</span><span className="mono" style={{ marginLeft: "auto" }}>{money(pricing.fieldTotal)}</span></div>
        <div className="cat-row"><span>Hardware{sp.hardwareIncluded ? "" : " (not included)"}</span><span className="mono" style={{ marginLeft: "auto" }}>{money(pricing.hardwareTotal)}</span></div>
        <div className="cat-row" style={{ alignItems: "center" }}><span>Contingency</span>
          <input className="input mono" type="number" min="0" step="any" style={{ width: 80, marginLeft: 10 }} value={sp.contingencyPct} onChange={e => setSpec("contingencyPct", e.target.value)} /><span className="subtle" style={{ marginLeft: 4 }}>%</span>
          <span className="mono" style={{ marginLeft: "auto" }}>{money(pricing.contingency)}</span></div>
        <div className="cat-row" style={{ fontWeight: 700 }}><span>Total</span><span className="mono" style={{ marginLeft: "auto" }}>{money(pricing.total)}</span></div>
        {pricing.options.length > 0 && <div className="cat-row subtle"><span>Options (separate)</span><span className="mono" style={{ marginLeft: "auto" }}>{money(pricing.optionsTotal)}</span></div>}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <input type="checkbox" checked={!!sp.showHours} onChange={e => setSpec("showHours", e.target.checked)} />Show hours × rate on the document
        </label>
      </div>
    </div>
  </div>;
}
