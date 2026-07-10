import { useState } from "react";
import { uid, money } from "../lib/helpers.js";
import { Ico, ICONS, Empty, Modal, Field } from "../components/ui.jsx";

export default function CatalogView({ db, actions, toast }) {
  const [edit, setEdit] = useState(null);
  const save = async (c) => { if (await actions.saveCatalogItem(c)) { setEdit(null); toast("Saved"); } };
  const del = async (id) => { if (await actions.deleteCatalogItem(id)) toast("Removed"); };
  return <div>
    <div className="toolbar">
      <p className="subtle" style={{ margin: 0 }}>Reusable line items you can drop into any quote.</p>
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setEdit({ id: uid(), desc: "", unit: "each", unitPrice: 0 })}><Ico d={ICONS.plus} size={15} />New Item</button>
    </div>
    <div className="card">
      {db.catalog.length === 0
        ? <Empty icon={ICONS.catalog} title="Empty catalog" msg="Save the services and parts you quote repeatedly with default pricing." />
        : <table><thead><tr><th>Description</th><th>Unit</th><th className="num">Unit Price</th><th></th></tr></thead>
          <tbody>{db.catalog.map(c => (
            <tr key={c.id}>
              <td>{c.desc}</td><td className="subtle">{c.unit}</td><td className="num">{money(c.unitPrice)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn ghost icon" onClick={() => setEdit({ ...c })}><Ico d={ICONS.edit} size={15} /></button>
                <button className="btn ghost icon" onClick={() => del(c.id)}><Ico d={ICONS.trash} size={15} /></button>
              </td>
            </tr>
          ))}</tbody></table>}
    </div>
    {edit && <Modal title={edit.desc ? "Edit Item" : "New Catalog Item"} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => save(edit)}>Save</button></>}>
      <Field label="Description"><input className="input" value={edit.desc} onChange={e => setEdit({ ...edit, desc: e.target.value })} /></Field>
      <div className="row">
        <Field label="Unit"><input className="input" value={edit.unit} onChange={e => setEdit({ ...edit, unit: e.target.value })} placeholder="hour, each, lot…" /></Field>
        <Field label="Default Unit Price"><input className="input mono" type="number" step="any" value={edit.unitPrice} onChange={e => setEdit({ ...edit, unitPrice: e.target.value })} /></Field>
      </div>
    </Modal>}
  </div>;
}
