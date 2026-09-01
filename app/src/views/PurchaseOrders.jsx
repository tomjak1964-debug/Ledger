import { useState } from "react";
import { uid, money, fmtDate, todayISO, nameOf } from "../lib/helpers.js";
import { lineTotals } from "../calc/ledger.js";
import { useFilters } from "../components/useFilters.jsx";
import { Ico, ICONS, Badge, Empty, Field, SortTh, useTableSort } from "../components/ui.jsx";
import LineItemsEditor from "../components/LineItemsEditor.jsx";

export default function PurchaseOrdersView({ db, actions, toast, openDoc, readOnly }) {
  const [edit, setEdit] = useState(null);
  const vendors = db.contacts.filter(c => c.type === "vendor");
  const openSOs = db.salesOrders.filter(s => s.status === "open");

  const save = async (po) => { const saved = await actions.savePurchaseOrder(po); if (saved) { setEdit(null); toast(po._new ? "PO " + saved.number + " created" : "PO saved"); } };
  const del = async (id) => {
    if (!confirm("Delete this purchase order?")) return;
    const rec = db.purchaseOrders.find(p => p.id === id);
    if (await actions.deletePurchaseOrder(id)) toast("Deleted " + (rec?.number || "PO"), { actionLabel: "Undo", onAction: async () => { if (await actions.restoreRecord("purchase_order", rec)) toast(rec.number + " restored"); } });
  };
  const createBill = async (po) => { const b = await actions.createBillFromPO(po); if (b) toast("Bill " + b.number + " created from " + po.number); };
  const blankPO = (from) => ({
    id: uid(), _new: true, number: "(assigned at save)", vendorId: from?.vendorId || vendors[0]?.id || "",
    date: todayISO(), expectedDate: "", status: "open", taxRate: from ? from.taxRate : 0, notes: from?.notes || "",
    salesOrderId: from?.salesOrderId || "",
    lineItems: from ? (from.lineItems || []).map(li => ({ id: uid(), desc: li.desc, qty: li.qty, unit: li.unit, unitPrice: li.unitPrice }))
      : [{ id: uid(), desc: "", qty: 1, unit: "", unitPrice: 0 }],
  });

  const f = useFilters({ partyKind: "vendor", contacts: db.contacts });
  const { sorted: poRows, sort, onSort } = useTableSort(db.purchaseOrders.filter(p => f.keep(p.date, p.vendorId)).reverse(), {
    number: p => p.number, vendor: p => nameOf(db, p.vendorId), job: p => db.salesOrders.find(s => s.id === p.salesOrderId)?.number || "",
    date: p => p.date, status: p => p.status, total: p => lineTotals(p.lineItems, p.taxRate).total,
  });

  if (edit) return <POEditor po={edit} vendors={vendors} openSOs={openSOs} db={db} catalog={db.catalog} onCancel={() => setEdit(null)} onSave={save} />;

  return <div>
    {!readOnly && <div className="toolbar">
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setEdit(blankPO())}><Ico d={ICONS.plus} size={15} />New Purchase Order</button>
    </div>}
    {f.bar()}
    <div className="card">
      {db.purchaseOrders.length === 0
        ? <Empty icon={ICONS.ap} title="No purchase orders" msg="Issue POs to your vendors for parts and materials. Tie a PO to a job to feed job costing, then turn it into a bill when the invoice arrives."
          action={!readOnly && <button className="btn primary" onClick={() => setEdit(blankPO())}><Ico d={ICONS.plus} size={15} />New Purchase Order</button>} />
        : <table><thead><tr>
          <SortTh label="PO" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Vendor" col="vendor" sort={sort} onSort={onSort} />
          <SortTh label="Job" col="job" sort={sort} onSort={onSort} />
          <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
          <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
          <SortTh label="Total" col="total" sort={sort} onSort={onSort} num /><th></th></tr></thead>
          <tbody>{poRows.map(po => {
            const billed = db.bills.some(b => b.purchaseOrderId === po.id);
            const job = po.salesOrderId && db.salesOrders.find(s => s.id === po.salesOrderId);
            return <tr key={po.id}>
              <td className="doc-id">{po.number}</td>
              <td>{nameOf(db, po.vendorId)}</td>
              <td className="mono subtle">{job ? job.number : "—"}</td>
              <td className="subtle">{fmtDate(po.date)}</td>
              <td><Badge status={po.status} />{billed && <span className="subtle" style={{ marginLeft: 6, fontSize: 12 }}>billed</span>}</td>
              <td className="num">{money(lineTotals(po.lineItems, po.taxRate).total)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && !billed && po.status !== "cancelled" && <button className="btn sm" title="Create a vendor bill from this PO" onClick={() => createBill(po)}><Ico d={ICONS.ap} size={14} />Create Bill</button>}
                <button className="btn ghost icon" title="Print / Send" onClick={() => openDoc("po", po)}><Ico d={ICONS.print} size={16} /></button>
                {!readOnly && <button className="btn ghost icon" title="Edit" onClick={() => setEdit({ ...po, lineItems: (po.lineItems || []).map(li => ({ ...li })) })}><Ico d={ICONS.edit} size={15} /></button>}
                {!readOnly && <button className="btn ghost icon" title="Copy" onClick={() => setEdit(blankPO(po))}><Ico d={ICONS.copy} size={15} /></button>}
                {!readOnly && <button className="btn ghost icon" title="Delete" onClick={() => del(po.id)}><Ico d={ICONS.trash} size={15} /></button>}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
  </div>;
}

function POEditor({ po, vendors, openSOs, db, catalog, onCancel, onSave }) {
  const [o, setO] = useState(po);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setO(p => ({ ...p, [k]: v }));
  const save = async () => { setSaving(true); await onSave(o); setSaving(false); };
  return <div>
    <div className="toolbar">
      <button className="btn ghost" onClick={onCancel}><Ico d={ICONS.back} size={16} />Back</button>
      <h2 style={{ fontSize: 18, marginLeft: 4 }}>{o._new ? "New Purchase Order" : "Edit " + o.number} <span className="mono subtle" style={{ fontSize: 14 }}>{o.number}</span></h2>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save PO"}</button>
      </div>
    </div>
    <div className="card"><div className="card-body">
      <div className="row">
        <Field label="Vendor"><select className="select" value={o.vendorId} onChange={e => set("vendorId", e.target.value)}>
          <option value="">Select vendor…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select></Field>
        <Field label="PO Date"><input className="input" type="date" value={o.date} onChange={e => set("date", e.target.value)} /></Field>
        <Field label="Expected"><input className="input" type="date" value={o.expectedDate || ""} onChange={e => set("expectedDate", e.target.value)} /></Field>
        <Field label="Status"><select className="select" value={o.status} onChange={e => set("status", e.target.value)}>
          {["open", "received", "closed", "cancelled"].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select></Field>
      </div>
      <Field label="Job (optional)" hint="Tie parts to a sales order for job costing">
        <select className="select" value={o.salesOrderId || ""} onChange={e => set("salesOrderId", e.target.value)}>
          <option value="">— none —</option>
          {openSOs.map(s => <option key={s.id} value={s.id}>{s.number} — {nameOf(db, s.customerId)}</option>)}
          {o.salesOrderId && !openSOs.some(s => s.id === o.salesOrderId) && <option value={o.salesOrderId}>{db.salesOrders.find(s => s.id === o.salesOrderId)?.number || "(job)"}</option>}
        </select></Field>
      <div className="divider"></div>
      <LineItemsEditor items={o.lineItems} setItems={v => set("lineItems", v)} taxRate={o.taxRate} setTaxRate={v => set("taxRate", v)} catalog={catalog} />
      <div className="divider"></div>
      <Field label="Notes (printed on PO)"><textarea className="input" value={o.notes || ""} onChange={e => set("notes", e.target.value)} /></Field>
    </div></div>
  </div>;
}
