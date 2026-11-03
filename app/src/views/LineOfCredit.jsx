import { useState, useMemo, useRef } from "react";
import { uid, money, fmtDate } from "../lib/helpers.js";
import { round2 } from "../calc/ledger.js";
import { accountSettings, accountLabel } from "../calc/accounts.js";
import { journal } from "../calc/gl.js";
import { readLoanFile, readLoanPaste, parseLoanText, loanCheck, loanTotals, planLoanStatement, loanOf, LOAN_KINDS } from "../lib/loanStatement.js";
import AccountSelect from "../components/AccountSelect.jsx";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort } from "../components/ui.jsx";

// System → Line of Credit. The bank adds each month's interest (and any fee)
// to what is owed on the line, and the payment comes out of checking. Import
// the statement each month and post it: interest and fees go to their expense
// accounts against the line, and each payment and draw gets an entry of its
// own between the line and checking — or is linked to the one already on the
// books — so the bank reconciliation pairs it with its bank line. What the line
// owes, per the books, is its account's balance; it should equal the statement.
export default function LineOfCreditView({ db, actions, toast, readOnly }) {
  const acct = accountSettings(db.settings);
  const loans = acct.loans || [];
  const [setup, setSetup] = useState(false);
  const [importing, setImporting] = useState(null);
  const [view, setView] = useState(null);

  const owed = useMemo(() => {
    const m = {};
    journal(db).forEach(e => e.lines.forEach(l => { if (loans.some(c => String(c.account) === String(l.account))) m[l.account] = round2((m[l.account] || 0) + (l.credit || 0) - (l.debit || 0)); }));
    return m;
  }, [db, loans]);
  const statements = db.loanStatements || [];
  const { sorted, sort, onSort } = useTableSort(statements, {
    loan: s => s.loanName, closing: s => s.closingDate, prev: s => s.previousBalance ?? -Infinity,
    pay: s => -loanTotals(s.lines).payment, adv: s => loanTotals(s.lines).advance, int: s => loanTotals(s.lines).interest + loanTotals(s.lines).fee,
    bal: s => s.newBalance ?? -Infinity,
  }, { key: "closing", dir: "desc" });
  const unpost = async (s) => {
    const made = new Set([...(s.lines || []).filter(l => l.entryId && !l.linked).map(l => l.entryId), s.chargesEntryId].filter(Boolean)).size;
    if (!confirm(`Unpost the ${s.loanName} statement closing ${fmtDate(s.closingDate)}? The ${made} journal entr${made === 1 ? "y" : "ies"} it wrote are deleted (any it linked to stay), and it can be imported again.`)) return;
    if (await actions.deleteLoanStatement(s)) { toast("Statement unposted"); setView(null); }
  };

  return <div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Lines of Credit</h3>
        {!readOnly && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setSetup(true)}><Ico d={ICONS.settings} size={14} />Set Up</button>}</div>
      {loans.length === 0
        ? <Empty icon={ICONS.money} title="No line of credit set up yet" msg="Set Up names the line, its liability account, the bank account it's paid from, and where interest and fees post." />
        : <table><thead><tr><th>Line of credit</th><th>Account</th><th>Last statement</th><th className="num">Statement balance</th><th className="num">Owed per Ledger</th><th></th></tr></thead>
          <tbody>{loans.map(c => {
            const last = statements.filter(s => s.loanAccount === String(c.account)).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
            const books = owed[c.account] || 0;
            return <tr key={c.id}>
              <td style={{ fontWeight: 600 }}>{c.name}</td>
              <td className="subtle">{accountLabel(db, c.account)}</td>
              <td className="subtle">{last ? fmtDate(last.closingDate) : "—"}</td>
              <td className="num mono">{last?.newBalance == null ? "—" : money(last.newBalance)}</td>
              <td className="num mono">{money(books)}</td>
              <td style={{ textAlign: "right" }}>{!readOnly && <button className="btn sm primary" onClick={() => setImporting(String(c.account))}><Ico d={ICONS.plus} size={14} />Import Statement</button>}</td>
            </tr>;
          })}</tbody></table>}
      {loans.length > 0 && <p className="subtle" style={{ margin: "10px 16px 14px" }}>
        Owed per Ledger counts everything on the account to date; once the latest statement is posted and nothing has moved since, it equals the statement balance.</p>}
    </div>

    <div className="card">
      <div className="card-head"><h3>Posted Statements</h3></div>
      {statements.length === 0
        ? <Empty icon={ICONS.reports} title="No statements posted" msg="Import a statement PDF and post it — the draws, payments, interest and fees go on the books." />
        : <table><thead><tr>
          <SortTh label="Line of Credit" col="loan" sort={sort} onSort={onSort} />
          <SortTh label="Closing Date" col="closing" sort={sort} onSort={onSort} />
          <SortTh label="Previous Balance" col="prev" sort={sort} onSort={onSort} num />
          <SortTh label="Advances" col="adv" sort={sort} onSort={onSort} num />
          <SortTh label="Payments" col="pay" sort={sort} onSort={onSort} num />
          <SortTh label="Interest & Fees" col="int" sort={sort} onSort={onSort} num />
          <SortTh label="New Balance" col="bal" sort={sort} onSort={onSort} num />
          <th></th></tr></thead>
          <tbody>{sorted.map(s => { const t = loanTotals(s.lines); return <tr key={s.id} className="clickable" onClick={() => setView(s)}>
            <td style={{ fontWeight: 600 }}>{s.loanName}</td>
            <td>{fmtDate(s.closingDate)}</td>
            <td className="num mono">{s.previousBalance == null ? "—" : money(s.previousBalance)}</td>
            <td className="num mono">{t.advance ? money(t.advance) : "—"}</td>
            <td className="num mono">{t.payment ? money(-t.payment) : "—"}</td>
            <td className="num mono">{money(round2(t.interest + t.fee + t.credit))}</td>
            <td className="num mono">{s.newBalance == null ? "—" : money(s.newBalance)}</td>
            <td style={{ textAlign: "right" }}>{!readOnly && <button className="btn ghost icon" title="Unpost" onClick={e => { e.stopPropagation(); unpost(s); }}><Ico d={ICONS.trash} size={14} /></button>}</td>
          </tr>; })}</tbody></table>}
      <p className="subtle" style={{ margin: "10px 16px 14px" }}>
        In Bank Reconciliation each payment and draw matches its bank line by amount and date, already on the books — tick it and it clears.</p>
    </div>

    {setup && <LoanSetup db={db} actions={actions} toast={toast} onClose={() => setSetup(false)} />}
    {importing && <ImportLoanStatement db={db} actions={actions} toast={toast} loanAccount={importing} onClose={() => setImporting(null)} />}
    {view && <Modal wide title={`${view.loanName} · statement closing ${fmtDate(view.closingDate)}`} onClose={() => setView(null)}
      foot={<>{!readOnly && <button className="btn" style={{ marginRight: "auto", color: "var(--neg)" }} onClick={() => unpost(view)}>Unpost Statement</button>}
        <button className="btn primary" onClick={() => setView(null)}>Close</button></>}>
      <LinesTable db={db} lines={view.lines} entryNumber={id => (db.journalEntries || []).find(j => j.id === id)?.number} />
    </Modal>}
  </div>;
}

