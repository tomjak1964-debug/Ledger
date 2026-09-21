import { useState } from "react";
import { money, fmtDate, todayISO, daysBetween, nameOf } from "../lib/helpers.js";
import { lineTotals, balance, invoiceStatus, agingBuckets, round2 } from "../calc/ledger.js";
import { useFilters } from "../components/useFilters.jsx";
import { Ico, ICONS, Badge, Empty, SortTh, useTableSort } from "../components/ui.jsx";
import PaymentModal from "../components/PaymentModal.jsx";
import { discountOffer } from "../lib/terms.js";
import PaymentGroupModal from "../components/PaymentGroupModal.jsx";
import EmailModal from "../components/EmailModal.jsx";
import PaymentRegister from "../components/PaymentRegister.jsx";
import ApplyCreditModal from "../components/ApplyCreditModal.jsx";
import CreditNoteModal from "../components/CreditNoteModal.jsx";
import { creditAvailable, creditRemaining } from "../lib/credits.js";
import { invoicePdf } from "../lib/invoicePdf.js";

// The date an invoice was settled — the last payment on it.
const paidDate = (i) => (i.payments || []).map(p => p.date).filter(Boolean).sort().pop() || "";

export default function ReceivablesView({ db, actions, toast, openDoc, readOnly }) {
  const [pay, setPay] = useState(null);
  const [tab, setTab] = useState("open");
  const [receipt, setReceipt] = useState(false);
  const [remind, setRemind] = useState(null);
  const [showPaid, setShowPaid] = useState(false);
  const [applyTo, setApplyTo] = useState(null);   // { customerId, creditId?, focusInvoiceId? }
  const [creditNote, setCreditNote] = useState(null);   // the credit note being written or edited
  // Every invoice with a non-zero balance: positive balances are owed to us,
  // negative balances are open credits waiting to be applied. Settled is judged
  // on the balance rather than the status so an unapplied credit — which reads
  // as "paid" against its own negative total — stays in the open list.
  const f = useFilters({ partyKind: "customer", contacts: db.contacts });
  const mine = db.invoices.filter(i => f.keep(i.date, i.customerId));
  const isSettled = i => Math.abs(balance(i)) <= 0.005;
  const open = mine.filter(i => !isSettled(i));
  const settled = mine.filter(isSettled);
  const listed = showPaid ? mine : open;
  const b = agingBuckets(open, i => i.dueDate, balance);      // positive balances only
  const total = b.cur + b.d30 + b.d60 + b.d90 + b.d90p;
  const credits = open.filter(i => balance(i) < -0.005);
  const creditTotal = round2(credits.reduce((s, i) => s + balance(i), 0));
  const isCredit = i => lineTotals(i.lineItems, i.taxRate).total < 0;
  const { sorted: arRows, sort, onSort } = useTableSort(listed, {
    number: i => i.number, customer: i => nameOf(db, i.customerId), due: i => i.dueDate,
    age: i => daysBetween(i.dueDate, todayISO()), status: i => invoiceStatus(i),
    paid: i => paidDate(i), balance: i => balance(i),
  }, { key: "due", dir: "asc" });

  return <div>
    <div className="toolbar">
      <div className="pill-tabs">
        <button className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>Open Invoices</button>
        <button className={tab === "receipts" ? "on" : ""} onClick={() => setTab("receipts")}>Receipts</button>
      </div>
      {!readOnly && <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setCreditNote({})}>
        <Ico d={ICONS.plus} size={15} />New Credit Note
      </button>}
      {!readOnly && <button className="btn primary" onClick={() => setReceipt(true)}>
        <Ico d={ICONS.money} size={15} />Receive Payment
      </button>}
    </div>
    {tab === "receipts" && <PaymentRegister db={db} actions={actions} toast={toast} readOnly={readOnly} kind="invoice" />}
    {tab === "open" && <>{f.bar()}<div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>A/R Aging</h3><span className="mono" style={{ marginLeft: "auto", fontWeight: 600, fontSize: 16 }}>{money(total)}</span></div>
      <div className="card-body">
        <div className="aging">
          <div className="bucket"><div className="b-lbl">Current</div><div className="b-val">{money(b.cur)}</div></div>
          <div className="bucket"><div className="b-lbl">1–30 days</div><div className="b-val">{money(b.d30)}</div></div>
          <div className="bucket hot"><div className="b-lbl">31–60 days</div><div className="b-val">{money(b.d60)}</div></div>
          <div className="bucket hot"><div className="b-lbl">61–90 days</div><div className="b-val">{money(b.d90)}</div></div>
          <div className="bucket hot"><div className="b-lbl">90+ days</div><div className="b-val">{money(b.d90p)}</div></div>
        </div>
        {creditTotal < -0.005 && <p className="subtle" style={{ margin: "12px 0 0" }}>
          Open credits: <span className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{money(creditTotal)}</span> across {credits.length} credit invoice{credits.length > 1 ? "s" : ""} — apply one to an open invoice from its row below, or on a receipt.
        </p>}
      </div>
    </div>
    <div className="card">
      <div className="card-head"><h3>Customer Invoices</h3>
        <label className="subtle" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 500 }}>
          <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} />
          Show paid invoices{settled.length > 0 ? ` (${settled.length})` : ""}
        </label>
      </div>
      {mine.length === 0
        ? <Empty icon={ICONS.ar} title="No invoices" msg="Receivables shows what customers still owe you, bucketed by age. Invoice a sales order, or raise a standalone invoice, and it lands here." />
        : arRows.length === 0
          ? <Empty icon={ICONS.ar} title="Nothing outstanding" msg="Every invoice is paid. Tick “Show paid invoices” to see the settled ones." />
          : <table><thead><tr>
          <SortTh label="Invoice" col="number" sort={sort} onSort={onSort} />
          <SortTh label="Customer" col="customer" sort={sort} onSort={onSort} />
          <SortTh label="Due" col="due" sort={sort} onSort={onSort} />
          <SortTh label="Age" col="age" sort={sort} onSort={onSort} />
          <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
          <SortTh label="Paid" col="paid" sort={sort} onSort={onSort} />
          <SortTh label="Balance" col="balance" sort={sort} onSort={onSort} num /><th></th></tr></thead>
          <tbody>{arRows.map(inv => {
            const od = daysBetween(inv.dueDate, todayISO());
            const credit = isCredit(inv);
            const done = isSettled(inv);
            const late = od > 0 && !credit && !done;
            return <tr key={inv.id}>
              <td className="doc-id">{inv.number}</td><td>{nameOf(db, inv.customerId)}</td>
              <td className="subtle">{fmtDate(inv.dueDate)}</td>
              <td className={late ? "" : "subtle"} style={late ? { color: "var(--neg)", fontWeight: 600 } : {}}>{credit || done ? "—" : od > 0 ? od + "d late" : "current"}</td>
              <td><Badge status={credit && !done ? "credit" : invoiceStatus(inv)} /></td>
              <td className="subtle">{done && paidDate(inv) ? fmtDate(paidDate(inv)) : "—"}</td>
              <td className="num" style={{ fontWeight: 600, color: balance(inv) < 0 ? "var(--accent)" : undefined }}>{money(balance(inv))}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {!readOnly && credit && !done && <button className="btn sm primary" title={`Put ${money(creditRemaining(inv))} against this customer's open invoices`}
                  onClick={() => setApplyTo({ customerId: inv.customerId, creditId: inv.id })}>Apply Credit</button>}
                {!readOnly && !credit && !done && <button className="btn sm primary" onClick={() => setPay(inv)}>Record Payment</button>}
                {!readOnly && !credit && !done && creditAvailable(db, inv.customerId) > 0.005 &&
                  <button className="btn sm" title={`${money(creditAvailable(db, inv.customerId))} in open credits for this customer`}
                    onClick={() => setApplyTo({ customerId: inv.customerId, focusInvoiceId: inv.id })}>Apply Credit</button>}
                {!readOnly && !credit && !done && od > 0 && <button className="btn ghost icon" title="Email payment reminder" onClick={() => setRemind(inv)}><Ico d={ICONS.mail} size={16} /></button>}
                {!readOnly && credit && <button className="btn ghost icon" title="Edit credit note" onClick={() => setCreditNote(inv)}><Ico d={ICONS.edit} size={16} /></button>}
                <button className="btn ghost icon" title="Print" onClick={() => openDoc("invoice", inv)}><Ico d={ICONS.print} size={16} /></button>
              </td>
            </tr>;
          })}</tbody></table>}
    </div></>}
    {creditNote && <CreditNoteModal db={db} credit={creditNote.id ? creditNote : null} onClose={() => setCreditNote(null)}
      onSave={async (cn) => {
        const saved = await actions.saveInvoice(cn);
        if (saved) toast(cn._new ? "Credit note " + saved.number + " issued" : "Credit note saved");
        return !!saved;
      }} />}
    {applyTo && <ApplyCreditModal db={db} customerId={applyTo.customerId} creditId={applyTo.creditId} focusInvoiceId={applyTo.focusInvoiceId}
      onClose={() => setApplyTo(null)}
      onApply={async (creditId, allocations, meta) => {
        const res = await actions.applyCredit(creditId, allocations, meta);
        if (res) toast(`${money(res.applied)} applied to ${res.count} invoice${res.count === 1 ? "" : "s"}`);
        return !!res;
      }} />}
    {receipt && <PaymentGroupModal db={db} kind="invoice" onClose={() => setReceipt(false)}
      onSave={async (allocations, meta) => {
        const ok = await actions.recordReceipt(allocations, meta);
        if (ok) toast("Receipt recorded");
        return ok;
      }} />}
    {remind && <EmailModal
      title={"Payment Reminder · " + remind.number}
      defaultTo={db.contactPeople.find(p => p.id === remind.contactPersonId)?.email || db.contacts.find(c => c.id === remind.customerId)?.email || ""}
      defaultSubject={`Payment reminder — invoice ${remind.number} (${db.settings.company})`}
      defaultBody={`Hello,\n\nA friendly reminder that invoice ${remind.number} for ${money(balance(remind))} was due ${fmtDate(remind.dueDate)} and is now ${daysBetween(remind.dueDate, todayISO())} days past due.\n\nPlease remit at your earliest convenience. If payment is already on the way, thank you and please disregard.\n\n${db.settings.company}\n${db.settings.companyPhone || ""}`}
      buildAttachment={() => invoicePdf(remind, db)}
      onClose={() => setRemind(null)} toast={toast} />}
    {pay && <PaymentModal doc={pay} onClose={() => setPay(null)}
      offerFor={d => discountOffer(db, pay, pay.customerId, d)}
      onSave={async (p) => {
        if (!await actions.recordPayment("invoice", pay.id, p)) return false;
        toast("Payment recorded");
        return true;
      }}
      onVoid={async (p) => {
        if (!await actions.deletePayments([p.id])) return false;
        toast("Payment reversed — " + pay.number + " is open again");
        return true;
      }}
      onDelete={async (pid) => {
        if (await actions.deletePayments([pid])) {
          setPay(prev => ({ ...prev, payments: (prev.payments || []).filter(x => x.id !== pid) }));
          toast("Payment deleted");
        }
      }} />}
  </div>;
}
