import { useState, useMemo, useRef } from "react";
import { uid, money, fmtDate, sum } from "../lib/helpers.js";
import { round2 } from "../calc/ledger.js";
import { accountSettings, accountLabel } from "../calc/accounts.js";
import { journal } from "../calc/gl.js";
import { readCardFile, readCardPaste, parseCardStatement, learnedChoices, suggest, statementTotals } from "../lib/cardStatement.js";
import AccountSelect from "../components/AccountSelect.jsx";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort } from "../components/ui.jsx";

// System → Credit Cards. The shop's cards carry business and personal charges
// and are paid from checking. Each month: import a card's statement, mark
// each charge Business (with its expense account) or Personal, and post —
// business charges become expenses paid from the card, the personal ones one
// owner-draw entry. The payment then reconciles on the bank side against the
// card's account. What the card owes, per the books, is the card account's
// balance.
export default function CreditCardsView({ db, actions, toast, readOnly }) {
  const acct = accountSettings(db.settings);
  const cards = acct.cards || [];
  const [editCards, setEditCards] = useState(false);
  const [importing, setImporting] = useState(null);   // card account to import for
  const [view, setView] = useState(null);             // a posted statement opened

  // Owed per the books: credits less debits on each card's account.
  const owed = useMemo(() => {
    const m = {};
    journal(db).forEach(e => e.lines.forEach(l => { if (cards.some(c => String(c.account) === String(l.account))) m[l.account] = round2((m[l.account] || 0) + (l.credit || 0) - (l.debit || 0)); }));
    return m;
  }, [db, cards]);

  const statements = db.cardStatements || [];
  const { sorted, sort, onSort } = useTableSort(statements, {
    card: s => s.cardName, closing: s => s.closingDate, business: s => s.businessTotal, personal: s => s.personalTotal,
    balance: s => (s.newBalance == null ? -Infinity : s.newBalance), lines: s => (s.lines || []).length,
  }, { key: "closing", dir: "desc" });
  const unpost = async (s) => {
    if (!confirm(`Unpost the ${s.cardName} statement closing ${fmtDate(s.closingDate)}? Its ${(s.lines || []).filter(l => l.expenseId).length} expenses and its owner-draw entry are deleted, and it can be imported again.`)) return;
    if (await actions.deleteCardStatement(s)) { toast("Statement unposted"); setView(null); }
  };

  return <div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Cards</h3>
        {!readOnly && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setEditCards(true)}><Ico d={ICONS.settings} size={14} />Set Up Cards</button>}</div>
      {cards.length === 0
        ? <Empty icon={ICONS.money} title="No cards set up yet" msg="Add each company card with the liability account its charges post to — Set Up Cards does both." />
        : <table><thead><tr><th>Card</th><th>Account</th><th>Last statement</th><th className="num">Owed per Ledger</th><th></th></tr></thead>
          <tbody>{cards.map(c => {
            const last = statements.filter(s => s.cardAccount === String(c.account)).sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
            return <tr key={c.id}>
              <td style={{ fontWeight: 600 }}>{c.name}</td>
              <td className="subtle">{accountLabel(db, c.account)}</td>
              <td className="subtle">{last ? fmtDate(last.closingDate) : "—"}</td>
              <td className="num mono">{money(owed[c.account] || 0)}</td>
              <td style={{ textAlign: "right" }}>{!readOnly && <button className="btn sm primary" onClick={() => setImporting(String(c.account))}><Ico d={ICONS.plus} size={14} />Import Statement</button>}</td>
            </tr>;
          })}</tbody></table>}
    </div>

    <div className="card">
      <div className="card-head"><h3>Posted Statements</h3></div>
      {statements.length === 0
        ? <Empty icon={ICONS.reports} title="No statements posted" msg="Import a statement, mark each charge business or personal, and post it." />
        : <table><thead><tr>
          <SortTh label="Card" col="card" sort={sort} onSort={onSort} />
          <SortTh label="Closing Date" col="closing" sort={sort} onSort={onSort} />
          <SortTh label="Lines" col="lines" sort={sort} onSort={onSort} num />
          <SortTh label="Business" col="business" sort={sort} onSort={onSort} num />
          <SortTh label="Personal (draws)" col="personal" sort={sort} onSort={onSort} num />
          <SortTh label="Statement Balance" col="balance" sort={sort} onSort={onSort} num />
          <th></th></tr></thead>
          <tbody>{sorted.map(s => <tr key={s.id} className="clickable" onClick={() => setView(s)}>
            <td style={{ fontWeight: 600 }}>{s.cardName}</td>
            <td>{fmtDate(s.closingDate)}</td>
            <td className="num mono">{(s.lines || []).length}</td>
            <td className="num mono">{money(s.businessTotal)}</td>
            <td className="num mono">{money(s.personalTotal)}</td>
            <td className="num mono">{s.newBalance == null ? "—" : money(s.newBalance)}</td>
            <td style={{ textAlign: "right" }}>{!readOnly && <button className="btn ghost icon" title="Unpost" onClick={e => { e.stopPropagation(); unpost(s); }}><Ico d={ICONS.trash} size={14} /></button>}</td>
          </tr>)}</tbody></table>}
      <p className="subtle" style={{ margin: "10px 16px 14px" }}>
        When the card is paid from checking, reconcile that bank line to the card's account (System → Bank Reconciliation): it pays down what the card owes,
        and the business expenses and the personal draws are already on the books.</p>
    </div>

    {editCards && <CardSetup db={db} actions={actions} toast={toast} onClose={() => setEditCards(false)} />}
    {importing && <ImportStatement db={db} actions={actions} toast={toast} cardAccount={importing} onClose={() => setImporting(null)} />}
    {view && <Modal wide title={`${view.cardName} · statement closing ${fmtDate(view.closingDate)}`} onClose={() => setView(null)}
      foot={<>{!readOnly && <button className="btn" style={{ marginRight: "auto", color: "var(--neg)" }} onClick={() => unpost(view)}>Unpost Statement</button>}
        <button className="btn primary" onClick={() => setView(null)}>Close</button></>}>
      <table><thead><tr><th>Date</th><th>Description</th><th>Treated as</th><th>Account</th><th className="num">Amount</th></tr></thead>
        <tbody>{(view.lines || []).map(l => <tr key={l.id}>
          <td className="subtle">{fmtDate(l.date)}</td><td>{l.desc}</td>
          <td>{l.kind === "payment" ? <span className="subtle">Payment</span> : l.use === "business" ? "Business" : l.use === "personal" ? "Personal" : "—"}</td>
          <td className="subtle">{l.use === "business" ? accountLabel(db, l.account) : ""}</td>
          <td className="num mono">{money(l.amount)}</td></tr>)}</tbody></table>
    </Modal>}
  </div>;
}

