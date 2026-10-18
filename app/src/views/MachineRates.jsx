import { useState } from "react";
import { uid, money } from "../lib/helpers.js";
import { TMJ_DEFAULT_RATES } from "../calc/proposals.js";
import { packagesOf, SCOPE_ITEMS, standardsLine } from "../calc/fixtureScope.js";
import { canWrite } from "../lib/permissions.js";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort, blankZero } from "../components/ui.jsx";

// Fixture Rates: the costing table behind fixture proposals, one row per
// fixture type. (The table and the code still call them machine types.) A
// rate left at 0 is left off the proposal entirely.
// The editor's sections. Engineering: everything here adds up into the one
// Engineering/Start-Up line on the proposal — the per-unit adders multiplied by
// the counts on the proposal. Hardware: each is a line of its own on the
// proposal, left off at $0. Field & support: labor priced as lines of their own.
const SECTIONS = [
  { key: "engineering", title: "Engineering", note: "All of these add up into the proposal's Engineering/Start-Up line. Per-unit amounts multiply by the counts on the proposal.",
    fields: [["engBase", "Engineering / Start-Up Base"], ["hardwareDesign", "Hardware Design"], ["hmiRate", "Per HMI"],
      ["cameraRate", "Per Camera"], ["torqueRate", "Per Torque Tool"], ["ioLinkRate", "Per IO-Link Device"]] },
  { key: "hardware", title: "Hardware", note: "Each is its own line on the proposal, with a scope bullet. A $0 item is left off. Data National Material only applies when the proposal has Data National ticked.",
    fields: [["panelBudget", "Control Panel / HMI / Bingo Board"], ["ioFirst", "1st Block I/O"], ["ioAddl", "Each Add'l Block I/O"],
      ["remoteHmi", "Remote HMI"], ["remoteSonic", "Remote Sonic Panel"], ["dnMaterial", "Data National Material"]] },
  { key: "services", title: "Field & Support", note: "Labor priced as lines of their own. Data National Checkout only applies with Data National ticked. A $0 item is left off.",
    fields: [["fieldWiring", "Field Wiring"], ["runoff", "Run Off Support"], ["dnCheckout", "Data National Checkout"]] },
];
const RATE_FIELDS = SECTIONS.flatMap(sec => sec.fields);
// list columns, in the order the shop reads them
const COLUMNS = [
  ["engBase", "Eng Base"], ["hardwareDesign", "Hdw Design"], ["hmiRate", "/HMI"], ["cameraRate", "/Camera"], ["torqueRate", "/Torque"], ["ioLinkRate", "/IO Link"],
  ["panelBudget", "Panel"], ["ioFirst", "I/O 1st"], ["ioAddl", "I/O Add'l"], ["remoteHmi", "Remote HMI"], ["remoteSonic", "Remote Sonic"],
  ["fieldWiring", "Wiring"], ["runoff", "Run Off"],
];

