import { useState } from "react";
import { uid, money, fmtDate, todayISO, addDays, nameOf, sum, pickable } from "../lib/helpers.js";
import { paid, billStatus, agingBuckets, round2, billBalance, applyAgainst } from "../calc/ledger.js";
import { checksPdf } from "../lib/checkPrint.js";
import { remittancesPdf } from "../lib/remittance.js";
import { nextCheckNumber, checkNumberTaken, remitEmail } from "../lib/checks.js";
import { useFilters } from "../components/useFilters.jsx";
import { dueDateFor, termsLabelFor, discountOffer } from "../lib/terms.js";
import { Ico, ICONS, Badge, Empty, Modal, Field, SortTh, useTableSort } from "../components/ui.jsx";
import PaymentModal from "../components/PaymentModal.jsx";
import Attachments from "../components/Attachments.jsx";
import { openCheckPdf } from "../lib/checkPrint.js";
import { remittancePdf } from "../lib/remittance.js";
import RemittanceView from "../components/RemittanceView.jsx";
import EmailModal from "../components/EmailModal.jsx";
import AccountSelect from "../components/AccountSelect.jsx";
import JobCostPicker from "../components/JobCostPicker.jsx";
import { expenseAccountOfBill, accountLabel, accountSettings } from "../calc/accounts.js";

// The date a bill was settled — the last payment on it.
const paidDate = (b) => (b.payments || []).map(p => p.date).filter(Boolean).sort().pop() || "";