// The cards: a name, the liability account they post to (added to the chart
// if it isn't there), and the words that name the card on a bank statement.
function CardSetup({ db, actions, toast, onClose }) {
  const acct = accountSettings(db.settings);
  const [cards, setCards] = useState(() => (acct.cards || []).map(c => ({ ...c })));
  const [draws, setDraws] = useState(acct.draws || "3940");
  const [saving, setSaving] = useState(false);
  const nextNumber = () => { let n = 2150; const used = new Set([...(db.accounts || []).map(a => String(a.number)), ...cards.map(c => String(c.account))]); while (used.has(String(n))) n += 10; return String(n); };
  const set = (i, patch) => setCards(cs => cs.map((c, j) => j === i ? { ...c, ...patch } : c));
  const save = async () => {
    const clean = cards.map(c => ({ ...c, name: (c.name || "").trim(), account: String(c.account || "").trim(), match: (c.match || "").trim() })).filter(c => c.name || c.account);
    if (clean.some(c => !c.name || !c.account)) { toast("Each card needs a name and an account number."); return; }
    if (new Set(clean.map(c => c.account)).size !== clean.length) { toast("Two cards can't share an account."); return; }
    setSaving(true);
    const have = new Set((db.accounts || []).map(a => String(a.number)));
    const add = clean.filter(c => !have.has(c.account)).map(c => ({ number: c.account, name: c.name, type: "Other Current Liabilities", active: true }));
    if (add.length && !(await actions.seedAccounts(add))) { setSaving(false); return; }
    const ok = await actions.saveSettings({ ...db.settings, accounts: { ...(db.settings.accounts || {}), cards: clean, draws } });
    setSaving(false);
    if (ok) { toast(add.length ? `Cards saved — ${add.map(a => a.number).join(", ")} added to the chart` : "Cards saved"); onClose(); }
  };
  return <Modal wide title="Set Up Cards" onClose={onClose} foot={<><button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn primary" disabled={saving} onClick={save}><Ico d={ICONS.check} size={15} />{saving ? "Saving…" : "Save Cards"}</button></>}>
    <p className="subtle" style={{ marginTop: 0 }}>Each card's charges post to a liability account of its own — a new number is added to the chart as an Other Current
      Liability. <b>Bank statement words</b> are how the card's payment reads on the bank statement (e.g. <span className="mono">CITI AUTOPAY</span>, <span className="mono">AMEX EPAYMENT</span>), so the bank reconciliation can suggest it.</p>
    <table className="li-table"><thead><tr><th>Card name</th><th style={{ width: 130 }}>Account #</th><th>Bank statement words</th><th style={{ width: 40 }}></th></tr></thead>
      <tbody>{cards.map((c, i) => <tr key={c.id}>
        <td><input className="input" value={c.name} placeholder="Costco Citi Card" onChange={e => set(i, { name: e.target.value })} /></td>
        <td><input className="input mono" value={c.account} onChange={e => set(i, { account: e.target.value })} /></td>
        <td><input className="input mono" value={c.match || ""} placeholder="CITI, AMEX…" onChange={e => set(i, { match: e.target.value })} /></td>
        <td><button className="btn ghost icon" title="Remove" onClick={() => setCards(cs => cs.filter((_, j) => j !== i))}><Ico d={ICONS.x} size={14} /></button></td>
      </tr>)}</tbody></table>
    <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setCards(cs => [...cs, { id: uid(), name: "", account: nextNumber(), match: "" }])}><Ico d={ICONS.plus} size={14} />Add Card</button>
    <div className="divider"></div>
    <Field label="Owner draws account" hint="Where personal charges post — Distributions closes to Retained Earnings at year-end">
      <AccountSelect db={db} value={draws} onChange={setDraws} groups={["equity"]} blank="— choose —" /></Field>
  </Modal>;
}

