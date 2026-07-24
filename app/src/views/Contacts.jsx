import { useState } from "react";
import { uid, cls } from "../lib/helpers.js";
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
      {db.contacts.some(c => c.id === edit.id)
        ? <PeopleEditor contactId={edit.id} db={db} actions={actions} toast={toast} />
        : <p className="subtle">Save this {edit.type} first, then re-open it to add contact people.</p>}
    </Modal>}
  </div>;
}

// Named people at a company — selectable on proposals and invoices.
function PeopleEditor({ contactId, db, actions, toast }) {
  const [p, setP] = useState(null);
  const people = db.contactPeople.filter(x => x.contactId === contactId);
  const save = async () => {
    if (!p.name.trim()) return;
    if (await actions.saveContactPerson(p)) { setP(null); toast("Person saved"); }
  };
  return <div>
    <div className="divider"></div>
    <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
      <span className="subtle" style={{ fontWeight: 700 }}>People</span>
      <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setP({ id: uid(), contactId, name: "", title: "", email: "", phone: "" })}><Ico d={ICONS.plus} size={13} />Add Person</button>
    </div>
    {people.length === 0 && !p && <p className="subtle" style={{ margin: "4px 0" }}>No people yet — add the person proposals and invoices should be addressed to (e.g. "Mr. John Murphy").</p>}
    {people.map(x => <div key={x.id} className="cat-row">
      <span style={{ fontWeight: 600 }}>{x.name}</span>
      <span className="subtle">{[x.title, x.email, x.phone].filter(Boolean).join(" · ")}</span>
      <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
        <button className="btn ghost icon" onClick={() => setP({ ...x })}><Ico d={ICONS.edit} size={14} /></button>
        <button className="btn ghost icon" onClick={async () => { if (confirm("Remove " + x.name + "?") && await actions.deleteContactPerson(x.id)) toast("Removed"); }}><Ico d={ICONS.trash} size={14} /></button>
      </span>
    </div>)}
    {p && <div style={{ background: "var(--canvas)", borderRadius: 9, padding: 12, marginTop: 8 }}>
      <div className="row">
        <Field label="Name"><input className="input" value={p.name} onChange={e => setP({ ...p, name: e.target.value })} placeholder="Mr. John Murphy" /></Field>
        <Field label="Title"><input className="input" value={p.title} onChange={e => setP({ ...p, title: e.target.value })} /></Field>
      </div>
      <div className="row">
        <Field label="Email"><input className="input" value={p.email} onChange={e => setP({ ...p, email: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={p.phone} onChange={e => setP({ ...p, phone: e.target.value })} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn sm" onClick={() => setP(null)}>Cancel</button>
        <button className="btn sm primary" onClick={save}>Save Person</button>
      </div>
    </div>}
  </div>;
}
