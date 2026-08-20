import { useState, useCallback } from "react";
import { supabase } from "./lib/supabaseClient.js";
import { useLedger } from "./lib/store.js";
import { cls } from "./lib/helpers.js";
import { invoiceStatus, paid } from "./calc/ledger.js";
import { NAV_AREA, currentMember, canRead, canWrite, isAdminRole } from "./lib/permissions.js";
import { Ico, ICONS } from "./components/ui.jsx";
import DocumentView from "./components/DocumentView.jsx";
import GlobalSearch from "./components/GlobalSearch.jsx";
import Dashboard from "./views/Dashboard.jsx";
import ReportsView from "./views/Reports.jsx";
import ProposalsView from "./views/Proposals.jsx";
import MachineRatesView from "./views/MachineRates.jsx";
import QuotesView from "./views/Quotes.jsx";
import SalesOrdersView from "./views/SalesOrders.jsx";
import JobsView from "./views/Jobs.jsx";
import JobCostingView from "./views/JobCosting.jsx";
import TasksView from "./views/Tasks.jsx";
import TimeTrackingView from "./views/TimeTracking.jsx";
import InvoicesView from "./views/Invoices.jsx";
import ReceivablesView from "./views/Receivables.jsx";
import PurchaseOrdersView from "./views/PurchaseOrders.jsx";
import PayablesView from "./views/Payables.jsx";
import ExpensesView from "./views/Expenses.jsx";
import ContactsView from "./views/Contacts.jsx";
import CatalogView from "./views/Catalog.jsx";
import SettingsView from "./views/Settings.jsx";

const NAV = [
  {
    group: "Overview", items: [
      { k: "dashboard", label: "Dashboard", icon: ICONS.dash },
      { k: "reports", label: "Reports", icon: ICONS.reports },
      { k: "jobCosting", label: "Job Costing", icon: ICONS.job },
    ]
  },
  {
    group: "Sell", items: [
      { k: "proposals", label: "Proposals", icon: ICONS.so },
      { k: "quotes", label: "Quotes", icon: ICONS.quote },
      { k: "salesOrders", label: "Sales Orders", icon: ICONS.so },
      { k: "jobs", label: "Jobs", icon: ICONS.job },
      { k: "invoices", label: "Invoices", icon: ICONS.inv },
      { k: "tasks", label: "Tasks", icon: ICONS.task },
      { k: "receivables", label: "Receivables", icon: ICONS.ar },
    ]
  },
  {
    group: "Work", items: [
      { k: "timeTracking", label: "Time Tracking", icon: ICONS.clock },
    ]
  },
  {
    group: "Spend", items: [
      { k: "purchaseOrders", label: "Purchase Orders", icon: ICONS.so },
      { k: "payables", label: "Payables", icon: ICONS.ap },
      { k: "expenses", label: "Expenses", icon: ICONS.exp },
    ]
  },
  {
    group: "Records", items: [
      { k: "contacts", label: "Contacts", icon: ICONS.contacts },
      { k: "machineRates", label: "Machine Rates", icon: ICONS.settings },
      { k: "catalog", label: "Item Catalog", icon: ICONS.catalog },
      { k: "settings", label: "Settings", icon: ICONS.settings },
    ]
  },
];
const TITLES = {
  dashboard: ["Dashboard", "Your quote-to-cash pipeline at a glance"], quotes: ["Quotes", "Build, send, and track quotes"],
  salesOrders: ["Sales Orders", "Confirmed orders awaiting invoicing"], invoices: ["Invoices", "Issued invoices and payments"],
  jobs: ["Jobs", "Track progress and mark items ready to invoice"], tasks: ["Tasks", "Work waiting on you"],
  timeTracking: ["Time Tracking", "Log hours against a job"],
  receivables: ["Receivables", "What customers owe you, by age"], payables: ["Payables", "Vendor bills you owe"],
  purchaseOrders: ["Purchase Orders", "Orders you issue to vendors for parts"],
  expenses: ["Expenses", "Business spend by category"], contacts: ["Contacts", "Customers and vendors"],
  catalog: ["Item Catalog", "Reusable quote line items"], settings: ["Settings", "Company info and defaults"],
  reports: ["Reports", "P&L, sales tax, customers, and statements"],
  jobCosting: ["Job Costing", "Profit per job — revenue vs labor and materials"],
  proposals: ["Proposals", "Machine proposals — priced, tracked, and documented"],
  machineRates: ["Machine Rates", "The costing table behind proposal pricing"],
};

