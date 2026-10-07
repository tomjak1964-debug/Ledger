import { todayISO } from "../lib/helpers.js";

/* ---------- CSV export ---------- */
export function downloadCSV(name, header, rows) {
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [header, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name + "-" + todayISO() + ".csv";
  a.click();
}

export function ReportCard({ title, rangeLabel, right, children }) {
  return <div className="card" style={{ marginBottom: 16 }}>
    <div className="card-head"><h3>{title}</h3><span className="subtle" style={{ marginLeft: "auto" }}>{rangeLabel}</span>{right}</div>
    {children}
  </div>;
}

// All / Open / Closed — the status filter the job and sales-order reports share.
export function StatusToggle({ value, onChange, options = [["all", "All"], ["open", "Open"], ["closed", "Closed"]] }) {
  return <div className="no-print" role="group" style={{ display: "inline-flex", gap: 4 }}>
    {options.map(([k, l]) => <button key={k} className={"btn sm" + (value === k ? " primary" : "")} onClick={() => onChange(k)}>{l}</button>)}
  </div>;
}
