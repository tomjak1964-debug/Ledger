import { useState } from "react";
import { uid, money } from "../lib/helpers.js";
import { TMJ_DEFAULT_RATES } from "../calc/proposals.js";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort } from "../components/ui.jsx";

// Fixture Rates: the costing table behind fixture proposals, one row per
// fixture type. (The table and the code still call them machine types.) A
// rate left at 0 is left off the proposal entirely.
const RATE_FIELDS = [
  ["engBase", "Engineering/Start-Up Base"], ["cameraRate", "Per-Camera Adder"],
  ["torqueRate", "Per-Torque Tool Adder"], ["ioLinkRate", "Per-IO-Link Adder"],
  ["panelBudget", "Control Panel Budget"], ["ioFirst", "1st I/O Block"], ["ioAddl", "Each Add'l I/O Block"],
  ["dnCheckout", "Data National Checkout"], ["dnMaterial", "Data National Material"],
  ["fieldWiring", "Field Wiring"], ["runoff", "Run Off Support"], ["remoteHmi", "Remote HMI"],
  ["remoteSonic", "Remote Sonic Panel"],
];
// list columns, in the order the shop reads them
const COLUMNS = [
  ["engBase", "Eng Base"], ["cameraRate", "/Camera"], ["torqueRate", "/Torque"], ["ioLinkRate", "/IO Link"],
  ["panelBudget", "Panel"], ["ioFirst", "I/O 1st"], ["ioAddl", "I/O Add'l"], ["fieldWiring", "Wiring"],
  ["runoff", "Run Off"], ["remoteHmi", "Remote HMI"], ["remoteSonic", "Remote Sonic"],
];

export default function MachineRatesView({ db, actions, toast, readOnly }) {
  const [edit, setEdit] = useState(null);
  const save = async (m) => {
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
              {!readOnly && <button className="btn ghost icon" onClick={() => del(m.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>}
            </td>
          </tr>)}</tbody></table>}
    </div>
    {edit && <Modal title={edit._new ? "New Fixture Type" : "Edit " + edit.name} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => save(edit)}>Save Rates</button></>}>
      <Field label="Fixture Type Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Big Sonic" /></Field>
      <div className="row">
        {RATE_FIELDS.map(([k, label]) => <Field key={k} label={label}>
          <input className="input mono" type="number" step="any" value={edit[k] ?? 0} onChange={e => setEdit({ ...edit, [k]: e.target.value })} />
        </Field>)}
      </div>
      <p className="subtle">Per-camera, per-torque tool and per-IO-Link adders multiply by the count on the proposal and roll into the Engineering/Start-Up line. Data National amounts only apply when a proposal has "Data National" checked. Remote HMI and Remote Sonic Panel &gt; 0 each add a Base Pricing line and a scope bullet. Any rate left at 0 is left off the proposal.</p>
    </Modal>}
  </div>;
}
