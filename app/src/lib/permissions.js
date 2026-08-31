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
  { key: "proposals", label: "Proposals & Machine Rates" },
  { key: "quotes", label: "Quotes" },
  { key: "salesOrders", label: "Sales Orders" },
  { key: "jobs", label: "Jobs & Progress" },
  { key: "invoices", label: "Invoices" },
  { key: "receivables", label: "Receivables" },
  { key: "payables", label: "Payables" },
  { key: "expenses", label: "Expenses" },
  { key: "timeTracking", label: "Time Tracking" },
  { key: "field", label: "Field (mobile)" },
  { key: "contacts", label: "Contacts" },
  { key: "catalog", label: "Item Catalog" },
  { key: "settings", label: "Settings & Users" },
];

// Nav key → access area. null means "always available" (e.g. the dashboard).
// Tasks are gated by 'invoices' — the invoice tasks are for invoice-authorized
// users to act on.
export const NAV_AREA = {
  dashboard: null,
  reports: "reports",
  jobCosting: "reports",
  proposals: "proposals",
  machineRates: "proposals",
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
  contacts: "contacts",
  catalog: "catalog",
  settings: "settings",
};

export const isAdminRole = (role) => role === "owner" || role === "admin";

// The signed-in user's membership row, matched by auth user id.
export function currentMember(db, session) {
  return (db.members || []).find(m => m.userId === session.user.id) || null;
}

// Resolved access level for one area: admins → "write"; otherwise the stored
// level, defaulting to "none".
export function permLevel(member, area) {
  if (!area) return "write";                 // ungated (dashboard)
  if (member && isAdminRole(member.role)) return "write";
  return (member && member.permissions && member.permissions[area]) || "none";
}

export const canRead = (member, area) => permLevel(member, area) !== "none";
export const canWrite = (member, area) => permLevel(member, area) === "write";
