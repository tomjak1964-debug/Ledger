// General helpers ported verbatim from ledger.html, except uid(): the database
// uses uuid primary keys, so ids are now real UUIDs instead of random slugs.
export const uid = () => crypto.randomUUID();
// A Date's calendar day where the user is. toISOString() is UTC, which in the
// evening (after 8pm Eastern) is already tomorrow.
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayISO = () => isoDate(new Date());
export const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoDate(d); };
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
export const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
export const cls = (...a) => a.filter(Boolean).join(" ");
export const sum = (arr, f) => arr.reduce((t, x) => t + (f ? f(x) : x), 0);
export const pad4 = (n) => String(n).padStart(4, "0");
export const nameOf = (db, id) => { const c = db.contacts.find(x => x.id === id); return c ? c.name : "—"; };

export const EXPENSE_CATS = ["Materials", "Subcontractor", "Tools & Equipment", "Software", "Travel", "Vehicle/Fuel", "Office", "Utilities", "Insurance", "Professional Fees", "Other"];
