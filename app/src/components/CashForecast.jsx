import { useMemo, useState, Fragment } from "react";
import { money, fmtDate, todayISO } from "../lib/helpers.js";
import { cashForecast } from "../calc/forecast.js";

// Dashboard → Cash Forecast: checking week by week for the next eight weeks
// (calc/forecast.js). Overdue invoices are left out unless ticked in, so the low
// point is what the books can count on; a week opens to what makes it up.
export default function CashForecast({ db, go }) {
  const today = todayISO();
  const [includeOverdue, setIncludeOverdue] = useState(false);
  const [open, setOpen] = useState(null);
  const f = useMemo(() => cashForecast(db, today, { includeOverdue }), [db, today, includeOverdue]);
  const neg = v => (v < 0 ? { color: "var(--neg)" } : {});
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>Cash Forecast</h3>
      <span className="subtle" style={{ marginLeft: 12 }}>Checking · next 8 weeks</span>
      <label className="subtle" style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" checked={includeOverdue} onChange={e => setIncludeOverdue(e.target.checked)} />
        Count overdue invoices as paid this week</label></div>
    <div className="card-body" style={{ paddingBottom: 6 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 8 }}>
        <div><div className="subtle" style={{ fontSize: 12 }}>In checking today (per the books)</div><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{money(f.start)}</div></div>
        <div><div className="subtle" style={{ fontSize: 12 }}>Low point</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, ...neg(f.low.balance) }}>{money(f.low.balance)}</div>
          <div className="subtle" style={{ fontSize: 12 }}>week of {fmtDate(f.low.from)}</div></div>
        {f.overdueIn > 0.005 && <div><div className="subtle" style={{ fontSize: 12 }}>Overdue invoices {includeOverdue ? "counted" : "not counted"}</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--warn)", cursor: "pointer" }} onClick={() => go("receivables")}>{money(f.overdueIn)}</div></div>}
      </div>
    </div>
    <table><thead><tr><th>Week of</th><th className="num">Coming in</th><th className="num">Going out</th><th className="num">Balance</th></tr></thead>
      <tbody>{f.weeks.map(w => <Fragment key={w.from}>
        <tr className="clickable" onClick={() => setOpen(open === w.from ? null : w.from)}>
          <td className="nowrap">{fmtDate(w.from)}</td>
          <td className="num mono" style={{ color: w.in ? "var(--pos)" : undefined }}>{w.in ? money(w.in) : "—"}</td>
          <td className="num mono" style={{ color: w.out ? "var(--neg)" : undefined }}>{w.out ? money(-w.out) : "—"}</td>
          <td className="num mono" style={{ fontWeight: 600, ...neg(w.balance) }}>{money(w.balance)}</td>
        </tr>
        {open === w.from && <tr><td colSpan={4} style={{ background: "var(--canvas)" }}>
          {w.items.length === 0 ? <span className="subtle">Nothing due this week.</span>
            : <table><tbody>{w.items.map((i, k) => <tr key={k}>
              <td className="subtle nowrap" style={{ width: 110 }}>{fmtDate(i.date)}</td>
              <td>{i.label}{i.overdue && <span className="subtle"> · overdue</span>}{i.estimate && <span className="subtle"> · estimate</span>}</td>
              <td className="num mono" style={{ color: i.amount < 0 ? "var(--neg)" : "var(--pos)" }}>{money(i.amount)}</td>
            </tr>)}</tbody></table>}
        </td></tr>}
      </Fragment>)}</tbody></table>
    <p className="subtle" style={{ margin: "8px 16px 12px", fontSize: 12 }}>
      In: open invoices on their due dates. Out: open bills on their due dates (overdue ones this week), each card's latest statement about 25 days after it
      closed, the line of credit payment and payroll — the last three are estimates. Tap a week to see what's in it.</p>
  </div>;
}
