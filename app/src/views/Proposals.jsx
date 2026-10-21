import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import DocActions from "../components/DocActions.jsx";
import { pagesToPdf, saveBlob } from "../lib/saveFile.js";
import { uid, money, fmtDate, todayISO, nameOf, cls, pickable } from "../lib/helpers.js";
import { packageById, packageForCustomer, packageDefaults, packagesOf, standardsLine, mesFor, SCOPE_ITEMS } from "../calc/fixtureScope.js";
import { termsLabelFor } from "../lib/terms.js";
import ReductionRow from "../components/ReductionRow.jsx";
import { personName, emailFor, proposalAttn, proposalPerson, contactNameFor, remitVendor, peopleOf } from "../lib/people.js";
import { proposalConfig, priceProposal, ioBlocks, phaseAmount, SPEC_FIELDS, DEFAULT_PHASES, defaultProposalCustomer } from "../calc/proposals.js";
import { Ico, ICONS, Badge, Empty, Field, MenuItem, ActionMenu, Modal, SortTh, useTableSort, blankZero } from "../components/ui.jsx";
import { downloadProposalDocx, proposalDocxBlob, proposalFileStem } from "../lib/proposalDocx.js";
import EmailModal from "../components/EmailModal.jsx";
import ImportProposalsModal from "../components/ImportProposalsModal.jsx";
import ImportLineupModal from "../components/ImportLineupModal.jsx";
import ControlsEstimateEditor, { buildControlsContent, ControlsDocBody, revLabel } from "./ControlsEstimate.jsx";
import { newEstimate, priceEstimate } from "../calc/estimates.js";

