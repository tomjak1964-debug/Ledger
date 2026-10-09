import { useState, useRef } from "react";
import { uid, todayISO, isoDate, money, fmtDate, sum } from "../lib/helpers.js";
import { round2 } from "../calc/ledger.js";
import { accountSettings, accountLabel, TYPE_GROUP, accountByNumber } from "../calc/accounts.js";
import { reconcileState, matchStatement } from "../calc/bankRecon.js";
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
  const create = async () => {
    const saved = await actions.saveReconciliation(newRec);
    if (saved) { setNewRec(null); setOpenId(saved.id); }
  };
  const del = async r => {
    if (!confirm(`Delete the ${fmtDate(r.statementDate)} reconciliation? Everything it marked cleared goes back to outstanding.`)) return;
    if (await actions.deleteReconciliation(r.id)) { if (openId === r.id) setOpenId(null); toast("Reconciliation deleted"); }
  };

  if (open) return <ReconcileScreen db={db} actions={actions} toast={toast} readOnly={readOnly} recon={open} onBack={() => setOpenId(null)} />;

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
        <button className="btn primary" disabled={!newRec.account || !newRec.statementDate || newRec.statementBalance === ""} onClick={create}>Start Reconciling</button></>}>
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
export function ReconcileScreen({ db, actions, toast, readOnly, recon, onBack }) {
  const s = reconcileState(db, recon);
  const done = recon.status === "done";
  const locked = readOnly || done;
  const [importing, setImporting] = useState(false);
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
    {importing && <ImportStatementModal db={db} actions={actions} toast={toast} recon={recon} state={s} onClose={() => setImporting(false)} />}
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
export function ImportStatementModal({ db, actions, toast, recon, state, onClose }) {
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
  const load = (p) => {
    const inRange = p.lines.filter(l => l.date <= recon.statementDate);
    const matched = matchStatement(inRange, state.items);
    setParsed({ ...p, skippedLater: p.lines.length - inRange.length });
    setRows(matched.map(m => {
      const cp = !m.item && cardPaid(m.line);
      return { ...m, take: true, action: m.item ? "clear" : "post", account: cp ? String(cp.card.account) : m.line.amount < 0 ? "" : "4300",
        payee: cp ? cp.card.name : guessPayee(m.line.desc), recordAs: cp ? "journal" : m.line.amount < 0 ? "expense" : "journal", cardPay: cp || null };
    }));
  };
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
  const toPost = rows.filter(r => r.take && !r.item && r.action === "post");
  const canApply = rows.length > 0 && toPost.every(r => r.account);
  const apply = async () => {
    setBusy(true);
    try {
      let cleared = 0, posted = 0, failed = 0;
      if (toClear.length && await actions.setCleared(recon, toClear.map(r => r.item), true)) cleared = toClear.length;
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
      toast(`${cleared} matched and cleared · ${posted} posted${failed ? " · " + failed + " failed" : ""}`);
      if (!failed) onClose();
    } finally { setBusy(false); }
  };

  const postAccounts = (out) => out ? ["expense", "cos", "equity", "liability", "asset"] : ["income", "equity", "liability", "asset"];
  return <Modal title={"Import Statement — " + fmtDate(recon.statementDate)} onClose={onClose} wide
    foot={<>
      <span className="subtle" style={{ marginRight: "auto" }}>{rows.length ? `${toClear.length} matched · ${toPost.length} to post · ${rows.filter(r => !r.item && r.action !== "post").length} left alone` : ""}</span>
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
              ? <span><span className="badge green"><span className="dot"></span>Match</span> <span className="subtle">{r.item.memo}{r.item.date !== r.line.date ? " · " + fmtDate(r.item.date) : ""}</span></span>
              : <span className="badge amber"><span className="dot"></span>Not in Ledger</span>}</td>
            <td>{r.item ? <span className="subtle">will be marked cleared</span>
              : <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <select className="select" value={r.action} onChange={e => setRow(i, { action: e.target.value })}>
                  <option value="post">{r.line.amount < 0 ? "Post as money out" : "Post as money in"}</option><option value="skip">Leave it — I'll enter it myself</option></select>
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
      <p className="subtle" style={{ margin: "10px 0 0" }}>A match is the same amount on the same side within ten days, or the same check number. Lines the books don't have are posted from {accountLabel(db, state.account)} to the account you pick and ticked as cleared; a customer receipt the bank has but the books don't should be recorded under Receivables instead, so leave it.</p>
    </>}
  </Modal>;
}

// "CHECK 1042", "ACH DEBIT ACME SUPPLY CO 0112" → "Acme Supply Co"
function guessPayee(desc) {
  const s = String(desc || "").replace(/\b(ach|debit|credit|pos|purchase|card|check|chk|payment|pmt|online|transfer|withdrawal|deposit|electronic|web|id|des|ref|ppd|ccd|epay|bill\s*pay)\b/gi, " ")
    .replace(/[#*]?\d[\d\/-]*/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "";
}
