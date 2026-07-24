import { useState, useEffect, useRef, useMemo } from "react";
import { uid, money, fmtDate, todayISO, nameOf, cls } from "../lib/helpers.js";
import { proposalConfig, priceProposal, ioBlocks, phaseAmount, SPEC_FIELDS, DEFAULT_PHASES } from "../calc/proposals.js";
import { Ico, ICONS, Badge, Empty, Field, MenuItem, Modal } from "../components/ui.jsx";
import { downloadProposalDocx, proposalDocxBlob } from "../lib/proposalDocx.js";
import EmailModal from "../components/EmailModal.jsx";

// Shared by the print view and the Word export — the proposal letter content.
export function buildProposalContent(p, db) {
  const cfg = proposalConfig(db.settings);
  const mt = db.machineTypes.find(m => m.id === p.machineTypeId);
  const customer = db.contacts.find(c => c.id === p.customerId);
  const person = db.contactPeople.find(x => x.id === p.contactPersonId);
  const s = p.specs || {};
  const cams = Number(s.cameras) || 0, gens = Number(s.generators) || 0, welds = Number(s.welds) || 0;
  const plc = s.plcType || cfg.plcType, hmi = s.hmiType || cfg.hmiType;
  const loc = p.location || cfg.location;
  const custName = customer?.name || "Customer";
  const pricing = p.pricing?.total != null ? p.pricing : priceProposal(mt, s, cfg);

  const salutation = (() => {
    if (!person?.name) return custName + " Team:";
    const parts = person.name.trim().split(/\s+/);
    const title = /^(Mr|Ms|Mrs|Dr)\.?$/i.test(parts[0]) ? parts[0] + " " : "";
    return (title ? title + parts[parts.length - 1] : parts[parts.length - 1]) + ":";
  })();

  const bullets = [
    { t: "Develop Controls Hardware Design." },
    { t: `System hardware and software design will follow ${cfg.standards}.` },
    { t: "Develop the hardware panel designs in AutoCad" },
    { t: "Develop the hardware design Interconnect drawings to include 480/230 VAC Power, 120 VAC and 24Vdc control signal and networks from the main control enclosure to the control component devices." },
    { t: `Software Control Application development for ${plc} PLC.` },
    s.dataNational ? { t: "Provide TP-Link ER605 Router Module to Communicate with Data National." } : null,
    { t: `HMI Software Design for ${hmi} HMI` },
    { t: "Provide the following hardware components per system." },
    { t: `(1) Main control Panel with ${plc} PLC, ${hmi} HMI, and miscellaneous panel components (duct, wire, terminal, power supplies, etc….)`, sub: true },
    { t: "Automation Direct Bingo Board HMI", sub: true },
    mt && Number(mt.remoteHmi) > 0 ? { t: "(1) Remote HMI Panel", sub: true } : null,
    { t: `Field Wiring at ${loc}.` },
    { t: `Start-up/Debug Support at ${loc}.` },
    { t: `${custName} will supply the machine and all on machine components and cabling.` },
    cams > 0 ? { t: `Installation and Configuration of ${cams} Cameras` } : null,
    gens > 0 ? { t: welds > 0 ? `${gens} Sonic Generators, ${welds} Welds` : `${gens} Sonic Generators` } : null,
  ].filter(Boolean);

  const salesNotes = [
    "This is a proposal for Engineering Services and material listed in the deliverables section of this proposal.",
    "All Field Components (Sensors, Cables, Duct, Cylinders, Valves, Remote E-Stop, Cycle Start, etc.) and Step-Down Transformers are not provided as part of this proposal.",
    "Stand-by and production support is not included as part of this proposal and can be purchased for a rate of $70/hour U.S. and actual expenses.",
  ];

  const phases = (p.phases?.length ? p.phases : cfg.phases).map(ph => ({ ...ph, amount: phaseAmount(pricing.total, ph.pct) }));
  return { cfg, mt, customer, person, pricing, bullets, salesNotes, phases, salutation, custName };
}

const emptySpecs = () => Object.fromEntries(SPEC_FIELDS.map(([k]) => [k, 0]));

