// UI primitives, ported verbatim from ledger.html.
import { cls } from "../lib/helpers.js";

export const Ico = ({ d, size = 17 }) => <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export const ICONS = {
  dash: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  quote: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  so: "M6 2h9l5 5v15H6zM15 2v5h5M9 13l2 2 4-4",
  inv: "M6 2h12v20l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  ar: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7H12M7 19h7.5a3.5 3.5 0 000-7",
  ap: "M3 6h18v12H3zM3 10h18M7 15h4",
  exp: "M3 3v18h18M7 14l3-3 3 3 5-6",
  contacts: "M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87",
  catalog: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H1a2 2 0 110-4h.1A1.6 1.6 0 002.6 7a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H7a1.6 1.6 0 001-1.5V1a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V7a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z",
  plus: "M12 5v14M5 12h14", search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  print: "M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z",
  arrow: "M9 6l6 6-6 6", back: "M15 18l-6-6 6-6", trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  x: "M18 6L6 18M6 6l12 12", menu: "M3 12h18M3 6h18M3 18h18", edit: "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  check: "M20 6L9 17l-5-5", money: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7H12M7 19h7.5a3.5 3.5 0 000-7",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
};

export function Badge({ status }) {
  const map = {
    draft: ["gray", "Draft"], sent: ["blue", "Sent"], accepted: ["green", "Accepted"], declined: ["red", "Declined"],
    open: ["blue", "Open"], invoiced: ["green", "Invoiced"], fulfilled: ["green", "Fulfilled"],
    unpaid: ["amber", "Unpaid"], partial: ["blue", "Partial"], paid: ["green", "Paid"], overdue: ["red", "Overdue"],
  };
  const [c, l] = map[status] || ["gray", status];
  return <span className={"badge " + c}><span className="dot"></span>{l}</span>;
}

export function Stat({ label, value, meta, tone }) {
  return <div className="stat"><div className="lbl">{label}</div><div className={cls("val mono", tone)}>{value}</div>{meta && <div className="meta">{meta}</div>}</div>;
}

export function Empty({ icon, title, msg, action }) {
  return <div className="empty">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d={icon} /></svg>
    <div className="big">{title}</div><div style={{ maxWidth: 340, margin: "0 auto" }}>{msg}</div>
    {action && <div style={{ marginTop: 16 }}>{action}</div>}
  </div>;
}

export function Modal({ title, onClose, children, foot, wide }) {
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={cls("modal", wide && "wide")}>
      <div className="modal-head"><h2>{title}</h2><button className="btn ghost icon" style={{ marginLeft: "auto" }} onClick={onClose}><Ico d={ICONS.x} size={18} /></button></div>
      <div className="modal-body">{children}</div>
      {foot && <div className="modal-foot">{foot}</div>}
    </div>
  </div>;
}

export function Field({ label, hint, children }) {
  return <div className="field"><label>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

export function MenuItem({ children, onClick, accent, danger }) {
  return <button onClick={onClick} style={{
    display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent",
    padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500,
    color: danger ? "var(--neg)" : accent ? "var(--accent)" : "var(--ink)"
  }}
    onMouseEnter={e => e.currentTarget.style.background = "#F3F6FA"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{children}</button>;
}
