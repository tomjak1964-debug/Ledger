import { useState, useRef, useEffect } from "react";
import { uid, todayISO, isoDate, money, fmtDate, sum, pickable } from "../lib/helpers.js";
import { round2, billBalance, balance, applyOldestFirst } from "../calc/ledger.js";
import { accountSettings, accountLabel, TYPE_GROUP, accountByNumber } from "../calc/accounts.js";
import { reconcileState, matchStatement, suggestVendorPayment, suggestCustomerReceipt, openInvoices, bankKey } from "../calc/bankRecon.js";
import { AUTO_NUMBER } from "../lib/store.js";
import { readStatementFile, parseStatement, parsePasted } from "../lib/bankStatement.js";
import AccountSelect from "../components/AccountSelect.jsx";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort, ActionMenu, MenuItem } from "../components/ui.jsx";
import { JournalEntryModal } from "./JournalEntries.jsx";

// System → Bank Reconciliation. Pick the account, type the statement's ending
// date and balance, then tick what cleared until the difference reads zero.
// The list is the ledger's own cash lines (calc/bankRecon.js), so every
// receipt, check, expense entry and journal line is here to tick, and a
// statement imported as PDF / CSV / text ticks the ones it can match and
// offers to post the ones the books don't have.

export default function BankReconciliationView({ db, actions, toast, readOnly }) {
  const [openId, setOpenId] = useState(null);
  const [newRec, setNewRec] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  // Started in this visit and nothing ticked yet: backing out discards it, so a
  // reconciliation is only kept once something has been cleared on it.
  const [freshId, setFreshId] = useState(null);   // a statement read on the New screen, reviewed once the reconciliation opens
  const [reading, setReading] = useState(false);
  const newFileRef = useRef();
  const recs = db.bankReconciliations || [];
  const open = recs.find(r => r.id === openId);
  const { sorted: rows, sort, onSort } = useTableSort(recs, {
    date: r => r.statementDate, account: r => r.account, balance: r => r.statementBalance, status: r => r.status,
  }, { key: "date", dir: "desc" });

  const startNew = () => {
    const acct = accountSettings(db.settings).cash;
    const last = recs.filter(r => r.account === acct && r.status === "done").sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0];
    const d = last && new Date(last.statementDate + "T00:00:00");
    const next = d && new Date(d.getFullYear(), d.getMonth() + 2, 0);    // the last day of the next month
    setNewRec({ id: uid(), _new: true, account: acct, statementDate: next ? isoDate(next) : todayISO(), statementBalance: "", status: "open", notes: "" });
  };
  // Read the statement on the New screen: its period end and ending balance
  // fill in the two fields, and the lines wait to be reviewed once the
  // reconciliation opens.
  const readNewFile = async (f) => {
    if (!f) return;
    setReading(true);
    try {
      const year = Number((newRec.statementDate || todayISO()).slice(0, 4));
      const p = parseStatement(await readStatementFile(f), { year });
      if (!p.lines.length) throw new Error("no transactions found — try the .csv export from online banking");
      setNewRec(x => ({ ...x, statementDate: p.period?.to || x.statementDate, statementBalance: p.endingBalance != null ? p.endingBalance : x.statementBalance,
        parsed: p, fileName: f.name }));
    } catch (e) { toast("⚠ Couldn't read that file: " + (e.message || e)); }
    finally { setReading(false); if (newFileRef.current) newFileRef.current.value = ""; }
  };
  const create = async () => {
    const { parsed, fileName, ...rec } = newRec;
    const saved = await actions.saveReconciliation(rec);
    if (saved) { setNewRec(null); setPendingImport(parsed || null); setFreshId(saved.id); setOpenId(saved.id); }
  };
  const del = async r => {
    if (!confirm(`Delete the ${fmtDate(r.statementDate)} reconciliation? Everything it marked cleared goes back to outstanding.`)) return;
    if (await actions.deleteReconciliation(r.id)) { if (openId === r.id) setOpenId(null); toast("Reconciliation deleted"); }
  };

  const back = async () => {
    const id = openId;
    setOpenId(null);
    if (id && id === freshId && !(db.bankCleared || []).some(c => c.reconciliationId === id)) {
      setFreshId(null);
      if (await actions.deleteReconciliation(id)) toast("Nothing was cleared — reconciliation discarded");
    }
  };
  if (open) return <ReconcileScreen db={db} actions={actions} toast={toast} readOnly={readOnly} recon={open} onBack={back}
    initialImport={pendingImport} onImportTaken={() => setPendingImport(null)} />;

  return <div>
    <div className="toolbar">
      <p className="subtle" style={{ margin: 0 }}>One reconciliation per statement. Finish it when the difference is zero; the next one starts where it left off.</p>
      {!readOnly && <button className="btn primary" style={{ marginLeft: "auto" }} onClick={startNew}><Ico d={ICONS.plus} size={15} />New Reconciliation</button>}
    </div>
    <div className="card">
      {recs.length === 0
        ? <Empty icon={ICONS.check} title="Nothing reconciled yet" msg="Start with your most recent bank statement. Tick what cleared, import the statement to tick it for you, and post anything the bank knows about that the books don't."
          action={!readOnly && <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Reconciliation</button>} />
        : <table><thead><tr>
          <SortTh label="Statement Date" col="date" sort={sort} onSort={onSort} />
          <SortTh label="Account" col="account" sort={sort} onSort={onSort} />
          <SortTh label="Statement Balance" col="balance" sort={sort} onSort={onSort} num />
          <SortTh label="Status" col="status" sort={sort} onSort={onSort} />
          <th className="num">Difference</th><th></th></tr></thead>
          <tbody>{rows.map(r => { const s = reconcileState(db, r); return <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(r.id)}>
            <td className="subtle">{fmtDate(r.statementDate)}</td>
            <td>{accountLabel(db, r.account)}</td>
            <td className="num mono">{money(r.statementBalance)}</td>
            <td><span className={"badge " + (r.status === "done" ? "green" : "blue")}><span className="dot"></span>{r.status === "done" ? "Finished" : "Open"}</span></td>
            <td className="num mono" style={{ color: Math.abs(s.difference) > 0.005 ? "var(--neg)" : "var(--pos)", fontWeight: 600 }}>{money(s.difference)}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
              <ActionMenu title="Actions">{close => <>
                <MenuItem onClick={() => { close(); setOpenId(r.id); }}>{r.status === "done" ? "View" : "Reconcile"}</MenuItem>
                {!readOnly && r.status === "done" && <MenuItem onClick={async () => { close(); if (await actions.saveReconciliation({ ...r, status: "open", finishedAt: null })) toast("Reopened"); }}>Reopen</MenuItem>}
                {!readOnly && <MenuItem danger onClick={() => { close(); del(r); }}>Delete</MenuItem>}
              </>}</ActionMenu></td>
          </tr>; })}</tbody></table>}
    </div>
    {newRec && <Modal title="New Reconciliation" onClose={() => setNewRec(null)}
      foot={<><button className="btn" onClick={() => setNewRec(null)}>Cancel</button>
        <button className="btn primary" disabled={!newRec.account || !newRec.statementDate || newRec.statementBalance === ""} onClick={create}>{newRec.parsed ? "Start & Match Statement" : "Start Reconciling"}</button></>}>
      <Field label="Bank statement" hint="The PDF from the bank or a .csv export — fills in the ending date and balance, and its lines are matched as soon as you start">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={newFileRef} type="file" accept=".pdf,.csv,.txt" style={{ display: "none" }} onChange={e => readNewFile(e.target.files?.[0])} />
          <button className="btn" disabled={reading} onClick={() => newFileRef.current?.click()}><Ico d={ICONS.clip} size={15} />{reading ? "Reading…" : newRec.parsed ? "Choose a Different File" : "Import Statement"}</button>
          {newRec.parsed && <span className="subtle">{newRec.fileName} · {newRec.parsed.lines.length} transactions{newRec.parsed.period ? ` · ${fmtDate(newRec.parsed.period.from)} – ${fmtDate(newRec.parsed.period.to)}` : ""}
            {newRec.parsed.endingBalance == null && <span style={{ color: "var(--warn)" }}> · no ending balance on it — type it below</span>}</span>}
        </div></Field>
      <div className="row">
        <Field label="Bank account"><AccountSelect db={db} value={newRec.account} onChange={v => setNewRec({ ...newRec, account: v })} types={["Cash"]} blank="— pick the account —" /></Field>
        <Field label="Statement ending date"><input className="input" type="date" value={newRec.statementDate} onChange={e => setNewRec({ ...newRec, statementDate: e.target.value })} /></Field>
        <Field label="Statement ending balance" hint="From the top of the statement"><input className="input mono" type="number" step="0.01" value={newRec.statementBalance} onChange={e => setNewRec({ ...newRec, statementBalance: e.target.value })} /></Field>
      </div>
      <p className="subtle" style={{ margin: 0 }}>The first reconciliation of an account should tick its opening-balance journal entry along with everything on that first statement.</p>
    </Modal>}
  </div>;
}

