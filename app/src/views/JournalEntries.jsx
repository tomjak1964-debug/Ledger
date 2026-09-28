import { useState } from "react";
import { uid, todayISO, money, fmtDate, sum } from "../lib/helpers.js";
import { round2 } from "../calc/ledger.js";
import { accountLabel } from "../calc/accounts.js";
import { useFilters } from "../components/useFilters.jsx";
import AccountSelect from "../components/AccountSelect.jsx";
import { Ico, ICONS, Empty, Modal, Field, SortTh, useTableSort, ActionMenu, MenuItem } from "../components/ui.jsx";

// System → Journal Entries. What the shop books to the ledger by hand — a
// payroll run (wages, employer taxes, 401K), depreciation, an adjustment —
// beside the entries the documents post on their own (calc/gl.js). An entry
// is any number of lines, each a debit or a credit to one account, and it
// saves only when the two sides agree.

const blankLine = () => ({ id: uid(), account: "", desc: "", debit: "", credit: "" });
const totals = lines => {
  const debits = round2(sum(lines, l => Number(l.debit) || 0)), credits = round2(sum(lines, l => Number(l.credit) || 0));
  return { debits, credits, diff: round2(debits - credits) };
};

export default function JournalEntriesView({ db, actions, toast, readOnly }) {
  const [edit, setEdit] = useState(null);
  const entries = db.journalEntries || [];
  const f = useFilters();
  const shown = entries.filter(j => f.keep(j.date));
  const { sorted: rows, sort, onSort } = useTableSort(shown, {
    number: j => j.number || "", date: j => j.date || "", memo: j => j.memo || "", ref: j => j.ref || "",
    lines: j => (j.lines || []).length, amount: j => totals(j.lines || []).debits,
  }, { key: "date", dir: "desc" });

  const startNew = () => setEdit({ id: uid(), _new: true, date: todayISO(), ref: "", memo: "", lines: [blankLine(), blankLine()] });
  // A copy is the quickest way to book the same run again — next month's payroll.
  const copyOf = j => setEdit({ id: uid(), _new: true, date: todayISO(), ref: "", memo: j.memo, lines: (j.lines || []).map(l => ({ ...l, id: uid() })) });
  const del = async j => {
    if (!confirm(`Delete ${j.number || "this entry"}? It comes off the ledger and its number is not reused.`)) return;
    if (await actions.deleteJournalEntry(j.id)) toast("Entry deleted");
  };

  return <div>
    {!readOnly && <div className="toolbar">
      <p className="subtle" style={{ margin: 0 }}>Book what no document covers — payroll, employer taxes, depreciation, an adjustment. Every entry must balance.</p>
      <button className="btn primary" style={{ marginLeft: "auto" }} onClick={startNew}><Ico d={ICONS.plus} size={15} />New Journal Entry</button>
    </div>}
    {f.bar()}
    <div className="card">
      {entries.length === 0
        ? <Empty icon={ICONS.reports} title="No journal entries yet" msg="Invoices, bills, expenses and payments post to the ledger on their own. Book anything else here — a payroll run, employer taxes, 401K, depreciation."
          action={!readOnly && <button className="btn primary" onClick={startNew}><Ico d={ICONS.plus} size={15} />New Journal Entry</button>} />
        : rows.length === 0
          ? <Empty icon={ICONS.reports} title="No entries in this range" msg="Widen the date range above." />
          : <table><thead><tr>
            <SortTh label="Entry" col="number" sort={sort} onSort={onSort} />
            <SortTh label="Date" col="date" sort={sort} onSort={onSort} />
            <SortTh label="Memo" col="memo" sort={sort} onSort={onSort} />
            <SortTh label="Reference" col="ref" sort={sort} onSort={onSort} />
            <SortTh label="Lines" col="lines" sort={sort} onSort={onSort} num />
            <SortTh label="Amount" col="amount" sort={sort} onSort={onSort} num />
            <th></th></tr></thead>
            <tbody>{rows.map(j => <tr key={j.id}>
              <td className="mono" style={{ fontWeight: 600 }}>{j.number || "—"}</td>
              <td className="subtle">{fmtDate(j.date)}</td>
              <td>{j.memo || <span className="subtle">—</span>}
                <div className="subtle" style={{ fontSize: 12 }}>{(j.lines || []).map(l => accountLabel(db, l.account)).join(" · ")}</div></td>
              <td className="mono subtle">{j.ref || "—"}</td>
              <td className="num">{(j.lines || []).length}</td>
              <td className="num mono" style={{ fontWeight: 600 }}>{money(totals(j.lines || []).debits)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <ActionMenu title="Actions">{close => <>
                  <MenuItem onClick={() => { close(); setEdit({ ...j, lines: (j.lines || []).map(l => ({ ...l })) }); }}>{readOnly ? "View" : "Edit"}</MenuItem>
                  {!readOnly && <MenuItem onClick={() => { close(); copyOf(j); }}>Copy to new entry</MenuItem>}
                  {!readOnly && <MenuItem danger onClick={() => { close(); del(j); }}>Delete</MenuItem>}
                </>}</ActionMenu>
              </td>
            </tr>)}</tbody></table>}
    </div>
    {edit && <JournalEntryModal db={db} entry={edit} readOnly={readOnly} onClose={() => setEdit(null)}
      onSave={async j => { const saved = await actions.saveJournalEntry(j); if (saved) { setEdit(null); toast(`${saved.number} saved`); } }} />}
  </div>;
}

// The editor: date, reference and memo up top, then one line per account with
// a Debit and a Credit column. Typing on one side clears the other, the totals
// row shows the difference, and Save stays off until it is zero.
export function JournalEntryModal({ db, entry, readOnly, onClose, onSave }) {
  const [j, setJ] = useState(entry);
  const [saving, setSaving] = useState(false);
  const lines = j.lines || [];
  const t = totals(lines);
  const setLine = (id, patch) => setJ({ ...j, lines: lines.map(l => l.id === id ? { ...l, ...patch } : l) });
  const addLine = () => setJ({ ...j, lines: [...lines, blankLine()] });
  const removeLine = id => setJ({ ...j, lines: lines.filter(l => l.id !== id) });
  // Put the difference on the line the cursor is on — the last line of a
  // payroll entry is usually "whatever makes it balance".
  const balanceOn = id => {
    if (Math.abs(t.diff) < 0.005) return;
    const l = lines.find(x => x.id === id);
    const have = (Number(l.debit) || 0) - (Number(l.credit) || 0);
    const want = round2(have - t.diff);
    setLine(id, want >= 0 ? { debit: want || "", credit: "" } : { debit: "", credit: -want });
  };
  const filled = lines.filter(l => l.account || Number(l.debit) || Number(l.credit));
  const problems = [];
  if (!j.date) problems.push("a date");
  if (filled.some(l => !l.account)) problems.push("an account on every line");
  if (filled.some(l => !(Number(l.debit) || 0) && !(Number(l.credit) || 0))) problems.push("an amount on every line");
  if (filled.length < 2) problems.push("at least two lines");
  if (Math.abs(t.diff) > 0.005) problems.push(`debits and credits to agree (off by ${money(Math.abs(t.diff))})`);
  const submit = async () => { setSaving(true); try { await onSave(j); } finally { setSaving(false); } };
  const num = v => (v === "" || v == null ? "" : v);

  return <Modal title={entry._new ? "New Journal Entry" : (readOnly ? "" : "Edit ") + (entry.number || "Journal Entry")} onClose={onClose} wide
    foot={<>
      <span className="subtle" style={{ marginRight: "auto" }}>
        {problems.length ? "Needs " + problems.join(", ") + "." : `${filled.length} lines · in balance`}</span>
      <button className="btn" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</button>
      {!readOnly && <button className="btn primary" disabled={saving || problems.length > 0} onClick={submit}>
        {saving ? "Saving…" : "Save " + money(t.debits)}</button>}
    </>}>
    <div className="row">
      <Field label="Date"><input className="input" type="date" value={j.date || ""} disabled={readOnly} onChange={e => setJ({ ...j, date: e.target.value })} /></Field>
      <Field label="Reference" hint="Optional — a payroll batch, a check, a statement"><input className="input mono" value={j.ref || ""} disabled={readOnly} onChange={e => setJ({ ...j, ref: e.target.value })} /></Field>
      <Field label="Memo"><input className="input" value={j.memo || ""} disabled={readOnly} placeholder="Payroll — Sep 15" onChange={e => setJ({ ...j, memo: e.target.value })} /></Field>
    </div>
    <table className="li-table"><thead><tr>
      <th style={{ minWidth: 220 }}>Account</th><th>Description</th><th className="num" style={{ width: 130 }}>Debit</th><th className="num" style={{ width: 130 }}>Credit</th><th style={{ width: 40 }}></th>
    </tr></thead>
      <tbody>
        {lines.map(l => <tr key={l.id}>
          <td><AccountSelect db={db} value={l.account} disabled={readOnly} onChange={v => setLine(l.id, { account: v })} blank="— account —" /></td>
          <td><input className="input" value={l.desc || ""} disabled={readOnly} placeholder="What this line is" onChange={e => setLine(l.id, { desc: e.target.value })} /></td>
          <td><input className="input mono num" type="number" min="0" step="0.01" value={num(l.debit)} disabled={readOnly} style={{ textAlign: "right" }}
            onChange={e => setLine(l.id, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })}
            onKeyDown={e => { if (e.key === "=" ) { e.preventDefault(); balanceOn(l.id); } }} /></td>
          <td><input className="input mono num" type="number" min="0" step="0.01" value={num(l.credit)} disabled={readOnly} style={{ textAlign: "right" }}
            onChange={e => setLine(l.id, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })}
            onKeyDown={e => { if (e.key === "=" ) { e.preventDefault(); balanceOn(l.id); } }} /></td>
          <td>{!readOnly && <button className="btn ghost icon" title="Remove line" disabled={lines.length <= 1} onClick={() => removeLine(l.id)}><Ico d={ICONS.trash} size={14} /></button>}</td>
        </tr>)}
        <tr>
          <td colSpan={2} style={{ paddingTop: 10 }}>
            {!readOnly && <span style={{ display: "inline-flex", gap: 8 }}>
              <button className="btn sm" onClick={addLine}><Ico d={ICONS.plus} size={14} />Add Line</button>
              {Math.abs(t.diff) > 0.005 && lines.length > 0 && <button className="btn sm" title="Put the difference on the last line" onClick={() => balanceOn(lines[lines.length - 1].id)}>Balance on last line</button>}
            </span>}
          </td>
          <td className="num mono" style={{ fontWeight: 700, paddingTop: 12 }}>{money(t.debits)}</td>
          <td className="num mono" style={{ fontWeight: 700, paddingTop: 12 }}>{money(t.credits)}</td>
          <td></td>
        </tr>
        {Math.abs(t.diff) > 0.005 && <tr><td colSpan={5} style={{ color: "var(--neg)", fontWeight: 600 }}>
          Out of balance by {money(Math.abs(t.diff))} — {t.diff > 0 ? "credits" : "debits"} are short.</td></tr>}
      </tbody></table>
    <p className="subtle" style={{ margin: "10px 0 0" }}>A payroll run, for instance: debit Wages Expense, Payroll Tax Expense and 401K Employer for the cost; credit Checking for the net pay and the payable accounts for what is withheld and owed. Typing on one side of a line clears the other; press = in an amount box to put the difference there.</p>
  </Modal>;
}
