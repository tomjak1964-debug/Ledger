import { useState } from "react";
import { uid, money, fmtDate, todayISO, addDays, nameOf, sum } from "../lib/helpers.js";
import { paid, billStatus, agingBuckets, round2 } from "../calc/ledger.js";
import { checksPdf } from "../lib/checkPrint.js";
import { remittancesPdf } from "../lib/remittance.js";
import { Ico, ICONS, Badge, Empty, Modal, Field } from "../components/ui.jsx";
import PaymentModal from "../components/PaymentModal.jsx";
import { openCheckPdf } from "../lib/checkPrint.js";
import { remittancePdf, openRemittancePdf } from "../lib/remittance.js";
import EmailModal from "../components/EmailModal.jsx";

export default function PayablesView({ db, actions, toast }) {
  const [emailRemit, setEmailRemit] = useState(null); // {bill, payment}
  const [payRun, setPayRun] = useState(false);
  const remitArgs = (bill, p) => ({
    payment: p, vendor: db.contacts.find(c => c.id === bill.vendorId),
    lines: [{ ref: bill.ref || bill.number, date: bill.date, desc: bill.notes, amount: p.amount }],
    settings: db.settings,
  });
  // Check payments print a check; electronic payments get a remittance advice
  const printDocFor = (bill, p) => p.method === "Check" ? printCheckFor(bill, p) : openRemittancePdf(remitArgs(bill, p));
  const printCheckFor = (bill, p) => openCheckPdf({
    payment: p,
    vendor: db.contacts.find(c => c.id === bill.vendorId),
    memo: bill.ref ? "Inv " + bill.ref : bill.number,
    stubLines: [{ ref: bill.ref || bill.number, date: bill.date, desc: bill.notes, amount: p.amount }],
    settings: db.settings,
  });
  const [edit, setEdit] = useState(null);
  const [pay, setPay] = useState(null);
  const vendors = db.contacts.filter(c => c.type === "vendor");
  const open = db.bills.filter(b => ((Number(b.amount) || 0) - paid(b)) > 0.005);
  const bk = agingBuckets(open, b => b.dueDate, b => (Number(b.amount) || 0) - paid(b));
  const totalOpen = bk.cur + bk.d30 + bk.d60 + bk.d90 + bk.d90p;

  const save = async (bill) => { if (await actions.saveBill(bill)) { setEdit(null); toast("Bill saved"); } };
  const del = async (id) => { if (!confirm("Delete this bill?")) return; if (await actions.deleteBill(id)) toast("Deleted"); };
  const startNew = () => {
    const n = db.settings.billPrefix + "-" + String(db.settings.counters.bill).padStart(4, "0");
    setEdit({ id: uid(), number: n, _new: true, vendorId: vendors[0]?.id || "", date: todayISO(), dueDate: addDays(todayISO(), db.settings.terms), amount: 0, ref: "", notes: "", payments: [] });
  };

  return <div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>A/P Aging</h3><span className="mono" style={{ marginLeft: "auto", fontWeight: 600, fontSize: 16, color: "var(--neg)" }}>{money(totalOpen)}</span>
        <button className="btn sm" onClick={() => setPayRun(true)} disabled={open.length === 0}><Ico d={ICONS.money} size={14} />Pay Bills…</button>
        <button className="btn primary sm" onClick={startNew}><Ico d={ICONS.plus} size={14} />New Bill</button></div>
      <div className="card-body"><div className="aging">
        <div className="bucket"><div className="b-lbl">Current</div><div className="b-val">{money(bk.cur)}</div></div>
        <div className="bucket"><div className="b-lbl">1–30 days</div><div className="b-val">{money(bk.d30)}</div></div>
        <div className="bucket hot"><div className="b-lbl">31–60 days</div><div className="b-val">{money(bk.d60)}</div></div>
        <div className="bucket hot"><div className="b-lbl">61–90 days</div><div className="b-val">{money(bk.d90)}</div></div>
        <div className="bucket hot"><div className="b-lbl">90+ days</div><div className="b-val">{money(bk.d90p)}</div></div>
      </div></div>
    </div>
    <div className="card">
      <div className="card-head"><h3>Vendor Bills</h3></div>
      {db.bills.length === 0
        ? <Empty icon={ICONS.ap} title="No bills recorded" msg="Track money you owe vendors and subs. Add a bill with an amount and due date, then record payments against it."
          action={<button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Bill</button>} />
        : <table><thead><tr><th>Bill</th><th>Vendor</th><th>Ref</th><th>Date</th><th>Due</th><th>Status</th><th className="num">Amount</th><th className="num">Balance</th><th></th></tr></thead>
          <tbody>{db.bills.slice().reverse().map(b => {
            const bal = (Number(b.amount) || 0) - paid(b);
            return <tr key={b.id}>
              <td className="doc-id">{b.number}</td><td>{nameOf(db, b.vendorId)}</td><td className="mono subtle">{b.ref || "—"}</td>
              <td className="subtle">{fmtDate(b.date)}</td><td className="subtle">{fmtDate(b.dueDate)}</td>
              <td><Badge status={billStatus(b)} /></td>
              <td className="num">{money(Number(b.amount) || 0)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(bal)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {bal > 0.005 && <button className="btn sm" onClick={() => setPay(b)}><Ico d={ICONS.money} size={14} />Pay</button>}
                <button className="btn ghost icon" onClick={() => setEdit({ ...b })} title="Edit"><Ico d={ICONS.edit} size={15} /></button>
                <button className="btn ghost icon" onClick={() => del(b.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {edit && <Modal title={edit._new ? "New Vendor Bill" : "Edit " + edit.number} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => save(edit)}>Save Bill</button></>}>
      <div className="row">
        <Field label="Vendor"><select className="select" value={edit.vendorId} onChange={e => setEdit({ ...edit, vendorId: e.target.value })}>
          <option value="">Select vendor…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label="Vendor Ref / Inv #"><input className="input" value={edit.ref} onChange={e => setEdit({ ...edit, ref: e.target.value })} /></Field>
      </div>
      <div className="row">
        <Field label="Bill Date"><input className="input" type="date" value={edit.date} onChange={e => setEdit({ ...edit, date: e.target.value })} /></Field>
        <Field label="Due Date"><input className="input" type="date" value={edit.dueDate} onChange={e => setEdit({ ...edit, dueDate: e.target.value })} /></Field>
        <Field label="Amount"><input className="input mono" type="number" step="any" value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><textarea className="input" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field>
    </Modal>}
    {pay && <PaymentModal doc={pay} isBill onClose={() => setPay(null)}
      onSave={async (p) => {
        if (await actions.recordPayment("bill", pay.id, p)) {
          setPay(null); toast("Payment recorded");
          if (p.method === "Check") printCheckFor(pay, p);
          else { openRemittancePdf(remitArgs(pay, p)); setEmailRemit({ bill: pay, payment: p }); }
        }
      }}
      onPrintCheck={(p) => printDocFor(pay, p)}
      onDelete={async (pid) => {
        if (await actions.deletePayment("bill", pay.id, pid)) {
          setPay(prev => ({ ...prev, payments: (prev.payments || []).filter(x => x.id !== pid) }));
          toast("Payment deleted");
        }
      }} />}
    {payRun && <PayBillsModal db={db} actions={actions} toast={toast} onClose={() => setPayRun(false)} />}
    {emailRemit && <EmailModal
      title={"Email Remittance · " + (nameOf(db, emailRemit.bill.vendorId))}
      defaultTo={db.contacts.find(c => c.id === emailRemit.bill.vendorId)?.email || ""}
      defaultSubject={`Payment remittance — ${db.settings.company}`}
      defaultBody={`Please find attached remittance advice for our electronic payment of ${money(emailRemit.payment.amount)} dated ${emailRemit.payment.date}.\n\n${db.settings.company}`}
      buildAttachment={() => Promise.resolve(remittancePdf(remitArgs(emailRemit.bill, emailRemit.payment)))}
      onClose={() => setEmailRemit(null)} toast={toast} />}
  </div>;
}

// Batch payment run: select bills, per-item Check vs Electronic, record all,
// then print checks (one per vendor, stubs list every bill) and remittances.
function PayBillsModal({ db, actions, toast, onClose }) {
  const openBills = db.bills.filter(b => ((Number(b.amount) || 0) - paid(b)) > 0.005);
  const [date, setDate] = useState(todayISO());
  const [startChk, setStartChk] = useState("");
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState(null); // after recording: {checkRuns, remitRuns}
  const [rows, setRows] = useState(() => openBills.map(b => ({
    bill: b, sel: false, amount: round2((Number(b.amount) || 0) - paid(b)), method: "Check",
  })));
  const upd = (i, patch) => setRows(rs => rs.map((r, x) => x === i ? { ...r, ...patch } : r));
  const sel = rows.filter(r => r.sel && Number(r.amount) > 0);
  const total = sum(sel, r => Number(r.amount) || 0);

  const record = async () => {
    setBusy(true);
    // one payment document per vendor+method; checks numbered from Starting Check #
    const groups = [];
    const map = new Map();
    sel.forEach(r => {
      const k = r.bill.vendorId + "|" + r.method;
      if (!map.has(k)) { map.set(k, { vendorId: r.bill.vendorId, method: r.method, rows: [] }); groups.push(map.get(k)); }
      map.get(k).rows.push(r);
    });
    let chk = parseInt(startChk, 10);
    groups.forEach(g => { g.ref = g.method === "Check" && !isNaN(chk) ? String(chk++) : ""; });
    for (const g of groups) for (const r of g.rows) {
      const ok = await actions.recordPayment("bill", r.bill.id, {
        id: uid(), amount: Number(r.amount) || 0, date, method: g.method, ref: g.ref,
      });
      if (!ok) { setBusy(false); return; }
    }
    toast(`${sel.length} payment${sel.length > 1 ? "s" : ""} recorded — ${money(total)}`);
    const vend = id => db.contacts.find(c => c.id === id);
    const lines = g => g.rows.map(r => ({ ref: r.bill.ref || r.bill.number, date: r.bill.date, desc: r.bill.notes, amount: Number(r.amount) || 0 }));
    setDocs({
      checkRuns: groups.filter(g => g.method === "Check").map(g => ({
        payment: { amount: sum(g.rows, r => Number(r.amount) || 0), date, ref: g.ref },
        vendor: vend(g.vendorId), memo: g.rows.map(r => r.bill.ref || r.bill.number).join(", ").slice(0, 60),
        stubLines: lines(g),
      })),
      remitRuns: groups.filter(g => g.method !== "Check").map(g => ({
        payment: { amount: sum(g.rows, r => Number(r.amount) || 0), date, ref: g.ref, method: g.method },
        vendor: vend(g.vendorId), lines: lines(g), settings: db.settings,
      })),
    });
    setBusy(false);
  };

  if (docs) return <Modal title="Payments Recorded" onClose={onClose}
    foot={<button className="btn primary" onClick={onClose}>Done</button>}>
    <p className="subtle" style={{ marginTop: 0 }}>Print on the right paper: checks on your check stock, remittances on plain paper (email them from each bill's payment history if preferred).</p>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {docs.checkRuns.length > 0 && <button className="btn primary" onClick={() => window.open(URL.createObjectURL(checksPdf(docs.checkRuns, db.settings)), "_blank")}>
        <Ico d={ICONS.print} size={15} />Print {docs.checkRuns.length} Check{docs.checkRuns.length > 1 ? "s" : ""}</button>}
      {docs.remitRuns.length > 0 && <button className="btn" onClick={() => window.open(URL.createObjectURL(remittancesPdf(docs.remitRuns)), "_blank")}>
        <Ico d={ICONS.print} size={15} />Print {docs.remitRuns.length} Remittance{docs.remitRuns.length > 1 ? "s" : ""}</button>}
    </div>
  </Modal>;

  return <Modal wide title="Pay Bills" onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || sel.length === 0} onClick={record}>
        {busy ? "Recording…" : `Record ${sel.length} Payment${sel.length === 1 ? "" : "s"} · ${money(total)}`}</button></>}>
    <div className="row">
      <Field label="Payment Date"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Starting Check #" hint="Checks are numbered from here, one per vendor"><input className="input mono" value={startChk} onChange={e => setStartChk(e.target.value)} placeholder="1001" /></Field>
    </div>
    <table><thead><tr><th></th><th>Vendor</th><th>Bill / Ref</th><th>Due</th><th className="num">Balance</th><th className="num">Pay Amount</th><th>Method</th></tr></thead>
      <tbody>{rows.map((r, i) => {
        const bal = round2((Number(r.bill.amount) || 0) - paid(r.bill));
        return <tr key={r.bill.id}>
          <td><input type="checkbox" checked={r.sel} onChange={e => upd(i, { sel: e.target.checked })} /></td>
          <td style={{ fontWeight: 600 }}>{nameOf(db, r.bill.vendorId)}</td>
          <td className="mono subtle">{r.bill.ref || r.bill.number}</td>
          <td className="subtle">{fmtDate(r.bill.dueDate)}</td>
          <td className="num">{money(bal)}</td>
          <td className="num"><input className="input mono" style={{ maxWidth: 110, textAlign: "right" }} type="number" step="any" value={r.amount}
            onChange={e => upd(i, { amount: e.target.value, sel: true })} /></td>
          <td><select className="select" style={{ minWidth: 110 }} value={r.method} onChange={e => upd(i, { method: e.target.value, sel: true })}>
            {["Check", "ACH / Wire", "Credit Card", "Other"].map(m => <option key={m}>{m}</option>)}
          </select></td>
        </tr>;
      })}</tbody></table>
    <p className="subtle" style={{ marginBottom: 0 }}>Multiple bills for the same vendor and method combine into one check or one remittance, with every bill listed on the stub.</p>
  </Modal>;
}
