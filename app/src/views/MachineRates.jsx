import { useState } from "react";
import { uid, money } from "../lib/helpers.js";
import { TMJ_DEFAULT_RATES } from "../calc/proposals.js";
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

export default function MachineRatesView({ db, actions, toast, readOnly }) {
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
