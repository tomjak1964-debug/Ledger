import { useMemo, useState } from "react";
import { money, fmtDate, todayISO } from "../lib/helpers.js";
import { accountSettings } from "../calc/accounts.js";
import { closeMonths, yearEnd } from "../calc/close.js";
import { Ico, ICONS, Empty } from "../components/ui.jsx";

// System → Month-End Close. One row per month: the bank reconciled, each card
// and line of credit statement posted, what payroll was booked, and whether the
// month is locked. Lock the oldest open month once its checks pass — the
// database then refuses money changes dated in it (migration 030). The lock can
// be moved back a month from here, or to any date in Settings → Accounts.
export default function MonthEndCloseView({ db, actions, toast, readOnly, go }) {
  const today = todayISO();
  const acct = accountSettings(db.settings);
  const months = useMemo(() => closeMonths(db, today), [db, today]);
  const [busy, setBusy] = useState(false);
  // Year-end: the year that just ended from January on, else this one.
  const [year, setYear] = useState(() => String(Number(today.slice(0, 4)) - (today.slice(5, 7) <= "03" ? 1 : 0)));
  const ye = useMemo(() => yearEnd(db, year, { today }), [db, year, today]);
  const reviewed = async (v) => {
    setBusy(true);
    const ok = await actions.saveSettings({ ...db.settings, accounts: { ...(db.settings.accounts || {}), ten99Reviewed: [...new Set([...(acct.ten99Reviewed || []), v.id])] } });
    setBusy(false);
    if (ok) toast(`${v.name}: no 1099 needed`);
  };
  const report = (key, from, to) => go("reports", { report: key, from, to });
  const readyLines = db.salesOrders.reduce((n, so) => n + (so.lineItems || []).filter(li => li.ready && !li.invoiced && !li.closed).length, 0);
  // The month to close next: the oldest finished month not yet locked.
  const next = [...months].reverse().find(m => !m.locked && m.over);
  const lastLocked = months.find(m => m.locked);

  const setLock = async (date, msg) => {
    setBusy(true);
    const ok = await actions.saveSettings({ ...db.settings, accounts: { ...(db.settings.accounts || {}), lockDate: date } });
    setBusy(false);
    if (ok) toast(msg);
  };
  const lock = (m) => {
    const warn = m.missing.length ? `\n\nStill open for ${m.label}:\n${m.missing.map(c => `• ${c.label} — ${c.detail}`).join("\n")}\n\nLock anyway?` : "";
    if (!confirm(`Lock the books through ${fmtDate(m.end)}? Nothing dated on or before it can then be added, deleted or have its money changed.${warn}`)) return;
    setLock(m.end, `🔒 Books locked through ${fmtDate(m.end)}`);
  };
  const unlock = () => {
    const prev = months.find(m => m.end < lastLocked.end && m.locked) || null;
    const date = prev ? prev.end : "";
    if (!confirm(`Unlock ${lastLocked.label}? ${date ? `The books stay locked through ${fmtDate(date)}.` : "Nothing will be locked."}`)) return;
    setLock(date, date ? `Books locked through ${fmtDate(date)}` : "Books unlocked");
  };
  // A statement month with nothing to post (payment only, or no activity) is marked so, and stops blocking the close.
  const setSkip = async (m, c, on) => {
    const all = { ...(acct.closeSkips || {}) };
    const list = new Set(all[m.ym] || []);
    on ? list.add(c.account) : list.delete(c.account);
    if (list.size) all[m.ym] = [...list]; else delete all[m.ym];
    setBusy(true);
    const ok = await actions.saveSettings({ ...db.settings, accounts: { ...(db.settings.accounts || {}), closeSkips: all } });
    setBusy(false);
    if (ok) toast(on ? `${c.label}: ${m.label} marked nothing to post` : `${c.label}: ${m.label} needs its statement again`);
  };
  const LABEL = { done: "Done", progress: "In progress", missing: "Missing", na: "—", skipped: "Nothing to post", none: "None", pending: "Not yet" };
  const TONE = { done: "green", progress: "amber", missing: "red", skipped: "", na: "", none: "", pending: "" };
  const mark = (c, m) => <span style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
    {c.state === "na" ? <span className="subtle" title={c.detail}>—</span>
      : <span className={"badge " + TONE[c.state]} title={c.detail} style={{ cursor: c.go ? "pointer" : "default" }} onClick={() => c.go && go(c.go)}>
        <span className="dot"></span>{LABEL[c.state]}</span>}
    {!readOnly && m && c.canSkip && <button className="btn ghost sm" disabled={busy} title="This month's statement had nothing to post (a payment only, or no activity)"
      style={{ fontSize: 12 }} onClick={() => setSkip(m, c, true)}>Nothing to post</button>}
    {!readOnly && m && c.state === "skipped" && <button className="btn ghost sm" disabled={busy} onClick={() => setSkip(m, c, false)}>Undo</button>}
  </span>;

  return <div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Closing</h3>
        <span className="subtle" style={{ marginLeft: "auto" }}>{acct.lockDate ? <>🔒 Locked through <b>{fmtDate(acct.lockDate)}</b></> : "Nothing locked yet"}</span></div>
      <div className="card-body">
        {next
          ? <p style={{ margin: 0 }}>Next to close: <b>{next.label}</b>. {next.ready
            ? <span style={{ color: "var(--pos)" }}>Everything is done — lock it.</span>
            : <span>Still open: {next.missing.map(c => c.label).join(", ")}.</span>}</p>
          : <p style={{ margin: 0 }}>Every finished month is locked.</p>}
        {readyLines > 0 && <p className="subtle" style={{ margin: "6px 0 0" }}>
          {readyLines} job line{readyLines === 1 ? " is" : "s are"} ready to invoice — <a href="#" onClick={e => { e.preventDefault(); go("tasks"); }}>bill them</a> before closing the month they belong to.</p>}
        {!readOnly && <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {next && <button className="btn primary" disabled={busy} onClick={() => lock(next)}><Ico d={ICONS.lock} size={15} />Lock {next.label}</button>}
          {lastLocked && <button className="btn" disabled={busy} onClick={unlock}>Unlock {lastLocked.label}</button>}
        </div>}
      </div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h3>Year-End {ye.year}</h3>
        <select className="select" style={{ marginLeft: 12, maxWidth: 110 }} value={year} onChange={e => setYear(e.target.value)}>
          {[0, 1, 2].map(k => String(Number(today.slice(0, 4)) - k)).map(y => <option key={y} value={y}>{y}</option>)}</select></div>
      <div className="card-body">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li><b>Close every month.</b> {ye.allLocked
            ? <span style={{ color: "var(--pos)" }}>All 12 months are locked.</span>
            : <span>{ye.lockedMonths} of 12 locked — finish the months above.</span>}</li>
          <li><b>1099s</b> (due to vendors and the IRS by Jan 31): {ye.ten99Count} vendor{ye.ten99Count === 1 ? "" : "s"} over {money(ye.limit)}
            {" "}— <a href="#" onClick={e => { e.preventDefault(); report("v1099", `${ye.year}-01-01`, `${ye.year}-12-31`); }}>1099 Vendor Report</a>.
            {ye.missingTin.length > 0
              ? <div style={{ color: "var(--neg)" }}>No Tax ID on file — get a W-9: {ye.missingTin.map(v => `${v.name} (${money(v.total)})`).join(", ")}</div>
              : <div style={{ color: "var(--pos)" }}>Every one has a Tax ID on file.</div>}
            {ye.unmarked.length > 0 && <div className="subtle" style={{ marginTop: 4 }}>
              Paid over {money(ye.limit)} but not marked for a 1099 — a corporation, a material supplier or a donation needs none; mark a vendor
              1099-NEC / MISC under Vendors if it does:
              <table style={{ marginTop: 4 }}><tbody>{ye.unmarked.map(v => <tr key={v.id}>
                <td>{v.name}</td><td className="num mono">{money(v.total)}</td>
                <td style={{ textAlign: "right" }}>{!readOnly && <button className="btn sm" disabled={busy} onClick={() => reviewed(v)}>No 1099 needed</button>}</td>
              </tr>)}</tbody></table></div>}</li>
          <li><b>Reports for the accountant</b> ({ye.year}):{" "}
            {[["is", "Income Statement", `${ye.year}-01-01`, `${ye.year}-12-31`], ["bs", "Balance Sheet", `${ye.year}-01-01`, `${ye.year}-12-31`],
              ["tb", "Trial Balance", `${ye.year}-01-01`, `${ye.year}-12-31`], ["gl", "General Ledger", `${ye.year}-01-01`, `${ye.year}-12-31`],
              ["ar", "Aged Receivables", `${ye.year}-01-01`, `${ye.year}-12-31`], ["ap", "Aged Payables", `${ye.year}-01-01`, `${ye.year}-12-31`]]
              .map(([k, l, f, t], i) => <span key={k}>{i ? " · " : ""}<a href="#" onClick={e => { e.preventDefault(); report(k, f, t); }}>{l}</a></span>)}
            <div className="subtle">Each opens on the whole year (the balance sheet, trial balance and aging as of Dec 31) — Save PDF or Email from there.</div></li>
          <li><b>Opening balances</b> for {Number(ye.year) + 1}: nothing to enter. Ledger closes the year itself —
            {ye.netIncome != null && <> the year's net {ye.netIncome < 0 ? "loss" : "income"} of <b className="mono">{money(Math.abs(ye.netIncome))}</b></>} goes into Retained Earnings on Dec 31
            (<a href="#" onClick={e => { e.preventDefault(); report("bs", `${Number(ye.year) + 1}-01-01`, `${Number(ye.year) + 1}-01-01`); }}>balance sheet as of Jan 1</a>).</li>
          <li><b>Lock the year</b> once the accountant is done: lock December above, and the whole year is put away.</li>
        </ol>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><h3>Months</h3></div>
      {months.length === 0 ? <Empty icon={ICONS.check} title="Nothing to close yet" msg="Months appear here once there is something on the books." />
        : <table><thead><tr><th>Month</th><th>Bank</th>
          {(acct.cards || []).map(c => <th key={c.id}>{c.name}</th>)}
          {(acct.loans || []).map(l => <th key={l.id}>{l.name}</th>)}
          <th className="num">Payroll</th><th>Status</th></tr></thead>
          <tbody>{months.map(m => <tr key={m.ym}>
            <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{m.short}</td>
            <td>{mark(m.bank, m)}</td>
            {m.cards.map((c, i) => <td key={i}>{mark(c, m)}</td>)}
            {m.loans.map((c, i) => <td key={i}>{mark(c, m)}</td>)}
            <td className="num mono" title={m.payroll.detail}>{m.payroll.state === "done" ? money(m.payroll.amount) : <span className="subtle">—</span>}</td>
            <td>{m.locked ? <span className="badge green"><span className="dot"></span>🔒 Locked</span>
              : !m.over ? <span className="subtle">In progress</span>
              : m.ready ? <span className="badge blue"><span className="dot"></span>Ready to lock</span>
              : <span className="badge amber"><span className="dot"></span>Open</span>}</td>
          </tr>)}</tbody></table>}
      <p className="subtle" style={{ margin: "10px 16px 14px", fontSize: 12.5 }}>
        A month is ready to lock when its bank reconciliation is finished and every card and line of credit statement closing in it is posted.
        Click a mark to go to that page. Payroll is shown for reference — it doesn't run every month.</p>
    </div>
  </div>;
}