function LinesTable({ db, lines, entryNumber, plan }) {
  const rows = [...lines].sort((a, b) => a.date.localeCompare(b.date));
  return <table className="li-table"><thead><tr><th style={{ width: 100 }}>Date</th><th>Description</th><th style={{ width: 90 }}>Type</th><th className="num" style={{ width: 120 }}>Amount</th><th>On the books</th></tr></thead>
    <tbody>{rows.map(l => {
      const p = plan && plan.cash.find(c => c.line.id === l.id);
      const num = l.entryId && entryNumber ? entryNumber(l.entryId) : "";
      return <tr key={l.id}>
        <td className="subtle nowrap">{fmtDate(l.date)}</td>
        <td>{l.desc}</td>
        <td>{LOAN_KINDS[l.kind] || l.kind}</td>
        <td className="num mono">{money(l.amount)}</td>
        <td className="subtle" style={{ fontSize: 12.5 }}>{plan
          ? (p ? (p.existing ? <span style={{ color: "var(--pos)" }}>Already on the books — {p.existing.number}, linked</span> : "New entry · " + (l.kind === "payment" ? "Dr line / Cr bank" : "Dr bank / Cr line"))
            : "In the interest & fees entry")
          : (num ? `${num}${l.linked ? " (linked)" : ""}` : "—")}</td>
      </tr>;
    })}</tbody></table>;
}