/* ---------- one statement ---------- */
export function ReconcileScreen({ db, actions, toast, readOnly, recon, onBack, initialImport, onImportTaken }) {
  const s = reconcileState(db, recon);
  const done = recon.status === "done";
  const locked = readOnly || done;
  // A statement read on the New screen opens straight into its review.
  const [importing, setImporting] = useState(!!initialImport && !locked);
  const [preParsed] = useState(initialImport || null);
  const [bookDiff, setBookDiff] = useState(null);
  const [edit, setEdit] = useState(null);   // header edits: { statementDate, statementBalance }
  const toggle = async (it) => { if (locked) return; await actions.setCleared(recon, [it], !it.cleared); };
  const setAll = async (list, cleared) => {
    if (locked) return;
    const items = list.filter(it => it.cleared !== cleared && (cleared || it.thisRecon));
    if (items.length && await actions.setCleared(recon, items, cleared)) toast(`${items.length} item${items.length === 1 ? "" : "s"} ${cleared ? "marked cleared" : "unticked"}`);
  };
  const finish = async () => {
    if (Math.abs(s.difference) > 0.005) { toast("The difference must be zero to finish."); return; }
    if (await actions.saveReconciliation({ ...recon, status: "done", finishedAt: new Date().toISOString() })) { toast("Reconciled " + fmtDate(recon.statementDate)); onBack(); }
  };
  const saveHeader = async () => {
    if (await actions.saveReconciliation({ ...recon, statementDate: edit.statementDate, statementBalance: Number(edit.statementBalance) || 0 })) { setEdit(null); toast("Statement updated"); }
  };
  // Book the difference: a journal entry between the bank account and an
  // account of the user's choosing (bank fees, interest…), dated the statement.
  const startBookDiff = () => {
    const d = s.difference;   // statement − cleared: positive means the bank has more than the books
    setBookDiff({ id: uid(), _new: true, date: recon.statementDate, ref: "Reconciliation", memo: "Reconciliation adjustment — " + fmtDate(recon.statementDate), lines: [
      { id: uid(), account: s.account, desc: d > 0 ? "Bank has more than the books" : "Bank has less than the books", debit: d > 0 ? round2(d) : "", credit: d < 0 ? round2(-d) : "" },
      { id: uid(), account: d > 0 ? "4300" : "6850", desc: d > 0 ? "Other income" : "Service charge", debit: d < 0 ? round2(-d) : "", credit: d > 0 ? round2(d) : "" },
    ] });
  };
  const onBooked = async (j) => {
    const saved = await actions.saveJournalEntry(j);
    if (!saved) return;
    setBookDiff(null);
    const idx = saved.lines.findIndex(l => String(l.account) === s.account);
    if (idx >= 0) await actions.setCleared(recon, [{ key: `journal:${saved.id}:${idx}`, date: saved.date, amount: round2((Number(saved.lines[idx].debit) || 0) - (Number(saved.lines[idx].credit) || 0)) }], true);
    toast(saved.number + " booked and cleared");
  };

  const stat = (label, val, tone, meta) => <div className="stat"><div className="lbl">{label}</div><div className={"val mono" + (tone ? " " + tone : "")}>{val}</div>{meta && <div className="meta">{meta}</div>}</div>;
  const balanced = Math.abs(s.difference) < 0.005;

  return <div>
    <div className="toolbar" style={{ alignItems: "center" }}>
      <button className="btn" onClick={onBack}>‹ All reconciliations</button>
      <div style={{ marginLeft: 8 }}>
        <div style={{ fontWeight: 700 }}>{accountLabel(db, s.account)}</div>
        <div className="subtle">Statement of {fmtDate(recon.statementDate)} · ending balance <span className="mono">{money(recon.statementBalance)}</span>
          {!locked && <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => setEdit({ statementDate: recon.statementDate, statementBalance: recon.statementBalance })}>Edit</button>}</div>
      </div>
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
        {!locked && <button className="btn" onClick={() => setImporting(true)}><Ico d={ICONS.clip} size={15} />Import Statement</button>}
        {!locked && !balanced && s.items.length > 0 && <button className="btn" onClick={startBookDiff} title="Write a journal entry for the difference — a bank fee, interest, a deposit the books missed">Book the Difference</button>}
        {!locked && <button className="btn primary" disabled={!balanced} onClick={finish} title={balanced ? "" : "The difference must be zero"}><Ico d={ICONS.check} size={15} />Finish</button>}
        {done && <span className="badge green"><span className="dot"></span>Finished</span>}
      </span>
    </div>

    <div className="grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 16 }}>
      {stat("Statement balance", money(recon.statementBalance), null, "from the bank")}
      {stat("Cleared balance", money(s.clearedTotal), null, `${money(s.clearedDeposits)} in · ${money(s.clearedPayments)} out this statement`)}
      {stat("Difference", money(s.difference), balanced ? "pos" : "neg", balanced ? "in balance — ready to finish" : s.difference > 0 ? "the bank shows more than you've ticked" : "you've ticked more than the bank shows")}
      {stat("Book balance", money(s.bookBalance), null, `${s.outstanding.length} outstanding · +${money(s.outstandingDeposits)} / −${money(s.outstandingPayments)}`)}
    </div>

    {s.items.length === 0
      ? <div className="card"><Empty icon={ICONS.check} title="Nothing on the books through this date" msg="Receipts, payments, expenses and journal lines on this account dated on or before the statement date appear here. If the account is new, book its opening balance under System → Journal Entries first." /></div>
      : <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <ItemTable title="Deposits & credits" items={s.deposits} locked={locked} onToggle={toggle} onAll={setAll} />
        <ItemTable title="Checks & payments" items={s.payments} locked={locked} onToggle={toggle} onAll={setAll} />
      </div>}

    {edit && <Modal title="Statement" onClose={() => setEdit(null)} foot={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={saveHeader}>Save</button></>}>
      <div className="row">
        <Field label="Statement ending date"><input className="input" type="date" value={edit.statementDate} onChange={e => setEdit({ ...edit, statementDate: e.target.value })} /></Field>
        <Field label="Statement ending balance"><input className="input mono" type="number" step="0.01" value={edit.statementBalance} onChange={e => setEdit({ ...edit, statementBalance: e.target.value })} /></Field>
      </div>
    </Modal>}
    {importing && <ImportStatementModal db={db} actions={actions} toast={toast} recon={recon} state={s} preParsed={preParsed}
      onClose={() => { setImporting(false); onImportTaken?.(); }} />}
    {bookDiff && <JournalEntryModal db={db} entry={bookDiff} onClose={() => setBookDiff(null)} onSave={onBooked} />}
  </div>;
}