// Shared by the print view and the Word export — the proposal letter content.
export function buildProposalContent(p, db) {
  const cfg = proposalConfig(db.settings, db.timeCategories);
  const mt = db.machineTypes.find(m => m.id === p.machineTypeId);
  const customer = db.contacts.find(c => c.id === p.customerId);
  // Effective contact: the proposal's free-text name, else a linked contact
  // person, else the customer's contact field.
  const personRec = proposalPerson(db, p, customer);
  const contactName = (p.contactName || personName(personRec) || customer?.contact || "").trim();
  // A named person with no email of their own falls back to whoever the
  // customer's proposals go to, then the company email.
  const person = contactName ? { name: contactName, email: (personRec?.email || "").trim() || emailFor(db, p.customerId, "proposal") } : null;
  const s = p.specs || {};
  const cams = Number(s.cameras) || 0, gens = Number(s.generators) || 0, welds = Number(s.welds) || 0, hmis = Number(s.hmis) || 0;
  const torque = Number(s.torque) || 0, ioLink = Number(s.ioLink) || 0;
  const plc = s.plcType || cfg.plcType, hmi = s.hmiType || cfg.hmiType;
  const loc = p.location || cfg.location;
  const custName = customer?.name || "Customer";
  // A saved pricing snapshot from before zero lines were dropped still carries
  // them; the document leaves off anything worth nothing, just as a fresh
  // price would.
  const drop0 = lines => (lines || []).filter(l => (Number(l.amount) || 0) > 0);
  const pricing = p.pricing?.total != null
    ? { ...p.pricing, baseLines: drop0(p.pricing.baseLines), premiumLines: drop0(p.pricing.premiumLines) }
    : priceProposal(mt, s, cfg);

  const salutation = (() => {
    if (!person?.name) return custName + " Team:";
    const parts = person.name.trim().split(/\s+/);
    const title = /^(Mr|Ms|Mrs|Dr)\.?$/i.test(parts[0]) ? parts[0] + " " : "";
    return (title ? title + parts[parts.length - 1] : parts[parts.length - 1]) + ":";
  })();

  // The scope follows the price: a hardware item is promised only when it is a
  // line on this proposal (Fixture Rates above $0, or an override), so a $0
  // item drops out of the bullets as it drops out of the pricing. A pricing
  // snapshot saved before lines carried keys is read by its label.
  const allLines = [...(pricing.baseLines || []), ...(pricing.premiumLines || [])];
  const LABEL = { panel: /panel\s*\/?\s*hmi|control panel/i, blockIo: /block\s*i\/?o/i, fieldWiring: /field\s*wir/i, remoteHmi: /remote\s*hmi/i, remoteSonic: /remote\s*sonic/i };
  const priced = key => allLines.some(l => (l.key ? l.key === key : LABEL[key]?.test(l.label || "")) && (Number(l.amount) || 0) > 0);
  const blocks = Number(pricing.blocks) || 0;
  const hardware = [
    priced("panel") ? { t: `(1) Main control Panel with ${plc} PLC, ${hmi} HMI, and miscellaneous panel components (duct, wire, terminal, power supplies, etc….)`, sub: true } : null,
    priced("panel") ? { t: "Automation Direct Bingo Board HMI", sub: true } : null,
    priced("blockIo") ? { t: `(${blocks || 1}) Block I/O module${blocks === 1 ? "" : "s"}`, sub: true } : null,
    priced("remoteHmi") ? { t: "(1) Remote HMI Panel", sub: true } : null,
    priced("remoteSonic") ? { t: "(1) Remote Sonic Panel", sub: true } : null,
  ].filter(Boolean);
  const bullets = [
    { t: "Develop Controls Hardware Design." },
    { t: `System hardware and software design will follow ${cfg.standards}.` },
    { t: "Develop the hardware panel designs in AutoCad" },
    { t: "Develop the hardware design Interconnect drawings to include 480/230 VAC Power, 120 VAC and 24Vdc control signal and networks from the main control enclosure to the control component devices." },
    { t: `Software Control Application development for ${plc} PLC.` },
    s.dataNational ? { t: "Provide TP-Link ER605 Router Module to Communicate with Data National." } : null,
    { t: hmis > 1 ? `HMI Software Design for (${hmis}) ${hmi} HMIs` : `HMI Software Design for ${hmi} HMI` },
    hardware.length ? { t: "Provide the following hardware components per system." } : null,
    ...hardware,
    priced("fieldWiring") ? { t: `Field Wiring at ${loc}.` } : null,
    { t: `Start-up/Debug Support at ${loc}.` },
    { t: `${custName} will supply the machine and all on machine components and cabling.` },
    cams > 0 ? { t: `Installation and Configuration of ${cams} Cameras` } : null,
    torque > 0 ? { t: `Installation and Configuration of ${torque} Torque Tool${torque === 1 ? "" : "s"}` } : null,
    ioLink > 0 ? { t: `Configuration of ${ioLink} IO-Link Device${ioLink === 1 ? "" : "s"}` } : null,
    gens > 0 ? { t: welds > 0 ? `${gens} Sonic Generators, ${welds} Welds` : `${gens} Sonic Generators` } : null,
  ].filter(Boolean);

  const salesNotes = [
    "This is a proposal for Engineering Services and material listed in the deliverables section of this proposal.",
    "All Field Components (Sensors, Cables, Duct, Cylinders, Valves, Remote E-Stop, Cycle Start, etc.) and Step-Down Transformers are not provided as part of this proposal.",
    // The support rate is the Time Category's (the one place rates are set), not a number typed here.
    `Stand-by and production support is not included as part of this proposal and can be purchased for a rate of $${Number(cfg.supportRate) || 0}/hour U.S. and actual expenses.`,
  ];

  const phases = (p.phases?.length ? p.phases : cfg.phases).map(ph => ({ ...ph, amount: phaseAmount(pricing.total, ph.pct) }));
  const legacy = { cfg, mt, customer, person, pricing, bullets, salesNotes, phases, salutation, custName,
    intro: "Turnkey Controls", terms: "This offer is firm for 30 days from the date of this proposal. Terms shall be Net 30 Days. Any invoice more than 30 days past due will be assessed interest at the rate of 12% APR accruing monthly." };
  // A proposal saved before scope packages reads exactly as it always did.
  if (!s.packageId) return legacy;

  /* ---- scope-driven: the package and the proposal's ticks say what is provided ---- */
  const pkg = packageById(db.settings, s.packageId) || packageForCustomer(db, p.customerId);
  const site = (p.location || "").trim() || (pkg?.location || "").trim() || custName;
  const sc = { ...(pkg?.scope || {}), ...(s.scope || {}) };
  const on = k => sc[k] !== false && sc[k] != null;
  const hmiOn = on("hmi") && hmis > 0;
  const company = db.settings.company || "We";
  const std = standardsLine(pkg, s.endCustomer);
  const suppliesDesign = on("hwDesign"), suppliesHardware = on("panel") || on("blockIo");
  const mes = (s.mesName || "").trim() || pkg?.mesName || "MES";
  // The MES router is hardware: promised only when MES material is priced.
  const sHardware = [...hardware, ...(s.dataNational && priced("dnMaterial") ? [{ t: `TP-Link ER605 Router Module to communicate with ${mes}`, sub: true }] : [])];
  const sBullets = [
    suppliesDesign ? { t: "Develop Controls Hardware Design." } : null,
    std ? { t: `System ${suppliesDesign ? "hardware and software" : "software"} design will follow ${std}.` } : null,
    suppliesDesign ? { t: "Develop the hardware panel designs in AutoCad" } : null,
    suppliesDesign ? { t: "Develop the hardware design Interconnect drawings to include 480/230 VAC Power, 120 VAC and 24Vdc control signal and networks from the main control enclosure to the control component devices." } : null,
    on("plc") ? { t: `Software Control Application development for ${plc} PLC.` } : null,
    // MES: support priced → integration and checkout; otherwise the PLC side of the interface.
    s.dataNational ? { t: priced("dnCheckout") ? `${mes} MES integration and checkout.` : `PLC software interface to ${mes} MES.` } : null,
    hmiOn ? { t: hmis > 1 ? `HMI Software Design for (${hmis}) ${hmi} HMIs` : `HMI Software Design for ${hmi} HMI` } : null,
    sHardware.length ? { t: "Provide the following hardware components per system." } : null,
    ...sHardware,
    on("fieldWiring") && priced("fieldWiring") ? { t: `Field Wiring at ${site}.` } : null,
    on("startup") ? { t: `Start-up/Debug Support at ${site}.` } : null,
    on("docs") ? { t: suppliesDesign ? "Final programs and as-built drawings." : "Final programs and documentation." } : null,
    { t: suppliesDesign || suppliesHardware
      ? `${custName} will supply the machine and all on machine components and cabling.`
      : `${custName} will supply the machine, the control hardware design, the control panel and all on machine components and cabling.` },
    cams > 0 ? { t: `Installation and Configuration of ${cams} Cameras` } : null,
    torque > 0 ? { t: `Installation and Configuration of ${torque} Torque Tool${torque === 1 ? "" : "s"}` } : null,
    ioLink > 0 ? { t: `Configuration of ${ioLink} IO-Link Device${ioLink === 1 ? "" : "s"}` } : null,
    gens > 0 ? { t: welds > 0 ? `${gens} Sonic Generators, ${welds} Welds` : `${gens} Sonic Generators` } : null,
  ].filter(Boolean);
  const material = allLines.some(l => (l.key ? ["panel", "blockIo", "remoteHmi", "remoteSonic", "dnMaterial"].includes(l.key) : false) && (Number(l.amount) || 0) > 0);
  const engRate = Number(cfg.laborRates?.plc) || 0;
  const sNotes = [
    material ? "This is a proposal for Engineering Services and material listed in the deliverables section of this proposal."
      : "This is a proposal for the Engineering Services listed in the deliverables section of this proposal.",
    !suppliesDesign && !suppliesHardware ? `The control hardware design, control panels and all control hardware are provided by ${custName}; ${company} provides controls software and start-up support only.` : null,
    "All Field Components (Sensors, Cables, Duct, Cylinders, Valves, Remote E-Stop, Cycle Start, etc.) and Step-Down Transformers are not provided as part of this proposal.",
    !on("fieldWiring") && suppliesHardware ? "Field wiring is not included as part of this proposal." : null,
    // Start-up is at the customer's shop; the end customer's plant is extra.
    on("startup") ? `Start-up at the end customer's site${(s.endCustomer || "").trim() ? ` (${s.endCustomer.trim()})` : ""} is not included as part of this proposal and can be provided at the engineering rate of $${engRate}/hour plus expenses.` : null,
    !on("runoff") ? `Run-off support is not included as part of this proposal and can be added at the engineering rate of $${engRate}/hour.` : null,
    `Stand-by and production support is not included as part of this proposal and can be purchased for a rate of $${Number(cfg.supportRate) || 0}/hour U.S. and actual expenses.`,
  ].filter(Boolean);
  const validity = Number(cfg.validityDays) || 30;
  return { ...legacy, bullets: sBullets, salesNotes: sNotes, intro: pkg?.intro || "Turnkey Controls", pkg, scope: sc,
    terms: `This offer is firm for ${validity} days from the date of this proposal. Terms shall be ${termsLabelFor(db, p.customerId)}. Any invoice more than 30 days past due will be assessed interest at the rate of 12% APR accruing monthly.` };
}

const emptySpecs = () => Object.fromEntries(SPEC_FIELDS.map(([k]) => [k, 0]));