function LoanSetup({ db, actions, toast, onClose }) {
  const acct = accountSettings(db.settings);
  const blank = () => ({ id: uid(), name: "", account: (db.accounts || []).find(a => /line of credit/i.test(a.name))?.number || "2600", cashAccount: acct.cash || "1020", interestAccount: "7150", feeAccount: "6850", match: "" });
  const [loans, setLoans] = useState(() => (acct.loans || []).length ? acct.loans.map(l => loanOf(l)) : [blank()]);
  const [saving, setSaving] = useState(false);
  const set = (i, patch) => setLoans(ls => ls.map((c, j) => j === i ? { ...c, ...patch } : c));
  const save = async () => {
    const clean = loans.map(c => ({ ...c, name: (c.name || "").trim(), account: String(c.account || "").trim(), match: (c.match || "").trim() })).filter(c => c.name || c.account);
    if (clean.some(c => !c.name || !c.account)) { toast("Each line of credit needs a name and an account."); return; }
    if (new Set(clean.map(c => c.account)).size !== clean.length) { toast("Two lines of credit can't share an account."); return; }
    setSaving(true);
    const have = new Set((db.accounts || []).map(a => String(a.number)));
    const add = clean.filter(c => !have.has(c.account)).map(c => ({ number: c.account, name: c.name, type: "Other Current Liabilities", active: true }));
    if (add.length && !(await actions.seedAccounts(add))) { setSaving(false); return; }
    const ok = await actions.saveSettings({ ...db.settings, accounts: { ...(db.settings.accounts || {}), loans: clean } });
    setSaving(false);
    if (ok) { toast("Line of credit saved"); onClose(); }
  };
  return <Modal wide title="Set Up Lines of Credit" onClose={onClose} foot={<><button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save"}</button></>}>
    {loans.map((c, i) => <div key={c.id} style={{ marginBottom: 12 }}>
      <div className="row">
        <Field label="Name"><input className="input" value={c.name} placeholder="PNC Line of Credit" onChange={e => set(i, { name: e.target.value })} /></Field>
        <Field label="Liability account" hint="What's owed on the line"><AccountSelect db={db} value={c.account} onChange={v => set(i, { account: v })} groups={["liability"]} blank="— choose —" /></Field>
        <Field label="Paid from" hint="The bank account draws land in and payments leave"><AccountSelect db={db} value={c.cashAccount} onChange={v => set(i, { cashAccount: v })} groups={["asset"]} blank="— choose —" /></Field>
      </div>
      <div className="row">
        <Field label="Interest posts to"><AccountSelect db={db} value={c.interestAccount} onChange={v => set(i, { interestAccount: v })} groups={["expense"]} blank="— choose —" /></Field>
        <Field label="Fees post to" hint="Annual fee, late charges"><AccountSelect db={db} value={c.feeAccount} onChange={v => set(i, { feeAccount: v })} groups={["expense"]} blank="— choose —" /></Field>
        <Field label="Bank statement words" hint="How its payments read on the bank statement, e.g. the last 4 of the account"><input className="input mono" value={c.match || ""} placeholder="2775" onChange={e => set(i, { match: e.target.value })} /></Field>
      </div>
      {loans.length > 1 && <button className="btn sm" onClick={() => setLoans(ls => ls.filter((_, j) => j !== i))}><Ico d={ICONS.x} size={14} />Remove</button>}
      <div className="divider"></div>
    </div>)}
    <button className="btn sm" onClick={() => setLoans(ls => [...ls, blank()])}><Ico d={ICONS.plus} size={14} />Add Another</button>
  </Modal>;
}

function ImportLoanStatement({ db, actions, toast, loanAccount, onClose }) {
  const acct = accountSettings(db.settings);
  const loan = loanOf((acct.loans || []).find(c => String(c.account) === loanAccount));
  const [st, setSt] = useState(null);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const load = (lines) => {
    try {
      const p = parseLoanText(lines);
      if (!p.lines.length) throw new Error("No transactions found — check it's the line of credit statement, or paste the transaction rows.");
      setErr(""); setSt({ id: uid(), loanAccount, ...p });
    } catch (e) { setErr(e.message || String(e)); }
  };
  const onFile = async (f) => { if (f) { setBusy(true); try { load(await readLoanFile(f)); } catch (e) { setErr(e.message || String(e)); } setBusy(false); } };
  const check = st ? loanCheck(st) : null;
  const plan = useMemo(() => (st ? planLoanStatement(db, loan, st) : null), [st, db]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dup = st && (db.loanStatements || []).some(x => x.loanAccount === loanAccount && x.closingDate === st.closingDate);
  // The books before this statement should owe what it starts from.
  const booksBefore = useMemo(() => {
    if (!st?.periodFrom) return null;
    let b = 0;
    journal(db).forEach(e => { if (e.date < st.periodFrom) e.lines.forEach(l => { if (String(l.account) === loan.account) b += (l.credit || 0) - (l.debit || 0); }); });
    return round2(b);
  }, [st, db]);   // eslint-disable-line react-hooks/exhaustive-deps
  const post = async () => {
    setBusy(true);
    const out = await actions.postLoanStatement(st);
    setBusy(false);
    if (out) { toast(`${loan.name} statement ${fmtDate(st.closingDate)} posted`); onClose(); }
  };
  const t = st ? loanTotals(st.lines) : null;
  return <Modal wide title={`Import Statement · ${loan.name}`} onClose={onClose}
    foot={st && <>
      <span className="subtle" style={{ marginRight: "auto" }}>{plan.cash.filter(c => !c.existing).length + (plan.chargesEntry ? 1 : 0)} new entries · {plan.cash.filter(c => c.existing).length} linked</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !st.closingDate || dup} onClick={post}><Ico d={ICONS.check} size={15} />{busy ? "Posting…" : "Post Statement"}</button>
    </>}>
    {!st ? <>
      <p className="subtle" style={{ marginTop: 0 }}>Choose the statement <b>PDF</b> from the bank, or paste its transaction rows.</p>
      <input ref={fileRef} type="file" accept=".pdf,.txt" style={{ display: "none" }} onChange={e => onFile(e.target.files[0])} />
      <button className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}><Ico d={ICONS.plus} size={15} />{busy ? "Reading…" : "Choose Statement File"}</button>
      <div className="divider"></div>
      <Field label="Or paste the statement text"><textarea className="input" rows={6} value={paste} onChange={e => setPaste(e.target.value)}
        placeholder={"Previous Balance $19,985.22 New Balance $20,020.58\n04/02/26 04/02/26 PAYMENT REC'D - THANK YOU -299.77\n04/07/26 04/07/26 INTEREST CHARGE $160.13"} /></Field>
      <button className="btn" disabled={!paste.trim()} onClick={() => load(readLoanPaste(paste))}>Read Pasted Text</button>
      {err && <p style={{ color: "var(--neg)" }}>{err}</p>}
    </> : <>
      <div className="row">
        <Field label="Closing date"><input className="input" type="date" value={st.closingDate} onChange={e => setSt({ ...st, closingDate: e.target.value })} /></Field>
        <Field label="Previous balance"><input className="input mono" type="number" step="0.01" value={st.previousBalance ?? ""} onChange={e => setSt({ ...st, previousBalance: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <Field label="New balance"><input className="input mono" type="number" step="0.01" value={st.newBalance ?? ""} onChange={e => setSt({ ...st, newBalance: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      </div>
      {dup && <p style={{ color: "var(--neg)", marginTop: 0 }}>This statement has already been posted.</p>}
      {st.accountTail && loan.match && !loan.match.includes(st.accountTail) && <p style={{ color: "var(--warn)", marginTop: 0 }}>This statement is for account …{st.accountTail} — check it's the {loan.name}.</p>}
      {check != null && (Math.abs(check) < 0.01
        ? <p style={{ color: "var(--pos)", marginTop: 0 }}>✓ Previous balance plus every line read equals the new balance — nothing was missed.</p>
        : <p style={{ color: "var(--neg)", marginTop: 0 }}>Previous balance plus the lines read is off the new balance by {money(check)} — check against the statement before posting.</p>)}
      {booksBefore != null && st.previousBalance != null && Math.abs(booksBefore - st.previousBalance) > 0.005 &&
        <p style={{ color: "var(--warn)", marginTop: 0 }}>Ledger shows {money(booksBefore)} owed on {accountLabel(db, loan.account)} before {fmtDate(st.periodFrom)}; the statement starts from {money(st.previousBalance)}.
          An earlier statement may not be posted yet, or a payment was booked to another account.</p>}
      <LinesTable db={db} lines={st.lines} plan={plan} />
      <p className="subtle" style={{ marginBottom: 0 }}>
        Advances <b className="mono">{money(t.advance)}</b> · Payments <b className="mono">{money(-t.payment)}</b> · Interest <b className="mono">{money(t.interest)}</b> to {accountLabel(db, loan.interestAccount)}
        {t.fee ? <> · Fees <b className="mono">{money(t.fee)}</b> to {accountLabel(db, loan.feeAccount)}</> : null}.
        Each payment and draw gets its own entry against {accountLabel(db, loan.cashAccount)}, dated as the bank did it, so it matches its bank line; interest and fees are one entry on the closing date. Unpost the statement to undo it.</p>
    </>}
  </Modal>;
}