function ItemTable({ title, items, locked, onToggle, onAll }) {
  const { sorted: rows, sort, onSort } = useTableSort(items, {
    date: it => it.date, ref: it => it.ref || "", memo: it => it.memo + " " + it.party, amount: it => Math.abs(it.amount), cleared: it => (it.cleared ? 0 : 1),
  }, { key: "date", dir: "asc" });
  const ticked = items.filter(it => it.cleared).length;
  return <div className="card">
    <div className="card-head"><h3>{title}</h3>
      <span className="subtle" style={{ marginLeft: "auto" }}>{ticked} of {items.length} cleared · <span className="mono">{money(sum(items.filter(it => it.cleared), it => Math.abs(it.amount)))}</span></span>
      {!locked && <span style={{ display: "inline-flex", gap: 6, marginLeft: 10 }}>
        <button className="btn sm" onClick={() => onAll(items, true)}>All</button><button className="btn sm" onClick={() => onAll(items, false)}>None</button></span>}
    </div>
    {items.length === 0 ? <div className="card-body subtle">None through this date.</div>
      : <table><thead><tr>
        <SortTh label="✓" col="cleared" sort={sort} onSort={onSort} style={{ width: 36 }} />
        <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
        <SortTh label="Ref" col="ref" sort={sort} onSort={onSort} />
        <SortTh label="Description" col="memo" sort={sort} onSort={onSort} />
        <SortTh label="Amount" col="amount" sort={sort} onSort={onSort} num /></tr></thead>
        <tbody>{rows.map(it => <tr key={it.key} style={{ cursor: locked ? undefined : "pointer", opacity: it.cleared ? 1 : .85 }} onClick={() => onToggle(it)}>
          <td><input type="checkbox" checked={it.cleared} disabled={locked} onChange={() => onToggle(it)} onClick={e => e.stopPropagation()} /></td>
          <td className="subtle" style={{ whiteSpace: "nowrap" }}>{fmtDate(it.date)}</td>
          <td className="mono subtle">{it.ref || "—"}</td>
          <td>{it.memo}{it.party && <div className="subtle" style={{ fontSize: 12 }}>{it.party}</div>}</td>
          <td className="num mono" style={{ fontWeight: 600 }}>{money(Math.abs(it.amount))}</td>
        </tr>)}</tbody></table>}
  </div>;
}