export default function PayablesView({ db, actions, toast, readOnly, go }) {
  const [emailRemit, setEmailRemit] = useState(null); // {bill, payment}
  const [viewRemit, setViewRemit] = useState(null);   // remittance args on screen
  const [payRun, setPayRun] = useState(false);
  const [showPaid, setShowPaid] = useState(false);
  const remitArgs = (bill, p) => ({
    payment: p, vendor: db.contacts.find(c => c.id === bill.vendorId),
    lines: [{ ref: bill.ref || bill.number, date: bill.date, desc: bill.notes, amount: p.amount }],
    settings: db.settings,
  });
  // Check payments print a check; electronic payments get a remittance advice
  const printDocFor = (bill, p) => p.method === "Check" ? printCheckFor(bill, p) : setViewRemit(remitArgs(bill, p));
  const printCheckFor = (bill, p) => openCheckPdf({
    payment: p,
    vendor: db.contacts.find(c => c.id === bill.vendorId),
    memo: bill.ref ? "Inv " + bill.ref : bill.number,
    stubLines: [{ ref: bill.ref || bill.number, date: bill.date, desc: bill.notes,
      invoiceAmount: Number(bill.amount) || 0, discount: Number(p.discount) || 0, amount: p.amount }],
    settings: db.settings,
  });
  const [edit, setEdit] = useState(null);
  const [pay, setPay] = useState(null);
  const vendors = db.contacts.filter(c => c.type === "vendor");
  const open = db.bills.filter(b => (billBalance(b)) > 0.005);
  const bk = agingBuckets(open, b => b.dueDate, b => billBalance(b));
  const totalOpen = bk.cur + bk.d30 + bk.d60 + bk.d90 + bk.d90p;
  const settled = db.bills.filter(b => billStatus(b) === "paid");
  const f = useFilters({ partyKind: "vendor", contacts: db.contacts });
  const listed = db.bills.filter(b => (showPaid || billStatus(b) !== "paid") && f.keep(b.date, b.vendorId));
  const { sorted: billRows, sort, onSort } = useTableSort(listed.slice().reverse(), {
    number: b => b.number, vendor: b => nameOf(db, b.vendorId), ref: b => b.ref || "", date: b => b.date, due: b => b.dueDate,
    status: b => billStatus(b), paid: b => paidDate(b), amount: b => Number(b.amount) || 0, balance: b => billBalance(b),
  });

  const save = async (bill) => { if (await actions.saveBill(bill)) { setEdit(null); toast("Bill saved"); } };
  const del = async (id) => {
    if (!confirm("Delete this bill?")) return;
    const rec = db.bills.find(b => b.id === id);
    if (await actions.deleteBill(id)) toast("Deleted " + (rec?.number || "bill"), { actionLabel: "Undo", onAction: async () => { if (await actions.restoreRecord("bill", rec)) toast(rec.number + " restored"); } });
  };
  const startNew = () => {
    const n = db.settings.billPrefix + "-" + String(db.settings.counters.bill).padStart(4, "0");
    const vendorId = pickable(vendors)[0]?.id || "";
    setEdit({ id: uid(), number: n, _new: true, vendorId, date: todayISO(), dueDate: dueDateFor(db, vendorId, todayISO()), amount: 0, ref: "", notes: "", salesOrderId: "", payments: [] });
  };

  return <div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>A/P Aging</h3><span className="mono" style={{ marginLeft: "auto", fontWeight: 600, fontSize: 16, color: "var(--neg)" }}>{money(totalOpen)}</span>
        {!readOnly && <button className="btn sm" onClick={() => setPayRun(true)} disabled={open.length === 0}><Ico d={ICONS.money} size={14} />Pay Bills…</button>}
        {!readOnly && <button className="btn primary sm" onClick={startNew}><Ico d={ICONS.plus} size={14} />New Bill</button>}</div>
      <div className="card-body"><div className="aging">
        <div className="bucket"><div className="b-lbl">Current</div><div className="b-val">{money(bk.cur)}</div></div>
        <div className="bucket"><div className="b-lbl">1–30 days</div><div className="b-val">{money(bk.d30)}</div></div>
        <div className="bucket hot"><div className="b-lbl">31–60 days</div><div className="b-val">{money(bk.d60)}</div></div>
        <div className="bucket hot"><div className="b-lbl">61–90 days</div><div className="b-val">{money(bk.d90)}</div></div>
        <div className="bucket hot"><div className="b-lbl">90+ days</div><div className="b-val">{money(bk.d90p)}</div></div>
      </div></div>
    </div>
    {f.bar()}
    <div className="card">
      <div className="card-head"><h3>Vendor Bills</h3>
        <label className="subtle" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 500 }}>
          <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} />
          Show paid bills{settled.length > 0 ? ` (${settled.length})` : ""}
        </label>
      </div>
      {db.bills.length === 0
        ? <Empty icon={ICONS.ap} title="No bills recorded" msg="Track money you owe vendors and subs. Add a bill with an amount and due date, then record payments against it."
          action={<button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Bill</button>} />
        : billRows.length === 0
          ? <Empty icon={ICONS.ap} title="Nothing outstanding" msg="Every bill is paid. Tick “Show paid bills” to see the settled ones." />
          : <table><thead><tr>
          <SortTh label="Bill" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Vendor" col="vendor" sort={sort} onSort={onSort} />
          <SortTh label="Ref" col="ref" sort={sort} onSort={onSort} />
          <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
          <SortTh label="Due" col="due" sort={sort} onSort={onSort} />
          <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
          <SortTh label="Paid" col="paid" sort={sort} onSort={onSort} />
          <SortTh label="Amount" col="amount" sort={sort} onSort={onSort} num />
          <SortTh label="Balance" col="balance" sort={sort} onSort={onSort} num /><th></th></tr></thead>
          <tbody>{billRows.map(b => {
            const bal = billBalance(b);
            const done = billStatus(b) === "paid";
            return <tr key={b.id}>
              <td className="doc-id">{b.number}</td><td>{nameOf(db, b.vendorId)}</td><td className="mono subtle">{b.ref || "—"}</td>
              <td className="subtle">{fmtDate(b.date)}</td><td className="subtle">{fmtDate(b.dueDate)}</td>
              <td><Badge status={billStatus(b)} /></td>
              <td className="subtle">{done && paidDate(b) ? fmtDate(paidDate(b)) : "—"}</td>
              <td className="num">{money(Number(b.amount) || 0)}</td>
              <td className="num" style={{ fontWeight: 600 }}>{money(bal)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && bal > 0.005 && <button className="btn sm" onClick={() => setPay(b)}><Ico d={ICONS.money} size={14} />Pay</button>}
                {(b.payments || []).length > 0 && <button className="btn ghost icon" title="Payments · print / email remittance" onClick={() => setPay(b)}><Ico d={ICONS.mail} size={15} /></button>}
                {!readOnly && <button className="btn ghost icon" onClick={() => setEdit({ ...b })} title="Edit"><Ico d={ICONS.edit} size={15} /></button>}
                {!readOnly && <button className="btn ghost icon" onClick={() => del(b.id)} title="Delete"><Ico d={ICONS.trash} size={15} /></button>}
              </td>
            </tr>;
          })}</tbody></table>}
    </div>
    {edit && (() => {
      const refTrim = (edit.ref || "").trim();
      const dup = db.bills.find(x => x.id !== edit.id && x.vendorId === edit.vendorId
        && (x.ref || "").trim().toLowerCase() === refTrim.toLowerCase());
      const err = !edit.vendorId ? "Select a vendor." : !refTrim ? "Vendor invoice # (Ref) is required." : dup ? `Already entered as ${dup.number} for this vendor.` : "";
      return <Modal title={edit._new ? "New Vendor Bill" : "Edit " + edit.number} onClose={() => setEdit(null)}
      foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn primary" disabled={!!err} onClick={() => save(edit)}>Save Bill</button></>}>
      <div className="row">
        <Field label="Vendor" hint={edit.vendorId ? termsLabelFor(db, edit.vendorId) : undefined}>
          <select className="select" value={edit.vendorId}
            onChange={e => setEdit({ ...edit, vendorId: e.target.value, dueDate: dueDateFor(db, e.target.value, edit.date) })}>
          <option value="">Select vendor…</option>{pickable(vendors, edit.vendorId).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label="Vendor Ref / Inv #" hint="Required — the vendor's invoice number">
          <input className="input" value={edit.ref} onChange={e => setEdit({ ...edit, ref: e.target.value })}
            style={(!refTrim || dup) ? { borderColor: "var(--neg)" } : undefined} /></Field>
      </div>
      {err && <p className="subtle" style={{ margin: "0 0 8px", color: "var(--neg)" }}>{err}</p>}
      <div className="row">
        <Field label="Bill Date"><input className="input" type="date" value={edit.date}
          onChange={e => setEdit({ ...edit, date: e.target.value, dueDate: dueDateFor(db, edit.vendorId, e.target.value) })} /></Field>
        <Field label="Due Date" hint={edit.vendorId ? "From " + termsLabelFor(db, edit.vendorId) : undefined}>
          <input className="input" type="date" value={edit.dueDate} onChange={e => setEdit({ ...edit, dueDate: e.target.value })} /></Field>
        <Field label="Amount"><input className="input mono" type="number" step="any" value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value })} /></Field>
      </div>
      <Field label="Expense Account" hint={edit.expenseAccount ? "Where this bill posts" : "Default: " + (accountLabel(db, expenseAccountOfBill(db, edit)) || "none set — see Settings → Accounts")}>
        <AccountSelect db={db} value={edit.expenseAccount} onChange={v => setEdit({ ...edit, expenseAccount: v })} groups={["expense", "cos", "liability", "asset"]} blank="— vendor's default —" /></Field>
      <JobCostPicker db={db} salesOrderId={edit.salesOrderId} costCategory={edit.costCategory}
        hint="Attribute this bill to a sales order for job costing" onChange={patch => setEdit({ ...edit, ...patch })} />
      <Field label="Notes"><textarea className="input" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field>
      {edit._new
        ? <p className="subtle" style={{ margin: "8px 0 0" }}>Save the bill first to attach receipts.</p>
        : <><div className="divider"></div><Attachments db={db} actions={actions} toast={toast} parentType="bill" parentId={edit.id} readOnly={readOnly} /></>}
    </Modal>;
    })()}
    {pay && <PaymentModal db={db} doc={pay} isBill onClose={() => setPay(null)}
      offerFor={d => discountOffer(db, pay, pay.vendorId, d)}
      nextCheckRef={nextCheckNumber(db, db.settings)}
      isRefTaken={(r) => checkNumberTaken(db, r)}
      onSave={async (p) => {
        if (!await actions.recordPayment("bill", pay.id, p)) return false;
        toast("Payment recorded");
        return true;
      }}
      onVoid={async (p) => {
        if (!await actions.deletePayments([p.id])) return false;
        toast(p.ref ? `Check #${p.ref} voided — ${pay.number} is open again` : "Payment voided");
        return true;
      }}
      onPrintCheck={(p) => printDocFor(pay, p)}
      onEmailDoc={(p) => setEmailRemit({ bill: pay, payment: p })}
      onDelete={async (pid) => {
        if (await actions.deletePayments([pid])) {
          setPay(prev => ({ ...prev, payments: (prev.payments || []).filter(x => x.id !== pid) }));
          toast("Payment deleted");
        }
      }} />}
    {payRun && <PayBillsModal db={db} actions={actions} toast={toast} onClose={() => setPayRun(false)} />}
    {viewRemit && <RemittanceView args={viewRemit} toast={toast} onClose={() => setViewRemit(null)}
      onEdit={go ? () => { setViewRemit(null); setPay(null); go("payments"); } : undefined} />}
    {emailRemit && <EmailModal docType="remittance"
      title={"Email Remittance · " + (nameOf(db, emailRemit.bill.vendorId))}
      defaultTo={remitEmail(db.contacts.find(c => c.id === emailRemit.bill.vendorId))}
      defaultSubject={`Payment remittance — ${db.settings.company}`}
      defaultBody={`Please find attached remittance advice for our payment of ${money(emailRemit.payment.amount)} dated ${emailRemit.payment.date}.\n\n${db.settings.company}`}
      buildAttachment={() => Promise.resolve(remittancePdf(remitArgs(emailRemit.bill, emailRemit.payment)))}
      onSent={() => setPay(null)}
      onClose={() => setEmailRemit(null)} toast={toast} />}
  </div>;
}