export default function MachineRatesView({ db, actions, toast, readOnly, member }) {
  const [edit, setEdit] = useState(null);
  const save = async (m) => {
    // A copy starts with the same name as its source, so a blank or repeated
    // name is refused: the proposal's type list would show two the same.
    const name = (m.name || "").trim();
    if (!name) { toast("Give the fixture type a name."); return; }
    if (db.machineTypes.some(x => x.id !== m.id && (x.name || "").trim().toLowerCase() === name.toLowerCase())) {
      toast(`There's already a fixture type called "${name}".`); return;
    }
    const { copyOf, ...rest } = m;
    m = { ...rest, name };
    const clean = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, RATE_FIELDS.some(([f]) => f === k) ? Number(v) || 0 : v]));
    if (await actions.saveMachineType(clean)) { setEdit(null); toast("Rates saved"); }
  };
  const del = async (id) => { if (!confirm("Delete this fixture type?")) return; if (await actions.deleteMachineType(id)) toast("Deleted"); };
  const { sorted: rateRows, sort, onSort } = useTableSort(db.machineTypes, {
    name: m => m.name || "",
    ...Object.fromEntries(RATE_FIELDS.map(([k]) => [k, m => Number(m[k]) || 0])),
  });

  return <div>
    <div className="toolbar">
      <p className="subtle" style={{ margin: 0 }}>The costing table behind fixture proposal pricing — every rate is editable per fixture type. A rate of 0 is left off the proposal.</p>
      {!readOnly && <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setEdit({ id: uid(), _new: true, name: "", sort: db.machineTypes.length, ...Object.fromEntries(RATE_FIELDS.map(([k]) => [k, 0])) })}><Ico d={ICONS.plus} size={15} />New Fixture Type</button>}
    </div>
    <div className="card">
      {db.machineTypes.length === 0
        ? <Empty icon={ICONS.so} title="No fixture rates yet" msg="Load the TMJ defaults (Big Sonic, Robot Sonic, Check, Screw, Insert, Limiter — from TMJ Costing.xlsx) and adjust from there."
          action={!readOnly && <button className="btn primary" onClick={async () => { if (await actions.seedMachineRates(TMJ_DEFAULT_RATES)) toast("TMJ default rates loaded"); }}>Load TMJ Default Rates</button>} />
        : <table><thead><tr>
          <SortTh label="Fixture Type" col="name" sort={sort} onSort={onSort} />
          {COLUMNS.map(([col, label]) => <SortTh key={col} label={label} col={col} sort={sort} onSort={onSort} num />)}
          <th></th></tr></thead>
          <tbody>{rateRows.map(m => <tr key={m.id}>
            <td style={{ fontWeight: 600 }}>{m.name}</td>
            {COLUMNS.map(([col]) => <td key={col} className="num">{Number(m[col]) > 0 ? money(m[col]) : "—"}</td>)}
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              {!readOnly && <button className="btn ghost icon" onClick={() => setEdit({ ...m })} title="Edit"><Ico d={ICONS.edit} size={15} /></button>}
              {!readOnly && <button className="btn ghost icon" title="Copy to a new fixture type — every rate carries over"
                onClick={() => setEdit({ ...m, id: uid(), _new: true, copyOf: m.name, name: m.name + " (copy)", sort: db.machineTypes.length })}><Ico d={ICONS.copy} size={15} /></button>}
              {!readOnly && <button className="btn ghost icon" onClick={() => del(m.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>}
            </td>
          </tr>)}</tbody></table>}
    </div>
    <ScopePackages db={db} actions={actions} toast={toast} editable={!readOnly && canWrite(member, "settings")} />
    {edit && <Modal wide title={edit.copyOf ? "New Fixture Type from " + edit.copyOf : edit._new ? "New Fixture Type" : "Edit " + edit.name} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => save(edit)}>Save Rates</button></>}>
      <Field label="Fixture Type Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Big Sonic" /></Field>
      {SECTIONS.map(sec => <div key={sec.key} style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 4, marginBottom: 8 }}>
          <b>{sec.title}</b>
          {sec.key === "engineering" && <span className="subtle mono" style={{ marginLeft: "auto" }}>base + design = {money((Number(edit.engBase) || 0) + (Number(edit.hardwareDesign) || 0))}</span>}
        </div>
        <p className="subtle" style={{ margin: "0 0 8px", fontSize: 12.5 }}>{sec.note}</p>
        <div className="row">
          {sec.fields.map(([k, label]) => <Field key={k} label={label}>
            <input className="input mono" type="number" step="any" value={blankZero(edit[k])} placeholder="0" onChange={e => setEdit({ ...edit, [k]: e.target.value })} />
          </Field>)}
        </div>
      </div>)}
    </Modal>}
  </div>;
}