export default function ProposalsView({ db, actions, toast, readOnly }) {
  const [edit, setEdit] = useState(null);
  const [doc, setDoc] = useState(null);
  const [phasesFor, setPhasesFor] = useState(null);
  const [copyOf, setCopyOf] = useState(null);   // the proposal being copied
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importingLineup, setImportingLineup] = useState(false);
  // Select mode: tick proposals, then email, save, mark or delete them together.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState({});
  const [bulkEmail, setBulkEmail] = useState(false);
  const [pdfQueue, setPdfQueue] = useState(null);     // { list, i } — Save PDF one proposal at a time
  const [bulkBusy, setBulkBusy] = useState(false);
  const customers = db.contacts.filter(c => c.type === "customer");
  const cfg = proposalConfig(db.settings, db.timeCategories);

  const filtered = db.proposals.filter(p => {
    const s = search.toLowerCase(); if (!s) return true;
    return [p.number, p.jobNumber, p.description, nameOf(db, p.customerId), p.status, p.kind].join(" ").toLowerCase().includes(s);
  });

  const { sorted: propRows, sort, onSort } = useTableSort(filtered.slice().reverse(), {
    number: p => p.number, job: p => p.jobNumber || "", customer: p => nameOf(db, p.customerId),
    desc: p => p.description || "", type: p => p.kind === "controls" ? "System Proposal" : (db.machineTypes.find(m => m.id === p.machineTypeId)?.name || ""),
    date: p => p.date || "", status: p => p.status || "", total: p => Number(p.pricing?.total) || 0,
  });

  // A new proposal starts on the customer the last one of its kind was for
  // (Venture Global before there are any), with that customer's contact.
  const startCustomer = defaultProposalCustomer(db, "machine");
  const startSystemCustomer = defaultProposalCustomer(db, "controls");
  const startNewControls = () => setEdit({
    id: uid(), _new: true, kind: "controls", rev: 0, number: "(assigned at save)", customerId: startSystemCustomer?.id || "",
    ...proposalAttn(db, startSystemCustomer), date: todayISO(), status: "draft", jobNumber: "", description: "",
    location: "", machineTypeId: "", specs: newEstimate(cfg), pricing: {},
    phases: cfg.controlsPhases.engineering.map(ph => ({ ...ph })), notes: "",
  });
  const startNew = () => setEdit({
    id: uid(), _new: true, kind: "machine", rev: 0, number: "(assigned at save)", customerId: startCustomer?.id || "",
    ...proposalAttn(db, startCustomer), date: todayISO(), status: "draft", jobNumber: "", description: "",
    location: packageForCustomer(db, startCustomer?.id).location ?? cfg.location, machineTypeId: db.machineTypes[0]?.id || "",
    specs: { ...emptySpecs(), dataNational: true, ioBlocks: "", hmis: 1, endCustomer: "", ...packageDefaults(packageForCustomer(db, startCustomer?.id)) },
    pricing: {}, phases: packageForCustomer(db, startCustomer?.id).phases.map(ph => ({ ...ph })), notes: "",
  });

  const save = async (p) => {
    const mt = db.machineTypes.find(m => m.id === p.machineTypeId);
    // The editor's every-line view isn't part of the saved snapshot.
    const { lines: _all, ...pricing } = p.kind === "controls" ? priceEstimate(p.specs, cfg) : priceProposal(mt, p.specs, cfg);
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
  const revise = async (p) => {
    const next = await actions.reviseProposal(p);
    if (next) { toast(`${next.number} ${revLabel(next)} started — ${p.number}${revLabel(p) ? " " + revLabel(p) : ""} is superseded`); setEdit({ ...next, specs: { ...next.specs } }); }
  };

  // What's ticked, in the order the list shows it.
  const chosen = propRows.filter(p => picked[p.id]);
  const allPicked = propRows.length > 0 && propRows.every(p => picked[p.id]);
  const endSelect = () => { setSelecting(false); setPicked({}); };
  const plural = (n, w = "proposal") => `${n} ${w}${n === 1 ? "" : "s"}`;
  // Each mark applies only where the row menu would offer it; the rest are
  // left alone and counted, so nothing won or superseded changes status.
  const canSubmit = p => p.status === "draft";
  const canLose = p => p.status !== "lost" && p.status !== "won" && p.status !== "superseded";
  const bulkStatus = async (status) => {
    const ok = chosen.filter(status === "submitted" ? canSubmit : canLose);
    const skipped = chosen.length - ok.length;
    if (!ok.length) { toast(`None of the selected can be marked ${status}`); return; }
    setBulkBusy(true);
    let done = 0;
    for (const p of ok) if (await actions.setProposalStatus(p.id, status)) done++;
    setBulkBusy(false);
    toast(`Marked ${plural(done)} ${status}` + (skipped ? ` · ${skipped} skipped` : ""));
    endSelect();
  };
  const bulkDelete = async () => {
    const won = chosen.filter(p => p.status === "won").length;
    if (!confirm(`Delete ${plural(chosen.length)}?` + (won ? `\n\n${won} of them ${won === 1 ? "is" : "are"} won — the sales order${won === 1 ? "" : "s"} stay.` : "") + "\n\nThis can't be undone.")) return;
    setBulkBusy(true);
    let done = 0;
    for (const p of chosen) if (await actions.deleteProposal(p.id)) done++;
    setBulkBusy(false);
    toast(`Deleted ${plural(done)}`);
    endSelect();
  };
  const bulkWord = async () => {
    setBulkBusy(true);
    try {
      // One download per proposal, spaced so the browser takes them all.
      for (const p of chosen) { await downloadProposalDocx(p, db); await new Promise(r => setTimeout(r, 350)); }
      toast(`Saved ${plural(chosen.length, "Word file")}`);
    } catch (e) { toast("⚠ Word export failed: " + (e.message || e)); }
    setBulkBusy(false);
  };
  // One email, every selected proposal attached. Addressed to the customer's
  // contact when they're all for the same customer.
  const emailTo = () => {
    const ids = [...new Set(chosen.map(p => p.customerId))];
    if (ids.length !== 1) return "";
    const c = chosen[0].kind === "controls" ? buildControlsContent(chosen[0], db) : buildProposalContent(chosen[0], db);
    return c.person?.email || emailFor(db, ids[0], "proposal");
  };

  if (edit?.kind === "controls") return <ControlsEstimateEditor p={edit} db={db} cfg={cfg} customers={customers} onCancel={() => setEdit(null)} onSave={save} />;

  if (db.machineTypes.length === 0 && db.proposals.every(p => p.kind !== "controls")) return <div className="card">
    <Empty icon={ICONS.so} title="Set up fixture rates first" msg="Proposals price themselves from your fixture-type rates. Load the TMJ defaults (from TMJ Costing.xlsx) or add types under Fixture Rates." action={
      !readOnly && <button className="btn primary" onClick={async () => {
        const { TMJ_DEFAULT_RATES } = await import("../calc/proposals.js");
        if (await actions.seedMachineRates(TMJ_DEFAULT_RATES)) toast("Fixture rates loaded");
      }}>Load TMJ Default Rates</button>} />
  </div>;

  if (edit) return <ProposalEditor p={edit} db={db} cfg={cfg} customers={customers} onCancel={() => setEdit(null)} onSave={save} />;

  return <div>
    <div className="toolbar">
      <div className="search"><Ico d={ICONS.search} size={15} /><input className="input" placeholder="Search proposals…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      {db.proposals.length > 0 && <button className={"btn" + (selecting ? " primary" : "")} style={{ marginLeft: "auto" }}
        onClick={() => selecting ? endSelect() : setSelecting(true)} title="Pick several proposals to email, save, mark or delete together">
        <Ico d={ICONS.check} size={15} />{selecting ? "Done Selecting" : "Select"}</button>}
      {!readOnly && <button className="btn" onClick={() => setImportingLineup(true)}>
        <Ico d={ICONS.quote} size={15} />Import Lineup</button>}
      {!readOnly && <button className="btn" onClick={() => setImporting(true)}>
        <Ico d={ICONS.quote} size={15} />Import Quote Chart</button>}
      {!readOnly && <button className="btn" onClick={startNewControls}><Ico d={ICONS.plus} size={15} />New System Proposal</button>}
      {!readOnly && <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Fixture Proposal</button>}
    </div>
    {selecting && <div className="toolbar">
      <span style={{ fontWeight: 600 }}>{chosen.length ? plural(chosen.length) + " selected" : "Tick the proposals to work on"}</span>
      {chosen.length > 0 && <span className="subtle mono">{money(chosen.reduce((t, p) => t + (Number(p.pricing?.total) || 0), 0))}</span>}
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" disabled={!chosen.length || bulkBusy} onClick={() => setBulkEmail(true)}><Ico d={ICONS.mail} size={15} />Email</button>
        <ActionMenu title="Save the selected proposals" label="Save" disabled={!chosen.length || bulkBusy} minWidth={230} icon={ICONS.download}>{close => <>
          <MenuItem onClick={() => { close(); if (chosen.length) setPdfQueue({ list: chosen, i: 0 }); }}>Save {plural(chosen.length, "PDF")}</MenuItem>
          <MenuItem onClick={() => { close(); if (chosen.length) bulkWord(); }}>Save {plural(chosen.length, "Word file")}</MenuItem>
        </>}</ActionMenu>
        {!readOnly && <>
          <button className="btn" disabled={!chosen.length || bulkBusy} onClick={() => bulkStatus("submitted")}>Mark Submitted</button>
          <button className="btn" disabled={!chosen.length || bulkBusy} onClick={() => bulkStatus("lost")}>Mark Lost</button>
          <button className="btn danger" disabled={!chosen.length || bulkBusy} onClick={bulkDelete}><Ico d={ICONS.trash} size={15} />Delete</button>
        </>}
        <button className="btn ghost" onClick={endSelect}>Cancel</button>
      </span>
    </div>}
    <div className="card">
      {db.proposals.length === 0
        ? <Empty icon={ICONS.quote} title="No proposals yet" msg="Enter the fixture details — type, welds, clamps, cameras — and the app prices it, generates the proposal document, and tracks it to PO."
          action={!readOnly && <span style={{ display: "inline-flex", gap: 8 }}>
            <button className="btn" onClick={startNewControls}><Ico d={ICONS.plus} size={15} />New System Proposal</button>
            <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Fixture Proposal</button></span>} />
        : <table><thead><tr>
          {selecting && <th style={{ width: 34 }}><input type="checkbox" title="Select all" checked={allPicked}
            onChange={e => setPicked(e.target.checked ? Object.fromEntries(propRows.map(p => [p.id, true])) : {})} /></th>}
          <SortTh label="Proposal" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Job #" col="job" sort={sort} onSort={onSort} />
          <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
          <SortTh label="Description" col="desc" sort={sort} onSort={onSort} />
          <SortTh label="Type" col="type" sort={sort} onSort={onSort} />
          <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
          <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
          <SortTh label="Total" col="total" sort={sort} onSort={onSort} num />
          <th></th></tr></thead>
          <tbody>{propRows.map(p => {
            const mt = db.machineTypes.find(m => m.id === p.machineTypeId);
            const billed = (p.phases || []).filter(ph => ph.invoiceId).length;
            return <tr key={p.id} onClick={selecting ? () => setPicked(s => ({ ...s, [p.id]: !s[p.id] })) : undefined}
              style={selecting ? { cursor: "pointer", background: picked[p.id] ? "var(--accent-wash)" : undefined } : undefined}>
              {selecting && <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={!!picked[p.id]}
                onChange={e => setPicked(s => ({ ...s, [p.id]: e.target.checked }))} /></td>}
              <td className="doc-id">{p.number}{revLabel(p) && <span className="subtle" style={{ marginLeft: 6, fontSize: 12 }}>{revLabel(p)}</span>}</td>
              <td className="mono subtle">{p.jobNumber || "—"}</td>
              <td>{nameOf(db, p.customerId)}</td>
              <td>{p.description || "—"}</td>
              <td className="subtle">{p.kind === "controls" ? "System Proposal" : (mt?.name || "—")}</td>
              <td className="subtle nowrap">{fmtDate(p.date)}</td>
              <td><Badge status={p.status} />{p.status === "won" && billed > 0 && <span className="subtle" style={{ marginLeft: 6 }}>{billed}/{p.phases.length} billed</span>}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(Number(p.pricing?.total) || 0)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                <button className="btn ghost icon" title="View" onClick={() => setDoc({ p })}><Ico d={ICONS.view} size={16} /></button>
                <button className="btn ghost icon" title="Email proposal" onClick={() => setDoc({ p, auto: "email" })}><Ico d={ICONS.mail} size={16} /></button>
                <button className="btn ghost icon" title="Print" onClick={() => setDoc({ p, auto: "print" })}><Ico d={ICONS.print} size={16} /></button>
                <ActionMenu title="Save" icon={ICONS.download} minWidth={210}>{close => <>
                  <MenuItem onClick={() => { close(); setDoc({ p, auto: "pdf" }); }}>Save PDF</MenuItem>
                  <MenuItem onClick={async () => { close(); try { await downloadProposalDocx(p, db); } catch (e) { toast("⚠ Word export failed: " + (e.message || e)); } }}>Save Word</MenuItem>
                </>}</ActionMenu>
                {!readOnly && <button className="btn ghost icon" title="Edit" onClick={() => setEdit({ ...p, specs: { ...p.specs } })}><Ico d={ICONS.edit} size={16} /></button>}
                {!readOnly && <PropMenu p={p} setStatus={setStatus} win={win} del={del} revise={revise} onPhases={() => setPhasesFor(p)} onCopy={() => setCopyOf(p)} />}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {importing && <ImportProposalsModal db={db} actions={actions} toast={toast} onClose={() => setImporting(false)} />}
    {importingLineup && <ImportLineupModal db={db} actions={actions} toast={toast} onClose={() => setImportingLineup(false)} />}
    {doc && <ProposalDoc p={doc.p} auto={doc.auto} db={db} onClose={() => setDoc(null)} toast={toast}
      onEdit={readOnly ? undefined : () => { const x = doc.p; setDoc(null); setEdit({ ...x }); }} />}
    {/* Save PDF for several: each proposal opens, saves itself and closes, then the next. */}
    {pdfQueue && <ProposalDoc key={pdfQueue.list[pdfQueue.i].id} p={pdfQueue.list[pdfQueue.i]} auto="pdf" db={db} toast={toast}
      onClose={() => setPdfQueue(q => {
        if (q.i + 1 < q.list.length) return { ...q, i: q.i + 1 };
        toast(`Saved ${plural(q.list.length, "PDF")}`); return null;
      })} />}
    {bulkEmail && <EmailModal docType="proposal"
      title={`Email · ${plural(chosen.length)}`}
      defaultTo={emailTo()}
      defaultSubject={chosen.length === 1
        ? `Proposal ${chosen[0].number}${revLabel(chosen[0]) ? " " + revLabel(chosen[0]) : ""} — ${[chosen[0].jobNumber, chosen[0].description].filter(Boolean).join(" – ")}`
        : `Proposals ${chosen.map(p => p.number).join(", ")}`}
      defaultBody={`Hello,\n\nPlease find attached ${chosen.length === 1 ? "our proposal" : `our ${chosen.length} proposals`}:\n${chosen.map(p => `  • ${p.number}${revLabel(p) ? " " + revLabel(p) : ""} — ${[p.jobNumber, p.description].filter(Boolean).join(" – ")}`).join("\n")}\n\nRegards,\n${cfg.signer || db.settings.company}`}
      buildAttachment={() => Promise.all(chosen.map(p => proposalDocxBlob(p, db)))}
      onSent={endSelect}
      onClose={() => setBulkEmail(false)} toast={toast} />}
    {copyOf && <CopyProposalModal p={copyOf} db={db} cfg={cfg} onClose={() => setCopyOf(null)}
      onCopy={async (copy) => {
        // Saved straight away so it claims its number; then it opens in the editor.
        const mt = db.machineTypes.find(m => m.id === copy.machineTypeId);
        const { lines: _all, ...pricing } = copy.kind === "controls" ? priceEstimate(copy.specs, cfg) : priceProposal(mt, copy.specs, cfg);
        const saved = await actions.saveProposal({ ...copy, pricing });
        if (!saved) return;
        setCopyOf(null);
        toast(`${saved.number} copied from ${copyOf.number}`);
        setEdit({ ...saved, specs: { ...saved.specs } });
      }} />}
    {phasesFor && <PhasesModal p={db.proposals.find(x => x.id === phasesFor.id) || phasesFor} db={db} actions={actions} toast={toast} onClose={() => setPhasesFor(null)} />}
  </div>;
}

// The number a new proposal for this customer would take today — the lowest
// free one, as saveProposal() claims it.
function nextProposalNumber(db, cfg, customerId, date) {
  const code = String(db.contacts.find(c => c.id === customerId)?.code || "").toUpperCase().replace(/\s+/g, "");
  const ymd = String(date || todayISO()).slice(2).replace(/-/g, "");
  const used = new Set(db.proposals.map(x => (x.number || "").trim().toLowerCase()));
  for (let n = 1; ; n++) { const num = `${cfg.propPrefix}${code}${ymd}-${String(n).padStart(2, "0")}`; if (!used.has(num.toLowerCase())) return num; }
}

// Copy a proposal for another job: a new job number and description, the next
// proposal number for that customer, and a reduction for a duplicate machine
// (the engineering is largely done once). The original is left as it is.
export function CopyProposalModal({ p, db, cfg, onClose, onCopy }) {
  const [jobNumber, setJobNumber] = useState("");
  const [description, setDescription] = useState(p.description || "");
  const [red, setRed] = useState({ type: "amt", value: "" });
  const [busy, setBusy] = useState(false);
  const date = todayISO();
  const copy = useMemo(() => ({
    ...p, id: uid(), _new: true, number: "(assigned at save)", rev: 0, status: "draft", date,
    jobNumber: jobNumber.trim(), description: description.trim(), poNumber: "", salesOrderId: "",
    phases: (p.phases || []).map(({ invoiceId, soLineId, ...ph }) => ph),
    specs: { ...(p.specs || {}), reduction: Number(red.value) > 0 ? { ...red, value: Number(red.value) } : null },
  }), [p, jobNumber, description, red, date]);
  const mt = db.machineTypes.find(m => m.id === p.machineTypeId);
  const priced = copy.kind === "controls" ? priceEstimate(copy.specs, cfg) : priceProposal(mt, copy.specs, cfg);
  const original = Number(p.pricing?.total) || 0;
  const before = Number(priced.before ?? priced.total) || 0;
  const number = nextProposalNumber(db, cfg, p.customerId, date);
  const dup = jobNumber.trim() && db.proposals.some(x => (x.jobNumber || "").trim().toLowerCase() === jobNumber.trim().toLowerCase());
  const go = async () => { setBusy(true); await onCopy(copy); setBusy(false); };
  return <Modal title={"Copy " + p.number + (revLabel(p) ? " " + revLabel(p) : "")} onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !jobNumber.trim()} onClick={go}><Ico d={ICONS.copy} size={15} />{busy ? "Copying…" : "Create Copy & Edit"}</button></>}>
    <p className="subtle" style={{ marginTop: 0 }}>The copy is a new draft, numbered <b className="mono">{number}</b>, with everything else carried over. {p.number} isn't changed.</p>
    <div className="row">
      <Field label="Job Number" hint={dup ? "⚠ Another proposal already has this job number" : undefined}>
        <input className="input mono" autoFocus value={jobNumber} onChange={e => setJobNumber(e.target.value)} placeholder={p.jobNumber || "e.g. 4810-F2"} /></Field>
      <Field label="Description"><input className="input" value={description} onChange={e => setDescription(e.target.value)} /></Field>
    </div>
    <div className="subtle" style={{ fontWeight: 600, margin: "4px 0 6px" }}>Duplicate machine reduction <span style={{ fontWeight: 400 }}>— optional; the engineering is largely done once</span></div>
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
      <select className="select" style={{ width: 110 }} value={red.type} onChange={e => setRed({ ...red, type: e.target.value })}>
        <option value="amt">$ off</option><option value="pct">% off</option></select>
      <input className="input mono" type="number" min="0" step="any" style={{ width: 140, textAlign: "right" }} placeholder="0" value={red.value} onChange={e => setRed({ ...red, value: e.target.value })} />
    </div>
    <table><tbody>
      <tr><td>Original price ({p.number})</td><td className="num mono">{money(original)}</td></tr>
      {Math.abs(before - original) > 0.005 && <tr><td className="subtle">Copy at today's rates</td><td className="num mono subtle">{money(before)}</td></tr>}
      <tr><td>Reduction</td><td className="num mono" style={{ color: priced.reduction > 0 ? "var(--pos)" : undefined }}>{priced.reduction > 0 ? "−" + money(priced.reduction) : "—"}</td></tr>
      <tr style={{ fontWeight: 700 }}><td>New price</td><td className="num mono">{money(priced.total)}</td></tr>
    </tbody></table>
  </Modal>;
}

function PropMenu({ p, setStatus, win, del, revise, onPhases, onCopy }) {
  return <ActionMenu minWidth={200}>{close => {
    const item = (label, fn, opts = {}) => <MenuItem {...opts} onClick={() => { fn(); close(); }}>{label}</MenuItem>;
    return <>
      {p.status === "draft" && item("Mark as Submitted", () => setStatus(p.id, "submitted"))}
      {p.status !== "won" && p.status !== "superseded" && item("Won — PO received →", () => win(p), { accent: true })}
      {p.status === "won" && item("Invoice Phases…", onPhases, { accent: true })}
      {p.status !== "superseded" && item("New Revision", () => revise(p))}
      {item("Copy Proposal…", onCopy)}
      {p.status !== "lost" && p.status !== "won" && p.status !== "superseded" && item("Mark as Lost", () => setStatus(p.id, "lost"))}
      {item("Delete", () => del(p.id), { danger: true })}
    </>;
  }}</ActionMenu>;
}

// What this proposal provides: the scope package, the end customer whose
// standards apply, the PLC / HMI, and the ticks the bullets, price lines,
// sales notes and invoicing schedule follow (calc/fixtureScope.js).
function ScopeCard({ x, setX, db, cfg }) {
  const sp = x.specs || {};
  const packages = packagesOf(db.settings);
  const pkg = packages.find(p => p.id === sp.packageId);
  const billed = (x.phases || []).some(ph => ph.invoiceId);
  const setSpecs = patch => setX(prev => ({ ...prev, specs: { ...prev.specs, ...patch } }));
  const pickPackage = id => {
    const pk = packages.find(p => p.id === id);
    if (!id) { setSpecs({ packageId: "" }); return; }
    setX(prev => {
      const was = packages.find(q => q.id === prev.specs?.packageId);
      const location = !prev.location || prev.location === (was?.location ?? "") ? (pk.location ?? prev.location) : prev.location;
      return { ...prev, location, specs: { ...prev.specs, ...packageDefaults(pk) }, phases: billed ? prev.phases : pk.phases.map(ph => ({ ...ph })) };
    });
  };
  const sc = { ...(pkg?.scope || {}), ...(sp.scope || {}) };
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>Scope of Supply</h3>
      <span className="subtle" style={{ marginLeft: "auto" }}>{pkg ? "what this proposal provides — the bullets, pricing, notes and invoicing schedule follow it" : "a proposal from before scope packages — it reads as it always has"}</span></div>
    <div className="card-body">
      <div className="row">
        <Field label="Scope package" hint={billed ? "Phases already billed — the schedule stays as it is" : "Sets the ticks, PLC / HMI and invoicing schedule"}>
          <select className="select" value={sp.packageId || ""} onChange={e => pickPackage(e.target.value)}>
            {!sp.packageId && <option value="">— none (as before) —</option>}
            {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></Field>
        {pkg && <Field label="End customer" hint={standardsLine(pkg, sp.endCustomer) ? "Design will follow " + standardsLine(pkg, sp.endCustomer) : "Whose standards apply"}>
          <input className="input" list={"endc-" + pkg.id} value={sp.endCustomer || ""} placeholder="e.g. Mayco"
            onChange={e => { const end = e.target.value, was = mesFor(pkg, sp.endCustomer);
              // The end customer's MES comes with it, unless one was typed by hand.
              setSpecs({ endCustomer: end, ...(!sp.mesName || sp.mesName === was ? { mesName: mesFor(pkg, end) } : {}) }); }} />
          <datalist id={"endc-" + pkg.id}>{(pkg.endCustomers || []).map(n => <option key={n} value={n} />)}</datalist></Field>}
        <Field label="PLC"><input className="input" value={sp.plcType || ""} placeholder={pkg?.plcType || cfg.plcType} onChange={e => setSpecs({ plcType: e.target.value })} /></Field>
        <Field label="HMI"><input className="input" value={sp.hmiType || ""} placeholder={pkg?.hmiType || cfg.hmiType} onChange={e => setSpecs({ hmiType: e.target.value })} /></Field>
        <Field label="MES" hint="Named in the scope and the pricing"><input className="input" value={sp.mesName || ""} placeholder={pkg?.mesName || "Data National"} onChange={e => setSpecs({ mesName: e.target.value })} /></Field>
      </div>
      {pkg && <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
        {SCOPE_ITEMS.map(it => <label key={it.key} style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={!!sc[it.key]} onChange={e => setSpecs({ scope: { ...sc, [it.key]: e.target.checked } })} />
          {it.label}{it.hint && <span className="subtle" style={{ fontSize: 12 }}>({it.hint})</span>}</label>)}
      </div>}
    </div>
  </div>;
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
  const setOverride = (key, v) => setX(prev => {
    const o = { ...(prev.specs.priceOverrides || {}) };
    if (v === "") delete o[key]; else o[key] = v;
    return { ...prev, specs: { ...prev.specs, priceOverrides: o } };
  });
  const overrideCount = Object.values(x.specs.priceOverrides || {}).filter(v => v !== "" && v != null).length;
  const save = async () => { setSaving(true); await onSave(x); setSaving(false); };

  return <div data-editing="1">
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{x._new ? "New Fixture Proposal" : "Edit " + x.number}</h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Proposal"}</button>
      </div>
    </div>
    <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
      <div className="row">
        <Field label="Customer"><select className="select" value={x.customerId} onChange={e => {
          const cid = e.target.value, attn = proposalAttn(db, db.contacts.find(c => c.id === cid));
          // The contact belongs to the customer: a new customer brings its own
          // contact, or none — never the one picked for the customer before.
          // A scoped proposal moves to the new customer's package — its ticks,
          // PLC / HMI and schedule — as long as nothing on it has been billed.
          setX(prev => {
            const next = { ...prev, customerId: cid, ...attn };
            if (!prev.specs?.packageId || (prev.phases || []).some(ph => ph.invoiceId)) return next;
            const pk = packageForCustomer(db, cid), was = packagesOf(db.settings).find(q => q.id === prev.specs.packageId);
            const location = !prev.location || prev.location === (was?.location ?? "") ? (pk.location ?? "") : prev.location;
            return { ...next, location, specs: { ...prev.specs, ...packageDefaults(pk), endCustomer: "" }, phases: pk.phases.map(ph => ({ ...ph })) };
          });
        }}>
          <option value="">Select customer…</option>{pickable(customers, x.customerId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Contact / Attn" hint="Type any name, or pick a suggestion">
          <input className="input" list={"attn-" + x.customerId} value={x.contactName || ""} placeholder="e.g. Mr. John Murphy"
            onChange={e => { const v = e.target.value, hit = people.find(cp => [cp.name, personName(cp)].some(n => (n || "").trim().toLowerCase() === v.trim().toLowerCase()));
              setX(prev => ({ ...prev, contactName: v, contactPersonId: hit?.id || "" })); }} />
          <datalist id={"attn-" + x.customerId}>
            {[...new Set(people.map(cp => personName(cp)).filter(Boolean))].map((n, i) => <option key={i} value={n} />)}
          </datalist>
        </Field>
        {!x._new && <Field label="Proposal #" hint="Editable — revisions keep it together"><input className="input mono" value={x.number || ""} onChange={e => set("number", e.target.value)} /></Field>}
        <Field label="Date"><input className="input" type="date" value={x.date} onChange={e => set("date", e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Job Number"><input className="input mono" value={x.jobNumber} onChange={e => set("jobNumber", e.target.value)} placeholder="VGE_2026015" /></Field>
        <Field label="Description"><input className="input" value={x.description} onChange={e => set("description", e.target.value)} placeholder="Seat Back w/o Vent" /></Field>
        <Field label="Fixture Type"><select className="select" value={x.machineTypeId} onChange={e => set("machineTypeId", e.target.value)}>
          {db.machineTypes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></Field>
      </div>
      <Field label="Build / Start-up Location"><input className="input" value={x.location} onChange={e => set("location", e.target.value)} /></Field>
    </div></div>

    <ScopeCard x={x} setX={setX} db={db} cfg={cfg} />

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Fixture Content</h3>
        <span className="subtle" style={{ marginLeft: "auto" }}>{points} points → {blocks} I/O block{blocks === 1 ? "" : "s"}</span></div>
      <div className="card-body">
        <div className="row">
          {SPEC_FIELDS.map(([k, label]) => <Field key={k} label={label}>
            <input className="input mono" type="number" min="0" value={blankZero(x.specs[k])} placeholder="0" onChange={e => setSpec(k, e.target.value)} />
          </Field>)}
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <Field label="I/O Blocks" hint="Computed from content — override if needed">
            <input className="input mono" type="number" min="0" placeholder={String(blocks)} value={x.specs.ioBlocks ?? ""} onChange={e => setSpec("ioBlocks", e.target.value)} />
          </Field>
          <Field label="MES">
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0" }}>
              <input type="checkbox" checked={!!x.specs.dataNational} onChange={e => setSpec("dataNational", e.target.checked)} />
              Fixture reports to {x.specs.mesName ? x.specs.mesName + " (MES)" : "MES"}
            </label>
          </Field>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><h3>Pricing</h3>
        {overrideCount > 0 && <button className="btn sm" style={{ marginLeft: 12 }} onClick={() => setSpec("priceOverrides", {})}>
          <Ico d={ICONS.refresh} size={13} />Use Fixture Rates for all ({overrideCount} overridden)</button>}
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 700, fontSize: 17 }}>{money(pricing.total)}</span></div>
      <table className="li-table"><thead><tr><th>Line</th><th style={{ width: 80 }} title="Shown under Premium Pricing on the proposal">Premium</th><th className="num">From Fixture Rates</th><th className="num" style={{ width: 170 }}>Price on proposal</th><th style={{ width: 40 }}></th></tr></thead>
        <tbody>{["base", "premium"].filter(sec => sec === "base" || pricing.lines.some(l => l.section === "premium")).map(sec => [
          <tr key={sec} className="group-row"><td colSpan={5} style={{ background: "var(--canvas)", fontWeight: 700 }}>
            {sec === "base" ? (pricing.lines.some(l => l.section === "premium") ? "Base Pricing" : "Pricing") : "Premium Pricing"}
            <span className="mono" style={{ float: "right" }}>{money(sec === "base" ? pricing.base : pricing.premium)}</span></td></tr>,
          ...pricing.lines.filter(l => l.section === sec).map(l => {
            const off = !(l.amount > 0);
            return <tr key={l.key} style={off ? { opacity: 0.55 } : {}}>
              <td>{l.label}{off && <span className="subtle" style={{ fontSize: 12 }}> · left off the proposal</span>}
                {l.key === "eng" && pricing.engParts?.length > 0 && <div className="subtle" style={{ fontSize: 12 }}>{pricing.engParts.map(p => `${p.label} ${money(p.amount)}`).join(" + ")}</div>}
                {l.overridden && <span className="badge blue" style={{ marginLeft: 8 }}><span className="dot"></span>Overridden</span>}</td>
              <td><input type="checkbox" checked={l.section === "premium"} title="List this line under Premium Pricing"
                onChange={e => { const cur = pricing.lines.filter(q => q.section === "premium").map(q => q.key);
                  setSpec("premium", e.target.checked ? [...cur, l.key] : cur.filter(k => k !== l.key)); }} /></td>
              <td className="num mono subtle">{money(l.suggested)}</td>
              <td className="num"><input className="input mono" type="number" min="0" step="any" style={{ textAlign: "right", ...(l.overridden ? { background: "var(--accent-wash)", borderColor: "var(--accent)" } : {}) }}
                value={x.specs.priceOverrides?.[l.key] ?? ""} placeholder={String(l.suggested)}
                title="Blank uses the Fixture Rates figure; 0 leaves the line off" onChange={e => setOverride(l.key, e.target.value)} /></td>
              <td>{l.overridden && <button className="btn ghost icon" title="Back to the Fixture Rates figure" onClick={() => setOverride(l.key, "")}><Ico d={ICONS.refresh} size={14} /></button>}</td>
            </tr>;
          }),
        ])}</tbody></table>
      <div style={{ padding: "4px 16px 0" }}>
        <ReductionRow reduction={x.specs.reduction} amount={pricing.reduction} onChange={v => setSpec("reduction", v)} />
      </div>
      <p className="subtle" style={{ margin: "8px 16px 12px", fontSize: 12 }}>Type a price to override a line for this proposal only — blank uses the Fixture Rates figure, 0 leaves the line off. Changing the content or the fixture type re-works the figures, but a typed price stays until you clear it.</p>
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

function ProposalDoc({ p, db, onClose, toast, onEdit, auto }) {
  const c = p.kind === "controls" ? buildControlsContent(p, db) : buildProposalContent(p, db);
  const s = db.settings;
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(auto === "email");
  // Same two moves DocumentView makes, and for the same reason: the overlay is
  // portalled out of the page so it isn't inside .main, and the body is flagged
  // so printing hides .main. Rendered in place it printed the proposals list on
  // the sheets ahead of the proposal. The tab title becomes the file name while
  // the document is open: Print / Save PDF offers document.title as the file
  // name, so it matches the Word download instead of reading "Ledger".
  useEffect(() => {
    const title = document.title;
    document.body.classList.add("doc-open");
    document.title = proposalFileStem(p);
    return () => { document.body.classList.remove("doc-open"); document.title = title; };
  }, [p]);
  const word = async () => {
    setBusy(true);
    try { await downloadProposalDocx(p, db); }
    catch (e) { toast("⚠ Word export failed: " + (e.message || e)); }
    setBusy(false);
  };
  // The PDF is the document as it prints: a fixture proposal's two pages each
  // shrunk to fit a page; a system proposal runs on.
  const docRef = useRef();
  const savePdf = async () => {
    setBusy(true);
    try {
      const pages = [...docRef.current.querySelectorAll(".prop-page")];
      const { blob, filename } = await pagesToPdf(pages.length ? pages : [docRef.current],
        { filename: proposalFileStem(p) + ".pdf", title: proposalFileStem(p), fit: pages.length > 0 });
      saveBlob(blob, filename);
    } catch (e) { toast("⚠ Couldn't make the PDF: " + (e.message || e)); }
    setBusy(false);
  };
  // Opened from a list's Print or Save PDF: once the pages have laid out, do
  // that one thing and close again.
  useEffect(() => {
    if (auto !== "print" && auto !== "pdf") return;
    const t = setTimeout(async () => {
      if (auto === "print") window.print(); else await savePdf();
      onClose();
    }, 400);
    return () => clearTimeout(t);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(<div className="doc-screen">
    <DocActions onClose={onClose} onEdit={onEdit} onEmail={() => setEmail(true)} onPrint={() => window.print()} busy={busy}
      saves={[{ label: "Save PDF", hint: proposalFileStem(p) + ".pdf", run: savePdf }, { label: "Save Word", hint: proposalFileStem(p) + ".docx", run: word }]} />
    {email && <EmailModal docType="proposal"
      title={"Email · " + p.number}
      defaultTo={c.person?.email || emailFor(db, p.customerId, "proposal")}
      defaultSubject={`Proposal ${p.number}${revLabel(p) ? " " + revLabel(p) : ""} — ${[p.jobNumber, p.description].filter(Boolean).join(" – ")}`}
      defaultBody={`${c.salutation.replace(/:$/, ",")}\n\nPlease find attached proposal ${p.number} for ${p.description || "the machine"}.\n\nRegards,\n${c.cfg.signer || s.company}`}
      buildAttachment={() => proposalDocxBlob(p, db)}
      onClose={() => setEmail(false)} toast={toast} />}
    <div ref={docRef}>
    {p.kind === "controls" ? <ControlsDocBody p={p} db={db} /> : <><div className="printable prop-doc prop-page">
      <div style={{ textAlign: "center", marginBottom: 26 }}><img src="/tmj-logo.png" alt="TMJ Engineering" style={{ width: 170 }} /></div>
      <p>{fmtDate(p.date)}</p>
      <p style={{ whiteSpace: "pre-line" }}>{[c.person?.name, c.customer?.name, c.customer?.address].filter(Boolean).join("\n")}</p>
      <p className="mono" style={{ marginTop: 18 }}>Proposal: {p.number}<br />Re: {p.jobNumber}{p.jobNumber && p.description ? " – " : ""}{p.description}</p>
      <p>{c.salutation}</p>
      <p>Thank you for giving {s.company || "us"} an opportunity to provide a proposal for services and deliverables for {c.intro} for (1) Assembly Machine.</p>
      <h4 style={{ margin: "14px 0 4px" }}>Scope</h4>
      <p style={{ marginTop: 0 }}>{s.company || "We"} will provide design services with the following deliverables:</p>
      <ul className="prop-bullets">
        {c.bullets.map((b, i) => <li key={i} className={cls(b.sub && "sub")}>{b.t}</li>)}
      </ul>
    </div>
    {/* Page two starts with Sales Notes and Clarifications, on screen and on paper. */}
    <div className="printable prop-doc prop-page">
      <h4 style={{ margin: "0 0 4px" }}>Sales Notes and Clarifications</h4>
      <ol className="prop-bullets">{c.salesNotes.map((t, i) => <li key={i}>{t}</li>)}</ol>
      <div className="prop-price">
        {c.pkg && !c.pricing.premiumLines.length
          // Nothing under Premium: one list and its total, no sub-totals.
          ? <><h4>Pricing</h4><table><tbody>
            {c.pricing.baseLines.map(l => <tr key={l.label}><td>{l.label}</td><td className="amt">{money(l.amount)}</td></tr>)}
            <tr className="tot"><td>Total Price for this proposal is:</td><td className="amt">{money(c.pricing.total)}</td></tr>
          </tbody></table></>
          : <><h4>Base Pricing</h4>
        <table><tbody>
          {c.pricing.baseLines.map(l => <tr key={l.label}><td>{l.label}</td><td className="amt">{money(l.amount)}</td></tr>)}
          <tr className="tot"><td>Base Price Sub Total</td><td className="amt">{money(c.pricing.base)}</td></tr>
        </tbody></table>
        {c.pricing.premiumLines.length > 0 && <>
          <h4>Premium Pricing</h4>
          <table><tbody>
            {c.pricing.premiumLines.map(l => <tr key={l.label}><td>{l.label}</td><td className="amt">{money(l.amount)}</td></tr>)}
            <tr className="tot"><td>Premium Price Sub Total</td><td className="amt">{money(c.pricing.premium)}</td></tr>
          </tbody></table>
        </>}
        <table style={{ marginTop: 10 }}><tbody>
          <tr className="tot"><td>Total Price for this proposal is:</td><td className="amt">{money(c.pricing.total)}</td></tr>
        </tbody></table></>}
        <h4>Invoicing Schedule</h4>
        <p style={{ margin: "2px 0 6px" }}>Project will be invoiced according to the following invoicing schedule</p>
        <table className="sched"><tbody>
          {c.phases.map(ph => <tr key={ph.key}><td>{ph.label}</td><td className="pct">{ph.pct}%</td><td className="amt plain">{money(ph.amount)}</td></tr>)}
        </tbody></table>
      </div>
      <p style={{ marginTop: 18 }}>{c.terms}</p>
      <p>I hope you find this offering favorable. If you have any questions, or require additional information, please feel free to contact me.</p>
      <p style={{ marginBottom: 34 }}>Regards,</p>
      <p>{c.cfg.signer || s.company}</p>
      <div className="doc-foot">{[s.companyAddress?.replace(/\n/g, ", "), s.companyPhone].filter(Boolean).join(" - ")}</div>
    </div></>}
    </div>
  </div>, document.body);
}