// Batch payment run: select bills, per-item Check vs Electronic, record all,
// then print checks (one per vendor, stubs list every bill) and remittances,
// and confirm the checks came out of the printer clean.
// One payment document per vendor + method: several bills to one vendor paid the
// same way are one check or one remittance. The dialog and the write both group
// through here, so what you see listed is exactly what gets recorded.
function groupSel(rows) {
  const out = []; const m = new Map();
  rows.forEach(r => {
    const k = r.bill.vendorId + "|" + r.method;
    if (!m.has(k)) { m.set(k, { key: k, vendorId: r.bill.vendorId, method: r.method, rows: [] }); out.push(m.get(k)); }
    m.get(k).rows.push(r);
  });
  return out;
}

function PayBillsModal({ db, actions, toast, onClose }) {
  const openBills = db.bills.filter(b => (billBalance(b)) > 0.005);
  const [date, setDate] = useState(todayISO());
  const [cashAccount, setCashAccount] = useState("");   // blank = the default cash account (Checking)
  const [startChk, setStartChk] = useState(() => nextCheckNumber(db, db.settings));
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState(null); // after recording: {checkRuns, remitRuns, checkPaymentIds}
  // Each row starts on the way that vendor was paid last time — a vendor paid
  // by ACH stays ACH — and on Check only for a vendor never paid before.
  const PAY_METHODS = ["Check", "ACH / Wire", "Credit Card", "Other"];
  const lastMethod = (vendorId) => db.bills.filter(b => b.vendorId === vendorId)
    .flatMap(b => b.payments || []).filter(p => PAY_METHODS.includes(p.method))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0]?.method || "Check";
  const [rows, setRows] = useState(() => openBills.map(b => ({
    bill: b, sel: false, amount: round2(billBalance(b)), discount: 0, method: lastMethod(b.vendorId),
  })));
  // Confirmation / trace numbers for the electronic groups, keyed the same way
  // the groups are. Kept across selection changes so re-ticking a row doesn't
  // lose a number already typed.
  const [eRefs, setERefs] = useState({});
  const [emailRun, setEmailRun] = useState(null);   // a remittance group being emailed
  const upd = (i, patch) => setRows(rs => rs.map((r, x) => x === i ? { ...r, ...patch } : r));
  // Taking a term drops the cash by the discount: the bill still closes because
  // amount + discount settles it.
  const updDiscount = (i, v) => setRows(rs => rs.map((r, x) => x === i
    ? { ...r, discount: v, amount: round2(Math.max(0, billBalance(r.bill) - (Number(v) || 0))), sel: true } : r));
  const setAll = (s) => setRows(rs => rs.map(r => ({ ...r, sel: s })));
  // One method for everything ticked, in one go.
  const setSelMethod = (m) => setRows(rs => rs.map(r => r.sel ? { ...r, method: m } : r));
  // Changing a row's method moves that vendor's other ticked rows with it —
  // one vendor is normally paid one way — unless they were set differently on
  // purpose (they're then flagged below).
  const updMethod = (i, m) => setRows(rs => {
    const v = rs[i].bill.vendorId, was = rs[i].method;
    return rs.map((r, x) => x === i ? { ...r, method: m, sel: true }
      : r.sel && r.bill.vendorId === v && r.method === was ? { ...r, method: m } : r);
  });
  // What each bill's vendor terms are worth if this run's date is inside the
  // window — never more than the bill's balance.
  const offerOn = (bill) => {
    const o = discountOffer(db, bill, bill.vendorId, date);
    if (!o || o.expired) return null;
    const amount = round2(Math.min(o.amount, billBalance(bill)));
    return amount > 0 ? { ...o, amount } : null;
  };
  const available = rows.map(r => offerOn(r.bill));
  const untaken = available.filter((o, i) => o && round2(Number(rows[i].discount) || 0) !== o.amount);
  const takeAllDiscounts = () => setRows(rs => rs.map((r, i) => {
    const o = available[i];
    return o ? { ...r, discount: o.amount, amount: round2(Math.max(0, billBalance(r.bill) - o.amount)), sel: true } : r;
  }));
  const sel = rows.filter(r => r.sel && (Number(r.amount) > 0 || Number(r.discount) > 0));
  const total = sum(sel, r => Number(r.amount) || 0);
  const groups = groupSel(sel);
  const eGroups = groups.filter(g => g.method !== "Check");
  const checkCount = new Set(sel.filter(r => r.method === "Check").map(r => r.bill.vendorId)).size;
  // A vendor being paid two ways in one run is almost always a row left on the
  // wrong method — say so before anything is recorded.
  const mixed = [...new Set(sel.map(r => r.bill.vendorId))].map(v => {
    const by = {}; sel.filter(r => r.bill.vendorId === v).forEach(r => { by[r.method] = (by[r.method] || 0) + 1; });
    return Object.keys(by).length > 1 ? `${nameOf(db, v)} is being paid ${Object.entries(by).map(([m, c]) => `${c} by ${m}`).join(" and ")}` : null;
  }).filter(Boolean);
  // Every number this run will consume, checked against the register up front.
  const runRefs = checkCount ? Array.from({ length: checkCount }, (_, i) => String((parseInt(startChk, 10) || 0) + i)) : [];
  const chkErr = !checkCount ? ""
    : !/^\d+$/.test(String(startChk).trim()) ? "Enter the number of the first check on the stack."
      : runRefs.filter(r => checkNumberTaken(db, r)).map(r => "#" + r).join(", ");
  // A bill can be part-paid — the rest stays open for a later run — but never
  // paid past what it owes.
  const overRows = sel.filter(r => applyAgainst(billBalance(r.bill), r.amount, r.discount).over);
  const partCount = sel.filter(r => applyAgainst(billBalance(r.bill), r.amount, r.discount).partial).length;
  const overErr = overRows.length ? `More than the balance: ${overRows.map(r => r.bill.ref || r.bill.number).join(", ")}. A bill can be part-paid, not overpaid.` : "";
  const err = chkErr ? (chkErr.startsWith("#") ? `Already used: ${chkErr}. Void those checks or start from a different number.` : chkErr) : overErr;

  const record = async () => {
    setBusy(true);
    // Checks are numbered from Starting Check #; an electronic group carries the
    // reference typed for it, so the payment can be traced back to the bank.
    let chk = parseInt(startChk, 10);
    groups.forEach(g => {
      g.ref = g.method === "Check"
        ? (isNaN(chk) ? "" : String(chk++))
        : (eRefs[g.key] || "").trim();
    });
    const entries = groups.flatMap(g => g.rows.map(r => ({
      parentType: "bill", parentId: r.bill.id,
      payment: { id: uid(), amount: Number(r.amount) || 0, discount: Number(r.discount) || 0, date, method: g.method, ref: g.ref, cashAccount },
    })));
    const written = await actions.recordPayments(entries);
    setBusy(false);
    if (!written) return;
    toast(`${sel.length} payment${sel.length > 1 ? "s" : ""} recorded — ${money(total)}`);
    const vend = id => db.contacts.find(c => c.id === id);
    const lines = g => g.rows.map(r => ({ ref: r.bill.ref || r.bill.number, date: r.bill.date, desc: r.bill.notes,
      invoiceAmount: Number(r.bill.amount) || 0, discount: Number(r.discount) || 0, amount: Number(r.amount) || 0 }));
    const checkGroups = groups.filter(g => g.method === "Check");
    setDocs({
      checkRuns: checkGroups.map(g => ({
        payment: { amount: sum(g.rows, r => Number(r.amount) || 0), date, ref: g.ref },
        vendor: vend(g.vendorId), memo: g.rows.map(r => r.bill.ref || r.bill.number).join(", ").slice(0, 60),
        stubLines: lines(g),
      })),
      remitRuns: groups.filter(g => g.method !== "Check").map(g => ({
        payment: { amount: sum(g.rows, r => Number(r.amount) || 0), date, ref: g.ref, method: g.method },
        vendor: vend(g.vendorId), lines: lines(g), settings: db.settings,
      })),
      checkRefs: checkGroups.map(g => g.ref),
      checkPaymentIds: entries.filter(e => e.payment.method === "Check").map(e => e.payment.id),
    });
  };

  const voidChecks = async () => {
    if (!confirm(`Void ${docs.checkPaymentIds.length} check payment${docs.checkPaymentIds.length > 1 ? "s" : ""}? Those bills reopen and the check numbers are free again.`)) return;
    setBusy(true);
    const ok = await actions.deletePayments(docs.checkPaymentIds);
    setBusy(false);
    if (!ok) return;
    toast(`Voided check${docs.checkRefs.length > 1 ? "s" : ""} ${docs.checkRefs.map(r => "#" + r).join(", ")} — bills reopened`);
    onClose();
  };

  if (docs) return <><Modal title="Payments Recorded" onClose={onClose}
    foot={<>
      {docs.checkPaymentIds.length > 0 && <button className="btn danger" disabled={busy} style={{ marginRight: "auto" }} onClick={voidChecks}>
        <Ico d={ICONS.trash} size={15} />Checks Didn't Print — Void</button>}
      <button className="btn primary" disabled={busy} onClick={onClose}><Ico d={ICONS.check} size={15} />
        {docs.checkPaymentIds.length > 0 ? "Printed Correctly — Save" : "Done"}</button>
    </>}>
    <p className="subtle" style={{ marginTop: 0 }}>Print on the right paper: checks on your check stock at 100% scale, remittances on plain paper (email them from each bill's payment history if preferred).</p>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {docs.checkRuns.length > 0 && <button className="btn primary" onClick={() => window.open(URL.createObjectURL(checksPdf(docs.checkRuns, db.settings)), "_blank")}>
        <Ico d={ICONS.print} size={15} />Print {docs.checkRuns.length} Check{docs.checkRuns.length > 1 ? "s" : ""}</button>}
      {docs.remitRuns.length > 0 && <button className="btn" onClick={() => window.open(URL.createObjectURL(remittancesPdf(docs.remitRuns)), "_blank")}>
        <Ico d={ICONS.print} size={15} />Print {docs.remitRuns.length} Remittance{docs.remitRuns.length > 1 ? "s" : ""}</button>}
    </div>
    {docs.remitRuns.length > 0 && <>
      <div className="divider"></div>
      <div className="subtle" style={{ fontWeight: 600, marginBottom: 8 }}>Email a remittance
        <span style={{ fontWeight: 400 }}> · goes to the vendor's A/P contact, with the advice attached</span></div>
      <table><thead><tr><th>Vendor</th><th>Method</th><th className="num">Amount</th><th></th></tr></thead>
        <tbody>{docs.remitRuns.map((r, i) => <tr key={i}>
          <td style={{ fontWeight: 600 }}>{r.vendor?.name || "—"}</td>
          <td className="subtle">{r.payment.method}{r.payment.ref ? " · " + r.payment.ref : ""}</td>
          <td className="num">{money(r.payment.amount)}</td>
          <td style={{ textAlign: "right" }}>
            <button className="btn sm" onClick={() => setEmailRun(r)}><Ico d={ICONS.mail} size={14} />Email</button>
          </td>
        </tr>)}</tbody></table>
    </>}
    {docs.checkRefs.length > 0 && <p className="subtle" style={{ marginBottom: 0 }}>
      Checks used: <span className="mono">{docs.checkRefs.map(r => "#" + r).join(", ")}</span>. If any of them misfeeds, void the run and re-run it — the bills reopen and those numbers become available again.
    </p>}
  </Modal>
  {emailRun && <EmailModal docType="remittance"
    title={"Email Remittance · " + (emailRun.vendor?.name || "")}
    defaultTo={remitEmail(emailRun.vendor)}
    defaultSubject={`Remittance advice — ${money(emailRun.payment.amount)} from ${db.settings.company}`}
    defaultBody={`Please find attached remittance advice for our payment of ${money(emailRun.payment.amount)} dated ${fmtDate(emailRun.payment.date)}${emailRun.payment.ref ? ` (reference ${emailRun.payment.ref})` : ""}.\n\n${db.settings.company}`}
    buildAttachment={() => Promise.resolve(remittancePdf(emailRun))}
    onClose={() => setEmailRun(null)} toast={toast} />}
  </>;

  return <Modal wide title="Pay Bills" onClose={onClose}
    foot={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || sel.length === 0 || !!err} onClick={record}>
        {busy ? "Recording…" : `Record ${sel.length} Payment${sel.length === 1 ? "" : "s"} · ${money(total)}`}</button></>}>
    <div className="row">
      <Field label="Payment Date"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Starting Check #" hint="Checks are numbered from here, one per vendor">
        <input className="input mono" value={startChk} onChange={e => setStartChk(e.target.value)} placeholder="1001"
          style={chkErr ? { borderColor: "var(--neg)" } : undefined} /></Field>
      <Field label="Pay From" hint={"Default: " + (accountLabel(db, accountSettings(db.settings).cash) || "Checking")}>
        <AccountSelect db={db} value={cashAccount} onChange={setCashAccount} types={["Cash"]} blank="— default cash account —" /></Field>
    </div>
    {err && <p className="subtle" style={{ margin: "0 0 8px", color: "var(--neg)" }}>{err}</p>}
    <div className="toolbar" style={{ marginBottom: 8 }}>
      {sel.length > 0 && <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><span className="subtle">Pay ticked by</span>
        {["Check", "ACH / Wire"].map(m => <button key={m} className="btn sm" disabled={sel.every(r => r.method === m)} onClick={() => setSelMethod(m)}>{m}</button>)}</span>}
      <span className="subtle">Tick the bills this run pays. Lower a Pay Amount to part-pay a bill; the rest stays open.{partCount ? ` · ${partCount} part-paid` : ""}</span>
      {untaken.length > 0 && <button className="btn sm" onClick={takeAllDiscounts}>
        Take {untaken.length} available discount{untaken.length === 1 ? "" : "s"} · {money(sum(untaken, o => o.amount))}</button>}
      <button className="btn sm" style={{ marginLeft: "auto" }} disabled={rows.every(r => r.sel)} onClick={() => setAll(true)}>Select all</button>
      <button className="btn sm" disabled={!rows.some(r => r.sel)} onClick={() => setAll(false)}>Deselect all</button>
    </div>
    <table><thead><tr><th></th><th>Vendor</th><th>Bill / Ref</th><th>Due</th><th className="num">Balance</th><th className="num">Discount</th><th className="num">Pay Amount</th><th className="num">Left open</th><th>Method</th></tr></thead>
      <tbody>{rows.map((r, i) => {
        const bal = billBalance(r.bill);
        const fit = applyAgainst(bal, r.amount, r.discount);
        return <tr key={r.bill.id}>
          <td><input type="checkbox" checked={r.sel} onChange={e => upd(i, { sel: e.target.checked })} /></td>
          <td style={{ fontWeight: 600 }}>{nameOf(db, r.bill.vendorId)}</td>
          <td className="mono subtle">{r.bill.ref || r.bill.number}</td>
          <td className="subtle">{fmtDate(r.bill.dueDate)}</td>
          <td className="num">{money(bal)}</td>
          <td className="num">
            <input className="input mono" style={{ maxWidth: 100, textAlign: "right" }} type="number" step="any" value={r.discount}
              title="Early-payment discount taken — the bill still closes" onChange={e => updDiscount(i, e.target.value)} />
            {available[i] && round2(Number(r.discount) || 0) !== available[i].amount &&
              <div><button className="btn sm" style={{ marginTop: 4 }} title={`${available[i].label}, until ${fmtDate(available[i].until)}`}
                onClick={() => updDiscount(i, available[i].amount)}>Take {money(available[i].amount)}</button></div>}
          </td>
          <td className="num"><input className="input mono" type="number" step="any" value={r.amount}
            onChange={e => upd(i, { amount: e.target.value, sel: true })}
            style={{ maxWidth: 110, textAlign: "right", ...(r.sel && fit.over ? { borderColor: "var(--neg)" } : {}) }} /></td>
          <td className="num">{!r.sel ? null
            : fit.over ? <span style={{ color: "var(--neg)", fontSize: 12 }}>over by {money(Math.abs(fit.left))}</span>
              : fit.partial ? <span className="mono" title="Part payment — the rest stays open">{money(fit.left)}</span>
                : <span className="subtle" style={{ fontSize: 12 }}>paid in full</span>}</td>
          <td><select className="select" style={{ minWidth: 110 }} value={r.method} onChange={e => updMethod(i, e.target.value)}>
            {PAY_METHODS.map(m => <option key={m}>{m}</option>)}
          </select></td>
        </tr>;
      })}</tbody></table>
    {eGroups.length > 0 && <>
      <div className="divider"></div>
      <div className="subtle" style={{ fontWeight: 600, marginBottom: 8 }}>
        Electronic payments — reference #
        <span style={{ fontWeight: 400 }}> · optional; the bank's confirmation or trace number. It prints on the remittance and identifies the payment in the register.</span>
      </div>
      <table><thead><tr><th>Vendor</th><th>Method</th><th className="num">Amount</th><th style={{ width: 220 }}>Reference #</th></tr></thead>
        <tbody>{eGroups.map(g => <tr key={g.key}>
          <td style={{ fontWeight: 600 }}>{nameOf(db, g.vendorId)}</td>
          <td className="subtle">{g.method}</td>
          <td className="num">{money(sum(g.rows, r => Number(r.amount) || 0))}</td>
          <td><input className="input mono" value={eRefs[g.key] || ""} placeholder="e.g. E260910-01"
            onChange={e => setERefs(p => ({ ...p, [g.key]: e.target.value }))} /></td>
        </tr>)}</tbody></table>
    </>}
    {mixed.length > 0 && <div style={{ margin: "10px 0 0", padding: "10px 12px", background: "var(--warn-wash)", borderRadius: 9 }}>
      <b>Check the methods:</b> {mixed.join("; ")}. If that's not intended, change the odd one out before recording.</div>}
    <div style={{ margin: "10px 0 0", fontWeight: 600 }}>This run: {checkCount > 0 ? `${checkCount} check${checkCount > 1 ? "s" : ""} to print (${runRefs.map(r => "#" + r).join(", ")})` : "no checks"}
      {eGroups.length > 0 ? ` · ${eGroups.length} electronic payment${eGroups.length > 1 ? "s" : ""} with a remittance` : ""}</div>
    <p className="subtle" style={{ marginBottom: 0 }}>Multiple bills for the same vendor and method combine into one check or one remittance, with every bill listed on the stub.</p>
  </Modal>;
}
