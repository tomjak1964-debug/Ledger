import { useState, useMemo } from "react";
import { money, fmtDate, todayISO } from "../lib/helpers.js";
import { lineTotals, balance, paid, round2, billBalance } from "../calc/ledger.js";
import { checkNumberTaken, normRef } from "../lib/checks.js";
import { Modal, Field, Badge } from "./ui.jsx";

const METHODS = ["Check", "ACH / Wire", "Credit Card", "Cash", "Other"];

// One receipt or one vendor payment, as the single thing it really is: money
// that moved on one date, on one check or transfer, spread across the documents
// it settled. Pick the party, see every open item, tick the ones this
// check covers, and apply an amount per line. Nothing is ticked for you — a
// payment covers what was actually paid for, so you say which items those are
// (Select all is one click away when the check clears everything).
//
// Pass `group` (a row from receiptGroups) to edit an existing receipt or
// payment instead of creating one: the items already on it come in ticked,
// everything else still open for that party is listed so it can be added, and
// unticking a line takes it back off.
export default function PaymentGroupModal({ db, kind = "invoice", preselectPartyId, group, onClose, onSave }) {
  const isBill = kind === "bill";
  const editing = !!group;
  const L = isBill
    ? { party: "Vendor", partyType: "vendor", doc: "Bill", create: "Record Payment", edit: "Edit Payment", one: "payment", refLabel: "Check #", total: "Amount paid" }
    : { party: "Customer", partyType: "customer", doc: "Invoice", create: "Receive Payment", edit: "Edit Receipt", one: "receipt", refLabel: "Check # / Ref", total: "Amount received" };
  const parties = db.contacts.filter(c => c.type === L.partyType);
  const [partyId, setPartyId] = useState(group?.partyId || preselectPartyId || "");
  const [date, setDate] = useState(group?.date || todayISO());
  const [method, setMethod] = useState(group?.method || "Check");
  const [ref, setRef] = useState(group?.ref || "");
  const [saving, setSaving] = useState(false);
  // Explicit per-document overrides: { [id]: { checked, amount } }. Anything not
  // in here uses the default below.
  const [alloc, setAlloc] = useState({});

  // What this receipt / payment already covers, per document. A group holds one
  // line per payment ROW, and a document can carry several of them on the same
  // check — two part-payments entered separately, say. This screen is
  // document-first, so those fold into one row here: the amounts add up and
  // every payment id comes along, so none is left behind on save.
  const onGroup = useMemo(() => {
    const m = {};
    (group?.lines || []).forEach(l => {
      const at = m[l.docId] || (m[l.docId] = { paymentIds: [], amount: 0, discount: 0 });
      at.paymentIds.push(l.paymentId);
      at.amount = round2(at.amount + (Number(l.amount) || 0));
      at.discount = round2((at.discount || 0) + (Number(l.discount) || 0));
    });
    return m;
  }, [group]);

  const docBalance = (d) => isBill ? billBalance(d) : balance(d);
  // Normalised the same way the register groups them, so a document with no
  // party on it still lines up with its group instead of vanishing from here.
  const ownerOf = (d) => (isBill ? d.vendorId : d.customerId) || "";
  // A document already on this payment would be open again for its share if the
  // line came off, so that — not the current balance — is what's available here.
  const openBal = (d) => round2(docBalance(d) + (onGroup[d.id]?.amount || 0) + (onGroup[d.id]?.discount || 0));

  const items = useMemo(() => (isBill ? db.bills : db.invoices)
    .filter(d => ownerOf(d) === partyId && (Math.abs(docBalance(d)) > 0.005 || onGroup[d.id]))
    .sort((a, b) => (a.date || "").localeCompare(b.date || "")), [db.bills, db.invoices, partyId, onGroup]);

  const dflt = (d) => onGroup[d.id]
    ? { checked: true, amount: onGroup[d.id].amount, discount: onGroup[d.id].discount || 0 }
    : { checked: false, amount: openBal(d), discount: 0 };
  const eff = (d) => alloc[d.id] || dflt(d);
  const net = round2(items.reduce((s, d) => { const a = eff(d); return s + (a.checked ? (Number(a.amount) || 0) : 0); }, 0));
  const selectedCount = items.filter(d => eff(d).checked && Math.abs(Number(eff(d).amount) || 0) > 0.005).length;
  const allOn = items.length > 0 && items.every(d => eff(d).checked);

  // A check number belongs to one check. Its own rows never collide with it.
  const ownIds = (group?.lines || []).map(l => l.paymentId);
  const refErr = isBill && method === "Check"
    ? !normRef(ref) ? "A check payment needs a check number."
      : checkNumberTaken(db, ref, ownIds) ? `Check #${normRef(ref)} is already used by another check.` : ""
    : "";

  const pickParty = (id) => { setPartyId(id); setAlloc({}); };
  const setLine = (d, patch) => setAlloc(prev => ({ ...prev, [d.id]: { ...eff(d), ...patch } }));
  const setAll = (checked) => setAlloc(Object.fromEntries(items.map(d => [d.id, { ...eff(d), checked }])));

  const submit = async () => {
    const allocations = items.filter(d => eff(d).checked)
      // Folded rows keep their first payment id and drop the rest: the store
      // deletes any prior id not kept, so the merged amount lands on one row.
      .map(d => ({ docId: d.id, amount: eff(d).amount, discount: eff(d).discount || 0, paymentId: onGroup[d.id]?.paymentIds[0] }));
    setSaving(true);
    const ok = await onSave(allocations, { date, method, ref });
    setSaving(false);
    if (ok) onClose();
  };

  return <Modal title={editing ? L.edit + (group.ref ? " · #" + group.ref : "") : L.create} onClose={onClose} wide
    foot={<>
      <div className="subtle" style={{ marginRight: "auto", alignSelf: "center" }}>
        {selectedCount ? `${selectedCount} item${selectedCount > 1 ? "s" : ""} selected` : `Select the items this ${L.one} covers`}
      </div>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={saving || net === 0 || !selectedCount || !!refErr} onClick={submit}>
        {saving ? "Saving…" : (editing ? "Save " : "Record ") + money(net)}
      </button>
    </>}>
    <div className="row">
      <Field label={L.party}><select className="select" value={partyId} disabled={editing} onChange={e => pickParty(e.target.value)}>
        <option value="">Select {L.party.toLowerCase()}…</option>{parties.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></Field>
      <Field label="Date"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Method"><select className="select" value={method} onChange={e => setMethod(e.target.value)}>
        {METHODS.map(m => <option key={m}>{m}</option>)}
      </select></Field>
      <Field label={L.refLabel}><input className="input mono" value={ref} onChange={e => setRef(e.target.value)}
        style={refErr ? { borderColor: "var(--neg)" } : undefined} /></Field>
    </div>
    {refErr && <p className="subtle" style={{ margin: "0 0 8px", color: "var(--neg)" }}>{refErr}</p>}

    <div className="divider"></div>

    {!partyId && !editing
      ? <p className="subtle" style={{ margin: "8px 0" }}>Choose a {L.party.toLowerCase()} to see their open {L.doc.toLowerCase()}s.</p>
      : items.length === 0
        ? <p className="subtle" style={{ margin: "8px 0" }}>Nothing open for this {L.party.toLowerCase()} — every {L.doc.toLowerCase()} is settled.</p>
        : <>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <span className="subtle">{editing ? `Tick what this ${L.one} covers — unticking takes an item back off it.` : `Tick the items this ${L.one} covers.`}</span>
            <button className="btn sm" style={{ marginLeft: "auto" }} disabled={allOn} onClick={() => setAll(true)}>Select all</button>
            <button className="btn sm" disabled={!items.some(d => eff(d).checked)} onClick={() => setAll(false)}>Deselect all</button>
          </div>
          <table><thead><tr>
            <th style={{ width: 34 }}></th><th>{L.doc}</th><th>Date</th><th>Due</th><th></th>
            <th className="num">Balance</th><th className="num" style={{ width: 120 }}>Discount</th><th className="num" style={{ width: 150 }}>Applied</th>
          </tr></thead>
            <tbody>{items.map(d => {
              const a = eff(d); const bal = openBal(d);
              const isCredit = !isBill && lineTotals(d.lineItems, d.taxRate).total < 0;
              return <tr key={d.id} style={a.checked ? {} : { opacity: 0.5 }}>
                <td><input type="checkbox" checked={a.checked} onChange={e => setLine(d, { checked: e.target.checked })} /></td>
                <td className="doc-id">{isBill ? (d.ref || d.number) : d.number}</td>
                <td className="subtle">{fmtDate(d.date)}</td>
                <td className="subtle">{fmtDate(d.dueDate)}</td>
                <td>{isCredit ? <Badge status="credit" />
                  : onGroup[d.id] ? <span className="subtle" style={{ fontSize: 12 }}>
                    on this {L.one}{onGroup[d.id].paymentIds.length > 1 ? ` · ${onGroup[d.id].paymentIds.length} lines combined` : ""}</span>
                    : null}</td>
                <td className="num" style={{ fontWeight: 600, color: bal < 0 ? "var(--accent)" : undefined }}>{money(bal)}</td>
                <td className="num"><input className="input mono" type="number" step="any" style={{ textAlign: "right" }}
                  title="Discount taken — settles the document without cash"
                  value={a.discount || 0} disabled={!a.checked} onChange={e => setLine(d, { discount: e.target.value })} /></td>
                <td className="num"><input className="input mono" type="number" step="any" style={{ textAlign: "right" }}
                  value={a.amount} disabled={!a.checked} onChange={e => setLine(d, { amount: e.target.value })} /></td>
              </tr>;
            })}</tbody></table>
        </>}

    <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--canvas)", borderRadius: 9, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="subtle">{L.total}</span>
      <span className="mono" style={{ fontWeight: 700, fontSize: 18, color: net < 0 ? "var(--accent)" : undefined }}>{money(net)}</span>
    </div>
    {net < 0 && <p className="subtle" style={{ margin: "8px 0 0", color: "var(--accent)" }}>This receipt nets negative — the selected credits exceed the invoices. Add the invoices being paid, or record it to carry the credit.</p>}
    {editing && isBill && <p className="subtle" style={{ margin: "8px 0 0" }}>
      Reprint the check or remittance from the bill's payment history if what this {L.one} covers has changed.
    </p>}
  </Modal>;
}