export default function ProposalsView({ db, actions, toast }) {
  const [edit, setEdit] = useState(null);
  const [doc, setDoc] = useState(null);
  const [phasesFor, setPhasesFor] = useState(null);
  const [search, setSearch] = useState("");
  const customers = db.contacts.filter(c => c.type === "customer");
  const cfg = proposalConfig(db.settings);

  const filtered = db.proposals.filter(p => {
    const s = search.toLowerCase(); if (!s) return true;
    return [p.number, p.jobNumber, p.description, nameOf(db, p.customerId), p.status].join(" ").toLowerCase().includes(s);
  });

  const startNew = () => setEdit({
    id: uid(), _new: true, number: "(assigned at save)", customerId: customers[0]?.id || "",
    contactPersonId: "", date: todayISO(), status: "draft", jobNumber: "", description: "",
    location: cfg.location, machineTypeId: db.machineTypes[0]?.id || "",
    specs: { ...emptySpecs(), dataNational: true, ioBlocks: "" },
    pricing: {}, phases: cfg.phases.map(ph => ({ ...ph })), notes: "",
  });

  const save = async (p) => {
    const mt = db.machineTypes.find(m => m.id === p.machineTypeId);
    const pricing = priceProposal(mt, p.specs, cfg);
    const saved = await actions.saveProposal({ ...p, pricing });
    if (saved) { setEdit(null); toast(p._new ? "Proposal " + saved.number + " created" : "Proposal saved"); }
  };
  const setStatus = async (id, status) => { if (await actions.setProposalStatus(id, status)) toast("Marked " + status); };
  const del = async (id) => { if (!confirm("Delete this proposal?")) return; if (await actions.deleteProposal(id)) toast("Deleted"); };
  const win = async (p) => {
    const po = prompt("Customer Purchase Order number:", p.poNumber || "");
    if (po === null) return;
    const so = await actions.winProposal(p, po);
    if (so) toast(`Won — sales order ${so.number} created`);
  };

  if (db.machineTypes.length === 0) return <div className="card">
    <Empty icon={ICONS.so} title="Set up machine rates first" msg="Proposals price themselves from your machine-type rates. Load the TMJ defaults (from TMJ Costing.xlsx) or add types under Machine Rates." action={
      <button className="btn primary" onClick={async () => {
        const { TMJ_DEFAULT_RATES } = await import("../calc/proposals.js");
        if (await actions.seedMachineRates(TMJ_DEFAULT_RATES)) toast("Machine rates loaded");
      }}>Load TMJ Default Rates</button>} />
  </div>;

  if (edit) return <ProposalEditor p={edit} db={db} cfg={cfg} customers={customers} onCancel={() => setEdit(null)} onSave={save} />;

  return <div>
    <div className="toolbar">
      <div className="search"><Ico d={ICONS.search} size={15} /><input className="input" placeholder="Search proposals…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={startNew}><Ico d={ICONS.plus} size={15} />New Proposal</button>
    </div>
    <div className="card">
      {db.proposals.length === 0
        ? <Empty icon={ICONS.quote} title="No proposals yet" msg="Enter the machine details — type, welds, clamps, cameras — and the app prices it, generates the proposal document, and tracks it to PO."
          action={<button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Proposal</button>} />
        : <table><thead><tr><th>Proposal</th><th>Job #</th><th>Customer</th><th>Description</th><th>Type</th><th>Date</th><th>Status</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{filtered.slice().reverse().map(p => {
            const mt = db.machineTypes.find(m => m.id === p.machineTypeId);
            const billed = (p.phases || []).filter(ph => ph.invoiceId).length;
            return <tr key={p.id}>
              <td className="doc-id">{p.number}</td>
              <td className="mono subtle">{p.jobNumber || "—"}</td>
              <td>{nameOf(db, p.customerId)}</td>
              <td>{p.description || "—"}</td>
              <td className="subtle">{mt?.name || "—"}</td>
              <td className="subtle">{fmtDate(p.date)}</td>
              <td><Badge status={p.status} />{p.status === "won" && billed > 0 && <span className="subtle" style={{ marginLeft: 6 }}>{billed}/{p.phases.length} billed</span>}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(Number(p.pricing?.total) || 0)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn ghost icon" title="View / Print" onClick={() => setDoc(p)}><Ico d={ICONS.print} size={16} /></button>
                <button className="btn ghost icon" title="Edit" onClick={() => setEdit({ ...p, specs: { ...p.specs } })}><Ico d={ICONS.edit} size={16} /></button>
                <PropMenu p={p} setStatus={setStatus} win={win} del={del} onPhases={() => setPhasesFor(p)} />
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {doc && <ProposalDoc p={doc} db={db} onClose={() => setDoc(null)} toast={toast} />}
    {phasesFor && <PhasesModal p={db.proposals.find(x => x.id === phasesFor.id) || phasesFor} db={db} actions={actions} toast={toast} onClose={() => setPhasesFor(null)} />}
  </div>;
}

function PropMenu({ p, setStatus, win, del, onPhases }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const item = (label, fn, opts = {}) => <MenuItem {...opts} onClick={() => { fn(); setOpen(false); }}>{label}</MenuItem>;
  return <span style={{ position: "relative", display: "inline-block" }} ref={ref}>
    <button className="btn ghost icon" onClick={() => setOpen(o => !o)} title="More">⋯</button>
    {open && <div style={{ position: "absolute", right: 0, top: "100%", background: "#fff", border: "1px solid var(--line)", borderRadius: 9, boxShadow: "var(--shadow)", zIndex: 30, minWidth: 200, padding: 6, textAlign: "left" }}>
      {p.status === "draft" && item("Mark as Submitted", () => setStatus(p.id, "submitted"))}
      {p.status !== "won" && item("Won — PO received →", () => win(p), { accent: true })}
      {p.status === "won" && item("Invoice Phases…", onPhases, { accent: true })}
      {p.status !== "lost" && p.status !== "won" && item("Mark as Lost", () => setStatus(p.id, "lost"))}
      {item("Delete", () => del(p.id), { danger: true })}
    </div>}
  </span>;
}

function ProposalEditor({ p, db, cfg, customers, onCancel, onSave }) {
  const [x, setX] = useState(p);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setX(prev => ({ ...prev, [k]: v }));
  const setSpec = (k, v) => setX(prev => ({ ...prev, specs: { ...prev.specs, [k]: v } }));
  const mt = db.machineTypes.find(m => m.id === x.machineTypeId);
  const people = db.contactPeople.filter(cp => cp.contactId === x.customerId);
  const pricing = useMemo(() => priceProposal(mt, x.specs, cfg), [mt, x.specs, cfg]);
  const { points, blocks } = ioBlocks(x.specs, cfg);
  const save = async () => { setSaving(true); await onSave(x); setSaving(false); };

  return <div>
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{x._new ? "New Proposal" : "Edit " + x.number}</h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Proposal"}</button>
      </div>
    </div>
    <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
      <div className="row">
        <Field label="Customer"><select className="select" value={x.customerId} onChange={e => { set("customerId", e.target.value); set("contactPersonId", ""); }}>
          <option value="">Select customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Contact Person" hint={people.length === 0 ? "Add people under Contacts" : undefined}>
          <select className="select" value={x.contactPersonId} onChange={e => set("contactPersonId", e.target.value)}>
            <option value="">— none —</option>{people.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
          </select></Field>
        <Field label="Date"><input className="input" type="date" value={x.date} onChange={e => set("date", e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Job Number"><input className="input mono" value={x.jobNumber} onChange={e => set("jobNumber", e.target.value)} placeholder="VGE_2026015" /></Field>
        <Field label="Description"><input className="input" value={x.description} onChange={e => set("description", e.target.value)} placeholder="Seat Back w/o Vent" /></Field>
        <Field label="Machine Type"><select className="select" value={x.machineTypeId} onChange={e => set("machineTypeId", e.target.value)}>
          {db.machineTypes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></Field>
      </div>
      <Field label="Build / Start-up Location"><input className="input" value={x.location} onChange={e => set("location", e.target.value)} /></Field>
    </div></div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Machine Content</h3>
        <span className="subtle" style={{ marginLeft: "auto" }}>{points} points → {blocks} I/O block{blocks === 1 ? "" : "s"}</span></div>
      <div className="card-body">
        <div className="row">
          {SPEC_FIELDS.map(([k, label]) => <Field key={k} label={label}>
            <input className="input mono" type="number" min="0" value={x.specs[k] ?? 0} onChange={e => setSpec(k, e.target.value)} />
          </Field>)}
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <Field label="I/O Blocks" hint="Computed from content — override if needed">
            <input className="input mono" type="number" min="0" placeholder={String(blocks)} value={x.specs.ioBlocks ?? ""} onChange={e => setSpec("ioBlocks", e.target.value)} />
          </Field>
          <Field label="Data National">
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0" }}>
              <input type="checkbox" checked={!!x.specs.dataNational} onChange={e => setSpec("dataNational", e.target.checked)} />
              Machine reports to Data National
            </label>
          </Field>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><h3>Pricing</h3><span className="mono" style={{ marginLeft: "auto", fontWeight: 700, fontSize: 17 }}>{money(pricing.total)}</span></div>
      <div className="card-body" style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="subtle" style={{ fontWeight: 700, marginBottom: 6 }}>Base Pricing</div>
          {pricing.baseLines.map(l => <div key={l.label} className="cat-row"><span>{l.label}</span><span className="mono" style={{ marginLeft: "auto" }}>{money(l.amount)}</span></div>)}
          <div className="cat-row" style={{ fontWeight: 700 }}><span>Base Sub Total</span><span className="mono" style={{ marginLeft: "auto" }}>{money(pricing.base)}</span></div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="subtle" style={{ fontWeight: 700, marginBottom: 6 }}>Premium Pricing</div>
          {pricing.premiumLines.map(l => <div key={l.label} className="cat-row"><span>{l.label}</span><span className="mono" style={{ marginLeft: "auto" }}>{money(l.amount)}</span></div>)}
          <div className="cat-row" style={{ fontWeight: 700 }}><span>Premium Sub Total</span><span className="mono" style={{ marginLeft: "auto" }}>{money(pricing.premium)}</span></div>
        </div>
      </div>
    </div>
  </div>;
}

function PhasesModal({ p, db, actions, toast, onClose }) {
  const total = Number(p.pricing?.total) || 0;
  const phases = p.phases?.length ? p.phases : DEFAULT_PHASES;
  const [sel, setSel] = useState([]);
  const open = phases.filter(ph => !ph.invoiceId);
  const toggle = k => setSel(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k]);
  const amt = sel.reduce((t, k) => t + phaseAmount(total, phases.find(ph => ph.key === k)?.pct || 0), 0);
  const create = async () => {
    const inv = await actions.invoiceProposalPhases(p, sel);
    if (inv) { toast(`Invoice ${inv.number} created — ${money(amt)}`); onClose(); }
  };
  return <Modal title={"Invoice Phases · " + p.number} onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!sel.length} onClick={create}>Create Invoice {sel.length ? "· " + money(amt) : ""}</button></>}>
    <p className="subtle" style={{ marginTop: 0 }}>Select the phases to bill on one invoice. Total contract: <span className="mono" style={{ fontWeight: 600 }}>{money(total)}</span></p>
    {phases.map(ph => {
      const billedInv = ph.invoiceId ? db.invoices.find(i => i.id === ph.invoiceId) : null;
      return <label key={ph.key} className="cat-row" style={{ cursor: ph.invoiceId ? "default" : "pointer", opacity: ph.invoiceId ? .55 : 1 }}>
        <input type="checkbox" disabled={!!ph.invoiceId} checked={sel.includes(ph.key)} onChange={() => toggle(ph.key)} />
        <span>{ph.label} <span className="subtle">({ph.pct}%)</span></span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {billedInv && <span className="subtle">billed on {billedInv.number}</span>}
          {ph.invoiceId && !billedInv && <span className="subtle">billed</span>}
          <span className="mono" style={{ fontWeight: 600 }}>{money(phaseAmount(total, ph.pct))}</span>
        </span>
      </label>;
    })}
    {open.length === 0 && <p className="subtle">All phases have been invoiced. 🎉</p>}
  </Modal>;
}

function ProposalDoc({ p, db, onClose, toast }) {
  const c = buildProposalContent(p, db);
  const s = db.settings;
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(false);
  const word = async () => {
    setBusy(true);
    try { await downloadProposalDocx(p, db); }
    catch (e) { toast("⚠ Word export failed: " + (e.message || e)); }
    setBusy(false);
  };
  return <div className="doc-screen">
    <div className="doc-bar">
      <button className="btn" onClick={onClose}><Ico d={ICONS.back} size={16} />Close</button>
      <button className="btn" onClick={() => setEmail(true)}><Ico d={ICONS.mail} size={15} />Email…</button>
      <button className="btn" disabled={busy} onClick={word}>{busy ? "Building…" : "Download Word"}</button>
      <button className="btn primary" onClick={() => window.print()}><Ico d={ICONS.print} size={16} />Print / Save PDF</button>
    </div>
    {email && <EmailModal
      title={"Email · " + p.number}
      defaultTo={c.person?.email || c.customer?.email || ""}
      defaultSubject={`Proposal ${p.number} — ${[p.jobNumber, p.description].filter(Boolean).join(" – ")}`}
      defaultBody={`${c.salutation.replace(/:$/, ",")}\n\nPlease find attached proposal ${p.number} for ${p.description || "the machine"}.\n\nRegards,\n${c.cfg.signer || s.company}`}
      buildAttachment={() => proposalDocxBlob(p, db)}
      onClose={() => setEmail(false)} toast={toast} />}
    <div className="printable prop-doc">
      <div style={{ textAlign: "center", marginBottom: 26 }}><img src="/tmj-logo.png" alt="TMJ Engineering" style={{ width: 170 }} /></div>
      <p>{fmtDate(p.date)}</p>
      <p style={{ whiteSpace: "pre-line" }}>{[c.person?.name, c.customer?.name, c.customer?.address].filter(Boolean).join("\n")}</p>
      <p className="mono" style={{ marginTop: 18 }}>Proposal: {p.number}<br />Re: {p.jobNumber}{p.jobNumber && p.description ? " – " : ""}{p.description}</p>
      <p>{c.salutation}</p>
      <p>Thank you for giving {s.company || "us"} an opportunity to provide a proposal for services and deliverables for Turnkey Controls for (1) Assembly Machine.</p>
      <h4 style={{ margin: "14px 0 4px" }}>Scope</h4>
      <p style={{ marginTop: 0 }}>{s.company || "We"} will provide design services with the following deliverables:</p>
      <ul className="prop-bullets">
        {c.bullets.map((b, i) => <li key={i} className={cls(b.sub && "sub")}>{b.t}</li>)}
      </ul>
      <h4 style={{ margin: "16px 0 4px" }}>Sales Notes and Clarifications</h4>
      <ol className="prop-bullets">{c.salesNotes.map((t, i) => <li key={i}>{t}</li>)}</ol>
      <div className="prop-price">
        <h4>Base Pricing</h4>
        <table><tbody>
          {c.pricing.baseLines.map(l => <tr key={l.label}><td>{l.label}</td><td className="amt">{money(l.amount)}</td></tr>)}
          <tr className="tot"><td>Base Price Sub Total</td><td className="amt">{money(c.pricing.base)}</td></tr>
        </tbody></table>
        <h4>Premium Pricing</h4>
        <table><tbody>
          {c.pricing.premiumLines.map(l => <tr key={l.label}><td>{l.label}</td><td className="amt">{money(l.amount)}</td></tr>)}
          <tr className="tot"><td>Premium Price Sub Total</td><td className="amt">{money(c.pricing.premium)}</td></tr>
        </tbody></table>
        <table style={{ marginTop: 10 }}><tbody>
          <tr className="tot"><td>Total Price for this proposal is:</td><td className="amt">{money(c.pricing.total)}</td></tr>
        </tbody></table>
        <h4>Invoicing Schedule</h4>
        <p style={{ margin: "2px 0 6px" }}>Project will be invoiced according to the following invoicing schedule</p>
        <table className="sched"><tbody>
          {c.phases.map(ph => <tr key={ph.key}><td>{ph.label}</td><td className="pct">{ph.pct}%</td><td className="amt plain">{money(ph.amount)}</td></tr>)}
        </tbody></table>
      </div>
      <p style={{ marginTop: 18 }}>This offer is firm for 30 days from the date of this proposal. Terms shall be Net 30 Days. Any invoice more than 30 days past due will be assessed interest at the rate of 12% APR accruing monthly.</p>
      <p>I hope you find this offering favorable. If you have any questions, or require additional information, please feel free to contact me.</p>
      <p style={{ marginBottom: 34 }}>Regards,</p>
      <p>{c.cfg.signer || s.company}</p>
      <div className="doc-foot">{[s.companyAddress?.replace(/\n/g, ", "), s.companyPhone].filter(Boolean).join(" - ")}</div>
    </div>
  </div>;
}
