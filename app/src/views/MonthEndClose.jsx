import { useMemo, useState } from "react";
import { money, fmtDate, todayISO } from "../lib/helpers.js";
import { accountSettings } from "../calc/accounts.js";
import { closeMonths } from "../calc/close.js";
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
