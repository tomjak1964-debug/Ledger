import { accountsOfType, TYPE_GROUP } from "../calc/accounts.js";

// A chart-of-accounts picker. `types` limits it to those account types (an
// income account for an invoice, a cash account for a payment); `groups` does
// the same by balance-sheet group ("expense", "liability"…). A value the chart
// doesn't hold is still shown, so a document booked before the chart existed
// keeps reading what it says. Until a chart is loaded under System → Chart of
// Accounts the list is the built-in TMJ chart.
export default function AccountSelect({ db, value, onChange, types, groups, blank, disabled, style }) {
  const list = accountsOfType(db, null).filter(a => (!types || types.includes(a.type)) && (!groups || groups.includes(TYPE_GROUP[a.type])));
  const has = list.some(a => String(a.number) === String(value || ""));
  const byType = {};
  list.forEach(a => (byType[a.type] ||= []).push(a));
  return <select className="select" value={value || ""} disabled={disabled} style={style} onChange={e => onChange(e.target.value)}>
    <option value="">{blank || "— default —"}</option>
    {!has && value && <option value={value}>{value} (not in chart)</option>}
    {Object.entries(byType).map(([type, accts]) => <optgroup key={type} label={type}>
      {accts.map(a => <option key={a.id || a.number} value={a.number}>{a.number} · {a.name}</option>)}
    </optgroup>)}
  </select>;
}