// Scope packages: the saved starting points for a fixture proposal — what is
// provided (the ticks), the opening line, whose standards apply, the PLC / HMI
// and the invoicing schedule — and the customers whose proposals start on each.
// Stored as settings.fixturePackages (calc/fixtureScope.js).
function ScopePackages({ db, actions, toast, editable }) {
  const [edit, setEdit] = useState(null);   // { index, pkg }
  const packages = packagesOf(db.settings);
  const customers = db.contacts.filter(c => c.type === "customer" && c.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const startsOn = pk => customers.filter(c => (pk.customerIds || []).includes(c.id) || (!pk.customerIds && pk.match && c.name.toLowerCase().includes(pk.match))).map(c => c.name);
  const save = async () => {
    const pk = edit.pkg;
    if (!(pk.name || "").trim()) { toast("Give the package a name."); return; }
    const pct = (pk.phases || []).reduce((t, ph) => t + (Number(ph.pct) || 0), 0);
    if (Math.abs(pct - 100) > 0.01) { toast(`The invoicing schedule adds up to ${pct}% — it has to be 100%.`); return; }
    // A customer starts on one package: naming it here takes it off the others.
    const ids = pk.customerIds || [];
    const list = packages.map((p, i) => (i === edit.index ? null : { ...p, customerIds: (p.customerIds || startsOnIds(p)).filter(id => !ids.includes(id)) }));
    const clean = { ...pk, name: pk.name.trim(), endCustomers: (pk.endCustomers || []).map(x => x.trim()).filter(Boolean),
      phases: pk.phases.map((ph, i) => ({ key: ph.key || "ph" + i, label: ph.label, pct: Number(ph.pct) || 0 })) };
    delete clean.match;
    const next = edit.index == null ? [...list.filter(Boolean), clean] : list.map((p, i) => (i === edit.index ? clean : p));
    if (await actions.saveSettings({ ...db.settings, fixturePackages: next })) { setEdit(null); toast("Scope package saved"); }
  };
  const startsOnIds = p => customers.filter(c => p.match && c.name.toLowerCase().includes(p.match)).map(c => c.id);
  const open = (pk, index) => setEdit({ index, pkg: { ...pk, customerIds: pk.customerIds || startsOnIds(pk), scope: { ...pk.scope }, phases: pk.phases.map(ph => ({ ...ph })), endCustomers: [...(pk.endCustomers || [])] } });
  const P = edit?.pkg;
  const setP = patch => setEdit(e => ({ ...e, pkg: { ...e.pkg, ...patch } }));
  return <div className="card" style={{ marginTop: 16 }}>
    <div className="card-head"><h3>Scope Packages</h3>
      <span className="subtle" style={{ marginLeft: 12 }}>what a fixture proposal provides — each customer's proposals start on one</span>
      {editable && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => open({ id: uid(), name: "", intro: "", standards: "", location: "", endCustomers: [], plcType: "", hmiType: "", scope: Object.fromEntries(SCOPE_ITEMS.map(i => [i.key, false])), phases: [{ key: "ph0", label: "", pct: 100 }], customerIds: [] }, null)}><Ico d={ICONS.plus} size={14} />New Package</button>}
    </div>
    <table><thead><tr><th>Package</th><th>Provides</th><th>Invoicing schedule</th><th>Customers</th><th></th></tr></thead>
      <tbody>{packages.map((pk, i) => <tr key={pk.id}>
        <td><div style={{ fontWeight: 600 }}>{pk.name}</div><div className="subtle" style={{ fontSize: 12 }}>"{pk.intro}"</div></td>
        <td className="subtle" style={{ fontSize: 12.5 }}>{SCOPE_ITEMS.filter(it => pk.scope?.[it.key]).map(it => it.label.split(/[,(]/)[0].trim()).join(" · ")}</td>
        <td className="subtle" style={{ fontSize: 12.5 }}>{pk.phases.map(ph => `${ph.label} ${ph.pct}%`).join(" · ")}</td>
        <td className="subtle" style={{ fontSize: 12.5 }}>{startsOn(pk).join(", ") || "—"}</td>
        <td style={{ textAlign: "right" }}>{editable && <button className="btn ghost icon" title="Edit" onClick={() => open(pk, i)}><Ico d={ICONS.edit} size={15} /></button>}</td>
      </tr>)}</tbody></table>
    {!editable && <p className="subtle" style={{ margin: "8px 16px 12px", fontSize: 12 }}>Only someone with Settings access can change the packages.</p>}
    {P && <Modal wide title={edit.index == null ? "New Scope Package" : "Edit " + P.name} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save Package</button></>}>
      <div className="row">
        <Field label="Package name"><input className="input" value={P.name} onChange={e => setP({ name: e.target.value })} placeholder="Software & Start-Up" /></Field>
        <Field label="Opening line" hint="“…a proposal for services and deliverables for ___ for (1) Assembly Machine.”">
          <input className="input" value={P.intro} onChange={e => setP({ intro: e.target.value })} placeholder="Controls Software and Start-Up Support" /></Field>
      </div>
      <div className="row">
        <Field label="Standards" hint={"{end} is the proposal's end customer — e.g. “" + (standardsLine(P, (P.endCustomers || [])[0]) || "…") + "”"}>
          <input className="input" value={P.standards} onChange={e => setP({ standards: e.target.value })} placeholder="ASI and {end} Standards" /></Field>
        <Field label="End customers" hint="Suggested on the proposal, comma-separated">
          <input className="input" value={(P.endCustomers || []).join(", ")} onChange={e => setP({ endCustomers: e.target.value.split(",") })} /></Field>
      </div>
      <div className="row">
        <Field label="Start-up location" hint="Where start-up is included — blank uses the customer's name"><input className="input" value={P.location || ""} onChange={e => setP({ location: e.target.value })} /></Field>
        <Field label="Default PLC"><input className="input" value={P.plcType} onChange={e => setP({ plcType: e.target.value })} /></Field>
        <Field label="Default HMI"><input className="input" value={P.hmiType} onChange={e => setP({ hmiType: e.target.value })} /></Field>
      </div>
      <div className="subtle" style={{ fontWeight: 600, margin: "6px 0" }}>Provides</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: 12 }}>
        {SCOPE_ITEMS.map(it => <label key={it.key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={!!P.scope[it.key]} onChange={e => setP({ scope: { ...P.scope, [it.key]: e.target.checked } })} />{it.label}</label>)}
      </div>
      <div className="subtle" style={{ fontWeight: 600, margin: "6px 0" }}>Invoicing schedule <span className="mono" style={{ fontWeight: 400 }}>{P.phases.reduce((t, ph) => t + (Number(ph.pct) || 0), 0)}%</span></div>
      {P.phases.map((ph, i) => <div key={i} className="row" style={{ alignItems: "center", marginBottom: 4 }}>
        <input className="input" value={ph.label} onChange={e => setP({ phases: P.phases.map((q, j) => (j === i ? { ...q, label: e.target.value } : q)) })} />
        <input className="input mono" type="number" min="0" style={{ maxWidth: 90 }} value={ph.pct} onChange={e => setP({ phases: P.phases.map((q, j) => (j === i ? { ...q, pct: e.target.value } : q)) })} />
        <button className="btn ghost icon" onClick={() => setP({ phases: P.phases.filter((_, j) => j !== i) })}><Ico d={ICONS.trash} size={14} /></button>
      </div>)}
      <button className="btn sm" onClick={() => setP({ phases: [...P.phases, { key: "ph" + P.phases.length + Date.now(), label: "", pct: 0 }] })}><Ico d={ICONS.plus} size={13} />Add phase</button>
      <div className="subtle" style={{ fontWeight: 600, margin: "14px 0 6px" }}>Customers whose fixture proposals start on this package</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", maxHeight: 160, overflow: "auto" }}>
        {customers.map(c => <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={(P.customerIds || []).includes(c.id)}
            onChange={e => setP({ customerIds: e.target.checked ? [...(P.customerIds || []), c.id] : (P.customerIds || []).filter(id => id !== c.id) })} />{c.name}</label>)}
      </div>
    </Modal>}
  </div>;
}