export default function App({ session }) {
  const [view, setView] = useState("dashboard");
  const [doc, setDoc] = useState(null); // {kind,doc}
  const [toastMsg, setToastMsg] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  // toast("msg") or toast("msg", { actionLabel, onAction }) for an Undo button.
  const toast = useCallback((m, opts) => {
    const t = { text: m, ...(opts || {}) };
    setToastMsg(t);
    setTimeout(() => setToastMsg(null), t.onAction ? 8000 : 2600);
  }, []);
  const { db, loading, loadError, actions } = useLedger(session, toast);
  const openDoc = (kind, d) => setDoc({ kind, doc: d });
  const go = (v) => { setView(v); setNavOpen(false); window.scrollTo(0, 0); };

  if (loading) return <div className="boot">Loading your books…</div>;
  if (loadError || !db) return <div className="boot"><div>
    <p>Couldn't load your data: {loadError || "unknown error"}</p>
    <button className="btn primary" onClick={() => actions.reload()}>Try Again</button>
  </div></div>;

  const counts = {
    quotes: db.quotes.filter(q => q.status === "draft" || q.status === "sent").length,
    salesOrders: db.salesOrders.filter(s => s.status === "open").length,
    invoices: db.invoices.filter(i => ["unpaid", "partial", "overdue"].includes(invoiceStatus(i))).length,
    payables: db.bills.filter(b => ((Number(b.amount) || 0) - paid(b)) > 0.005).length,
    tasks: (db.tasks || []).filter(t => t.status === "open").length,
  };

  // Role-based access: which nav areas this user may see, and whether the
  // active view is writable. Admins/owners see and write everything.
  const member = currentMember(db, session);
  const admin = isAdminRole(member?.role);
  const canSee = (k) => { const a = NAV_AREA[k]; return a === null || canRead(member, a) || (k === "settings" && admin); };
  const activeView = canSee(view) ? view : "dashboard";
  const readOnly = !canWrite(member, NAV_AREA[activeView]);

  const [t, sub] = TITLES[activeView];
  const props = { db, actions, toast, openDoc, go, session, readOnly, isAdmin: admin, member };

  return <div className="app">
    <div className={cls("sidebar", navOpen && "open")}>
      <div className="brand">
        <div className="brand-mark">L</div>
        <div><div className="brand-name">Ledger</div><div className="brand-sub">Quote → Cash</div></div>
      </div>
      <nav className="nav">
        {NAV.map(g => {
          const items = g.items.filter(it => canSee(it.k));
          if (!items.length) return null;
          return <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {items.map(it => <button key={it.k} className={cls("nav-item", activeView === it.k && "active")} onClick={() => go(it.k)}>
              <Ico d={it.icon} size={17} />{it.label}
              {counts[it.k] > 0 && <span className="count">{counts[it.k]}</span>}
            </button>)}
          </div>;
        })}
      </nav>
      <div className="sidebar-foot">
        <div>{db.settings.company || "Your Company"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.user.email}</span>
          <button className="link-btn" style={{ color: "#7FB0FF", flex: "none" }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    </div>

    <div className="main">
      <div className="topbar">
        <button className="btn ghost icon menu-btn" onClick={() => setNavOpen(o => !o)}><Ico d={ICONS.menu} size={20} /></button>
        <div><h1>{t}</h1><div className="sub">{sub}</div></div>
        <div className="topbar-actions">
          <GlobalSearch db={db} member={member} go={go} />
          <button className="btn ghost icon" title="Refresh from server" onClick={() => actions.reload()}><Ico d={ICONS.refresh} size={17} /></button>
        </div>
      </div>
      <div className="content">
        {activeView === "dashboard" && <Dashboard {...props} />}
        {activeView === "reports" && <ReportsView {...props} />}
        {activeView === "jobCosting" && <JobCostingView {...props} />}
        {activeView === "proposals" && <ProposalsView {...props} />}
        {activeView === "machineRates" && <MachineRatesView {...props} />}
        {activeView === "quotes" && <QuotesView {...props} />}
        {activeView === "salesOrders" && <SalesOrdersView {...props} />}
        {activeView === "jobs" && <JobsView {...props} />}
        {activeView === "tasks" && <TasksView {...props} />}
        {activeView === "timeTracking" && <TimeTrackingView {...props} />}
        {activeView === "invoices" && <InvoicesView {...props} />}
        {activeView === "receivables" && <ReceivablesView {...props} />}
        {activeView === "purchaseOrders" && <PurchaseOrdersView {...props} />}
        {activeView === "payables" && <PayablesView {...props} />}
        {activeView === "expenses" && <ExpensesView {...props} />}
        {activeView === "contacts" && <ContactsView {...props} />}
        {activeView === "catalog" && <CatalogView {...props} />}
        {activeView === "settings" && <SettingsView {...props} />}
      </div>
    </div>

    {doc && <DocumentView kind={doc.kind} doc={doc.doc}
      contact={db.contacts.find(c => c.id === (doc.doc.customerId || doc.doc.vendorId))} settings={db.settings} onClose={() => setDoc(null)} />}
    {toastMsg && <div className="toast"><Ico d={ICONS.check} size={16} />{toastMsg.text}
      {toastMsg.onAction && <button className="link-btn" style={{ color: "#7FB0FF", marginLeft: 10, fontWeight: 600 }}
        onClick={() => { toastMsg.onAction(); setToastMsg(null); }}>{toastMsg.actionLabel || "Undo"}</button>}
    </div>}
  </div>;
}