/* ---------- import a statement ---------- */
// Read the file, match every line to an outstanding item, and for the rest
// ask what the money was: post it as an expense entry (money out to an expense
// account) or a journal entry (a distribution, a loan payment, interest, a
// transfer — any account), or leave it.
export function ImportStatementModal({ db, actions, toast, recon, state, onClose, preParsed }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState(null);      // { period, endingBalance, lines }
  const [rows, setRows] = useState([]);            // [{ line, item, take, action, account, payee, recordAs }]
  const [pasted, setPasted] = useState("");
  const year = Number((recon.statementDate || todayISO()).slice(0, 4));
  const acct = accountSettings(db.settings);

  // A card payment: money out whose description names one of the company
  // cards (Settings → the card's bank statement words), or whose amount is a
  // posted statement's balance. It goes to the card's account — the charges
  // are already on the books from the card statement.
  const cards = acct.cards || [];
  const cardPaid = (line) => {
    if (line.amount >= 0) return null;
    const amt = Math.abs(line.amount), desc = (line.desc || "").toUpperCase();
    const byWords = cards.find(c => (c.match || "").split(/[,;]/).map(w => w.trim().toUpperCase()).filter(Boolean).some(w => desc.includes(w)));
    const st = (db.cardStatements || []).filter(s => s.newBalance != null && Math.abs(Number(s.newBalance) - amt) < 0.005 && s.closingDate <= line.date)
      .sort((a, b) => b.closingDate.localeCompare(a.closingDate)).find(s => !byWords || s.cardAccount === String(byWords.account));
    const card = byWords || (st && cards.find(c => String(c.account) === st.cardAccount));
    if (!card) return null;
    const stmt = st || (db.cardStatements || []).filter(s => s.cardAccount === String(card.account) && s.closingDate <= line.date).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
    return { card, stmt };
  };
  // A payment to a vendor the books don't have: an open bill for exactly this
  // amount, else a vendor whose name the statement line carries. Recording it
  // as that vendor's bill payment — not a bare expense — keeps the vendor's
  // account and their 1099 right.
  const vendors = db.contacts.filter(c => c.type === "vendor");
  const vendorPay = (line) => suggestVendorPayment(db, line);
  const customers = db.contacts.filter(c => c.type === "customer");
  const yymmdd = d => String(d || "").slice(2).replace(/-/g, "");
  // How each recurring line was posted before (settings.bankRules, keyed by
  // bankKey): the same transfer, the same rent, the same loan payment comes back
  // already filled in, as card merchants do.
  const rules = db.settings.bankRules || {};
  const load = (p) => {
    const inRange = p.lines.filter(l => l.date <= recon.statementDate);
    const matched = matchStatement(inRange, state.items);
    setParsed({ ...p, skippedLater: p.lines.length - inRange.length });
    setRows(matched.map(m => {
      const cp = !m.item && cardPaid(m.line);
      const rule = !m.item && !m.near && !cp && !m.line.checkNo ? rules[bankKey(m.line.desc)] : null;
      const vp = !m.item && !cp && vendorPay(m.line);
      const cr = !m.item && suggestCustomerReceipt(db, m.line);
      const base = { ...m, take: true, action: m.item ? "clear" : m.near ? "fix" : vp ? "vendor" : cr ? "customer" : "post",
        customerId: cr ? cr.customerId : "", invoiceId: cr ? cr.invoiceId : "", invDesc: m.line.desc, invAccount: "", account: cp ? String(cp.card.account) : m.line.amount < 0 ? "" : "4300",
        payee: cp ? cp.card.name : guessPayee(m.line.desc), recordAs: cp ? "journal" : m.line.amount < 0 ? "expense" : "journal", cardPay: cp || null,
        vendorId: vp ? vp.vendorId : "", billId: vp ? vp.billId : "", billRef: yymmdd(m.line.date), billAccount: "", raiseDoc: false, remembered: !!rule };
      if (!rule) return base;
      // A rule fills in how it went last time; an open bill or invoice for this
      // exact amount still wins over a remembered "new one".
      const sameSide = (rule.action === "vendor" && m.line.amount < 0) || (rule.action === "customer" && m.line.amount > 0) || rule.action === "post";
      if (!sameSide) return base;
      return { ...base, action: rule.action, account: rule.account ?? base.account, recordAs: rule.recordAs || base.recordAs, payee: rule.payee || base.payee,
        vendorId: rule.vendorId || base.vendorId, billId: rule.action === "vendor" && vp && vp.vendorId === rule.vendorId ? vp.billId : "", billAccount: rule.billAccount || "",
        customerId: rule.customerId || base.customerId, invoiceId: rule.action === "customer" ? (cr && cr.customerId === rule.customerId ? cr.invoiceId : "") : base.invoiceId,
        invAccount: rule.invAccount || "" };
    }));
  };
  // Read on the New Reconciliation screen: go straight to the review.
  useEffect(() => { if (preParsed) load(preParsed); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const onFile = async (f) => {
    if (!f) return;
    setBusy(true);
    try { load(parseStatement(await readStatementFile(f), { year })); }
    catch (e) { toast("⚠ Couldn't read that file: " + (e.message || e)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const onPaste = () => load(parsePasted(pasted, { year }));
  const setRow = (i, patch) => setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));

  const toClear = rows.filter(r => r.take && r.item);
  // Correct the books: the row a few dollars off the bank takes the bank's figure.
  const toFix = rows.filter(r => r.take && !r.item && r.near && r.action === "fix");
  const findPayment = (it) => {
    const docs = it.type === "receipt" ? db.invoices : db.bills;
    for (const d of docs) { const p = (d.payments || []).find(x => x.id === it.sourceId); if (p) return { doc: d, p }; }
    return null;
  };
  const toPost = rows.filter(r => r.take && !r.item && r.action === "post");
  const toVendor = rows.filter(r => r.take && !r.item && r.action === "vendor");
  // Written before Ledger started, cleared now: a December check (or deposit)
  // whose expense (or income) is already in last year's books. It is booked on
  // the opening date against Retained Earnings — so the opening balance becomes
  // the true book balance — and ticked cleared on this statement.
  const toPre = rows.filter(r => r.take && !r.item && r.action === "pre");
  const openingDate = (() => {
    const ds = (db.journalEntries || []).filter(j => (j.lines || []).some(l => String(l.account) === String(state.account))).map(j => j.date).filter(Boolean).sort();
    return ds[0] || "";
  })();
  const preDate = (line) => openingDate && openingDate < line.date ? openingDate : `${Number(line.date.slice(0, 4)) - 1}-12-31`;
  // What's wrong with a vendor row, if anything — Apply waits until none are.
  const vendorProblem = (r) => {
    if (!r.vendorId) return "Pick the vendor";
    if (r.billId) {
      const b = db.bills.find(x => x.id === r.billId);
      if (b && Math.abs(r.line.amount) - billBalance(b) > 0.005) return `${b.number} only has ${money(billBalance(b))} left to pay`;
      return "";
    }
    const ref = (r.billRef || "").trim();
    if (!ref) return "Enter the vendor's invoice #";
    if (db.bills.some(b => b.vendorId === r.vendorId && (b.ref || "").trim().toLowerCase() === ref.toLowerCase())) return `This vendor already has a bill with invoice # ${ref}`;
    return "";
  };
  const toCustomer = rows.filter(r => r.take && !r.item && r.action === "customer");
  const customerProblem = (r) => {
    if (!r.customerId) return "Pick the customer";
    const amt = r.line.amount;
    if (r.invoiceId === "oldest") {
      const owed = round2(sum(openInvoices(db, r.customerId), balance));
      return amt > owed + 0.005 ? `They only owe ${money(owed)} across their open invoices` : "";
    }
    if (r.invoiceId) {
      const inv = db.invoices.find(x => x.id === r.invoiceId);
      return inv && amt > balance(inv) + 0.005 ? `${inv.number} only owes ${money(balance(inv))}` : "";
    }
    return (r.invDesc || "").trim() ? "" : "Describe what the invoice was for";
  };
  const canApply = rows.length > 0 && toPost.every(r => r.account) && toVendor.every(r => !vendorProblem(r)) && toCustomer.every(r => !customerProblem(r));
  const apply = async () => {
    setBusy(true);
    try {
      let cleared = 0, posted = 0, failed = 0;
      if (toClear.length && await actions.setCleared(recon, toClear.flatMap(r => r.group || [r.item]), true)) cleared = toClear.length;
      for (const r of toFix) {
        const it = r.near, amt = round2(Math.abs(r.line.amount));
        let ok = false;
        if (it.type === "expense") {
          const e = db.expenses.find(x => x.id === it.sourceId);
          ok = !!(e && await actions.saveExpense({ ...e, amount: amt }));
        } else {
          const f = findPayment(it);
          if (f) {
            const isBill = it.type === "payment", diff = round2(amt - (Number(f.p.amount) || 0));
            // The bill was mistyped too — raise (or lower) it by the same amount.
            if (isBill && r.raiseDoc && !await actions.saveBill({ ...f.doc, amount: round2((Number(f.doc.amount) || 0) + diff) })) { failed++; continue; }
            ok = !!await actions.updatePayment(isBill ? "bill" : "invoice", f.doc.id, { ...f.p, amount: amt });
          }
        }
        if (!ok) { failed++; continue; }
        await actions.setCleared(recon, [{ ...it, amount: r.line.amount }], true);
        posted++;
      }
      // The account's opening-balance entry is no line on any statement, but the
      // first reconciliation has to count it cleared — the bank's balance starts there.
      const opening = state.items.find(it => !it.cleared && it.type === "journal" && /opening balance/i.test(it.memo || ""));
      if (opening && await actions.setCleared(recon, [opening], true)) cleared++;
      for (const r of toPost) {
        const amt = Math.abs(r.line.amount), out = r.line.amount < 0;
        if (out && r.recordAs === "expense") {
          const e = await actions.saveExpense({ id: uid(), date: r.line.date, category: "Other", vendor: r.payee || r.line.desc, amount: amt, method: r.line.checkNo ? "Check" : "Bank", notes: r.line.desc + (r.line.checkNo ? " (check " + r.line.checkNo + ")" : ""), account: r.account, cashAccount: state.account });
          if (!e) { failed++; continue; }
          await actions.setCleared(recon, [{ key: "expense:" + e.id, date: e.date, amount: -amt }], true);
        } else {
          const lines = out
            ? [{ id: uid(), account: state.account, desc: r.line.desc, debit: "", credit: amt }, { id: uid(), account: r.account, desc: r.payee || r.line.desc, debit: amt, credit: "" }]
            : [{ id: uid(), account: state.account, desc: r.line.desc, debit: amt, credit: "" }, { id: uid(), account: r.account, desc: r.payee || r.line.desc, debit: "", credit: amt }];
          const j = await actions.saveJournalEntry({ id: uid(), _new: true, date: r.line.date, ref: r.line.checkNo || "Bank statement", memo: r.line.desc, lines });
          if (!j) { failed++; continue; }
          await actions.setCleared(recon, [{ key: `journal:${j.id}:0`, date: j.date, amount: out ? -amt : amt }], true);
        }
        posted++;
      }
      // Vendor payments: onto the open bill it pays, or a new bill written
      // for it, then cleared like any recorded payment.
      for (const r of toVendor) {
        const amt = Math.abs(r.line.amount);
        let billId = r.billId;
        if (!billId) {
          const b = await actions.saveBill({ id: uid(), _new: true, vendorId: r.vendorId, date: r.line.date, dueDate: r.line.date, amount: amt,
            ref: r.billRef.trim(), notes: "Recorded from the bank statement: " + r.line.desc, salesOrderId: "", expenseAccount: r.billAccount || "", payments: [] });
          if (!b) { failed++; continue; }
          billId = b.id;
        }
        const payment = { id: uid(), amount: amt, discount: 0, date: r.line.date, method: r.line.checkNo ? "Check" : "ACH / Wire", ref: r.line.checkNo || "", cashAccount: state.account };
        const ok = await actions.recordPayments([{ parentType: "bill", parentId: billId, payment }]);
        if (!ok) { failed++; continue; }
        await actions.setCleared(recon, [{ key: "payment:" + payment.id, date: payment.date, amount: -amt }], true);
        posted++;
      }
      // Customer receipts: onto the invoice it pays, spread over their open
      // invoices oldest first, or a new invoice written for it — then cleared.
      // The rows share a date, method and reference, so the register shows
      // one receipt, as the bank does.
      for (const r of toCustomer) {
        const amt = round2(r.line.amount);
        let alloc;
        if (r.invoiceId === "oldest") alloc = Object.entries(applyOldestFirst(openInvoices(db, r.customerId), amt, balance).amounts);
        else if (r.invoiceId) alloc = [[r.invoiceId, amt]];
        else {
          const inv = await actions.saveInvoice({ id: uid(), number: AUTO_NUMBER, _new: true, kind: "invoice", salesOrderId: "", quoteId: "", customerId: r.customerId,
            poNumber: "", date: r.line.date, dueDate: r.line.date, lineItems: [{ id: uid(), desc: r.invDesc.trim(), qty: 1, unit: "", unitPrice: amt }],
            taxRate: 0, notes: "", incomeAccount: r.invAccount || "", payments: [] });
          if (!inv) { failed++; continue; }
          alloc = [[inv.id, amt]];
        }
        const stamp = { discount: 0, date: r.line.date, method: r.line.checkNo ? "Check" : "ACH / Wire", ref: r.line.checkNo || "", cashAccount: state.account };
        const entries = alloc.map(([id, a]) => ({ parentType: "invoice", parentId: id, payment: { id: uid(), amount: a, ...stamp } }));
        const ok = await actions.recordPayments(entries);
        if (!ok) { failed++; continue; }
        await actions.setCleared(recon, entries.map(e => ({ key: "receipt:" + e.payment.id, date: e.payment.date, amount: e.payment.amount })), true);
        posted++;
      }
      for (const r of toPre) {
        const amt = round2(Math.abs(r.line.amount)), out = r.line.amount < 0, re = String(acct.retainedEarnings || "3910");
        const what = r.line.checkNo ? "Check " + r.line.checkNo : r.line.desc;
        const lines = out
          ? [{ id: uid(), account: state.account, desc: what, debit: "", credit: amt }, { id: uid(), account: re, desc: "Written before Ledger, cleared " + fmtDate(r.line.date), debit: amt, credit: "" }]
          : [{ id: uid(), account: state.account, desc: what, debit: amt, credit: "" }, { id: uid(), account: re, desc: "Deposited before Ledger, cleared " + fmtDate(r.line.date), debit: "", credit: amt }];
        const j = await actions.saveJournalEntry({ id: uid(), _new: true, date: preDate(r.line), ref: r.line.checkNo || "Before Ledger", memo: (out ? "Outstanding at the start: " : "In transit at the start: ") + r.line.desc, lines });
        if (!j) { failed++; continue; }
        await actions.setCleared(recon, [{ key: `journal:${j.id}:0`, date: j.date, amount: out ? -amt : amt }], true);
        posted++;
      }
      // Remember how each line was posted, for next month's statement.
      const learned = { ...rules };
      let changed = false;
      for (const r of [...toPost, ...toVendor, ...toCustomer]) {
        // A check is one payee once, not a recurring line; a key of one word says too little.
        const k = bankKey(r.line.desc); if (!k || r.line.checkNo || !k.includes(" ")) continue;
        const rule = { action: r.action, account: r.action === "post" ? r.account : "", recordAs: r.action === "post" ? r.recordAs : "",
          payee: r.action === "post" ? r.payee : "", vendorId: r.action === "vendor" ? r.vendorId : "", billAccount: r.action === "vendor" ? r.billAccount : "",
          customerId: r.action === "customer" ? r.customerId : "", invAccount: r.action === "customer" ? r.invAccount : "" };
        if (JSON.stringify(learned[k]) !== JSON.stringify(rule)) { learned[k] = rule; changed = true; }
      }
      if (changed) await actions.saveSettings({ ...db.settings, bankRules: learned });
      toast(`${cleared} matched and cleared · ${posted} posted${failed ? " · " + failed + " failed" : ""}`);
      if (!failed) onClose();
    } finally { setBusy(false); }
  };

  const postAccounts = (out) => out ? ["expense", "cos", "equity", "liability", "asset"] : ["income", "equity", "liability", "asset"];
  return <Modal title={"Import Statement — " + fmtDate(recon.statementDate)} onClose={onClose} wide
    foot={<>
      <span className="subtle" style={{ marginRight: "auto" }}>{rows.length ? `${toClear.length} matched · ${toPost.length + toVendor.length + toCustomer.length + toPre.length + toFix.length} to post · ${rows.filter(r => !r.item && r.action === "skip").length} left alone` : ""}</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !canApply} onClick={apply}>{busy ? "Working…" : "Apply"}</button></>}>
    {!parsed ? <>
      <Field label="Statement file" hint="The PDF from the bank, a .csv export, or a .txt">
        <input ref={fileRef} type="file" accept=".pdf,.csv,.txt" className="input" disabled={busy} onChange={e => onFile(e.target.files?.[0])} /></Field>
      <Field label="Or paste the transactions" hint="Rows copied from the statement or online banking — a date, a description and an amount per line">
        <textarea className="input" rows={6} value={pasted} onChange={e => setPasted(e.target.value)} placeholder={"01/05  DEPOSIT  4,500.00\n01/07  CHECK 1042  1,250.00"} /></Field>
      <button className="btn" disabled={!pasted.trim()} onClick={onPaste}>Read Pasted Lines</button>
    </> : <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <span className="subtle">{parsed.lines.length} transaction{parsed.lines.length === 1 ? "" : "s"} read{parsed.period ? ` · ${fmtDate(parsed.period.from)} – ${fmtDate(parsed.period.to)}` : ""}{parsed.skippedLater ? ` · ${parsed.skippedLater} after the statement date skipped` : ""}</span>
        {parsed.endingBalance != null && Math.abs(parsed.endingBalance - recon.statementBalance) > 0.005 &&
          <button className="btn sm" style={{ marginLeft: "auto" }} onClick={async () => { if (await actions.saveReconciliation({ ...recon, statementBalance: parsed.endingBalance })) toast("Statement balance set to " + money(parsed.endingBalance)); }}>
            Use ending balance {money(parsed.endingBalance)}</button>}
        <button className="btn sm" onClick={() => { setParsed(null); setRows([]); }}>Start over</button>
      </div>
      {rows.length === 0 ? <Empty icon={ICONS.clip} title="No transactions found" msg="Nothing on the file read as a dated line with an amount. Try the .csv export from online banking, or paste the rows." />
        : <table className="li-table"><thead><tr><th></th><th>Date</th><th>Statement line</th><th className="num">Amount</th><th>In Ledger</th><th style={{ minWidth: 260 }}>Post to</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.line.id} style={{ opacity: r.take ? 1 : .5 }}>
            <td><input type="checkbox" checked={r.take} onChange={e => setRow(i, { take: e.target.checked })} /></td>
            <td className="subtle" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.line.date)}</td>
            <td>{r.line.desc}{r.line.checkNo && <span className="mono subtle"> · check {r.line.checkNo}</span>}</td>
            <td className="num mono" style={{ color: r.line.amount < 0 ? "var(--neg)" : "var(--pos)", fontWeight: 600 }}>{money(r.line.amount)}</td>
            <td>{r.item
              ? <span><span className="badge green"><span className="dot"></span>Match{r.group ? ` · ${r.group.length} rows` : ""}</span> <span className="subtle">{r.group
                ? r.group.map(g => `${g.party || g.memo} ${money(Math.abs(g.amount))}`).join(" + ") : r.item.memo}{r.item.date !== r.line.date ? " · " + fmtDate(r.item.date) : ""}</span></span>
              : r.near
                ? <span><span className="badge amber"><span className="dot"></span>Close match</span> <span className="subtle">{r.near.party || r.near.memo} · books say <b className="mono">{money(Math.abs(r.near.amount))}</b>{r.near.date !== r.line.date ? " · " + fmtDate(r.near.date) : ""}</span></span>
                : <span className="badge amber"><span className="dot"></span>Not in Ledger</span>}
              {r.remembered && <div className="subtle" style={{ fontSize: 11 }}>filled in from last time</div>}</td>
            <td>{r.item ? <span className="subtle">will be marked cleared</span>
              : <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <select className="select" value={r.action} onChange={e => setRow(i, { action: e.target.value })}>
                  {r.near && <option value="fix">Fix the books — it was {money(Math.abs(r.line.amount))}, not {money(Math.abs(r.near.amount))}</option>}
                  <option value="post">{r.line.amount < 0 ? "Post as money out" : "Post as money in"}</option>
                  {r.line.amount < 0 && <option value="vendor">Vendor bill payment (keeps the vendor's account and 1099)</option>}
                  {r.line.amount > 0 && <option value="customer">Customer receipt (keeps the customer's account)</option>}
                  <option value="pre">{r.line.amount < 0 ? "Written before Ledger — a December check that cleared now" : "Deposited before Ledger — in transit at the start"}</option>
                  <option value="skip">Leave it — I'll enter it myself</option></select>
                {r.action === "fix" && r.near && (() => {
                  const f = r.near.type !== "expense" && findPayment(r.near);
                  const diff = round2(Math.abs(r.line.amount) - Math.abs(r.near.amount));
                  const isBill = r.near.type === "payment";
                  return <>
                    <span className="subtle" style={{ fontSize: 12 }}>Changes the {r.near.type === "expense" ? "expense entry" : isBill ? "payment" : "receipt"}{f ? ` on ${isBill ? (f.doc.ref || f.doc.number) : f.doc.number}` : ""} to the bank's {money(Math.abs(r.line.amount))} and ticks it cleared.</span>
                    {isBill && f && diff > 0 && <label className="subtle" style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12 }}>
                      <input type="checkbox" checked={r.raiseDoc} onChange={e => setRow(i, { raiseDoc: e.target.checked })} style={{ marginTop: 2 }} />
                      <span>The bill was {money(round2((Number(f.doc.amount) || 0) + diff))} too — raise it. Unticked, the extra {money(diff)} stays as a credit with the vendor.</span></label>}
                    {isBill && f && diff < 0 && <label className="subtle" style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12 }}>
                      <input type="checkbox" checked={r.raiseDoc} onChange={e => setRow(i, { raiseDoc: e.target.checked })} style={{ marginTop: 2 }} />
                      <span>The bill was {money(round2((Number(f.doc.amount) || 0) + diff))} too — lower it. Unticked, {money(-diff)} stays owing on the bill.</span></label>}
                  </>;
                })()}
                {r.action === "pre" && <span className="subtle" style={{ fontSize: 12 }}>
                  Books it on {fmtDate(preDate(r.line))} against Retained Earnings — its {r.line.amount < 0 ? "expense" : "income"} is already in last year's books — and ticks it cleared.</span>}
                {r.action === "vendor" && (() => {
                  const open = db.bills.filter(b => b.vendorId === r.vendorId && billBalance(b) > 0.005).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
                  const problem = vendorProblem(r);
                  return <>
                    <select className="select" value={r.vendorId} onChange={e => setRow(i, { vendorId: e.target.value, billId: "" })}>
                      <option value="">— which vendor? —</option>
                      {pickable(vendors, r.vendorId).sort((a, b) => a.name.localeCompare(b.name)).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    {r.vendorId && <select className="select" value={r.billId} onChange={e => setRow(i, { billId: e.target.value })}>
                      <option value="">New bill for {money(Math.abs(r.line.amount))} (it wasn't entered)</option>
                      {open.map(b => <option key={b.id} value={b.id}>Pays {b.number}{b.ref ? " · inv " + b.ref : ""} — {money(billBalance(b))} owed</option>)}
                    </select>}
                    {r.vendorId && !r.billId && <>
                      <input className="input mono" value={r.billRef} placeholder="Vendor's invoice #" onChange={e => setRow(i, { billRef: e.target.value })} />
                      <AccountSelect db={db} value={r.billAccount} onChange={v => setRow(i, { billAccount: v })} groups={["expense", "cos"]} blank="— the vendor's usual expense account —" />
                    </>}
                    {problem ? <span style={{ color: "var(--warn)", fontSize: 12 }}>{problem}</span>
                      : <span className="subtle" style={{ fontSize: 12 }}>{r.billId ? "Records the payment on that bill" : "Writes the bill dated " + fmtDate(r.line.date) + " and pays it"}{r.line.checkNo ? " by check " + r.line.checkNo : ""}, and ticks it cleared.</span>}
                  </>;
                })()}
                {r.action === "customer" && (() => {
                  const open = openInvoices(db, r.customerId);
                  const owed = round2(sum(open, balance));
                  const problem = customerProblem(r);
                  return <>
                    <select className="select" value={r.customerId} onChange={e => setRow(i, { customerId: e.target.value, invoiceId: "" })}>
                      <option value="">— which customer? —</option>
                      {pickable(customers, r.customerId).sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {r.customerId && <select className="select" value={r.invoiceId} onChange={e => setRow(i, { invoiceId: e.target.value })}>
                      <option value="">New invoice for {money(r.line.amount)} (it wasn't entered)</option>
                      {open.length > 0 && <option value="oldest">Their open invoices, oldest first — {money(owed)} owed</option>}
                      {open.map(inv => <option key={inv.id} value={inv.id}>Pays {inv.number} — {money(balance(inv))} owed{r.line.amount < balance(inv) - 0.005 ? " (part payment)" : ""}</option>)}
                    </select>}
                    {r.customerId && !r.invoiceId && <>
                      <input className="input" value={r.invDesc} placeholder="What the invoice was for" onChange={e => setRow(i, { invDesc: e.target.value })} />
                      <AccountSelect db={db} value={r.invAccount} onChange={v => setRow(i, { invAccount: v })} groups={["income"]} blank="— the customer's usual sales account —" />
                    </>}
                    {problem ? <span style={{ color: "var(--warn)", fontSize: 12 }}>{problem}</span>
                      : <span className="subtle" style={{ fontSize: 12 }}>{r.invoiceId === "oldest" ? "Spreads the receipt over their open invoices, oldest first"
                        : r.invoiceId ? "Records the receipt on that invoice" : "Writes the invoice dated " + fmtDate(r.line.date) + " and receives it"}{r.line.checkNo ? " (check " + r.line.checkNo + ")" : ""}, and ticks it cleared.</span>}
                  </>;
                })()}
                {r.action === "post" && <>
                  <AccountSelect db={db} value={r.account} onChange={v => setRow(i, { account: v, recordAs: (r.line.amount < 0 && ["expense", "cos"].includes(TYPE_GROUP[accountByNumber(db, v)?.type])) ? "expense" : "journal" })}
                    groups={postAccounts(r.line.amount < 0)} blank={r.line.amount < 0 ? "— what was it? (Distributions, Office Supplies, a loan…) —" : "— what was it? (Other Income, Interest, a loan…) —"} />
                  {r.cardPay && String(r.account) === String(r.cardPay.card.account) && <span className="subtle" style={{ fontSize: 12 }}>
                    💳 Pays the {r.cardPay.card.name}{r.cardPay.stmt ? <> — statement {fmtDate(r.cardPay.stmt.closingDate)}: business <span className="mono">{money(r.cardPay.stmt.businessTotal)}</span> (already expensed) + personal <span className="mono">{money(r.cardPay.stmt.personalTotal)}</span> (already owner draws)</> : <> — no statement posted for it yet; import it under System → Credit Cards</>}</span>}
                  {r.line.amount < 0 && <input className="input" value={r.payee} placeholder="Payee" onChange={e => setRow(i, { payee: e.target.value })} />}
                  {r.line.amount < 0 && r.account && <label className="subtle" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                    <input type="checkbox" checked={r.recordAs === "expense"} onChange={e => setRow(i, { recordAs: e.target.checked ? "expense" : "journal" })} />Record as an expense entry (shows under Expenses); unticked, a journal entry</label>}
                </>}
              </div>}</td>
          </tr>)}</tbody></table>}
      <p className="subtle" style={{ margin: "10px 0 0" }}>A match is the same amount on the same side within ten days, or the same check number. Lines the books don't have are posted from {accountLabel(db, state.account)} to the account you pick and ticked as cleared. Money from a customer or to a vendor is best recorded as their receipt or bill payment, so their account stays right — a journal entry only puts the ledger right.</p>
    </>}
  </Modal>;
}

// "CHECK 1042", "ACH DEBIT ACME SUPPLY CO 0112" → "Acme Supply Co"
function guessPayee(desc) {
  const s = String(desc || "").replace(/\b(ach|debit|credit|pos|purchase|card|check|chk|payment|pmt|online|transfer|withdrawal|deposit|electronic|web|id|des|ref|ppd|ccd|epay|bill\s*pay)\b/gi, " ")
    .replace(/[#*]?\d[\d\/-]*/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "";
}
