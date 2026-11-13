// Role-based access control (Phase 2, feature 7).
//
// Access is per-area, per-user: each org member has a `permissions` map of
// area → level, where level is "none" | "read" | "write" ("write" implies
// "read"). Owners and admins implicitly get "write" everywhere. These same
// area keys gate the UI (nav + write controls) here and the database via RLS
// (migration 007) — keep the two in sync.

// Canonical, user-facing access areas shown in the admin permission matrix.
export const AREAS = [
  { key: "reports", label: "Reports" },
  { key: "proposals", label: "Proposals, Fixture & System Rates" },
  { key: "quotes", label: "Quotes" },
  { key: "salesOrders", label: "Sales Orders" },
  { key: "jobs", label: "Jobs & Progress" },
  { key: "invoices", label: "Invoices" },
  { key: "receivables", label: "Receivables" },
  { key: "payables", label: "Payables" },
  { key: "expenses", label: "Expenses" },
  { key: "timeTracking", label: "Time Tracking" },
  { key: "field", label: "Field (mobile)" },
  { key: "contacts", label: "Customers & Vendors" },
  { key: "catalog", label: "Item Catalog" },
  { key: "banking", label: "Banking Information" },
  { key: "settings", label: "Settings & Users" },
];

// Nav key → access area. null means "always available" (e.g. the dashboard);
// a page missing here is hidden from everyone, admins included — add it.
// Tasks are gated by 'invoices' — the invoice tasks are for invoice-authorized
// users to act on.
export const NAV_AREA = {
  dashboard: null,
  reports: "reports",
  proposals: "proposals",
  machineRates: "proposals",
  systemRates: "proposals",
  rateSheet: "proposals",
  bankingSheet: "banking",
  quotes: "quotes",
  salesOrders: "salesOrders",
  jobs: "jobs",
  tasks: "invoices",
  invoices: "invoices",
  receivables: "receivables",
  purchaseOrders: "payables",
  payables: "payables",
  payments: "payables",
  expenses: "expenses",
  timeTracking: "timeTracking",
  field: "field",
  customers: "contacts",
  vendors: "contacts",
  catalog: "catalog",
  settings: "settings",
  accounts: "settings",
  journal: "settings",
  recon: "settings",
  cards: "settings",
  loans: "settings",
};

export const isAdminRole = (role) => role === "owner" || role === "admin";

// The signed-in user's membership row, matched by auth user id.
export function currentMember(db, session) {
  return (db.members || []).find(m => m.userId === session.user.id) || null;
}

// Resolved access level for one area: admins → "write"; otherwise the stored
// level. Fails closed (standards S5.4): only an explicit null area is open to
// everyone (the dashboard); an unknown area — a page left out of NAV_AREA — or
// an area missing from a member's permissions is "none", and a viewer is
// capped at "read". The database's my_perm() (migration 007) agrees.
export function permLevel(member, area) {
  if (area === null) return "write";         // explicitly ungated (dashboard)
  if (!area || !member) return "none";
  if (isAdminRole(member.role)) return "write";
  const level = member.permissions?.[area];
  if (level !== "read" && level !== "write") return "none";
  return member.role === "viewer" ? "read" : level;
}

export const canRead = (member, area) => permLevel(member, area) !== "none";
export const canWrite = (member, area) => permLevel(member, area) === "write";