// Import → review → post, for one card.
function ImportStatement({ db, actions, toast, cardAccount, onClose }) {
  const acct = accountSettings(db.settings);
  const card = (acct.cards || []).find(c => String(c.account) === cardAccount);
  const prior = (db.cardStatements || []).filter(s => s.cardAccount === cardAccount);
  const learned = useMemo(() => learnedChoices(db.cardStatements || []), [db.cardStatements]);
  const [st, setSt] = useState(null);       // parsed statement under review
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [carry, setCarry] = useState(true);  // first statement: carry its previous balance
  const fileRef = useRef();

  const load = (src) => {
    try {
      const p = parseCardStatement(src);
      if (!p.lines.length) throw new Error("No transactions found. Try the card's .csv download, or paste the transaction rows.");
      setErr(""); setSt({ id: uid(), cardAccount, ...p, lines: suggest(p.lines, learned) });
    } catch (e) { setErr(e.message || String(e)); }
  };
  const onFile = async (f) => { if (f) load(await readCardFile(f)); };
  const setLine = (id, patch) => setSt(s => ({ ...s, lines: s.lines.map(l => l.id === id ? { ...l, ...patch } : l) }));
  const setAllUndecided = (use) => setSt(s => ({ ...s, lines: s.lines.map(l => (l.kind !== "payment" && !l.use ? { ...l, use } : l)) }));

  const t = st ? statementTotals(st.lines) : null;
  const first = prior.length === 0;
  const openingAmt = st && first && st.previousBalance ? Number(st.previousBalance) : 0;
  // A check on the reading: previous balance + every line = new balance.
  const check = st && st.previousBalance != null && st.newBalance != null
    ? round2(Number(st.previousBalance) + sum(st.lines, l => Number(l.amount)) - Number(st.newBalance)) : null;
  const sorted = st ? [...st.lines].sort((a, b) => a.date.localeCompare(b.date)) : [];

  const post = async () => {
    setBusy(true);
    const out = await actions.postCardStatement(st, { opening: first && carry && Math.abs(openingAmt) > 0.005 ? { amount: openingAmt, date: "2025-12-31" } : null });
    setBusy(false);
    if (out) { toast(`${card.name} statement posted — ${money(out.businessTotal)} business, ${money(out.personalTotal)} personal`); onClose(); }
  };

  return <Modal wide title={`Import Statement · ${card?.name || cardAccount}`} onClose={onClose}
    foot={st && <>
      <span className="subtle" style={{ marginRight: "auto" }}>
        Business <b className="mono">{money(t.business)}</b> · Personal <b className="mono">{money(t.personal)}</b>
        {t.undecided ? <span style={{ color: "var(--warn)" }}> · {t.undecided} to mark</span> : null}
        {t.noAccount ? <span style={{ color: "var(--warn)" }}> · {t.noAccount} need an account</span> : null}</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || t.undecided > 0 || t.noAccount > 0 || !st.closingDate} onClick={post}><Ico d={ICONS.check} size={15} />{busy ? "Posting…" : "Post Statement"}</button>
    </>}>
    {!st ? <>
      <p className="subtle" style={{ marginTop: 0 }}>The card company's <b>.csv download</b> reads most reliably; a statement <b>PDF</b> works too, or paste the transaction rows.</p>
      <input ref={fileRef} type="file" accept=".csv,.pdf,.txt" style={{ display: "none" }} onChange={e => onFile(e.target.files[0])} />
      <button className="btn primary" onClick={() => fileRef.current?.click()}><Ico d={ICONS.plus} size={15} />Choose Statement File</button>
      <div className="divider"></div>
      <Field label="Or paste the statement text"><textarea className="input" rows={6} value={paste} onChange={e => setPaste(e.target.value)} placeholder="09/02 DIGIKEY ELECTRONICS MN $1,180.00" /></Field>
      <button className="btn" disabled={!paste.trim()} onClick={() => load(readCardPaste(paste))}>Read Pasted Text</button>
      {err && <p style={{ color: "var(--neg)" }}>{err}</p>}
    </> : <>
      <div className="row">
        <Field label="Closing date"><input className="input" type="date" value={st.closingDate} onChange={e => setSt({ ...st, closingDate: e.target.value })} /></Field>
        <Field label="Previous balance"><input className="input mono" type="number" step="0.01" value={st.previousBalance ?? ""} onChange={e => setSt({ ...st, previousBalance: e.target.value === "" ? null : e.target.value })} /></Field>
        <Field label="New balance"><input className="input mono" type="number" step="0.01" value={st.newBalance ?? ""} onChange={e => setSt({ ...st, newBalance: e.target.value === "" ? null : e.target.value })} /></Field>
      </div>
      {check != null && (Math.abs(check) < 0.01
        ? <p style={{ color: "var(--pos)", marginTop: 0 }}>✓ Previous balance plus every line read equals the new balance — nothing was missed.</p>
        : <p style={{ color: "var(--neg)", marginTop: 0 }}>Previous balance plus the lines read is off the new balance by {money(check)} — a line may have been missed or misread. Check against the statement before posting.</p>)}
      {first && Math.abs(openingAmt) > 0.005 && <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 10px" }}>
        <input type="checkbox" checked={carry} onChange={e => setCarry(e.target.checked)} style={{ marginTop: 3 }} />
        <span>This is the first {card?.name} statement in Ledger. Carry its previous balance of <b className="mono">{money(openingAmt)}</b> as owed when Ledger started
          (Dec 31, 2025 — against Retained Earnings), so the January payment clears it. Untick if that balance's charges are on an earlier statement you'll import.</span></label>}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button className="btn sm" onClick={() => setAllUndecided("personal")}>Mark the rest Personal</button>
        <button className="btn sm" onClick={() => setAllUndecided("business")}>Mark the rest Business</button>
        <span className="subtle" style={{ marginLeft: "auto", alignSelf: "center" }}>Merchants are remembered from earlier statements.</span>
      </div>
      <table className="li-table"><thead><tr><th style={{ width: 100 }}>Date</th><th>Description</th><th className="num" style={{ width: 110 }}>Amount</th><th style={{ width: 200 }}>Business / Personal</th><th style={{ minWidth: 220 }}>Expense account</th></tr></thead>
        <tbody>{sorted.map(l => <tr key={l.id} style={l.kind === "payment" ? { opacity: 0.55 } : {}}>
          <td className="subtle">{fmtDate(l.date)}</td>
          <td>{l.desc}{l.kind === "credit" && <span className="subtle"> · credit</span>}</td>
          <td className="num mono">{money(l.amount)}</td>
          <td>{l.kind === "payment" ? <span className="subtle">Payment — reconciled on the bank side</span>
            : <span style={{ display: "inline-flex", gap: 4 }}>
              <button className={"btn sm" + (l.use === "business" ? " primary" : "")} onClick={() => setLine(l.id, { use: "business" })}>Business</button>
              <button className={"btn sm" + (l.use === "personal" ? " primary" : "")} onClick={() => setLine(l.id, { use: "personal", account: "" })}>Personal</button>
            </span>}</td>
          <td>{l.use === "business" && <AccountSelect db={db} value={l.account} onChange={v => setLine(l.id, { account: v })} groups={["expense", "cos"]} blank="— pick an account —" />}</td>
        </tr>)}</tbody></table>
      <p className="subtle" style={{ marginBottom: 0 }}>Posting writes an expense for each business line, paid from {accountLabel(db, cardAccount)}, and one entry moving the personal total to owner draws.
        Unpost the statement to undo it.</p>
    </>}
  </Modal>;
}
