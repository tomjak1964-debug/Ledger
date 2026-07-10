import { useState } from "react";
import { uid } from "../lib/helpers.js";
import { Ico, ICONS, Empty, Modal, Field } from "../components/ui.jsx";

export default function ContactsView({ db, actions, toast }) {
  const [tab, setTab] = useState("customer");
  const [edit, setEdit] = useState(null);
  const list = db.contacts.filter(c => c.type === tab);
  const save = async (c) => { if (await actions.saveContact(c)) { setEdit(null); toast("Saved"); } };
  const del = async (id) => { if (!confirm("Delete this contact?")) return; if (await actions.deleteContact(id)) toast("Deleted"); };
  const startNew = () => setEdit({ id: uid(), type: tab, name: "", contact: "", email: "", phone: "", address: "" });
  return <div>
    <div className="toolbar">
      <div className="pill-tabs">
        <button className={tab === "customer" ? "on" : ""} onClick={() => setTab("customer")}>Customers</button>
        <button className={tab === "vendor" ? "on" : ""} onClick={() => setTab("vendor")}>Vendors</button>
      </div>
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={startNew}><Ico d={ICONS.plus} size={15} />New {tab === "customer" ? "Customer" : "Vendor"}</button>
    </div>
    <div className="card">
      {list.length === 0
        ? <Empty icon={ICONS.contacts} title={"No " + tab + "s yet"} msg={"Add " + (tab === "customer" ? "the companies you quote and invoice." : "vendors and subs you buy from.")}
          action={<button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New {tab === "customer" ? "Customer" : "Vendor"}</button>} />
        : <table><thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th></th></tr></thead>
          <tbody>{list.map(c => (
            <tr key={c.id}>
              <td style={{ fontWeight: 600 }}>{c.name}</td><td className="subtle">{c.contact || "—"}</td>
              <td className="subtle">{c.email || "—"}</td><td className="mono subtle">{c.phone || "—"}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn ghost icon" onClick={() => setEdit({ ...c })} title="Edit"><Ico d={ICONS.edit} size={15} /></button>
                <button className="btn ghost icon" onClick={() => del(c.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>
              </td>
            </tr>
          ))}</tbody></table>}
    </div>
    {edit && <Modal title={edit.name ? "Edit " + (edit.type) : "New " + (edit.type)} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => save(edit)}>Save</button></>}>
      <div className="row">
        <Field label="Company / Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Contact Person"><input className="input" value={edit.contact} onChange={e => setEdit({ ...edit, contact: e.target.value })} /></Field>
      </div>
      <div className="row">
        <Field label="Email"><input className="input" value={edit.email} onChange={e => setEdit({ ...edit, email: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></Field>
      </div>
      <Field label="Address"><textarea className="input" value={edit.address} onChange={e => setEdit({ ...edit, address: e.target.value })} /></Field>
    </Modal>}
  </div>;
}
