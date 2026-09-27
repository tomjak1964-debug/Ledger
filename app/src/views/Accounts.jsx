import { useState } from "react";
import { uid } from "../lib/helpers.js";
import { ACCOUNT_TYPES, DEFAULT_ACCOUNTS } from "../calc/accounts.js";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort } from "../components/ui.jsx";

// System → Chart of Accounts. The list every account picker in the app reads
// from and the general ledger reports against. Documents remember an account
// by NUMBER, so renumbering here does not re-post anything already on file.
export default function AccountsView({ db, actions, toast, readOnly }) {
  const [edit, setEdit] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const save = async (a) => { if (await actions.saveAccount(a)) { setEdit(null); toast("Account saved"); } };
  const del = async (a) => {
    if (!confirm(`Delete account ${a.number} ${a.name}? Documents booked to it keep the number; it will read "(not in chart)" on reports.`)) return;
    if (await actions.deleteAccount(a.id)) toast("Deleted");
  };
  const load = async () => {
    const added = await actions.seedAccounts(DEFAULT_ACCOUNTS);
    if (added) toast(added.length ? `${added.length} account${added.length === 1 ? "" : "s"} added` : "Every account is already on file");
  };
  const list = (db.accounts || []).filter(a => showInactive || a.active !== false);
  const missing = DEFAULT_ACCOUNTS.filter(d => !(db.accounts || []).some(a => String(a.number) === d.number)).length;
  const { sorted: rows, sort, onSort } = useTableSort(list, {
    number: a => a.number, name: a => a.name || "", type: a => ACCOUNT_TYPES.indexOf(a.type), active: a => (a.active !== false ? 0 : 1),
  }, { key: "number", dir: "asc" });
  const startNew = () => setEdit({ id: uid(), _new: true, number: "", name: "", type: "Expenses", active: true, sort: (db.accounts || []).length });

  return <div>
    <div className="toolbar">
      <p className="subtle" style={{ margin: 0 }}>Every invoice, bill, expense and payment posts to one of these. Customers and vendors carry the account their documents default to.</p>
      <label className="subtle" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />Show inactive</label>
      {!readOnly && missing > 0 && (db.accounts || []).length > 0 && <button className="btn" onClick={load} title="Add the TMJ chart accounts not on file yet">Add {missing} missing TMJ account{missing === 1 ? "" : "s"}</button>}
      {!readOnly && <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Account</button>}
    </div>
    <div className="card">
      {(db.accounts || []).length === 0
        ? <Empty icon={ICONS.catalog} title="No chart of accounts yet" msg="Load the TMJ chart (from the Sage Chart of Accounts report) and adjust from there, or add accounts one at a time."
          action={!readOnly && <span style={{ display: "inline-flex", gap: 8 }}>
            <button className="btn primary" onClick={load}>Load TMJ Chart of Accounts</button>
            <button className="btn" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Account</button></span>} />
        : <table><thead><tr>
          <SortTh label="Account" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Description" col="name" sort={sort} onSort={onSort} />
          <SortTh label="Type" col="type" sort={sort} onSort={onSort} />
          <SortTh label="Active" col="active" sort={sort} onSort={onSort} />
          <th></th></tr></thead>
          <tbody>{rows.map(a => <tr key={a.id} style={a.active === false ? { opacity: .55 } : undefined}>
            <td className="mono" style={{ fontWeight: 600 }}>{a.number}</td>
            <td>{a.name}</td>
            <td className="subtle">{a.type}</td>
            <td className="subtle">{a.active === false ? "No" : "Yes"}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              {!readOnly && <button className="btn ghost icon" onClick={() => setEdit({ ...a })} title="Edit"><Ico d={ICONS.edit} size={15} /></button>}
              {!readOnly && <button className="btn ghost icon" onClick={() => del(a)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>}
            </td>
          </tr>)}</tbody></table>}
    </div>
    {edit && <Modal title={edit._new ? "New Account" : "Edit " + edit.number} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn primary" disabled={!String(edit.number).trim() || !edit.name.trim()} onClick={() => save(edit)}>Save Account</button></>}>
      <div className="row">
        <Field label="Account ID" hint="The number documents are booked to, e.g. 6700">
          <input className="input mono" style={{ maxWidth: 140 }} value={edit.number} onChange={e => setEdit({ ...edit, number: e.target.value })} /></Field>
        <Field label="Description"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Engineering Support Expense" /></Field>
      </div>
      <div className="row">
        <Field label="Account Type"><select className="select" value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value })}>
          {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Active" hint="An inactive account stays on old documents but is not offered on new ones">
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0" }}>
            <input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} />In use</label></Field>
      </div>
    </Modal>}
  </div>;
}
