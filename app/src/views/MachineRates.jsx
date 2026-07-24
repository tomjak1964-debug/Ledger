import { useState } from "react";
import { uid, money } from "../lib/helpers.js";
import { TMJ_DEFAULT_RATES } from "../calc/proposals.js";
import { Ico, ICONS, Empty, Modal, Field } from "../components/ui.jsx";

const RATE_FIELDS = [
  ["engBase", "Engineering/Start-Up Base"], ["cameraRate", "Per-Camera Adder"],
  ["panelBudget", "Control Panel Budget"], ["ioFirst", "1st I/O Block"], ["ioAddl", "Each Add'l I/O Block"],
  ["dnCheckout", "Data National Checkout"], ["dnMaterial", "Data National Material"],
  ["fieldWiring", "Field Wiring"], ["runoff", "Run Off Support"], ["remoteHmi", "Remote HMI"],
];

export default function MachineRatesView({ db, actions, toast }) {
  const [edit, setEdit] = useState(null);
  const save = async (m) => {
    const clean = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, RATE_FIELDS.some(([f]) => f === k) ? Number(v) || 0 : v]));
    if (await actions.saveMachineType(clean)) { setEdit(null); toast("Rates saved"); }
  };
  const del = async (id) => { if (!confirm("Delete this machine type?")) return; if (await actions.deleteMachineType(id)) toast("Deleted"); };

  return <div>
    <div className="toolbar">
      <p className="subtle" style={{ margin: 0 }}>The costing table behind proposal pricing — every rate is editable per machine type.</p>
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setEdit({ id: uid(), _new: true, name: "", sort: db.machineTypes.length, ...Object.fromEntries(RATE_FIELDS.map(([k]) => [k, 0])) })}><Ico d={ICONS.plus} size={15} />New Machine Type</button>
    </div>
    <div className="card">
      {db.machineTypes.length === 0
        ? <Empty icon={ICONS.so} title="No machine rates yet" msg="Load the TMJ defaults (Big Sonic, Robot Sonic, Check, Screw, Insert, Limiter — from TMJ Costing.xlsx) and adjust from there."
          action={<button className="btn primary" onClick={async () => { if (await actions.seedMachineRates(TMJ_DEFAULT_RATES)) toast("TMJ default rates loaded"); }}>Load TMJ Default Rates</button>} />
        : <table><thead><tr><th>Machine Type</th><th className="num">Eng Base</th><th className="num">/Camera</th><th className="num">Panel</th><th className="num">I/O 1st</th><th className="num">I/O Add'l</th><th className="num">Wiring</th><th className="num">Run Off</th><th className="num">Remote HMI</th><th></th></tr></thead>
          <tbody>{db.machineTypes.map(m => <tr key={m.id}>
            <td style={{ fontWeight: 600 }}>{m.name}</td>
            <td className="num">{money(m.engBase)}</td><td className="num">{money(m.cameraRate)}</td>
            <td className="num">{money(m.panelBudget)}</td><td className="num">{money(m.ioFirst)}</td>
            <td className="num">{money(m.ioAddl)}</td><td className="num">{money(m.fieldWiring)}</td>
            <td className="num">{money(m.runoff)}</td><td className="num">{m.remoteHmi ? money(m.remoteHmi) : "—"}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <button className="btn ghost icon" onClick={() => setEdit({ ...m })} title="Edit"><Ico d={ICONS.edit} size={15} /></button>
              <button className="btn ghost icon" onClick={() => del(m.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>
            </td>
          </tr>)}</tbody></table>}
    </div>
    {edit && <Modal title={edit._new ? "New Machine Type" : "Edit " + edit.name} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => save(edit)}>Save Rates</button></>}>
      <Field label="Machine Type Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Big Sonic" /></Field>
      <div className="row">
        {RATE_FIELDS.map(([k, label]) => <Field key={k} label={label}>
          <input className="input mono" type="number" step="any" value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })} />
        </Field>)}
      </div>
      <p className="subtle">Data National amounts only apply when a proposal has "Data National" checked. Remote HMI &gt; 0 adds a Base Pricing line and a scope bullet.</p>
    </Modal>}
  </div>;
}
