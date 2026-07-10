import { useState } from "react";
import { uid, money, fmtDate, todayISO, sum, EXPENSE_CATS } from "../lib/helpers.js";
import { Ico, ICONS, Empty, Modal, Field } from "../components/ui.jsx";

export default function ExpensesView({ db, actions, toast }) {
  const [edit, setEdit] = useState(null);
  const vendors = db.contacts.filter(c => c.type === "vendor");
  const save = async (x) => { if (await actions.saveExpense(x)) { setEdit(null); toast("Expense saved"); } };
  const del = async (id) => { if (!confirm("Delete this expense?")) return; if (await actions.deleteExpense(id)) toast("Deleted"); };
  const startNew = () => setEdit({ id: uid(), _new: true, date: todayISO(), category: "Materials", vendor: "", amount: 0, method: "Credit Card", notes: "" });
  const byCat = {};
  db.expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = sum(db.expenses, e => Number(e.amount) || 0);
  return <div>
    {cats.length > 0 && <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>By Category</h3><span className="mono" style={{ marginLeft: "auto", fontWeight: 600 }}>{money(total)} total</span></div>
      <div className="card-body"><div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {cats.map(([c, v]) => <div key={c} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", minWidth: 140 }}>
          <div className="subtle" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{c}</div>
          <div className="mono" style={{ fontWeight: 600, fontSize: 16, marginTop: 3 }}>{money(v)}</div></div>)}
      </div></div>
    </div>}
    <div className="toolbar"><button className="btn primary" style={{ marginLeft: "auto" }} onClick={startNew}><Ico d={ICONS.plus} size={15} />New Expense</button></div>
    <div className="card">
      {db.expenses.length === 0
        ? <Empty icon={ICONS.exp} title="No expenses" msg="Log business spend by category — materials, subs, tools, travel. Totals roll up above and into the dashboard."
          action={<button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Expense</button>} />
        : <table><thead><tr><th>Date</th><th>Category</th><th>Vendor / Payee</th><th>Method</th><th>Notes</th><th className="num">Amount</th><th></th></tr></thead>
          <tbody>{db.expenses.slice().sort((a, b) => b.date.localeCompare(a.date)).map(e => (
            <tr key={e.id}>
              <td className="subtle">{fmtDate(e.date)}</td><td>{e.category}</td><td>{e.vendor || "—"}</td>
              <td className="subtle">{e.method}</td><td className="subtle" style={{ maxWidth: 220 }}>{e.notes || "—"}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(Number(e.amount) || 0)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn ghost icon" onClick={() => setEdit({ ...e })} title="Edit"><Ico d={ICONS.edit} size={15} /></button>
                <button className="btn ghost icon" onClick={() => del(e.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>
              </td>
            </tr>
          ))}</tbody></table>}
    </div>
    {edit && <Modal title={edit._new ? "New Expense" : "Edit Expense"} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => save(edit)}>Save Expense</button></>}>
      <div className="row">
        <Field label="Date"><input className="input" type="date" value={edit.date} onChange={e => setEdit({ ...edit, date: e.target.value })} /></Field>
        <Field label="Category"><select className="select" value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })}>
          {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Amount"><input className="input mono" type="number" step="any" value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value })} /></Field>
      </div>
      <div className="row">
        <Field label="Vendor / Payee"><input className="input" list="vend-list" value={edit.vendor} onChange={e => setEdit({ ...edit, vendor: e.target.value })} />
          <datalist id="vend-list">{vendors.map(v => <option key={v.id} value={v.name} />)}</datalist></Field>
        <Field label="Method"><select className="select" value={edit.method} onChange={e => setEdit({ ...edit, method: e.target.value })}>
          {["Credit Card", "Check", "ACH / Wire", "Cash", "Other"].map(m => <option key={m}>{m}</option>)}</select></Field>
      </div>
      <Field label="Notes"><textarea className="input" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field>
    </Modal>}
  </div>;
}
